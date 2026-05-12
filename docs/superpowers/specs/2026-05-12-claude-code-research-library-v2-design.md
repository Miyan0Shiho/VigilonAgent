# Spec: Claude Code 深度研究文档库 V2 设计

- **日期**: 2026-05-12
- **状态**: 草案 (Draft)
- **类型**: 研究库设计 / 文档系统设计
- **研究对象**: `packages/claude-code/src/**` 及其入口依赖链

## 1. 背景与目标

当前仓库已经存在一套 `docs/superpowers/research/claude-code-deep-dive/` 研究骨架，包含总索引、分卷、任务流样本、源码映射、证据台账与若干综合性分析文档。该骨架证明方向正确，但离本任务要求的“图书馆级深度研究文档库”仍有明显差距：

- 现有内容更接近“高质量研究草案”，而非长期可扩展的正式知识库。
- 多数结论停留在模块级或文件级，尚未系统下钻到函数、关键变量、状态流与调用链。
- 用户层、产品层、架构层、实现层之间尚未形成稳定的纵向互链。
- 图表资产已有雏形，但还没有形成统一的 SVG 研究图谱体系。
- 现有目录已经承载一轮探索，不适合作为正式版研究库直接叠改。

本设计的目标是建立一套新的 **Claude Code 深度研究文档库 V2**，满足以下条件：

- 既能服务人类顺序阅读，也能服务 agent 检索、跳转与二次研究。
- 既覆盖产品层、架构层、用户层，也覆盖具体实现层。
- 关键结论必须落到实际源码实现，优先绑定具体文件、函数、变量、状态与调用链。
- 外部资料必须分证据等级使用，官方资料与高质量社区资料可以并重，但不能混写成无来源结论。
- 图表统一采用 SVG，成为研究库中的一等资产。
- 整套研究库以“多卷研究库 + 多子册 + 证据层 + 图谱层”的方式组织，而不是一份大报告。

## 2. 设计原则

### 2.1 证据优先

每一个高价值结论都必须优先落到源码证据。产品解释、架构判断、体验分析都不能脱离实现事实。

### 2.2 层次分明

事实层、解释层、判断层必须分开书写：

- 事实层：源码、官方文档、运行时观测。
- 解释层：对机制、边界、数据流、角色的解读。
- 判断层：对 Vigilon 或后续产品设计的启发、规避项、机会点。

### 2.3 双读者友好

文档既要支持人类阅读，也要支持 agent 调研，因此必须同时具备：

- 清晰的阅读路径与总索引。
- 稳定的目录树与命名规范。
- 高密度的源码引用入口。
- 可抽取的结构化证据页。

### 2.4 主包优先，依赖链延展

研究主轴锁定为：

- `packages/claude-code/src/**`

同时沿入口依赖链扩展到相关配套机制，包括但不限于：

- CLI 入口与运行模式分发
- query loop 与 QueryEngine
- Tool / ToolUseContext / tools registry
- permissions / hooks / settings / policy limits
- session storage / resume / background sessions
- MCP / plugins / skills / subagents / tasks
- REPL / Ink / UI 状态承载

### 2.5 图谱即文档

SVG 图不是装饰性附图，而是独立的研究资产。图中表达的系统边界、角色、状态转换、权限门控与调用链，必须与正文保持可核对的一致性。

## 3. 研究范围

### 3.1 核心范围

- `packages/claude-code/src/entrypoints/cli.tsx`
- `packages/claude-code/src/main.tsx`
- `packages/claude-code/src/QueryEngine.ts`
- `packages/claude-code/src/query.ts`
- `packages/claude-code/src/Tool.ts`
- `packages/claude-code/src/tools.ts`
- `packages/claude-code/src/utils/processUserInput/**`
- `packages/claude-code/src/utils/sessionStorage.ts`
- `packages/claude-code/src/utils/queryProfiler.ts`
- `packages/claude-code/src/utils/startupProfiler.ts`
- `packages/claude-code/src/services/api/**`
- `packages/claude-code/src/services/mcp/**`
- `packages/claude-code/src/skills/**`
- `packages/claude-code/src/tasks/**`
- `packages/claude-code/src/screens/**`
- `packages/claude-code/src/components/**`
- `packages/claude-code/src/ink/**`

### 3.2 用户层覆盖范围

用户层必须同时覆盖以下三类角色：

- 终端用户与高级用户
- 团队 / 企业管理员
- 扩展开发者（hooks / skills / MCP / plugins / subagents）

### 3.3 外部资料范围

外部资料分为三类：

- Anthropic 官方资料：`code.claude.com/docs`、`platform.claude.com/docs`、Support、官方 GitHub 仓库
- 高质量社区资料：高信噪比技术拆解、教学文章、代码对照项目
- 仓库内既有研究资料：仅作为参考与交叉验证，不直接等同于最终结论

