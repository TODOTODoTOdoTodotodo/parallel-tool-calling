# NamuWiki MCP

Minimal MCP server that fetches NamuWiki article text.

## Run

```bash
npm install
npm run start
```

## Local HTTP wrapper (for app integration)

```bash
npm run start:http
```

Default port is `3890` and the endpoint is:
`http://127.0.0.1:3890/fetch?title=이순신`

## Inspector

```bash
npx @modelcontextprotocol/inspector node mcp/namuwiki/src/server.ts
```
