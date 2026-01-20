# Cardless Deploy (Deno Deploy)

This option avoids credit card requirements and is suitable for demo validation.
It uses a Deno runtime entry that mocks the LLM stream and runs Wikipedia tool calls.

## Steps

1) Create a Deno Deploy project: https://dash.deno.com
2) Connect the GitHub repo: `parallel-tool-calling`
3) Set the entrypoint to `deploy/deno_server.ts`
4) Enable Deno KV for the project (required for request state)
5) Add env vars (optional):
   - `MCP_NAMU_BASE=https://namu.wiki`
   - `MCP_TIMEOUT_MS=8000`

## Notes

- The Deno entry returns mock LLM streaming (SSE) and real NamuWiki tool results.
- Tool calling is heuristic-based in this entry (no Codex CLI in Deno Deploy).
- Static UI is served from `deploy/public`.

## Admin

`POST /admin/reset` supports clearing stored previous context:

```json
{ "userId": "optional" }
```
