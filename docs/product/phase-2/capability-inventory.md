# Phase 2 能力对齐清单

日期：2026-05-28
原则：**Codex 或 Claude Code 做了的，我们就做。** 不做价值判断，先列全。

## 状态标记

- ✅ Phase 1 已有
- ⚠️ Phase 1 有骨架，深度不够
- ❌ 缺失
- 🔨 已出设计文档
- 📋 已调研

---

## 一、执行与工具

| 能力 | Vigilon | Codex | Claude Code | 对用户的价值 |
|------|---------|-------|-------------|------------|
| 基础工具（Read/Write/Edit/Bash/Grep/Glob） | ✅ | ✅ | ✅ | — |
| 工具同轮并行执行（只读并发，写入串行） | ❌ | ✅ | ✅ | 多个文件搜索/读取不再排队，任务快 2-3 倍 |
| WebFetch | ⚠️ | ✅ | ✅ | 已有但缺 preflight/cache/summary |
| Notebook 读写 | ⚠️ | ✅ | ✅ | 已有，深度待验证 |
| LSP 代码智能 | ⚠️ | ✅ | ✅ | 已有，缺 AST fallback、降级解释 |
| Browser Agent（网页交互，不只是抓取） | ❌ | ✅ | ❌ | 能登录、填表、点击、等渲染——不只是读 HTML |
| 多模态视觉（读截图/设计稿/PDF 图表） | ❌ | ✅ | ⚠️ | 用户截个图 Agent 就能理解，不用打字描述 |
| Computer Use（桌面操作） | ❌ | ✅ | ❌ | Agent 操作桌面应用。开源替代：mac-cua（Apache 2.0，AX Tree + 后台操作） |
| 结构化输出（JSON/YAML/CSV 模板） | ❌ | ✅ | ⚠️ | Agent 输出能直接喂给下一个工具或脚本 |
| `/goal` 持久化自主执行 | ❌ | ✅ | ✅ | 设目标+预算→Agent 自己跑到完，不用每轮点"继续" |
| 任务调度 / Heartbeats（Agent 周期醒来工作） | ❌ | ✅ | ❌ | Agent 监控 CI/Slack/GitHub，不是人在盯着 |
| 自验证（Generator ≠ Evaluator） | ❌ | ⚠️ | ⚠️ | Agent 改完代码有独立评估者检查，不只是"完成了" |
| Harness Engineering（结构性约束层） | ❌ | ⚠️ | ⚠️ | ESLint/pre-commit/typecheck 作为硬门禁，不是 prompt 建议 |

## 二、记忆与上下文

| 能力 | Vigilon | Codex | Claude Code | 对用户的价值 |
|------|---------|-------|-------------|------------|
| Session Memory | ⚠️ | ✅ | ✅ | 已有，缺可查看/可编辑/可删除 |
| Project Memory | ⚠️ | ⚠️ | ⚠️ | 已有，缺所有权模型（user/project/org） |
| 跨 Session 记忆持久化 | ❌ | ✅ | ⚠️ | Agent 记得上次会话的偏好和决策 |
| 记忆所有权与可管理 | ❌ | ⚠️ | ❌ | 用户能看到、编辑、删除影响 Agent 行为的记忆 |
| Prompt Cache 优化 | ⚠️ | ✅ | ✅ | 已有 basic tracking，缺 break detection 审计 |
| 上下文保真度提示 | ❌ | ❌ | ❌ | Agent 告诉用户"读了 X 行，跳过了 Y，不确定 Z" |
| Chronicle（视觉记忆） | ❌ | ✅ | ❌ | Agent 记得你之前在屏幕上做什么。开源替代：OpenChronicle（MIT，AX Tree + 本地存储 + MCP） |

## 三、多 Agent

| 能力 | Vigilon | Codex | Claude Code | 对用户的价值 |
|------|---------|-------|-------------|------------|
| 基础 Subagent | ⚠️ | ✅ | ✅ | 已有同步 local，缺 worktree 隔离 |
| 多 Agent 并发（多 goal 多线程） | ❌ | ✅ | ⚠️ | 多个任务同时跑，各不干扰 |
| Agent 面板（查看所有 Agent 状态） | ❌ | ✅ | ✅ | `claude agents` / Codex agent view——看到谁在跑、谁阻塞了 |
| Agent 间交接协议 | ❌ | ⚠️ | ⚠️ | 上游 Agent 的结论+假设+风险传递给下游 Agent |

## 四、安全与权限

| 能力 | Vigilon | Codex | Claude Code | 对用户的价值 |
|------|---------|-------|-------------|------------|
| 基础权限模式 | ✅ | ✅ | ✅ | — |
| 行动分类（可逆/需确认/需在场/禁止） | ❌ | ✅ | ⚠️ | 不同风险等级的行动不同审批要求 |
| 权限继承（Permission Profiles） | ❌ | ✅ | ❌ | 项目级→目录级→工具级权限继承，不是全局开关 |
| 技能级工具限制（disallowed-tools） | ❌ | ❌ | ✅ | skill 声明"我不用这 3 个危险工具" |
| 安全分级（静默/确认/阻断） | ❌ | ❌ | ❌ | 低风险静默过，中风险确认，高风险阻断——不一律弹窗 |

## 五、开发体验

| 能力 | Vigilon | Codex | Claude Code | 对用户的价值 |
|------|---------|-------|-------------|------------|
| 内置诊断（`doctor`） | ❌ | ✅ | ❌ | 一键检查配置、权限、网络、模型连接 |
| 技能热重载（`/reload-skills`） | ❌ | ❌ | ✅ | 改完 skill 不需要重启 session |
| 推理深度控制（`/effort`） | ❌ | ❌ | ✅ | 简单任务用 low effort 省钱，复杂任务用 high |
| Fork / Resume 会话选择器 | ❌ | ✅ | ✅ | 可视化看到历史会话，选择从哪继续 |
| 模型路由（便宜模型做简单任务） | ❌ | ✅ | ❌ | 搜索/读取用便宜模型，分析/生成用贵模型 |
| 回退模型（主模型挂了自动切换） | ❌ | ❌ | ✅ | 网络波动或模型超载时不丢任务 |

## 六、暂不纳入 Phase 2

这些确实有用，但超出了 Phase 2 的范围或 Vigilon 的可控边界：

| 能力 | 原因 |
|------|------|
| 插件市场 / 生态分发 | 依赖社区规模，Phase 2 太早 |
| Realtime 语音 | 模型和技术栈依赖太重 |
| 图片生成 | 不属于 Agent runtime |
| Python SDK | 开发者体验提升但不是 Phase 2 核心 |
| Remote control / headless | Phase 3+ |
