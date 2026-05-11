# Master Catalog（SOLO 专用：可点击导航）

> 说明：此文件专供 **SOLO 预览**使用，所有链接均为 `computer://` 绝对路径，避免相对链接失效。  
> 通用（相对链接）版本见：`catalog.md`。

## 0) 快速入口（最常用）
- 总报告：[research/report.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/report.md)
- 对比矩阵：[research/comparison-matrix.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/comparison-matrix.md)
- 版本锁定（commit/hash）：[research/notes/sources-lock.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/notes/sources-lock.md)
- 盲点清单：[research/notes/blindspots.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/notes/blindspots.md)
- 盲点解决方案建议：[research/notes/blindspots-solutions.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/notes/blindspots-solutions.md)
- OpenSpec 调研：[research/notes/openspec.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/notes/openspec.md)

---

## 1) 推荐阅读路线
### 10 分钟
1) [sources-lock.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/notes/sources-lock.md)
2) [comparison-matrix.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/comparison-matrix.md)
3) [report.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/report.md)

### 深入
1) 先读专题（见「专题地图」）定位 Evidence（SEC/ECO/UX/OPT/REL/DXD/PRI/EVA）  
2) 再读项目索引（见「项目索引入口」）定位源码入口  
3) 最后按“源码关键入口文件”直链复核（见「源码与证据」）

---

## 2) 项目索引入口（关键文件从哪读起）
- Claude Code 索引：[notes/projects/claude-code.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/notes/projects/claude-code.md)
- OpenClaw 索引：[notes/projects/openclaw.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/notes/projects/openclaw.md)
- Hermes Agent 索引：[notes/projects/hermes-agent.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/notes/projects/hermes-agent.md)

---

## 3) 专题地图（8 篇专题）
### 基础四专题
- 安全与权限模型（SEC）：[topics/security.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/topics/security.md)
- 扩展与生态（ECO）：[topics/ecosystem.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/topics/ecosystem.md)
- 产品与交互（UX）：[topics/ux.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/topics/ux.md)
- 优化细节（OPT）：[topics/optimizations.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/topics/optimizations.md)

### 新增四维度专题
- 版本/发布/分发（REL）：[topics/release.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/topics/release.md)
- 开发者体验与文档机制（DXD）：[topics/dx-docs.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/topics/dx-docs.md)
- 隐私/遥测/数据治理（PRI）：[topics/privacy-telemetry.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/topics/privacy-telemetry.md)
- 评测与基准体系（EVA）：[topics/evaluation-benchmarks.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/topics/evaluation-benchmarks.md)

---

