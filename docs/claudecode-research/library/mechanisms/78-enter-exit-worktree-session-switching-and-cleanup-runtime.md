# EnterWorktree / ExitWorktree / Session Switching / Cleanup Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：MCP Resource Listing / Reading / Binary Persistence Runtime`](./77-mcp-resource-listing-reading-and-binary-persistence-runtime.md) | [`下一站：TaskStopTool / stopTask / Shared Kill Path / SDK Bookend Runtime`](./79-taskstop-tool-stoptask-shared-kill-path-and-sdk-bookend-runtime.md)

本文把 `EnterWorktreeTool` 和 `ExitWorktreeTool` 从旧的 task/agent/remote 总述里单独拆出来。重点不是“能创建 worktree”，而是 Claude Code 怎样把一次 mid-session worktree 操作拆成：

- `slug validation`
- `git vs hook-based create`
- `session cwd/originalCwd/worktree-state mutate`
- `CWD-dependent cache invalidation`
- `keep vs remove`
- `discard-changes safety gate`
- `tmux sidecar cleanup`
- `projectRoot/originalCwd` 分义恢复

这条链本质上是“把当前会话迁移到一个隔离工作副本，再安全迁回”。

## 1. 这两把工具不是普通 git 包装层，而是会话级迁移 runtime

源码镜像：[`../../src/tools/EnterWorktreeTool/EnterWorktreeTool.ts`](../../src/tools/EnterWorktreeTool/EnterWorktreeTool.ts), [`../../src/tools/ExitWorktreeTool/ExitWorktreeTool.ts`](../../src/tools/ExitWorktreeTool/ExitWorktreeTool.ts)

它们都不止做 git 操作，还会改：

- `process.chdir(...)`
- `setCwd(...)`
- `setOriginalCwd(...)`
- `saveWorktreeState(...)`
- `clearSystemPromptSections()`
- `clearMemoryFileCaches()`
- `getPlansDirectory.cache.clear?.()`

所以这不是“帮模型跑一条 `git worktree add/remove`”，而是完整的 session-environment switch。

## 2. prompt 从入口就把使用边界卡得很死：只有用户显式提到 worktree 才该调用

源码镜像：[`../../src/tools/EnterWorktreeTool/prompt.ts`](../../src/tools/EnterWorktreeTool/prompt.ts), [`../../src/tools/ExitWorktreeTool/prompt.ts`](../../src/tools/ExitWorktreeTool/prompt.ts)

两把工具的提示词都强调：

- 只有用户显式说 “worktree” 才使用 `EnterWorktree`
- `ExitWorktree` 也不能主动调用
- 只能在当前 session 自己创建过的 worktree 上操作

这说明 Claude Code 把 worktree 视为强 operator intent，不是模型可以随手优化的默认 git workflow。

## 3. `EnterWorktree` 的首个 gate 不是 git 检查，而是“当前 session 是否已经处在一个 tool-created worktree 里”

源码镜像：[`../../src/tools/EnterWorktreeTool/EnterWorktreeTool.ts`](../../src/tools/EnterWorktreeTool/EnterWorktreeTool.ts), [`../../src/utils/worktree.ts`](../../src/utils/worktree.ts)

进入时第一件事是：

- `if (getCurrentWorktreeSession()) throw new Error('Already in a worktree session')`

所以它防的不是“当前目录是不是任意 git worktree”，而是：

- 这个 session 有没有已经挂着一份由 `EnterWorktree` 建立的 worktree session state

## 4. `name` 不是随意字符串，而是经过 path-segment 级别验证的 worktree slug

源码镜像：[`../../src/tools/EnterWorktreeTool/EnterWorktreeTool.ts`](../../src/utils/worktree.ts)

`validateWorktreeSlug(...)` 至少限制：

- 总长度上限
- 不能含 `.` / `..` segment
- 每个 `/` 分段只能有：
  - letters
  - digits
  - dots
  - underscores
  - dashes

这不是 UI 美化，而是直接保护：

- hook 参数
- `path.join(...)`
- git branch/worktree path 生成

## 5. Enter 路径优先不是 git，而是 hook-based worktree create

源码镜像：[`../../src/utils/worktree.ts`](../../src/utils/worktree.ts), [`../../src/tools/EnterWorktreeTool/prompt.ts`](../../src/tools/EnterWorktreeTool/prompt.ts)

