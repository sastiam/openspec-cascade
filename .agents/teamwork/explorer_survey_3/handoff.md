# GitHub Project #4 Environment & Item Creation Specification

**Agent**: Explorer 3 (`explorer_survey_3`) — GitHub Project #4 Specialist  
**Working Directory**: `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_3`  
**Date**: 2026-10-24  
**Target Project**: [https://github.com/users/sastiam/projects/4](https://github.com/users/sastiam/projects/4)  
**Deliverable Directory**: `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper`  

---

## 1. Observation

### 1.1 Ambient Environment & GitHub CLI Credentials
Execution of `gh auth status` and `gh --version` confirmed:
- **CLI Version**: `gh version 2.97.0 (2026-07-31)`
- **Authenticated Account**: `sastiam` (logged in via keyring)
- **Active Scopes**: `'admin:public_key', 'gist', 'project', 'read:org', 'repo'`
- **Scope Verification**: The critical `project` scope is active and granted, allowing full read and mutation access to GitHub Projects V2 without requiring token refresh or re-authentication.
- **Repository Remote**: `origin https://github.com/sastiam/openspec-cascade (fetch/push)`
- **Runtimes Available**:
  - Bun: `/home/sastiam/.local/bin/bun` (`1.3.0` types present)
  - Node: `/home/sastiam/.local/bin/node`
  - Python: `/usr/bin/python3`

### 1.2 Target Project #4 Metadata & Node ID
Execution of `gh project list --owner sastiam --format json` and `gh project view 4 --owner sastiam --format json` verified:
- **Project Number**: `4`
- **Owner**: `sastiam` (`type: "User"`)
- **Title**: `"Spec Cascade Project"`
- **URL**: `https://github.com/users/sastiam/projects/4`
- **GraphQL Node ID**: `PVT_kwHOA0KY4s4Boie_`
- **Total Fields**: 18
- **Current Total Items**: 15 items (IDs `PVTI_lAHOA0KY4s4Boie_zhDNv9s` through `PVTI_lAHOA0KY4s4Boie_zhDNwAY`)

### 1.3 Complete Field Schema & Option IDs
Execution of `gh project field-list 4 --owner sastiam --format json` and GraphQL field introspection confirmed the exact IDs:

| Field Name | Field Type | GraphQL Node ID | Allowed Values / Option IDs |
| :--- | :--- | :--- | :--- |
| **Title** | `ProjectV2Field` (`TITLE`) | `PVTF_lAHOA0KY4s4Boie_zhnCIRY` | Text string |
| **Status** | `ProjectV2SingleSelectField` (`SINGLE_SELECT`) | `PVTSSF_lAHOA0KY4s4Boie_zhnCIRg` | - `Backlog` (`id: "f75ad846"`)<br>- `Ready` (`id: "61e4505c"`)<br>- `In progress` (`id: "47fc9ee4"`)<br>- `In review` (`id: "df73e18b"`)<br>- `Done` (`id: "98236657"`) |
| **Priority** | `ProjectV2SingleSelectField` (`SINGLE_SELECT`) | `PVTSSF_lAHOA0KY4s4Boie_zhnCIkA` | - `P0` (`id: "79628723"`)<br>- `P1` (`id: "0a877460"`)<br>- `P2` (`id: "da944a9c"`) |
| **Size** | `ProjectV2SingleSelectField` (`SINGLE_SELECT`) | `PVTSSF_lAHOA0KY4s4Boie_zhnCIkE` | - `XS` (`id: "6c6483d2"`)<br>- `S` (`id: "f784b110"`)<br>- `M` (`id: "7515a9f1"`)<br>- `L` (`id: "817d0097"`)<br>- `XL` (`id: "db339eb2"`) |
| **Estimate** | `ProjectV2Field` (`NUMBER`) | `PVTF_lAHOA0KY4s4Boie_zhnCIkI` | Numeric value (e.g. story points / hours) |
| **Start date** | `ProjectV2Field` (`DATE`) | `PVTF_lAHOA0KY4s4Boie_zhnCIkM` | ISO Date (`YYYY-MM-DD`) |
| **Target date**| `ProjectV2Field` (`DATE`) | `PVTF_lAHOA0KY4s4Boie_zhnCIkQ` | ISO Date (`YYYY-MM-DD`) |
| **Assignees**  | `ProjectV2Field` (`ASSIGNEES`) | `PVTF_lAHOA0KY4s4Boie_zhnCIRc` | GitHub User logins (`sastiam`) |
| **Labels**     | `ProjectV2Field` (`LABELS`) | `PVTF_lAHOA0KY4s4Boie_zhnCIRk` | GitHub label names |
| **Repository** | `ProjectV2Field` (`REPOSITORY`) | `PVTF_lAHOA0KY4s4Boie_zhnCIRw` | Repo node (`sastiam/openspec-cascade`) |

### 1.4 Analysis of Existing Items (#1 to #15)
Direct GraphQL query of items in Project #4 revealed:
- All 15 existing items are linked repository issues (`sastiam/openspec-cascade#1` to `#15`).
- Their existing structure follows an older format:
  ```markdown
  ## Goal (Qué esperamos lograr)
  ...
  ## Definition of Done (Qué determina que está completada)
  ...
  ## Non-Goals / Out of Scope (Qué NO esperar de la tarea)
  ...
  ## Requisitos de Calidad & Clean Code
  ...
  ```
- **Discrepancy with R2**: The existing 15 items do **NOT** have discrete `Propósito de la tarea`, nor do they distinguish `Qué se espera lograr` from `Goal de la tarea`. Therefore, downstream implementation must strictly follow the new 4-section schema required by R2, rather than copying the formatting of items #1–#15.

---

## 2. Logic Chain

1. **Premise 1 (Authorization & Target)**: The ambient `gh` CLI token has the `project` scope for user `sastiam`. Project #4 exists at `https://github.com/users/sastiam/projects/4` with node ID `PVT_kwHOA0KY4s4Boie_`.
2. **Premise 2 (Item Creation Modes)**:
   - *Mode A (Draft Issues)*: Created directly on Project #4 using `gh project item-create 4 --owner sastiam --title "..." --body "..."` or GraphQL `addProjectV2DraftIssue`. They are native to the project, do not create repository issues, and have IDs like `PVTI_...`.
   - *Mode B (Repository Issues linked to Project)*: Created using `gh issue create -R sastiam/openspec-cascade --project "Spec Cascade Project" --title "..." --body "..."` (or `gh project item-add`). They create issue numbers (`#16+`), issue URLs, and can be assigned to `@me`.
   - *Decision*: Both mechanisms work seamlessly with `sastiam`'s credentials. Mode A (Draft Issue) matches the dispatch instruction (`gh project item-create`), while Mode B matches the precedent of items #1–#15. The orchestrator and implementer can choose either Mode A or Mode B, but both must strictly include the 4 Spanish sections.
3. **Premise 3 (Mandatory 4 Spanish Sections)**:
   Requirement R2 and Acceptance Criteria specify:
   > "100% of created items in GitHub Project #4 contain all 4 required sections: Propósito de la tarea, Qué se espera lograr, Goal de la tarea, and Criterios de completitud."
   
   To avoid ambiguity, each section must be an explicit Markdown heading (`##`):
   - `## 1. Propósito de la tarea`
   - `## 2. Qué se espera lograr`
   - `## 3. Goal de la tarea`
   - `## 4. Criterios de completitud / Definition of Done`
4. **Premise 4 (Automated Verification)**:
   To guarantee 100% compliance before handoff to the user, an automated validation script must:
   - Fetch items directly from GitHub Project #4 via `gh api graphql` or `gh project item-list`.
   - Filter items corresponding to the looper tasks (or parse `tasks_catalog.json`).
   - Run regex checks for all 4 headings and verify non-empty text bodies.
   - Verify that Section 4 contains at least one task checkbox (`- [ ]`).
   - Fail with exit code 1 if any item misses a section; succeed with exit code 0 if all pass.

---

## 3. Item Creation Command Templates & Specifications

### 3.1 Mode A: Native Project Draft Issues (Recommended for Projects V2)

#### Step 1: Create Draft Issue
```bash
gh project item-create 4 --owner sastiam \
  --title "[LOOPER-CORE-001] Engine Loop State Machine & Context Propagation" \
  --body-file - << 'EOF'
## 1. Propósito de la tarea
Establecer el núcleo de orquestación iterativa para el looper multi-agente agnóstico, permitiendo transiciones de estado deterministas, acumulación de contexto y control de ciclo de vida sin acoplamiento a ningún proveedor de IA específico.

## 2. Qué se espera lograr
- Máquina de estados finita (FSM) que gestione los estados `IDLE`, `PLANNING`, `EXECUTING`, `VERIFYING`, `RETRYING`, `COMPLETED` y `FAILED`.
- Mecanismo de persistencia de contexto y reducción de eventos en memoria y disco.
- Contrato de ejecución agnóstica para orquestar llamadas a agentes y herramientas.

## 3. Goal de la tarea
Implementar la FSM del motor central con propagación continua de contexto y límites configurables de iteración y tokens.

## 4. Criterios de completitud / Definition of Done
- [ ] Módulo `src/engine/loop.ts` implementado con tipado estricto en TypeScript.
- [ ] Soporte para transiciones de estado válidas y rechazo de transiciones prohibidas.
- [ ] Suite de pruebas unitarias en Bun (`bun test test/engine/loop.test.ts`) con 100% de aserciones pasando.
- [ ] Cero números mágicos; límites de reintentos y tokens leídos desde `config.ts`.
EOF
```

#### Step 2: Set Project Status & Priority
After creation, `gh project item-create` returns the item node ID (`PVTI_...`).
Set Status to "Backlog" (`f75ad846`) and Priority to "P0" (`79628723`):
```bash
# Using gh project item-edit by IDs:
gh project item-edit \
  --project-id "PVT_kwHOA0KY4s4Boie_" \
  --id "<ITEM_NODE_ID>" \
  --field-id "PVTSSF_lAHOA0KY4s4Boie_zhnCIRg" \
  --single-select-option-id "f75ad846"

gh project item-edit \
  --project-id "PVT_kwHOA0KY4s4Boie_" \
  --id "<ITEM_NODE_ID>" \
  --field-id "PVTSSF_lAHOA0KY4s4Boie_zhnCIkA" \
  --single-select-option-id "79628723"
```

#### Alternative: GraphQL Mutation for Single-Step Atomic Creation
```bash
gh api graphql -f query='
mutation($projectId: ID!, $title: String!, $body: String!) {
  addProjectV2DraftIssue(input: {
    projectId: $projectId,
    title: $title,
    body: $body
  }) {
    projectItem {
      id
      type
    }
  }
}
' -F projectId="PVT_kwHOA0KY4s4Boie_" \
  -F title="[LOOPER-CORE-001] Engine Loop State Machine & Context Propagation" \
  -F body="$(cat task_body.md)"
```

---

### 3.2 Mode B: Repository Issue Linked to Project #4

```bash
gh issue create -R sastiam/openspec-cascade \
  --title "[LOOPER-CORE-001] Engine Loop State Machine & Context Propagation" \
  --project "Spec Cascade Project" \
  --assignee "@me" \
  --body-file - << 'EOF'
## 1. Propósito de la tarea
Establecer el núcleo de orquestación iterativa para el looper multi-agente agnóstico, permitiendo transiciones de estado deterministas, acumulación de contexto y control de ciclo de vida sin acoplamiento a ningún proveedor de IA específico.

## 2. Qué se espera lograr
- Máquina de estados finita (FSM) que gestione los estados `IDLE`, `PLANNING`, `EXECUTING`, `VERIFYING`, `RETRYING`, `COMPLETED` y `FAILED`.
- Mecanismo de persistencia de contexto y reducción de eventos en memoria y disco.
- Contrato de ejecución agnóstica para orquestar llamadas a agentes y herramientas.

## 3. Goal de la tarea
Implementar la FSM del motor central con propagación continua de contexto y límites configurables de iteración y tokens.

## 4. Criterios de completitud / Definition of Done
- [ ] Módulo `src/engine/loop.ts` implementado con tipado estricto en TypeScript.
- [ ] Soporte para transiciones de estado válidas y rechazo de transiciones prohibidas.
- [ ] Suite de pruebas unitarias en Bun (`bun test test/engine/loop.test.ts`) con 100% de aserciones pasando.
- [ ] Cero números mágicos; límites de reintentos y tokens leídos desde `config.ts`.
EOF
```

---

## 4. Task Catalog Schema (`tasks_catalog.json` & `tasks_catalog.md`)

In accordance with Requirement R3, a catalog file must be written to `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/`.

### 4.1 JSON Schema (`tasks_catalog.json`)
```json
[
  {
    "taskId": "LOOPER-CORE-001",
    "title": "[LOOPER-CORE-001] Engine Loop State Machine & Context Propagation",
    "stream": "core_engine",
    "githubProjectItemId": "PVTI_lAHOA0KY4s4Boie_...",
    "githubIssueNumber": 16,
    "githubUrl": "https://github.com/sastiam/openspec-cascade/issues/16",
    "status": "Backlog",
    "priority": "P0",
    "size": "L",
    "sections": {
      "proposito": "Establecer el núcleo de orquestación iterativa...",
      "queSeEsperaLograr": "Máquina de estados finita (FSM)...",
      "goal": "Implementar la FSM del motor central...",
      "criteriosCompletitud": [
        "Módulo src/engine/loop.ts implementado con tipado estricto en TypeScript.",
        "Soporte para transiciones de estado válidas y rechazo de transiciones prohibidas.",
        "Suite de pruebas unitarias en Bun con 100% de aserciones pasando.",
        "Cero números mágicos; límites leídos desde config.ts."
      ]
    }
  }
]
```

### 4.2 Markdown Catalog (`tasks_catalog.md`)
```markdown
# Catálogo de Tareas — Agnostic Multi-Agent Looper

Target Project: [https://github.com/users/sastiam/projects/4](https://github.com/users/sastiam/projects/4)
Total Tareas: N

| ID | Título | Stream | Prioridad | Tamaño | Estado | GitHub ID / URL |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| LOOPER-CORE-001 | Engine Loop State Machine | Core Engine | P0 | L | Backlog | [Issue #16](https://...) |
```

---

## 5. Verification Script Design & Source Code

This verification script connects to GitHub Project #4 using `gh api graphql`, inspects all items matching the newly created looper tasks (or checks all newly created items against `tasks_catalog.json`), structurally parses the 4 mandatory sections, and validates markdown checkboxes.

### 5.1 Standalone TypeScript / Bun Script (`verify_project_items.ts`)
Place in `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/verify_project_items.ts`:

```typescript
#!/usr/bin/env bun
/**
 * verify_project_items.ts
 * 
 * Audits GitHub Project #4 items for strict compliance with the 4 Spanish sections:
 * 1. Propósito de la tarea
 * 2. Qué se espera lograr
 * 3. Goal de la tarea
 * 4. Criterios de completitud / Definition of Done
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

interface ProjectItem {
  id: string;
  type: string;
  status?: { name: string };
  content?: {
    __typename: string;
    number?: number;
    title?: string;
    body?: string;
    url?: string;
  };
}

interface ValidationResult {
  itemId: string;
  title: string;
  url?: string;
  hasProposito: boolean;
  hasEsperaLograr: boolean;
  hasGoal: boolean;
  hasCriterios: boolean;
  hasCheckboxes: boolean;
  valid: boolean;
  errors: string[];
}

const REGEX_PROPOSITO = /(?:##|\*{1,2}|^)\s*(?:1\.?\s*)?Prop[oó]sito de la tarea/i;
const REGEX_ESPERA_LOGRAR = /(?:##|\*{1,2}|^)\s*(?:2\.?\s*)?Qu[eé] se espera lograr/i;
const REGEX_GOAL = /(?:##|\*{1,2}|^)\s*(?:3\.?\s*)?Goal de la tarea/i;
const REGEX_CRITERIOS = /(?:##|\*{1,2}|^)\s*(?:4\.?\s*)?(?:Criterios de completitud(?:\s*\/\s*Definition of Done)?|Definition of Done)/i;
const REGEX_CHECKBOX = /^\s*-\s*\[[ xX]\]\s+.+/m;

function fetchProjectItems(): ProjectItem[] {
  console.log("🔍 Fetching items from GitHub Project #4 (owner: sastiam)...");
  const query = `
    query($owner: String!, $projectNumber: Int!) {
      user(login: $owner) {
        projectV2(number: $projectNumber) {
          items(first: 100) {
            nodes {
              id
              type
              status: fieldValueByName(name: "Status") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                }
              }
              content {
                __typename
                ... on DraftIssue {
                  title
                  body
                }
                ... on Issue {
                  number
                  title
                  body
                  url
                }
              }
            }
          }
        }
      }
    }
  `;

  const cmd = `gh api graphql -F owner=sastiam -F projectNumber=4 -f query='${query}'`;
  const rawOutput = execSync(cmd, { encoding: "utf-8" });
  const parsed = JSON.parse(rawOutput);
  return parsed.data.user.projectV2.items.nodes;
}

function validateItemBody(item: ProjectItem): ValidationResult {
  const title = item.content?.title || "(Untitled Draft)";
  const body = item.content?.body || "";
  const url = item.content?.url || item.id;

  const hasProposito = REGEX_PROPOSITO.test(body);
  const hasEsperaLograr = REGEX_ESPERA_LOGRAR.test(body);
  const hasGoal = REGEX_GOAL.test(body);
  const hasCriterios = REGEX_CRITERIOS.test(body);
  const hasCheckboxes = REGEX_CHECKBOX.test(body);

  const errors: string[] = [];
  if (!hasProposito) errors.push("Missing Section 1: 'Propósito de la tarea'");
  if (!hasEsperaLograr) errors.push("Missing Section 2: 'Qué se espera lograr'");
  if (!hasGoal) errors.push("Missing Section 3: 'Goal de la tarea'");
  if (!hasCriterios) errors.push("Missing Section 4: 'Criterios de completitud / Definition of Done'");
  if (!hasCheckboxes) errors.push("Section 4 must contain at least one checklist item '- [ ]'");

  return {
    itemId: item.id,
    title,
    url,
    hasProposito,
    hasEsperaLograr,
    hasGoal,
    hasCriterios,
    hasCheckboxes,
    valid: errors.length === 0,
    errors,
  };
}

export function runVerification(): boolean {
  console.log("=================================================");
  console.log(" GITHUB PROJECT #4 STRUCTURAL VALIDATION AUDIT   ");
  console.log("=================================================");

  const items = fetchProjectItems();
  console.log(`Found ${items.length} total items in Project #4.`);

  // If a catalog file exists, validate specifically against the catalog tasks
  const catalogPath = path.resolve(import.meta.dir, "tasks_catalog.json");
  let targetIds = new Set<string>();
  if (fs.existsSync(catalogPath)) {
    try {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
      targetIds = new Set(catalog.map((t: any) => t.githubProjectItemId || t.githubUrl || t.title));
      console.log(`Loaded catalog with ${targetIds.size} target tasks from ${catalogPath}.`);
    } catch (e) {
      console.warn("Could not parse tasks_catalog.json, evaluating all looper items.");
    }
  }

  // Filter items: looper tasks matching prefix [LOOPER- or present in catalog
  const looperItems = items.filter((it) => {
    const t = it.content?.title || "";
    if (targetIds.size > 0) {
      return targetIds.has(it.id) || targetIds.has(it.content?.url || "") || targetIds.has(t);
    }
    return t.toUpperCase().includes("LOOPER") || t.toUpperCase().includes("AGNOSTIC");
  });

  if (looperItems.length === 0) {
    console.warn("⚠️ No Looper items found in Project #4 yet. Run task creation first.");
    return false;
  }

  console.log(`Auditing ${looperItems.length} looper task items...\\n`);

  let passed = 0;
  let failed = 0;

  for (const item of looperItems) {
    const res = validateItemBody(item);
    if (res.valid) {
      console.log(`✅ [PASS] ${res.title}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${res.title} (${res.url})`);
      for (const err of res.errors) {
        console.error(`   - ${err}`);
      }
      failed++;
    }
  }

  console.log("\\n=================================================");
  console.log(`Summary: Total Audited: ${looperItems.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Compliance Rate: ${((passed / looperItems.length) * 100).toFixed(1)}%`);
  console.log("=================================================");

  if (failed > 0) {
    console.error("❌ Validation Failed: 100% compliance required across all 4 sections.");
    return false;
  }

  console.log("✅ 100% Validation Passed! All items strictly satisfy R2 requirements.");
  return true;
}

