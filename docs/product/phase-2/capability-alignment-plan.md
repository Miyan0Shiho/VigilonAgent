# Phase 2 能力对齐计划

日期：2026-05-27
前置：[Phase 2 Core Capability Alignment（历史定义）](../archive/phase-2-old/2026-05-18-phase-2-core-capability-alignment.md)
关联：[对标分析](competitive-analysis.md)、[感知机制调研](perception-research.md)

## 当前状态

Phase 1 的 copy-first 实现覆盖面比预期好。P2.0-P2.8 所有工具族**都已存在**，30 个测试文件 11524 行覆盖。P2.5 有 9 个局部门禁（`pnpm phase2.5:*-probe`）。

核心问题不是"缺什么"，而是**深度不够**——很多实现停留在函数签名和 happy path，没达到 Claude Code 覆盖审计要求的机制级对齐。

## P2.x 深度评估

### P2.0 LLM Transport（723 行 deepseek.ts）

| 机制 | 状态 | 缺口 |
|------|------|------|
| tool schema 编译 | 有 | 稳定性审计——schema 变化时的 cache break 追踪 |
| streaming block accumulation | 有 | tool_use pairing 的边界 case |
| context_overflow 处理 | 有 | 只有分类标记，缺少自动降级/重试策略 |
| retry/fallback | **缺** | 没有指数退避、错误分类重试、模型降级 |
| usage/cost tracking | 有 | prompt_cache_hit/miss 已追踪 |

**深度目标**：长任务中网络波动或模型超载时，Agent 不应直接失败——应自动重试、降级或等待恢复。

### P2.1 Search & Code Intelligence

| 机制 | 状态 | 缺口 |
|------|------|------|
| Grep/Glob 上下文入口 | 有 | 结果预算、重复读取控制、噪音目录过滤 |
| LSP deferred loading | 有 | health check 重连、LSP 不可用时的降级解释 |
| definition/references/symbols/diagnostics | 有 | call hierarchy、被动 diagnostics 附着 |
| AST/tree-sitter fallback | **缺** | 无 LSP server 时的本地代码智能降级 |

**深度目标**：陌生仓库中能用少量搜索建立代码理解；LSP 不可用时能解释降级路径而非静默失败。

### P2.2 Edit/Write/Bash Safety

| 机制 | 状态 | 缺口 |
|------|------|------|
| stale check | **需验证** | 并发修改是否被检测并报错 |
| atomic write | **需验证** | 写入失败是否留下半成品文件 |
| 危险命令分类 | 有 | 分类覆盖率——是否覆盖了常见危险模式 |
| TaskStop 共享 kill path | 有 | 终态事件是否保证不丢失 |
| 大输出预算 | 有 | 预算耗尽时的恢复路径 |

**深度目标**：工具失败后能继续推进任务而非打断 runtime；危险操作有可解释的审批链。

### P2.3 WebFetch / Notebook / AskUser

| 机制 | 状态 | 缺口 |
|------|------|------|
| WebFetch domain gate | 有 | **缺** preflight/cache、markdown transform、secondary model summary |
| WebFetch redirect | 有 | 跨 host 重定向的权限提示已做 |
| Notebook cell IR | 有 | large-output guard 深度 |
| AskUser structured Q | 有 | multiSelect、preview、permission queue 已有 |

**WebFetch 是最大缺口**——当前是基础的 `fetch` + redirect 处理，缺少 Claude Code 的 preflight/cache/summary 链路。同时对标 Codex 的 in-app browser，长期需要考虑浏览器 Agent 能力。

### P2.4 Plan Mode & Todo

| 机制 | 状态 | 缺口 |
|------|------|------|
| EnterPlanMode/ExitPlanMode | 有 | plan 阶段是否真正限制了写操作（不只是 prompt 约定） |
| TodoWrite | 有 | todo 是否驱动执行和最终报告（不只是 markdown list） |
| 状态链一致性 | **需验证** | plan → todo → execute → verify → report 是否同一条状态链 |

### P2.5 Compact / Context Management（最成熟）

三路径策略（session-memory → reactive → legacy）已实现。9 个 probe gate 覆盖 memory、compact、safety、subagent、cache、governance。

**剩余缺口**：post-compact 的 capability delta replay（deferred tools、MCP instructions、agent listing 恢复）需要验证。

### P2.6 Memory Runtime

| 机制 | 状态 | 缺口 |
|------|------|------|
| session memory | 有 | 可查看/可编辑/可删除的 UX 面 |
| project memory | 有 | **缺** 所有权模型（user/project/organization/agent/tool） |
| memory freshness | 有 | 过期检测和重新验证 |
| 外部内容门控 | **缺** | web/email/tool output 如何不自动污染 memory |

