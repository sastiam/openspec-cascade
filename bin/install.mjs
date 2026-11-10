#!/usr/bin/env node
/**
 * OpenSpec Cascade CLI Installer for Claude Code.
 *
 * Configures Claude Code on this machine to access OpenSpec Cascade v2:
 *  - Registers the openspec-cascade marketplace & installs the cascade plugin
 *    (agents, commands, skills, and SDD hooks) via `claude plugin` CLI or settings.json fallback,
 *  - Installs the cascade-looper workflow into ~/.claude/workflows/,
 *  - Enables the Workflow tool (settings.enableWorkflows = true),
 *  - Checks toolchain prerequisites (bun, openspec, node, git).
 *
 * Usage:
 *   node bin/install.mjs            (interactive prompt)
 *   node bin/install.mjs --yes      (accept all defaults automatically)
 *   node bin/install.mjs --dry-run  (preview actions without making changes)
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARGS = new Set(process.argv.slice(2))
const AUTO = ARGS.has('--yes') || ARGS.has('-y')
const DRY = ARGS.has('--dry-run')

function log(msg = '') {
  process.stdout.write(msg + '\n')
}

function detectConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(filePath, obj) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n')
}

function hasCli(bin) {
  try {
    execSync(process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`, {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function run(cmd, { optional = false } = {}) {
  log(`     $ ${cmd}`)
  if (DRY) return true
  try {
    execSync(cmd, { stdio: 'inherit' })
    return true
  } catch (err) {
    const firstLine = err.message ? err.message.split('\n')[0] : String(err)
    log(`     ! failed${optional ? ' (continuing)' : ''}: ${firstLine}`)
    if (!optional) throw err
    return false
  }
}

function deriveRepoName() {
  try {
    const url = execSync(`git -C "${REPO_ROOT}" remote get-url origin`, {
      encoding: 'utf8',
    }).trim()
    const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)/)
    return match ? match[1] : 'sastiam/openspec-cascade'
  } catch {
    return 'sastiam/openspec-cascade'
  }
}

async function ask(rl, question, defaultValue = true) {
  if (AUTO) return defaultValue
  const answer = (
    await new Promise((resolve) =>
      rl.question(`  ${question} [${defaultValue ? 'Y/n' : 'y/N'}] `, resolve)
    )
  )
    .trim()
    .toLowerCase()
  return answer === '' ? defaultValue : ['y', 'yes', 's', 'si'].includes(answer)
}

async function main() {
  const configDir = detectConfigDir()
  const settingsPath = path.join(configDir, 'settings.json')
  const workflowsDir = path.join(configDir, 'workflows')
  const repoName = deriveRepoName()
  const hasClaude = hasCli('claude')
  const hasBun = hasCli('bun')
  const hasOpenspec = hasCli('openspec')

  log('')
  log('  ======================================================')
  log('    OpenSpec Cascade v2 — Claude Code CLI Installer')
  log('  ======================================================')
  log(`  Claude Config Dir : ${configDir}`)
  log(`  Cascade Repo      : ${repoName}`)
  log(`  Claude CLI        : ${hasClaude ? 'found (active plugin install)' : 'not found (settings.json fallback)'}`)
  log(`  Bun Runtime       : ${hasBun ? 'found' : 'not found (install bun for fastest looper)'}`)
  log(`  OpenSpec CLI      : ${hasOpenspec ? 'found' : 'not found (install with npm i -g @fission-ai/openspec)'}`)
  log(`  Execution Mode    : ${DRY ? 'DRY-RUN (no modifications)' : AUTO ? 'automated (--yes)' : 'interactive'}`)
  log('')

  const rl = AUTO ? null : readline.createInterface({ input: process.stdin, output: process.stdout })

  const installPlugin = await ask(rl, 'Install the OpenSpec Cascade plugin into Claude Code?', true)
  const installWorkflow = await ask(rl, 'Install the cascade-looper dynamic workflow into ~/.claude/workflows/?', true)
  const linkGlobalBin = await ask(rl, 'Register openspec-cascade globally via bun/npm link?', true)

  if (rl) rl.close()
  log('')

  // 1. Install Cascade Plugin
  if (installPlugin) {
    log('  1. Configuring Claude Code Marketplace & Plugin:')
    if (hasClaude) {
      log('   • Adding marketplace and installing cascade plugin...')
      run(`claude plugin marketplace add "${REPO_ROOT}"`, { optional: true })
      run(`claude plugin install cascade@openspec-cascade --scope user`, { optional: true })
    } else {
      log('   • Configuring settings.json directly...')
      const settings = readJson(settingsPath, {})
      const marketplaces = { ...(settings.extraKnownMarketplaces || {}) }
      const enabled = { ...(settings.enabledPlugins || {}) }

      marketplaces['openspec-cascade'] = {
        source: {
          source: 'directory',
          path: REPO_ROOT,
        },
      }
      enabled['cascade@openspec-cascade'] = true

      if (!DRY) {
        writeJson(settingsPath, {
          ...settings,
          extraKnownMarketplaces: marketplaces,
          enabledPlugins: enabled,
        })
      }
      log(`     Registered marketplace: openspec-cascade -> ${REPO_ROOT}`)
    }
  }

  // 2. Install Dynamic Workflow
  if (installWorkflow) {
    log('  2. Installing cascade-looper workflow:')
    const srcWorkflow = path.join(REPO_ROOT, 'plugins', 'cascade', 'workflows', 'cascade-looper.mjs')
    const dstWorkflow = path.join(workflowsDir, 'cascade-looper.mjs')

    log(`     Source: ${srcWorkflow}`)
    log(`     Target: ${dstWorkflow}`)

    if (!DRY) {
      if (fs.existsSync(srcWorkflow)) {
        if (!fs.existsSync(workflowsDir)) {
          fs.mkdirSync(workflowsDir, { recursive: true })
        }
        fs.copyFileSync(srcWorkflow, dstWorkflow)
        log('     ✔ Workflow copied successfully.')
      } else {
        log(`     ! Source workflow not found: ${srcWorkflow}`)
      }

      // Enable workflows in settings.json
      const settings = readJson(settingsPath, {})
      if (!settings.enableWorkflows) {
        writeJson(settingsPath, { ...settings, enableWorkflows: true })
        log('     ✔ Enabled settings.enableWorkflows = true.')
      }
    }
  }

  // 3. Register global binary link
  if (linkGlobalBin) {
    log('  3. Registering openspec-cascade CLI binary:')
    if (hasBun) {
      run(`bun link`, { optional: true })
    } else if (hasCli('npm')) {
      run(`npm link`, { optional: true })
    }
  }

  log('')
  log(DRY ? '  DRY-RUN complete. Nothing was changed.' : '  ✔ Installation complete!')
  log('')
  log('  How to use with Claude Code:')
  log('    1. Start or restart Claude Code (`claude`).')
  log('    2. In any project with `openspec/`, run `/cascade` or `/cascade-looper`.')
  log('    3. Claude can invoke the looper workflow via the Workflow tool:')
  log(`       { scriptPath: "${path.join(workflowsDir, 'cascade-looper.mjs')}", args: { changes: "..." } }`)
  log('')
}

main().catch((err) => {
  process.stderr.write(`\nInstaller error: ${err.message}\n`)
  process.exit(1)
})
