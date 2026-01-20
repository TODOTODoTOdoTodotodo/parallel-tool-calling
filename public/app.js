const form = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const statusEl = document.getElementById("status");
const requestIdEl = document.getElementById("request-id");
const normalOutput = document.getElementById("normal-output");
const notice = document.getElementById("mcp-notice");
const confirmBtn = document.getElementById("confirm-mcp");
const dismissBtn = document.getElementById("dismiss-mcp");
const mcpOutput = document.getElementById("mcp-output");

let activeRequestId = null;
let streamController = null;
let mcpEventSource = null;
let cachedMcpPayload = null;

function setStatus(text) {
  statusEl.textContent = `status: ${text}`;
}

function setRequestId(id) {
  activeRequestId = id;
  requestIdEl.textContent = `requestId: ${id || "-"}`;
}

function showNotice(visible) {
  notice.hidden = !visible;
}

function resetUI() {
  normalOutput.textContent = "";
  mcpOutput.textContent = "";
  showNotice(false);
  setStatus("-");
  setRequestId(null);
  cachedMcpPayload = null;
}

async function streamNormalAnswer(query) {
  streamController = new AbortController();
  const response = await fetch(`/search?stream=true`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "demo-user"
    },
    body: JSON.stringify({ query, userContext: { userId: "demo-user" } }),
    signal: streamController.signal
  });

  if (!response.ok) {
    throw new Error("normal_stream_failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const lines = part.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLine = lines.find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const data = JSON.parse(dataLine.replace("data:", "").trim());

      if (eventLine && eventLine.includes("normal-start")) {
        setRequestId(data.requestId);
        setStatus("pending");
        listenForMcp(data.requestId);
      }

      if (eventLine && eventLine.includes("normal-chunk")) {
        normalOutput.textContent += data.delta;
      }

      if (eventLine && eventLine.includes("normal-done")) {
        setStatus("pending");
      }
    }
  }
}

function listenForMcp(requestId) {
  if (mcpEventSource) {
    mcpEventSource.close();
  }
  mcpEventSource = new EventSource(`/search/${requestId}/stream?userId=demo-user`, {
    withCredentials: false
  });

  mcpEventSource.addEventListener("mcp-ready", async () => {
    try {
      const response = await fetch(`/search/${requestId}/mcp`, {
        headers: { "x-user-id": "demo-user" }
      });
      if (!response.ok) {
        setStatus(response.status === 409 ? "pending" : "failed");
        mcpEventSource.close();
        return;
      }
      cachedMcpPayload = await response.json();
      setStatus("ready");
      showNotice(true);
      mcpOutput.textContent = JSON.stringify(cachedMcpPayload, null, 2);
    } catch (error) {
      setStatus("failed");
    } finally {
      mcpEventSource.close();
    }
  });

  mcpEventSource.addEventListener("mcp-failed", () => {
    setStatus("failed");
    mcpEventSource.close();
  });

  mcpEventSource.addEventListener("mcp-expired", () => {
    setStatus("expired");
    mcpEventSource.close();
  });
}

async function fetchMcp() {
  if (cachedMcpPayload) {
    mcpOutput.textContent = JSON.stringify(cachedMcpPayload, null, 2);
    return;
  }

  if (!activeRequestId) return;
  const response = await fetch(`/search/${activeRequestId}/mcp`, {
    headers: { "x-user-id": "demo-user" }
  });
  const payload = await response.json();
  mcpOutput.textContent = JSON.stringify(payload, null, 2);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetUI();
  const query = queryInput.value.trim();
  if (!query) return;

  try {
    await streamNormalAnswer(query);
  } catch (error) {
    setStatus("error");
    normalOutput.textContent = "일반 검색 스트리밍에 실패했습니다.";
  }
});

confirmBtn.addEventListener("click", async () => {
  showNotice(false);
  await fetchMcp();
});

dismissBtn.addEventListener("click", () => {
  showNotice(false);
});
