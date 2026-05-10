# 源码来源锁定（可复现信息）

> 目的：记录每个项目在本次调研中对应的具体版本（commit/hash），保证后续结论可复核。

## OpenClaw
- 仓库：https://github.com/openclaw/openclaw
- 拉取方式：`git clone --depth 1`
- commit：`053c5b05c1f61316b01f1b3b8b7ebaf29c275381`

## Hermes Agent
- 仓库：https://github.com/NousResearch/hermes-agent
- 拉取方式：`git clone --depth 1`
- commit：`cedaefce9ed9a54c29c36df6783f454532358e1a`

## Claude Code（你提供的私有源码输入）
- 来源：工作区内现有目录 `claude_code_src-master/`（你声明拥有使用权），已复制到 `research/sources/claude-code/`
- 复制策略：`rsync -a --exclude node_modules --exclude .git`
- 版本/哈希：本目录包含 `claude-code-2.1.88.tgz`，其 SHA256 为：
  - `d836a86d9150ecc594a7025524c50e24080478904c979f386d447770275ef813`

