import { createServer } from 'node:http'
import { fetchNamuWiki } from './fetch-wiki.js'

const PORT = Number(process.env.PORT || 3890)

const server = createServer(async (req, res) => {
  try {
    if (!req.url) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'bad_request' }))
      return
    }
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
    if (url.pathname !== '/fetch') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found' }))
      return
    }
    const title = url.searchParams.get('title') || ''
    if (!title.trim()) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'title_required' }))
      return
    }
    const data = await fetchNamuWiki(title)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ content: data.contentHtml }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error'
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: message }))
  }
})

server.listen(PORT, () => {
  console.log(`namuwiki http server listening on ${PORT}`)
})