`createWorktreeForSession(...)` 的顺序是：

1. `validateWorktreeSlug(slug)`
2. 如果 `hasWorktreeCreateHook()`
   - 走 hook-based create
3. 否则才 fallback 到 git worktree

所以 git 不是唯一后端；Claude Code 明确允许：

- 非 git 仓库
- 自定义 VCS / sandbox / external workspace orchestrator

通过 hooks 提供隔离工作副本。

## 6. 即使当前人已经在某个 worktree 里，Enter 也会先回到 canonical main repo root 再创建新 worktree

源码镜像：[`../../src/tools/EnterWorktreeTool/EnterWorktreeTool.ts`](../../src/utils/git.ts)

进入前它会：

- `findCanonicalGitRoot(getCwd())`
- 如果 `mainRepoRoot !== getCwd()`
  - `process.chdir(mainRepoRoot)`
  - `setCwd(mainRepoRoot)`

所以它不会在已有 worktree 里面继续嵌套 `.claude/worktrees/...`，而是强制把 worktree creation anchor 回 canonical repo root。

## 7. 进入 worktree 后，Claude Code 故意只改 `originalCwd`，不改 `projectRoot`

源码镜像：[`../../src/tools/EnterWorktreeTool/EnterWorktreeTool.ts`](../../src/bootstrap/state.ts)

mid-session enter 的关键动作是：

- `setOriginalCwd(getCwd())`

但不会调用：

- `setProjectRoot(...)`

`bootstrap/state.ts` 注释把分义写得很清楚：

- `originalCwd`
  - 可以被 mid-session EnterWorktree 更新
- `projectRoot`
  - 只允许 `--worktree` startup 改
  - skills/history/sessions 要继续锚定在原项目身份

所以 EnterWorktree 是“文件操作工作根切换”，不是“项目身份切换”。

## 8. `saveWorktreeState(...)` 会把 worktree session 追加进 transcript metadata，因此这条迁移是可恢复的

源码镜像：[`../../src/tools/EnterWorktreeTool/EnterWorktreeTool.ts`](../../src/utils/sessionStorage.ts)

每次 enter/exit 都会：

- `saveWorktreeState(worktreeSession | null)`

它会把：

- `originalCwd`
- `worktreePath`
- `worktreeName`
- `worktreeBranch`
- `originalBranch`
- `originalHeadCommit`
- `sessionId`
- `tmuxSessionName`
- `hookBased`

写成 `worktree-state` entry 追加到 session file。

所以这不是纯内存态，而是 resume-capable session metadata。

## 9. `saveWorktreeState(...)` 还会主动剥掉 ephemeral 字段，说明 transcript 里只保存长期恢复需要的状态

源码镜像：[`../../src/utils/sessionStorage.ts`](../../src/utils/sessionStorage.ts)

保存前会丢弃：

- `creationDurationMs`
- `usedSparsePaths`

这说明 session log 不是 debug dump，而是一个面向恢复的最小状态面。

## 10. enter 完成后会清掉 system prompt / memory / plans 三类 CWD 相关缓存

源码镜像：[`../../src/tools/EnterWorktreeTool/EnterWorktreeTool.ts`](../../src/tools/ExitWorktreeTool/ExitWorktreeTool.ts)

enter 和 exit 都会清：

- `clearSystemPromptSections()`
- `clearMemoryFileCaches()`
- `getPlansDirectory.cache.clear?.()`

这条链很关键，因为 Claude Code 明确承认：

- system prompt 的 env_info
- memory file memoization
- plan directory cache

都会跟着 CWD 走，不清就会把旧目录上下文污染到新 worktree。

## 11. `ExitWorktree` 的入口 scope guard 比 enter 更强：只认“当前 session 的 activeWorktreeSession”

源码镜像：[`../../src/tools/ExitWorktreeTool/ExitWorktreeTool.ts`](../../src/tools/ExitWorktreeTool/prompt.ts)

validate 阶段直接写死：

- 如果没有 `getCurrentWorktreeSession()`
  - 返回 no-op 式失败文案

并明确说明它不会碰：

- 手工 `git worktree add` 建的 worktree
- 以前 session 建的 worktree

