# Claude Code 研究馆藏目录

> 这是 `claudecode-research/` 下所有调研产物的**唯一权威导航入口**。  
> 建议阅读方式：按“快速入口” → “推荐阅读路线” → “专题地图”逐步深入。

## 0) 快速入口（最常用）

- **源码库 (src/)**: [src/](../src/) - Claude Code 2.1.88 还原源码
- **研究图书馆 (library/)**: [library/](../library/) - 深度研究文档库
- **源码恢复说明**: [SOURCE_RECOVERY.md](../SOURCE_RECOVERY.md)
- **版本锁定 (commit/hash)**: [sources-lock.md](sources-lock.md)
- **盲点清单 (细节风险面)**: [blindspots.md](blindspots.md)
- **盲点解决方案建议**: [blindspots-solutions.md](blindspots-solutions.md)

---

## 1) 推荐阅读路线

### 10 分钟（快速理解产出）
1) [SOURCE_RECOVERY.md](../SOURCE_RECOVERY.md) - 了解源码来源
2) [library/master-index.md](../library/master-index.md) - 浏览图书馆索引

### 30 分钟（形成体系感）
1) 读 8 个专题中的 2–3 篇（按你关注点选择）：见下方「专题地图」
2) 按项目进入索引：[projects/claude-code.md](projects/claude-code.md)
3) 最后对照「盲点清单」查漏补缺：[blindspots.md](blindspots.md)

### 深入（需要逐条复核证据时）
1) 先从专题文档找到 Evidence (SEC/ECO/UX/OPT/REL/DXD/PRI/EVA)
2) 再跳到项目索引 [projects/claude-code.md](projects/claude-code.md) 定位源码入口
3) 最后回到 [src/](../src/) 对具体文件/符号复核

---

## 2) 项目索引入口

- **Claude Code 核心索引**: [projects/claude-code.md](projects/claude-code.md)

---

## 3) 专题地图（8 篇专题）
> 所有专题都采用 Evidence ID（符号级证据）组织结构。

### 基础四专题
- 安全与权限模型 (SEC): [../topics/security.md](../topics/security.md)
- 扩展与生态 (ECO): [../topics/ecosystem.md](../topics/ecosystem.md)
- 产品与交互 (UX): [../topics/ux.md](../topics/ux.md)
- 优化细节 (OPT): [../topics/optimizations.md](../topics/optimizations.md)

### 新增四维度专题
- 版本/发布/分发 (REL): [../topics/release.md](../topics/release.md)
- 开发者体验与文档机制 (DXD): [../topics/dx-docs.md](../topics/dx-docs.md)
- 隐私/遥测/数据治理 (PRI): [../topics/privacy-telemetry.md](../topics/privacy-telemetry.md)
- 评测与基准体系 (EVA): [../topics/evaluation-benchmarks.md](../topics/evaluation-benchmarks.md)

---

## 4) 图表索引 (SVG)

- **规划→执行闭环**: [../figures/planner-executor-sequence.svg](../figures/planner-executor-sequence.svg)
- **Claude Code 架构图**: [../figures/architecture-claude-code.svg](../figures/architecture-claude-code.svg)
- **安全 Gate 对比**: [../figures/security-gates.svg](../figures/security-gates.svg)
- **扩展生命周期**: [../figures/extension-lifecycle.svg](../figures/extension-lifecycle.svg)
- **交互与执行反馈闭环**: [../figures/ux-feedback-loop.svg](../figures/ux-feedback-loop.svg)
- **优化热点对比**: [../figures/optimization-hotspots.svg](../figures/optimization-hotspots.svg)
- **研究主题矩阵**: [../figures/research-release-dx-privacy-eval.svg](../figures/research-release-dx-privacy-eval.svg)

---

## 5) 源码与证据

- **ToolUseContext/权限枢纽**: [../src/Tool.ts](../src/Tool.ts)
- **Plan Mode 工具**:
  - [EnterPlanModeTool.ts](../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts)
  - [ExitPlanModeV2Tool.ts](../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts)
- **核心交互循环**: [../src/query.ts](../src/query.ts)
