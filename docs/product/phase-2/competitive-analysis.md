# Phase 2 对标分析：Codex & Claude Code（2026 年 5 月）

分析日期：2026-05-27
分析范围：Codex CLI 0.128.0 → 0.134.0、Claude Code v2.1.128 → v2.1.152

---

## `/goal` 趋同——行业共识已形成

Codex（2026 年 4 月）和 Claude Code（2026 年 5 月 12 日）在几周内先后发布 `/goal`——Agent 在无人干预下自主循环执行直到目标达成。

### 架构对比

| 维度 | Codex CLI | Claude Code |
|------|-----------|-------------|
| 持久化 | SQLite，进程重启后恢复 | Session 级，退出即丢失 |
| 停止判断 | 主模型自评是否完成 | 外部小模型（Haiku）每轮评判 |
| 预算控制 | token_budget + budget_limited 状态机 | turn 上限 |
| 多 Agent | MultiAgentV2：多环境并发 goal，Agent Graph Store | 单 session 单 goal |
| 默认审批 | plan-mode nudge（决策点内联确认） | Trust dialog（workspace 级信任） |
| 模型工具 | 仅 3 个（create_goal, update_goal, get_goal），pause/resume 仅人类可控 | — |

### Codex `/goal` 架构要点

```
TUI / Slash Command UX
    ↓
Core Runtime (Event Bus) — turn lifecycle hooks, accounting
    ↓
Model Tools — create_goal, update_goal(complete only), get_goal
    ↓
App-Server API (JSON-RPC) — thread/goal/set|get|clear
    ↓
SQLite Persistence — thread_goals table
```

- **5 层栈**：UX → Runtime → Model Tools → API → SQLite
- **goal 状态机**：active → paused / budget_limited / complete
- **goal_id 版本化**：每次替换生成新 UUID，旧 inflight accounting 静默丢弃
- **预算原子执行**：SQL CASE 语句内联执行，无 check-and-set 竞态
- **自动续跑**：TurnFinished → MaybeContinueIfIdle → 发起续跑轮次
- **停止护栏**：terminal 状态 / 零工具调用轮次 / Semaphore(1) 锁 / plan mode 忽略

### 对 Vigilon 的启示

- 验证了问题域 C（规划与长程连续性）的核心冲突
- SQLite 持久化方案值得参考——Vigilon 的 life segment checkpoint 可以借鉴其状态机设计
- **关键脆弱点**：goal 完成的判断标准。Codex 让主模型自评（可能过于乐观），Claude Code 用外部模型评判（增加成本和延迟）——两种方案都有明显缺陷。Vigilon 的 objective drift 检测可能提供第三种方案

---

## 多 Agent：从实验到基础设施

### Codex MultiAgentV2

- **Agent Graph Store**：抽象化 sub-agent 父子拓扑，为远程存储铺路
- **多 goal 并发**：不同环境/线程各自独立的 goal
- **CSV 扇出**：`spawn_agents_on_csv`——从 CSV 批量启动 Agent，带进度和 ETA
- **Thread caps**：显式配置最大线程数
- **Subagent hints**：V2 特定的深度处理和等待时间控制

### Claude Code

- **Agent View**（`claude agents`）：运行中/阻塞/完成 session 的统一仪表盘
- **Worktree 隔离**：`worktree.baseRef`（`fresh`/`head`），subagent 独立 git worktree
- **背景 session**：后台 agent 持续运行，完成后通知

### 对 Vigilon 的启示

- 验证了问题域 E（多 Agent 协作）
- Codex 的 Agent Graph Store + 父子拓扑是值得借鉴的概念——Vigilon 也需要 Agent 拓扑管理
- CSV 扇出说明"批量 Agent 管理"已是产品需求——Vigilon 的 E3（Agent 数量爆炸）不是过度设计
- **蓝海**：两个工具的多 Agent 都还停留在"启动多个独立 worker"，没有 Agent 间的冲突治理、异议保留、背书质疑——这正是 Vigilon E1/E2 的差异化空间

---

## Memory：从功能到攻击面（同一周发生）

2026 年 5 月，三件事同时发生：

