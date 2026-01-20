const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createApp, store } = require("../src/app");

async function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function jsonRequest(url, options) {
  const target = new URL(url);
  const body = options.body || null;
  const headers = { "content-type": "application/json", ...(options.headers || {}) };

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: options.method || "GET",
        headers
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ response: res, body: parsed });
        });
      }
    );

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function pollStatus(baseUrl, requestId, userId, expected, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const { body } = await jsonRequest(`${baseUrl}/search/${requestId}/status`, {
      method: "GET",
      headers: { "x-user-id": userId }
    });
    if (body.status === expected) return body.status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`status_not_reached_${expected}`);
}

test("normal search returns immediately and MCP becomes ready", async () => {
  process.env.MCP_SIMULATED_DELAY_MS = "10";
  process.env.MCP_USE_MOCK = "1";
  process.env.LLM_USE_MOCK = "1";
  process.env.MCP_TOOL_MODE = "simple";
  process.env.MCP_TIMEOUT_MS = "500";
  const app = createApp({ ttlMs: 1000, mcpTimeoutMs: 500 });
  const { server, port } = await startServer(app);
  const baseUrl = `http://127.0.0.1:${port}`;

  const { body: searchBody } = await jsonRequest(`${baseUrl}/search`, {
    method: "POST",
    body: JSON.stringify({ query: "설명 테스트", userContext: { userId: "u-1" } })
  });

  assert.ok(searchBody.requestId);
  assert.equal(searchBody.status, "pending");
  assert.ok(Array.isArray(searchBody.results));

  const status = await pollStatus(baseUrl, searchBody.requestId, "u-1", "ready");
  assert.equal(status, "ready");

  const { response: forbiddenRes } = await jsonRequest(
    `${baseUrl}/search/${searchBody.requestId}/status`,
    { method: "GET", headers: { "x-user-id": "u-2" } }
  );
  assert.equal(forbiddenRes.statusCode, 403);

  store.clear();
  await stopServer(server);
});

test("MCP timeout marks request failed", async () => {
  process.env.MCP_SIMULATED_DELAY_MS = "200";
  process.env.MCP_USE_MOCK = "1";
  process.env.LLM_USE_MOCK = "1";
  process.env.MCP_TOOL_MODE = "simple";
  process.env.MCP_TIMEOUT_MS = "50";
  const app = createApp({ ttlMs: 1000, mcpTimeoutMs: 50 });
  const { server, port } = await startServer(app);
  const baseUrl = `http://127.0.0.1:${port}`;

  const { body: searchBody } = await jsonRequest(`${baseUrl}/search`, {
    method: "POST",
    body: JSON.stringify({ query: "설명 timeout", userContext: { userId: "u-1" } })
  });

  const status = await pollStatus(baseUrl, searchBody.requestId, "u-1", "failed");
  assert.equal(status, "failed");

  const { response, body } = await jsonRequest(
    `${baseUrl}/search/${searchBody.requestId}/mcp`,
    { method: "GET", headers: { "x-user-id": "u-1" } }
  );
  assert.equal(response.statusCode, 424);
  assert.equal(body.error, "mcp_failed");

  store.clear();
  await stopServer(server);
});
