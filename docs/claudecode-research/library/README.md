# Claude Code 深度研究图书馆

本目录是 Claude Code 深度研究的唯一主馆藏。

它的目标不是堆资料，而是提供一套可漫游、可追证、可维护的研究库，让人类和大模型都能稳定回答三类问题：

1. Claude Code 的产品表面、执行模式和目标用户到底是什么。
2. 一个真实任务从输入、预处理、agent loop、工具调用到 transcript 持久化是如何流动的。
3. 哪些机制值得 Vigilon 继承，哪些应该只参考，哪些应该明确规避。

## 先从哪里开始

- 第一次进入：[`master-index.md`](./master-index.md)
- 想顺着读：[`reading-paths.md`](./reading-paths.md)
- 想按术语扫盲：[`glossary.md`](./glossary.md)
- 想直接追证据：[`evidence/evidence-ledger.md`](./evidence/evidence-ledger.md)
- 想看图谱：[`figures/index.md`](./figures/index.md)

## 馆藏结构

| 区域 | 作用 | 入口 |
| --- | --- | --- |
| 首页层 | 定义范围、读法、质量规则 | [`README.md`](./README.md), [`master-index.md`](./master-index.md), [`reading-paths.md`](./reading-paths.md) |
| 正文卷册 | 承接稳定叙述，不把草稿伪装成正文 | [`architecture/01-04.md`](./architecture/01-04.md), [`implementation/01-08.md`](./implementation/01-08.md), [`mechanisms/01-07.md`](./mechanisms/01-07.md), [`product/`](./product), [`users/`](./users), [`synthesis/01-04.md`](./synthesis/01-04.md) |
| 证据层 | 保证结论能回跳到源码与外部资料 | [`evidence/`](./evidence) |
| 图谱层 | 支持快速建立结构感 | [`figures/index.md`](./figures/index.md) |

## 质量规则

- 主馆藏只使用仓库内相对链接，不依赖工作区绝对路径。
- 正文卷册要同时给出“这页讲什么”和“下一步读哪里”。
- 证据不足的结论不进入正文，先留在 `evidence/`。
- 旧版研究资料保留，但只作为归档或证据来源，不再充当主入口。

## 版本关系

- 主馆藏：[`claude-code-library-v2`](./)
- 旧版归档：当前工作区未挂载；若后续恢复旧库，应只作为归档/证据源，不再抢主入口

如果你发现坏链或路径漂移，先运行：

```bash
python3 docs/claudecode-research/check_library_links.py
```
