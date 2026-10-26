# Design: In-Repo Skills & Context Engine

## Context

AI agent sessions running under `cascade.ts` execute across different model providers (Claude Agent SDK, OpenCode CLI, Antigravity CLI). While some SDKs support project configuration folders natively, external CLI engines (OpenCode, Antigravity) do not automatically discover local repository skills unless explicitly injected into their task prompts.

`skills.ts` serves as a lightweight, cross-engine context loader that scans local repository skills and injects an indexed catalog into session prompts without consuming excessive token budget.

## Decisions

### 1. Skill Discovery & Data Model

`skills.ts` exports the `InRepoSkill` interface and discovery functions:

```typescript
export interface InRepoSkill {
  name: string;
  description: string;
  path: string;
  body: string;
}
```

- **Discovery Directories**:
  - `.agents/skills/*/SKILL.md`
  - `.claude/skills/*/SKILL.md`
- **Graceful Failure**: If either directory does not exist or cannot be read, `discoverSkills(repoRoot)` catches errors gracefully and returns an empty list `[]` instead of throwing global exceptions.
- **Frontmatter Parsing**: Uses a lightweight regular expression on YAML frontmatter delimiters `^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$` to extract `name` and `description` key-value pairs without adding third-party YAML dependencies.

### 2. Prompt Injection Format (Indexed Catalog)

To avoid bloating context windows across dozens of turns with full markdown bodies of multiple skills, `formatSkillsPrompt()` produces an indexed XML-tagged catalog:

```markdown
<skills>
Repository-specific skills are available to assist with this task:
- openspec-cascade-runner (.agents/skills/openspec-cascade-runner/SKILL.md): Quality standards, architecture principles, in-repo skill usage, and QA verification rules for AI agents executing within openspec-cascade.
- openspec-apply-change (.agents/skills/openspec-apply-change/SKILL.md): Implement tasks from an OpenSpec change.
Use your file reading tool to inspect any skill file if relevant to the current task.
</skills>
```

If project-level directive files (`AGENTS.md` or `CLAUDE.md`) exist in the repository root, their contents are appended as project-wide constraints.

### 3. Centralized Injection Point in `cascade.ts`

Skill injection occurs within `taskPrompt()` in `cascade.ts`. Because all execution engines (`runClaude`, `runOpenCode`, `runAntigravity`) build their initial task prompt via `taskPrompt()`, this ensures 100% feature and context parity across all engines with zero engine-specific branching.
