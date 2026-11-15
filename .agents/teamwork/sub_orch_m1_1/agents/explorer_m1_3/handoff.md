# Handoff: explorer_m1_3 — F05 (Strict TS, ESLint, Clean Code) & OpenSpec SDD Findings

## Executive Summary

1. **ESLint & Strict Typing (`eslint.config.js`, `tsconfig.json`, `lint.test.ts`):**
   - `tsconfig.json` already enforces `"strict": true` and `"noUncheckedIndexedAccess": true` across `["*.ts", "src/**/*.ts", "test/**/*.ts"]` (`bun run typecheck` currently passes with exit code `0`).
   - `eslint.config.js` currently uses `tseslint.configs.base` with only `@typescript-eslint/no-magic-numbers` (disabled for `**/*.test.ts`) and `@typescript-eslint/explicit-module-boundary-types`. It does **not** yet enable `@typescript-eslint/no-explicit-any: "error"`, nor does its `ignores` list exclude `.agents/**`.
   - When `@typescript-eslint/no-explicit-any: "error"` is enabled, **15 AST `any` errors across 8 repo files** fire (plus **2 errors inside `.agents/**`** if `.agents/**` is not ignored). Note: enabling `tseslint.configs.recommended` / `@typescript-eslint/no-unused-vars` is **not** in M1 scope and would fire **145 errors** in `src/`.
   - `lint.test.ts` (line 92) currently runs `eslint.lintFiles(["*.ts"])` only—it does **not** cover `src/**/*.ts`, `projects/**/*.ts`, or `test/**/*.ts`, and has no unit test asserting `@typescript-eslint/no-explicit-any`.

2. **OpenSpec SDD Setup (`openspec/`, `package.json`, `src/sdd/`):**
   - `openspec` is **not** installed globally on `$PATH`; it is a local devDependency (`"@fission-ai/openspec": "^1.17.0"` in `package.json:21`), invoked via `export PATH="$HOME/.bun/bin:$PATH" && bunx openspec` (observed version `1.17.0`).
   - All 22 existing changes in `openspec/changes/*` pass `bunx openspec validate --all --strict` (`Totals: 22 passed, 0 failed`).
   - Creating `openspec/changes/cascade-m1-config-guardrails/` via `bunx openspec new change cascade-m1-config-guardrails --schema spec-driven` plus `proposal.md`, `design.md`, `specs/config-guardrails/spec.md` (`SHALL`/`MUST` on the first line of each requirement body, `#### Scenario:` blocks with `WHEN`/`THEN`), and `tasks.md` satisfies both `openspec validate --strict` and `src/sdd/analyze.ts` (`analyzeChangeArtifacts`).

3. **Clean Code (Zero Inline Function-Body Comments):**
   - Every target file inspected (`platform.ts`, `opencode.ts`, `antigravity.ts`, `src/pal/adapters/gemini.ts`, `projects/agnostic_looper/verify_project_items.ts`, `config.ts`, `cascade.ts`) contains inline `//` comments inside function bodies (and some trailing comments) that should be removed or replaced by well-named helper functions / explanatory variables under Clean Code Rule #1 (`openspec/project.md` lines 39–42).

---

## 1. Toolchain, ESLint, TypeScript & Test Baseline

### Observed Baseline Commands
- `bun run typecheck` (`tsc --noEmit`): exited `0`, 0 errors.
- `bun run lint` (`eslint .`): exited `0`, 0 errors/warnings under current `eslint.config.js`.
- `bun test lint.test.ts`: `6 pass, 0 fail, 15 expect() calls`.
- `bunx eslint src/` and `bunx eslint projects/`: both exited `0` under current `eslint.config.js` (confirming `src/**/*.ts` and `projects/**/*.ts` already satisfy `@typescript-eslint/no-magic-numbers` and `@typescript-eslint/explicit-module-boundary-types`).
- `bunx openspec --version`: `1.17.0` (`which openspec` returned empty; must use `bunx openspec` with `PATH="$HOME/.bun/bin:$PATH"`).
- `bunx openspec validate --all --strict`: `Totals: 22 passed, 0 failed (22 items)`.