if (import.meta.main) {
  const success = runVerification();
  process.exit(success ? 0 : 1);
}
```

### 5.2 Standalone Python Script (`verify_project_items.py`)
Place in `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/verify_project_items.py`:

```python
#!/usr/bin/env python3
"""
verify_project_items.py
Audits GitHub Project #4 items for strict compliance with the 4 Spanish sections.
"""

import json
import os
import re
import subprocess
import sys

REGEX_PROPOSITO = re.compile(r"(?:##|\*{1,2}|^)\s*(?:1\.?\s*)?Prop[oó]sito de la tarea", re.IGNORECASE | re.MULTILINE)
REGEX_ESPERA = re.compile(r"(?:##|\*{1,2}|^)\s*(?:2\.?\s*)?Qu[eé] se espera lograr", re.IGNORECASE | re.MULTILINE)
REGEX_GOAL = re.compile(r"(?:##|\*{1,2}|^)\s*(?:3\.?\s*)?Goal de la tarea", re.IGNORECASE | re.MULTILINE)
REGEX_CRITERIOS = re.compile(r"(?:##|\*{1,2}|^)\s*(?:4\.?\s*)?(?:Criterios de completitud(?:\s*/\s*Definition of Done)?|Definition of Done)", re.IGNORECASE | re.MULTILINE)
REGEX_CHECKBOX = re.compile(r"^\s*-\s*\[[ xX]\]\s+.+", re.MULTILINE)