## 4. 最终交付形态

最终交付是一套新的研究库目录，而不是覆盖旧目录。

建议新目录：

- `docs/superpowers/research/claude-code-library-v2/`

该目录下采用 **8 个一级卷册 + 多子册 + 图谱 + 证据层** 的组织方式。

## 5. 文档库总结构

### A. 总索引与阅读地图

职责：

- 定义阅读入口与推荐顺序
- 建立“问题 -> 文档 -> 源码 -> 图谱”的导航关系
- 区分人类阅读路径与 agent 调研路径

建议文件：

- `README.md`
- `master-index.md`
- `reading-paths.md`
- `glossary.md`

### B. 产品层

职责：

- 分析 Claude Code 的产品定位、能力边界、模式分发、工作方式与计划体系
- 把官方叙事与实际 CLI/功能面对应起来

建议子册：

- `product/01-positioning-and-surface.md`
- `product/02-capability-matrix.md`
- `product/03-workflows-and-modes.md`
- `product/04-plans-governance-and-enterprise.md`

### C. 架构层

职责：

- 拆解系统运行时骨架、入口装配、状态承载、内核边界与 UI 承接方式

建议子册：

- `architecture/01-entrypoints-and-bootstrap.md`
- `architecture/02-runtime-kernel.md`
- `architecture/03-state-and-persistence.md`
- `architecture/04-ui-repl-and-ink.md`

### D. 用户层

职责：

- 从三类角色视角解释 Claude Code 的真实使用与治理结构

建议子册：

- `users/01-terminal-and-power-users.md`
- `users/02-team-and-enterprise-admins.md`
- `users/03-extension-developers.md`
- `users/04-user-journeys-and-friction-points.md`

### E. 实现内核层

职责：

- 进入函数 / 变量 / 状态 / 调用链级别的深挖
- 成为整个研究库的“硬证据主仓”

建议子册：

- `implementation/01-cli-dispatch-and-fast-paths.md`
- `implementation/02-process-user-input.md`
- `implementation/03-query-engine.md`
- `implementation/04-query-loop.md`
- `implementation/05-tool-use-context.md`
- `implementation/06-session-storage-and-resume.md`
- `implementation/07-api-streaming-and-budgeting.md`
- `implementation/08-repl-state-rendering.md`

### F. 专题机制层

职责：

- 将跨层机制按主题独立成册，方便长期维护与横向比较

建议子册：

- `mechanisms/01-tools-and-tool-registry.md`
- `mechanisms/02-skills-and-prompts.md`
- `mechanisms/03-hooks-and-guardrails.md`
- `mechanisms/04-permissions-and-policy-limits.md`
- `mechanisms/05-mcp-and-plugin-boundary.md`
- `mechanisms/06-subagents-tasks-and-sessions.md`
- `mechanisms/07-observability-and-telemetry.md`

### G. 证据与图谱层

职责：

- 保存研究库的“可核查底座”
- 让每个结论都能回到出处与路径

建议子册：

- `evidence/evidence-ledger.md`
- `evidence/doc-to-source-map.md`
- `evidence/source-to-doc-map.md`
- `evidence/function-index.md`
- `evidence/variable-state-index.md`
- `evidence/external-sources.md`

### H. 产品启发层

职责：

- 从事实层和解释层中提炼出对后续产品开发真正有价值的判断

建议子册：

- `synthesis/01-design-principles.md`
- `synthesis/02-patterns-to-inherit.md`
- `synthesis/03-patterns-to-avoid.md`
- `synthesis/04-product-opportunities.md`

## 6. 单篇文档统一模板

核心研究文档统一采用以下结构：

1. 研究问题
2. 结论摘要
3. 证据等级
4. 关键源码入口
5. 关键调用链
6. 关键函数
7. 关键变量 / 状态
8. 边界与失败模式
9. 外部资料互证
10. 对后续产品的启发

说明：

- 产品层与用户层文档可以在“关键函数 / 关键变量”部分适度收缩。
- 实现内核层与专题机制层必须完整采用该模板。
- 每篇文档顶部需要标注适合的阅读对象，例如“产品研究”“架构研究”“实现研究”“扩展研究”。

## 7. 证据等级体系

### A 级

本地源码已直接证明，能明确定位到文件、函数、变量、调用链或状态结构。

### B 级

本地源码为主，外部官方资料或高质量社区资料用于补强说明。

### C 级

尚需运行时观察、更多源码穿透或外部资料交叉验证。

### D 级

推测性判断，只能进入“待验证假设”区域，不能写入核心结论。

## 8. 图谱体系

