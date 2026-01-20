const { runCodexCli } = require("../utils/codex");

const HEURISTIC_PATTERNS = [
  /\b(what|who|where|when|why|how)\b/i,
  /설명|요약|정의|배경|역사|원리|구조|연구|논문|문헌|개요|소개/, 
  /누구|무엇|뭐|어떤/, 
  /위키|백과|정보/,
  /커넥텀|커넥톰/,
  /예쁜꼬마선충|선충|C\.?\s*elegans/i
];

function shouldCallToolByHeuristic(query) {
  const text = String(query || "");
  return HEURISTIC_PATTERNS.some((pattern) => pattern.test(text));
}

function simpleKeywordFromQuery(query) {
  const text = String(query || "");
  const known = ["예쁜꼬마선충", "커넥텀", "커넥톰", "선충", "C. elegans", "C elegans"];
  for (const term of known) {
    if (text.includes(term)) return term;
  }
  const koreanWords = text.match(/[가-힣]{2,}/g);
  if (koreanWords && koreanWords.length > 0) return koreanWords[0];
  return text.split(/\s+/)[0] || text;
}

function parseDecision(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return null;
  }
}

async function decideToolCall(query, userContext) {
  const safeQuery = String(query || "").trim();
  const heuristic = shouldCallToolByHeuristic(safeQuery);

  if (process.env.MCP_TOOL_MODE === "simple") {
    return {
      shouldCallTool: heuristic,
      keyword: heuristic ? simpleKeywordFromQuery(safeQuery) : ""
    };
  }

  const prompt = [
    "너는 검색 도구 호출 여부를 결정하는 에이전트다.",
    "사용자 질의를 읽고 위키 검색 도구를 호출할지 판단해라.",
    "응답은 반드시 JSON으로만 출력한다.",
    "형식: {\"shouldCallTool\": true|false, \"keyword\": \"검색어\"}",
    "keyword는 1개의 한국어 검색어 또는 짧은 구로만 작성하라.",
    `Query: ${safeQuery}`,
    userContext && userContext.userId ? `UserId: ${userContext.userId}` : null
  ]
    .filter(Boolean)
    .join("\n");

  const timeoutMs = Number(process.env.MCP_TOOL_TIMEOUT_MS || 3000);
  try {
    const raw = await runCodexCli(prompt, { timeoutMs });
    const parsed = parseDecision(raw);
    if (!parsed || typeof parsed.shouldCallTool !== "boolean") {
      return {
        shouldCallTool: heuristic,
        keyword: heuristic ? simpleKeywordFromQuery(safeQuery) : ""
      };
    }
    const shouldCallTool = heuristic || parsed.shouldCallTool;
    const keyword = shouldCallTool
      ? String(parsed.keyword || simpleKeywordFromQuery(safeQuery)).trim()
      : "";
    return { shouldCallTool, keyword };
  } catch (error) {
    return {
      shouldCallTool: heuristic,
      keyword: heuristic ? simpleKeywordFromQuery(safeQuery) : ""
    };
  }
}

module.exports = {
  decideToolCall
};
