import { serve } from "std/http";

const STATUS = {
  PENDING: "pending",
  READY: "ready",
  FAILED: "failed",
  EXPIRED: "expired"
} as const;

type Status = (typeof STATUS)[keyof typeof STATUS];

type RequestRecord = {
  requestId: string;
  userId: string;
  query: string;
  status: Status;
  createdAt: number;
  expiresAt: number;
  results: { normal: unknown; mcp: unknown };
};

const store = new Map<string, RequestRecord>();
const previousContext = new Map<string, string>();
let kv: Deno.Kv | null = null;

try {
  kv = await Deno.openKv();
} catch (_error) {
  kv = null;
}

const DEFAULT_TTL_MS = Number(Deno.env.get("SEARCH_TTL_MS") || 1000 * 60 * 10);
const MCP_TIMEOUT_MS = Number(Deno.env.get("MCP_TIMEOUT_MS") || 8000);
const MCP_WIKI_BASE = Deno.env.get("MCP_WIKI_BASE") || "https://ko.wikipedia.org";

function createId() {
  return crypto.randomUUID();
}

function resolveUserId(req: Request, body?: any) {
  const headerUser = req.headers.get("x-user-id");
  const url = new URL(req.url);
  const queryUser = url.searchParams.get("userId");
  const bodyUser = body?.userContext?.userId;
  return headerUser || bodyUser || queryUser || null;
}

function isExpired(record: RequestRecord) {
  return Date.now() > record.expiresAt;
}

async function getRecord(requestId: string): Promise<RequestRecord | null> {
  if (kv) {
    const entry = await kv.get<RequestRecord>(["request", requestId]);
    return entry.value ?? null;
  }
  return store.get(requestId) ?? null;
}

async function setRecord(record: RequestRecord) {
  store.set(record.requestId, record);
  if (kv) {
    await kv.set(["request", record.requestId], record);
  }
}

async function getPreviousContext(userId: string) {
  if (kv) {
    const entry = await kv.get<string>(["context", userId]);
    return entry.value ?? "";
  }
  return previousContext.get(userId) || "";
}

async function setPreviousContext(userId: string, value: string) {
  previousContext.set(userId, value);
  if (kv) {
    await kv.set(["context", userId], value);
  }
}

function shouldCallToolByHeuristic(query: string) {
  const patterns = [
    /\b(what|who|where|when|why|how)\b/i,
    /설명|요약|정의|배경|역사|원리|구조|연구|논문|문헌|개요|소개/,
    /누구|무엇|뭐|어떤/,
    /위키|백과|정보/,
    /커넥텀|커넥톰/,
    /예쁜꼬마선충|선충|C\.?\s*elegans/i
  ];
  return patterns.some((pattern) => pattern.test(query));
}

function keywordFromQuery(query: string) {
  const text = query;
  const known = ["예쁜꼬마선충", "커넥텀", "커넥톰", "선충", "C. elegans", "C elegans"];
  for (const term of known) {
    if (text.includes(term)) return term;
  }
  const koreanWords = text.match(/[가-힣]{2,}/g);
  if (koreanWords?.length) return koreanWords[0];
  return text.split(/\s+/)[0] || text;
}

async function wikipediaSearch(query: string) {
  const searchUrl = `${MCP_WIKI_BASE}/w/rest.php/v1/search/page?q=${encodeURIComponent(
    query
  )}&limit=1`;
  const searchRes = await fetch(searchUrl, {
    headers: { "User-Agent": "parallel-tool-calling/0.1" }
  });
  if (!searchRes.ok) throw new Error(`MCP_WIKI_FAILED: HTTP_${searchRes.status}`);
  const searchJson = await searchRes.json();
  const first = searchJson?.pages?.[0];
  if (!first?.title) throw new Error("MCP_WIKI_EMPTY");
  const summaryUrl = `${MCP_WIKI_BASE}/api/rest_v1/page/summary/${encodeURIComponent(
    first.title
  )}`;
  const summaryRes = await fetch(summaryUrl, {
    headers: { "User-Agent": "parallel-tool-calling/0.1" }
  });
  if (!summaryRes.ok) throw new Error(`MCP_WIKI_FAILED: HTTP_${summaryRes.status}`);
  const summary = await summaryRes.json();
  return { source: "wikipedia", query, search: searchJson, summary };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("MCP_TIMEOUT")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  };
}

