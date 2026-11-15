'use strict'
/**
 * Dependency-free SDD gate shared by sdd_gate.mjs and sdd_gate.cjs.
 * Rules come from sdd_rules.json, generated from the TypeScript constants by
 * `bun run scripts/sync_plugin.ts`, so the hook never drifts from src/sdd/sdd_gate.ts.
 */
const fs = require('node:fs')
const path = require('node:path')

const RULES_FILE = path.join(__dirname, 'sdd_rules.json')
const ALLOW = 0

function loadRules(rulesFile = RULES_FILE) {
  try {
    return JSON.parse(fs.readFileSync(rulesFile, 'utf8'))
  } catch {
    return null
  }
}

function isProductionSourceFile(filePath, rules) {
  if (!filePath) return false
  const normalized = ('/' + path.normalize(filePath).replace(/\\/g, '/')).toLowerCase()
  if (!rules.productionExtensions.some((ext) => normalized.endsWith(ext))) return false
  if (rules.exemptPathSegments.some((segment) => normalized.includes(segment))) return false
  const fileName = path.basename(normalized)
  if (rules.exemptNamePrefixes.some((prefix) => fileName.startsWith(prefix))) return false
  if (rules.exemptNameSuffixes.some((suffix) => fileName.includes(suffix))) return false
  return true
}

function findActiveChange(repoRoot) {
  const changesDir = path.join(path.resolve(repoRoot), 'openspec', 'changes')
  let entries
  try {
    entries = fs.readdirSync(changesDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const content = fs.readFileSync(path.join(changesDir, entry.name, 'tasks.md'), 'utf8')
      if (content.split('\n').some((line) => line.trim().startsWith('- [ ]'))) return entry.name
    } catch {
      continue
    }
  }
  return null
}

function evaluate(payload, env, rules) {
  if (!rules) return { exitCode: ALLOW }
  if (env[rules.disableEnv] === rules.disableValue) return { exitCode: ALLOW }
  if (!payload || !rules.gatedTools.includes(payload.tool_name)) return { exitCode: ALLOW }
  const filePath = (payload.tool_input || {}).file_path || ''
  if (!isProductionSourceFile(filePath, rules)) return { exitCode: ALLOW }
  if (findActiveChange(payload.cwd || process.cwd())) return { exitCode: ALLOW }
  return { exitCode: rules.blockExitCode, message: rules.blockMessage }
}

function main(stdinText, env = process.env, rulesFile = RULES_FILE) {
  if (!stdinText || !stdinText.trim()) return { exitCode: ALLOW }
  let payload
  try {
    payload = JSON.parse(stdinText)
  } catch {
    return { exitCode: ALLOW }
  }
  return evaluate(payload, env, loadRules(rulesFile))
}

function run() {
  let raw = ''
  try {
    raw = fs.readFileSync(0, 'utf8')
  } catch {
    raw = ''
  }
  const result = main(raw)
  if (result.message) process.stderr.write(result.message)
  process.exit(result.exitCode)
}

module.exports = { loadRules, isProductionSourceFile, findActiveChange, evaluate, main, run }
