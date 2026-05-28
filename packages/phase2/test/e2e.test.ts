import { sleep, wake, type AgentRef } from '../src/sleepWake.js'
import { extractSkillsAndRules } from '../src/skillsRules.js'
import type { DisputeInput } from '../src/dispute.js'

const executor: AgentRef = { agentId: 'agent-executor', label: '执行者', modelId: 'deepseek-v4-flash', instructionsHash: 'abc', toolHash: 'v2' }
const reviewer: AgentRef = { agentId: 'agent-reviewer', label: '审查者', modelId: 'deepseek-v4-flash', instructionsHash: 'def', toolHash: 'v2' }
const guide: AgentRef = { agentId: 'agent-guide', label: '引导者', modelId: 'deepseek-v4-flash', instructionsHash: 'ghi', toolHash: 'v2' }

const trustGraph = {
  'agent-executor': { 'agent-reviewer': 65, 'agent-guide': 85 },
  'agent-reviewer': { 'agent-executor': 55, 'agent-guide': 70 },
  'agent-guide': { 'agent-executor': 85, 'agent-reviewer': 70 },
}

const pendingDisputes: DisputeInput[] = [{
  disputeId: 'd-001', subject: { type: 'action', targetId: 'tc-42', description: 'rm -rf old-dir/' },
  risk: 'medium', challengerId: 'agent-reviewer', defenderId: 'agent-executor',
  stances: [
    { agentId: 'agent-reviewer', position: 'block', reasoning: '子模块风险' },
    { agentId: 'agent-executor', position: 'approve', reasoning: 'init 脚本创建' },
  ],
  trustGraph, reversible: true, availableMediators: ['agent-guide'],
}]

console.log('🔁 端到端: 3 个 Phase 1 Agent → 社会协调\n')

// ── Sleep (executor) ──
const packet = await sleep({
  agent: executor, sessionId: 'e2e-001',
  sessionSummary: '重构 auth。审查者质疑删除目录。用户维持质疑。重构完成。',
  events: [
    { type: 'success', description: 'auth 重构完成', outcome: '合并' },
    { type: 'dispute', description: '审查者质疑删除目录', outcome: '用户维持质疑' },
  ],
  memories: [
    { id: 'mem-1', content: '用户偏好 pnpm', kind: 'preference' },
    { id: 'mem-2', content: '用户文件系统不熟练', kind: 'user-assessment' },
    { id: 'mem-3', content: 'auth 旧代码在 /src/legacy/auth', kind: 'fact' },
    { id: 'mem-4', content: '项目有 3 个 git 子模块', kind: 'fact' },
  ],
  pendingDisputes, trustGraph,
})

console.log('1. Sleep (agent-executor)')
console.log(`   争议: ${packet.resolvedDisputes[0].resolution} → ${packet.resolvedDisputes[0].decision}`)
console.log(`   Dream: ${packet.dream.cleaned.length}清理 ${packet.dream.updated.length}更新 ${packet.dream.crossAnalysis.length}分析`)
console.log(`   关系: ${packet.relationshipChanges.map(r => `${r.fromId}→${r.toId} ${r.delta > 0 ? '+' : ''}${r.delta}`).join(', ')}`)

// ── Skills/Rules ──
const extraction = await extractSkillsAndRules({
  agentId: 'agent-executor', sessionId: 'e2e-001',
  sessionSummary: packet.resumeAnchor.context,
  events: [
    { type: 'success', description: 'auth 重构完成' },
    { type: 'dispute', description: '审查者质疑删除', outcome: '用户维持质疑' },
  ],
  dreamOutput: packet.dream, disputeResults: packet.resolvedDisputes,
  existingSkills: [], existingRules: [],
})

console.log('\n2. Skills/Rules 提取')
console.log(`   Skills: ${extraction.newSkills.map(s => s.name).join(', ') || '无新增'}`)
console.log(`   Rules: ${extraction.newRules.map(r => r.rule?.slice(0, 40) ?? '(无文本)').join(', ') || '无新增'}`)

// ── Wake ──
const decl = wake({ packet, currentAgent: executor, permissionState: 'inherited' })

console.log('\n3. Wake (agent-executor)')
console.log(`   身份: ${decl.identity.stillSameAgent ? '同一 ✅' : '变化 ⚠️'}`)
console.log(`   约束: ${decl.constraints.length} 条`)
console.log(`   需用户: ${decl.userAttention.items.map(i => `[${i.priority}] ${i.text}`).join('; ') || '无'}`)

// ── Summary ──
console.log('\n' + '═'.repeat(50))
console.log('架构验证:')
console.log('  Phase 1 Agent × 3 = 原子 Agent (各自的 loop/transcript/memory)')
console.log('  Phase 2 = 社会协调层 (dispute/dream/sleepWake/skillsRules)')
console.log('  角色无关: agent-executor/reviewer/guide 可换成任意角色')
console.log('  用户介入: 仅高风险/关键风险争议 → Allow/Block')
