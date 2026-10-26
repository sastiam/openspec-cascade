# Proposal: In-Repo Skills & Context Engine

## Why

AI agent sessions running within `openspec-cascade` must adhere to repository-specific skills (`.agents/skills/`) and architectural directives (`AGENTS.md`, `CLAUDE.md`).

## What Changes

- Implement `skills.ts` to discover, parse, and inject in-repo skills into agent system prompts.
- Automatically append `AGENTS.md` and `CLAUDE.md` content into initial session prompts for Claude, OpenCode, and Antigravity engines.

## Definition of Done

- In-repo skills in `.agents/skills/*/SKILL.md` are loaded and injected into agent session prompts.
- `AGENTS.md` and `CLAUDE.md` directives are respected by all execution engines.
