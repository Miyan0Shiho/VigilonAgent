# Hooks Module

## 模块目的

- 承接 Claude Code TUI 的输入、缓冲和终端尺寸等基础 Hook。

## 上游目录映射

- `src/hooks/useInputBuffer.ts` -> `packages/tui/src/hooks/useInputBuffer.ts`
- `src/hooks/useTextInput.ts` -> `packages/tui/src/hooks/useTextInput.ts`
- `src/hooks/useTerminalSize.ts` -> `packages/tui/src/hooks/useTerminalSize.ts`

## 当前已迁移文件

- `useInputBuffer.ts`
- `useTextInput.ts`
- `useTerminalSize.ts`

## 关键依赖关系

- `useTextInput` 当前依赖 `commands/help` 与 `commands/clear`。
- `useTerminalSize` 当前直接读取 Node `stdout`。

## 与后端耦合点

- 尚未接入历史、notifications、vim mode、image paste、permissions。

## 本阶段保留/裁剪说明

- 保留首批对最小交互闭环必要的文本状态逻辑。
- 裁剪高级编辑、kill ring、history、快捷键体系。

## 下一批推荐迁移文件

- `useSettings.ts`
- `useCommandQueue.ts`
- `useVoiceEnabled.ts`