### Configuration Files
- `tsconfig.json` (lines 1–14):
  - `"strict": true`, `"noUncheckedIndexedAccess": true`, `"skipLibCheck": true`, `"types": ["bun"]`, `"noEmit": true`.
  - `"include": ["*.ts", "src/**/*.ts", "test/**/*.ts"]` (note: `projects/**/*.ts` is not in `tsconfig.json` `include`, though `eslint.config.js` lints `**/*.ts`).
- `eslint.config.js` (lines 1–43):
  - `ignores` (lines 5–13): `["node_modules/**", "logs/**", "graphify-out/**", ".archify/**", "docs/**", "openspec/**", "**/*.json"]`. **Missing `".agents/**"`** (if `.agents/**` is not ignored, `eslint .` scans teamwork agent scripts).
  - Extends `tseslint.configs.base` (line 15 — parser/plugin only, no rules).
  - Rules for `files: ["**/*.ts"]` (lines 17–34):
    - `@typescript-eslint/no-magic-numbers` (`ignore: [-1, 0, 1]`, `ignoreArrayIndexes: true`, `ignoreDefaultValues: true`, `ignoreClassFieldInitialValues: true`, `enforceConst: true`, `ignoreNumericLiteralTypes: true`, `ignoreEnums: true`, `ignoreReadonlyClassProperties: true`, `ignoreTypeIndexes: true`).
    - `@typescript-eslint/explicit-module-boundary-types: "error"`.
  - Override for `files: ["**/*.test.ts"]` (lines 36–41): `@typescript-eslint/no-magic-numbers: "off"`.
  - **Gap for F05:** Add `"@typescript-eslint/no-explicit-any": "error"` to the `**/*.ts` rules block, and add `".agents/**"` to `ignores`.
- `lint.test.ts` (lines 1–100):
  - Uses `new ESLint()` programmatic API (`import { ESLint } from "eslint"`).
  - Tests `no-magic-numbers` (lines 7–42, 76–89) and `explicit-module-boundary-types` (lines 44–74).
  - Line 92: `const results = await eslint.lintFiles(["*.ts"]);` — **only lints root `*.ts`**, omitting `src/**/*.ts`, `projects/**/*.ts`, and `test/**/*.ts`.
  - **Gap for F05:**
    1. Expand `lintFiles` to cover `src/**/*.ts` (e.g., `["*.ts", "src/**/*.ts"]` or `["*.ts", "src/**/*.ts", "projects/**/*.ts", "test/**/*.ts"]`).
    2. Add a test verifying `@typescript-eslint/no-explicit-any` rejects `: any` and `as any` in TypeScript source code.
  - Note: `lint.test.ts` does **not** check inline comments or Clean Code rules directly; those are checked by `src/gates/gate1_rubric.ts` (for diffs) and code review / Constitution `openspec/project.md` lines 39–42.

### Warning on Unrelated ESLint Rules
- Running `bunx eslint --rule '@typescript-eslint/no-unused-vars: error' src/ *.ts projects/` yielded **145 errors** in existing `src/` files (e.g., `src/pal/adapters/opencode.ts`, `src/pal/mcp.ts`, `src/pal/normalizer.ts`, `src/pal/react_parser.ts`, `src/sdd/analyze.ts:11` unused `stat`). Keep `tseslint.configs.base` and add only `@typescript-eslint/no-explicit-any: "error"` as scoped in `SCOPE.md`.

---

## 2. Repo-Wide Audit of `any`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`

### AST-Verified `@typescript-eslint/no-explicit-any` Errors
Command: `bunx eslint --rule '@typescript-eslint/no-explicit-any: error' src/ *.ts projects/ test/`
Result: **15 errors across 8 files** (0 warnings):

