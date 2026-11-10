export const meta = {
  name: 'cascade-looper',
  description: 'Autonomous OpenSpec Cascade task looper and SDD execution workflow for Claude Code.',
  phases: [
    { title: 'Inspect', model: 'haiku' },
    { title: 'Execute', model: 'sonnet' },
    { title: 'Verify', model: 'haiku' },
  ],
}

const A = typeof args === 'string' ? { changes: args } : args && typeof args === 'object' ? args : {}
const CHANGES = (A.changes || '').toString()
const REPO = (A.repo || process.cwd()).toString()
const FULL_GATE = A.fullGate === true

phase('Inspect')
const plan = await agent(
  `Inspect OpenSpec changes in ${JSON.stringify(REPO)}. Run \`bun run cascade.ts --changes "${CHANGES}" --dry-run\` or \`openspec list --json\` and return pending tasks count.`,
  { label: 'inspect-plan', phase: 'Inspect', agentType: 'general-purpose', model: 'haiku', effort: 'low' }
)

phase('Execute')
const run = await agent(
  `Execute OpenSpec Cascade task runner in ${JSON.stringify(REPO)} for changes "${CHANGES}". Command: \`bun run cascade.ts --changes "${CHANGES}"${FULL_GATE ? ' --full-gate' : ''}\`. Follow house rules strictly: zero magic numbers, zero inline comments inside function bodies, strictly typed.`,
  { label: 'execute-cascade', phase: 'Execute', agentType: 'general-purpose', model: 'sonnet', effort: 'high' }
)

phase('Verify')
const verify = await agent(
  `Run deterministic verification suite in ${JSON.stringify(REPO)}: test, typecheck, lint. Report real exit codes.`,
  { label: 'verify-suite', phase: 'Verify', agentType: 'general-purpose', model: 'haiku', effort: 'low' }
)

return { plan, run, verify }
