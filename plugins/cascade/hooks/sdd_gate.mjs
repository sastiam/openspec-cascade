#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const SRC_EXT = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.py', '.go', '.rs', '.java']
const EXEMPT = ['/test', '/tests', '/__tests__', '/spec', '/specs', '/docs', '/openspec', '/.agents', '/.claude']

function isProduction(fp) {
  if (!fp) return false
  const low = '/' + fp.toLowerCase().replace(/\\/g, '/')
  if (!SRC_EXT.some((e) => low.endsWith(e))) return false
  if (EXEMPT.some((seg) => low.includes(seg))) return false
  const base = path.basename(low)
  if (base.startsWith('test_') || base.startsWith('test.') || base.includes('.test.') || base.includes('.spec.')) return false
  return true
}

function hasActiveChange(cwd) {
  const changesDir = path.join(cwd, 'openspec', 'changes')
  try {
    const entries = fs.readdirSync(changesDir, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const tasksPath = path.join(changesDir, ent.name, 'tasks.md')
      try {
        const content = fs.readFileSync(tasksPath, 'utf8')
        if (content.split('\n').some((l) => l.trim().startsWith('- [ ]'))) return true
      } catch {}
    }
  } catch {}
  return false
}

function main() {
  if (process.env.CASCADE_SDD_GATE_DISABLED === '1') return 0
  let raw = ''
  try { raw = fs.readFileSync(0, 'utf8') } catch { return 0 }
  if (!raw.trim()) return 0
  let data
  try { data = JSON.parse(raw) } catch { return 0 }
  if (!['Edit', 'Write', 'MultiEdit'].includes(data.tool_name)) return 0
  const fp = (data.tool_input || {}).file_path || ''
  if (!isProduction(fp)) return 0
  const cwd = data.cwd || process.cwd()
  if (hasActiveChange(cwd)) return 0

  process.stderr.write(
    'SDD Gate Block: Attempted modification of production source without an active OpenSpec change. ' +
    'Spec before code: create or activate a validated change under openspec/changes/ with pending tasks in tasks.md before editing code. ' +
    '(Tests, docs, and specifications are exempt; set CASCADE_SDD_GATE_DISABLED=1 to bypass).'
  )
  return 2
}

process.exit(main())
