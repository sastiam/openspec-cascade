# Spec: Plugin and Hook Synchronization

## ADDED Requirements

### Requirement: Generated SDD Hook Rules
The system MUST generate `plugins/cascade/hooks/sdd_rules.json` from `SDD_CONSTANTS` and `EXIT_CODE_CONSTANTS`, and the `.mjs` and `.cjs` hooks MUST enforce exactly those rules and exit code.

#### Scenario: Drift is detected
- **WHEN** the committed rule file differs from `buildSddHookRules()`
- **THEN** the sync drift test fails

#### Scenario: Hooks agree with the TypeScript gate
- **WHEN** both hooks receive the same PreToolUse payloads (production file without active change, test file, `.rb` file, disabled via env)
- **THEN** they return the same exit codes, matching `isProductionSourceFile` classification and `EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL` for blocks

### Requirement: Synchronized Commands, Workflow and Installer
The system MUST document `--mode v1|v2` and the `jules`/`gemini` engines in plugin commands and workflow, and `bin/install.mjs` MUST verify the complete hook bundle before registering the in-place plugin.

#### Scenario: Installer verifies the hook bundle
- **WHEN** the installer registers the plugin
- **THEN** it confirms `hooks.json`, `sdd_gate.mjs`, `sdd_gate.cjs`, `sdd_gate_core.cjs` and `sdd_rules.json` exist, and aborts with a sync hint when any is missing
