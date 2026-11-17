export const SUGGESTED_RULES_YAML = `rules:
  tasks:
    - Every task is a step an agent can do and verify with a command; steps only a person can do go in manual.md.
    - Before delegating anything to a person, investigate read-only first (logs, list and describe calls, the read-only profile from the manifest).
    - When a helper from openspec-cascade setup show applies, name it in the task.
  design:
    - State the layers, the allowed dependency direction between them, and how dependencies are injected.
`;

const RULES_KEY_PATTERN = /^(?:rules|"rules"|'rules')[ \t]*:/m;

export function writeRules(configText: string): { text: string } | { refused: string } {
  if (RULES_KEY_PATTERN.test(configText)) {
    return { refused: "openspec/config.yaml already has a rules key" };
  }
  const separator = configText === "" || configText.endsWith("\n") ? "" : "\n";
  return { text: `${configText}${separator}${SUGGESTED_RULES_YAML}` };
}
