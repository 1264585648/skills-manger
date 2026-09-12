import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  pathToFileURL(path.resolve(process.argv[2], "index.mjs"))
);
const browser = await chromium.connectOverCDP(
  process.argv[3] ?? "http://127.0.0.1:9224",
);
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().includes("1420"));
assert(page, "Tauri WebView page must be available");
const output = path.resolve("output/playwright");
await fs.mkdir(output, { recursive: true });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const waitScan = async () => {
  for (let n = 0; n < 120; n++) {
    const snapshot = await invoke("get_agent_center");
    if (!snapshot.scan.running) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Scan did not finish within 60 seconds");
};
await page.getByRole("button", { name: "A Agents", exact: true }).click();
let snapshot = await waitScan();
assert.equal(snapshot.catalog.length, 15);
assert(
  snapshot.skills.some((s) => s.linked && s.status === "present"),
  "valid links are discovered",
);
assert(
  !snapshot.skills
    .filter((s) => s.agentId === "claude-code")
    .some((s) => s.diagnostics.some((d) => d.message.includes("缺少 name"))),
);
const report = {
  products: snapshot.catalog.length,
  installed: snapshot.agents.filter((a) => a.detected).length,
  roots: snapshot.roots.length,
  instances: snapshot.skills.length,
  screenshots: [],
  checks: [],
};
for (const [width, height, scale] of [
  [1024, 680, 1],
  [1280, 800, 1],
  [1920, 1080, 1],
  [1024, 640, 1.25],
  [854, 534, 1.5],
]) {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: false,
  });
  await page.screenshot({
    path: path.join(output, `agents-native-${width}x${height}-${scale}.png`),
  });
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    body: document.body.scrollWidth,
    workbench: document
      .querySelector(".ac-workbench")
      ?.getBoundingClientRect()
      .toJSON(),
    overflow: [...document.querySelectorAll(".ac-page button")]
      .filter((e) => e.offsetWidth && e.scrollWidth > e.clientWidth + 3)
      .map((e) => e.textContent),
  }));
  assert(
    layout.body <= layout.width,
    `No horizontal page overflow at ${width}`,
  );
  assert.equal(
    layout.overflow.length,
    0,
    `Button text fits: ${layout.overflow}`,
  );
  report.screenshots.push({ width, height, scale, layout });
  await session.detach();
}
await page.setViewportSize({ width: 1280, height: 800 });
await page.getByRole("button", { name: "全部", exact: true }).click();
assert.equal(await page.locator(".ac-agent-item").count(), 15);
await page
  .getByRole("textbox", { name: "搜索 Agent", exact: true })
  .fill("Codex");
assert.equal(await page.locator(".ac-agent-item").count(), 1);
await page.getByRole("textbox", { name: "搜索 Agent", exact: true }).fill("");
await page.locator(".ac-agent-item").filter({ hasText: "Claude Code" }).click();
await page
  .getByRole("button", { name: "诊断", exact: false })
  .filter({ has: page.locator("svg") })
  .last()
  .click();
await page.screenshot({
  path: path.join(output, "agents-native-diagnostics.png"),
});
report.checks.push(
  "product catalog, search, native scan, link discovery, grouped diagnostics",
);

// Fixtures are inside the task's output directory; writes exercise the real Tauri commands.
const fixture = path.resolve("output/agents/native-fixture");
const source = path.join(fixture, "source/qa-agent-install");
const target = path.join(fixture, "project/.claude/skills");
await fs.mkdir(source, { recursive: true });
await fs.mkdir(path.join(target, "qa-agent-install"), { recursive: true });
const original =
  "---\nname: qa-agent-install\ndescription: original fixture\n---\nOriginal target\n";
await fs.writeFile(
  path.join(source, "SKILL.md"),
  "---\nname: qa-agent-install\ndescription: 中文安装回归\n---\nLibrary version\n",
  "utf8",
);
await fs.writeFile(
  path.join(target, "qa-agent-install/SKILL.md"),
  original,
  "utf8",
);
const imported = await invoke("import_skill_directory", { path: source });
const root = await invoke("register_agent_root", {
  agentId: "claude-code",
  path: target,
  scope: "project",
});
await invoke("start_agent_scan", { agentId: null, rootId: root.id });
await waitScan();
await page.getByRole("button", { name: "A Agents", exact: true }).click();
await page.reload();
await page.getByRole("button", { name: "A Agents", exact: true }).click();
await page.getByRole("button", { name: "安装 Skills", exact: true }).click();
const dialog = page.getByRole("dialog", { name: "安装 Skills", exact: true });
await dialog.locator("input[type=checkbox]:checked").uncheck();
await dialog
  .locator("label")
  .filter({ hasText: "qa-agent-install" })
  .getByRole("checkbox")
  .check();
await dialog
  .locator("label")
  .filter({ hasText: target })
  .getByRole("checkbox")
  .check();
await dialog.getByRole("button", { name: "预览变更" }).click();
const confirmation = page.getByRole("dialog", { name: "确认安装与同步" });
await confirmation.getByText("备份并覆盖", { exact: true }).waitFor();
await confirmation.getByRole("button", { name: "确认执行" }).click();
await confirmation
  .getByText("已完成 1 个目录", { exact: true })
  .waitFor({ timeout: 30000 });
await page.screenshot({
  path: path.join(output, "agents-native-install-result.png"),
});
assert(
  (
    await fs.readFile(path.join(target, "qa-agent-install/SKILL.md"), "utf8")
  ).includes("Library version"),
);
await confirmation.getByRole("button", { name: "完成", exact: true }).click();
await waitScan();
await page.getByRole("button", { name: "操作记录", exact: true }).click();
await page
  .locator(".ac-history-row")
  .filter({ hasText: "qa-agent-install" })
  .first()
  .getByRole("button", { name: "恢复", exact: true })
  .click();
await page
  .getByRole("dialog", { name: "恢复安装前的内容" })
  .getByRole("button", { name: "确认恢复" })
  .click();
await page
  .getByText("已恢复安装前的内容", { exact: true })
  .waitFor({ timeout: 30000 });
assert.equal(
  await fs.readFile(path.join(target, "qa-agent-install/SKILL.md"), "utf8"),
  original,
);
report.checks.push(
  "real Tauri import, overwrite preview, install, persistent backup, restore through UI",
);
await waitScan();
await page.getByRole("button", { name: "目录", exact: true }).click();
const rootRow = page.locator(".ac-root-row").filter({ hasText: target });
await rootRow.getByRole("checkbox").uncheck();
assert.equal(
  (await invoke("get_agent_center")).roots.find((r) => r.id === root.id)
    .enabled,
  false,
);
await rootRow.getByRole("checkbox").check();
await page.getByRole("button", { name: "重新发现", exact: true }).click();
await page.getByRole("button", { name: "取消扫描", exact: true }).click();
snapshot = await waitScan();
assert(snapshot.scan.cancelled);
report.checks.push("root enable persistence, scan cancellation");
await page.screenshot({ path: path.join(output, "agents-native-roots.png") });
report.errors = errors;
assert.equal(errors.length, 0, errors.join("\n"));
await fs.writeFile(
  path.join(output, "agents-native-report.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
