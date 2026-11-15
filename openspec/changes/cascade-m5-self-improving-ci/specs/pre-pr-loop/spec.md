# Spec: Bounded Pre-PR Review Loop

## ADDED Requirements

### Requirement: Review-Fix Loop Bounded to Three Rounds
The system MUST alternate review and mechanical fixes for at most three rounds and report `clean`, `needs_human`, `exhausted`, `stale`, `mismatch` or `empty`.

#### Scenario: Mechanical findings are fixed then the review is clean
- **WHEN** the first review reports one mechanical finding and the second reports none
- **THEN** the fixer runs once and the loop returns `clean` after two rounds

#### Scenario: Risky findings stop the loop
- **WHEN** a review reports a security finding
- **THEN** the loop returns `needs_human` without invoking the fixer

#### Scenario: Round budget is enforced
- **WHEN** reviews keep reporting mechanical findings and ten rounds are requested
- **THEN** the loop stops after three rounds with `exhausted`
