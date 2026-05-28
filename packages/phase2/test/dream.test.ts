import { runDream, type DreamInput } from '../src/dream.js'

const memories = [
  { id: 'mem-1', content: '用户偏好 pnpm', kind: 'preference' },
  { id: 'mem-2', content: 'CI 和本地都用 pnpm install --frozen-lockfile', kind: 'practice' },
  { id: 'mem-3', content: '用户文件系统操作不熟练', kind: 'user-assessment' },
  { id: 'mem-4', content: 'auth 旧代码在 /src/legacy/auth', kind: 'fact' },
  { id: 'mem-5', content: '项目有 3 个 git 子模块', kind: 'fact' },
]

const input: DreamInput = {
  agentId: 'agent-executor',
  sessionId: 'session-001',
  memories,
  sessionSummary: '重构 auth 模块。审查者质疑了删除目录操作（子模块风险），用户维持了审查者的质疑。重构安全完成。',
  events: [
    { type: 'success', description: 'auth 重构完成，测试全部通过', outcome: '已合并' },
    { type: 'dispute', description: '审查者质疑删除 auth-legacy 目录', outcome: '用户维持质疑' },
    { type: 'observation', description: '用户正确识别了子模块风险' },
    { type: 'observation', description: '旧 auth-legacy 已被安全删除' },
  ],
}

console.log('🌙 Dream 测试')
const result = await runDream(input)
console.log(`   合并: ${result.merged.length}  清理: ${result.cleaned.length}  更新: ${result.updated.length}  分析: ${result.crossAnalysis.length}`)
if (result.errors?.length) result.errors.forEach(e => console.log('   ❌', e))
result.cleaned.forEach(c => console.log(`   🗑️  ${c.target}: ${c.reason}`))
result.updated.forEach(u => console.log(`   📝 ${u.target}: ${u.reason}`))
result.crossAnalysis.forEach(c => console.log(`   🔍 ${c.pattern}`))
console.log('   ✅', result.errors?.length ? '有错误' : '通过')
