# Vigilon Agent 调研报告

本仓库包含了对三个主流 AI Agent 项目（Claude Code、OpenClaw、Hermes Agent）的源码深度调研报告，重点关注 **Agent 的规划与执行机制**。

## 目录结构

- `docs/report.md`: 三项目源码深度调研主报告。
- `docs/comparison-matrix.md`: 规划/执行机制横向对比矩阵。
- `docs/notes/`: 各项目的关键文件索引和研究笔记。
- `docs/figures/`: 架构和流程示意图。

## 调研核心结论

1. **Claude Code**: 显式 Plan Mode 提供强一致流程控制和用户审批 gate。
2. **OpenClaw**: 平台化插件体系，强审计与任务流管理。
3. **Hermes Agent**: 并行工具执行、自注册注册表与能力门控设计。

详细调研内容请参阅 [docs/report.md](docs/report.md)。
