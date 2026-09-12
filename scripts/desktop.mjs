import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const env = { ...process.env };
// WebView2 desktop builds use the MSVC runtime on Windows.
if (process.platform === "win32" && !env.RUSTUP_TOOLCHAIN) {
  env.RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-msvc";
}
const cli = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { env, stdio: "inherit" });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