1. **Codex Memory（预览）**上线——跨 session 记住偏好、纠正和上下文
2. **OWASP** 发布 ["Memory Is a Feature. It Is Also an Attack Surface"](https://genai.owasp.org/2026/05/13/memory-is-a-feature-it-is-also-an-attack-surface/)
3. **OpenAI** 更新 [Memory and new controls for ChatGPT](https://openai.com/index/memory-and-new-controls-for-chatgpt/)

这验证了问题域 B（信念/知识/记忆）的核心冲突——memory 同时是体验增强和攻击面。行业正在意识到这个问题但**还没有人解决好**。

### 对 Vigilon 的启示

- Memory ownership model（user/project/organization/agent/tool 五层所有权）有机会成为差异化
- Belief registry（source/evidence/category/expiry）在行业中尚无对应产品
- OWASP 的关注意味着 memory security 会变成合规要求——Vigilon 提前架构有先发优势

---

## 安全与权限：从二元开关到细粒度治理

### Codex

- **弃用 `--full-auto`**，改为 **Permission Profiles**：列表 API、继承、managed `requirements.toml`、运行时刷新
- **Windows sandbox** 集成加强
- **远程 desktop use 安全**：短时授权、屏幕遮盖、本地输入时自动重锁
- **Hooks 扩展**：subagent start/stop、tool execution、turn metadata、async approval

### Claude Code

- **Auto mode** 硬拒绝规则
- **`disallowed-tools`**：skill frontmatter 中禁用特定工具
- **Hooks 生命周期**：PreToolUse 上下文、before/after compaction hooks
- **MessageDisplay hook**：可转换或隐藏 assistant 消息的显示文本

### 对 Vigilon 的启示

- 验证了问题域 F（运行时安全）和 G（行动授权）
- 行业趋势：**二元开关 → 细粒度治理**（profile 继承、作用域限制、hooks 拦截点）
- Vigilon 的"行动分类（可逆/需确认/需人在场/禁止）+ 审计链"方向与行业一致
- **蓝海**：安全摩擦成本（问题 F3/F4）——两个工具都没解决"安全机制重到用户绕过"的问题

---

## 自改进：早期形态，距自进化尚远

### 当前行业水平

- **Codex Auto-Review**：后台 ghost-commit watcher，独立 worktree 运行 review，产出问题 + 可应用的修复
- **Claude Code `/code-review --fix`**：review → 自动应用修复到 worktree
- **Claude Code `/simplify`**：`/code-review --fix` 的别名

### 对 Vigilon 的启示

- 行业处于"**单任务自检查**"阶段
- Vigilon 瞄准的"**跨任务自进化**"仍是蓝海——经验提取、技能泛化、进化验证与回退、跨用户 skill 传播——这些没有对家在做的
- Auto-Review 的工作模式（独立 worktree，不阻塞主线程）值得 Vigilon 的进化验证机制借鉴

---

## 环境感知：从"等用户开口"到"看用户在做什么" ★

这是 2026 年 5 月对 Vigilon 最重要的外部信号。Codex 在两条线上同时推进：

### Computer Use（macOS 桌面自动化）

Codex 可操作 macOS 桌面应用，在后台运行，多个 Agent 并行：
- 不只是终端——可以操作浏览器、IDE、文档工具、设计软件
- Mac 锁定后仍可远程工作（短时授权 + 屏幕遮盖 + 本地输入自动重锁）
- 多个 Agent 并行操作不同应用

### Appshots（看用户在做什么）

双击 Cmd → **截取前台应用窗口的截图 + 提取可用文字** → 发送给 Codex。

这个功能的意义远超"快捷截图"。它改变了 Agent 感知用户意图的方式：

- **之前**：用户必须在聊天框里描述自己在做什么、遇到了什么问题
- **之后**：Agent 直接看到用户在看什么、在编辑什么、在哪个应用里卡住了

这是从 **"被动等用户开口"到"主动感知用户环境"** 的关键一步——直接对应 Vigilon 的问题域 A（意图理解与适应性引导）。

### 对 Vigilon 的启示

- Codex 在 Goal 1（感知）方向上的进展比预想的快。Appshots 本质上是一个**轻量级的环境感知层**——不需要全时录屏，不需要复杂集成，双击就能让 Agent 看到用户当前上下文
- Vigilon 的 A1（意图发现——从用户环境推断"可能值得做的事"）和 A5（前 5 分钟体验）需要重新思考：如果 Agent 能"看到"用户在做什么，onboarding 和意图发现的难度都会下降
- **安全边界**：Codex 的短时授权 + 屏幕遮盖 + 自动重锁是一个好的参考——环境感知必须在可信任边界内（问题域 F）
- **蓝海**：Codex 的 Appshots 是被动的（用户双击触发），Vigilon 可以更进一步——Agent 主动识别"用户可能在犹豫/卡住"的时刻并提供帮助（A4 适应性介入）

---

## 其他值得注意的动向

### 语音与多模态

- Codex `/realtime` 语音模式（实验），支持后台 agent 进度流式播报
- 两个工具都在增加多模态能力

### 插件市场

- 两个工具都在 5 月上线了插件市场
- 这意味着 MCP/plugin supply-chain security 会加速变成显性问题（验证问题域 F2）

### 交互体验

- Codex Vim mode、TUI 增强（resume/fork picker、`/theme`、语法高亮）
- Claude Code `/effort`（推理深度控制）、Fast Mode 默认 Opus 4.7

---

## 对 Vigilon Phase 2 的关键判断

| # | 判断 | 影响的问题域 |
|---|------|------------|
| 1 | **Computer Use + Appshots = 感知范式转变**。Agent 从"等用户在聊天框描述"进化到"看用户在做什么"。这是 Goal 1 最重要的外部验证 | A, F |
| 2 | `/goal` + 持久化 = 已验证需求。Vigilon 的 life segment + drift 检测方向正确 | C |
| 3 | Memory 是下一个战场。Codex 和 OWASP 同时关注，窗口正在打开。Belief registry 有机会成为差异化 | B |
| 4 | 跨任务自进化仍是蓝海。Codex/Claude Code 的"自改进"局限在单任务内 | D |
| 5 | 安全从二元开关进化到治理。Permission Profiles + hooks 是行业方向 | F, G |
| 6 | 多 Agent 正在从"启动多个 session"进化到"Agent graph topology" | E |
| 7 | 插件市场 → 供应链安全加速变成显性问题 | F |
| 8 | 持久化 goal 的完成判断是最脆弱的一环——两种方案都有缺陷，Vigilon 可能有第三种方案 | C |
| 9 | 安全摩擦成本（检查太频繁→用户绕过）——两个工具都没解决 | F |

---

## 更新日志

- 2026-05-27：初始版本，覆盖 Codex 0.128.0→0.134.0、Claude Code v2.1.128→v2.1.152
