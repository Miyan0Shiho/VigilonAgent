# Components Module

## 模块目的

- 建立 Claude Code TUI 的最小可见界面壳。

## 上游目录映射

- `src/components/App.tsx` -> `packages/tui/src/components/App.tsx`
- `src/components/Messages.tsx` -> `packages/tui/src/components/Messages.tsx`
- `src/components/Message.tsx` -> `packages/tui/src/components/Message.tsx`
- `src/components/TextInput.tsx` -> `packages/tui/src/components/TextInput.tsx`
- `src/components/StatusLine.tsx` -> `packages/tui/src/components/StatusLine.tsx`

## 当前已迁移文件清单

- `App.tsx`
- `Messages.tsx`
- `Message.tsx`
- `TextInput.tsx`
- `StatusLine.tsx`

## 关键依赖关系

- 共享契约：`@vigilon/shared/contracts/messages`
- 运行时快照：`packages/tui/src/contracts/app-runtime.ts`

## 与后端耦合点

- 缺失 streaming tool uses、thinking blocks、permissions、token/cost stats。

## 本阶段保留/裁剪说明

- 保留消息列表、输入栏、状态栏三个基础可见区域。
- 裁剪虚拟列表、复杂 message block、多模态附件与工具流渲染。

## 下一批推荐迁移文件

- `Markdown.tsx`
- `Spinner.tsx`
- `MessageRow.tsx`
