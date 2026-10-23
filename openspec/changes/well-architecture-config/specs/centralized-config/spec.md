# Centralized Config Specification

## ADDED Requirements

### Requirement: Typed Centralized Configuration
The application MUST load runtime configuration from `config.ts` without hardcoded magic numbers.

#### Scenario: Config loading
- **WHEN** `cascade.ts` starts
- **THEN** it loads application parameters from `config.ts` with CLI and environment variable overrides.