| # | File & Line:Col | Exact Symbol / Construct | Root Cause & Concrete Fix |
|---|---|---|---|
| 1 | `platform.ts:34:41` | `ProcessSignalTarget.on(event: string, listener: (...args: any[]) => void)` | Change `(...args: any[]) => void` to `(...args: unknown[]) => void` (or `() => void`). Both `NodeJS.Process` and `MockProcessTarget extends EventEmitter` remain assignable under `strictFunctionTypes`. |
| 2 | `platform.ts:35:43` | `ProcessSignalTarget.off?(event: string, listener: (...args: any[]) => void)` | Same as above: `(...args: unknown[]) => void`. |
| 3 | `platform.ts:36:54` | `ProcessSignalTarget.removeListener?(event: string, listener: (...args: any[]) => void)` | Same as above: `(...args: unknown[]) => void`. |
| 4 | `platform.ts:174:23` | `removeEventListener(..., listener: (...args: any[]) => void)` | Same as above: `(...args: unknown[]) => void`. |
| 5 | `opencode.ts:55:29` | `reduceOpenCodeEvent`: `let event: Record<string, any>;` | Parse as `unknown` (`const parsed: unknown = JSON.parse(line);`), guard with `isRecord(parsed)`, and narrow `part` / `properties` / `state` via typed interfaces or helper type guards (`OpenCodeRawEvent`, `OpenCodePart`). |
| 6 | `antigravity.ts:98:63` | `updateUsage(state: SessionState, raw: Record<string, any>)` | Replace `Record<string, any>` with typed `RawAntigravityUsage` interface (optional `number` fields) or `Record<string, unknown>` with `typeof === "number"` checks. |
| 7 | `antigravity.ts:198:29` | `reduceAntigravityEvent`: `let event: Record<string, any>;` | Parse as `unknown`, narrow via `isRecord` / typed `RawAntigravityEvent` / `RawStepUpdate` / `RawResultPayload` interfaces. |
| 8 | `src/pal/adapters/gemini.ts:1890:24` | `streamAntigravitySubprocess`: `toAsyncIterable<Uint8Array | string>(proc.stderr as any)` | `AntigravitySpawnedProcess.stderr` (`gemini.ts:164-168`) includes `NodeJS.ReadableStream`, while `toAsyncIterable<T>` (`gemini.ts:1547-1549`) only accepts `ReadableStream<T> | AsyncIterable<T> | Iterable<T>`. Include `NodeJS.ReadableStream` (or widen `toAsyncIterable` input union + handle `Symbol.asyncIterator` for `NodeJS.ReadableStream`) so `proc.stderr` and `proc.stdout` pass directly without `as any`. |
| 9 | `src/pal/adapters/gemini.ts:1914:24` | `streamAntigravitySubprocess`: `toAsyncIterable<Uint8Array | string>(proc.stdout as any)` | Same fix as line 1890 (`toAsyncIterable` signature). |
| 10 | `projects/agnostic_looper/verify_project_items.ts:168:46` | `runVerification`: `catalog.map((t: any) => t.task_key || t.taskId)` | Define `interface CatalogTaskEntry { task_key?: string; taskId?: string; }` and validate `Array.isArray(catalog)` with typed predicate / `CatalogTaskEntry` narrowing. |
| 11 | `engine.test.ts:35:52` | `getEngineAdapter("unsupported" as any)` | `getEngineAdapter` in `engine.ts:74` already has signature `(engine: EngineType | string | undefined): EngineAdapter`. Remove `as any` directly: `getEngineAdapter("unsupported")`. |
| 12 | `platform.test.ts:84:76` | `canRunSystemdInhibit("/usr/bin/systemd-inhibit", mockSuccess as any)` | `mockSuccess` (`() => ({ exitCode: 0, success: true })`) is already assignable to `spawnSyncFn: (command: string[], options: ...) => { exitCode: number; success?: boolean }` (`platform.ts:122`). Remove `as any`. |
| 13 | `platform.test.ts:85:76` | `canRunSystemdInhibit("/usr/bin/systemd-inhibit", mockFailure as any)` | Same as line 84. Remove `as any`. |
| 14 | `platform.test.ts:86:74` | `canRunSystemdInhibit("/usr/bin/systemd-inhibit", mockThrow as any)` | `mockThrow` returns `never`, which is assignable to `{ exitCode: number; success?: boolean }`. Remove `as any`. |
| 15 | `test/integration/github_project.test.ts:370:100` | `normalizeProjectV2Item(rawItemsData.data.user.projectV2.items.nodes[0] as any)` | Export `RawProjectV2ItemNode` (and `RawSingleSelectValue`, `RawContentNode`) from `src/integration/github_project.ts` (currently private at line 1034) and type the fixture / node in `test/integration/github_project.test.ts` as `RawProjectV2ItemNode`. |

