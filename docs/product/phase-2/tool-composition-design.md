# 工具组合系统设计

日期：2026-05-27
参考：Claude Code `StreamingToolExecutor` + agent loop 架构

## 当前状态

Vigilon Phase 1 的工具执行模型是**单轮顺序**：

```typescript
// agentLoop.ts:603 当前实现
for (const call of response.toolCalls) {
  // 一个一个执行，即使是两个互不依赖的 Read 也要排队
  const result = await executeTool(call, context)
}
```

问题：
- 两个 Read 调用完全可以同时跑，但现在必须排队
- 模型已经有能力一次选多个工具，但 runtime 没有利用这个能力
- `readOnly` 标记已经存在（Read/Grep/Glob/LSP/ToolSearch 等已标记），但没用来做并行调度

## 目标方案

参考 Claude Code 的 `StreamingToolExecutor` 设计，核心改动只有一个：**分批并行执行**。

```
模型响应：
  tool_use: Read("a.ts")
  tool_use: Read("b.ts")
  tool_use: Glob("*.test.ts")
  tool_use: Edit("a.ts", ...)
  tool_use: Bash("pnpm test")
  tool_use: Read("c.ts")

分区执行：
  [Read, Read, Glob]  ← 并行（全是只读，互不依赖）
  [Edit]              ← 串行（写入，可能影响后续读取）
  [Bash]              ← 串行（有副作用）
  [Read]              ← 串行（在 Bash 之后，可能读 Bash 产生的文件）
```

### 分区规则

1. **只读工具**：`readOnly: true` 的工具可以放入同一分区，并行执行
2. **写入/破坏性工具**：每个独自形成一个分区，串行执行
3. **分区边界**：遇到写入工具 → 结束当前分区 → 执行该写入工具 → 开启新分区

### 实现

```typescript
// 替换现有的 for (const call of response.toolCalls)
function partitionToolCalls(
  calls: ToolCall[],
  tools: ToolRegistry
): ToolCall[][] {
  const partitions: ToolCall[][] = []
  let current: ToolCall[] = []

  for (const call of calls) {
    const tool = tools.get(call.name)
    const isReadOnly = tool?.readOnly ?? false

    if (isReadOnly) {
      current.push(call)
    } else {
      if (current.length > 0) {
        partitions.push(current)
        current = []
      }
      partitions.push([call]) // 写入工具单独成区
    }
  }

  if (current.length > 0) partitions.push(current)
  return partitions
}

// agent loop 中：
for (const partition of partitions) {
  if (partition.length === 1) {
    // 单工具——直接执行
    yield* executeSingleTool(partition[0], context)
  } else {
    // 多只读工具——并行执行，每个的结果独立写入 transcript
    const results = await Promise.all(
      partition.map(call => executeSingleTool(call, context))
    )
    for (const result of results) yield result
  }
}
```

## 其他五个能力

### 1. Deep Research

**工程本质**：给 Agent 一个多轮调研的 skill/workflow，不是新架构。

```
用户触发 "research X" →
  Agent 分解调研问题 →
  多轮 WebFetch（每次根据前一轮结果调整搜索方向）→
  来源交叉验证（至少 2 个独立来源确认同一事实）→
  结构化报告（摘要 / 关键发现 / 证据链 / 未覆盖角度 / 置信度）
```

Phase 2 做：调研 skill + 来源验证逻辑 + 报告模板。不碰 agent loop。

### 3. Self-Verification（独立评估者）

**工程本质**：主 Agent 完成任务后，启动独立 subagent 做验证，不是让主 Agent 自评。

```
主 Agent 完成代码修改 →
  启动 evaluator subagent（可以是不同模型/不同 prompt）→
  evaluator 独立运行测试、检查 spec、审计 diff →
  结构化验证报告（通过/失败/部分通过 + 具体问题列表）→
  主 Agent 根据报告修复 →
  重新验证（最多 N 轮）
```

Phase 2 做：evaluator subagent 定义 + 验证标准 template + 多轮修复循环。不碰 agent loop。关键原则：**Generator ≠ Evaluator**——写代码的 Agent 和查代码的 Agent 必须是两个独立实例。

### 4. 多模态视觉

**工程本质**：让 Agent 能读图片/截图/PDF，需要模型支持 vision input。

Phase 2 做：
- 工具层：Read tool 升级——遇到图片/PDF 时提取为 base64 → 传给支持 vision 的模型
- 用户触发模式（对标 Appshots）：快捷键 → 截图 → 附加到当前对话 → Agent 理解视觉上下文
- 模型层：DeepSeek 不支持 vision，需要引入 vision-capable secondary model（如 GPT-5.1 或 Claude）

### 5. Browser Agent

**工程本质**：WebFetch 从"读一页 HTML 文本"升级为"控制浏览器"。

```
当前 WebFetch：fetch(url) → HTML → markdown → 返回
目标 BrowserAgent：
  打开 URL → 等待渲染 → 理解 DOM → 
  可选：点击/填写/滚动/等待 →
  提取结果（截图 + 结构化文本 + DOM state）
```

Phase 2 做：基于 Playwright 的浏览器 harness，作为 WebFetch 工具的升级路径。保留简单的 WebFetch 模式（快、便宜），新增 BrowserAgent 模式（慢、贵、但能交互）。

### 6. Harness Engineering（结构性约束层）

**工程本质**：在工具执行层加校验，不只是 prompt 约定。

```
当前：prompt 里写"请写符合 ESLint 规则的代码"
目标：
  Edit 之后 → 自动 run ESLint → 不通过 → 结果返回给模型 → 模型修正
  Bash "git commit" 之前 → pre-commit hook → 不通过 → 阻止提交
  任务"完成"标记前 → 自动跑 regression test → 通过才算完成
```

Phase 2 做：
- 可配置的 pre-action / post-action 约束（对标 ESLint、pre-commit、typecheck）
- 工具结果的结构化校验层（schema validation on tool output）
- 任务完成门禁（regression test 通过 → 才能标记 done）

这些不碰 agent loop，是给工具执行层加 middleware。

---

## 总结

| 能力 | 碰不碰 agent loop | Phase 2 工程 |
|------|------------------|-------------|
| 工具组合（分批并行） | **碰**——改 tool call 执行循环 | 分区 + Promise.all |
| Deep Research | 不碰 | skill + 来源验证 + 报告模板 |
| Self-Verification | 不碰 | evaluator subagent + 多轮修复 |
| 多模态视觉 | 不碰 | Read tool 升级 + vision model |
| Browser Agent | 不碰 | WebFetch 升级为 Playwright harness |
| Harness Engineering | 不碰 | pre/post-action constraint middleware |
