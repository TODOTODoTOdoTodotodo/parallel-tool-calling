const cheerio = require("cheerio");
const { requestText, requestJson } = require("../utils/http");

async function fetchNamuWiki(title) {
  const safeTitle = String(title || "").trim();
  const localUrl = process.env.MCP_NAMU_LOCAL_URL;
  if (localUrl) {
    const url = `${localUrl}?title=${encodeURIComponent(safeTitle)}`;
    const payload = await requestJson(url, {
      headers: { "x-namu-local": "1" }
    });
    if (!payload || !payload.content) {
      throw new Error("NAMU_WIKI_EMPTY");
    }
    return {
      source: "namuwiki",
      query: safeTitle,
      content: payload.content
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
    }
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
    content: nodeTexts
  };
}

module.exports = {
  fetchNamuWiki
};
