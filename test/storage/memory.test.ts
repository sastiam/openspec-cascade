import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HeartbeatWatchdog,
  MemoryStorage,
  ProtectedSectionError,
  PROTECTED_VIOLATION_TYPES,
  StorageError,
  STORAGE_CONSTANTS,
  STORAGE_ERROR_CODES,
  assertProtectedSectionsPreserved,
  createHeartbeatWatchdog,
  createMemoryStorage,
  fileExists,
  formatHeartbeatContent,
  inspectAgentHeartbeat,
  isSectionProtected,
  mergeProtectedSections,
  normalizeSectionTitle,
  parseHeartbeatTimestamp,
  parseMarkdownSections,
  readAgentHeartbeat,
  readAtomic,
  scaffoldDirectories,
  touchAgentHeartbeat,
  validateProtectedSections,
  writeAtomic,
  writeBriefingAtomic,
} from "../../src/storage/memory";

describe("STORAGE_CONSTANTS and Error Types", () => {
  it("defines standard storage constants adhering to zero magic numbers", () => {
    expect(STORAGE_CONSTANTS.DEFAULT_BASE_DIR).toBe(".agents/teamwork");
    expect(STORAGE_CONSTANTS.DIR_SENTINEL).toBe("sentinel");
    expect(STORAGE_CONSTANTS.DIR_BRIEFING).toBe("briefing");
    expect(STORAGE_CONSTANTS.DIR_STATE).toBe("state");
    expect(STORAGE_CONSTANTS.FILE_BRIEFING).toBe("BRIEFING.md");
    expect(STORAGE_CONSTANTS.FILE_PROGRESS).toBe("progress.md");
    expect(STORAGE_CONSTANTS.FILE_DISPATCH).toBe("DISPATCH.md");
    expect(STORAGE_CONSTANTS.FILE_HANDOFF).toBe("handoff.md");
    expect(STORAGE_CONSTANTS.SWAP_PREFIX).toBe(".swap");
    expect(STORAGE_CONSTANTS.STALE_HEARTBEAT_THRESHOLD_MS).toBe(300_000);
    expect(STORAGE_CONSTANTS.DEFAULT_WATCHDOG_CHECK_INTERVAL_MS).toBe(30_000);
    expect(STORAGE_CONSTANTS.PROTECTED_SECTION_MARKER).toBe("🔒");
    expect(STORAGE_CONSTANTS.MAX_BRIEFING_LINES).toBe(100);
    expect(STORAGE_CONSTANTS.DEFAULT_PROTECTED_SECTION_HEADERS).toContain("## 🔒 My Identity");
    expect(STORAGE_CONSTANTS.DEFAULT_PROTECTED_SECTION_HEADERS).toContain("## 🔒 Key Constraints");
  });

  it("StorageError formats error information and captures code and targetPath", () => {
    const cause = new Error("Disk full");
    const err = new StorageError("Write failed", STORAGE_ERROR_CODES.WRITE_FAILED, "/tmp/test.txt", cause);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StorageError);
    expect(err.name).toBe("StorageError");
    expect(err.code).toBe(STORAGE_ERROR_CODES.WRITE_FAILED);
    expect(err.targetPath).toBe("/tmp/test.txt");
    expect(err.message).toBe("Write failed");
    expect(err.cause).toBe(cause);
  });

  it("ProtectedSectionError carries violation details and correct error code", () => {
    const violations = [
      {
        sectionTitle: "## 🔒 My Identity",
        type: PROTECTED_VIOLATION_TYPES.DELETED,
        message: "Section deleted",
      },
    ];
    const err = new ProtectedSectionError("Protected violation", violations, "/tmp/BRIEFING.md");

    expect(err).toBeInstanceOf(StorageError);
    expect(err).toBeInstanceOf(ProtectedSectionError);
    expect(err.name).toBe("ProtectedSectionError");
    expect(err.code).toBe(STORAGE_ERROR_CODES.PROTECTED_SECTION_VIOLATION);
    expect(err.violations).toHaveLength(1);
    expect(err.violations[0]?.type).toBe(PROTECTED_VIOLATION_TYPES.DELETED);
    expect(err.targetPath).toBe("/tmp/BRIEFING.md");
  });
});

