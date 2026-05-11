# EntryPoints Module

## 模块目的

- 对应 Claude Code 的 CLI/TUI 启动入口。
- 本阶段仅保留最小职责：创建 mock runtime，启动 `ink` 渲染。

## 上游目录映射

- `src/entrypoints/cli.tsx` -> `packages/tui/src/entrypoints/cli.tsx`
- `src/main.tsx` -> `packages/tui/src/main.tsx`

## 当前已迁移文件

- `packages/tui/src/entrypoints/cli.tsx`
- `packages/tui/src/main.tsx`
- `packages/tui/src/adapters/runtimeAdapter.ts`
- `packages/tui/src/contracts/app-runtime.ts`

## 关键依赖关系

- 依赖 `@vigilon/shared/contracts/session` 提供快照结构。
- 依赖 `ink` 的 `render()` 建立 TUI 根。

## 与后端耦合点

- 真实会话状态、消息流、status line 都尚未接入 `packages/core`。

## 本阶段裁剪

- 暂不引入 Bun fast-path、daemon、bridge、bg sessions 等入口分支。

## 下一批推荐文件

- 上游 `commands.ts`
- 上游 `context.ts`
