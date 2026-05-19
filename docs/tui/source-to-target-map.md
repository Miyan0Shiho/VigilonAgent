# TUI Source To Target Map

## 目标

- 维护 Claude Code TUI 上游文件到 Vigilon 目标文件的逐步映射。
- 区分本阶段直接迁移、需要适配、暂缓与不纳入项。

## 首批映射

| 上游文件 | 目标文件 | 状态 | 说明 |
| --- | --- | --- | --- |
| `docs/superpowers/research/sources/claude-code/src/entrypoints/cli.tsx` | `packages/tui/src/entrypoints/cli.tsx` | 迁移但需适配 | 去除 Bun 特性与重型 fast-path，仅保留 TUI 启动责任。 |
| `docs/superpowers/research/sources/claude-code/src/main.tsx` | `packages/tui/src/entrypoints/runTui.ts` | 迁移但需适配 | Phase 3.1 已接真实 runtime adapter 和命令循环。 |
| `docs/superpowers/research/sources/claude-code/src/components/App.tsx` | `packages/tui/src/components/App.tsx` | 迁移但需适配 | 顶层壳已建立，接 session panel、message stream、composer。 |
| `docs/superpowers/research/sources/claude-code/src/components/Messages.tsx` | `packages/tui/src/components/MessageStream.tsx` | 迁移但需适配 | 已接工具流、reasoning、permission、AskUser、handoff 的轻量渲染。 |
| `docs/superpowers/research/sources/claude-code/src/components/Message.tsx` | `packages/tui/src/components/MessageStream.tsx` | 迁移但需适配 | 采用 compact message block，不复制完整 Claude Code message taxonomy。 |
| `docs/superpowers/research/sources/claude-code/src/components/TextInput.tsx` | `packages/tui/src/components/Composer.tsx` | 迁移但需适配 | 底部 composer 视觉位已建立，后续增强 raw-mode 编辑。 |
| `docs/superpowers/research/sources/claude-code/src/components/StatusLine.tsx` | `packages/tui/src/components/Composer.tsx` | 迁移但需适配 | 状态提示收敛到底部 composer 区。 |
| `docs/superpowers/research/sources/claude-code/src/hooks/useInputBuffer.ts` | `packages/tui/src/hooks/useInputBuffer.ts` | 直接迁移 | 核心缓冲逻辑已按近似结构迁入。 |
| `docs/superpowers/research/sources/claude-code/src/hooks/useTextInput.ts` | `packages/tui/src/hooks/useTextInput.ts` | 迁移但需适配 | 先仅保留命令解析与文本状态整合。 |
| `docs/superpowers/research/sources/claude-code/src/hooks/useTerminalSize.ts` | `packages/tui/src/hooks/useTerminalSize.ts` | 迁移但需适配 | 先用 Node `stdout` resize 构建最小版本。 |
| `docs/superpowers/research/sources/claude-code/src/commands/help/*` | `packages/tui/src/commands/help/index.ts` | 迁移但需适配 | 先提供 `source-to-target-map` 指引。 |
| `docs/superpowers/research/sources/claude-code/src/ink/*` | `packages/tui/src/ink/**` | 暂缓 | 仍使用官方 `ink` 包，后续再内化自定义渲染层。 |
| `docs/superpowers/research/sources/claude-code/src/tasks/*` | `packages/core/**` | 不纳入首阶段 | 属于后端执行内核，当前只在接口账本中记录。 |

## 下一批建议

- `components/Markdown.tsx`
- `components/Spinner.tsx`
- `components/MessageRow.tsx`
- `ink/components/*`
- `commands/clear/*`
- `commands/theme/*`
