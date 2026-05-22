# Phase 1 Development Baseline

- 日期：2026-05-17
- 状态：Phase 1 开发准备基线
- 目的：进入 Phase 1 前固定当前仓库的真实状态、可用入口、清理边界和开发门禁，避免在错误基础上开工。

## 1. 当前仓库事实

当前仓库已经具备：

- 一个干净的 `packages/runtime` 主开发包。
- 一个完整的 `packages/claude-code` 源码树。
- `docs/claudecode-research/` 下的 Claude Code 深度研究资料。
- Phase 1 产品边界文档和 copy-first 机制对照表。
- `packages/runtime` 的最小 CLI、runtime 契约和 Phase 1 能力边界代码。

当前仓库还不具备：

- 明确的 DeepSeek V4 主模型接入代码路径。
- 完整 Agent Loop 实现。
- 完整工具实现。
- 完整 transcript / resume 实现。
- 可作为 Phase 1 门禁的完整测试套件。

## 2. 源码使用策略

`packages/runtime` 是 Phase 1 的主开发入口。

`packages/claude-code` 当前只作为 Claude Code 源码参考镜像保留，不能作为默认开发入口，也不能默认把其中所有功能都视为 Vigilon 目标。

开发规则：

- 新代码优先进入 `packages/runtime`。
- 核心 runtime 机制优先从 `packages/claude-code/src` 和 `docs/claudecode-research/` 对照复刻。
- remote / bridge / enterprise / billing / telemetry / marketplace / multi-user 代码只作为源码研究材料，不作为 Phase 1 开发目标。
- 不在 `packages/claude-code` 中做修补式开发，除非任务明确要求维护参考镜像。
- 不在缺少机制对照时自行发明搜索、压缩、记忆或工具实现。

## 3. 当前可用命令

Phase 1 当前的最小健康检查：

```bash
pnpm phase1:baseline
```

它当前检查：

- `packages/runtime` typecheck。
- `packages/runtime` version smoke。

等主 Agent Loop、模型 client、工具和 transcript 逐步稳定后，`phase1:baseline` 必须扩展为真实门禁：

- version smoke
- DeepSeek V4 client smoke
- tool schema smoke
- read/search/edit/bash tool smoke
- transcript write/read smoke
- resume smoke

## 4. 参考镜像命令

Claude Code 参考镜像的版本 fast path 可以通过下面命令单独检查：

```bash
pnpm reference:claude-version
```

它不属于 Phase 1 默认门禁，只用于确认参考镜像仍能走最小入口。

## 5. 暂不作为门禁的命令

当前不要把下面命令作为 Phase 1 开发阻塞门禁：

```bash
pnpm --filter @vigilon/claude-code typecheck
pnpm --filter @vigilon/claude-code build
```

原因：

- 当前 Claude Code 镜像的源码形态与根 `NodeNext` TypeScript 配置不匹配。
- 源码里仍包含大量 Phase 1 明确排除的 remote / bridge / enterprise / telemetry 面。
- 部分 SDK 类型、generated 类型、React compiler runtime 类型和内部模块在当前本地环境中不完整。

这不代表这些问题可以永久忽略。它只意味着 Phase 1 应先在 `packages/runtime` 建立 Solo Runtime 的可运行主链，然后对纳入主链的模块逐步恢复严格 typecheck。

## 6. 清理边界

允许清理：

- `.DS_Store` 等操作系统临时文件。
- 不在 workspace 中、没有源码内容、只包含上游 npm 元数据的残留目录。
- 明确不参与 Phase 1 的本地生成产物。

暂不清理：

- `docs/claudecode-research/`，这是 Phase 1 copy-first 的依据。
- `packages/claude-code/src` 中尚未完成依赖分析的源码。
- 任何用户已有改动。

## 7. 下一步开发切片

Phase 1 第一批开发不从 UI 或大规模裁剪开始，而从可运行主链开始：

1. 在 `packages/runtime` 固定 DeepSeek V4 主模型 client 入口。
2. 对照 Claude Code 的 `QueryEngine -> query -> services/api/claude` 模型调用路径，设计 Vigilon 的同构主链。
3. 将 DeepSeek V4 接入同一条 tool-calling loop，而不是旁路 demo。
4. 为模型调用、tool schema、tool result 回填建立 smoke test。
5. 再进入 `Read / Grep / Glob` 搜索链路复刻。

每个切片都必须回到 `2026-05-17-phase-1-copy-first-mechanism-map.md` 对照 Claude Code 机制。