所有图表默认输出为 SVG。

首批核心图建议包括：

1. Claude Code 产品表面与运行模式图
2. CLI 入口分发图
3. `main.tsx` 装配图
4. `QueryEngine -> query -> tools -> transcript` 主链图
5. `processUserInput()` 输入预处理状态图
6. `ToolUseContext` 枢纽关系图
7. 权限 / policy / hooks / MCP 边界图
8. session / resume / background sessions 生命周期图
9. 三类用户角色视图
10. “官方叙事 -> 产品能力 -> 实现机制” 映射图

图谱要求：

- 统一白底、学术风、信息密度高、避免装饰性元素。
- 图中节点命名应尽量与源码符号一致。
- 每张图都必须有对应文档页解释与源码回链。

## 9. 研究方法与执行阶段

### 阶段 1：资料归档与证据底座

目标：

- 重新抓取和整理外部资料清单
- 建立新的证据账本、函数索引、变量状态索引
- 明确旧研究骨架可复用与不可复用部分

### 阶段 2：运行时骨架穿透

目标：

- 确认 CLI 入口、主装配、QueryEngine、query loop、state、session storage 的真实主链
- 形成最核心的架构层与实现层骨架文档

### 阶段 3：专题机制深挖

目标：

- 分别拆穿 tools、skills、hooks、permissions、MCP、subagents、tasks、sessions

### 阶段 4：用户层与产品层汇编

目标：

- 从三类角色回写使用方式、治理结构、权限体验、扩展体验
- 将官方叙事和源码实现对齐

### 阶段 5：图谱、总编与综合判断

目标：

- 完成 SVG 图谱
- 做全库交叉链接与一致性校验
- 输出产品启发卷册

## 10. 子 Agent 分工方案

正式执行时建议采用以下并行分工：

### 10.1 外部资料组

职责：

- 收集 Anthropic 官方资料与高质量社区资料
- 建立证据等级、来源摘要与待核验点

### 10.2 源码骨架组

职责：

- 打通入口文件、主装配、query loop、state、session persistence 的核心主链

### 10.3 实现深挖组

职责：

- 对关键模块下钻到函数 / 变量 / 状态 / 调用链级别

### 10.4 用户与产品组

职责：

- 重建三类用户视角与官方产品叙事
- 对齐用户工作流与代码实现

### 10.5 图谱与证据组

职责：

- 维护 SVG 图谱、证据台账、函数索引、变量状态索引

### 10.6 总编审校组

职责：

- 保持术语一致
- 校验跨文档链接
- 统一模板、证据等级和判断口径

## 11. 明确不做的事

- 不直接把现有 `claude-code-deep-dive` 目录当成最终版研究库。
- 不把未验证的社区传言写成核心结论。
- 不只停留在“模块职责说明”层面。
- 不把图表做成无法回链源码的装饰页。
- 不在没有证据分层的前提下混写事实与判断。

## 12. 当前已确认的源码事实

在正式执行前，已经确认以下事实可作为 V2 研究库的起点：

- `src/entrypoints/cli.tsx` 不是单一路径入口，而是带大量 fast-path 与 feature gate 的运行模式分发层。
- `src/query.ts` 是 Claude Code agent loop 的关键内核之一，已可见 `QueryParams`、循环 `State`、token budget、compact、tool orchestration、stop hooks、tool summary 与 content replacement 等机制。
- 现有 `claude-code-deep-dive` 目录已经具备总索引、分卷、任务流、证据台账与映射雏形，可作为 V2 的参考底稿。
- `processUserInput.ts`、`sessionStorage.ts`、`queryProfiler.ts`、`startupProfiler.ts`、`Tool.ts`、`QueryEngine.ts` 均已在本地仓库确认存在。

## 13. 成功标准

当以下条件同时满足时，视为该设计落地成功：

- 形成一套全新的 V2 研究库目录。
- 至少具备完整的 8 个一级卷册与对应阅读入口。
- 核心实现文档完成函数 / 变量 / 状态 / 调用链级证据下钻。
- 产品层、架构层、用户层三者可以互相回链到实现层。
- 证据页、函数索引、变量状态索引与 SVG 图谱形成闭环。
- 文档既适合顺序阅读，也适合基于索引的 agent 调研。

## 14. 待确认但已基本锁定的设计决策

- 研究库采用新目录 V2，而不是原地升级旧目录。
- 研究方法采用 `A + B 混合增强`：对外以证据驱动型研究库组织，对内以源码内核剖析为分析主干。
- 图表统一使用 SVG。
- 外部资料允许官方与高质量社区并重，但必须分证据等级。
- 用户层必须覆盖终端用户、高级用户、团队 / 企业管理员、扩展开发者三类视角。