describe("Atomic Filesystem Operations", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "memory-storage-atomic-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("writes and reads atomic string files correctly", async () => {
    const filePath = join(testDir, "nested", "dirs", "sample.txt");
    const content = "Hello Atomic FS World!";

    await writeAtomic(filePath, content);
    expect(await fileExists(filePath)).toBe(true);

    const readBack = await readAtomic(filePath);
    expect(readBack).toBe(content);
  });

  it("writes and reads atomic Uint8Array binary buffers correctly", async () => {
    const filePath = join(testDir, "binary.bin");
    const rawString = "Binary content encoded";
    const buffer = new TextEncoder().encode(rawString);

    await writeAtomic(filePath, buffer);
    expect(await fileExists(filePath)).toBe(true);

    const readBack = await readAtomic(filePath);
    expect(readBack).toBe(rawString);
  });

  it("ensures no temporary swap files remain after successful atomic write", async () => {
    const filePath = join(testDir, "swap-test.txt");
    await writeAtomic(filePath, "clean write");

    const files = readdirSync(testDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe("swap-test.txt");
    expect(files.some((f) => f.includes(STORAGE_CONSTANTS.SWAP_PREFIX))).toBe(false);
  });

  it("throws StorageError with FILE_NOT_FOUND when readAtomic target does not exist", async () => {
    const missingPath = join(testDir, "missing-file.txt");

    try {
      await readAtomic(missingPath);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
      const storageError = error as StorageError;
      expect(storageError.code).toBe(STORAGE_ERROR_CODES.FILE_NOT_FOUND);
      expect(storageError.targetPath).toBe(missingPath);
    }
  });

  it("fileExists returns false for non-existent files", async () => {
    expect(await fileExists(join(testDir, "does-not-exist.md"))).toBe(false);
  });

  it("scaffoldDirectories creates directory hierarchies recursively", async () => {
    const dirs = [
      join(testDir, "tree1", "sub1"),
      join(testDir, "tree2", "sub2", "leaf"),
    ];

    const created = await scaffoldDirectories(dirs);
    expect(created).toHaveLength(2);
    for (const dir of dirs) {
      expect(existsSync(dir)).toBe(true);
    }
  });
});

