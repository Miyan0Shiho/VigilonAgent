# BashTool / Sandbox / Permission / Transcript Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：文件编辑与 Shell`](./03-file-editing-and-shell-execution.md) | [`下一站：FileRead / Grep / WebSearch Runtime`](./32-file-read-grep-and-websearch-runtime.md)

[`mechanisms/03`](./03-file-editing-and-shell-execution.md) 已经说明 `BashTool` 不是简单跑命令，但还没有把它自己的运行时拆到实现级。真正把 Claude Code 的 shell 执行变成一个可治理能力面的，是下面这组模块：

- `BashTool.tsx`
- `bashPermissions.ts`
- `bashSecurity.ts`
- `readOnlyValidation.ts`
- `pathValidation.ts`
- `modeValidation.ts`
- `shouldUseSandbox.ts`
- `sedEditParser.ts`
- `destructiveCommandWarning.ts`
- `commandSemantics.ts`
- `UI.tsx`

它们拼起来，才是 Claude Code 的 shell policy engine。

## 1. `BashTool` 的 schema 从一开始就带着运行时策略，不只是参数定义

源码镜像：[`../../src/tools/BashTool/BashTool.tsx`](../../src/tools/BashTool/BashTool.tsx), [`../../src/tools/BashTool/prompt.ts`](../../src/tools/BashTool/prompt.ts)

模型看到的输入并不是裸 `command`，而是带着这些运行时位：

- `timeout`
- `description`
- `run_in_background`
- `dangerouslyDisableSandbox`

还有一条刻意不暴露给模型的内部字段：

- `_simulatedSedEdit`

这表示 `BashTool` 从 schema 层就区分了：

- 普通 shell 执行
- 可后台化执行
- 可申请 unsandboxed 执行
- 已经被 permission dialog 预先算好的 sed file-write

所以它不是“命令字符串 + 执行器”，而是一个受策略驱动的宿主接口。

## 2. read/search/list 折叠和 silent command 识别都在 tool 内核里，不是通用 transcript 功能

源码镜像：[`../../src/tools/BashTool/BashTool.tsx`](../../src/tools/BashTool/BashTool.tsx)

`isSearchOrReadBashCommand()` 会把 compound command 分成：

- `search`
- `read`
- `list`

同时还允许：

- `echo`
- `printf`
- `true`
- `false`

这类 semantic-neutral 命令夹在中间不破坏整体语义。

`isSilentBashCommand()` 又单独识别：

- `mv`
- `cp`
- `rm`
- `mkdir`
- `chmod`
- `touch`

这类“成功时通常无 stdout”的命令，好让前台显示 `Done` 而不是误导性的 `(No output)`。也就是说，BashTool 自己就内建了一层 command semantics for UI。

## 3. auto-background 不是随便超时就后台，而是显式受命令族和宿主模式约束

源码镜像：[`../../src/tools/BashTool/BashTool.tsx`](../../src/tools/BashTool/BashTool.tsx)

这里至少有三条独立 gate：

- `run_in_background`
- main-agent assistant mode 的 `ASSISTANT_BLOCKING_BUDGET_MS = 15_000`
- `DISALLOWED_AUTO_BACKGROUND_COMMANDS = ['sleep']`

`sleep` 被明确拉黑，是因为 Claude Code 不希望把“先 sleep 再继续”的轮询模式伪装成正常后台任务。再配合 `detectBlockedSleepPattern()`，长 sleep 会被直接引导到 Monitor tool，而不是继续沿 BashTool 走。

## 4. `sed -i` 在 Claude Code 里不是普通 shell write，而是 permission-gated simulated file edit

源码镜像：[`../../src/tools/BashTool/sedEditParser.ts`](../../src/tools/BashTool/sedEditParser.ts), [`../../src/tools/BashTool/BashTool.tsx`](../../src/tools/BashTool/BashTool.tsx), [`../../src/tools/BashTool/UI.tsx`](../../src/tools/BashTool/UI.tsx)

`parseSedEditCommand()` 只接受非常窄的子集：

- 必须是 `sed`
- 必须带 `-i`
- 只支持单个 substitution expression
- 只支持单文件
- flag 只接受安全 substitution flags

批准后不会真的跑 sed，而是通过 `_simulatedSedEdit` 进入 `applySedEdit(...)`：

- 读原文件
- 保留 file history
- 直接写新内容
- 通知 VS Code
- 更新 `readFileState`