def fetch_items():
    query = """
    query($owner: String!, $projectNumber: Int!) {
      user(login: $owner) {
        projectV2(number: $projectNumber) {
          items(first: 100) {
            nodes {
              id
              content {
                __typename
                ... on DraftIssue { title body }
                ... on Issue { number title body url }
              }
            }
          }
        }
      }
    }
    """
    cmd = ["gh", "api", "graphql", "-F", "owner=sastiam", "-F", "projectNumber=4", "-f", f"query={query}"]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
    data = json.loads(res.stdout)
    return data["data"]["user"]["projectV2"]["items"]["nodes"]

def main():
    items = fetch_items()
    # Filter for Looper items
    looper_items = [it for it in items if "LOOPER" in (it.get("content", {}).get("title") or "").upper()]
    if not looper_items:
        print("⚠️ No looper items found in Project #4 yet.")
        sys.exit(1)

    failed = 0
    for it in looper_items:
        content = it.get("content") or {}
        title = content.get("title", "Untitled")
        body = content.get("body", "")
        errors = []
        if not REGEX_PROPOSITO.search(body): errors.append("Missing Section 1 (Propósito)")
        if not REGEX_ESPERA.search(body): errors.append("Missing Section 2 (Qué se espera lograr)")
        if not REGEX_GOAL.search(body): errors.append("Missing Section 3 (Goal de la tarea)")
        if not REGEX_CRITERIOS.search(body): errors.append("Missing Section 4 (Criterios de completitud)")
        if not REGEX_CHECKBOX.search(body): errors.append("Missing checkboxes in Section 4")

        if errors:
            print(f"❌ [FAIL] {title}: {', '.join(errors)}")
            failed += 1
        else:
            print(f"✅ [PASS] {title}")

    if failed > 0:
        print(f"\nAudit failed: {failed} items invalid.")
        sys.exit(1)
    print("\n✅ All items passed 100% structural verification.")
    sys.exit(0)

