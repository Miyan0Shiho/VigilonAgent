# Claude Code V2 外部资料台账

本页记录“可以补强源码理解”的外部资料，而不是替代源码事实。

## 配套入口

- 当前入口： [README.md](../README.md)、[master-index.md](../master-index.md)、[reading-paths.md](../reading-paths.md)
- 证据页： [evidence-ledger.md](./evidence-ledger.md)、[source-to-doc-map.md](./source-to-doc-map.md)
- 旧稿目录：当前工作区未挂载；如后续恢复，可作为旧稿证据源接回
- 图谱页： [../figures/index.md](../figures/index.md)

## 使用原则

- 本地源码优先，外部资料用于解释产品叙事、公开能力声明和行为语义。
- 任何外部资料结论进入 V2 正文前，都应回链到 `packages/claude-code/src/**` 的当前实现。
- 若外部资料与当前源码不一致，以当前源码为准，并在 [evidence-ledger.md](./evidence-ledger.md) 中记录漂移。

## 官方文档

| 来源 | 主题 | 用途 | 当前状态 |
| --- | --- | --- | --- |
| [overview](https://code.claude.com/docs/en/overview) | 产品概览 | 对照 CLI / REPL / product surface 的官方叙事 | 待人工复核最新内容 |
| [how-claude-code-works](https://code.claude.com/docs/en/how-claude-code-works) | 工作机制 | 对照 `QueryEngine`、`query.ts`、tool use 主链 | 待人工复核最新内容 |
| [settings](https://code.claude.com/docs/en/settings) | settings 与行为配置 | 对照 `main.tsx` 初始化和 settings 读取 | 待人工复核最新内容 |
| [hooks](https://code.claude.com/docs/en/hooks) | hooks | 对照 `utils/hooks/**` 与 `processUserInput()` | 待人工复核最新内容 |
| [sub-agents](https://code.claude.com/docs/en/sub-agents) | subagents | 对照 `tasks/**`、`AgentTool/**` | 待人工复核最新内容 |
| [skills](https://code.claude.com/docs/en/skills) | skills | 对照 `skills/**` 与工具调用路径 | 待人工复核最新内容 |
| [Claude Platform Docs](https://platform.claude.com/docs/en/home) | 平台通用文档 | 对照 API / streaming / tool schema | 待人工复核最新内容 |

## 旧版研究资料说明

旧版 `claude-code-deep-dive` 当前不在工作区内，因此本页不再保留悬空链接。

如果后续恢复旧目录，建议只把它作为：

- 问题域骨架来源
- 旧结论核查清单
- 任务流拆分参考

不要把旧稿直接当作当前事实库。

## 值得后续补充的社区资料

| 资料类型 | 用途 | 风险控制 |
| --- | --- | --- |
| 高质量技术拆解文章 | 用于验证产品叙事与使用体验 | 只能做 B/C 级补强，不能盖过源码事实 |
| 官方 GitHub 仓库与 issue/discussion | 用于验证公共能力边界与已知问题 | 要区分主仓实现与营销/文档描述 |
| 社区教程/演示 | 用于补用户工作流与扩展者体验 | 容易滞后于版本，需要标版本与日期 |

## 当前人工核验缺口

- 还没有在本轮中实时抓取并核验最新官方文档内容。
- 还没有建立“外部资料版本/日期 -> 当前源码版本”的对照规则。
- 社区资料尚未登记具体文章或仓库，当前只保留方法位。
