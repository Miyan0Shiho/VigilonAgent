# Backend Interface Ledger

## 说明

- 本文件追踪 TUI 复刻过程中暴露出来的后端依赖。
- 第一阶段仅允许 `stub` 或 `mock`，不直接实现真实 planner/executor。

## 当前账本

| 上游文件 | Vigilon 目标文件 | 所需能力 | 输入/输出 | 当前状态 | 后续归属 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `src/main.tsx` | `packages/tui/src/main.tsx` | 会话快照提供 | 输入：`AppRuntimeSnapshot`；输出：React 根节点 | `mock` | `packages/shared` | 当前由 `runtimeAdapter` 生成静态快照。 |
| `src/components/Messages.tsx` | `packages/tui/src/components/Messages.tsx` | 消息流模型 | 输入：`SessionMessage[]`；输出：消息列表渲染 | `adapter-ready` | `packages/shared` | 已抽到共享消息契约。 |
| `src/components/TextInput.tsx` | `packages/tui/src/components/TextInput.tsx` | 输入命令解释 | 输入：文本；输出：状态线提示/清空结果 | `stub` | `packages/tui` / `packages/shared` | 当前只接 `/help` 和 `/clear`。 |
| `src/components/StatusLine.tsx` | `packages/tui/src/components/StatusLine.tsx` | 状态摘要提供 | 输入：状态字符串；输出：底部信息 | `mock` | `packages/core` | 未来应由模型/权限/上下文统计驱动。 |
| `src/commands/help/*` | `packages/tui/src/commands/help/index.ts` | 帮助文档索引 | 输入：命令文本；输出：帮助状态 | `adapter-ready` | `packages/tui` | 当前导向迁移文档。 |

## 下一轮待补接口

- 权限模式与审批状态
- Tool use 进度流
- Thinking / streaming 文本事件
- 任务列表与后台执行状态
- 会话恢复与 transcript 持久化
