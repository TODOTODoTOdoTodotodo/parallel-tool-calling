const { TextDecoder } = require("util");
const { spawn } = require("child_process");
const readline = require("readline");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function useMockLlm() {
  return process.env.LLM_USE_MOCK === "1";
}

async function* mockStreamAnswer(query) {
  const safeQuery = String(query || "").trim();
  const content = `LLM mock answer for "${safeQuery}". This is a placeholder streaming response.`;
  const chunks = content.split(" ");
  for (const chunk of chunks) {
    await sleep(30);
    yield `${chunk} `;
  }
}

async function* openAiStreamAnswer(query, userContext) {
  const safeQuery = String(query || "").trim();
  const endpoint = process.env.LLM_API_BASE || "https://api.openai.com/v1/chat/completions";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error("LLM_API_KEY_REQUIRED");
  }
  const previousContext = userContext && userContext.previousContext;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: "system", content: "You are a concise search assistant." },
        previousContext
          ? {
              role: "system",
              content: `Previous context: ${previousContext.query} | ${previousContext.answer}`
            }
          : null,
        { role: "user", content: safeQuery }
      ].filter(Boolean),
      user: userContext && userContext.userId ? String(userContext.userId) : undefined
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM_STREAM_FAILED: ${response.status} ${text}`);
  }

  const decoder = new TextDecoder("utf-8");
  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      const parsed = JSON.parse(payload);
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }
}

async function* codexCliStreamAnswer(query, userContext) {
  const safeQuery = String(query || "").trim();
  const codexBin = process.env.CODEX_BIN || "codex";
  const model = process.env.LLM_MODEL;
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 20000);
  const chunkSize = Number(process.env.LLM_CHUNK_SIZE || 24);
  const chunkDelayMs = Number(process.env.LLM_CHUNK_DELAY_MS || 30);
  const args = ["exec", "--json", "--skip-git-repo-check", "--color", "never"];
  if (model) {
    args.push("-m", model);
  }

  const previousContext = userContext && userContext.previousContext;
  const prompt = [
    "You are a concise search assistant. Answer the user query in Korean.",
    previousContext
      ? `Previous context: ${previousContext.query} | ${previousContext.answer}`
      : null,
    `User query: ${safeQuery}`,
    userContext && userContext.userId ? `User id: ${userContext.userId}` : null
  ]
    .filter(Boolean)
    .join("\n");

  const child = spawn(codexBin, [...args, prompt], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  let spawnError = null;
  let stderr = "";
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);

  child.on("error", (error) => {
    spawnError = error;
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const rl = readline.createInterface({ input: child.stdout });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      continue;
    }
    if (parsed.type === "item.completed" && parsed.item?.type === "agent_message") {
      const text = parsed.item?.text;
      if (text) {
        let offset = 0;
        while (offset < text.length) {
          const chunk = text.slice(offset, offset + chunkSize);
          offset += chunkSize;
          yield chunk;
          if (chunkDelayMs > 0) {
            await sleep(chunkDelayMs);
          }
        }
      }
    }
  }

  clearTimeout(timeout);

  const exitCode = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  if (timedOut) {
    throw new Error("LLM_TIMEOUT");
  }
  if (spawnError) {
    throw new Error(spawnError.message);
  }
  if (exitCode !== 0) {
    const detail = stderr.trim() || "codex_cli_failed";
    throw new Error(detail);
  }
}

async function* streamNormalAnswer(query, userContext) {
  if (useMockLlm()) {
    yield* mockStreamAnswer(query);
    return;
  }

  const provider = process.env.LLM_PROVIDER || "codex";
  if (provider === "openai") {
    yield* openAiStreamAnswer(query, userContext);
    return;
  }

  yield* codexCliStreamAnswer(query, userContext);
}

async function normalSearchProvider(query, userContext) {
  let answer = "";
  for await (const chunk of streamNormalAnswer(query, userContext)) {
    answer += chunk;
  }

  return {
    results: [
      {
        type: "llm",
        answer,
        source: "llm"
      }
    ],
    meta: {
      query: String(query || "").trim(),
      userContext: userContext || null
    }
  };
}

module.exports = {
  normalSearchProvider,
  streamNormalAnswer
};