前台也故意把这类命令渲染成 file edit surface，只显示 file path。换句话说，Claude Code 把 `sed -i` 从“shell write”提升成了“受控 file-edit surrogate”。

## 5. sandbox 不是一刀切，而是 `policy + user exclusions + explicit override` 三层决策

源码镜像：[`../../src/tools/BashTool/shouldUseSandbox.ts`](../../src/tools/BashTool/shouldUseSandbox.ts)

`shouldUseSandbox()` 的判断顺序很清楚：

1. sandbox 全局是否启用
2. 是否显式 `dangerouslyDisableSandbox`
3. policy 是否允许 unsandboxed commands
4. command 是否命中 excludedCommands

而 `excludedCommands` 本身又不是安全边界，只是 convenience feature。代码里明确写了：

- 真正的安全控制是 sandbox permission system

这意味着：

- excluded command 只是为了让某些命令默认绕开 sandbox
- 但用户仍然会经过 permission / policy / host checks

## 6. permission 核心不是匹配一条 rule，而是一个多阶段 classifier pipeline

源码镜像：[`../../src/tools/BashTool/bashPermissions.ts`](../../src/tools/BashTool/bashPermissions.ts)

`bashToolHasPermission(...)` 这条链不是单步判断。围绕它已经单独拆出了这些局部系统：

- `getSimpleCommandPrefix()`
- `getFirstWordPrefix()`
- `MAX_SUBCOMMANDS_FOR_SECURITY_CHECK`
- `MAX_SUGGESTED_RULES_FOR_COMPOUND`
- classifier allow/ask/deny descriptions
- per-subcommand suggestion trimming

其中两个约束很关键：

- subcommand 太多时直接回退到 `ask`
- compound command 的自动建议 rule 数量被上限压到 `5`

也就是说，Claude Code 宁可保守地 ask，也不愿在复杂 shell 上生成过宽的持久 rule。

## 7. prefix suggestion 不是 UX 小优化，而是围绕 shell wrapper 绕过风险设计出来的

源码镜像：[`../../src/tools/BashTool/bashPermissions.ts`](../../src/tools/BashTool/bashPermissions.ts)

代码里专门维护了 `BARE_SHELL_PREFIXES`，明确拒绝为这些命令生成宽前缀：

- `sh/bash/zsh/...`
- `env`
- `xargs`
- `nice/stdbuf/nohup/timeout/time`
- `sudo/doas/pkexec`

原因很直接：

- `bash:*` 基本等于任意代码执行
- wrapper 前缀会把危险子命令伪装成安全前缀

所以 permission suggestion 在这里本质上是安全设计，不是编辑器便捷特性。

## 8. `bashSecurity.ts` 真正防的是 shell 语法级逃逸，而不是文件系统权限

源码镜像：[`../../src/tools/BashTool/bashSecurity.ts`](../../src/tools/BashTool/bashSecurity.ts)

这层重点盯的是 shell feature abuse：

- process substitution
- `$()` / `${}` / `$[]`
- Zsh equals expansion
- dangerous zsh builtins / modules
- heredoc in substitution
- malformed token injection
- quoted newline / comment desync

它还给每类安全检查分配了 numeric `checkId` 用于 telemetry。说明这不是“尽量挡一下”，而是一套可观测、可统计的 shell injection defense layer。

## 9. read-only 判定不是看命令名，而是 `allowlist + flag grammar + path extractor` 的组合

源码镜像：[`../../src/tools/BashTool/readOnlyValidation.ts`](../../src/tools/BashTool/readOnlyValidation.ts), [`../../src/tools/BashTool/pathValidation.ts`](../../src/tools/BashTool/pathValidation.ts)

`checkReadOnlyConstraints()` 并不是简单维护一个只读命令白名单。它真正依赖的是：

- `COMMAND_ALLOWLIST`
- 每个命令的 safe flags grammar
- `PATH_EXTRACTORS`
- `COMMAND_OPERATION_TYPE`

例如：

- `find -- -/../../etc` 这种路径前缀攻击会被特殊处理
- `rm -- -weird-path` 这类 `--` 之后的 positional path 不会被漏掉
- `sed` 只有通过 allowlist 的安全 edit/read 子集才会被视为只读

所以“read-only bash”在 Claude Code 里是语义判断，不是命令名猜测。

## 10. dangerous path 检查会故意绕开 symlink 解析，先保护用户再说

源码镜像：[`../../src/tools/BashTool/pathValidation.ts`](../../src/tools/BashTool/pathValidation.ts)

