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
assert(page);
const output = path.resolve("output/agents-ux");
await fs.mkdir(output, { recursive: true });
const report = {
  steps: [],
  screenshots: [],
  consoleErrors: [],
  picker:
    "Only native directory-picker return values are supplied as fixtures; business commands use the real Tauri backend.",
};
page.on("pageerror", (e) => report.consoleErrors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") report.consoleErrors.push(m.text());
});
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const until = async (fn, label) => {
  const start = Date.now();
  while (Date.now() - start < 45000) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`Timed out: ${label}`);
};
const waitScan = () =>
  until(
    async () => !(await invoke("get_agent_center")).scan.running,
    "scan completes",
  );
const task = async (name, fn) => {
  console.log(`CHECK ${name}`);
  const started = Date.now();
  await fn();
  report.steps.push({ name, status: "passed", ms: Date.now() - started });
  console.log(`PASS ${name}`);
};
const showAgents = async () => {
  await page.getByRole("button", { name: "A Agents", exact: true }).click();
  await until(
    () =>
      page.getByRole("button", { name: "添加技能", exact: true }).isEnabled(),
    "Agent management ready",
  );
};
const screenshot = async (name) => {
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  report.screenshots.push(`${name}.png`);
};
const row = (name) =>
  page
    .locator(".ux-skill-table tbody tr")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
const search = async (text) => {
  await page.getByRole("textbox", { name: "搜索技能", exact: true }).fill(text);
};
const refresh = async () => {
  await waitScan();
  await page.getByRole("button", { name: "刷新技能", exact: true }).click();
  await waitScan();
  await until(
    () =>
      page.getByRole("button", { name: "刷新技能", exact: true }).isVisible(),
    "refresh button returns",
  );
};
const closeDrawer = async () => {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭面板", exact: true })
    .click();
};
const fixture = path.join(output, "fixtures");
const globalRoot = path.join(fixture, "global/.claude/skills"),
  project = path.join(fixture, "project");
const projectRoot = path.join(project, ".claude/skills");
const source = path.join(fixture, "source/ux-basic"),
  localSource = path.join(fixture, "source/ux-local");
