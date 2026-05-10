# Master Catalog（深度调研文档总目录）

> 这是 `research/` 下所有调研产物的**唯一权威导航入口**。  
> 建议阅读方式：按“快速入口” → “推荐阅读路线” → “专题地图/项目索引”逐步深入。
>
> SOLO 预览入口（可点击导航）：[`catalog.solo.md`](computer:///sessions/69e0515f778398360dde766e/workspace/research/notes/catalog.solo.md)

## 0) 快速入口（最常用）
- 总报告：[`../report.md`](../report.md)
- 对比矩阵：[`../comparison-matrix.md`](../comparison-matrix.md)
- 版本锁定（commit/hash）：[`sources-lock.md`](sources-lock.md)
- 盲点清单（细节风险面）：[`blindspots.md`](blindspots.md)
- 盲点解决方案建议：[`blindspots-solutions.md`](blindspots-solutions.md)
- OpenSpec 调研：[`openspec.md`](openspec.md)

---

## 1) 推荐阅读路线
### 10 分钟（快速理解产出）
1) [`sources-lock.md`](sources-lock.md)
2) [`../comparison-matrix.md`](../comparison-matrix.md)
3) [`../report.md`](../report.md)

### 30 分钟（形成体系感）
1) 先读 8 个专题中的 2–3 篇（按你关注点选择）：见下方「专题地图」
2) 然后按项目进入索引：见下方「项目索引入口」
3) 最后对照「盲点清单」查漏补缺：[`blindspots.md`](blindspots.md)

