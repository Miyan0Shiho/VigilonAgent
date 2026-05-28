# Phase 2 代码深度审查报告

日期：2026-05-28
审查轮次：2轮（首轮 + 修复验证）

---

## 修复状态

| # | 严重度 | 问题 | 状态 |
|---|--------|------|------|
| 1 | 🔴 | JSON Schema object/array 类型不匹配静默放过 | ✅ 已修复 |
| 2 | 🔴 | Subagent 生命周期事件批量缓冲 | ✅ 已修复（onEvent 回调 + liveEvents 队列） |
| 3 | 🔴 | PDF 被当作文本读取 | ✅ 已修复（isPdfFile 提前到 isProbablyBinary 之前） |
| 5 | 🟠 | harness 冗余 await import | ✅ 已修复（使用静态导入） |
| 8 | 🟠 | fallback 错误分类无效匹配 | ✅ 已修复（匹配 Node.js fetch 真实错误模式） |
| 4 | 🟠 | Goal 续跑最大轮次 | ❌ 不修（用户决策：goal 靠模型判断停止） |
| 6 | 🟠 | taskLedger 并发 | ❌ 不修（单线程无 await 点，无实际风险） |
| 7 | 🟠 | Transcript 并发写入 | ❌ 不修（O_APPEND 行级原子安全） |

---

## 第二轮审查确认

### 修复正确性验证

1. **PDF 检测**：`isImageFile() || isPdfFile()` 在 `isProbablyBinary()` 之前检查，PDF 不再被当作文本
2. **JSON Schema**：object/array 分支增加 `typeof instance !== 'object'` / `!Array.isArray(instance)` 前置检查，不匹配时立即报错返回
3. **onEvent**：`liveEvents` 数组在每轮 turn 内创建，不跨 turn 泄漏。serial 路径实时 drain，parallel 路径 Promise.all 后 drain。事件不重复（onEvent 存在时 subagent-lifecycle 不入 events 数组）
4. **harness**：静态导入 `execFile` 直接使用，消除了每次 Edit/Write/Bash 的动态 import 开销
5. **fallback**：匹配 `fetch failed`、`UND_ERR_*`、`EAI_AGAIN`、`cause.code` 等 Node.js 真实错误模式，移除无效的 HTTP 状态码匹配

### 未修复的非阻塞问题

| # | 严重度 | 问题 | 风险 |
|---|--------|------|------|
| 9 | 🟡 | partitionToolCalls 对 undefined tool 处理不够优雅 | 行为正确，无影响 |
| 10 | 🟡 | 多模态 base64 无大小限制 | 大文件可能撑爆上下文 |
| 11 | 🟡 | create_goal 未验证 token_budget 合法性 | 模型传负值会静默接受 |
| 12 | 🟡 | self_verify evaluator 和主 agent 共用 modelClient | 架构简化，prompt 级分离已足够 |
| 13 | 🟢 | webFetchTool.ts 中 parseUrlInput 未使用 | 死代码 |
| 14 | 🟢 | extractBrowseData 正则不覆盖跨行/嵌套标签 | 功能覆盖不足 |
| 15 | 🟢 | init 中 MCP 注释模板重复 mcpServers key | 仅影响注释文档 |
