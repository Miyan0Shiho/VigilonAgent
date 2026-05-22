# Ink Module

## 模块目的

- 记录 Claude Code 自研 `ink` 层与我们当前做法的差异。

## 当前状态

- 第一阶段仍直接依赖官方 `ink` 包，而不是复制 Claude Code 的自定义 `src/ink/*`。
- 这是为了先让 `packages/tui` 可运行，再逐步内化更底层的渲染和事件层。

## 上游目录映射

- `src/ink/*` -> `packages/tui/src/ink/**`

## 当前已迁移文件

- 暂无。

## 与后端耦合点

- 当前无直接后端耦合，但未来与输入事件、滚动、焦点、虚拟列表高度相关。

## 下一批推荐迁移文件

- `ink/components/Box.tsx`
- `ink/components/Text.tsx`
- `ink/clearTerminal.ts`
- `ink/focus.ts`