所以 `ExitWorktree` 的作用域不是“当前目录恰好是 worktree”，而是“这轮 session 自己创建并追踪的 worktree session”。

## 12. `remove` 不是随便 destructive，而是默认 fail-closed 的双重安全闸门

源码镜像：[`../../src/tools/ExitWorktreeTool/ExitWorktreeTool.ts`](../../src/utils/worktree.ts)

当：

- `action === 'remove'`
- 且没有 `discard_changes: true`

它会调用 `countWorktreeChanges(...)`。

这个函数如果无法可靠判断状态，会返回 `null`，而不是假装 `0/0`。调用方把 `null` 当成：

- unknown, assume unsafe

所以 remove 的安全哲学是 fail-closed，不是 best-effort destructive cleanup。

## 13. `countWorktreeChanges(...)` 同时检查未提交文件和相对 `originalHeadCommit` 的新提交

源码镜像：[`../../src/tools/ExitWorktreeTool/ExitWorktreeTool.ts`](../../src/utils/execFileNoThrow.ts)

它不是只看 `git status --porcelain`，还会：

- `git rev-list --count ${originalHeadCommit}..HEAD`

因此 “remove 会不会丢工作” 的判定包括：

- uncommitted files
- worktree branch 上额外 commits

这比单纯检查工作树脏不脏更严格。

## 14. `discard_changes: true` 不是参数糖，而是二次确认令牌

源码镜像：[`../../src/tools/ExitWorktreeTool/ExitWorktreeTool.ts`](../../src/tools/ExitWorktreeTool/prompt.ts)

如果发现：

- 有未提交文件
- 或有 worktree-only commits

工具不会直接删，而是返回一段明确文案，要求：

- 先和用户确认
- 再用 `discard_changes: true` 重调

所以这个布尔值的真正语义是：

- “我知道 remove 会永久丢掉这些工作，且已获确认”

## 15. `keep` 和 `remove` 不是同一条 cleanup 代码路径改文案，而是两套不同操作

源码镜像：[`../../src/tools/ExitWorktreeTool/ExitWorktreeTool.ts`](../../src/utils/worktree.ts)

`keep` 路径：

- `keepWorktree()`
- 恢复 session 到原目录
- 保留目录、分支、可选 tmux session

`remove` 路径：

- 若有 tmux，先 `killTmuxSession(...)`
- `cleanupWorktree()`
- 恢复 session
- 可能删 worktree branch

所以 keep/remove 不只是结果差异，而是调用完全不同的 worktree utility。

## 16. `restoreSessionToOriginalCwd(...)` 是 worktree runtime 的真正状态回滚中心

源码镜像：[`../../src/tools/ExitWorktreeTool/ExitWorktreeTool.ts`](../../src/bootstrap/state.ts), [`../../src/utils/sessionStorage.ts`](../../src/utils/sessionStorage.ts)

exit 时真正收束状态的是：

- `setCwd(originalCwd)`
- `setOriginalCwd(originalCwd)`
- 条件性 `setProjectRoot(originalCwd)`
- `updateHooksConfigSnapshot()` 仅在 `--worktree` startup 语义下回滚
- `saveWorktreeState(null)`
- 清 system prompt / memory / plans cache

这说明 exit 不是“删目录后自然回去”，而是显式逆转 enter 期间的 session mutations。

## 17. `projectRootIsWorktree` 这条判断把 `--worktree startup` 和 `mid-session EnterWorktree` 严格区分开了

源码镜像：[`../../src/tools/ExitWorktreeTool/ExitWorktreeTool.ts`](../../src/bootstrap/state.ts)

exit 前先算：

- `getProjectRoot() === getOriginalCwd()`

只有这个条件成立时，才会在恢复时：

- `setProjectRoot(originalCwd)`

含义是：

- `--worktree` 启动的 session，本来就把 worktree 当项目根
- mid-session enter 的 session，不应在 exit 时改项目身份

这是整条链里最关键的“项目身份 vs 工作目录”分界。

## 18. `cleanupWorktree()` 先离开 worktree，再删目录/分支，避免在被删目录里执行 git 清理

源码镜像：[`../../src/utils/worktree.ts`](../../src/utils/worktree.ts)

cleanup 时会先：

- `process.chdir(originalCwd)`

然后才：

- hook-based remove
- 或 `git worktree remove --force`
- 再删 worktree branch