describe("Protected Section Guard", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "memory-storage-guard-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("normalizeSectionTitle & isSectionProtected", () => {
    it("normalizes heading markers, lock emoji, and whitespace correctly", () => {
      expect(normalizeSectionTitle("## 🔒 My Identity")).toBe("my identity");
      expect(normalizeSectionTitle("###   🔒   Key Constraints   ")).toBe("key constraints");
      expect(normalizeSectionTitle("# \u{1F512} Special Guard")).toBe("special guard");
      expect(normalizeSectionTitle("Unprotected Title")).toBe("unprotected title");
    });

    it("identifies protected sections by lock marker and default headers", () => {
      expect(isSectionProtected("## 🔒 Custom Header")).toBe(true);
      expect(isSectionProtected("## 🔒 My Identity")).toBe(true);
      expect(isSectionProtected("## My Identity")).toBe(true); // matches default header normalized
      expect(isSectionProtected("## 🔒 Key Constraints")).toBe(true);
      expect(isSectionProtected("## Key Constraints")).toBe(true); // matches default header normalized
      expect(isSectionProtected("## Current Objective")).toBe(false);
      expect(isSectionProtected("")).toBe(false);
    });

    it("supports custom protected headers and markers via options", () => {
      const options = {
        protectedMarkers: ["🛡️"],
        protectedHeaders: ["## Secret Section"],
      };

      expect(isSectionProtected("## 🛡️ Shielded", options)).toBe(true);
      expect(isSectionProtected("## Secret Section", options)).toBe(true);
      expect(isSectionProtected("## secret section", options)).toBe(true);
      expect(isSectionProtected("## Normal", options)).toBe(false);
    });
  });

  describe("parseMarkdownSections", () => {
    it("parses markdown into structured sections", () => {
      const md = [
        "# Briefing Header",
        "Introduction text here.",
        "",
        "## 🔒 My Identity",
        "Role: Specialist Agent",
        "",
        "## Tasks",
        "- Task 1",
        "- Task 2",
      ].join("\n");

      const sections = parseMarkdownSections(md);
      expect(sections).toHaveLength(3);

      expect(sections[0]?.title).toBe("Briefing Header");
      expect(sections[0]?.level).toBe(1);
      expect(sections[0]?.isProtected).toBe(false);

      expect(sections[1]?.title).toBe("🔒 My Identity");
      expect(sections[1]?.level).toBe(2);
      expect(sections[1]?.isProtected).toBe(true);
      expect(sections[1]?.content).toContain("Role: Specialist Agent");

      expect(sections[2]?.title).toBe("Tasks");
      expect(sections[2]?.level).toBe(2);
      expect(sections[2]?.isProtected).toBe(false);
      expect(sections[2]?.content).toContain("- Task 1");
    });

    it("ignores markdown headings inside code blocks", () => {
      const md = [
        "## 🔒 My Identity",
        "```markdown",
        "## Fake Header inside code",
        "```",
        "Identity details continue here.",
      ].join("\n");

      const sections = parseMarkdownSections(md);
      expect(sections).toHaveLength(1);
      expect(sections[0]?.title).toBe("🔒 My Identity");
      expect(sections[0]?.content).toContain("## Fake Header inside code");
    });
  });

  describe("validateProtectedSections", () => {
    const baseContent = [
      "## 🔒 My Identity",
      "I am Agent Alpha.",
      "Engine: Antigravity",
      "",
      "## 🔒 Key Constraints",
      "- Zero magic numbers",
      "- Atomic persistence",
      "",
      "## Dynamic Working State",
      "Current step: 1",
    ].join("\n");

    it("validates successfully when protected sections are preserved intact", () => {
      const updatedContent = [
        "## 🔒 My Identity",
        "I am Agent Alpha.",
        "Engine: Antigravity",
        "",
        "## 🔒 Key Constraints",
        "- Zero magic numbers",
        "- Atomic persistence",
        "",
        "## Dynamic Working State",
        "Current step: 2 - advanced to next phase!",
        "",
        "## Newly Added Notes",
        "Everything running smoothly.",
      ].join("\n");

      const result = validateProtectedSections(baseContent, updatedContent);
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("detects DELETED violation when a protected section is omitted", () => {
      const corruptedContent = [
        "## 🔒 Key Constraints",
        "- Zero magic numbers",
        "- Atomic persistence",
        "",
        "## Dynamic Working State",
        "Current step: 2",
      ].join("\n");

      const result = validateProtectedSections(baseContent, corruptedContent);
      expect(result.isValid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.type).toBe(PROTECTED_VIOLATION_TYPES.DELETED);
      expect(result.violations[0]?.sectionTitle).toContain("My Identity");
    });

    it("detects LOCK_REMOVED violation when lock marker is stripped", () => {
      const corruptedContent = [
        "## My Identity",
        "I am Agent Alpha.",
        "Engine: Antigravity",
        "",
        "## 🔒 Key Constraints",
        "- Zero magic numbers",
        "- Atomic persistence",
      ].join("\n");

      const result = validateProtectedSections(baseContent, corruptedContent);
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.type === PROTECTED_VIOLATION_TYPES.LOCK_REMOVED)).toBe(true);
    });

    it("detects TRUNCATED violation when protected section content is shortened", () => {
      const corruptedContent = [
        "## 🔒 My Identity",
        "I am Agent Alpha.", // Engine line omitted
        "",
        "## 🔒 Key Constraints",
        "- Zero magic numbers",
        "- Atomic persistence",
      ].join("\n");

      const result = validateProtectedSections(baseContent, corruptedContent);
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.type === PROTECTED_VIOLATION_TYPES.TRUNCATED)).toBe(true);
    });

    it("detects MODIFIED violation when an existing line in a protected section is altered", () => {
      const corruptedContent = [
        "## 🔒 My Identity",
        "I am Agent Beta (MUTATED).",
        "Engine: Antigravity",
        "",
        "## 🔒 Key Constraints",
        "- Zero magic numbers",
        "- Atomic persistence",
      ].join("\n");

      const result = validateProtectedSections(baseContent, corruptedContent);
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.type === PROTECTED_VIOLATION_TYPES.MODIFIED)).toBe(true);
    });

    it("allows appending to protected sections by default (allowAppend: true)", () => {
      const appendedContent = [
        "## 🔒 My Identity",
        "I am Agent Alpha.",
        "Engine: Antigravity",
        "Subagent: Dispatcher", // Valid append
        "",
        "## 🔒 Key Constraints",
        "- Zero magic numbers",
        "- Atomic persistence",
      ].join("\n");

      const result = validateProtectedSections(baseContent, appendedContent);
      expect(result.isValid).toBe(true);
    });

    it("disallows appending to protected sections when allowAppend is disabled", () => {
      const appendedContent = [
        "## 🔒 My Identity",
        "I am Agent Alpha.",
        "Engine: Antigravity",
        "Subagent: Dispatcher",
        "",
        "## 🔒 Key Constraints",
        "- Zero magic numbers",
        "- Atomic persistence",
      ].join("\n");

      const result = validateProtectedSections(baseContent, appendedContent, { allowAppend: false });
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.type === PROTECTED_VIOLATION_TYPES.MODIFIED)).toBe(true);
    });

    it("detects MISSING_REQUIRED violation when required header is absent", () => {
      const result = validateProtectedSections(baseContent, baseContent, {
        requiredHeaders: ["## 🔒 Architecture Mandate"],
      });
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.type === PROTECTED_VIOLATION_TYPES.MISSING_REQUIRED)).toBe(true);
    });

    it("detects MAX_LINES_EXCEEDED when line count exceeds configured maximum", () => {
      const longContent = Array.from({ length: 105 }, (_, i) => `Line ${i + 1}`).join("\n");
      const result = validateProtectedSections(baseContent, longContent, {
        enforceMaxLines: true,
        maxLines: 100,
      });
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.type === PROTECTED_VIOLATION_TYPES.MAX_LINES_EXCEEDED)).toBe(true);
    });
  });

  describe("assertProtectedSectionsPreserved & writeBriefingAtomic", () => {
    it("assertProtectedSectionsPreserved throws ProtectedSectionError on violation", () => {
      const original = "## 🔒 My Identity\nOriginal Value";
      const corrupted = "## 🔒 My Identity\nOverwritten Value";

      expect(() => {
        assertProtectedSectionsPreserved(original, corrupted, "BRIEFING.md");
      }).toThrow(ProtectedSectionError);
    });

    it("writeBriefingAtomic enforces protected section guard on overwrites", async () => {
      const briefingPath = join(testDir, "BRIEFING.md");
      const initial = "## 🔒 My Identity\nOriginal Role\n\n## Notes\nInitial";
      await writeBriefingAtomic(briefingPath, initial);

      const invalidOverwrite = "## Notes\nAttempted to remove protected section completely";
      await expect(writeBriefingAtomic(briefingPath, invalidOverwrite)).rejects.toThrow(
        ProtectedSectionError
      );

      // Verify the file was untouched
      const currentContent = await readAtomic(briefingPath);
      expect(currentContent).toBe(initial);
    });

    it("writeBriefingAtomic auto-restores protected sections when autoMergeProtected is true", async () => {
      const briefingPath = join(testDir, "BRIEFING.md");
      const initial = "## 🔒 My Identity\nOriginal Role\n\n## Tasks\nTask A";
      await writeBriefingAtomic(briefingPath, initial);

      // Overwrite that accidentally dropped My Identity but updated Tasks
      const proposed = "## Tasks\nTask A\nTask B completed";
      await writeBriefingAtomic(briefingPath, proposed, { autoMergeProtected: true });

      const finalContent = await readAtomic(briefingPath);
      expect(finalContent).toContain("## 🔒 My Identity");
      expect(finalContent).toContain("Original Role");
      expect(finalContent).toContain("Task B completed");
    });
  });

  describe("mergeProtectedSections", () => {
    it("merges deleted protected sections back into new content", () => {
      const existing = [
        "## 🔒 My Identity",
        "Role: Master Orchestrator",
        "",
        "## 🔒 Key Constraints",
        "No network calls",
        "",
        "## Unprotected Section",
        "Old notes",
      ].join("\n");

      const proposed = [
        "## Unprotected Section",
        "New notes added by agent",
      ].join("\n");

      const merged = mergeProtectedSections(existing, proposed);
      expect(merged).toContain("## 🔒 My Identity");
      expect(merged).toContain("Role: Master Orchestrator");
      expect(merged).toContain("## 🔒 Key Constraints");
      expect(merged).toContain("No network calls");
      expect(merged).toContain("New notes added by agent");
    });
  });
});

