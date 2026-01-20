const { runCodexCli } = require("../utils/codex");

function shouldUseHeuristic() {
  return process.env.MCP_KEYWORD_MODE === "simple";
}

function normalizeKeywords(text) {
  if (!text) return "";
  const cleaned = text.replace(/\n/g, " ").trim();
  const firstLine = cleaned.split(/[\n]/)[0] || "";
  const firstComma = firstLine.split(",")[0] || "";
  const firstToken = firstComma.trim().split(/\s+/)[0] || "";
  return firstToken;
}

async function keywordizeQuery(query, userContext) {
  const safeQuery = String(query || "").trim();
  if (!safeQuery) return "";

  if (shouldUseHeuristic()) {
    return safeQuery;
  }

  const prompt = [
    "You are a keyword extraction tool.",
    "Return exactly ONE short Korean keyword (2-6 words max) that best matches user intent.",
    "Return ONLY the keyword text. Do not include commas.",
    `Query: ${safeQuery}`,
    userContext && userContext.userId ? `UserId: ${userContext.userId}` : null
  ]
    .filter(Boolean)
    .join("\n");

  const timeoutMs = Number(process.env.MCP_KEYWORD_TIMEOUT_MS || 8000);
  try {
    const raw = await runCodexCli(prompt, { timeoutMs });
    const normalized = normalizeKeywords(raw);
    return normalized || safeQuery;
  } catch (error) {
    return safeQuery;
  }
}

module.exports = {
  keywordizeQuery
};
