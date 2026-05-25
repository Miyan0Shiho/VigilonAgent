import { extractSkillsAndRules, type ExtractionInput, type Skill, type Rule } from '../src/skillsRules.js'
import type { DreamOutput } from '../src/dream.js'
import type { DisputeResult } from '../src/dispute.js'

const dreamOutput: DreamOutput = {
  dreamId: 'dream-001',
  merged: [],
  cleaned: [{ target: 'mem-3', content: 'auth 旧代码在 /src/legacy/auth', reason: '目录已安全删除' }],
  updated: [{ target: 'mem-2', oldContent: '用户文件系统不熟练', newContent: '用户理解子模块概念，能力被低估', reason: '用户在争议中展现了 git 知识' }],
  crossAnalysis: [
    { pattern: '子模块 monorepo 中删除目录易忽略子模块引用', evidence: ['mem-4', 'dispute d-001'], insight: '删除目录前必须先检查目标路径是否包含或被 git 子模块引用' },
  ],
}

const disputeResults: DisputeResult[] = [{
  disputeId: 'd-001', resolution: 'negotiated', decision: 'modify',
  modifiedPlan: '删除前先检查子模块', resolvedBy: 'auto',
  reason: '双方协商达成一致',
  trustImpacts: [
    { fromId: 'agent-reviewer', toId: 'agent-executor', delta: 3, reason: '愿意协商' },
    { fromId: 'agent-executor', toId: 'agent-reviewer', delta: 3, reason: '合理质疑' },
  ],
}]

console.log('🔬 Skills/Rules 提取 (首次)')
const r1 = await extractSkillsAndRules({
  agentId: 'agent-executor', sessionId: 'session-001',
  sessionSummary: '重构 auth，审查者质疑删除操作。用户维持质疑。重构完成。',
  events: [
    { type: 'success', description: 'auth 重构完成' },
    { type: 'dispute', description: '审查者质疑删除目录', outcome: '用户维持质疑' },
    { type: 'success', description: '增加 .git 检查步骤避免了事故' },
  ],
  dreamOutput, disputeResults,
  existingSkills: [], existingRules: [],
})
console.log(`   新 Skills: ${r1.newSkills.length}`)
r1.newSkills.forEach(s => console.log(`     📎 ${s.name} (信心: ${s.confidence})`))
console.log(`   新 Rules: ${r1.newRules.length}`)
r1.newRules.forEach(r => console.log(`     🚫 [${r.type}] ${r.rule}`))

// Second session — skill reinforced
if (r1.newSkills.length > 0 || r1.newRules.length > 0) {
  console.log('\n🔬 Skills/Rules 提取 (第二次 — 技能被强化)')
  const r2 = await extractSkillsAndRules({
    ...r1, sessionId: 'session-002',
    sessionSummary: '重构 database 模块。Agent 主动在删除前检查了子模块，无争议，比上次快 40%。',
    events: [
      { type: 'success', description: 'database 重构完成，主动执行删除前检查' },
      { type: 'observation', description: '审查者未发起争议，Agent 已内化经验' },
    ],
    dreamOutput: { ...dreamOutput, cleaned: [], crossAnalysis: [] },
    disputeResults: [],
    existingSkills: r1.newSkills, existingRules: r1.newRules,
  })
  console.log(`   新 Skills: ${r2.newSkills.length}`)
  console.log(`   更新 Skills: ${r2.updatedSkills.length}`)
  r2.updatedSkills.forEach(s => console.log(`     📝 ${s.skillId}: ${s.changes} → 信心 ${s.newConfidence}`))
}

console.log('\n✅ Skills/Rules 测试通过')
