# VigilonAgent 边界能力测试报告

**测试日期**: 2026-05-24
**测试模型**: deepseek-v4-flash（v4-pro 对比）
**测试环境**: macOS, pnpm monorepo
**修复项**: ✅ CWD fix, ✅ subagent maxTurns 10 + 模型可控, ✅ sed surrogate 地址前缀解析, ✅ anti-redundancy guidance

---

## 修复效果验证（重测）

| 问题 | 修复前 | 修复后 |
|------|--------|--------|
| CWD 路径 | `packages/runtime/.vigilon/sessions/` | `VigilonAgent/.vigilon/sessions/` ✅ |
| 子代理 maxTurns | 4（必超） | 10 + 模型可控 ✅ |
| sed surrogate 地址前缀 | `1s/.../` 无法识别 | 正则定位 `s` 命令 ✅ |
| "File unchanged" 浪费 | 10/49 次重读 | 仍存在（模型问题） |
| Compact + Resume | 通过 | 通过 ✅ |
| Memory Promote | 通过 | 通过 ✅ |

## 修复清单

| # | 问题 | 文件 | 修复方式 |
|----|------|------|----------|
| 1 | CWD 路径翻倍 | `transcript.ts` | `getProjectSessionDir` 默认用 cwd 而非 `process.cwd()` |
| 2 | 子代理 maxTurns=4 过紧 | `agentDefinitions.ts`, `agentTool.ts` | 默认→10，新增 Agent tool `maxTurns` 参数 |
| 3 | sed surrogate 无法解析地址前缀 | `safetyPolicy.ts` | 新增 `findSedSubstitution()`，正则定位 `s` 命令 |
| 4 | 反冗余引导缺失 | `parse.ts`, `nodeAdapter.ts`, `agentDefinitions.ts` | operator guidance 加 "Do not re-read" 提示 |

## 测试覆盖矩阵

| 能力链路 | 测试状态 | 结果 |
|----------|----------|------|
| Subagent 分发 | ✅ 已测+修复 | maxTurns 4→10，模型可控 |
| Context Memory（会话续接） | ✅ 已测 | 通过 |
| Session Resume | ✅ 已测 | 通过 |
| Compact（上下文压缩） | ✅ 已测 | 通过（98→20 events） |
| Compact 后上下文保留 | ✅ 已测 | 系统注入正确，模型忽略摘要 |
| Session Memory（会话记忆） | ✅ 已测 | 通过 |
| Long-term Memory（长期记忆 promote） | ✅ 已测 | 通过 |
| Git 操作 | ✅ 已测 | 通过（macOS 自适应 `/usr/bin/git`） |
| Bash 安全策略（rm -rf 拦截） | ✅ 已测 | `"safety policy denied"` 正确拦截 |
| Sed surrogate（sed -i → Edit） | ✅ 已测+修复 | 修复地址前缀解析 bug |
| CWD 路径 | ✅ 已测+修复 | sessions 从 `packages/runtime/` → repo root |
| Plan/Execute 阶段 | ⚠️ 模型规避 | DeepSeek 不使用 plan mode |
| 子代理 worktree 隔离 | ⚠️ 模型规避 | DeepSeek 不触发 git-worktree |

---

## 详细发现

### 问题 1：CWD 路径翻倍 ✅ 已修复

**文件**: `packages/runtime/src/runtime/transcript.ts`

**根因**: `getProjectSessionDir` 的 sessions 目录基路径使用 `process.cwd()`（pnpm filter 改为 package 目录），而非用户指定的 `cwd` 参数。

**修复**: `sessionsDir` 默认值从 `getDefaultSessionsDir()`（依赖 `process.cwd()`）改为 `path.join(resolved, '.vigilon', 'sessions')`（依赖 `cwd` 参数）。

**验证**: 会话路径从 `packages/runtime/.vigilon/sessions/` → `VigilonAgent/.vigilon/sessions/`。

### 问题 2：子代理 turn 限制过紧 ✅ 已修复

**文件**: `packages/runtime/src/runtime/agentDefinitions.ts`, `packages/runtime/src/tools/agentTool.ts`

**根因**: `general-purpose` agent 的 `maxTurns=4`，搜索类任务需要 Glob + Grep + Read ×N，4 turn 不足以完成。

**修复**:
- 默认 maxTurns: 4 → 10
- Agent tool 新增 `maxTurns` 可选输入参数，模型可按需覆盖
- 子代理因 maxTurns 耗尽时，结果提示 "dispatch another Agent call with a higher maxTurns override to continue"

### 问题 3：sed surrogate 无法解析地址前缀 ✅ 已修复

**文件**: `packages/runtime/src/runtime/safetyPolicy.ts`

**根因**: `parseSedEdit` 用 `word.startsWith('s')` 匹配 sed 表达式，无法处理带地址前缀的命令（如 `1s/pattern/replacement/`、`2,5s/a/b/g`），导致 surrogate 不触发，命令直接交给 bash 执行后报错。

**修复**: 新增 `findSedSubstitution()` 函数，用正则 `/s([^a-zA-Z0-9])/` 定位 `s` 命令并验证前缀不是字母，正确提取 `s/pattern/replacement/flags` 部分。

