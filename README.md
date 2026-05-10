# Vigilon Agent

> **DeepSeek V4 内核 + Claude Code 架构秩序 + Codex 产品级体验**

Vigilon Agent 是一个定位清晰的代码代理（Coding Agent）产品，它不是简单的拼装，而是在工程实践基础上的一种价值取向选择：

1.  **模型能力 (Core)**: 以 **DeepSeek V4** 为核心，利用其在代码推理、长上下文及高性价比方面的卓越表现。
2.  **架构秩序 (Architecture)**: 继承 **Claude Code** 的工作流骨架，将“思考（Plan）”与“执行（Execute）”明确分离，建立严格的权限与反馈闭环。
3.  **产品叙事 (Experience)**: 追求 **Codex** 级的前端交互感，让 Agent 的执行过程透明、可感、具有极高的“产品化”完成度。

---

## 🏗️ 目录结构 (Workspace)

本项目采用 Monorepo 架构，以确保核心逻辑与展示层的深度解耦。

```text
VigilonAgent/
├── packages/
│   ├── core/           # Agent 核心引擎 (Planner, Executor, Tools)
│   ├── web/            # Codex 风格 Web 前端界面
│   └── shared/         # 共享协议、类型定义与工具库
├── docs/
│   ├── research/       # 前期调研报告与架构分析 (Archived)
│   └── superpowers/    # 项目核心设计文档 (Specs & Designs)
└── README.md
```

## 🚀 愿景与策略

我们不希望从零发明基础秩序，而是选择：
- **先继承**: 站在 Claude Code 验证过的成熟骨架上，避免在底层工作流试错。
- **再重塑**: 注入 DeepSeek V4 的模型气质，并通过 Codex 级的前端提升用户协作感。
- **后进化**: 在跑通关键链路后，逐渐生长出属于 Vigilon 独特的产品语言。

---

## 📂 历史调研

关于 Claude Code、OpenClaw 和 Hermes Agent 的深度调研报告，请参阅 [docs/research/report.md](docs/research/report.md)。
