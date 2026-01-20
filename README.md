# Search Chat (LLM Stream + MCP)

New service that streams an LLM answer immediately and follows up with MCP expansion when ready.

## Quick start

```bash
npm install
npm start
```

Open the demo UI at `http://localhost:3000`.

## API

### POST /search

Request body:

```json
{
  "query": "string",
  "userContext": { "userId": "user-123" }
}
```

Headers:
- `x-user-id` can be used instead of `userContext.userId`.

Response:

```json
{
  "requestId": "uuid",
  "results": ["..."],
  "status": "pending"
}
```

### POST /search?stream=true (LLM streaming)

Server-sent events:
- `event: normal-start` → `{ requestId }`
- `event: normal-chunk` → `{ delta }`
- `event: normal-done` → `{ requestId }`
- `event: normal-error` → `{ requestId, message }`

### GET /search/{requestId}/status

Response:

```json
{ "status": "pending|ready|failed|expired" }
```

### GET /search/{requestId}/mcp

- `200` returns MCP response in the original provider format.
- `409` if MCP is still pending.
- `424` if MCP failed.
- `410` if expired.

### GET /search/{requestId}/stream (SSE)

Server-sent events:
- `event: mcp-ready`
- `event: mcp-failed`
- `event: mcp-expired`

### POST /admin/reset

Request body:

```json
{ "userId": "optional" }
```

- If `userId` is provided, clears that user's previous context.
- If omitted, clears all stored contexts (in-memory).

## Demo UI

- `public/index.html`, `public/app.js`, `public/styles.css` provide a minimal end-to-end UI.
- It streams the normal LLM answer and shows the MCP notification when ready.

## UX Flow

- Stream the normal LLM answer via `/search?stream=true`.
- Poll `/status` or listen to `/stream`.
- When ready, show the prompt:
  - “잠깐! 유용한 검색결과가 더 있어요. 확인하시겠어요?”
  - Buttons: “확인하기”, “닫기”
- On confirm, call `/mcp` and render the MCP payload as-is.

## Configuration

LLM (Codex CLI by default):
- `LLM_PROVIDER` (`codex` default, `openai` optional)
- `CODEX_BIN` (default: `codex`)
- `LLM_MODEL` (optional, forwarded to Codex/OpenAI)
- `LLM_TIMEOUT_MS` (default: 20000)
- `LLM_CHUNK_SIZE` (default: 24 characters)
- `LLM_CHUNK_DELAY_MS` (default: 30)
- `LLM_USE_MOCK=1` to force mock streaming.

OpenAI-compatible (optional):
- `LLM_API_BASE` (default: `https://api.openai.com/v1/chat/completions`)
- `LLM_API_KEY` (required when `LLM_PROVIDER=openai`)

MCP example (NamuWiki article fetch):
- `MCP_USE_MOCK=1` to use the mock MCP response.
- `MCP_SIMULATED_DELAY_MS` (default: 2500)
- `MCP_NAMU_BASE` (default: `https://namu.wiki`)
- `MCP_NAMU_LOCAL_URL` (optional, e.g. `http://127.0.0.1:3890/fetch`)
- `MCP_NAMU_TIMEOUT_MS` (default: 6000)
- `MCP_NAMU_MAX_CHARS` (default: 4000)
- `MCP_TOOL_MODE` (`simple` to skip LLM tool decision; default uses Codex CLI)
- `MCP_TOOL_TIMEOUT_MS` (default: 3000)

General:
- `MCP_TIMEOUT_MS` (default: 8000)
- `SEARCH_TTL_MS` (default: 10 minutes)
- `PORT` (default: 3000)

## Notes

- This implementation stores results in memory. Replace `src/store.js` with Redis for production.
- Replace MCP example with a real MCP server integration when ready.
