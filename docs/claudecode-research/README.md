# Claude Code 源码研究中心

> 专注于 Claude Code (2.1.88) 源码还原、架构分析与机制研究的专用文件夹。

## 🚀 核心入口

- **[源码库 (src/)](./src/)**: 还原后的 Claude Code 核心源代码。
- **[研究图书馆 (library/)](./library/)**: 结构化的研究文档，涵盖架构、实现、机制等。
- **[源码恢复说明 (SOURCE_RECOVERY.md)](./SOURCE_RECOVERY.md)**: 了解如何从 Source Map 还原出 70w 行源码。
- **[总馆藏索引 (notes/catalog.md)](./notes/catalog.md)**: 快速定位所有研究资产。

## 📂 文件夹结构

- **[src/](./src/)**: Claude Code 2.1.88 源代码。
- **[library/](./library/)**: 深度研究图书馆 V2。
- **[figures/](./figures/)**: 关键架构与流程的 SVG 图谱。
- **[notes/](./notes/)**: 研究笔记、盲点清单、版本锁定等。
- **[plans/](./notes/plans/)**: 历史执行计划与复盘。
- **[specs/](./notes/specs/)**: 核心设计规范。
- **[topics/](./topics/)**: 安全、生态、UX、优化等 8 大研究专题。

## 🎯 研究目标

1. **架构拆解**: 理解 Claude Code 如何基于 React + Ink 构建复杂的终端交互。
2. **机制分析**: 深入研究 Plan Mode、Tool Use Context、权限门控等核心机制。
3. **经验借鉴**: 为 Vigilon Agent 提取可继承的设计模式，规避已知的技术盲点。

---

> **注意**: 本文件夹已进行“去杂质”处理，仅保留 Claude Code 相关内容。非相关项目的调研（如 OpenClaw, Hermes Agent 等）已移至 `docs/archived-research/`。
