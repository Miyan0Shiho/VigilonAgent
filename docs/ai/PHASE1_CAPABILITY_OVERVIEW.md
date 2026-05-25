# VigilonAgent Phase 1 — 能力综述

> v0.1.0 完成态。面向后续模型/开发者交接的完整系统画像。

---

## 1. 系统架构

### 1.1 仓库结构

```
VigilonAgent/
├── packages/
│   ├── runtime/       # 核心 Agent 运行时 (CLI + 工具 + 会话 + 权限 + 子代理)
│   │   ├── src/
│   │   │   ├── cli.ts              # CLI 入口 (run/resume/init/doctor/compact/memory/sessions/agents/tui)
│   │   │   ├── cli/                # CLI 解析 + 显示
│   │   │   ├── model/
│   │   │   │   ├── deepseek.ts     # DeepSeek API 客户端 (流式 + token计数 + per-request model override)
│   │   │   │   └── finRouter.ts    # Fin 自动模型路由
│   │   │   ├── runtime/
│   │   │   │   ├── agentLoop.ts    # 核心 Agent 循环 (无限循环 + 50 turn 电路保护器)
│   │   │   │   ├── agentDefinitions.ts  # Agent 定义 + 加载 (built-in/user/project/local)
│   │   │   │   ├── subagent-runner.ts   # 子代理执行器
│   │   │   │   ├── compact.ts      # 上下文压缩 (3 策略: session-memory/reactive/legacy)
│   │   │   │   ├── context.ts      # 上下文窗口构建
│   │   │   │   ├── context-injection.ts # 系统提示词 + 上下文注入
│   │   │   │   ├── permissions.ts  # 权限门控 (4 模式 + 协调器)
│   │   │   │   ├── safetyPolicy.ts # Bash 安全策略
│   │   │   │   ├── sandbox.ts      # macOS Seatbelt 沙箱
│   │   │   │   ├── hooks.ts        # PreToolUse 钩子
│   │   │   │   ├── mcp.ts          # MCP 客户端 (stdio transport)
│   │   │   │   ├── skills.ts       # Skill 加载 + 注入
│   │   │   │   ├── sessionMemory.ts    # 会话记忆 (生成/刷新/验证)
│   │   │   │   ├── projectMemory.ts    # 长期记忆 (promote/manifest/index)
│   │   │   │   ├── projectInstructions.ts # 项目指令 (AGENTS.md/VIGILON.md)
│   │   │   │   ├── transcript.ts   # JSONL 转录存储
│   │   │   │   ├── taskManager.ts  # 任务管理器
│   │   │   │   ├── taskControl.ts  # 任务停止控制
│   │   │   │   ├── requestAudit.ts # LLM 请求审计事件
│   │   │   │   ├── requestCache.ts # 请求缓存前缀管理
│   │   │   │   ├── postCompactStateRegistry.ts # Compact 后状态清理
│   │   │   │   ├── settings.ts     # 设置加载 (global/project/local)
│   │   │   │   └── contracts.ts    # 全部类型定义
│   │   │   ├── tools/              # 26 工具实现
│   │   │   └── services/lsp/       # LSP 集成 (客户端/管理器/诊断)
│   │   └── test/                   # 211 单元测试
│   └── tui/                        # 终端 UI (Ink/React)
│       ├── src/
│       │   ├── components/         # React 组件 (Shell/Composer/MessageStream)
│       │   ├── runtime/            # TUI 运行时适配 (nodeAdapter/operatorView)
│       │   └── render/             # Markdown + 文本渲染
│       └── test/                   # 44 TUI 单元测试
├── docs/                           # 产品文档 + 研究笔记 + 规范
└── .vigilon/                       # Agent 运行时数据 (会话/记忆/快照)
```

### 1.2 运行时数据流

```
用户输入 → CLI/TUI
  → resolveOptions (加载 settings/skills/MCP/project instructions)
  → createDeepSeekModelClient (或 createFinModelClient for auto-routing)
  → createVigilonAgentRuntime
    → buildStaticSystemPrompt (byte-identical, cached)
    → buildDynamicContext (workspace/skills/permissions — suffix)
  → runTurn() 循环:
    1. contextWindow = buildModelContextWindow(transcript)
    2. events = injectSkillListing(injectRuntimeProgress(injectActiveTask(
         injectCapabilityReplay(injectSessionMemory(contextWindow.events)))))
       + injectDynamicContext 作为最外层包装
    3. filterModelVisibleEvents → 发送给 DeepSeek API
    4. 模型返回 content + toolCalls
    5. 对每个 toolCall:
       a. permissionGate.requestPermission()
       b. saveAutoSnapshot() (对 Write/Edit/Bash/ApplyPatch)
       c. tool.invoke()
       d. 追加 tool-result 到 transcript
    6. 若 stopReason === end_turn → 自然停止
    7. 若工具调用 → 回到步骤 2
```

---

## 2. 工具面 (26 Tools)

### 2.1 文件读写

