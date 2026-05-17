# Vigilon Agent

> **DeepSeek V4 内核 + Claude Code 架构秩序 + Codex 产品级体验**

Vigilon Agent 是一个任务优先的超级个人助手。用户交给它目标，它负责在可控边界内调动代码编写、代码库理解、资料调研、本地电脑操作、外部工具和多 Agent 协作，把任务推进到可验证的完成状态。

它的第一阶段落点是一个优秀的代码代理（Coding Agent）产品：先以 Claude Code 源码和架构秩序为成熟骨架，复刻面向个人开发者的可用、可信、可恢复的本地 agent runtime；再在此基础上迭代出 Codex 级体验和 Vigilon 自己的个人助手能力。

这个项目不是简单的拼装，而是在工程实践基础上的一种价值取向选择：

1.  **模型能力 (Core)**: 以 **DeepSeek V4** 为核心，利用其在代码推理、长上下文及高性价比方面的卓越表现。
2.  **架构秩序 (Architecture)**: 继承 **Claude Code** 的工作流骨架，将“思考（Plan）”与“执行（Execute）”明确分离，建立严格的权限与反馈闭环。
3.  **产品叙事 (Experience)**: 追求 **Codex** 级的前端交互感，让 Agent 的执行过程透明、可感、具有极高的“产品化”完成度。
4.  **Agent 社会 (Society)**: 在基础 runtime 站稳后，发展可治理、可审计、可停止、可恢复的多 Agent 协作。

---

## 🏗️ 目录结构 (Workspace)

本项目采用 Monorepo 架构，以确保核心逻辑与展示层的深度解耦。

```text
VigilonAgent/
├── packages/
│   ├── runtime/        # Vigilon Phase 1 干净 runtime 主线
│   └── claude-code/    # Claude Code 源码参考镜像，不作为默认开发入口
├── docs/
│   ├── product/        # 产品定位、能力边界与预产品化基线
│   ├── claudecode-research/ # Claude Code 源码研究与机制索引
│   ├── archived-research/   # OpenClaw / Hermes 等早期对比调研
│   └── superpowers/    # 项目核心设计文档 (Specs & Designs)
└── README.md
```

## 🚀 愿景与策略

我们不希望从零发明基础秩序，而是选择：
- **先继承**: 站在 Claude Code 验证过的成熟骨架上，避免在底层工作流试错。
- **再产品化**: 以 Codex 级体验把任务入口、执行过程、权限等待、错误恢复和结果交付做清楚。
- **后扩展**: 从 Coding Agent 扩展为能调研、写代码、操作本地电脑、协调 Agent 社会的超级个人助手。

## 🧭 产品定位

预产品化基线见 [docs/product/README.md](docs/product/README.md)。

当前硬决策：

- Vigilon 的最终定位是任务优先的超级个人助手，不是普通聊天产品。
- Phase 1 的硬目标是 Claude Code Core Parity for Solo Runtime，优先复刻成熟本地 runtime，而不是过早追求差异化。
- Phase 1 的具体功能设计必须 copy-first：搜索、上下文压缩、记忆和工具实现先按 Claude Code 源码机制复刻，再做 Vigilon 改写和优化。
- Phase 1 从 `packages/runtime` 的干净地基开始开发；`packages/claude-code` 只作为机制参考。
- Phase 1 当前最小开发门禁是 `pnpm phase1:baseline`，后续随 Solo Runtime 主链成熟逐步扩展。
- Coding workflow 是基础形态，不是最终边界。
- 所有后续能力都必须服务于任务闭环、权限治理、可恢复性和可验证性。
- 当前明确不做 remote / bridge / multi-user / enterprise / admin / billing / telemetry / marketplace。

---

## 📂 历史调研

关于 Claude Code 的源码研究主入口，请参阅 [docs/claudecode-research/README.md](docs/claudecode-research/README.md)。

关于 Claude Code、OpenClaw 和 Hermes Agent 的早期对比调研，请参阅 [docs/archived-research/report.md](docs/archived-research/report.md)。