const manifest = (name, body, description = "UX acceptance fixture") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;
const writeSkill = async (dir, name, body) => {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), manifest(name, body), "utf8");
};
let root, projectRecord, basic, second;
try {
  await task(
    "isolated fixture setup and original source identity",
    async () => {
      await waitScan();
      await fs.mkdir(globalRoot, { recursive: true });
      await fs.mkdir(projectRoot, { recursive: true });
      assert(path.resolve(globalRoot).startsWith(output + path.sep));
      for (const name of ["ux-basic", "ux-local", "ux-external", "ux-second"]) {
        await fs.rm(path.join(globalRoot, name), {
          recursive: true,
          force: true,
        });
      }
      const oldSnapshot = await invoke("get_agent_center");
      for (const alias of oldSnapshot.roots.filter(
        (r) =>
          r.agentId === "codex" &&
          r.configuredPath.toLowerCase() === globalRoot.toLowerCase(),
      )) {
        await invoke("remove_discovery_root", { id: alias.id });
      }
      await writeSkill(source, "ux-basic", "version one");
      await writeSkill(localSource, "ux-local", "local body");
      basic = await invoke("import_skill_directory", { path: source });
      const other = path.join(fixture, "source/ux-second");
      await writeSkill(other, "ux-second", "second");
      second = await invoke("import_skill_directory", { path: other });
      root = await invoke("register_agent_root", {
        agentId: "claude-code",
        path: globalRoot,
        scope: "user",
      });
      projectRecord = await invoke("register_agent_root", {
        agentId: "claude-code",
        path: projectRoot,
        scope: "project",
      });
      await writeSkill(
        path.join(projectRoot, "ux-project"),
        "ux-project",
        "project only",
      );
      await invoke("save_agent_preferences", {
        preferences: {
          lastAgentId: "claude-code",
          scopes: { "claude-code": "user" },
          targets: { "claude-code:user": root.id },
          sorts: {},
        },
      });
      await invoke("start_agent_scan", {
        agentId: "claude-code",
        rootId: null,
      });
      await waitScan();
      await page.reload();
      await showAgents();
      await until(
        () =>
          page
            .locator(".ux-skill-table tbody tr")
            .count()
            .then((n) => n > 0),
        "native skills visible",
      );
      assert.equal(
        await page.locator(".ac-metrics,.ac-agent-nav,.ac-tabs").count(),
        0,
      );
    },
  );
  await task(
    "five native viewport and DPI layouts plus product assets",
    async () => {
      for (const [width, height, dpr] of [
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
          deviceScaleFactor: dpr,
          mobile: false,
        });
        const layout = await page.evaluate(() => ({
          width: innerWidth,
          body: document.body.scrollWidth,
          table: document
            .querySelector(".ux-table-scroll")
            .getBoundingClientRect()
            .toJSON(),
          overflow: [...document.querySelectorAll(".ux-agents button")]
            .filter((e) => e.offsetWidth && e.scrollWidth > e.clientWidth + 3)
            .map((e) => e.textContent),
        }));
        assert(layout.body <= width);
        assert.equal(
          layout.overflow.length,
          0,
          JSON.stringify(layout.overflow),
        );
        assert(layout.table.bottom <= height + 1);
        await screenshot(`main-${width}x${height}-${dpr}`);
        await session.detach();
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByLabel("切换 Agent", { exact: true }).click();
      await page.locator(".ux-agent-options details>summary").click();
      await until(
        () =>
          page
            .locator(".ux-agent-options img")
            .evaluateAll((images) =>
              images.every((i) => i.complete && i.naturalWidth > 0),
            ),
        "all product icons loaded",
      );
      assert.equal(
        await page
          .getByRole("option")
          .filter({ has: page.locator(".ac-product-icon") })
          .count(),
        15,
      );
      await page.keyboard.press("Escape");
    },
  );
  await task(
    "ordinary add uses current scope and automatic preview",
    async () => {
      await page.getByRole("button", { name: "添加技能", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "添加技能" });
      assert((await dialog.innerText()).includes("Claude Code · 所有项目"));
      await dialog
        .getByRole("checkbox", { name: "添加 ux-basic", exact: true })
        .check();
      const confirm = dialog.getByRole("button", {
        name: "确认添加 1 项",
        exact: true,
      });
      await until(() => confirm.isEnabled(), "automatic add preview");
      assert.equal(
        await dialog
          .getByRole("button", { name: "预览变更", exact: true })
          .count(),
        0,
      );
    await screenshot("add-auto-preview");
    for(const [width,height,dpr] of [[1024,680,1],[854,534,1.5]]) {
      const session=await page.context().newCDPSession(page);await session.send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:dpr,mobile:false});
      const bounds=await dialog.evaluate(el=>({rect:el.getBoundingClientRect().toJSON(),footer:el.querySelector('footer').getBoundingClientRect().toJSON(),overflow:[...el.querySelectorAll('button')].filter(b=>b.offsetWidth&&b.scrollWidth>b.clientWidth+3).map(b=>b.textContent)}));assert(bounds.rect.right<=width+1);assert(bounds.footer.bottom<=height+1);assert.equal(bounds.overflow.length,0,JSON.stringify(bounds.overflow));await screenshot(`add-drawer-${width}x${height}-${dpr}`);await session.detach();
    }
    await page.setViewportSize({width:1280,height:800});
      await confirm.click();
      await until(
        () =>
          page
            .getByRole("dialog")
            .count()
            .then((n) => n === 0),
        "add drawer closes",
      );
      await waitScan();
      await search("ux-basic");
      await until(
        () =>
          row("ux-basic")
            .count()
            .then((n) => n === 1),
        "added skill appears",
      );
      assert(
        (
          await fs.readFile(path.join(globalRoot, "ux-basic/SKILL.md"), "utf8")
        ).includes("version one"),
      );
    },
  );
  await task("preview race never applies an outdated selection", async () => {
    await page.getByRole("button", { name: "添加技能", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("checkbox", { name: "添加 ux-basic", exact: true })
      .check();
    await dialog
      .getByRole("checkbox", { name: "添加 ux-basic", exact: true })
      .uncheck();
    await dialog
      .getByRole("checkbox", { name: "添加 ux-second", exact: true })
      .check();
    await until(
      () =>
        dialog
          .getByRole("button", { name: "确认添加 1 项", exact: true })
          .isEnabled(),
      "latest selection preview",
    );
    await dialog.locator(".ux-plan-review summary").click();
    assert(
      (await dialog.locator(".ux-plan-review").innerText()).includes(
        "ux-second",
      ),
    );
    assert(
      !(await dialog.locator(".ux-plan-review").innerText()).includes(
        "ux-basic",
      ),
    );
    await closeDrawer();
  });
  await task("update, explicit overwrite review and undo", async () => {
    await writeSkill(source, "ux-basic", "version two");
    await invoke("import_skill_directory", { path: source });
    await refresh();
    await search("ux-basic");
    await until(
      () =>
        row("ux-basic")
          .getByRole("button", { name: "更新", exact: true })
          .isVisible(),
      "owned update is actionable",
    );
    await row("ux-basic")
      .getByRole("button", { name: "更新", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "更新技能" });
    await until(
      () =>
        dialog.getByText("查看覆盖内容与共享影响", { exact: true }).isVisible(),
      "update review ready",
    );
    assert(
      await dialog
        .getByRole("button", { name: "确认更新 1 项", exact: true })
        .isDisabled(),
    );
    await dialog.getByText("查看覆盖内容与共享影响", { exact: true }).click();
    await dialog
      .getByRole("checkbox", { name: "已查看覆盖内容与共享影响" })
      .check();
    await screenshot("update-review");
    await dialog
      .getByRole("button", { name: "确认更新 1 项", exact: true })
      .click();
    await until(
      () =>
        page
          .getByRole("dialog")
          .count()
          .then((n) => n === 0),
      "update complete",
    );
    await waitScan();
    assert(
      (
        await fs.readFile(path.join(globalRoot, "ux-basic/SKILL.md"), "utf8")
      ).includes("version two"),
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
      "undo result",
    );
    assert(
      (
        await fs.readFile(path.join(globalRoot, "ux-basic/SKILL.md"), "utf8")
      ).includes("version one"),
    );
    await closeDrawer();
    await waitScan();
  });
  await task(
    "global/project and Agent switches preserve filters but clear selection",
    async () => {
      await search("ux-basic");
      await row("ux-basic").getByRole("checkbox").check();
      const view = await invoke("get_agent_management", {
        agentId: "claude-code",
        scopeId: "user",
      });
      const scope = view.scopes.find((s) =>
        s.rootIds.includes(projectRecord.id),
      );
      await page
        .getByRole("combobox", { name: "作用范围", exact: true })
        .selectOption(scope.id);
      await until(
        () =>
          row("ux-project")
            .count()
            .then((n) => n === 1),
        "project scope",
      );
      assert.equal(await page.locator(".ux-batch").count(), 0);
      await page
        .getByRole("combobox", { name: "作用范围", exact: true })
        .selectOption("user");
      await until(
        () =>
          page
            .getByRole("textbox", { name: "搜索技能", exact: true })
            .inputValue()
            .then((v) => v === "ux-basic"),
        "search restored",
      );
      await search("");
      await page.locator(".ux-table-scroll").evaluate((e) => {
        e.scrollTop = 450;
      });
      await until(
        () =>
          page.locator(".ux-table-scroll").evaluate((e) => e.scrollTop > 200),
        "scroll fixture",
      );
      await page.getByLabel("切换 Agent", { exact: true }).click();
      await page
        .getByRole("textbox", { name: "搜索 Agent", exact: true })
        .fill("Codex");
      await page.getByRole("option").filter({ hasText: "Codex" }).click();
      await page.getByLabel("切换 Agent", { exact: true }).click();
      await page
        .getByRole("textbox", { name: "搜索 Agent", exact: true })
        .fill("Claude Code");
      await page.getByRole("option").filter({ hasText: "Claude Code" }).click();
      await until(
        () =>
          page.locator(".ux-table-scroll").evaluate((e) => e.scrollTop > 200),
        "Agent scroll restored",
      );
    },
  );
  await task(
    "external import fills metadata only in library copy",
    async () => {
      const external = path.join(globalRoot, "ux-external");
      await fs.mkdir(external, { recursive: true });
      const original =
        "---\ndescription: 外部技能验收\n---\n原始文件保持不变\n";
      await fs.writeFile(path.join(external, "SKILL.md"), original, "utf8");
      await refresh();
      await search("ux-external");
      await until(
        () =>
          row("ux-external")
            .count()
            .then((n) => n === 1),
        "external skill",
      );
      await row("ux-external")
        .getByRole("button", { name: "ux-external", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "加入技能库", exact: true })
        .click();
      await until(
        () =>
          page
            .getByRole("textbox", { name: "导入技能名称", exact: true })
            .inputValue()
            .then((v) => v === "ux-external"),
        "inferred name",
      );
      await page.getByRole("button", { name: "确认导入", exact: true }).click();
      await until(
        () =>
          page
            .getByRole("dialog")
            .count()
            .then((n) => n === 0),
        "external imported",
      );
      assert.equal(
        await fs.readFile(path.join(external, "SKILL.md"), "utf8"),
        original,
      );
    },
  );
  await task("local import continues the same add flow", async () => {
    await page.evaluate(async (path) => {
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((n) => n.includes("/src/services/agentCenterService.ts"));
      for (const url of new Set(urls)) {
        const module = await import(url);
        module.agentCenterService.pickDirectory = async () => path;
      }
    }, localSource);
    await page.getByRole("button", { name: "添加技能", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "从本地导入", exact: true })
      .click();
    await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
    await until(
      () =>
        dialog
          .getByRole("checkbox", { name: "添加 ux-local", exact: true })
          .isChecked(),
      "imported skill selected",
    );
    await until(
      () =>
        dialog
          .getByRole("button", { name: "确认添加 1 项", exact: true })
          .isEnabled(),
      "import auto preview",
    );
    await dialog
      .getByRole("button", { name: "确认添加 1 项", exact: true })
      .click();
    await until(
      () =>
        page
          .getByRole("dialog")
          .count()
          .then((n) => n === 0),
      "local add complete",
    );
    await waitScan();
    assert(await fs.stat(path.join(globalRoot, "ux-local/SKILL.md")));
  });
  await task("shared targets require review before adding", async () => {
    await invoke("register_agent_root", {
      agentId: "codex",
      path: globalRoot,
      scope: "user",
    });
    await refresh();
    await page.getByRole("button", { name: "添加技能", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("checkbox", { name: "添加 ux-second", exact: true })
      .check();
    await until(
      () =>
        dialog.getByText("查看覆盖内容与共享影响", { exact: true }).isVisible(),
      "shared review",
    );
    assert(
      await dialog
        .getByRole("button", { name: "确认添加 1 项", exact: true })
        .isDisabled(),
    );
    await dialog.getByText("查看覆盖内容与共享影响", { exact: true }).click();
    assert((await dialog.innerText()).includes("Codex"));
    await closeDrawer();
  });
  await task(
    "Skills and workflow navigation retain selected content",
    async () => {
      await page.getByRole("button", { name: "S Skills", exact: true }).click();
      await page
        .getByRole("button")
        .filter({ has: page.getByText("ux-basic", { exact: true }) })
        .first()
        .click();
      await page
        .getByRole("button", { name: "添加到 Agent", exact: true })
        .click();
      await until(
        () =>
          page
            .getByRole("dialog")
            .getByRole("checkbox", { name: "添加 ux-basic", exact: true })
            .isChecked(),
        "Skills selection carried",
      );
      await closeDrawer();
      await invoke("upsert_bundle", {
        draft: {
          id: null,
          name: `UX 组合 ${Date.now()}`,
          description: "acceptance",
          items: [
            { skillId: basic.skill.id, mode: "required" },
            { skillId: second.skill.id, mode: "required" },
          ],
        },
      });
      await page.getByRole("button", { name: "W 工作流", exact: true }).click();
      await page
        .getByRole("button", { name: "添加到 Agent", exact: true })
        .click();
      await until(
        () =>
          page
            .getByRole("dialog")
            .getByRole("checkbox", { name: "添加 ux-second", exact: true })
            .isChecked(),
        "workflow selection carried",
      );
      await closeDrawer();
    },
  );
  await task("keyboard drawer close and context return", async () => {
    await search("ux-basic");
    const trigger = row("ux-basic").getByRole("button", {
      name: "ux-basic",
      exact: true,
    });
    await trigger.click();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert(await trigger.evaluate((el) => document.activeElement === el));
  });
  await task(
    "inspection, directory preference and history remain reachable",
    async () => {
      await page.getByLabel("更多操作", { exact: true }).click();
      await page
        .getByRole("menuitem", { name: "管理目录", exact: true })
        .click();
      await until(
        () =>
          page
            .getByRole("combobox", { name: "默认保存位置", exact: true })
            .inputValue()
            .then((v) => v === root.id),
        "remembered location",
      );
      await screenshot("directory-drawer");
      await closeDrawer();
      await page.getByLabel("更多操作", { exact: true }).click();
      await page
        .getByRole("menuitem", { name: "操作记录", exact: true })
        .click();
      await until(
        () =>
          page
            .locator(".ux-operation")
            .count()
            .then((n) => n > 0),
        "history",
      );
      await screenshot("history-drawer");
      await closeDrawer();
    },
  );
  await search("");
  await screenshot("final-main");
  assert.equal(report.consoleErrors.length, 0, report.consoleErrors.join("\n"));
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  await screenshot("failure").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  await browser.close();
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.steps.length,
      errors: report.consoleErrors.length,
      report: path.join(output, "report.json"),
    }),
  );
}
