/**
 * UI 验收脚本 —— 对照 docs/ACCEPTANCE.md 自动判定 11 条标准。
 *
 *   node scripts/audit-ui.mjs
 *
 * 退出码 0 = 自动项全部通过；1 = 有 FAIL。
 * 脚本末尾会打印需要人工判定的清单。
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");

const results = [];
const pass = (id, title) => results.push({ id, title, ok: true, detail: "" });
const fail = (id, title, detail) => results.push({ id, title, ok: false, detail });

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const sourceFiles = walk(SRC).filter((f) => /\.(ts|tsx|css)$/.test(f));
const cssFiles = sourceFiles.filter((f) => f.endsWith(".css"));

// ---------------------------------------------------------------- A1 单页
{
  const pages = readdirSync(join(SRC, "pages")).filter((f) => f.endsWith(".tsx"));
  if (pages.length === 1) pass("A1", "单页结构（pages 目录下仅 1 个页面）");
  else fail("A1", "单页结构", `发现 ${pages.length} 个页面：${pages.join(", ")}`);
}

// ---------------------------------------------------------------- 字号扫描
const fontSizes = [];
for (const file of cssFiles) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/font-size:\s*([0-9.]+)px/g)) {
    fontSizes.push({ file: relative(ROOT, file), size: parseFloat(match[1]) });
  }
}
{
  const tooSmall = fontSizes.filter((f) => f.size < 12);
  if (tooSmall.length === 0) pass("B1", "无小于 12px 的字号", "");
  else
    fail(
      "B1",
      "无小于 12px 的字号",
      tooSmall.map((f) => `${f.file}:${f.size}px`).join(" | "),
    );
}
{
  const bodyRule = cssFiles
    .map((f) => readFileSync(f, "utf8"))
    .join("\n")
    .match(/body\s*\{[^}]*font-size:\s*([0-9.]+)px/);
  const size = bodyRule ? parseFloat(bodyRule[1]) : 0;
  if (size >= 13) pass("B2", `正文字号 ${size}px ≥ 13px`);
  else fail("B2", "正文字号 ≥ 13px", `body font-size = ${size || "未设置"}px`);

  const h2 = cssFiles
    .map((f) => readFileSync(f, "utf8"))
    .join("\n")
    .match(/\.detail-head h2\s*\{[^}]*font-size:\s*([0-9.]+)px/);
  const titleSize = h2 ? parseFloat(h2[1]) : 0;
  if (titleSize >= 17) pass("B2b", `标题字号 ${titleSize}px ≥ 17px`);
  else fail("B2b", "页面标题 ≥ 17px", `detail-head h2 = ${titleSize || "未设置"}px`);
}
{
  const buckets = [...new Set(fontSizes.map((f) => f.size))].sort((a, b) => a - b);
  if (buckets.length <= 5) pass("B6", `字号档位 ${buckets.length} 档（≤5）：${buckets.join("/")}`);
  else fail("B6", "字号档位 ≤ 5", `实际 ${buckets.length} 档：${buckets.join("/")}`);
}

// ---------------------------------------------------------------- 对比度
const rootCss = cssFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const vars = {};
for (const match of rootCss.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
  vars[`--${match[1]}`] = match[2];
}
const luminance = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
{
  // 正文类 token 必须达到 4.5:1（白底与浅灰底都要过）
  const combos = [
    ["--text", "--surface", 4.5],
    ["--text-2", "--surface", 4.5],
    ["--muted", "--surface", 4.5],
    ["--muted", "--surface-2", 4.5],
    ["--green", "--green-soft", 4.5],
    ["--amber", "--amber-soft", 4.5],
    ["--red", "--red-soft", 4.5],
    ["--accent", "--accent-soft", 4.5],
  ];
  const bad = [];
  for (const [fg, bg, min] of combos) {
    if (!vars[fg] || !vars[bg]) {
      bad.push(`${fg}/${bg} 变量缺失`);
      continue;
    }
    const ratio = contrast(vars[fg], vars[bg]);
    if (ratio < min) bad.push(`${fg} on ${bg} = ${ratio.toFixed(2)}:1 (<${min})`);
  }
  if (bad.length === 0) pass("B3", "正文/状态色对比度全部 ≥ 4.5:1");
  else fail("B3", "对比度 ≥ 4.5:1", bad.join(" | "));

  // --faint 只允许装饰用途：统计使用处，超过 4 处就提醒
  const faintUses = (rootCss.match(/var\(--faint\)/g) ?? []).length;
  if (faintUses <= 4) pass("B3b", `--faint 仅 ${faintUses} 处（装饰用途）`);
  else fail("B3b", "--faint 仅用于装饰（≤4 处）", `实际 ${faintUses} 处，检查是否用于正文`);
}

// ---------------------------------------------------------------- B4 首字符头像
{
  const hits = [];
  for (const file of sourceFiles) {
    const text = readFileSync(file, "utf8");
    if (/cardGlyph|glyph/i.test(text)) hits.push(relative(ROOT, file));
  }
  if (hits.length === 0) pass("B4", "无首字符头像");
  else fail("B4", "无首字符头像", `残留引用：${hits.join(", ")}`);
}

// ---------------------------------------------------------------- B9 行高
{
  const css = rootCss;
  const rowRule = css.match(/\.skill-row\s*\{[^}]*\}/)?.[0] ?? "";
  const padding = rowRule.match(/padding:\s*([0-9.]+)px/g);
  if (padding && padding.length) {
    const v = parseFloat(padding[0].match(/([0-9.]+)/)[1]);
    if (v * 2 + 20 >= 36) pass("B9", `列表行垂直内边距 ${v}px（行高充足）`);
    else fail("B9", "列表行高 ≥ 36px", `padding ${v}px 过小`);
  } else fail("B9", "列表行高 ≥ 36px", "未找到 .skill-row 的 padding");
}

// ---------------------------------------------------------------- C3 文件行数
{
  const big = sourceFiles
    .map((f) => ({ file: relative(ROOT, f), lines: readFileSync(f, "utf8").split("\n").length }))
    .filter((f) => f.lines > 400);
  if (big.length === 0) pass("C3", "所有源文件 ≤ 400 行");
  else fail("C3", "单文件 ≤ 400 行", big.map((f) => `${f.file}:${f.lines}`).join(" | "));
}

// ---------------------------------------------------------------- C1/C2 编译
const run = (cmd) => {
  try {
    return { ok: true, out: execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
};
{
  const tsc = run("node_modules\\.bin\\tsc.cmd --noEmit");
  if (tsc.ok) pass("C1", "tsc --noEmit 0 报错");
  else fail("C1", "tsc --noEmit", (tsc.out || "").trim().split("\n").slice(0, 6).join(" "));
}
{
  // C4：未使用的 import / 死变量。tsconfig 默认不开 noUnused*，验收时单独开一次。
  const unused = run("node_modules\\.bin\\tsc.cmd --noEmit --noUnusedLocals --noUnusedParameters");
  if (unused.ok) pass("C4", "无未使用的 import / 局部变量");
  else fail("C4", "无未使用的 import", (unused.out || "").trim().split("\n").slice(0, 6).join(" "));
}
{
  const build = run("node_modules\\.bin\\vite.cmd build");
  if (build.ok) pass("C2", "vite build 成功");
  else fail("C2", "vite build", (build.out || "").trim().split("\n").slice(0, 6).join(" "));
}

// ---------------------------------------------------------------- C8 class 名漂移
{
  // tsx 里引用的 class 必须在 CSS 里有定义 —— 防止组件改了 DOM 而样式没跟上。
  const defined = new Set();
  for (const match of rootCss.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) defined.add(match[1]);
  const missing = new Map();
  for (const file of sourceFiles.filter((f) => f.endsWith(".tsx"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{\s*"([^"]*)")/g)) {
      const raw = (match[1] ?? match[2] ?? match[3] ?? "")
        .replace(/\$\{[^}]*\}/g, " ")
        .replace(/[?:]/g, " ");
      for (const name of raw.split(/\s+/).filter(Boolean)) {
        if (name.endsWith("-")) continue; // 动态拼接残留，如 status-${tone}
        if (!defined.has(name) && !missing.has(name)) {
          missing.set(name, relative(ROOT, file));
        }
      }
    }
  }
  if (missing.size === 0) pass("C8", "所有 className 在 CSS 中均有定义");
  else
    fail(
      "C8",
      "className 无样式定义",
      [...missing].map(([name, file]) => `${name}（${file}）`).join(" | "),
    );
}

// ---------------------------------------------------------------- 输出
const failed = results.filter((r) => !r.ok);
console.log("=== Skills Control Center · UI 验收 ===");
console.log(`自动判定 ${results.length} 项 · 通过 ${results.length - failed.length} · 失败 ${failed.length}\n`);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id.padEnd(4)} ${r.title}${r.detail ? `\n        → ${r.detail}` : ""}`);
}
console.log(`
=== 人工判定清单（docs/ACCEPTANCE.md） ===
A2  切换选中项不触发任何重新加载
A3  分发区同一 Agent 只出现一行
A4  Agent 行三态：已装 / 可安装 / 已就绪
A5  批量加标签 / 归组 / 写回均可用
A6  视图筛选与「仅项目」「分组筛选」可任意组合
A7  异常档 chip 带计数与色彩提示，点击直达
A9  装/卸开关与批量操作后右下角出现 toast 反馈并自动消失
A10 分组筛选可选「未分组」与任一分组，分组删除后筛选自动复位
A8  简介失焦自动保存
B5  彩色 pill 仅用于异常状态（每屏 ≤ 6 个）
B7  选中 / hover / focus 三态可区分
B8  900px 高度下分发开关无需滚动可见
C5  写操作有 busy 保护，连点不重复
C6  破坏性操作有后果说明
C7  空态 / 加载态 / 错误态齐全
D1  / 聚焦搜索，Esc 失焦
D2  ↑↓ 移动选中项
D3  批量操作有可见反馈并自动消失
D4  「装到某 Agent」≤ 3 次点击
D5  列表项直接可见「已装 N / 未分发」
D6  重新扫描不白屏（保留旧列表）
`);
process.exit(failed.length ? 1 : 0);
