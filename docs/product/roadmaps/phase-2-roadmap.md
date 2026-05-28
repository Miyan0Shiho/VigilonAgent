# Phase 2 Roadmap

最后更新：2026-05-27

## 阶段重定义

- **Phase 1**（已完成）：Copy-first 骨架——主循环、基础工具、transcript、resume
- **Phase 2**（当前）：能力对齐——把 P2.0-P2.8 推到机制级深度，让 Agent 真正强起来
- **Phase 3+**（后续）：三目标愿景——感知/自进化/安全，建立在强 Agent 基座上

详细计划：[Phase 2 能力对齐计划](../phase-2/capability-alignment-plan.md)

## Phase 2 优先级

### 第一优先（P0）：直接影响任务成功率

- **WebFetch 深度**：preflight/cache/summary，对标 Codex in-app browser
- **LLM Transport 深度**：retry/fallback/自动降级
- **Edit/Write Safety 验证**：stale check、atomic write

### 第二优先（P1）：代码理解和上下文质量

- **LSP 降级路径**：AST fallback、无 server 时的解释
- **Prompt Cache 审计**：cache break detection
- **Plan/Todo 状态链**：plan 阶段真限制写操作

### 第三优先（P2）：长期可靠性和扩展性

- **Memory 所有权模型**：外部内容门控
- **扩展机制深度**：schema-not-sent recovery、disallowed-tools
- **Compact capability replay**：post-compact 恢复验证

### 对标驱动增量

- 浏览器 Agent 基础（Codex in-app browser 对标）
- `/goal` 持久化自主执行（Codex + Claude Code 对标）
- 项目上下文深度感知（Vigilon 差异化）

## 当前工程阶段

P2.5 Runtime Governance 进行中。局部门禁：

```
pnpm phase2.5:memory-probe
pnpm phase2.5:compact-probe
pnpm phase2.5:safety-probe
pnpm phase2.5:subagent-probe
pnpm phase2.5:cache-probe
pnpm phase2.5:governance-probe
```

P2.5 是 Phase 2 中进度最快的一片，但不等于 Phase 2 closure。

## 历史路线图

- [P2-P5 路线图讨论稿](2026-05-18-roadmap-from-p2-to-p5.md)（2026-05-18，旧方向）
- [P2-P3 执行计划](2026-05-18-p2-p3-execution-plan.md)（2026-05-18，旧方向）
- [P2.5 执行计划](2026-05-19-p2-5-execution-plan.md)（2026-05-19，当前工程）
