import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
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
assert(page);
const output = path.resolve("output/agents-ux"),
  fixture = path.join(output, "fixtures"),
  target = path.join(fixture, "global/.claude/skills");
const report = {
  steps: [],
  consoleErrors: [],
  faultInjection:
    "Only deliberate timing/refresh failures are injected at the client service boundary. File operations and normal responses use real Tauri commands.",
};
page.on("pageerror", (e) => report.consoleErrors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") report.consoleErrors.push(m.text());
});
const invoke = (cmd, args = {}) =>
  page.evaluate(
    ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
    { cmd, args },
  );
const until = async (fn, name) => {
  const start = Date.now();
  while (Date.now() - start < 45000) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`Timeout: ${name}`);
};
const waitScan = () =>
  until(async () => !(await invoke("get_agent_center")).scan.running, "scan");
let step = 0;
const task = async (name, fn) => {
  if (++step < Number(process.argv[4] ?? 1)) return;
  console.log(`CHECK ${name}`);
  await fn();
  report.steps.push({ name, status: "passed" });
  console.log(`PASS ${name}`);
};
const close = () =>
  page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭面板", exact: true })
    .click();
const row = (name) =>
  page
    .locator(".ux-skill-table tbody tr")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
const refresh = async () => {
  await waitScan();
  await page.getByRole("button", { name: "刷新技能", exact: true }).click();
  await waitScan();
  await until(
    () =>
      page.getByRole("button", { name: "刷新技能", exact: true }).isVisible(),
    "refresh ready",
  );
};
const search = (value) =>
  page.getByRole("textbox", { name: "搜索技能", exact: true }).fill(value);