Additionally, `bunx eslint --rule '@typescript-eslint/no-explicit-any: error' .` reported **2 errors inside `.agents/`** (untracked/internal teamwork scripts):
- `.agents/teamwork/teamwork_preview_victory_auditor_1/independent_audit.ts:30:39`
- `.agents/teamwork/worker_m2_1/populate_tasks.ts:784:23`
-> Adding `".agents/**"` to `ignores` in `eslint.config.js` prevents `eslint .` from scanning `.agents/`.

### Non-AST String / Regex Occurrences of `any` & Suppressions
- `eslint-disable`: **0 occurrences** in `*.ts` (only referenced as a literal string `"// eslint-disable"` in `src/gates/gate1_rubric.ts:381`).
- `@ts-ignore` / `@ts-nocheck`: **0 occurrences** in `*.ts` (only referenced as regex pattern in `src/gates/gate1_rubric.ts:396`).
- `@ts-expect-error`: **3 occurrences**, all intentional negative type-test assertions in `test/gates/gate0_policy.test.ts:117, 119, 163` (`// @ts-expect-error test invalid types`).
- String-literal `as any` inside code generator templates: `src/gates/gate2_synthesis.ts` lines `376–378, 400, 498–500, 520, 629–631, 637, 725–727, 733` emit `as any` into dynamically generated challenger probe test strings (`test/challenger_<id>.test.ts`). Not flagged by ESLint AST `no-explicit-any`, and M4/gate2 is out of M1 scope, but noted for completeness.

---

## 3. Target File Inspection: `any`, ESLint, and Inline Function-Body Comments

Under `openspec/project.md` lines 39–42 and `.agents/skills/clean-code-best-practices/SKILL.md`:
> "NEVER write comments inside function bodies explaining *WHAT* the code does. Comments are reserved for docstrings explaining *WHY*."

Exact `//` comment inventory in the 7 files named in `DISPATCH.md`:

1. **`platform.ts`** (373 lines):
   - `any` leaks: lines `34, 35, 36, 174`.
   - Inline function-body `//` comments (3):
     - Line `101`: `// Ignore inaccessible directories in PATH` (in `resolveBinaryInPath` catch block)
     - Line `258`: `// Subprocess already terminated` (in `stopController` catch block)
     - Line `296`: `// Other OS defaults to noop-fallback` (in `startKeepAlive` else branch)
   - Also note Clean Code rule #4 (`SKILL.md:53`): empty/comment-only catch blocks (`lines 100-102`, `136-138`, `257-259`) exist.

2. **`opencode.ts`** (169 lines):
   - `any` leaks: line `55` (`let event: Record<string, any>;`).
   - Inline / trailing `//` comments (4 total, 2 inside functions):
     - Line `16`: `export const OPENCODE_DEFAULT_MODEL = CONSTANTS.DEFAULT_OPENCODE_MODEL; // OpenCode Zen` (module-level trailing)
     - Line `20`: `// Waiting or retrying never fixes these: stop the cascade` (module-level WHY comment before `UNRECOVERABLE`)
     - Line `59`: `return; // non-JSON noise (banners, warnings)` (inside `reduceOpenCodeEvent`)
     - Line `103`: `// Highest-precedence config: permissions for this run only, over the project's opencode.json` (inside `runOpenCodeSession` options literal)

3. **`antigravity.ts`** (356 lines):
   - `any` leaks: line `98` (`raw: Record<string, any>`), line `198` (`let event: Record<string, any>;`).
   - Inline function-body `//` comments (4 inside functions + 1 module-level):
     - Line `22`: `// Waiting or retrying never fixes these: stop the cascade` (module-level)
     - Line `130`: `// Check command / cmd / CommandLine along with optional args` (in `describeToolInput`)
     - Line `149`: `// Check path / file_path / Path` (in `describeToolInput`)
     - Line `155`: `// Check pattern, url, query, description` (in `describeToolInput`)
     - Line `202`: `return; // non-JSON noise (banners, warnings)` (in `reduceAntigravityEvent`)
   - Refactoring opportunity: `describeToolInput` lines 130–157 can extract small named helpers (`extractCommandDescription`, `extractPathDescription`, `extractFallbackDescription`) eliminating all 3 section comments.

