#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook (ESM entry point). Logic lives in sdd_gate_core.cjs.
 */
import { createRequire } from 'node:module'

createRequire(import.meta.url)('./sdd_gate_core.cjs').run()
