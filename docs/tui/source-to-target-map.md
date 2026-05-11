# TUI Source To Target Map

## 目标

- 维护 Claude Code TUI 上游文件到 Vigilon 目标文件的逐步映射。
- 区分本阶段直接迁移、需要适配、暂缓与不纳入项。

## 首批映射

| 上游文件 | 目标文件 | 状态 | 说明 |
| --- | --- | --- | --- |
| `docs/superpowers/research/sources/claude-code/src/entrypoints/cli.tsx` | `packages/tui/src/entrypoints/cli.tsx` | 迁移但需适配 | 去除 Bun 特性与重型 fast-path，仅保留 TUI 启动责任。 |
| `docs/superpowers/research/sources/claude-code/src/main.tsx` | `packages/tui/src/main.tsx` | 迁移但需适配 | 当前只保留最小 App 装配，后续继续对齐主循环。 |
| `docs/superpowers/research/sources/claude-code/src/components/App.tsx` | `packages/tui/src/components/App.tsx` | 直接迁移 | 当前为极简顶层壳，后续继续引入 context/state provider。 |
| `docs/superpowers/research/sources/claude-code/src/components/Messages.tsx` | `packages/tui/src/components/Messages.tsx` | 迁移但需适配 | 暂未引入虚拟列表、工具流、thinking 渲染。 |
| `docs/superpowers/research/sources/claude-code/src/components/Message.tsx` | `packages/tui/src/components/Message.tsx` | 迁移但需适配 | 当前先固化基础 role + content 显示。 |
| `docs/superpowers/research/sources/claude-code/src/components/TextInput.tsx` | `packages/tui/src/components/TextInput.tsx` | 迁移但需适配 | 先连接轻量输入状态，后续逐步吸收高级编辑行为。 |
| `docs/superpowers/research/sources/claude-code/src/components/StatusLine.tsx` | `packages/tui/src/components/StatusLine.tsx` | 迁移但需适配 | 当前先承载 mock runtime 与 help 指引状态。 |
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
