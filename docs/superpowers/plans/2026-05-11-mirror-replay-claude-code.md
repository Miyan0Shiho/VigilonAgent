# Claude Code 镜像复刻 (Mirror Replay) 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Claude Code 的完整源码树镜像复刻到单一 Package 中，保留所有原始目录关系。

**Architecture:** 采用单一 Package 结构 (`packages/claude-code`)，将原 `src` 目录完整迁入。删除现有的试验性分包结构，确保源码像素级保真。

**Tech Stack:** TypeScript, pnpm workspace.

---

### Task 1: 清理现有试验性代码

**Files:**
- Delete: `packages/core`
- Delete: `packages/shared`
- Delete: `packages/tui`

- [ ] **Step 1: 删除旧的分包目录**
Run: `rm -rf packages/core packages/shared packages/tui`

- [ ] **Step 2: 验证删除成功**
Run: `ls packages`
Expected: 目录为空或仅包含 .gitkeep (如有)

- [ ] **Step 3: 提交清理状态 [WIP]**
```bash
git add packages
git commit -m "chore: remove experimental package structure [WIP]"
```

### Task 2: 创建并初始化 claude-code 包

**Files:**
- Create: `packages/claude-code/package.json`
- Create: `packages/claude-code/tsconfig.json`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: 创建包目录**
Run: `mkdir -p packages/claude-code`

- [ ] **Step 2: 写入 package.json**
```json
{
  "name": "@vigilon/claude-code",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "ink": "^7.0.2",
    "react": "^19.2.6"
  }
}
```

- [ ] **Step 3: 写入 tsconfig.json**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: 更新工作区配置**
确保 `pnpm-workspace.yaml` 包含 `packages/claude-code`。

- [ ] **Step 5: 提交初始化状态 [WIP]**
```bash
git add packages/claude-code pnpm-workspace.yaml
git commit -m "chore: initialize claude-code package [WIP]"
```

### Task 3: 镜像复刻源码树

**Files:**
- Create: `packages/claude-code/src/` (Mirror of research source)

- [ ] **Step 1: 执行全量复制**
Run: `cp -r docs/superpowers/research/sources/claude-code/src packages/claude-code/`

- [ ] **Step 2: 验证文件完整性**
Run: `find packages/claude-code/src -type f | wc -l`
与原目录文件数对比。

- [ ] **Step 3: 提交复刻源码 [WIP]**
```bash
git add packages/claude-code/src
git commit -m "feat: mirror replay claude-code source tree [WIP]"
```

### Task 4: 最终整理与验证

- [ ] **Step 1: 压缩提交历史**
按规则执行 `git rebase -i` 压缩 WIP 提交。

- [ ] **Step 2: 验证目录关系**
检查 `packages/claude-code/src/entrypoints/cli.tsx` 是否存在且引用正确。

- [ ] **Step 3: 提交最终结果**
```bash
git commit --amend -m "feat: mirror replay claude-code source into single package"
```
