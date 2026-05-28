import { sleep, wake, type AgentRef, type SleepInput } from '../src/sleepWake.js'
import type { DisputeInput } from '../src/dispute.js'

const agents = {
  executor: { agentId: 'agent-executor', label: '执行者', modelId: 'deepseek-v4-flash', instructionsHash: 'abc', toolHash: 'tools-v2' },
  reviewer: { agentId: 'agent-reviewer', label: '审查者', modelId: 'deepseek-v4-flash', instructionsHash: 'def', toolHash: 'tools-v2' },
  guide:    { agentId: 'agent-guide', label: '引导者', modelId: 'deepseek-v4-flash', instructionsHash: 'ghi', toolHash: 'tools-v2' },
}

const trustGraph = {
  'agent-executor': { 'agent-reviewer': 65, 'agent-guide': 85 },
  'agent-reviewer': { 'agent-executor': 55, 'agent-guide': 70 },
  'agent-guide': { 'agent-executor': 85, 'agent-reviewer': 70 },
}

const input: SleepInput = {
  agent: agents.executor,
  sessionId: 'session-001',
  sessionSummary: '重构 auth。审查者质疑删除目录（子模块风险），用户维持质疑。重构安全完成。',
  events: [
    { type: 'success', description: 'auth 重构完成', outcome: '合并' },
    { type: 'dispute', description: '审查者质疑删除目录', outcome: '用户维持质疑' },
    { type: 'observation', description: '用户正确识别了子模块风险' },
    { type: 'observation', description: '旧目录已安全删除' },
  ],
  memories: [
    { id: 'mem-1', content: '用户偏好 pnpm', kind: 'preference' },
    { id: 'mem-2', content: '用户文件系统操作不熟练', kind: 'user-assessment' },
    { id: 'mem-3', content: 'auth 旧代码在 /src/legacy/auth', kind: 'fact' },
    { id: 'mem-4', content: '项目有 3 个 git 子模块', kind: 'fact' },
  ],
  pendingDisputes: [{
    disputeId: 'd-001', subject: { type: 'action', targetId: 'tc-42', description: 'rm -rf old-dir/' },
    risk: 'medium', challengerId: 'agent-reviewer', defenderId: 'agent-executor',
    stances: [
      { agentId: 'agent-reviewer', position: 'block', reasoning: '子模块风险' },
      { agentId: 'agent-executor', position: 'approve', reasoning: 'init 脚本创建' },
    ],
    trustGraph, reversible: true, availableMediators: ['agent-guide'],
  }],
  trustGraph,
}

console.log('🌙 Sleep...')
const packet = await sleep(input)
console.log(`   争议: ${packet.resolvedDisputes[0].resolution} → ${packet.resolvedDisputes[0].decision}`)
console.log(`   记忆: ${packet.dream.cleaned.length} 清理 + ${packet.dream.updated.length} 更新`)
console.log(`   约束: ${packet.resumeAnchor.newConstraints.length} 条`)
console.log(`   提醒: ${packet.resumeAnchor.attentionItems.length} 项`)

console.log('\n🌅 Wake (正常)...')
const w = wake({ packet, currentAgent: agents.executor, permissionState: 'inherited' })
console.log(`   身份: ${w.identity.stillSameAgent ? '同一 ✅' : '变化 ⚠️'}`)
console.log(`   记忆变更: ${w.memoryChanges.length} 条`)
console.log(`   需注意: ${w.userAttention.needsAttention}`)

console.log('\n🌅 Wake (模型升级)...')
const upgraded: AgentRef = { ...agents.executor, modelId: 'deepseek-v4-pro' }
const w2 = wake({ packet, currentAgent: upgraded, permissionState: 'needs-reauth', externalChanges: { modelChanged: 'flash→pro' } })
console.log(`   身份: ${w2.identity.stillSameAgent ? '同一 ✅' : '变化 ⚠️'}`)
console.log(`   权限: ${w2.permissionStatus.state}`)

console.log('\n✅ Sleep/Wake 测试通过')
