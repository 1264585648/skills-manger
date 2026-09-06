# skills-manger

桌面端 Skills 分组、组合、维护与多 Agent 分发工具。

当前产品定义为一个 **local-first Skills Control Center**：统一发现本机 Skill 与 Agent，在 Canonical Library 中管理 Skill、Group、Bundle、版本和关系，再通过 Agent Adapter 安全同步到不同目标环境。

## UI 原型

- [高保真交互原型](docs/ui/index.html)

当前 UI 基线覆盖 5 个核心页面：Skills、Bundles、Agents、Sync、Settings。设计方向强调 **简单、有设计感、桌面工具感**，避免传统后台管理系统的信息堆积；原型保留页面切换、搜索、选中、冲突处理、来源选择与设置开关等基础交互。

## 技术方案

- [人类阅读版技术方案](docs/technical-solution.html)
- [结构化方案源 `solution.json`](docs/solution.json)

方案按 `human-read-tech-html` 的设计方式组织，重点覆盖：

- 5 个一级页面：Skills、Groups & Bundles、Agents、Sync、Settings；
- Agent / Skill Discovery；
- Canonical Library 与 SkillInstance 分离；
- Group 与 Bundle 的职责边界；
- Agent Adapter + Capability Matrix；
- Sync Plan、Diff、Snapshot、Atomic Apply、Verify、Rollback；
- Upstream Update、Local Modified、Target Drift、Conflict、Unmanaged、Missing；
- Git Source、Watcher/Reconcile、安全与文件系统边界；
- V1 开发拆分与验收标准。

## V1 核心原则

1. **Discovery ≠ Adopt**：发现 Skill 不代表自动接管。
2. **Sync ≠ Overwrite**：所有写入先生成 Sync Plan。
3. **Agent Directory ≠ Source of Truth**：Canonical Library 是 desired state。
4. **Group 只分类，Bundle 才表达部署组合。**
5. **不同 Agent 通过 Capability 声明能力，不假设都是本地目录复制。**
6. **扫描与同步阶段绝不执行第三方 Skill 内 scripts。**

## 当前状态

技术方案与高保真 UI 原型已完成，可进入 M1：Library + UI 项目骨架实现，并以 `docs/ui/index.html` 作为视觉与交互基线。