function contentTypeFor(pathname: string) {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function serveStatic(pathname: string) {
  const base = new URL("./public/", import.meta.url);
  const target = new URL(pathname.replace(/^\/+/, ""), base);
  try {
    const file = await Deno.readFile(target);
    return new Response(file, {
      headers: { "Content-Type": contentTypeFor(pathname) }
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
}

function writeSse(controller: ReadableStreamDefaultController, event: string, data: unknown) {
  const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(new TextEncoder().encode(payload));
}

async function handleSearch(req: Request) {
  const body = await req.json().catch(() => ({}));
  const query = String(body?.query || "").trim();
  const userId = resolveUserId(req, body);
  if (!query) return new Response(JSON.stringify({ error: "query_required" }), { status: 400 });
  if (!userId) return new Response(JSON.stringify({ error: "user_required" }), { status: 400 });

  const requestId = createId();
  const record: RequestRecord = {
    requestId,
    userId,
    query,
    status: STATUS.PENDING,
    createdAt: Date.now(),
    expiresAt: Date.now() + DEFAULT_TTL_MS,
    results: { normal: null, mcp: null }
  };
  await setRecord(record);
  const prev = await getPreviousContext(userId);
  (record as RequestRecord & { previous?: string }).previous = prev;

  const shouldCall = shouldCallToolByHeuristic(query);
  if (shouldCall) {
    const keyword = keywordFromQuery(query) || query;
    const mcpPromise = wikipediaSearch(keyword).catch(async (error) => {
      if (String(error?.message).includes("MCP_WIKI_EMPTY") && keyword !== query) {
        return wikipediaSearch(query);
      }
      throw error;
    });

    withTimeout(mcpPromise, MCP_TIMEOUT_MS)
      .then((payload) => {
        record.results.mcp = payload;
        record.status = STATUS.READY;
        setRecord(record);
      })
      .catch(() => {
        record.status = STATUS.FAILED;
        setRecord(record);
      });
  } else {
    record.status = STATUS.FAILED;
  }

  const url = new URL(req.url);
  const wantsStream = url.searchParams.get("stream") === "true";
  const previous = (record as RequestRecord & { previous?: string }).previous;
  if (!wantsStream) {
    const answer = previous
      ? `LLM mock answer for \"${query}\". (previous: ${previous})`
      : `LLM mock answer for \"${query}\".`;
    record.results.normal = {
      results: [{ type: "llm", answer, source: "llm" }]
    };
    await setPreviousContext(userId, answer);
    return Response.json({ requestId, results: record.results.normal.results, status: STATUS.PENDING });
  }

  const stream = new ReadableStream({
    start(controller) {
      writeSse(controller, "normal-start", { requestId });
      const prevText = previous ? ` (previous: ${previous})` : "";
      const text = `LLM mock answer for "${query}".${prevText}`;
      const parts = text.split(" ");
      let idx = 0;
      const interval = setInterval(() => {
        if (idx >= parts.length) {
          clearInterval(interval);
          record.results.normal = { results: [{ type: "llm", answer: text, source: "llm" }] };
          setRecord(record);
          setPreviousContext(userId, text);
          writeSse(controller, "normal-done", { requestId });
          controller.close();
          return;
        }
        writeSse(controller, "normal-chunk", { delta: parts[idx] + " " });
        idx += 1;
      }, 30);
    }
  });

  return new Response(stream, { headers: sseHeaders() });
}

async function handleStatus(req: Request, requestId: string) {
  const record = await getRecord(requestId);
  const userId = resolveUserId(req);
  if (!userId) return new Response(JSON.stringify({ error: "user_required" }), { status: 400 });
  if (!record) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  if (record.userId !== userId) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  if (isExpired(record)) {
    record.status = STATUS.EXPIRED;
    await setRecord(record);
  }
  return Response.json({ status: record.status });
}

async function handleMcp(req: Request, requestId: string) {
  const record = await getRecord(requestId);
  const userId = resolveUserId(req);
  if (!userId) return new Response(JSON.stringify({ error: "user_required" }), { status: 400 });
  if (!record) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  if (record.userId !== userId) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  if (record.status === STATUS.EXPIRED) return new Response(JSON.stringify({ error: "expired" }), { status: 410 });
  if (record.status === STATUS.FAILED) return new Response(JSON.stringify({ error: "mcp_failed" }), { status: 424 });
  if (record.status !== STATUS.READY) return new Response(JSON.stringify({ error: "mcp_not_ready" }), { status: 409 });
  return Response.json(record.results.mcp || {});
}

async function handleStream(req: Request, requestId: string) {
  const record = await getRecord(requestId);
  const userId = resolveUserId(req);
  if (!userId) return new Response(JSON.stringify({ error: "user_required" }), { status: 400 });
  if (!record) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  if (record.userId !== userId) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => writeSse(controller, event, data);
      let current = record;
      if (!current) {
        controller.close();
        return;
      }

      const poll = async () => {
        const latest = await getRecord(requestId);
        if (!latest) return;
        current = latest;
        if (current.status === STATUS.READY) {
          send("mcp-ready", { requestId });
          controller.close();
          return;
        }
        if (current.status === STATUS.FAILED) {
          send("mcp-failed", { requestId });
          controller.close();
          return;
        }
        if (current.status === STATUS.EXPIRED) {
          send("mcp-expired", { requestId });
          controller.close();
          return;
        }
        setTimeout(poll, 500);
      };

      const delay = Math.max(current.expiresAt - Date.now(), 0);
      setTimeout(() => {
        if (current.status === STATUS.PENDING) {
          current.status = STATUS.EXPIRED;
          setRecord(current);
          send("mcp-expired", { requestId });
        }
        controller.close();
      }, delay);

      poll();
    }
  });

  return new Response(stream, { headers: sseHeaders() });
}

serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "POST" && path === "/search") {
    return handleSearch(req);
  }

  const matchStatus = path.match(/^\/search\/([^/]+)\/status$/);
  if (req.method === "GET" && matchStatus) {
    return handleStatus(req, matchStatus[1]);
  }

  const matchMcp = path.match(/^\/search\/([^/]+)\/mcp$/);
  if (req.method === "GET" && matchMcp) {
    return handleMcp(req, matchMcp[1]);
  }

  const matchStream = path.match(/^\/search\/([^/]+)\/stream$/);
  if (req.method === "GET" && matchStream) {
    return handleStream(req, matchStream[1]);
  }

  if (req.method === "GET" && path === "/") {
    const file = await serveStatic("index.html");
    if (file) return file;
    return new Response("OK", { status: 200 });
  }

  if (req.method === "GET") {
    const asset = await serveStatic(path);
    if (asset) return asset;
  }

  return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
});
