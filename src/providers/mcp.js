const { requestJson } = require("../utils/http");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mockMcpProvider(query) {
  const safeQuery = String(query || "").trim();
  const delayMs = Number(process.env.MCP_SIMULATED_DELAY_MS || 2500);
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  return {
    source: "mock",
    query: safeQuery,
    results: [
      {
        title: `MCP expanded insight for "${safeQuery}"`,
        url: "https://mcp.example.com/insights",
        snippet: "Parallel MCP result placeholder. Replace with MCP integration output."
      },
      {
        title: "MCP supplemental dataset",
        url: "https://mcp.example.com/datasets",
        snippet: "Additional context returned by MCP sources."
      }
    ]
  };
}

async function wikipediaProvider(query) {
  const safeQuery = String(query || "").trim();
  const userAgent =
    process.env.MCP_USER_AGENT || "search-chat-mcp/0.1 (wikipedia-query)";
  const headers = { "User-Agent": userAgent };
  const wikiBase = process.env.MCP_WIKI_BASE || "https://ko.wikipedia.org";

  const searchUrl = `${wikiBase}/w/rest.php/v1/search/page?q=${encodeURIComponent(
    safeQuery
  )}&limit=1`;
  try {
    const searchResult = await requestJson(searchUrl, { headers });
    const first = searchResult && searchResult.pages && searchResult.pages[0];
    if (!first || !first.title) {
      throw new Error("MCP_WIKI_EMPTY");
    }
    const summaryUrl = `${wikiBase}/api/rest_v1/page/summary/${encodeURIComponent(
      first.title
    )}`;
    const summary = await requestJson(summaryUrl, { headers });
    return {
      source: "wikipedia",
      query: safeQuery,
      search: searchResult,
      summary
    };
  } catch (error) {
    throw new Error(`MCP_WIKI_FAILED: ${error.message}`);
  }
}

async function mcpSearchProvider(query) {
  if (process.env.MCP_USE_MOCK === "1") {
    return mockMcpProvider(query);
  }

  return wikipediaProvider(query);
}

module.exports = {
  mcpSearchProvider
};
