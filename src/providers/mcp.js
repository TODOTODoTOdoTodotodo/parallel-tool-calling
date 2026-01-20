const { fetchNamuWiki } = require("./namuwiki");

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

async function namuWikiProvider(query) {
  try {
    return await fetchNamuWiki(query);
  } catch (error) {
    const message = error && error.message ? error.message : "NAMU_WIKI_FAILED";
    throw new Error(`MCP_NAMU_FAILED: ${message}`);
  }
}

async function mcpSearchProvider(query) {
  if (process.env.MCP_USE_MOCK === "1") {
    return mockMcpProvider(query);
  }

  return namuWikiProvider(query);
}

module.exports = {
  mcpSearchProvider
};
