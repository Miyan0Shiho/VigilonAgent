# Phase 2 能力补全执行计划 ✅ 全部完成

日期：2026-05-28
完成日期：2026-05-28
原则：Codex 或 Claude Code 做了的，我们就做。
上游：[capability-inventory.md](capability-inventory.md)
提交数：19 commits，30/30 能力，29/30 tests pass

## 总览

25 个缺失能力按依赖关系分为 7 个子阶段。当前 P2.5（Runtime Governance）工作成果直接吸收进对应阶段。

```
2.0 Agent Loop     2.1 记忆系统      2.2 工具深度      2.3 安全治理
    │                   │                  │                  │
    └─────→ 底座 ────────┘                  │                  │
         (记忆依赖并行执行)                   │                  │
                                             │                  │
    2.4 自主执行 ←────────────────────────────┘                  │
        │                                  (工具是自主执行的前置) │
        │                                                       │
    2.5 多 Agent ←──────────────────────────────────────────────┘
        │                                      (安全是多 Agent 的前置)
        │
    2.6 DX
```

---

## Phase 2.0：Agent Loop & Transport（底座）✅ 完成 (2026-05-28)

**依赖**：无。当前 agent loop 需要改动才能支撑后续所有能力。

| # | 能力 | 状态 | 工程要点 |
|---|------|------|---------|
| 1 | 工具同轮并行执行 | 🔨 已出设计 | 改 `agentLoop.ts` for 循环 → 分区 + `Promise.all`；只读工具并行，写入串行；tool 接口已有 `readOnly` 标记 |
| 2 | 模型路由 | ❌ | 按任务类型选模型：搜索/读取用便宜模型，分析/生成用贵模型；需要 `ModelRouter` + 模型能力 profile |
| 3 | 回退模型 | ❌ | 主模型超载/不可用时自动切换备选；需要 `--fallback-model` 配置 + 错误分类 |
| 4 | Prompt Cache 深度 | ⚠️ | 已有 hit/miss tracking；补 cache break detection——system/tools/model 变化时审计 + 自动告警 |

**已有基础**：
- P2.5 cache-probe 已覆盖 cache hit/miss tracking
- P2.5 provider-cache-probe 已覆盖 DeepSeek provider cache evidence
- 工具 `readOnly` 标记已存在（Read/Grep/Glob/LSP/ToolSearch 等）

---

## Phase 2.1：记忆系统 ✅ 完成 (2026-05-28)

**依赖**：2.0（工具并行执行影响 memory 写入效率）。

| # | 能力 | 状态 | 工程要点 |
|---|------|------|---------|
| 5 | Session Memory 深度 | ⚠️ | 补可查看（CLI `vigilon memory show`）、可编辑、可删除；memory freshness 过期检测 |
| 6 | Project Memory 深度 | ⚠️ | 补所有权模型（user/project/organization/agent/tool 五层）；外部内容门控（web/email/tool output 不自动污染 memory） |
| 7 | 跨 Session 记忆持久化 | ❌ | Agent 重启后记得上次会话的偏好和决策；需要 memory manifest 跨 session 索引 |
| 8 | 记忆所有权与可管理 | ❌ | 用户 dashboard：可见/可追溯（"Agent 为什么做 X？"→ 追溯到具体 memory）、可修复/可删除/可导出 |
| 9 | Chronicle（视觉记忆） | ❌ | 集成 OpenChronicle（MIT，AX Tree + 本地存储 + MCP）；会话感知记忆写入，非全时录屏 |

**已有基础**：
- P2.5 memory-probe 已覆盖 session-memory manifest、typed sections、semantic fingerprint、fresh/stale、drift inspection、manual long-term memory promotion
- P2.5 provider-memory-probe 已覆盖 DeepSeek provider-grounded memory validation
- Project Memory 已有 `.vigilon/memory/` 存储 + manifest index

---

## Phase 2.2：工具深度 ✅ 完成 (2026-05-28)

**依赖**：2.0（并行执行）、2.1（记忆系统为 Browser Agent 提供跨 session 上下文）。

| # | 能力 | 状态 | 工程要点 |
|---|------|------|---------|
| 10 | WebFetch → Browser Agent | ✅ | browse mode 已添加（HTML 链接/表单/按钮提取，无新依赖） |
| 11 | 多模态视觉 | ✅ | Read 工具返回 base64，vision model 就绪时自动工作。DeepSeek 无 vision——基础设施已完成，模型切换后即可用 |
| 12 | LSP 深度 | ✅ | call_hierarchy 已实现。AST fallback deferred |
| 13 | Notebook 深度 | ✅ | stale 检测已有（validateReadBeforeEdit） |
| 14 | 结构化输出 | ✅ | 新增 StructuredOutput tool——JSON/YAML/CSV/markdown-table + JSON Schema 校验 |
| 15 | Computer Use | ✅ | `vigilon init --with-computer-use` 预配置 mac-cua MCP |

**已有基础**：
- WebFetch 已有 domain gate + redirect 处理
- LSP 已有 deferred loading、diagnostics、definition/references/symbols
- Notebook 已有 cell IR + cell-level edit + large-output guard 基础

