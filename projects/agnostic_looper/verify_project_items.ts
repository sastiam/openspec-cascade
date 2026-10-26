#!/usr/bin/env bun
/**
 * verify_project_items.ts
 *
 * Programmatically audits GitHub Project #4 items for the Agnostic Multi-Agent Looper.
 * Connects directly to GitHub Project #4 via GraphQL using ambient gh CLI credentials.
 * Asserts 100% compliance across all mandatory Spanish sections:
 * 1. Propósito de la tarea
 * 2. Qué se espera lograr
 * 3. Goal de la tarea
 * 4. Criterios de completitud / Definition of Done
 *
 * Also validates Status (Backlog), Priority (P0/P1), and presence of interactive checkboxes (- [ ]).
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

interface ProjectItem {
  id: string;
  type: string;
  status?: { name: string };
  priority?: { name: string };
  size?: { name: string };
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
  taskKey: string;
  title: string;
  status: string;
  priority: string;
  size: string;
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
          title
          items(first: 100) {
            nodes {
              id
              type
              status: fieldValueByName(name: "Status") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                }
              }
              priority: fieldValueByName(name: "Priority") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                }
              }
              size: fieldValueByName(name: "Size") {
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

function extractTaskKey(title: string): string {
  const match = title.match(/\[(LOOPER-[A-Z]+-\d+)\]/i);
  return match ? match[1].toUpperCase() : "UNKNOWN";
}

function validateItem(item: ProjectItem): ValidationResult {
  const title = item.content?.title || "(Untitled Draft)";
  const body = item.content?.body || "";
  const taskKey = extractTaskKey(title);
  const status = item.status?.name || "None";
  const priority = item.priority?.name || "None";
  const size = item.size?.name || "None";

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
  if (status !== "Backlog") errors.push(`Status is '${status}', expected 'Backlog'`);
  if (!["P0", "P1"].includes(priority)) errors.push(`Priority is '${priority}', expected 'P0' or 'P1'`);

  return {
    itemId: item.id,
    taskKey,
    title,
    status,
    priority,
    size,
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
  console.log("================================================================================");
  console.log("       AGNOSTIC LOOPER — GITHUB PROJECT #4 STRUCTURAL VALIDATION AUDIT          ");
  console.log("================================================================================");

  const items = fetchProjectItems();
  console.log(`Successfully fetched ${items.length} total items from Project #4.\n`);

  // Load catalog to verify against planned tasks
  const catalogPath = path.resolve(import.meta.dir, "tasks_catalog.json");
  let expectedKeys = new Set<string>();
  if (fs.existsSync(catalogPath)) {
    try {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
      expectedKeys = new Set(catalog.map((t: any) => t.task_key || t.taskId));
      console.log(`Loaded catalog with ${expectedKeys.size} expected tasks from ${catalogPath}.`);
    } catch (e) {
      console.warn("Could not parse tasks_catalog.json, falling back to prefix matching.");
    }
  }

  // Filter items matching [LOOPER-
  const looperItems = items.filter((it) => {
    const title = it.content?.title || "";
    return title.toUpperCase().includes("LOOPER-");
  });

  if (looperItems.length === 0) {
    console.error("❌ ERROR: No Agnostic Looper tasks found in Project #4.");
    return false;
  }

  console.log(`Identified ${looperItems.length} Agnostic Looper tasks in Project #4.\n`);

  let passed = 0;
  let failed = 0;
  const verifiedKeys = new Set<string>();

const PAD_LENGTH = 2;
const PERCENTAGE_FACTOR = 100;
const PERFECT_COMPLIANCE_RATE = 100;

  for (let idx = 0; idx < looperItems.length; idx++) {
    const item = looperItems[idx];
    const res = validateItem(item);
    verifiedKeys.add(res.taskKey);

    const prefix = `[${String(idx + 1).padStart(PAD_LENGTH, "0")}/${looperItems.length}]`;

    if (res.valid) {
      console.log(`✅ ${prefix} PASS: ${res.taskKey} — Status: ${res.status} | Priority: ${res.priority} | Size: ${res.size}`);
      console.log(`       ${res.title} (ID: ${res.itemId})`);
      passed++;
    } else {
      console.error(`❌ ${prefix} FAIL: ${res.taskKey} — ${res.title} (ID: ${res.itemId})`);
      for (const err of res.errors) {
        console.error(`       ⚠️  ${err}`);
      }
      failed++;
    }
  }

  // Check if all catalog tasks are accounted for
  let missingCount = 0;
  if (expectedKeys.size > 0) {
    for (const key of expectedKeys) {
      if (!verifiedKeys.has(key)) {
        console.error(`❌ Missing Task in Project #4: ${key}`);
        missingCount++;
      }
    }
  }

  console.log("\n================================================================================");
  console.log(`Total Audited: ${looperItems.length} | Passed: ${passed} | Failed: ${failed} | Missing: ${missingCount}`);
  const rate = looperItems.length > 0 ? (passed / looperItems.length) * PERCENTAGE_FACTOR : 0;
  console.log(`Compliance Rate: ${rate.toFixed(1)}%`);
  console.log("================================================================================");

  if (failed > 0 || missingCount > 0 || rate < PERFECT_COMPLIANCE_RATE) {
    console.error("\n❌ AUDIT FAILED: All created items must strictly satisfy 100% of requirements.");
    return false;
  }

  console.log("\n🎉 AUDIT SUCCESSFUL: 100% of items exist and pass all structural validation checks!");
  return true;
}

if (import.meta.main) {
  const success = runVerification();
  process.exit(success ? 0 : 1);
}