## 4) 图表索引（SVG）
- 规划→执行闭环对比：[planner-executor-sequence.svg](computer:///sessions/69e0515f778398360dde766e/workspace/research/figures/planner-executor-sequence.svg)
- 三项目模块图：
  - Claude Code：[architecture-claude-code.svg](computer:///sessions/69e0515f778398360dde766e/workspace/research/figures/architecture-claude-code.svg)
  - OpenClaw：[architecture-openclaw.svg](computer:///sessions/69e0515f778398360dde766e/workspace/research/figures/architecture-openclaw.svg)
  - Hermes Agent：[architecture-hermes-agent.svg](computer:///sessions/69e0515f778398360dde766e/workspace/research/figures/architecture-hermes-agent.svg)
- 安全 Gate 对比：[security-gates.svg](computer:///sessions/69e0515f778398360dde766e/workspace/research/figures/security-gates.svg)
- 扩展生命周期对比：[extension-lifecycle.svg](computer:///sessions/69e0515f778398360dde766e/workspace/research/figures/extension-lifecycle.svg)
- 交互与执行反馈闭环：[ux-feedback-loop.svg](computer:///sessions/69e0515f778398360dde766e/workspace/research/figures/ux-feedback-loop.svg)
- 优化热点对比：[optimization-hotspots.svg](computer:///sessions/69e0515f778398360dde766e/workspace/research/figures/optimization-hotspots.svg)
- 新增四维度覆盖矩阵：[research-release-dx-privacy-eval.svg](computer:///sessions/69e0515f778398360dde766e/workspace/research/figures/research-release-dx-privacy-eval.svg)

---

## 5) 源码与证据（关键入口文件直链，避免目录链接）
> 目录在 SOLO 里不一定可点击打开，这里只列“最关键入口文件”。

### Claude Code（research/sources/claude-code）
- README：[sources/claude-code/README.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/claude-code/README.md)
- ToolUseContext/权限枢纽：[sources/claude-code/src/Tool.ts](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/claude-code/src/Tool.ts)
- Plan Mode：
  - [EnterPlanModeTool.ts](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/claude-code/src/tools/EnterPlanModeTool/EnterPlanModeTool.ts)
  - [ExitPlanModeV2Tool.ts](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/claude-code/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts)
- 任务/后台执行示例：[LocalMainSessionTask.ts](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/claude-code/src/tasks/LocalMainSessionTask.ts)

### OpenClaw（research/sources/openclaw）
- README：[sources/openclaw/README.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/openclaw/README.md)
- 总地图（边界/约束）：[sources/openclaw/AGENTS.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/openclaw/AGENTS.md)
- 任务系统：
  - [task-executor.ts](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/openclaw/src/tasks/task-executor.ts)
  - [task-registry.ts](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/openclaw/src/tasks/task-registry.ts)
- 安全 denylist：[dangerous-tools.ts](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/openclaw/src/security/dangerous-tools.ts)

### Hermes Agent（research/sources/hermes-agent）
- README：[sources/hermes-agent/README.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/hermes-agent/README.md)
- Agent 主循环：[run_agent.py](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/hermes-agent/run_agent.py)
- 工具注册中心：[tools/registry.py](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/hermes-agent/tools/registry.py)
- Toolsets：[toolsets.py](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/hermes-agent/toolsets.py)
- 审批 gate：[tools/approval.py](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/hermes-agent/tools/approval.py)

### OpenSpec（research/sources/openspec）
- README：[sources/openspec/README.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/openspec/README.md)
- Concepts：[docs/concepts.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/openspec/docs/concepts.md)
- OPSX：[docs/opsx.md](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/openspec/docs/opsx.md)
- 默认 schema：[schemas/spec-driven/schema.yaml](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/openspec/schemas/spec-driven/schema.yaml)
- init 实现：[src/core/init.ts](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/openspec/src/core/init.ts)
- telemetry 实现：[src/telemetry/index.ts](computer:///sessions/69e0515f778398360dde766e/workspace/research/sources/openspec/src/telemetry/index.ts)

---

## 6) 计划文档入口（.trae/documents）
- [2026-04-16-三项目源码深度调研计划.md](computer:///sessions/69e0515f778398360dde766e/workspace/.trae/documents/2026-04-16-三项目源码深度调研计划.md)
- [2026-04-16-三项目补充专题调研计划.md](computer:///sessions/69e0515f778398360dde766e/workspace/.trae/documents/2026-04-16-三项目补充专题调研计划.md)
- [2026-04-16-新增四维度深挖计划.md](computer:///sessions/69e0515f778398360dde766e/workspace/.trae/documents/2026-04-16-新增四维度深挖计划.md)
- [2026-04-16-研究盲点清单计划.md](computer:///sessions/69e0515f778398360dde766e/workspace/.trae/documents/2026-04-16-研究盲点清单计划.md)
- [2026-04-16-深度调研文档整理计划.md](computer:///sessions/69e0515f778398360dde766e/workspace/.trae/documents/2026-04-16-深度调研文档整理计划.md)
- [2026-04-16-SOLO导航失效修复计划.md](computer:///sessions/69e0515f778398360dde766e/workspace/.trae/documents/2026-04-16-SOLO导航失效修复计划.md)