| 工具 | 功能 | 关键特性 |
|------|------|----------|
| **Read** | 读取文本/图片/PDF | 全文缓存 + 去重 stub + offset/limit + ignore 检查 |
| **Write** | 创建/覆写文件 | 覆写前要求先 Read + diff 生成 |
| **Edit** | 单文件替换 | replace_all + 模糊引号匹配 + stale 检测 |
| **ApplyPatch** | 原子多文件补丁 | `git apply` 封装 + check 模式 |

### 2.2 搜索与浏览

| 工具 | 功能 |
|------|------|
| **Glob** | 文件名匹配搜索 |
| **Grep** | 正则内容搜索 |
| **ListDir** | 目录浏览 (替代 `ls`) |
| **ToolSearch** | 延迟工具发现 |
| **WebFetch** | HTTP 请求 (15min 缓存) |

### 2.3 代码智能

| 工具 | 功能 |
|------|------|
| **LSP** | 定义跳转/引用/符号/诊断/悬停/层级 |
| **Notebook** | `.ipynb` 读写 (cell 级别) |

### 2.4 执行

| 工具 | 功能 | 关键特性 |
|------|------|----------|
| **Bash** | Shell 命令 | 安全策略评估 + macOS sandbox + 后台任务 |
| **RunTests** | 测试运行 | 自动发现测试命令 |
| **Git** | git 操作 | diff/log/show/blame/status |

### 2.5 子代理

| 工具 | 功能 | 关键特性 |
|------|------|----------|
| **Agent** | 单/多子代理分发 | 同步 + 后台 + tasks[] 并发 + git-worktree 隔离 |
| **AgentInventory** | 子代理状态查看 | 定义列表 + 活跃/保留任务 |
| **TaskStop** | 停止后台任务 | 共享任务管理器 |

### 2.6 规划与记录

| 工具 | 功能 |
|------|------|
| **TodoWrite** | 任务清单 (主要规划工具) |
| **EnterPlanMode** | 进入计划模式 (phase=plan, 写操作锁定) |
| **ExitPlanMode** | 退出计划模式 (恢复执行权限) |
| **ResultReport** | 结构化交接报告 |
| **Note** | 持久化跨会话记忆 (user/feedback/project/reference) |
| **Snapshot** | 工作区快照 (save/restore/list) |

### 2.7 交互与配置

| 工具 | 功能 |
|------|------|
| **AskUserQuestion** | 结构化用户提问 |
| **Skill** | 加载 Skill 指令 |
| **Config** | 读写运行时配置 |

---

## 3. 权限与安全

### 3.1 权限模式

| 模式 | 行为 |
|------|------|
| `read-only` | 只允许读操作 + 低风险 bash |
| `ask` | 非读操作需要交互确认 |
| `accept-edits` | 自动允许低风险读写和编辑 |
| `bypass-local` | 允许所有本地操作 |

### 3.2 Bash 安全策略

- 命令分类: `LOW_RISK` (cat/ls/grep) / `WRITE` (cp/mv/mkdir) / `HIGH_RISK` (rm/sudo)
- Shell wrapper 检测 (bash/sh/zsh/xargs)
- Shell injection 特征检测 ($(...) / backticks)
- Sed -i 代理: 自动转为 Edit 工具调用 (支持地址前缀 `1s/.../`, `2,5s/.../g`)
- macOS Seatbelt sandbox 可选强制

### 3.3 权限门控流程

```
tool.invoke() 前:
  → permissionGate.requestPermission(action, subject, risk, reason)
  → PermissionResolutionCoordinator (同请求去重)
  → decidePermission(mode, request)
    → sandboxDecision === 'denied' → 拒绝
    → mode === 'bypass-local' → 允许
    → mode === 'read-only' → 仅读
    → mode === 'accept-edits' → 读写
    → mode === 'ask' → 阻塞 (需 operator)
```

---

## 4. 会话管理

### 4.1 Transcript

- JSONL 格式持久化 (`<sessionsDir>/<workspace-slug>/<sessionId>.jsonl`)
- 支持事件类型: user/assistant/tool-call/tool-result/permission/hook/session-state/subagent-lifecycle/compact-boundary/llm-request/llm-response/request-stability/lsp-diagnostics/content-replacement/project-config
- `JsonlTranscriptStore` (文件) / `InMemoryTranscriptStore` (测试)

### 4.2 Compact (上下文压缩)

- 3 策略: `session-memory` (优先) → `reactive` (回退) → `legacy` (最终回退)
- Auto-compact: 最新 boundary 后新事件超过阈值 (30) 时触发
- Token 压力: 先字符估算 → 可选 LLM preflight countInputTokens
- Compact boundary 保存 head/anchor/tail 事件引用
- Post-compact cleanup: 重建上下文窗口 + capability replay

### 4.3 Session Memory

- 自动生成: `scheduleSessionMemoryExtraction()` 从转录事件提取
- 手动管理: `memory write/edit/delete/refresh/validate` CLI 命令
- 新鲜度: fresh (最新 boundary 后生成) / stale (过期)
- Grounding validation: 可选 LLM 验证记忆与转录一致性