### P2.7 ToolSearch / Skill / MCP / Hook

| 机制 | 状态 | 缺口 |
|------|------|------|
| ToolSearch deferred tools | 有 | schema-not-sent recovery |
| MCP instructions delta | **需验证** | compact 后恢复 |
| Skill loading + allowed tools | 有 | disallowed-tools（对标 Claude Code 新功能） |
| PreToolUse hook | 有 | 深度：hook 失败后的恢复路径 |

### P2.8 Prompt Cache / Request Stability

| 机制 | 状态 | 缺口 |
|------|------|------|
| cache hit/miss tracking | 有 | **缺** cache break detection——system/tools/model 变化时的审计 |
| request stability audit | 有测试 | 深度：自动检测 vs 手动检查 |

---

## 优先级排序

按"对 Agent 实际能力提升最大 + 当前最薄弱"排序：

### 第一优先：直接影响任务成功率

| 优先级 | 切片 | 关键缺口 | 理由 |
|--------|------|---------|------|
| **P0** | P2.3 WebFetch 深度 | preflight/cache/summary/browser | 调研是目前 Claude Code 有而 Vigilon 最弱的工具。对标 Codex in-app browser |
| **P0** | P2.0 LLM Transport 深度 | retry/fallback/自动降级 | 网络波动导致任务全失败——这是最影响可靠性的缺口 |
| **P0** | P2.2 Edit/Write Safety | stale check/atomic write 验证 | 静默覆盖用户修改是不可接受的 bug |

### 第二优先：提升代码理解和上下文质量

| 优先级 | 切片 | 关键缺口 |
|--------|------|---------|
| P1 | P2.1 Code Intelligence | LSP 降级路径、AST fallback、结果预算 |
| P1 | P2.8 Prompt Cache | cache break detection、自动审计 |
| P1 | P2.4 Plan/Todo | 状态链一致性验证、plan 阶段写操作真限制 |

### 第三优先：长期可靠性和扩展性

| 优先级 | 切片 | 关键缺口 |
|--------|------|---------|
| P2 | P2.6 Memory | 所有权模型、外部内容门控 |
| P2 | P2.7 Extensions | schema-not-sent recovery、disallowed-tools |
| P2 | P2.5 Compact | capability delta replay 验证 |

### 对标驱动的增量

| 增量 | 来源 | 理由 |
|------|------|------|
| 浏览器 Agent 基础 | Codex in-app browser | WebFetch 不够——需要能浏览、填写、点击 |
| `/goal` 持久化 | Codex + Claude Code | 两个对家同时发布，是已验证需求 |
| 项目上下文深度感知 | Vigilon 差异化 | AX Tree 是 Codex 壁垒，但项目级上下文是 Vigilon 的天然优势 |

---

## 验收标准

每片完成后必须通过真实任务链路验证，不接受"模块存在"或"单元测试通过"作为完成证据：

1. **P2.0**：模拟网络中断和模型超载 → Agent 自动重试/降级 → 任务继续完成
2. **P2.1**：陌生 TypeScript 仓库 → Agent 用 ≤5 次搜索定位跨文件 bug → 用 LSP 验证定义和引用
3. **P2.2**：并发修改场景 → Agent 检测到 stale state → 报可恢复错误（不是静默覆盖）
4. **P2.3**：Agent 读取外部文档 → 处理 redirect/paywall/大页面 → 摘要进入上下文
5. **P2.4**：高风险任务 → 进入 plan 模式 → 写操作被限制 → 用户批准后执行 → todo 与最终报告对齐
6. **P2.5**：16h 任务模拟 → 多次 compact → 恢复后状态一致（已有 probe gate）
7. **P2.6**：用户查看/编辑/删除 memory → 不影响 Agent 核心行为 → 外部内容不自动进 memory
8. **P2.7**：skill + MCP tool + deferred tool + hook 同时工作 → 一个失败不影响其他
9. **P2.8**：模型更新后 → 审计显示 cache break 原因 → tool schema 变化可追溯

---

## 与三目标愿景的关系

Phase 2 补齐能力后，Phase 3 的三目标（感知/自进化/安全）有了扎实的基座：
- **强 WebFetch/浏览器 → 感知**：Agent 能上网看文档、看网页，感知的信息源拓宽
- **强 retry/fallback/错误恢复 → 自进化**：失败 → 恢复 → 记录 → 下次更好的循环
- **强 safety/audit → 安全**：可审计的行动链是可信任自主性的前提
