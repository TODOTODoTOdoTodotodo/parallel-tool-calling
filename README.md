# Search Chat (LLM Stream + Tool Calling)

New service that streams an LLM answer immediately and follows up with tool-calling (Wikipedia) results when ready.

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

## Flow Summary

- LLM 답변은 즉시 스트리밍됩니다.
- 병렬로 “도구 호출 여부 + 키워드”를 판단합니다 (휴리스틱 + LLM).
- 도구 호출이 필요하면 위키 검색을 실행합니다.
- 결과가 준비되면 알림 팝업을 띄우고, MCP 요약(제목/요약/이미지)을 LLM 영역에 즉시 추가합니다.
- `/mcp`는 원본 도구 결과를 그대로 반환합니다.

## UX Flow

- Stream the normal LLM answer via `/search?stream=true`.
- Listen to `/stream`.
- When ready, show the prompt:
  - “유용한 검색결과가 더 있어요! 확인할래요?”
- MCP 요약이 자동으로 LLM 영역에 추가됩니다.

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

Tool calling (Wikipedia search + summary API):
- `MCP_USE_MOCK=1` to use the mock response.
- `MCP_SIMULATED_DELAY_MS` (default: 2500)
- `MCP_USER_AGENT` (optional, sent to Wikipedia API)
- `MCP_WIKI_BASE` (default: `https://ko.wikipedia.org`)
- `MCP_TOOL_MODE` (`simple` to skip LLM decision; default uses Codex CLI)
- `MCP_TOOL_TIMEOUT_MS` (default: 3000)
- `MCP_TOOL_MODE` (`simple` to skip LLM tool decision; default uses Codex CLI)
- `MCP_TOOL_TIMEOUT_MS` (default: 3000)

General:
- `MCP_TIMEOUT_MS` (default: 8000)
- `SEARCH_TTL_MS` (default: 10 minutes)
- `PORT` (default: 3000)

## Notes

- This implementation stores results in memory. Replace `src/store.js` with Redis for production.
- Replace the tool-calling example with a real MCP server integration when ready.
- NamuWiki MCP was removed because it is blocked in this hosted environment (HTTP 403).
