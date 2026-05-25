# Phase 2 Entry Checklist

## 已满足的条件 ✅

- [x] Phase 1 所有改动已提交 (20 commits)
- [x] Phase 1 closure / preflight 文档已提交
- [x] 核心能力综述文档就绪 (`docs/ai/PHASE1_CAPABILITY_OVERVIEW.md`)
- [x] 交接文档就绪 (`docs/ai/HANDOFF.md`)
- [x] 仓库审计完成 (`docs/ai/PHASE1_AUDIT.md`)
- [x] .gitignore 修正 (排除参考材料和 worktree 产物)
- [x] `pnpm-workspace.yaml` 排除本地 `packages/claude-code` 参考镜像
- [x] 缺失源码拆分文件已入库 (`cli/display.ts`, `runtime/subagent-runner.ts`, `runtime/contracts/permission.ts`)
- [x] 210/211 测试通过 (1 known flaky)
- [x] 44/44 TUI 测试通过
- [x] Typecheck 0 错误
- [x] Build 成功
- [x] 6/6 真实任务端到端通过 (v4-pro)

## 非阻塞已知项

- [ ] **Worktree 测试 flaky** (test-only, 非 product bug):
  - 根因: 测试假设子代理一定产生文件变更，但 worktree setup 有时序不确定性
  - 修复方案: 测试使用 retry loop 或 mock 固定 worktree diff
  - 不阻塞 Phase 2 — 记录在已知限制中

- [ ] **本轮 preflight 未重跑测试**:
  - 原因: 用户明确要求不需要跑测试
  - Phase 2 开发第一步如要改 runtime 行为，再跑最窄相关验证即可

## Phase 2 Product Doctrine

Phase 2 的 Agent Society 讨论线统一放在 `docs/product/phase2-agent-society/`。

Phase 2 的核心精华已收束到 `docs/product/phase2-agent-society/PHASE2_CORE_ESSENCE.md`：

> Vigilon defines the life physics of digital working subjects by building an Agent Society runtime.

Phase 2 的方向门禁已更新为 `docs/product/phase2-agent-society/PHASE2_PRODUCT_DOCTRINE.md`：

> Vigilon defines the life physics of digital working subjects.

Phase 2 的问题地图记录在 `docs/product/phase2-agent-society/PHASE2_AGENT_ERA_PROBLEM_MAP.md`，细化版 Atlas 记录在 `docs/product/phase2-agent-society/PHASE2_AGENT_ERA_PROBLEM_ATLAS.md`。后续设计必须同时说明它回答了哪个 Agent 时代问题：意图形成、需求对齐、多主体治理、长程连续、幻觉、动态规划、环境适应、安全恢复、运行时攻击、知识代谢、成本归因、记忆治理、Agentic Web、劳动重组、评测可靠性、工具供应链、法律可委托边界、超级个体分化或合成内容证据信任。

Phase 2 的问题细化记录在 `docs/product/phase2-agent-society/PHASE2_AGENT_ERA_PROBLEM_ATLAS.md`。后续 deep dive 应从影响对象、现有失败形态、大众化阻碍、单点功能不足、为什么需要 Agent 社会、以及 downstream design pressure 出发。

Phase 2 的行为层 deep dive 记录在 `docs/product/phase2-agent-society/PHASE2_HUMAN_LIKE_WORK_BEHAVIORS.md`。后续设计必须说明它让用户看见了什么 human-like work behavior，并且该行为改变了哪些 runtime state：belief、memory、permission、identity、relation、cost、incident、evidence、capability 或 future plan。

Phase 2 的前端表面记录在 `docs/product/phase2-agent-society/PHASE2_AGENT_SOCIETY_FRONTEND_SURFACE.md`。后续产品表面设计必须避免退回纯 chat / logs / task board；默认应把 Agent 社会做成可观察、可干预、可审计的数字工作社会沙盘，让用户通过小人、空间、对象和事件理解 runtime state。

Phase 2 的产品回答记录在 `docs/product/phase2-agent-society/PHASE2_AGENT_SOCIETY_THESIS.md`：

> Agent Society is the product form of Agent Life Physics.

Agent 社会现在是 Phase 2 的产品组织框架；这不等于轻率承诺完整社会化产品面，而是要求后续设计说明它在 Agent 社会里建立了什么制度、关系或后果。

此前基于 DeepSeek-TUI 差距分析提出的 `专业化 Agent 定义系统 → TUI 体验打磨 → RLM` 仍可作为历史候选能力参考，但不再是 Phase 2 的主线判断标准。

后续任何 Phase 2 能力都必须先通过 Agent Life Physics doctrine：

- 是否保留 agent 像工作主体一样沉淀、争论、协作、探索或批评的可见行为？
- 是否来自 agent 的数字存在条件，而不是只照搬人类组织概念？
- 是否在 Agent 社会里建立了制度、关系、责任或社会后果？
- 是否处理复制、分叉、恢复、压缩、身份漂移、权限塑形或并行后果中的至少一个问题？
- 是否避免落入普通 multi-agent orchestration、harness、workflow engine、trust score、role-based team 或 prompt roleplay？

本文档仍只记录 Phase 2 入口状态；具体 MVP、工程拆解和验收任务需要在 doctrine 之后另写。