describe("Heartbeat Watchdog & Parsing", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "memory-storage-heartbeat-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("parseHeartbeatTimestamp", () => {
    it("parses standard ISO timestamp format", () => {
      const content = "# Progress\nLast visited: 2026-10-24T12:00:00.000Z\nNext step";
      const date = parseHeartbeatTimestamp(content);
      expect(date).not.toBeNull();
      expect(date?.toISOString()).toBe("2026-10-24T12:00:00.000Z");
    });

    it("parses bracketed ISO timestamp format and bullet prefixes", () => {
      const content = "- Last visited: [2026-10-24T14:30:00.000Z]";
      const date = parseHeartbeatTimestamp(content);
      expect(date).not.toBeNull();
      expect(date?.toISOString()).toBe("2026-10-24T14:30:00.000Z");
    });

    it("parses numeric epoch timestamp", () => {
      const epochMs = 1770000000000;
      const content = `* Last visited: ${epochMs}`;
      const date = parseHeartbeatTimestamp(content);
      expect(date).not.toBeNull();
      expect(date?.getTime()).toBe(epochMs);
    });

    it("selects the latest timestamp when multiple are present", () => {
      const content = [
        "Last visited: 2026-10-24T10:00:00.000Z",
        "Some intermediate log",
        "Last visited: 2026-10-24T15:00:00.000Z",
        "Last visited: 2026-10-24T12:00:00.000Z",
      ].join("\n");

      const date = parseHeartbeatTimestamp(content);
      expect(date).not.toBeNull();
      expect(date?.toISOString()).toBe("2026-10-24T15:00:00.000Z");
    });

    it("falls back to file mtime when content has no valid timestamp", () => {
      const fallbackMs = 1700000000000;
      const date = parseHeartbeatTimestamp("No heartbeat line here", fallbackMs);
      expect(date).not.toBeNull();
      expect(date?.getTime()).toBe(fallbackMs);
    });

    it("returns null when no timestamp and no fallback are available", () => {
      expect(parseHeartbeatTimestamp("")).toBeNull();
      expect(parseHeartbeatTimestamp("random content")).toBeNull();
    });
  });

  describe("formatHeartbeatContent & touchAgentHeartbeat", () => {
    it("creates default progress log structure when content is empty", () => {
      const targetDate = new Date("2026-10-24T16:00:00.000Z");
      const formatted = formatHeartbeatContent(null, targetDate);
      expect(formatted).toContain("# Progress Log");
      expect(formatted).toContain(`Last visited: ${targetDate.toISOString()}`);
    });

    it("replaces existing Last visited line cleanly", () => {
      const existing = "# My Progress\n\nLast visited: 2026-10-24T10:00:00.000Z\n\n- Doing work";
      const targetDate = new Date("2026-10-24T18:00:00.000Z");
      const formatted = formatHeartbeatContent(existing, targetDate);

      expect(formatted).toContain(`Last visited: ${targetDate.toISOString()}`);
      expect(formatted).not.toContain("2026-10-24T10:00:00.000Z");
      expect(formatted).toContain("- Doing work");
    });

    it("inserts Last visited line after first heading if no heartbeat existed", () => {
      const existing = "# Progress Log\n\n- Task 1 in progress";
      const targetDate = new Date("2026-10-24T18:00:00.000Z");
      const formatted = formatHeartbeatContent(existing, targetDate);

      expect(formatted).toContain(`Last visited: ${targetDate.toISOString()}`);
      expect(formatted.startsWith("# Progress Log\n\nLast visited:")).toBe(true);
    });

    it("touchAgentHeartbeat and readAgentHeartbeat persist and read timestamp", async () => {
      const progressPath = join(testDir, "agent-1", "progress.md");
      const timestamp = new Date("2026-10-24T12:34:56.000Z");

      const touched = await touchAgentHeartbeat(progressPath, timestamp);
      expect(touched.toISOString()).toBe(timestamp.toISOString());

      const readBack = await readAgentHeartbeat(progressPath);
      expect(readBack).not.toBeNull();
      expect(readBack?.toISOString()).toBe(timestamp.toISOString());
    });
  });

  describe("inspectAgentHeartbeat SLA detection", () => {
    it("reports healthy when agent touched heartbeat within threshold", async () => {
      const agentDir = join(testDir, "healthy-agent");
      mkdirSync(agentDir, { recursive: true });
      const progressPath = join(agentDir, "progress.md");

      const now = Date.now();
      const recentTimestamp = new Date(now - 60_000); // 1 minute ago
      await touchAgentHeartbeat(progressPath, recentTimestamp);

      const inspection = await inspectAgentHeartbeat("healthy-agent", {
        baseDir: testDir,
        thresholdMs: 300_000, // 5 min SLA
        nowMs: now,
      });

      expect(inspection.status).toBe("healthy");
      expect(inspection.isStale).toBe(false);
      expect(inspection.lastHeartbeat?.getTime()).toBe(recentTimestamp.getTime());
      expect(inspection.reason).toBeUndefined();
    });

    it("reports stale when agent heartbeat exceeds 5-minute SLA threshold", async () => {
      const agentDir = join(testDir, "stalled-agent");
      mkdirSync(agentDir, { recursive: true });
      const progressPath = join(agentDir, "progress.md");

      const now = Date.now();
      const oldTimestamp = new Date(now - 360_000); // 6 minutes ago (> 5 min threshold)
      await touchAgentHeartbeat(progressPath, oldTimestamp);

      const inspection = await inspectAgentHeartbeat("stalled-agent", {
        baseDir: testDir,
        thresholdMs: 300_000,
        nowMs: now,
      });

      expect(inspection.status).toBe("stale");
      expect(inspection.isStale).toBe(true);
      expect(inspection.reason).toBe("heartbeat_expired");
      expect(inspection.elapsedMs).toBeGreaterThanOrEqual(360_000);
    });

    it("reports missing when workspace directory exists but progress.md is absent and time elapsed", async () => {
      const agentDir = join(testDir, "missing-agent");
      mkdirSync(agentDir, { recursive: true });

      const now = Date.now() + 400_000;
      const inspection = await inspectAgentHeartbeat("missing-agent", {
        baseDir: testDir,
        thresholdMs: 300_000,
        nowMs: now,
      });

      expect(inspection.isStale).toBe(true);
      expect(inspection.reason).toBe("heartbeat_missing");
    });
  });

  describe("HeartbeatWatchdog lifecycle and event emission", () => {
    it("detects stalled subagents and emits staleness events", async () => {
      const watchdog = createHeartbeatWatchdog({
        baseDir: testDir,
        thresholdMs: 300_000, // 5 minutes
      });

      const agentDir = join(testDir, "worker-agent");
      mkdirSync(agentDir, { recursive: true });
      const progressPath = join(agentDir, "progress.md");

      const baseTime = Date.now();
      const heartbeatTime = new Date(baseTime);
      await touchAgentHeartbeat(progressPath, heartbeatTime);

      watchdog.registerAgent("worker-agent");
      expect(watchdog.isAgentRegistered("worker-agent")).toBe(true);

      // Check within SLA -> healthy, no events
      const healthyEvents = await watchdog.checkOnce(baseTime + 100_000);
      expect(healthyEvents).toHaveLength(0);
      expect(watchdog.isAgentStale("worker-agent")).toBe(false);

      // Advance time beyond 5-minute SLA -> staleness triggered
      const stalenessEvents: unknown[] = [];
      watchdog.onStaleness((event) => stalenessEvents.push(event));

      const detectedEvents = await watchdog.checkOnce(baseTime + 350_000);
      expect(detectedEvents).toHaveLength(1);
      expect(detectedEvents[0]?.agentId).toBe("worker-agent");
      expect(detectedEvents[0]?.type).toBe(STORAGE_CONSTANTS.WATCHDOG_EVENT_STALENESS);
      expect(stalenessEvents).toHaveLength(1);
      expect(watchdog.isAgentStale("worker-agent")).toBe(true);

      // Subsequent check does not re-emit duplicate staleness
      const duplicateEvents = await watchdog.checkOnce(baseTime + 400_000);
      expect(duplicateEvents).toHaveLength(0);
      expect(stalenessEvents).toHaveLength(1);

      // Agent recovers by touching heartbeat
      const recoveryEvents: unknown[] = [];
      watchdog.onRecovery((event) => recoveryEvents.push(event));

      await touchAgentHeartbeat(progressPath, new Date(baseTime + 410_000));
      await watchdog.checkOnce(baseTime + 420_000);

      expect(watchdog.isAgentStale("worker-agent")).toBe(false);
      expect(recoveryEvents).toHaveLength(1);

      watchdog.dispose();
    });

    it("scans workspaces automatically when discovering agents", async () => {
      const agent1 = join(testDir, "discovered-1");
      const agent2 = join(testDir, "discovered-2");
      const ignoredSentinel = join(testDir, STORAGE_CONSTANTS.DIR_SENTINEL);
      const ignoredState = join(testDir, STORAGE_CONSTANTS.DIR_STATE);

      mkdirSync(agent1, { recursive: true });
      mkdirSync(agent2, { recursive: true });
      mkdirSync(ignoredSentinel, { recursive: true });
      mkdirSync(ignoredState, { recursive: true });

      const watchdog = new HeartbeatWatchdog({
        baseDir: testDir,
        scanWorkspaces: true,
      });

      const agents = await watchdog.discoverAgents();
      expect(agents).toContain("discovered-1");
      expect(agents).toContain("discovered-2");
      expect(agents).not.toContain(STORAGE_CONSTANTS.DIR_SENTINEL);
      expect(agents).not.toContain(STORAGE_CONSTANTS.DIR_STATE);

      watchdog.dispose();
    });

    it("invokes onStale and onRecovery callbacks when configured", async () => {
      let staleCallbackInvoked = false;
      let recoveryCallbackInvoked = false;

      const watchdog = new HeartbeatWatchdog({
        baseDir: testDir,
        thresholdMs: 10_000,
        onStale: (event) => {
          if (event.agentId === "callback-agent") {
            staleCallbackInvoked = true;
          }
        },
        onRecovery: (agentId) => {
          if (agentId === "callback-agent") {
            recoveryCallbackInvoked = true;
          }
        },
      });

      const agentDir = join(testDir, "callback-agent");
      mkdirSync(agentDir, { recursive: true });
      const progressPath = join(agentDir, "progress.md");

      const now = Date.now();
      await touchAgentHeartbeat(progressPath, new Date(now - 15_000));

      watchdog.registerAgent("callback-agent");
      await watchdog.checkAll(now);

      expect(staleCallbackInvoked).toBe(true);

      // Now recover
      await touchAgentHeartbeat(progressPath, new Date(now));
      await watchdog.checkAll(now + 1_000);

      expect(recoveryCallbackInvoked).toBe(true);
      watchdog.dispose();
    });

    it("manages timer start and stop cleanly", () => {
      const watchdog = new HeartbeatWatchdog({ checkIntervalMs: 50_000 });
      expect(watchdog.isRunning()).toBe(false);

      watchdog.start();
      expect(watchdog.isRunning()).toBe(true);

      watchdog.stop();
      expect(watchdog.isRunning()).toBe(false);

      watchdog.dispose();
    });
  });
});

