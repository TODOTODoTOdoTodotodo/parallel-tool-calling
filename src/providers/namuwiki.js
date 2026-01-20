const cheerio = require("cheerio");
const { requestText, requestJson } = require("../utils/http");

async function fetchNamuWiki(title) {
  const safeTitle = String(title || "").trim();
  const localUrl = process.env.MCP_NAMU_LOCAL_URL;
  const maxChars = Number(process.env.MCP_NAMU_MAX_CHARS || 4000);
  const timeoutMs = Number(process.env.MCP_NAMU_TIMEOUT_MS || 6000);
  if (localUrl) {
    const url = `${localUrl}?title=${encodeURIComponent(safeTitle)}`;
    const payload = await requestJson(url, {
      headers: { "x-namu-local": "1" },
      timeoutMs
    });
    if (!payload || payload.error) {
      throw new Error(payload && payload.error ? payload.error : "NAMU_WIKI_EMPTY");
    }
    if (!payload.content) {
      throw new Error("NAMU_WIKI_EMPTY");
    }
    return {
      source: "namuwiki",
      query: safeTitle,
      content: payload.content.slice(0, maxChars)
    };
  }
  const encoded = encodeURIComponent(safeTitle);
  const base =
    process.env.MCP_NAMU_BASE || process.env.MCP_WIKI_BASE || "https://namu.wiki";
  const url = `${base}/w/${encoded}`;

  const html = await requestText(url, {
    headers: {
      "User-Agent": "parallel-tool-calling/0.1",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
      Referer: "https://namu.wiki/"
    },
    timeoutMs
  });

  const $ = cheerio.load(html);
  const nodeTexts = $("#app")
    .find("*")
    .contents()
    .filter((_, node) => node.type === "text")
    .map((_, node) => $(node).text().trim())
    .get()
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!nodeTexts.length) {
    throw new Error("NAMU_WIKI_EMPTY");
  }

  return {
    source: "namuwiki",
    query: safeTitle,
    content: nodeTexts.slice(0, maxChars)
  };
}

module.exports = {
  fetchNamuWiki
};
