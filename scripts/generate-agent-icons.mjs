import fs from "node:fs";
import path from "node:path";

const products = { "claude-code": "claudecode-color", codex: "codex", cursor: "cursor", windsurf: "windsurf", "github-copilot": "githubcopilot", "gemini-cli": "geminicli-color", opencode: "opencode", openclaw: "openclaw-color", cline: "cline", trae: "trae-color", "trae-cn": "trae-color", codebuddy: "codebuddy-color", qoder: "qoder-color", "qwen-code": "qwen-color", "kimi-code": "kimi-color" };
fs.mkdirSync("public/agents", { recursive: true });
const manifest = {};
for (const [id, name] of Object.entries(products)) {
  const svg = fs.readFileSync(path.resolve(process.argv[2], "icons", `${name}.svg`), "utf8");
  fs.writeFileSync(`public/agents/${id}.svg`, svg, "utf8");
  manifest[id] = `/agents/${id}.svg`;
}
fs.writeFileSync("src/data/agentIcons.json", JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Generated ${Object.keys(manifest).length} local product icons from LobeHub Icons.`);