describe("MemoryStorage High-Level Manager", () => {
  let testDir: string;
  let storage: MemoryStorage;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "memory-storage-manager-"));
    storage = createMemoryStorage({ baseDir: testDir });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("configures canonical directory paths correctly", () => {
    expect(storage.getBaseDir()).toBe(testDir);
    expect(storage.getSentinelDir()).toBe(join(testDir, "sentinel"));
    expect(storage.getBriefingDir()).toBe(join(testDir, "briefing"));
    expect(storage.getStateDir()).toBe(join(testDir, "state"));
    expect(storage.getAgentDir("agent-007")).toBe(join(testDir, "agent-007"));
    expect(storage.getBriefingPath("agent-007")).toBe(join(testDir, "agent-007", "BRIEFING.md"));
    expect(storage.getProgressPath("agent-007")).toBe(join(testDir, "agent-007", "progress.md"));
  });

  it("initializeScaffolding creates sentinel, briefing, and state directories", async () => {
    const result = await storage.initializeScaffolding();
    expect(result.createdDirectories).toContain(storage.getBaseDir());
    expect(result.createdDirectories).toContain(storage.getSentinelDir());
    expect(result.createdDirectories).toContain(storage.getBriefingDir());
    expect(result.createdDirectories).toContain(storage.getStateDir());

    expect(existsSync(storage.getSentinelDir())).toBe(true);
    expect(existsSync(storage.getBriefingDir())).toBe(true);
    expect(existsSync(storage.getStateDir())).toBe(true);
  });

  it("scaffoldAgentWorkspace initializes agent directory with template files", async () => {
    const info = await storage.scaffoldAgentWorkspace("subagent-qa", {
      initialBriefing: "## 🔒 My Identity\nQA Specialist",
      initialDispatch: "## Dispatch Instructions\nValidate tests",
      initialProgress: "# Progress Log\nReady",
    });

    expect(info.agentId).toBe("subagent-qa");
    expect(existsSync(info.workspaceDir)).toBe(true);
    expect(existsSync(info.briefingPath)).toBe(true);
    expect(existsSync(info.dispatchPath)).toBe(true);
    expect(existsSync(info.progressPath)).toBe(true);

    const briefingContent = await storage.readAtomic(info.briefingPath);
    expect(briefingContent).toContain("QA Specialist");
  });

  it("writes and reads state atomically as JSON", async () => {
    await storage.initializeScaffolding();

    interface AgentState {
      step: number;
      activeTask: string;
      meta: { retries: number };
    }

    const statePayload: AgentState = {
      step: 4,
      activeTask: "1.4",
      meta: { retries: 0 },
    };

    await storage.writeStateAtomic("agent-state", statePayload);
    expect(await storage.stateExists("agent-state")).toBe(true);

    const loaded = await storage.readState<AgentState>("agent-state");
    expect(loaded).toEqual(statePayload);

    const statesList = await storage.listStates();
    expect(statesList).toContain("agent-state.json");

    const deleted = await storage.deleteState("agent-state");
    expect(deleted).toBe(true);
    expect(await storage.stateExists("agent-state")).toBe(false);

    const deletedAgain = await storage.deleteState("agent-state");
    expect(deletedAgain).toBe(false);
  });

  it("handles non-existent state gracefully by returning null", async () => {
    await storage.initializeScaffolding();
    const state = await storage.readState("non-existent-state");
    expect(state).toBeNull();
  });

  it("throws StorageError with DESERIALIZATION_FAILED when state JSON is corrupted", async () => {
    await storage.initializeScaffolding();
    const corruptFile = join(storage.getStateDir(), "corrupt.json");
    writeFileSync(corruptFile, "{ invalid json content: 123", "utf-8");

    try {
      await storage.readState("corrupt");
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
      const storageError = error as StorageError;
      expect(storageError.code).toBe(STORAGE_ERROR_CODES.DESERIALIZATION_FAILED);
    }
  });

  it("provides integrated heartbeat and watchdog methods", async () => {
    await storage.scaffoldAgentWorkspace("agent-looper");

    const now = new Date();
    await storage.touchHeartbeat("agent-looper", now);

    const heartbeat = await storage.getHeartbeat("agent-looper");
    expect(heartbeat).not.toBeNull();
    expect(heartbeat?.toISOString()).toBe(now.toISOString());

    const singleCheck = await storage.checkHeartbeat("agent-looper");
    expect(singleCheck.status).toBe("healthy");

    const allChecks = await storage.checkAllHeartbeats();
    expect(allChecks.length).toBeGreaterThanOrEqual(1);
    expect(allChecks.some((c) => c.agentId === "agent-looper" && c.status === "healthy")).toBe(true);
  });
});
