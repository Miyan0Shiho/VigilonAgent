# Research Figures Index

本页汇总 `docs/superpowers/research/figures/` 下当前已存在的 SVG 图谱资产，并区分“已存在图谱”和“规划中的回链工作”。

## 当前已存在图谱

| 状态 | 图谱 | 主题 | 当前回链状态 |
| --- | --- | --- | --- |
| 已存在 | [architecture-claude-code.svg](./architecture-claude-code.svg) | Claude Code 架构总览 | 已在 `claude-code-library-v2` 中建立索引入口，尚未绑定具体卷册 |
| 已存在 | [architecture-hermes-agent.svg](./architecture-hermes-agent.svg) | Hermes Agent 架构对照 | 已存在，仅作为研究对照资产 |
| 已存在 | [architecture-openclaw.svg](./architecture-openclaw.svg) | OpenClaw 架构对照 | 已存在，仅作为研究对照资产 |
| 已存在 | [planner-executor-sequence.svg](./planner-executor-sequence.svg) | planner / executor 序列关系 | 已在 V2 中建立索引入口，正文回链待补 |
| 已存在 | [extension-lifecycle.svg](./extension-lifecycle.svg) | 扩展能力生命周期 | 已存在，待挂接机制卷册 |
| 已存在 | [optimization-hotspots.svg](./optimization-hotspots.svg) | 性能与优化热点 | 已存在，待挂接 observability / optimization 卷册 |
| 已存在 | [security-gates.svg](./security-gates.svg) | 权限与安全门控 | 已存在，待挂接机制卷册 |
| 已存在 | [ux-feedback-loop.svg](./ux-feedback-loop.svg) | UX 反馈闭环 | 已存在，待挂接产品或 UI 卷册 |
| 已存在 | [research-release-dx-privacy-eval.svg](./research-release-dx-privacy-eval.svg) | 研究主题矩阵 | 已存在，待补来源说明 |

## 当前接入点

- Claude Code V2 入口库： [claude-code-library-v2/README.md](../claude-code-library-v2/README.md)
- 总索引： [claude-code-library-v2/master-index.md](../claude-code-library-v2/master-index.md)
- 证据台账： [claude-code-library-v2/evidence/evidence-ledger.md](../claude-code-library-v2/evidence/evidence-ledger.md)

## 规划中的补完工作

| 状态 | 工作项 | 说明 |
| --- | --- | --- |
| 规划中 | 为每张图补“来源文档”和“目标文档” | 建立图谱到正文的双向回链 |
| 规划中 | 把 Claude Code 相关图谱挂接到具体卷册 | 优先处理 `architecture-claude-code.svg` 与 `planner-executor-sequence.svg` |
| 规划中 | 为对照类图谱补研究上下文 | 说明 Hermes / OpenClaw 图谱在 V2 中的引用边界 |
| 规划中 | 为每张图补版本或生成日期 | 降低图谱与正文之间的语义漂移 |
