# Backend Interface Ledger

## 说明

- 本文件追踪 TUI 复刻过程中暴露出来的后端依赖。
- Phase 3.1 已允许 TUI 通过 adapter 调用真实 Vigilon runtime，但不实现新的 planner/executor。

## 当前账本

| 上游文件 | Vigilon 目标文件 | 所需能力 | 输入/输出 | 当前状态 | 后续归属 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `src/main.tsx` | `packages/tui/src/entrypoints/runTui.ts` | TUI 主循环与 adapter 装配 | 输入：CLI args/stdin；输出：operator shell stream | `runtime-backed` | `packages/tui` | `vigilon tui` 已从 runtime CLI 转发到此包。 |
| `src/components/Messages.tsx` | `packages/tui/src/components/MessageStream.tsx` | 消息流模型 | 输入：`TuiRuntimeEvent[]`；输出：消息列表渲染 | `runtime-backed` | `packages/tui` | 覆盖 user/assistant/reasoning/tool/permission/AskUser/handoff。 |
| `src/components/TextInput.tsx` | `packages/tui/src/components/Composer.tsx` | 输入命令解释 | 输入：文本；输出：状态线提示/命令执行 | `runtime-backed` | `packages/tui` | 支持 `/help`、`/clear`、`/sessions`、`/resume`、`/open`、`/approve`、`/doctor`、`/quit`。 |
| `src/components/StatusLine.tsx` | `packages/tui/src/components/Composer.tsx` | 状态摘要提供 | 输入：状态字符串；输出：底部信息 | `runtime-backed` | `packages/tui` | 当前由 adapter 主循环驱动。 |
| `src/commands/help/*` | `packages/tui/src/commands/help/index.ts` | 帮助文档索引 | 输入：命令文本；输出：帮助状态 | `adapter-ready` | `packages/tui` | 当前导向迁移文档。 |

## 下一轮待补接口

- 更完整的 raw-mode composer 编辑体验
- 终端尺寸下的滚动/截断策略
- 手动 TTY 视觉验收
- 更细的 Bash 长任务进度摘要