4. **`src/pal/adapters/gemini.ts`** (3038 lines):
   - `any` leaks: lines `1890` (`proc.stderr as any`), `1914` (`proc.stdout as any`).
   - `//` comments: **42 total** in `gemini.ts`:
     - Module-level constant section headers: lines `54, 58, 67, 77, 81, 88, 102, 110, 114, 127, 142`, and re-export comment line `825`.
     - Function-body inline comments (30): lines `626, 636, 664, 673` (`unwrapProtobufValue`); `757, 776, 782` (`describeToolInput` — duplicated with `antigravity.ts`); `965, 1001, 1018, 1026, 1034, 1045, 1060, 1068, 1097, 1121, 1179, 1228, 1241, 1281, 1307` (`GeminiNdjsonStreamReducer`); `1872` (`streamAntigravitySubprocess`); `2322, 2347, 2371` (`buildGenerateContentRequest`); `2780, 2801` (`streamResponse`).
   - Note: Removing/refactoring the 30 function-body inline comments in `gemini.ts` (or extracting small helper methods) must be done carefully without altering M2 adapter semantics.

5. **`projects/agnostic_looper/verify_project_items.ts`** (246 lines):
   - `any` leaks: line `168` (`catalog.map((t: any) => t.task_key || t.taskId)`).
   - Inline function-body `//` comments (3, all inside `runVerification()`):
     - Line `162`: `// Load catalog to verify against planned tasks`
     - Line `175`: `// Filter items matching [LOOPER-`
     - Line `216`: `// Check if all catalog tasks are accounted for`
   - Note: `verify_project_items.ts` lines 192–194 also have `const PAD_LENGTH = 2;` etc. at 0-indent inside `runVerification()` (formatting/indentation cleanup recommended when touching it).

6. **`config.ts`** (657 lines):
   - `any` leaks: **0**.
   - `//` comments: 15 constant-group headers inside `CONSTANTS` (lines `17–150`) + **10 function-body section comments** inside `loadConfig()` (lines `433, 437, 449, 462, 466, 480, 484, 495, 540, 579`: `// 1. Repo` .. `// 9. Failure Resilience & Rollback Buffer`). Note: `config.ts` is being refactored into `src/config/{constants,schemas,guardrails,loader}.ts` + thin `config.ts` facade under F01–F04 anyway.

7. **`cascade.ts`** (626 lines):
   - `any` leaks: **0**.
   - `//` comments:
     - Top-level section dividers/module notes: lines `96, 116, 152, 260, 303, 559`.
     - Function-body inline comments (6): lines `165` (`parseTasks`), `204` & `211` (`verifyCommands`), `234` (`blockedReason`), `425` & `447` & `480` (`runTask`). (7 total inside functions.)
   - Note: `cascade.ts` line `102` (`export const config: CascadeConfig = loadConfig();`) is the import-time side effect targeted by F04.

---

## 4. OpenSpec `--strict` Conventions & M1 Change Requirements

### Observed OpenSpec Structure (`openspec/changes/*`)
From `openspec/changes/well-architecture-config/` and `openspec/changes/cascade-v2-sdd-framework/` and `openspec/config.yaml`:
1. `.openspec.yaml`:
   ```yaml
   schema: spec-driven
   created: YYYY-MM-DD
   ```
   (22 of 22 existing changes include `.openspec.yaml`; generated cleanly by `bunx openspec new change <id> --schema spec-driven`.)
