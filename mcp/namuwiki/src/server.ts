import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { fetchNamuWiki } from './fetch-wiki.js'

const VERSION = '0.1.0'
const server = new Server(
  {
    name: 'namuwiki-mcp',
    version: VERSION
  },
  {
    capabilities: {
      tools: {}
    }
  }
)

const FetchWikiSchema = z.object({
  title: z.string().describe('나무위키 문서 제목')
})

type FetchWikiParams = z.infer<typeof FetchWikiSchema>

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'fetch_namuwiki_article',
        description: '나무위키 문서 내용을 불러옵니다.',
        inputSchema: zodToJsonSchema(FetchWikiSchema)
      }
    ]
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  if (name === 'fetch_namuwiki_article') {
    try {
      const parsed = FetchWikiSchema.parse(args) as FetchWikiParams
      const data = await fetchNamuWiki(parsed.title)
      const contentHtml = data?.contentHtml ?? '내용을 불러올 수 없습니다.'
      return {
        content: [
          {
            type: 'text',
            text: `📘 ${contentHtml}`
          }
        ]
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error'
      return {
        content: [
          {
            type: 'text',
            text: `오류: ${message}`
          }
        ]
      }
    }
  }
  throw new Error(`도구 '${name}'을(를) 찾을 수 없습니다.`)
})

const transport = new StdioServerTransport()
await server.connect(transport)
