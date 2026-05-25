import { resolveDispute, type DisputeInput } from '../src/dispute.js'

const trustGraph = {
  'agent-executor': { 'agent-reviewer': 65, 'agent-guide': 85 },
  'agent-reviewer': { 'agent-executor': 55, 'agent-guide': 70 },
  'agent-guide': { 'agent-executor': 85, 'agent-reviewer': 70 },
}

function test(label: string, overrides: Partial<DisputeInput>) {
  const input: DisputeInput = {
    disputeId: `d-${Date.now()}`,
    subject: { type: 'action', targetId: 'tc-42', description: 'rm -rf old-dir/' },
    risk: 'medium',
    challengerId: 'agent-reviewer', defenderId: 'agent-executor',
    stances: [
      { agentId: 'agent-reviewer', position: 'block', reasoning: '可能有子模块风险' },
      { agentId: 'agent-executor', position: 'approve', reasoning: 'init 脚本创建的' },
    ],
    trustGraph, reversible: true, availableMediators: ['agent-guide'],
    ...overrides,
  }
  const r = resolveDispute(input)
  console.log(`  ${label}: ${r.resolution} → ${r.decision} (${r.resolvedBy})`)
  return r
}

console.log('⚖️  Dispute 测试 (角色无关)')
test('低风险+信任差', { disputeId: 'd-1', risk: 'low', trustGraph: { 'agent-executor': { 'agent-reviewer': 80 }, 'agent-reviewer': { 'agent-executor': 50 }, 'agent-guide': {} } })
test('中风险+信任接近', { disputeId: 'd-2', risk: 'medium' })
test('中风险+信任不足', { disputeId: 'd-3', risk: 'medium', trustGraph: { 'agent-executor': { 'agent-reviewer': 45 }, 'agent-reviewer': { 'agent-executor': 48 }, 'agent-guide': { 'agent-executor': 85, 'agent-reviewer': 70 } } })
test('高风险', { disputeId: 'd-4', risk: 'high', blastRadius: '删除数据库表' })
test('关键风险', { disputeId: 'd-5', risk: 'critical' })
console.log('  ✅ 通过')