### 问题 4：DeepSeek 模型能力导致 turn 浪费（模型限制，非系统 bug）

这不是系统 bug，但影响测试结果。记录供后续参考：

| 行为 | 影响 |
|------|------|
| 重复读取同一文件（skills.ts 被读 3 次） | 浪费 2-3 turns |
| 读完内容后不综合，继续搜索 | 浪费 3-5 turns |
| 尝试读 `.js` 后缀文件（源文件是 `.ts`） | 浪费 1-2 turns |
| 不支持 plan mode 工作流 | 无法测试 EnterPlanMode/ExitPlanMode |
| 不使用 git-worktree 子代理 | 无法测试 worktree diff/apply 链路 |

**ReadFileState 副作用**: 系统检测到 "File unchanged since last read" 返回提示，但这仍然消耗了一个 turn。如果模型不理解这个 feature，相当于每个重复读浪费 1 turn。

---

### 问题 4：macOS 沙箱下的 Git 噪音（环境问题）

在 macOS 上通过 Bash tool 执行 git 时产生 xcode-select 相关错误噪音，模型需要 2-3 次重试才能成功调用 git。这是一个环境适配问题，不是系统 bug，但影响了测试稳定性。

---

## 验证通过的功能

### Compact + Resume 上下文保留 ✅

完整链路测试通过：
1. 12-turn 对话（105 events）
2. `compact` 命令 → session-memory 策略 → 94 events 被摘要，12 events 保留
3. post-compact cleanup 正确执行（context-window rebuild, capability replay, content-replacement）
4. `resume` 后模型基于 compact 摘要正确回答了 "我们在分析什么文件？"

### Session Memory 生成 ✅

- 105 events → 自动生成结构化 memory.md
- 包含: Current Task, Important Files, Next Step
- Extraction 耗时 8ms（writing memory file）

### Long-term Memory Promote ✅

- `memory promote` 命令正确写入 MEMORY.md 索引
- Topic 文件创建在 `.vigilon/memory/topics/project/`
- 包含完整的 source metadata（sessionId, transcriptPath, sourceEventCount）

### Session Resume（基础上下文记忆） ✅

- `resume <sessionId>` 正确加载 transcript
- Session state（phase, permissionMode, todos, handoffReport）从 events 回放
- 模型能访问完整历史

---

## v4-flash vs v4-pro 对比（2026-05-24 补充测试）

| 维度 | v4-flash | v4-pro |
|------|----------|--------|
| 明确边界任务（读 2 文件总结） | 可完成，质量一般 | **2 turn 完成**，含流程图的高质量分析 |
| 开放搜索任务（"搜索所有 skill 实现"） | 20 turn 耗尽，10/49 次重读 | 20 turn 耗尽，幻觉出不存在文件 |
| 子代理使用 | 默认 maxTurns 用完就停 | **自主使用 maxTurns=15 override** |
| 重复读取 | 严重（same file ×3） | 较少但会读无关文件 |
| 幻觉倾向 | 低 | 中（编造 code-reviewer agent、injectSkillListing.ts） |

**结论**：两个模型都无法在 20 turn 内完成开放搜索+总结任务，但失败模式不同：
- v4-flash：信息收集能力强，但缺乏综合输出能力 → 永远在搜索
- v4-pro：综合能力强，但容易方向发散 → 幻觉 + 过度搜索

**系统判定**：同一系统、同一任务结构下，两个模型失败模式不同但都无法完成，确认瓶颈在模型推理能力而非系统架构。明确边界的简单/中等任务两者都能完成。

---

## 安全策略测试

`rm -rf /tmp/test_vigilon_safety_check` → Bash tool 调用 `evaluateBashSafetyPolicy()` → 识别为高风险命令 → `sandboxDecision: 'denied'` → permission gate 返回 `"safety policy denied action: high-risk shell command is denied before execution"`。系统安全策略正确拦截，命令未执行。

## Compact 生命周期测试（补充）

- **分析阶段**: 13 turn 完成 compact.ts + context.ts 多文件分析（修复后首次在 turn 限制内完成）
- **Compact**: 98 events → 20 条摘要 + 12 条保留，session-memory 策略，memory freshness=fresh
- **Resume 后**: 系统正确注入 compact 摘要（含 Important Files、Next Step），但 DeepSeek 忽略摘要重新读文件——确认为模型行为，非系统问题

---

## 最终结论

**系统架构验证通过**：CWD、Compact、Session Resume、Memory Promote、Bash Safety Policy、Sed Surrogate 全链路正确。

**已修复的 4 个系统问题**：
1. CWD 路径翻倍
2. 子代理 maxTurns 过紧
3. sed surrogate 地址前缀解析
4. 反冗余 operator guidance 缺失

**模型瓶颈（非系统问题）**：DeepSeek-v4-flash 在复杂开放任务上限 13-20 turn 可完成中等分析任务，但 compact 后忽略已有摘要、子代理搜索中仍会重读。v4-pro 综合能力更强但幻觉倾向更高。两个模型各有限制，适合的任务类型不同。