这不是多余步骤，而是为了避免当前进程还站在即将删除的 worktree 目录里。

## 19. hook-based remove 和 git-based remove 是并列后端，且 hook 缺失时不会假装完成

源码镜像：[`../../src/utils/worktree.ts`](../../src/utils/worktree.ts)

如果是 hook-based worktree：

- 调 `executeWorktreeRemoveHook(worktreePath)`
- 没有 hook 时只记 warn，不伪造删除成功

这和 enter 时的 hook-first 设计对称，说明 Claude Code 把 hook-based VCS 支持当正式一等后端。

## 20. git-based create 还包含一整条 post-creation setup，不只是 `git worktree add`

源码镜像：[`../../src/utils/worktree.ts`](../../src/utils/worktree.ts)

`performPostCreationSetup(...)` 会继续做：

- 复制 `settings.local.json`
- 配置 `core.hooksPath`
- 按 settings.symlinkDirectories 建软链
- 复制 `.worktreeinclude` 指定文件
- 可选安装 attribution hook

因此 Claude Code 创建的 worktree 不是裸副本，而是做过本地设置、hooks、节省磁盘和提交归因的产品化工作区。

## 21. `tmuxSessionName` 是 worktree session state 的正式成员，因此 tmux sidecar 不是额外脚本，而是内建生命周期的一部分

源码镜像：[`../../src/utils/worktree.ts`](../../src/utils/sessionStorage.ts)

`WorktreeSession` 里正式保存：

- `tmuxSessionName?`

exit 时：

- `keep`
  - 把 tmux session 名字回给用户，允许后续 reattach
- `remove`
  - 先 `killTmuxSession(...)`

所以 tmux 不是 Enter/Exit 外部约定，而是 worktree runtime 的 sidecar 资源。

## 22. analytics 也把 enter/keep/remove 拆成三条独立事件，而不是只记录一次 worktree usage

源码镜像：[`../../src/tools/EnterWorktreeTool/EnterWorktreeTool.ts`](../../src/tools/ExitWorktreeTool/ExitWorktreeTool.ts)

可见事件有：

- `tengu_worktree_created`
- `tengu_worktree_kept`
- `tengu_worktree_removed`

并带上：

- `mid_session`
- `commits`
- `changed_files`

说明产品侧确实把：

- 进入
- 保留退出
- 销毁退出

当成三种不同使用模式在追踪。

## 23. `userFacingName` 和 UI 文案也说明它们是迁移动作，而不是静态 git 状态查看

源码镜像：[`../../src/tools/EnterWorktreeTool/UI.tsx`](../../src/tools/ExitWorktreeTool/UI.tsx)

前台表面是：

- `Creating worktree…`
- `Exiting worktree…`
- `Switched to worktree on branch ...`
- `Kept worktree` / `Removed worktree`

UI 没有暴露 git 细节，而是把这两把工具都呈现成：

- 会话级环境切换动作

这和它们的真实 runtime 角色是一致的。

## 24. `EnterWorktree` / `ExitWorktree` 真正编码的是“隔离副本中的当前会话”，不是通用 worktree 管理器

从源码看，这条线的核心约束一直没变：

- 只在显式 operator intent 下进入
- 以 session state 为真相源
- 以 `originalCwd` / `projectRoot` 分义来保护项目身份
- 以 transcript `worktree-state` 让迁移可恢复
- 以 keep/remove 双分支控制清理语义
- 以 fail-closed gate 保护未提交文件和额外提交

所以这两把工具的产品角色不是“帮你管理任意 git worktree”，而是：

- 给当前 Claude Code 会话创建一份隔离工作副本
- 再把这份会话安全迁回原环境

## 相关卷册

- agent/worktree 背景任务桥接：[`./58-agent-invocation-task-host-and-background-lifecycle-bridge.md`](./58-agent-invocation-task-host-and-background-lifecycle-bridge.md)
- remote/task 侧 output 与 lifecycle：[`./54-main-session-backgrounding-and-task-output-retrieval-runtime.md`](./54-main-session-backgrounding-and-task-output-retrieval-runtime.md)
- settings/hook 热更新与 project identity：[`./39-settings-change-detection-and-hot-reload-consumers.md`](./39-settings-change-detection-and-hot-reload-consumers.md)