2. `proposal.md`: `# Proposal: ...`, `## Why`, `## What Changes`, `## Definition of Done`.
3. `design.md`: `# Design: ...`, `## Context`, `## Decisions` (with `*Rationale:*`).
4. `specs/<capability>/spec.md`:
   - Heading: `# Spec: ...` (or `# <Title> Specification`)
   - Section: `## ADDED Requirements`
   - Each requirement: `### Requirement: <Title>`
   - **Rule (`openspec validate --strict` & `openspec/project.md:28`):** First line of requirement body MUST contain `SHALL` or `MUST` (e.g., `The system MUST ...`).
   - **Rule (`openspec validate --strict`):** Each requirement MUST have at least one `#### Scenario: <Name>` block with `- **WHEN** ...` and `- **THEN** ...` (and optional `- **AND** ...`).
5. `tasks.md`:
   - `# Tasks`, numbered sections `## 1. ...`, checkboxes `- [ ] 1.1 ...`.
   - **Cross-Artifact Analyze Gate (`src/sdd/analyze.ts:162-181`):** `analyzeChangeArtifacts` extracts requirement titles from `### Requirement: ...` (`extractRequirementsFromSpec`), splits into words with `length > CONSTANTS.SDD_MIN_KEYWORD_LENGTH` (`3`), and checks that **every requirement** has at least one task in `tasks.md` containing at least one of those keywords (case-insensitive).

### SDD Gate Note (`src/sdd/sdd_gate.ts`)
- `findActiveOpenSpecChange` (`src/sdd/sdd_gate.ts:79-114`) scans `openspec/changes/*` for any `tasks.md` containing `- [ ]`. Note that `openspec/changes/looper-pal-jules-adapter/tasks.md:6` currently has `- [ ] 1.2 ...` unchecked. Creating `openspec/changes/cascade-m1-config-guardrails/` with all M1 specs & tasks **before** editing production code complies with `openspec/project.md` Principle #1.

---

## 5. Actionable Checklist for M1 (F05 + OpenSpec SDD)

1. **Create & validate M1 OpenSpec change first:**
   - `bunx openspec new change cascade-m1-config-guardrails --schema spec-driven`
   - Author `proposal.md`, `design.md`, `specs/config-guardrails/spec.md` (`MUST`/`SHALL` + `#### Scenario:` per requirement), and `tasks.md` (covering F01–F05 with keyword overlap for `analyzeChangeArtifacts`).
   - Verify with `bunx openspec validate cascade-m1-config-guardrails --strict` and `analyzeChangeArtifacts("cascade-m1-config-guardrails")`.
2. **Update `eslint.config.js`:**
   - Add `".agents/**"` to `ignores`.
   - Add `"@typescript-eslint/no-explicit-any": "error"` to the `**/*.ts` rules block.
3. **Eliminate all 15 `any` leaks across the 8 affected files:**
   - `platform.ts:34-36, 174`
   - `opencode.ts:55`
   - `antigravity.ts:98, 198`
   - `src/pal/adapters/gemini.ts:1890, 1914`
   - `projects/agnostic_looper/verify_project_items.ts:168`
   - `engine.test.ts:35`
   - `platform.test.ts:84-86`
   - `test/integration/github_project.test.ts:370` (plus exporting `RawProjectV2ItemNode` from `src/integration/github_project.ts`)
4. **Remove inline function-body comments (Clean Code Rule #1):**
   - Clean up function-body `//` comments in M1-touched files (`src/config/*`, `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `projects/agnostic_looper/verify_project_items.ts`, and `src/pal/adapters/gemini.ts` where touched) by extracting small self-documenting helpers or removing redundant step comments while preserving WHY-explaining JSDoc/TSDoc.
5. **Expand `lint.test.ts`:**
   - Expand `eslint.lintFiles` from `["*.ts"]` to include `src/**/*.ts` (e.g. `["*.ts", "src/**/*.ts"]` or `["*.ts", "src/**/*.ts", "projects/**/*.ts", "test/**/*.ts"]`).
   - Add test coverage asserting `@typescript-eslint/no-explicit-any` rejects explicit `any` and `as any`.
6. **Verify F05:**
   - `bun run typecheck` -> exit `0`
   - `bun run lint` -> exit `0` (0 errors, 0 warnings)
   - `bun test lint.test.ts` -> pass
   - `bunx openspec validate cascade-m1-config-guardrails --strict` -> pass
