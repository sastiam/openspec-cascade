# In-Repo Skills Specification

## ADDED Requirements

### Requirement: In-Repo Skill Discovery and Injection
The harness MUST load local repository skills and inject them into agent session prompts.

#### Scenario: Session initialization
- **WHEN** an agent session starts for a task
- **THEN** `skills.ts` discovers `.agents/skills/*/SKILL.md` files and appends their directives to the system prompt.
