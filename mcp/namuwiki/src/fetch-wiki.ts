import * as cheerio from 'cheerio'

export async function fetchNamuWiki(title: string): Promise<{ contentHtml: string }> {
  const encoded = encodeURIComponent(title)
  const url = `https://namu.wiki/w/${encoded}`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'namuwiki-mcp/0.1',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7'
    }
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch NamuWiki page: ${res.status}`)
  }
  const html = await res.text()

  const $ = cheerio.load(html)
  const nodeTexts = $('#app')
    .find('*')
    .contents()
    .filter((_, node) => node.type === 'text')
    .map((_, node) => $(node).text().trim())
    .get()
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!nodeTexts.length) {
    throw new Error('Could not locate article content')
  }

  return {
    contentHtml: nodeTexts
  }
}