if __name__ == "__main__":
    main()
```

---

## 6. Caveats

1. **Existing 15 Items in Project #4**: The 15 existing items belong to a previous phase (`[EPIC] Robustecimiento de Openspec Cascade`). They use a legacy structure (`## Goal (Qué esperamos lograr)` and `## Definition of Done`) and do NOT contain all 4 sections. The validator filters specifically for newly created Looper tasks (`[LOOPER-...`) or cross-references `tasks_catalog.json` so as not to report false negatives on pre-existing legacy items.
2. **Rate Limits**: GitHub GraphQL API has a rate limit of 5,000 points per hour for authenticated requests. The queries and batch mutations designed here use minimal complexity (<5 points per call), well within safe limits.
3. **Draft Issue URL vs Issue URL**: Draft items created via `gh project item-create` have a GraphQL Node ID (`PVTI_...`) and can be opened in the web UI at `https://github.com/users/sastiam/projects/4`, but do not have an issue URL on `sastiam/openspec-cascade/issues/N`. If the user or orchestrator requires direct issue URLs, Mode B (`gh issue create --project "Spec Cascade Project"`) should be used. Both options are 100% supported by ambient credentials.

---

## 7. Conclusion

- **GitHub CLI & Ambient Auth**: Fully operational as `sastiam` with active `project` and `repo` scopes.
- **Project #4 Targeting**: Project Node ID `PVT_kwHOA0KY4s4Boie_` is verified and accessible via CLI and GraphQL.
- **Creation Syntax**: Ready for immediate execution via either `gh project item-create` (draft items) or `gh issue create -R sastiam/openspec-cascade --project "Spec Cascade Project"` (linked issues).
- **Format Compliance**: The 4 Spanish sections are strictly formalized with regex patterns and markdown templates.
- **Automated QA**: Verification scripts in TypeScript/Bun and Python are complete and ready to be placed in `projects/agnostic_looper/` to guarantee 100% structural compliance.

---

## 8. Verification Method

To independently verify these findings:

1. **Verify GitHub CLI Auth & Scope**:
   ```bash
   gh auth status
   # Confirm user is sastiam and token includes 'project' scope
   ```
2. **Verify Project #4 Accessibility**:
   ```bash
   gh project view 4 --owner sastiam --format json
   # Confirm id == "PVT_kwHOA0KY4s4Boie_" and title == "Spec Cascade Project"
   ```
3. **Verify Field Schema via Introspection**:
   ```bash
   gh project field-list 4 --owner sastiam --format json
   # Confirm Status field ID "PVTSSF_lAHOA0KY4s4Boie_zhnCIRg" and option Backlog "f75ad846"
   ```
4. **Test Read-Only GraphQL Query**:
   ```bash
   gh api graphql -F owner=sastiam -F projectNumber=4 -f query='
   query($owner: String!, $projectNumber: Int!) {
     user(login: $owner) {
       projectV2(number: $projectNumber) {
         title
         items(first: 1) {
           nodes { id }
         }
       }
     }
   }'
   ```
