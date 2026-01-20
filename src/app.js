const express = require("express");
const { randomUUID } = require("crypto");
const { SearchStore, STATUS } = require("./store");
const { normalSearchProvider, streamNormalAnswer } = require("./providers/normal");
const { mcpSearchProvider } = require("./providers/mcp");
const { decideToolCall } = require("./providers/tool_decider");

const DEFAULT_TTL_MS = Number(process.env.SEARCH_TTL_MS || 1000 * 60 * 10);
const DEFAULT_MCP_TIMEOUT_MS = Number(process.env.MCP_TIMEOUT_MS || 8000);

const store = new SearchStore();
const userContextStore = new Map();

function getPreviousContext(userId) {
  return userContextStore.get(userId) || null;
}

function setPreviousContext(userId, query, answer, mcpSummary) {
  if (!userId) return;
  userContextStore.set(userId, {
    query,
    answer,
    mcpSummary: mcpSummary || null,
    updatedAt: Date.now()
  });
}

function clearPreviousContext(userId) {
  if (!userId) return false;
  return userContextStore.delete(userId);
}

function resolveUserId(req) {
  const headerUser = req.header("x-user-id");
  const bodyUser = req.body && req.body.userContext && req.body.userContext.userId;
  const queryUser = req.query && req.query.userId;
  return headerUser || bodyUser || queryUser || null;
}

function withMcpTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("MCP_TIMEOUT")), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function createApp(options = {}) {
  const ttlMs = Number(options.ttlMs || DEFAULT_TTL_MS);
  const mcpTimeoutMs = Number(options.mcpTimeoutMs || DEFAULT_MCP_TIMEOUT_MS);
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(express.static("public"));

  app.post("/search", async (req, res) => {
    const { query, userContext } = req.body || {};
    const userId = resolveUserId(req);
    const wantsStream =
      req.query.stream === "true" ||
      (req.headers.accept && req.headers.accept.includes("text/event-stream"));

    if (!query || !String(query).trim()) {
      return res.status(400).json({ error: "query_required" });
    }

    if (!userId) {
      return res.status(400).json({ error: "user_required" });
    }

    const requestId = randomUUID();
    store.createRequest({ requestId, userId, query, ttlMs });
    const previousContext = getPreviousContext(userId);
    const enrichedContext = {
      ...(userContext || {}),
      userId,
      previousContext
    };

    const startedAt = Date.now();
    const mcpPromise = Promise.resolve()
      .then(() => decideToolCall(query, userContext))
      .then(async ({ shouldCallTool, keyword }) => {
        if (!shouldCallTool) {
          throw new Error("MCP_SKIPPED");
        }
        const primaryQuery = keyword || query;
        try {
          return await mcpSearchProvider(primaryQuery);
        } catch (error) {
          if (error && error.message && error.message.includes("MCP_WIKI_EMPTY")) {
            if (primaryQuery !== query) {
              return mcpSearchProvider(query);
            }
          }
          throw error;
        }
      });

    withMcpTimeout(mcpPromise, mcpTimeoutMs)
      .then((payload) => {
        store.setMcpResults(requestId, payload);
        const summary = payload && payload.summary ? payload.summary : null;
        const mcpSummary = summary
          ? {
              title: summary.title || "",
              extract: summary.extract || summary.description || "",
              image: summary.originalimage && summary.originalimage.source
            }
          : null;
        if (mcpSummary) {
          const previous = getPreviousContext(userId);
          const prevQuery = previous ? previous.query : query;
          const prevAnswer = previous ? previous.answer : "";
          setPreviousContext(userId, prevQuery, prevAnswer, mcpSummary);
        }
        const duration = Date.now() - startedAt;
        console.log("mcp_ready", { requestId, durationMs: duration });
      })
      .catch((error) => {
        const duration = Date.now() - startedAt;
        if (error && error.message === "MCP_SKIPPED") {
          store.setFailed(requestId);
          console.log("mcp_skipped", { requestId, durationMs: duration });
          return;
        }
        store.setFailed(requestId);
        console.log("mcp_failed", { requestId, durationMs: duration, reason: error.message });
      });

    if (wantsStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const sendEvent = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendEvent("normal-start", { requestId });

      let answer = "";
      try {
        for await (const chunk of streamNormalAnswer(query, enrichedContext)) {
          answer += chunk;
          sendEvent("normal-chunk", { delta: chunk });
        }
        const normalPayload = {
          results: [
            {
              type: "llm",
              answer,
              source: "llm"
            }
          ]
        };
        store.setNormalResults(requestId, normalPayload);
        setPreviousContext(userId, query, answer);
        sendEvent("normal-done", { requestId });
      } catch (error) {
        sendEvent("normal-error", { requestId, message: "normal_search_failed" });
        return res.end();
      }

      res.end();
    } else {
      let normalPayload;
      try {
        normalPayload = await normalSearchProvider(query, enrichedContext);
        store.setNormalResults(requestId, normalPayload);
        const firstAnswer = normalPayload.results?.[0]?.answer || "";
        setPreviousContext(userId, query, firstAnswer);
      } catch (error) {
        return res.status(502).json({ error: "normal_search_failed" });
      }

      res.json({
        requestId,
        results: normalPayload.results,
        status: STATUS.PENDING
      });
    }

  });

  app.get("/search/:requestId/status", (req, res) => {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(400).json({ error: "user_required" });
    }

    const record = store.getRequestForUser(req.params.requestId, userId);
    if (!record) {
      return res.status(404).json({ error: "not_found" });
    }
    if (record === "forbidden") {
      return res.status(403).json({ error: "forbidden" });
    }

    res.json({ status: record.status });
  });

  app.get("/search/:requestId/mcp", (req, res) => {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(400).json({ error: "user_required" });
    }

    const record = store.getRequestForUser(req.params.requestId, userId);
    if (!record) {
      return res.status(404).json({ error: "not_found" });
    }
    if (record === "forbidden") {
      return res.status(403).json({ error: "forbidden" });
    }

    if (record.status === STATUS.EXPIRED) {
      return res.status(410).json({ error: "expired" });
    }
    if (record.status === STATUS.FAILED) {
      return res.status(424).json({ error: "mcp_failed" });
    }
    if (record.status !== STATUS.READY) {
      return res.status(409).json({ error: "mcp_not_ready" });
    }

    res.json(record.results.mcp || {});
  });

  app.get("/search/:requestId/stream", (req, res) => {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(400).json({ error: "user_required" });
    }

    const record = store.getRequestForUser(req.params.requestId, userId);
    if (!record) {
      return res.status(404).json({ error: "not_found" });
    }
    if (record === "forbidden") {
      return res.status(403).json({ error: "forbidden" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    if (record.status === STATUS.READY) {
      sendEvent("mcp-ready", { requestId: record.requestId });
      return res.end();
    }

    if (record.status === STATUS.FAILED) {
      sendEvent("mcp-failed", { requestId: record.requestId });
      return res.end();
    }

    if (record.status === STATUS.EXPIRED) {
      sendEvent("mcp-expired", { requestId: record.requestId });
      return res.end();
    }

    const onReady = ({ requestId }) => {
      if (requestId !== record.requestId) return;
      sendEvent("mcp-ready", { requestId });
      cleanup();
    };

    const cleanup = () => {
      store.off("mcp-ready", onReady);
      clearTimeout(expireTimer);
      res.end();
    };

    const expireDelay = Math.max(record.expiresAt - Date.now(), 0);
    const expireTimer = setTimeout(() => {
      sendEvent("mcp-expired", { requestId: record.requestId });
      cleanup();
    }, expireDelay);

    store.on("mcp-ready", onReady);
    req.on("close", cleanup);
  });

  app.post("/admin/reset", (req, res) => {
    const { userId } = req.body || {};
    if (!userId) {
      userContextStore.clear();
      return res.json({ ok: true, scope: "all" });
    }
    const removed = clearPreviousContext(userId);
    return res.json({ ok: true, scope: "user", removed });
  });

  return app;
}

module.exports = {
  createApp,
  store
};
