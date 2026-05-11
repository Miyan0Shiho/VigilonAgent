# Commands Module

## 模块目的

- 建立 Claude Code 命令体系在 Vigilon TUI 中的第一批落点。

## 上游目录映射

- `src/commands/help/*` -> `packages/tui/src/commands/help/index.ts`
- `src/commands/clear/*` -> `packages/tui/src/commands/clear/index.ts`
- `src/commands/theme/*` -> `packages/tui/src/commands/theme/index.ts`

## 当前已迁移文件

- `commands/index.ts`
- `commands/help/index.ts`
- `commands/clear/index.ts`
- `commands/theme/index.ts`

## 关键依赖关系

- `useTextInput` 消费命令模块来生成状态线反馈。

## 与后端耦合点

- 当前命令只处理前端本地态，还没有调用 tool runtime。

## 本阶段保留/裁剪说明

- 保留 `help`/`clear`/`theme` 的最小语义位置。
- 裁剪 `mcp`、`login`、`tasks`、`model`、`review` 等深度依赖后端的命令。

## 下一批推荐迁移文件

- `commands/cost/*`
- `commands/files/*`
- `commands/plan/*`