### 深入（需要逐条复核证据时）
1) 先从专题文档找到 Evidence（SEC/ECO/UX/OPT/REL/DXD/PRI/EVA）  
2) 再跳到对应项目索引（projects/*.md）定位源码入口  
3) 最后回到 `sources/` 对具体文件/符号复核

---

## 2) 项目索引入口（关键文件从哪读起）
- Claude Code 索引：[`projects/claude-code.md`](projects/claude-code.md)
- OpenClaw 索引：[`projects/openclaw.md`](projects/openclaw.md)
- Hermes Agent 索引：[`projects/hermes-agent.md`](projects/hermes-agent.md)

---

## 3) 专题地图（8 篇专题）
> 所有专题都采用 Evidence ID（符号级证据）组织结构。

### 基础四专题
- 安全与权限模型（SEC）：[`../topics/security.md`](../topics/security.md)
- 扩展与生态（ECO）：[`../topics/ecosystem.md`](../topics/ecosystem.md)
- 产品与交互（UX）：[`../topics/ux.md`](../topics/ux.md)
- 优化细节（OPT）：[`../topics/optimizations.md`](../topics/optimizations.md)

### 新增四维度专题
- 版本/发布/分发（REL）：[`../topics/release.md`](../topics/release.md)
- 开发者体验与文档机制（DXD）：[`../topics/dx-docs.md`](../topics/dx-docs.md)
- 隐私/遥测/数据治理（PRI）：[`../topics/privacy-telemetry.md`](../topics/privacy-telemetry.md)
- 评测与基准体系（EVA）：[`../topics/evaluation-benchmarks.md`](../topics/evaluation-benchmarks.md)

---

## 4) 图表索引（SVG）
- 规划→执行闭环对比：[`../figures/planner-executor-sequence.svg`](../figures/planner-executor-sequence.svg)
- 三项目模块图：
  - Claude Code：[`../figures/architecture-claude-code.svg`](../figures/architecture-claude-code.svg)
  - OpenClaw：[`../figures/architecture-openclaw.svg`](../figures/architecture-openclaw.svg)
  - Hermes Agent：[`../figures/architecture-hermes-agent.svg`](../figures/architecture-hermes-agent.svg)
- 安全 Gate 对比：[`../figures/security-gates.svg`](../figures/security-gates.svg)
- 扩展生命周期对比：[`../figures/extension-lifecycle.svg`](../figures/extension-lifecycle.svg)
- 交互与执行反馈闭环：[`../figures/ux-feedback-loop.svg`](../figures/ux-feedback-loop.svg)
- 优化热点对比：[`../figures/optimization-hotspots.svg`](../figures/optimization-hotspots.svg)
- 新增四维度覆盖矩阵：[`../figures/research-release-dx-privacy-eval.svg`](../figures/research-release-dx-privacy-eval.svg)

---

## 5) 源码与证据
> 说明：部分预览器（尤其是 SOLO）对“目录链接”不稳定；此处不再提供 `../sources/` 的目录跳转。  
> 请从下列**关键入口文件**进入，或通过上方「项目索引入口」定位到更细粒度的源码证据。

### Claude Code（`research/sources/claude-code`）
- README：[`../sources/claude-code/README.md`](../sources/claude-code/README.md)
- ToolUseContext/权限枢纽：[`../sources/claude-code/src/Tool.ts`](../sources/claude-code/src/Tool.ts)
- Plan Mode：
  - [`../sources/claude-code/src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`](../sources/claude-code/src/tools/EnterPlanModeTool/EnterPlanModeTool.ts)
  - [`../sources/claude-code/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`](../sources/claude-code/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts)

### OpenClaw（`research/sources/openclaw`）
- README：[`../sources/openclaw/README.md`](../sources/openclaw/README.md)
- 总地图（边界/约束）：[`../sources/openclaw/AGENTS.md`](../sources/openclaw/AGENTS.md)
- 任务系统：
  - [`../sources/openclaw/src/tasks/task-executor.ts`](../sources/openclaw/src/tasks/task-executor.ts)
  - [`../sources/openclaw/src/tasks/task-registry.ts`](../sources/openclaw/src/tasks/task-registry.ts)
- 安全 denylist：[`../sources/openclaw/src/security/dangerous-tools.ts`](../sources/openclaw/src/security/dangerous-tools.ts)

### Hermes Agent（`research/sources/hermes-agent`）
- README：[`../sources/hermes-agent/README.md`](../sources/hermes-agent/README.md)
- Agent 主循环：[`../sources/hermes-agent/run_agent.py`](../sources/hermes-agent/run_agent.py)
- 工具注册中心：[`../sources/hermes-agent/tools/registry.py`](../sources/hermes-agent/tools/registry.py)
- Toolsets：[`../sources/hermes-agent/toolsets.py`](../sources/hermes-agent/toolsets.py)
- 审批 gate：[`../sources/hermes-agent/tools/approval.py`](../sources/hermes-agent/tools/approval.py)

### OpenSpec（`research/sources/openspec`）
- README：[`../sources/openspec/README.md`](../sources/openspec/README.md)
- Concepts：[`../sources/openspec/docs/concepts.md`](../sources/openspec/docs/concepts.md)
- OPSX：[`../sources/openspec/docs/opsx.md`](../sources/openspec/docs/opsx.md)
- 默认 schema：[`../sources/openspec/schemas/spec-driven/schema.yaml`](../sources/openspec/schemas/spec-driven/schema.yaml)
- init 实现：[`../sources/openspec/src/core/init.ts`](../sources/openspec/src/core/init.ts)
- telemetry 实现：[`../sources/openspec/src/telemetry/index.ts`](../sources/openspec/src/telemetry/index.ts)

---

## 6) 计划文档入口（可选：用于回溯调研过程）
> 这些文件位于 `.trae/documents/`，不移动，仅在 catalog 中集中可达。
- [`../../.trae/documents/2026-04-16-三项目源码深度调研计划.md`](../../.trae/documents/2026-04-16-三项目源码深度调研计划.md)
- [`../../.trae/documents/2026-04-16-三项目补充专题调研计划.md`](../../.trae/documents/2026-04-16-三项目补充专题调研计划.md)
- [`../../.trae/documents/2026-04-16-新增四维度深挖计划.md`](../../.trae/documents/2026-04-16-新增四维度深挖计划.md)
- [`../../.trae/documents/2026-04-16-研究盲点清单计划.md`](../../.trae/documents/2026-04-16-研究盲点清单计划.md)
- [`../../.trae/documents/2026-04-16-深度调研文档整理计划.md`](../../.trae/documents/2026-04-16-深度调研文档整理计划.md)