### 4.4 Long-term Memory

- 类型: user / feedback / project / reference
- 存储: `.vigilon/memory/topics/<kind>/<topic>.md`
- 索引: `MEMORY.md` (markdown 表格) + `memory.manifest.json` (JSON)
- 策略: 仅手动 promote (无自动写入)

---

## 5. 模型集成

### 5.1 DeepSeek 客户端

- 模型: deepseek-v4-flash / deepseek-v4-pro / auto
- 流式: raw stream + 自维护 contentBlocks (跳过高层 BetaMessageStream)
- Per-request 覆盖: `model` + `thinking` 字段
- Thinking 支持: `thinking: { type: 'enabled' }` 请求参数, `reasoningContent` 响应字段
- Token 计数: `countInputTokens()` (max_tokens=1 trick)
- 重试: 2 attempt + 可重试状态码 + tool_choice 降级
- 上下文溢出检测

### 5.2 Fin 自动路由

- 每 turn 前用 flash (thinking=off) 调用分类
- 分类: `{"model":"flash"|"pro","thinking":"off"|"high"}`
- 5s 超时 + 失败回退 flash
- Prompt 中提取任务上下文 (最近 3 条 user 消息, 最多 3000 字符)

### 5.3 Cache 策略

- 静态系统提示词: `buildStaticSystemPrompt()` — byte-identical 跨 turns
- 动态上下文: `buildDynamicContext()` — 附加在末尾
- DeepSeek prefix cache 自动缓存静态前缀
- 实测命中率: 67-86%

---

## 6. 子代理系统

### 6.1 Agent 类型

| 类型 | host | background | 说明 |
|------|------|-----------|------|
| general-purpose | local | false | 默认内置, maxTurns=10, 工具: Read/Grep/Glob/Bash/ResultReport |
| 自定义 | local/worktree/git-worktree | 可选 | `.vigilon/agents/*.md` 定义 |

### 6.2 执行模式

- **同步**: `background: false` — 主代理等待完成, 结果内联返回
- **后台**: `background: true` — 立即返回, 通过 `AgentInventory` 查看状态
- **并发**: `tasks: ["task1", "task2"]` — Promise.all 并行
- **隔离**: `host: worktree` — 复制工作区 / `host: git-worktree` — git worktree

### 6.3 子代理生命周期

```
main turn → AgentTool.invoke()
  → createSubagentRunner
  → JsonlTranscriptStore (独立转录)
  → createVigilonAgentRuntime (独立 agent loop)
  → taskManager.startSubagentTask
  → subagentLifecycle events (started/model-request/tool-finished/completed)
  → 结果回传 (finalMessage + transcriptPath + worktreeDiff)
```

---

## 7. 设计决策记录

| 决策 | 理由 | 参考 |
|------|------|------|
| 无 turn 限制 (50 turn 电路保护器) | 模型应通过 end_turn 自然停止 | DeepSeek-TUI 无 turn 限制 |
| System prompt 静态/动态拆分 | 最大化 DeepSeek prefix cache | Claude Code SYSTEM_PROMPT_DYNAMIC_BOUNDARY |
| TodoWrite 作为主要规划工具 | DeepSeek 不主动使用 EnterPlanMode | DeepSeek-TUI checklist_write |
| Full-file read 缓存 + 去重 stub | 防止重读浪费 turn | Claude Code file_unchanged protocol |
| 子代理信任信号 ("✅ completed") | 防止主代理重验证 | DeepSeek-TUI structured handoff |
| Snapshot + Auto side-git | 工作区保护 | DeepSeek-TUI side-git snapshots |
| Read 工具 servedFromCache | 全文缓存后按需返回片段 | Claude Code readFileState |

---

## 8. 已确认限制

| 限制 | 说明 |
|------|------|
| DeepSeek 不主动使用 EnterPlanMode | 工具功能正常, 需显式指示 |
| DeepSeek 不主动触发 git-worktree | 需显式 `host: git-worktree` agent 定义 |
| LSP 诊断有 500ms 竞态 | didOpen 后异步诊断到达, 首次调用可能返回空 |
| typescript-language-server 需在 PATH | 或通过 node_modules/.bin 自动解析 |
| Worktree 子代理测试偶发失败 | 文件变更检测依赖环境 |

---

## 9. 测试覆盖

- **运行时单测**: 211 tests, 30 test files (agent loop, tools, permissions, compact, memory, CLI...)
- **TUI 单测**: 44 tests, 9 test files
- **端到端**: 6 个真实任务全通过 (deepseek-v4-pro, 126 turns, 0 硬截断)
- **能力测试**: 23 项能力链路验证 (Session Resume, Compact, Memory, WebFetch, MCP, Notebook...)
- **权限测试**: read-only/ask/accept-edits/bypass-local + Bash 安全策略
- **Cache 测试**: 67-86% 命中率 (v4-pro 真实任务)