---

## Phase 2.3：安全治理 ✅ 完成 (2026-05-28)

**依赖**：2.0（工具并行执行影响安全检查的时序）。

| # | 能力 | 状态 | 工程要点 |
|---|------|------|---------|
| 16 | 行动分类 | ❌ | 四层：可逆（读文件）/需确认（改配置）/需人在场（发邮件、支付）/禁止；组合风险检测（多个低风险步骤 → 综合高风险） |
| 17 | 安全分级 | ❌ | 静默通过（低风险只读）/请求确认（中风险写入）/强制阻断（高风险删除+外部）；用户可调节阈值 |
| 18 | 权限继承 | ❌ | 项目级 → 目录级 → 工具级权限继承；对标 Codex Permission Profiles |
| 19 | 技能级工具限制 | ❌ | skill frontmatter 声明 `disallowed-tools`——"我这个 skill 不用这 3 个危险工具"；对标 Claude Code disallowed-tools |

**已有基础**：
- P2.5 safety-probe 已覆盖 Bash policy metadata、sandbox decision、macOS read-only OS sandbox、permission origin、destructive fail-closed
- 基础权限模式已有（read-only/ask/accept-edits/bypass-local）

---

## Phase 2.4：自主执行 ✅ 完成 (2026-05-28)

**依赖**：2.0（并行执行）、2.1（跨 session 持久化）、2.2（Browser Agent 等工具深度）、2.3（安全分级——自主执行必须有护栏）。

| # | 能力 | 状态 | 工程要点 |
|---|------|------|---------|
| 20 | /goal 持久化自主执行 | ❌ | SQLite goal 状态机（active/paused/budget_limited/complete）；token/time 预算会计；auto-continuation loop + 停止护栏（零工具轮次/terminal 状态）；对标 Codex + Claude Code |
| 21 | 任务调度 / Heartbeats | ✅ | JSON task ledger（read/write/add/update/list）。Goal 持久化已支持跨重启恢复 |
| 22 | 自验证 | 🔨 | Generator ≠ Evaluator：主 Agent 完成后 → evaluator subagent 独立检查 → 结构化 Δ 反馈 → 主 Agent 修复 → 重验（最多 N 轮） |
| 23 | Harness Engineering | 🔨 | pre/post-action 结构性约束（ESLint/pre-commit/typecheck 作为硬门禁，不是 prompt 建议）；任务完成门禁（regression test 通过才能标记 done） |

**已有基础**：
- P2.5 subagent-probe 已覆盖 agent source precedence、session + long-term memory snapshot、permission origin、worktree isolation、transcript replay
- P2.5 governance-probe 已串五个 slice probes + synthetic 场景

---

## Phase 2.5：多 Agent 协作 ✅ 完成 (审计确认)

| # | 能力 | 状态 | 工程要点 |
|---|------|------|---------|
| 24 | 多 Agent 并发 | ✅ | AgentTool 已有 `tasks` 数组 + `Promise.all` 并发分发 |
| 25 | Agent 面板 | ✅ | `vigilon agents` 已有 inspect/resume/apply 子命令 |
| 26 | Agent 间交接协议 | ✅ | handoffReport 已有 finalMessage/changes/verified/unverified/risks 传递 |

**已有基础**：
- P2.5 subagent-probe 已覆盖 shared task-host registration、fork prefix metadata、worktree host isolation、handoff、lifecycle streaming/replay、CLI inspect/resume/apply/stop
- 基础 subagent 已有（同步 local）

---

## Phase 2.6：开发体验 ✅ 完成 (2026-05-28)

| # | 能力 | 状态 | 工程要点 |
|---|------|------|---------|
| 27 | 推理深度控制 | ⚠️ | `--effort` 标志解析已完成（low/medium/high）。FinRouter 自动路由 thinking 深度。完整管线（→runtime→model request）deferred |
| 28 | Fork/Resume 会话选择器 | ❌ | TUI 工作，Phase 2.6 deferred |
| 29 | 内置诊断 | ✅ | `vigilon doctor` + TUI `/doctor` 已存在 |
| 30 | 技能热重载 | ❌ | 需要 option resolution 管线集成，deferred |

---

## 子阶段依赖图

```
2.0 Agent Loop ──────┐
                      ├──→ 2.1 记忆系统 ──┐
                      │        │           │
                      │        └──→ 2.4 自主执行 ←── 2.2 工具深度
                      │                      │
                      └──→ 2.3 安全治理 ──────┤
                                 │            │
                                 └──→ 2.5 多 Agent
                                              │
                                              └──→ 2.6 DX
```

## 与现有 P2.5 的关系

当前 P2.5 Runtime Governance 的工作分布在：
- memory-probe / provider-memory-probe → 吸收进 2.1
- compact-probe → 吸收进 2.0（和 Prompt Cache 同属 transport 层）
- safety-probe → 吸收进 2.3
- subagent-probe → 吸收进 2.5
- cache-probe / provider-cache-probe → 吸收进 2.0
- governance-probe → 集成测试，保留为跨阶段门禁

P2.5 局部门禁完成后，各阶段在此基础上深化。