`checkDangerousRemovalPaths()` 对 `rm/rmdir` 的处理非常明确：

- 先 expand tilde
- 先按非 symlink-resolved path 判危险
- 命中 critical path 时强制 `ask`
- 不提供持久 suggestions

这里连理由都写死了：

- 不希望鼓励保存危险命令

所以 BashTool 的 path layer 有一条独立于 ordinary permission rules 的 catastrophic-loss brake。

## 11. mode-specific permission 不是全局逻辑，而是 BashTool 自己先认领一部分

源码镜像：[`../../src/tools/BashTool/modeValidation.ts`](../../src/tools/BashTool/modeValidation.ts)

`checkPermissionMode()` 目前至少做了一件事：

- `acceptEdits` 模式下自动放行一组 filesystem commands

这组命令包括：

- `mkdir`
- `touch`
- `rm`
- `rmdir`
- `mv`
- `cp`
- `sed`

说明 BashTool 的 mode semantics 不是完全外置在 permission framework 里，它自己也知道当前模式会如何改写 shell write 的审批路径。

## 12. destructive warning 是纯信息层，不影响审批逻辑

源码镜像：[`../../src/tools/BashTool/destructiveCommandWarning.ts`](../../src/tools/BashTool/destructiveCommandWarning.ts)

这层专门识别：

- `git reset --hard`
- force push
- `git clean -f`
- `git checkout .`
- `git stash drop/clear`
- `rm -rf`
- `DROP/TRUNCATE`
- `kubectl delete`
- `terraform destroy`

但代码注释写得很清楚：

- 这是 informational
- 不改变 permission logic 或 auto-approval

也就是说，Claude Code 把“危险提示”与“真正的 allow/ask/deny 决策”分成了两条线，避免 warning 文案意外变成安全边界。

## 13. exit code interpretation 也是专门建模过的，不把所有非零都当失败

源码镜像：[`../../src/tools/BashTool/commandSemantics.ts`](../../src/tools/BashTool/commandSemantics.ts)

`interpretCommandResult()` 对这些命令做了特判：

- `grep/rg`: `1 = no matches found`
- `find`: `1 = some dirs inaccessible`
- `diff`: `1 = files differ`
- `test/[`: `1 = condition false`

所以 BashTool 的结果面里会出现：

- 非错误的非零退出
- 附带语义解释的 completion

这能避免 agent 把“没找到”“条件假”“文件不同”错误地当成执行失败。

## 14. 前台结果面是 shell host-aware 的，而不是把 stdout/stderr 原样贴上来

源码镜像：[`../../src/tools/BashTool/UI.tsx`](../../src/tools/BashTool/UI.tsx), [`../../src/tools/BashTool/BashTool.tsx`](../../src/tools/BashTool/BashTool.tsx)

这层至少做了四件额外工作：

- `sed -i` 渲染成 file-edit 风格
- 非 verbose 下截断 command label
- `BackgroundHint` 暴露 `ctrl+b`
- `backgroundTaskId / assistantAutoBackgrounded / backgroundedByUser` 进入结果块

同时 `mapToolResultToToolResultBlockParam()` 还会：

- 处理 image output
- 把过大输出持久化成 `<persisted-output>`
- 注入后台任务 output path

所以 BashTool 不是“shell exec + plain text response”，而是 `shell host + task host + persisted output handoff` 的组合。

## 15. 这篇和 `03`、`35`、`63`、`68` 的边界

[`./03-file-editing-and-shell-execution.md`](./03-file-editing-and-shell-execution.md) 讲的是：

- BashTool / FileEditTool / LocalShellTask 作为一类能力的大轮廓

这一篇讲的是：

- BashTool 自己的 permission / sandbox / security / transcript runtime

[`./35-workflow-monitor-console-and-task-framework-runtime.md`](./35-workflow-monitor-console-and-task-framework-runtime.md) 讲的是：

- workflow/monitor 背景任务框架

[`./63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md`](./63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md) 讲的是：

- compaction 之后 capability attachment 如何恢复

[`./68-ask-user-question-schema-preview-and-operator-loop-runtime.md`](./68-ask-user-question-schema-preview-and-operator-loop-runtime.md) 讲的是：

- 另一类 `requiresUserInteraction` operator loop

而 BashTool 这一卷关心的是：

- 命令如何进入 shell
- 何时进 sandbox
- 何时 ask / auto-allow / convert to simulated edit
- 如何变成前台可读 transcript 与后台任务 surface
