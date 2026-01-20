const { spawn } = require("child_process");
const readline = require("readline");

function runCodexCli(prompt, options = {}) {
  const codexBin = options.codexBin || process.env.CODEX_BIN || "codex";
  const timeoutMs = Number(options.timeoutMs || 8000);
  const model = options.model || process.env.LLM_MODEL;
  const args = ["exec", "--json", "--skip-git-repo-check", "--color", "never"];
  if (model) {
    args.push("-m", model);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(codexBin, [...args, prompt], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let output = "";
    let finished = false;

    const timeout = setTimeout(() => {
      finished = true;
      child.kill("SIGKILL");
      reject(new Error("CODEX_TIMEOUT"));
    }, timeoutMs);

    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (error) {
        return;
      }
      if (parsed.type === "item.completed" && parsed.item?.type === "agent_message") {
        output = parsed.item?.text || output;
      }
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || "CODEX_FAILED"));
        return;
      }
      if (!output) {
        reject(new Error("CODEX_NO_OUTPUT"));
        return;
      }
      resolve(output);
    });
  });
}

module.exports = {
  runCodexCli
};
