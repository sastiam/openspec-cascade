import { execSync } from "node:child_process";

const query = `query {
  user(login: "sastiam") {
    projectV2(number: 4) {
      title
      items(first: 100) {
        nodes {
          id
          content {
            __typename
            ... on DraftIssue {
              title
              body
            }
            ... on Issue {
              title
              body
            }
          }
        }
      }
    }
  }
}`;

const res = execSync(`gh api graphql -f query='${query}'`, { encoding: "utf-8" });
const json = JSON.parse(res);
const items = json.data.user.projectV2.items.nodes;
const looperItems = items.filter((it: any) => (it.content?.title || "").includes("LOOPER-"));

console.log(`Audited ${looperItems.length} looper items from Project #4:`);

const required = [
  { name: "Propósito de la tarea", regex: /Prop[oó]sito de la tarea/i },
  { name: "Qué se espera lograr", regex: /Qu[eé] se espera lograr/i },
  { name: "Goal de la tarea", regex: /Goal de la tarea/i },
  { name: "Criterios de completitud", regex: /Criterios de completitud/i },
];

let failedCount = 0;
for (const item of looperItems) {
  const title = item.content?.title;
  const body = item.content?.body || "";
  const missing = required.filter(r => !r.regex.test(body));
  if (missing.length > 0) {
    console.error(`FAIL: ${title} missing ${missing.map(m => m.name).join(", ")}`);
    failedCount++;
  } else {
    console.log(`PASS: ${title}`);
  }
}

const EXPECTED_TASK_COUNT = 16;
if (looperItems.length !== EXPECTED_TASK_COUNT || failedCount > 0) {
  console.error(`INDEPENDENT AUDIT FAILED: expected ${EXPECTED_TASK_COUNT}, got ${looperItems.length}, failures: ${failedCount}`);
  process.exit(1);
} else {
  console.log("SUCCESS: 16/16 tasks verified independently with 100% compliance.");
  process.exit(0);
}