const choose = async (name) => {
  await page.getByLabel("切换 Agent", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索 Agent", exact: true })
    .fill(name);
  await page
    .getByRole("option")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
};
const review = async (dialog) => {
  await until(
    () =>
      dialog.getByText("查看覆盖内容与共享影响", { exact: true }).isVisible(),
    "review",
  );
  await dialog.getByText("查看覆盖内容与共享影响", { exact: true }).click();
  await dialog
    .getByRole("checkbox", { name: "已查看覆盖内容与共享影响", exact: true })
    .check();
};
try {
  await page.reload();
  await page.getByRole("button", { name: "A Agents", exact: true }).click();
  await page.locator('.ux-agent-picker h1').waitFor();
  if(await page.locator('.ux-agent-picker h1').innerText()!=='Claude Code')await choose('Claude Code');
  await waitScan();
  await until(
    () =>
      page.getByRole("button", { name: "添加技能", exact: true }).isEnabled(),
    "ready",
  );
  const base = await invoke("get_agent_center");
  const root = base.roots.find(
    (r) =>
      r.agentId === "claude-code" &&
      r.configuredPath.toLowerCase() === target.toLowerCase(),
  );
  assert(root);
  await task(
    "unavailable Agent keeps its context and exposes setup instead of a healthy empty list",
    async () => {
      const absent = base.catalog.find(
        (a) =>
          base.detections[a.id]?.status !== "installed" &&
          !base.roots.some((r) => r.agentId === a.id && r.canonicalPath),
      );
      assert(absent);
      await choose(absent.name);
      await page
        .getByRole("heading", { name: "还没有发现这个 Agent" })
        .waitFor();
      assert(
        await page
          .getByRole("button", { name: "选择保存位置", exact: true })
          .isVisible(),
      );
      await until(
        async () =>
          (await invoke("get_agent_preferences")).lastAgentId === absent.id,
        "last Agent saved",
      );
      await page.reload();
      await page.getByRole("button", { name: "A Agents", exact: true }).click();
      await page
        .getByRole("heading", { name: "还没有发现这个 Agent" })
        .waitFor();
      assert.equal(
        await page.locator(".ux-agent-picker h1").innerText(),
        absent.name,
      );
      await choose("Claude Code");
    },
  );
  await task(
    "ambiguous locations require one explicit choice and remember it",
    async () => {
      const view = await invoke("get_agent_management", {
        agentId: "claude-code",
        scopeId: "user",
      });
      const disabled = base.roots.filter(
        (r) =>
          r.agentId === "claude-code" &&
          r.scope === "user" &&
          r.enabled &&
          r.id !== root.id,
      );
      for (const r of disabled)
        await invoke("set_agent_root_enabled", { id: r.id, enabled: false });
      const alternative = path.join(fixture, "alternative/.claude/skills");
      await fs.mkdir(alternative, { recursive: true });
      await invoke("register_agent_root", {
        agentId: "claude-code",
        path: alternative,
        scope: "user",
      });
      const prefs = await invoke("get_agent_preferences");
      delete prefs.targets["claude-code:user"];
      await invoke("save_agent_preferences", { preferences: prefs });
      await page.reload();
      await page.getByRole("button", { name: "A Agents", exact: true }).click();
      await page.getByRole("button", { name: "添加技能", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await until(
        () =>
          dialog
            .getByRole("combobox", { name: "保存位置", exact: true })
            .isVisible(),
        "ambiguous chooser",
      );
      assert.equal(
        await dialog
          .getByRole("combobox", { name: "保存位置", exact: true })
          .inputValue(),
        "",
      );
      await dialog
        .getByRole("combobox", { name: "保存位置", exact: true })
        .selectOption(root.id);
      await until(
        async () =>
          (await invoke("get_agent_preferences")).targets[
            "claude-code:user"
          ] === root.id,
        "location remembered",
      );
      await close();
      for (const r of disabled)
        await invoke("set_agent_root_enabled", { id: r.id, enabled: true });
      await refresh();
    },
  );
  await task(
    "stale preview retains selection and requires a fresh review",
    async () => {
      await search("ux-basic");
      await until(
        () =>
          row("ux-basic")
            .getByRole("button", { name: "更新", exact: true })
            .isVisible(),
        "update available",
      );
      await row("ux-basic")
        .getByRole("button", { name: "更新", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await review(dialog);
      await fs.appendFile(
        path.join(target, "ux-basic/SKILL.md"),
        "\nManual change after preview\n",
      );
      await dialog
        .getByRole("button", { name: "确认更新 1 项", exact: true })
        .click();
      await until(
        () =>
          dialog
            .getByRole("alert")
            .innerText()
            .then((t) => t.includes("内容已变化")),
        "stale error",
      );
      assert(await dialog.getByText("ux-basic", { exact: true }).isVisible());
      await dialog.getByRole("button", { name: "重试", exact: true }).click();
      await until(
        () =>
          dialog
            .getByText("查看覆盖内容与共享影响", { exact: true })
            .isVisible(),
        "fresh plan",
      );
      assert(
        await dialog
          .getByRole("button", { name: "确认更新 1 项", exact: true })
          .isDisabled(),
      );
      await review(dialog);
      await dialog
        .getByRole("button", { name: "确认更新 1 项", exact: true })
        .click();
      await until(
        () =>
          page
            .getByRole("dialog")
            .count()
            .then((n) => n === 0),
        "updated",
      );
      await waitScan();
      assert(
        (
          await fs.readFile(path.join(target, "ux-basic/SKILL.md"), "utf8")
        ).includes("version two"),
      );
    },
  );
  await task(
    "execution cannot close or double-submit; refresh failure does not report failed deployment",
    async () => {
      const name = `ux-delay-${Date.now()}`;
      const source = path.join(fixture, "source", name);
      await fs.mkdir(source, { recursive: true });
      await fs.writeFile(
        path.join(source, "SKILL.md"),
        `---\nname: ${name}\ndescription: delayed execution fixture\n---\nactual backend write\n`,
        "utf8",
      );
      await invoke("import_skill_directory", { path: source });
      await page.evaluate(async () => {
        window.__qaApplyCount = 0;
        window.__qaFailRefresh = true;
        window.__qaServiceRestores = [];
        const urls = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((n) => n.includes("/src/services/agentCenterService.ts"));
        const seen = new Set();
        for (const url of new Set(urls)) {
          const { agentCenterService: s } = await import(url);
          if (seen.has(s)) continue;
          seen.add(s);
          const apply = s.apply,
            scan = s.scan;
          window.__qaServiceRestores.push(() => {
            s.apply = apply;
            s.scan = scan;
          });
          s.apply = async (...args) => {
            window.__qaApplyCount++;
            await new Promise((r) => setTimeout(r, 800));
            return apply(...args);
          };
          s.scan = async (...args) => {
            if (window.__qaFailRefresh) {
              window.__qaFailRefresh = false;
              throw new Error("验收注入：刷新失败");
            }
            return scan(...args);
          };
        }
      });
      await page.getByRole("button", { name: "添加技能", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("checkbox", { name: `添加 ${name}`, exact: true })
        .check();
      await review(dialog);
      await dialog
        .getByRole("button", { name: "确认添加 1 项", exact: true })
        .dblclick();
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").count(), 1);
      assert(
        await dialog
          .getByRole("button", { name: "关闭面板", exact: true })
          .isDisabled(),
      );
      await until(
        () =>
          page
            .getByText("已完成 1 项技能变更，列表刷新失败", { exact: true })
            .isVisible(),
        "separate refresh failure",
      );
      assert.equal(await page.evaluate(() => window.__qaApplyCount), 1);
      assert(await fs.stat(path.join(target, name, "SKILL.md")));
      await page.getByRole("button", { name: "重试刷新", exact: true }).click();
      await waitScan();
      await search(name);
      await until(
        () =>
          row(name)
            .count()
            .then((n) => n === 1),
        "retry refresh reveals installed skill",
      );
      await page.evaluate(() =>
        window.__qaServiceRestores.forEach((fn) => fn()),
      );
    },
  );
  await task(
    "invalid links have local handling and disappear after repair",
    async () => {
      const link = path.join(target, "ux-broken");
      assert(path.resolve(link).startsWith(output + path.sep));
      await fs.rm(link, { recursive: true, force: true });
      await fs.symlink(path.join(fixture, "missing-target"), link, "junction");
      await refresh();
      await search("ux-broken");
      await until(
        () =>
          row("ux-broken")
            .count()
            .then((n) => n === 1),
        "broken link visible",
      );
      await row("ux-broken")
        .getByRole("button", { name: "处理", exact: true })
        .click();
      assert((await page.getByRole("dialog").innerText()).includes("需要处理"));
      assert(
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "定位入口", exact: true })
          .isVisible(),
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "定位入口", exact: true })
        .click();
      await until(
        () =>
          page
            .getByRole("dialog")
            .getByRole("button", { name: "关闭面板", exact: true })
            .isEnabled(),
        "entry location opened",
      );
      await close();
      await fs.rm(link, { recursive: true, force: true });
      await refresh();
      await until(
        () =>
          row("ux-broken")
            .count()
            .then((n) => n === 0),
        "repaired link removed",
      );
      assert(
        await page
          .getByRole("heading", { name: "没有匹配的技能", exact: true })
          .isVisible(),
      );
      await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    },
  );
  await task(
    "advanced update retains Agent scope and target and returns without reselection",
    async () => {
      const source = path.join(fixture, "source/ux-basic");
      await fs.appendFile(path.join(source, "SKILL.md"), "\nversion three\n");
      await invoke("import_skill_directory", { path: source });
      await refresh();
      await search("ux-basic");
      await row("ux-basic")
        .getByRole("button", { name: "ux-basic", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "前往环境更新", exact: true })
        .click();
      await until(
        () =>
          page
            .getByRole("button", { name: "生成计划", exact: true })
            .isEnabled(),
        "advanced context",
      );
      assert(
        (await page.locator(".sync-context").innerText()).includes(
          "已选择 1 个技能",
        ),
      );
      await page.getByRole("button", { name: "生成计划", exact: true }).click();
      await until(
        () =>
          page
            .locator(".sync-list")
            .innerText()
            .then((t) => t.includes("ux-basic")),
        "advanced plan",
      );
      await page
        .getByRole("button", { name: "返回 Agent", exact: true })
        .click();
      await until(
        () =>
          page
            .getByRole("textbox", { name: "搜索技能", exact: true })
            .inputValue()
            .then((v) => v === "ux-basic"),
        "Agent search restored",
      );
    },
  );
  await task(
    "directory toggles, scan cancel and preference reload remain functional",
    async () => {
      await waitScan();
      await page.getByLabel("更多操作", { exact: true }).click();
      await page
        .getByRole("menuitem", { name: "管理目录", exact: true })
        .click();
      const toggle = page
        .getByRole("dialog")
        .getByRole("checkbox", { name: `扫描 ${target}`, exact: true });
      await toggle.uncheck();
      await until(
        async () =>
          (await invoke("get_agent_center")).roots.find((r) => r.id === root.id)
            .enabled === false,
        "disabled persisted",
      );
      await toggle.check();
      await close();
      await page.getByRole("button", { name: "刷新技能", exact: true }).click();
      await page.getByRole("button", { name: "取消检查", exact: true }).click();
      await waitScan();
      assert((await invoke("get_agent_center")).scan.cancelled);
      await page.reload();
      await page.getByRole("button", { name: "A Agents", exact: true }).click();
      await until(
        () =>
          page
            .locator(".ux-agent-picker h1")
            .innerText()
            .then((t) => t === "Claude Code"),
        "context restored",
      );
    },
  );
  await task('unavailable project keeps its scope and prevents fallback writes',async()=>{
    const project=await fs.mkdtemp(path.join(os.tmpdir(),'agents-ux-project-')),offline=`${project}-offline`;assert(project.startsWith(path.resolve(os.tmpdir())+path.sep)&&offline.startsWith(path.resolve(os.tmpdir())+path.sep));
    const directory=path.join(project,'.claude/skills');await fs.mkdir(directory,{recursive:true});const registered=await invoke('register_agent_root',{agentId:'claude-code',path:directory,scope:'project'});await refresh();const view=await invoke('get_agent_management',{agentId:'claude-code',scopeId:'user'});const scope=view.scopes.find(s=>s.rootIds.includes(registered.id));assert(scope);await fs.rename(project,offline);
    try{await page.getByRole('combobox',{name:'作用范围',exact:true}).selectOption(scope.id);await until(()=>page.getByText('原项目当前不可用，已保留上次结果',{exact:true}).isVisible(),'unavailable project notice');assert(await page.getByRole('button',{name:'添加技能',exact:true}).isDisabled());assert.equal(await page.getByRole('combobox',{name:'作用范围',exact:true}).inputValue(),scope.id);assert.equal((await invoke('get_agent_management',{agentId:'claude-code',scopeId:scope.id})).targets.length,0);}finally{await fs.rename(offline,project);await page.getByRole('combobox',{name:'作用范围',exact:true}).selectOption('user');await invoke('remove_discovery_root',{id:registered.id});await fs.rm(project,{recursive:true,force:true});}
  });
  await task('readonly plugin skills have no update action',async()=>{
    const view=await invoke('get_agent_management',{agentId:'claude-code',scopeId:'user'});const skill=view.skills.find(s=>s.readonly);assert(skill);await search(skill.name);await page.locator(`[data-skill-id="${skill.id}"]`).locator('.ux-skill-title').click();assert((await page.getByRole('dialog').innerText()).includes('仅供查看'));assert.equal(await page.getByRole('dialog').getByRole('button',{name:'从技能库更新',exact:true}).count(),0);await close();
  });
  await task(
    "update all handles multiple copies and restores the entire operation",
    async () => {
      const name = "ux-multi";
      const source = path.join(fixture, "source", name);
      await fs.mkdir(source, { recursive: true });
      const document = (version) =>
        `---\nname: ${name}\ndescription: multiple-copy fixture\n---\n${version}\n`;
      await fs.writeFile(path.join(source, "SKILL.md"), document("v1"), "utf8");
      const imported = await invoke("import_skill_directory", { path: source });
      for (const folder of ["copy-a", "copy-b"]) {
        const destination = path.join(target, folder, name);
        await fs.mkdir(destination, { recursive: true });
        await fs.writeFile(
          path.join(destination, "SKILL.md"),
          document("v1"),
          "utf8",
        );
      }
      await refresh();
      let view = await invoke("get_agent_management", {
        agentId: "claude-code",
        scopeId: "user",
      });
      for (const skill of view.skills.filter((s) => s.name === name))
        await invoke("bind_agent_skill", {
          instanceId: skill.instanceIds[0],
          libraryId: imported.skill.id,
        });
      await fs.writeFile(path.join(source, "SKILL.md"), document("v2"), "utf8");
      await invoke("import_skill_directory", { path: source });
      await refresh();
      await search(name);
      await page.getByRole("button", { name: /^有更新/ }).click();
      await until(
        () =>
          row(name)
            .count()
            .then((n) => n === 2),
        "two copies visible",
      );
      await page.getByRole("button", { name: "更新全部", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await review(dialog);
      assert((await dialog.innerText()).includes("copy-a"));
      assert((await dialog.innerText()).includes("copy-b"));
      await dialog
        .getByRole("button", { name: "确认更新 2 项", exact: true })
        .click();
      await until(
        () =>
          page
            .getByRole("dialog")
            .count()
            .then((n) => n === 0),
        "batch updated",
      );
      await waitScan();
      for (const folder of ["copy-a", "copy-b"])
        assert(
          (
            await fs.readFile(
              path.join(target, folder, name, "SKILL.md"),
              "utf8",
            )
          ).includes("v2"),
        );
      await page
        .getByRole("button", { name: "撤销本次变更", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认恢复", exact: true })
        .click();
      await until(
        () => page.getByText("已恢复安装前的内容", { exact: true }).isVisible(),
        "batch restored",
      );
      for (const folder of ["copy-a", "copy-b"])
        assert(
          (
            await fs.readFile(
              path.join(target, folder, name, "SKILL.md"),
              "utf8",
            )
          ).includes("v1"),
        );
      await close();
    },
  );
  assert.equal(report.consoleErrors.length, 0, report.consoleErrors.join("\n"));
  report.status = "passed";
  await page.screenshot({ path: path.join(output, "faults-final.png") });
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  process.exitCode = 1;
  console.error(error);
  await page
    .screenshot({ path: path.join(output, "fault-failure.png") })
    .catch(() => {});
} finally {
  await fs.writeFile(
    path.join(output, "fault-report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  await browser.close();
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.steps.length,
      errors: report.consoleErrors.length,
    }),
  );
}
