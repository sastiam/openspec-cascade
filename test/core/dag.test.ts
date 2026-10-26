import { describe, expect, it } from "bun:test";
import {
  CircularDependencyError,
  CyclicDependencyError,
  DAG,
  DAG_CONSTANTS,
  DagBatchResolver,
  DagExecutionError,
  DagLevelBatchResolver,
  DagNodeNotFoundError,
  DagValidationError,
  DirectedAcyclicGraph,
  LevelBatchResolver,
  TASK_STATUS,
  TaskDAG,
  TaskDagResolver,
  assertAcyclic,
  createLevelBatchResolver,
  findCycle,
  findCycles,
  hasCycle,
  resolveLevelBatches,
  topologicalSort,
  type DagExecutionSnapshot,
  type DagLevelBatch,
  type DagNode,
  type TaskDefinition,
} from "../../src/core/dag";

const TEST_CONSTANTS = {
  EMPTY_COUNT: 0,
  SINGLE_COUNT: 1,
  TWO_COUNT: 2,
  THREE_COUNT: 3,
  FOUR_COUNT: 4,
  FIVE_COUNT: 5,
  LEVEL_ZERO: 0,
  LEVEL_ONE: 1,
  LEVEL_TWO: 2,
  LEVEL_THREE: 3,
  ASYNC_DELAY_MS: 15,
  MAX_WORKERS_TWO: 2,
  MAX_WORKERS_THREE: 3,
  INVALID_SCHEMA_VERSION: 999,
  MOCK_SNAPSHOT_TIMESTAMP: 1700000000000,
} as const;

describe("Directed Acyclic Graph & Topological Scheduler (LOOPER-CORE-002)", () => {
  describe("DAG Construction & Node/Edge Graph Operations", () => {
    it("initializes an empty graph with zero nodes and empty accessors", () => {
      const dag = new DirectedAcyclicGraph();

      expect(dag.size).toBe(TEST_CONSTANTS.EMPTY_COUNT);
      expect(dag.getNodeIds()).toEqual([]);
      expect(dag.getNodes()).toEqual([]);
      expect(dag.getRoots()).toEqual([]);
      expect(dag.getLeaves()).toEqual([]);
      expect(dag.hasCycle()).toBe(false);
      expect(dag.findCycle()).toBeNull();
      expect(dag.findCycles()).toEqual([]);
      expect(dag.getCycleReport()).toBeNull();
    });

    it("adds nodes with optional payload data and retrieves them cleanly", () => {
      const dag = new DirectedAcyclicGraph<{ priority: number }>();
      dag.addNode("task-a", { priority: 1 });
      dag.addNode("task-b", { priority: 2 });

      expect(dag.size).toBe(TEST_CONSTANTS.TWO_COUNT);
      expect(dag.hasNode("task-a")).toBe(true);
      expect(dag.hasNode("task-b")).toBe(true);
      expect(dag.hasNode("task-c")).toBe(false);

      expect(dag.getData("task-a")).toEqual({ priority: 1 });
      expect(dag.getData("task-b")).toEqual({ priority: 2 });
      expect(dag.getData("task-c")).toBeUndefined();

      const nodeA = dag.getNode("task-a");
      expect(nodeA).toBeDefined();
      expect(nodeA?.id).toBe("task-a");
      expect(nodeA?.data).toEqual({ priority: 1 });
      expect(nodeA?.dependencies).toEqual([]);

      const requiredB = dag.requireNode("task-b");
      expect(requiredB.id).toBe("task-b");
      expect(requiredB.data).toEqual({ priority: 2 });
    });

    it("throws DagValidationError on invalid node IDs", () => {
      const dag = new DirectedAcyclicGraph();

      expect(() => dag.addNode("")).toThrow(DagValidationError);
      expect(() => dag.addNode(null as unknown as string)).toThrow(DagValidationError);
      expect(() => dag.addNode(undefined as unknown as string)).toThrow(DagValidationError);
      expect(() => dag.addEdge("", "task-b")).toThrow(DagValidationError);
      expect(() => dag.addEdge("task-a", "")).toThrow(DagValidationError);
    });

    it("throws DagNodeNotFoundError when requiring or querying non-existent nodes", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addNode("task-a");

      expect(() => dag.requireNode("task-unknown")).toThrow(DagNodeNotFoundError);
      expect(() => dag.getDependencies("task-unknown")).toThrow(DagNodeNotFoundError);
      expect(() => dag.getDependents("task-unknown")).toThrow(DagNodeNotFoundError);
      expect(() => dag.getInDegree("task-unknown")).toThrow(DagNodeNotFoundError);
      expect(() => dag.getOutDegree("task-unknown")).toThrow(DagNodeNotFoundError);
      expect(dag.getNode("task-unknown")).toBeUndefined();
    });

    it("updates payload data via setData and creates placeholder when autoCreateNodes is true", () => {
      const dag = new DirectedAcyclicGraph<string>(undefined, { autoCreateNodes: true });

      dag.setData("task-new", "initial-data");
      expect(dag.hasNode("task-new")).toBe(true);
      expect(dag.getData("task-new")).toBe("initial-data");

      dag.setData("task-new", "updated-data");
      expect(dag.getData("task-new")).toBe("updated-data");
    });

    it("throws DagNodeNotFoundError on setData when autoCreateNodes is false and node does not exist", () => {
      const dag = new DirectedAcyclicGraph<string>(undefined, { autoCreateNodes: false });

      expect(() => dag.setData("task-missing", "value")).toThrow(DagNodeNotFoundError);
    });

    it("removes nodes and cleanly removes all incoming and outgoing edges", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("a", "b");
      dag.addEdge("b", "c");
      dag.addEdge("a", "c");

      expect(dag.size).toBe(TEST_CONSTANTS.THREE_COUNT);
      expect(dag.hasEdge("a", "b")).toBe(true);
      expect(dag.hasEdge("b", "c")).toBe(true);

      const removed = dag.removeNode("b");
      expect(removed).toBe(true);
      expect(dag.size).toBe(TEST_CONSTANTS.TWO_COUNT);
      expect(dag.hasNode("b")).toBe(false);
      expect(dag.hasEdge("a", "b")).toBe(false);
      expect(dag.hasEdge("b", "c")).toBe(false);
      expect(dag.hasEdge("a", "c")).toBe(true);

      expect(dag.getDependencies("c")).toEqual(["a"]);
      expect(dag.getDependents("a")).toEqual(["c"]);

      // Removing non-existent node returns false
      expect(dag.removeNode("b")).toBe(false);
    });

    it("adds and removes edges explicitly", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addNode("a");
      dag.addNode("b");

      dag.addEdge("a", "b");
      expect(dag.hasEdge("a", "b")).toBe(true);
      expect(dag.hasEdge("b", "a")).toBe(false);
      expect(dag.getInDegree("b")).toBe(TEST_CONSTANTS.SINGLE_COUNT);
      expect(dag.getOutDegree("a")).toBe(TEST_CONSTANTS.SINGLE_COUNT);

      const removed = dag.removeEdge("a", "b");
      expect(removed).toBe(true);
      expect(dag.hasEdge("a", "b")).toBe(false);
      expect(dag.getInDegree("b")).toBe(TEST_CONSTANTS.EMPTY_COUNT);
      expect(dag.getOutDegree("a")).toBe(TEST_CONSTANTS.EMPTY_COUNT);

      // Removing non-existent edge returns false
      expect(dag.removeEdge("a", "b")).toBe(false);
    });

    it("supports addDependency declarative helper (dependentId requires prerequisiteId)", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addDependency("compile", "fetch-deps");

      expect(dag.hasEdge("fetch-deps", "compile")).toBe(true);
      expect(dag.getDependencies("compile")).toEqual(["fetch-deps"]);
      expect(dag.getDependents("fetch-deps")).toEqual(["compile"]);
    });

    it("throws DagNodeNotFoundError when autoCreateNodes is disabled and edge targets missing node", () => {
      const dag = new DirectedAcyclicGraph(undefined, { autoCreateNodes: false });
      dag.addNode("a");

      expect(() => dag.addEdge("a", "missing")).toThrow(DagNodeNotFoundError);
      expect(() => dag.addEdge("missing", "a")).toThrow(DagNodeNotFoundError);
    });

    it("identifies roots and leaves correctly in complex graphs", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("root1", "mid1");
      dag.addEdge("root2", "mid1");
      dag.addEdge("mid1", "leaf1");
      dag.addEdge("mid1", "leaf2");
      dag.addNode("isolated");

      expect(dag.getRoots()).toEqual(["isolated", "root1", "root2"]);
      expect(dag.getLeaves()).toEqual(["isolated", "leaf1", "leaf2"]);
    });

    it("checks paths and computes shortest path with hasPath and getPath", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("a", "b");
      dag.addEdge("b", "c");
      dag.addEdge("c", "d");
      dag.addEdge("a", "d");
      dag.addNode("unreachable");

      expect(dag.hasPath("a", "d")).toBe(true);
      expect(dag.hasPath("d", "a")).toBe(false);
      expect(dag.hasPath("a", "a")).toBe(true);
      expect(dag.hasPath("a", "unreachable")).toBe(false);
      expect(dag.hasPath("unknown", "d")).toBe(false);

      // Shortest path between a and d is direct: ['a', 'd']
      expect(dag.getPath("a", "d")).toEqual(["a", "d"]);
      expect(dag.getPath("a", "c")).toEqual(["a", "b", "c"]);
      expect(dag.getPath("a", "a")).toEqual(["a"]);
      expect(dag.getPath("d", "a")).toBeNull();
      expect(dag.getPath("a", "unreachable")).toBeNull();
      expect(dag.getPath("unknown", "d")).toBeNull();
    });

    it("clones graph deeply without mutating original", () => {
      const original = new DirectedAcyclicGraph<{ value: string }>();
      original.addNode("a", { value: "A" });
      original.addEdge("a", "b");

      const cloned = original.clone();
      expect(cloned.size).toBe(TEST_CONSTANTS.TWO_COUNT);
      expect(cloned.hasEdge("a", "b")).toBe(true);

      cloned.addNode("c");
      cloned.addEdge("b", "c");

      expect(cloned.size).toBe(TEST_CONSTANTS.THREE_COUNT);
      expect(original.size).toBe(TEST_CONSTANTS.TWO_COUNT);
      expect(original.hasNode("c")).toBe(false);
      expect(original.hasEdge("b", "c")).toBe(false);
    });

    it("parses task definitions supporting dependencies, dependsOn, and prerequisites aliases", () => {
      const tasks: TaskDefinition[] = [
        { id: "task-1", dependencies: ["task-0"] },
        { id: "task-2", dependsOn: ["task-1"] },
        { id: "task-3", prerequisites: ["task-2"] },
      ];

      const dag = DirectedAcyclicGraph.fromTasks(tasks);
      expect(dag.size).toBe(TEST_CONSTANTS.FOUR_COUNT); // task-0 auto-created
      expect(dag.getDependencies("task-1")).toEqual(["task-0"]);
      expect(dag.getDependencies("task-2")).toEqual(["task-1"]);
      expect(dag.getDependencies("task-3")).toEqual(["task-2"]);
    });

    it("throws DagValidationError if task definition lacks a valid id", () => {
      const invalidTasks = [{ missingId: "val" }] as unknown as TaskDefinition[];
      expect(() => DirectedAcyclicGraph.fromTasks(invalidTasks)).toThrow(DagValidationError);
    });
  });

  describe("Topological Dependency Sorting (Spec Requirement)", () => {
    it("sorts linear task pipeline ensuring prerequisites strictly precede dependents", () => {
      const tasks: TaskDefinition[] = [
        { id: "deploy", dependencies: ["test"] },
        { id: "test", dependencies: ["build"] },
        { id: "build", dependencies: ["lint"] },
        { id: "lint", dependencies: [] },
      ];

      const order = topologicalSort(tasks);
      expect(order).toEqual(["lint", "build", "test", "deploy"]);

      const dag = DirectedAcyclicGraph.fromTasks(tasks);
      const result = dag.getTopologicalSort();
      expect(result.order).toEqual(["lint", "build", "test", "deploy"]);
      expect(result.totalNodes).toBe(TEST_CONSTANTS.FOUR_COUNT);
      expect(result.nodes.map((n) => n.id)).toEqual(["lint", "build", "test", "deploy"]);
    });

    it("sorts diamond dependency graph deterministically", () => {
      // Diamond: A -> B, A -> C, B -> D, C -> D
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("A", "B");
      dag.addEdge("A", "C");
      dag.addEdge("B", "D");
      dag.addEdge("C", "D");

      const order = dag.topologicalSort();
      expect(order).toEqual(["A", "B", "C", "D"]);

      // Verify prerequisite invariant
      expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"));
      expect(order.indexOf("A")).toBeLessThan(order.indexOf("C"));
      expect(order.indexOf("B")).toBeLessThan(order.indexOf("D"));
      expect(order.indexOf("C")).toBeLessThan(order.indexOf("D"));
    });

    it("sorts branched dependency tree with multiple roots and leaves", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("init-db", "migrate");
      dag.addEdge("init-cache", "warm-cache");
      dag.addEdge("migrate", "start-server");
      dag.addEdge("warm-cache", "start-server");
      dag.addEdge("start-server", "health-check");

      const nodes = dag.topologicalSortNodes();
      const nodeIds = nodes.map((n) => n.id);

      expect(nodeIds.indexOf("init-db")).toBeLessThan(nodeIds.indexOf("migrate"));
      expect(nodeIds.indexOf("init-cache")).toBeLessThan(nodeIds.indexOf("warm-cache"));
      expect(nodeIds.indexOf("migrate")).toBeLessThan(nodeIds.indexOf("start-server"));
      expect(nodeIds.indexOf("warm-cache")).toBeLessThan(nodeIds.indexOf("start-server"));
      expect(nodeIds.indexOf("start-server")).toBeLessThan(nodeIds.indexOf("health-check"));
    });

    it("sorts disconnected independent graph components deterministically", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("x1", "x2");
      dag.addEdge("a1", "a2");
      dag.addNode("m1");

      const order = dag.topologicalSort();
      // Alphabetical tie-breaking: a1 -> a2, m1, x1 -> x2
      expect(order).toEqual(["a1", "a2", "m1", "x1", "x2"]);
    });

    it("returns empty array for empty graph and single node for single node graph", () => {
      const emptyDag = new DirectedAcyclicGraph();
      expect(emptyDag.topologicalSort()).toEqual([]);

      const singleDag = new DirectedAcyclicGraph();
      singleDag.addNode("solo");
      expect(singleDag.topologicalSort()).toEqual(["solo"]);
    });
  });

  describe("Cycle Detection & Actionable CircularDependencyError (Spec Scenario)", () => {
    it("detects self-loop cycle (A -> A) and throws CircularDependencyError", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addNode("task-self");
      dag.addEdge("task-self", "task-self");

      expect(dag.hasCycle()).toBe(true);
      expect(dag.findCycle()).toEqual(["task-self", "task-self"]);

      expect(() => dag.assertAcyclic()).toThrow(CircularDependencyError);

      try {
        dag.assertAcyclic();
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(CircularDependencyError);
        const cycleErr = err as CircularDependencyError;
        expect(cycleErr.cycle).toEqual(["task-self", "task-self"]);
        expect(cycleErr.cycleNodes).toEqual(["task-self"]);
        expect(cycleErr.cycleEdges).toEqual([["task-self", "task-self"]]);
        expect(cycleErr.resolutionHint).toContain("Task 'task-self' has a self-dependency");
        expect(cycleErr.toDetailedReport()).toContain("Circular Dependency Diagnostic Report");
      }
    });

    it("detects 2-node cycle (A -> B -> A) and generates actionable remediation guidance", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("A", "B");
      dag.addEdge("B", "A");

      expect(dag.hasCycle()).toBe(true);
      expect(hasCycle([{ id: "A", dependencies: ["B"] }, { id: "B", dependencies: ["A"] }])).toBe(true);

      const cycle = dag.findCycle();
      expect(cycle).toEqual(["A", "B", "A"]);

      try {
        dag.topologicalSort();
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(CircularDependencyError);
        const cycleErr = err as CircularDependencyError;
        expect(cycleErr.cyclePath).toBe("A -> B -> A");
        expect(cycleErr.cycleNodes).toEqual(["A", "B"]);
        expect(cycleErr.cycleEdges).toEqual([
          ["A", "B"],
          ["B", "A"],
        ]);
        expect(cycleErr.dependencyChain).toContain("Task 'B' depends on prerequisite 'A'");
        expect(cycleErr.dependencyChain).toContain("Task 'A' depends on prerequisite 'B'");
        expect(cycleErr.resolutionHint).toContain("Break dependency: Task 'B' -> requires 'A'");
        expect(cycleErr.resolutionHint).toContain("Break dependency: Task 'A' -> requires 'B'");
      }
    });

    it("detects 3-node cycle (A -> B -> C -> A) and normalizes cycle starting node", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("task-c", "task-a");
      dag.addEdge("task-a", "task-b");
      dag.addEdge("task-b", "task-c");

      expect(dag.hasCycle()).toBe(true);
      const cycle = dag.findCycle();
      // Normalized lexicographically: starts and ends with 'task-a'
      expect(cycle).toEqual(["task-a", "task-b", "task-c", "task-a"]);

      expect(() => assertAcyclic([{ id: "task-a", dependencies: ["task-c"] }, { id: "task-c", dependencies: ["task-b"] }, { id: "task-b", dependencies: ["task-a"] }]))
        .toThrow(CircularDependencyError);
    });

    it("finds all distinct elementary cycles with findCycles", () => {
      const dag = new DirectedAcyclicGraph();
      // Cycle 1: c1 -> c2 -> c1
      dag.addEdge("c1", "c2");
      dag.addEdge("c2", "c1");
      // Cycle 2: d1 -> d2 -> d1
      dag.addEdge("d1", "d2");
      dag.addEdge("d2", "d1");

      const allCycles = dag.findCycles();
      expect(allCycles.length).toBe(TEST_CONSTANTS.TWO_COUNT);
      expect(allCycles).toContainEqual(["c1", "c2", "c1"]);
      expect(allCycles).toContainEqual(["d1", "d2", "d1"]);
    });

    it("validates potential cycles before adding edge with checkCycles option", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("build", "test");
      dag.addEdge("test", "package");

      expect(dag.wouldCreateCycle("package", "build")).toBe(true);
      expect(dag.wouldCreateCycle("build", "package")).toBe(false);
      expect(dag.getPotentialCycle("package", "build")).toEqual(["build", "test", "package", "build"]);
      expect(dag.getPotentialCycle("build", "package")).toBeNull();

      // Adding with checkCycles: true throws without mutating graph
      expect(() => dag.addEdge("package", "build", { checkCycles: true })).toThrow(CircularDependencyError);
      expect(dag.hasEdge("package", "build")).toBe(false);
      expect(dag.hasCycle()).toBe(false);

      // addDependency also respects checkCycles: true
      expect(() => dag.addDependency("build", "package", { checkCycles: true })).toThrow(CircularDependencyError);
    });

    it("throws immediately on constructor when validateAcyclic option is true", () => {
      const tasks: TaskDefinition[] = [
        { id: "A", dependencies: ["B"] },
        { id: "B", dependencies: ["A"] },
      ];

      expect(() => new DirectedAcyclicGraph(tasks, { validateAcyclic: true })).toThrow(CircularDependencyError);
    });

    it("generates formatted diagnostic report with getCycleReport", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("alpha", "beta");
      dag.addEdge("beta", "alpha");

      const report = dag.getCycleReport();
      expect(report).not.toBeNull();
      expect(report).toContain("Cycle Path:       alpha -> beta -> alpha");
      expect(report).toContain("Culprit Nodes:    alpha, beta");
      expect(report).toContain("Actionable Remediation:");
    });
  });

  describe("Level Batching for Concurrent Execution (Spec Scenario)", () => {
    it("batches tasks sharing the same dependency level for concurrent execution", () => {
      // Level 0: [root1, root2]
      // Level 1: [mid1, mid2] (both depend on roots)
      // Level 2: [leaf1]
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("root1", "mid1");
      dag.addEdge("root1", "mid2");
      dag.addEdge("root2", "mid1");
      dag.addEdge("root2", "mid2");
      dag.addEdge("mid1", "leaf1");
      dag.addEdge("mid2", "leaf1");

      const batches = dag.getBatches();
      expect(batches.length).toBe(TEST_CONSTANTS.THREE_COUNT);

      expect(batches[0]?.level).toBe(TEST_CONSTANTS.LEVEL_ZERO);
      expect(batches[0]?.taskIds).toEqual(["root1", "root2"]);

      expect(batches[1]?.level).toBe(TEST_CONSTANTS.LEVEL_ONE);
      expect(batches[1]?.taskIds).toEqual(["mid1", "mid2"]);

      expect(batches[2]?.level).toBe(TEST_CONSTANTS.LEVEL_TWO);
      expect(batches[2]?.taskIds).toEqual(["leaf1"]);

      const levels = dag.resolveLevels();
      expect(levels).toEqual([["root1", "root2"], ["mid1", "mid2"], ["leaf1"]]);
    });

    it("partitions large levels into sub-batches when maxConcurrentWorkers limit is exceeded", () => {
      const dag = new DirectedAcyclicGraph();
      // 5 independent root tasks
      dag.addNode("task-1");
      dag.addNode("task-2");
      dag.addNode("task-3");
      dag.addNode("task-4");
      dag.addNode("task-5");

      const batches = dag.getBatches({ maxConcurrentWorkers: TEST_CONSTANTS.MAX_WORKERS_TWO });
      expect(batches.length).toBe(TEST_CONSTANTS.THREE_COUNT);

      expect(batches[0]?.taskIds).toEqual(["task-1", "task-2"]);
      expect(batches[0]?.subBatchIndex).toBe(0);
      expect(batches[0]?.totalSubBatches).toBe(3);

      expect(batches[1]?.taskIds).toEqual(["task-3", "task-4"]);
      expect(batches[1]?.subBatchIndex).toBe(1);
      expect(batches[1]?.totalSubBatches).toBe(3);

      expect(batches[2]?.taskIds).toEqual(["task-5"]);
      expect(batches[2]?.subBatchIndex).toBe(2);
      expect(batches[2]?.totalSubBatches).toBe(3);
    });

    it("evaluates isExecutable and getExecutableTasks dynamically based on completed IDs", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("dep-a", "task-x");
      dag.addEdge("dep-b", "task-x");
      dag.addNode("independent");

      // Initially only roots are executable
      expect(dag.isExecutable("dep-a", [])).toBe(true);
      expect(dag.isExecutable("dep-b", [])).toBe(true);
      expect(dag.isExecutable("independent", [])).toBe(true);
      expect(dag.isExecutable("task-x", [])).toBe(false);
      expect(dag.getExecutableTasks([])).toEqual(["dep-a", "dep-b", "independent"]);

      // Partially satisfied
      expect(dag.isExecutable("task-x", ["dep-a"])).toBe(false);

      // Fully satisfied
      expect(dag.isExecutable("task-x", ["dep-a", "dep-b"])).toBe(true);

      // Already completed is no longer executable
      expect(dag.isExecutable("dep-a", ["dep-a"])).toBe(false);
      expect(dag.getExecutableTasks(["dep-a", "dep-b"])).toEqual(["independent", "task-x"]);
    });

    it("functional helper resolveLevelBatches operates accurately", () => {
      const tasks: TaskDefinition[] = [
        { id: "A" },
        { id: "B", dependencies: ["A"] },
        { id: "C", dependencies: ["A"] },
      ];

      const batches = resolveLevelBatches(tasks);
      expect(batches.length).toBe(TEST_CONSTANTS.TWO_COUNT);
      expect(batches[0]?.taskIds).toEqual(["A"]);
      expect(batches[1]?.taskIds).toEqual(["B", "C"]);
    });
  });

  describe("DagLevelBatchResolver Orchestration & State Tracking", () => {
    it("initializes resolver and rejects cyclic graphs or invalid worker limits", () => {
      const cyclicDag = new DirectedAcyclicGraph();
      cyclicDag.addEdge("c1", "c2");
      cyclicDag.addEdge("c2", "c1");

      expect(() => new DagLevelBatchResolver(cyclicDag)).toThrow(CircularDependencyError);

      const validDag = new DirectedAcyclicGraph();
      validDag.addNode("ok");
      expect(() => new DagLevelBatchResolver(validDag, { maxConcurrentWorkers: 0 })).toThrow(DagValidationError);
    });

    it("initializes all nodes in PENDING status and tracks state across transitions", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("root", "child");

      const resolver = new DagLevelBatchResolver(dag);

      expect(resolver.getStatus("root")).toBe(TASK_STATUS.PENDING);
      expect(resolver.getStatus("child")).toBe(TASK_STATUS.PENDING);
      expect(resolver.getPendingTasks()).toEqual(["child", "root"]);
      expect(resolver.getInProgressTasks()).toEqual([]);
      expect(resolver.getCompletedTasks()).toEqual([]);
      expect(resolver.isComplete()).toBe(false);
      expect(resolver.isSuccessful()).toBe(false);
      expect(resolver.hasFailures()).toBe(false);
    });

    it("executes markInProgress and markCompleted workflow with timestamps and results", () => {
      const dag = new DirectedAcyclicGraph<{ testName: string }>();
      dag.addEdge("setup", "run", { checkCycles: true });
      dag.setData("setup", { testName: "unit-setup" });

      const resolver = new DagLevelBatchResolver(dag);

      // Start setup
      const setupNode = resolver.markInProgress("setup");
      expect(setupNode.status).toBe(TASK_STATUS.IN_PROGRESS);
      expect(setupNode.startedAt).toBeDefined();
      expect(resolver.getInProgressTasks()).toEqual(["setup"]);

      // Complete setup
      const completedNode = resolver.markCompleted("setup", { code: 0 });
      expect(completedNode.status).toBe(TASK_STATUS.COMPLETED);
      expect(completedNode.completedAt).toBeDefined();
      expect(completedNode.result).toEqual({ code: 0 });
      expect(resolver.getCompletedTasks()).toEqual(["setup"]);

      // Now run can start
      resolver.markInProgress("run");
      resolver.markCompleted("run", "OK");

      expect(resolver.isComplete()).toBe(true);
      expect(resolver.isSuccessful()).toBe(true);
      expect(resolver.getSummary().progressPercentage).toBe(DAG_CONSTANTS.COMPLETE_PROGRESS_PERCENTAGE);
    });

    it("throws DagExecutionError when starting task whose prerequisites are not completed", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("prereq", "target");

      const resolver = new DagLevelBatchResolver(dag);

      // Trying to start target before prereq is completed throws
      expect(() => resolver.markInProgress("target")).toThrow(DagExecutionError);

      // Starting task already IN_PROGRESS throws
      resolver.markInProgress("prereq");
      expect(() => resolver.markInProgress("prereq")).toThrow(DagExecutionError);
    });

    it("cascades failure to all downstream dependents when markFailed is called", () => {
      // Tree: root -> child1 -> grandchild
      //       root -> child2
      //       otherRoot (independent)
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("root", "child1");
      dag.addEdge("child1", "grandchild");
      dag.addEdge("root", "child2");
      dag.addNode("otherRoot");

      const resolver = new DagLevelBatchResolver(dag);
      resolver.markInProgress("root");
      resolver.markFailed("root", new Error("Database connection lost"));

      expect(resolver.getStatus("root")).toBe(TASK_STATUS.FAILED);
      expect(resolver.getNode("root").error).toBe("Database connection lost");

      // Transitive dependents are cascaded to BLOCKED
      expect(resolver.getStatus("child1")).toBe(TASK_STATUS.BLOCKED);
      expect(resolver.getStatus("child2")).toBe(TASK_STATUS.BLOCKED);
      expect(resolver.getStatus("grandchild")).toBe(TASK_STATUS.BLOCKED);

      expect(resolver.getNode("child1").error).toContain("Prerequisite task 'root' failed.");
      expect(resolver.getNode("grandchild").error).toContain("Prerequisite task 'root' failed.");

      // Independent branch is unaffected
      expect(resolver.getStatus("otherRoot")).toBe(TASK_STATUS.PENDING);
      expect(resolver.hasFailures()).toBe(true);
      expect(resolver.isSuccessful()).toBe(false);
    });

    it("supports markSkipped and cascades blocking to dependents", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("optional-step", "dependent-step");

      const resolver = new DagLevelBatchResolver(dag);
      resolver.markSkipped("optional-step", "Feature flag disabled");

      expect(resolver.getStatus("optional-step")).toBe(TASK_STATUS.SKIPPED);
      expect(resolver.getStatus("dependent-step")).toBe(TASK_STATUS.BLOCKED);
      expect(resolver.getSkippedTasks()).toEqual(["optional-step"]);
      expect(resolver.getBlockedTasks()).toEqual(["dependent-step"]);
    });

    it("resets task and optionally resets blocked dependents back to PENDING", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("step1", "step2");

      const resolver = new DagLevelBatchResolver(dag);
      resolver.markFailed("step1", "Transient network error");

      expect(resolver.getStatus("step1")).toBe(TASK_STATUS.FAILED);
      expect(resolver.getStatus("step2")).toBe(TASK_STATUS.BLOCKED);

      // Reset without dependents
      resolver.resetTask("step1", { resetDependents: false });
      expect(resolver.getStatus("step1")).toBe(TASK_STATUS.PENDING);
      expect(resolver.getStatus("step2")).toBe(TASK_STATUS.BLOCKED);

      // Mark failed again and reset with dependents
      resolver.markFailed("step1", "Transient failure 2");
      resolver.resetTask("step1", { resetDependents: true });
      expect(resolver.getStatus("step1")).toBe(TASK_STATUS.PENDING);
      expect(resolver.getStatus("step2")).toBe(TASK_STATUS.PENDING);
    });

    it("computes getNextExecutableBatch respecting concurrency worker capacity", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addNode("t1");
      dag.addNode("t2");
      dag.addNode("t3");
      dag.addNode("t4");

      const resolver = new DagLevelBatchResolver(dag, { maxConcurrentWorkers: TEST_CONSTANTS.MAX_WORKERS_TWO });

      // Capacity is 2
      const firstBatch = resolver.getNextExecutableBatch();
      expect(firstBatch).toEqual(["t1", "t2"]);

      // Mark t1 in progress -> capacity remaining is 1
      resolver.markInProgress("t1");
      const nextBatch = resolver.getNextExecutableBatch();
      expect(nextBatch).toEqual(["t2"]);

      // Mark t2 in progress -> capacity remaining is 0
      resolver.markInProgress("t2");
      expect(resolver.getNextExecutableBatch()).toEqual([]);

      // Custom limit
      expect(resolver.getNextExecutableBatch(0)).toEqual([]);

      // Complete t1 -> capacity re-opens
      resolver.markCompleted("t1");
      expect(resolver.getNextExecutableBatch()).toEqual(["t3"]);
    });

    it("computes accurate execution summary metrics", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addNode("t1");
      dag.addNode("t2");
      dag.addNode("t3");
      dag.addNode("t4");

      const resolver = new DagLevelBatchResolver(dag);
      resolver.markInProgress("t1");
      resolver.markCompleted("t1");
      resolver.markInProgress("t2");
      resolver.markFailed("t3", "error");
      resolver.markSkipped("t4", "skipped");

      const summary = resolver.getSummary();
      expect(summary.totalTasks).toBe(TEST_CONSTANTS.FOUR_COUNT);
      expect(summary.completedCount).toBe(TEST_CONSTANTS.SINGLE_COUNT);
      expect(summary.inProgressCount).toBe(TEST_CONSTANTS.SINGLE_COUNT);
      expect(summary.failedCount).toBe(TEST_CONSTANTS.SINGLE_COUNT);
      expect(summary.skippedCount).toBe(TEST_CONSTANTS.SINGLE_COUNT);
      expect(summary.isComplete).toBe(false);
      expect(summary.isSuccessful).toBe(false);
      expect(summary.progressPercentage).toBe(25);
    });
  });

  describe("Snapshot Persistence, Checkpointing & Recovery", () => {
    it("exports and imports execution snapshot preserving task state and metadata", () => {
      const dag = new DirectedAcyclicGraph<{ meta: string }>();
      dag.addEdge("a", "b");
      dag.setData("a", { meta: "payload-a" });

      const resolver = new DagLevelBatchResolver(dag);
      resolver.markInProgress("a");
      resolver.markCompleted("a", { data: 123 });

      const snapshot = resolver.exportSnapshot();
      expect(snapshot.schemaVersion).toBe(DAG_CONSTANTS.SNAPSHOT_SCHEMA_VERSION);
      expect(snapshot.totalTasks).toBe(TEST_CONSTANTS.TWO_COUNT);
      expect(snapshot.nodes.length).toBe(TEST_CONSTANTS.TWO_COUNT);

      const nodeA = snapshot.nodes.find((n) => n.id === "a");
      expect(nodeA?.status).toBe(TASK_STATUS.COMPLETED);
      expect(nodeA?.result).toEqual({ data: 123 });

      // Rehydrate a new resolver from snapshot
      const restored = DagLevelBatchResolver.fromSnapshot(dag, snapshot);
      expect(restored.getStatus("a")).toBe(TASK_STATUS.COMPLETED);
      expect(restored.getStatus("b")).toBe(TASK_STATUS.PENDING);
      expect(restored.getNode("a").result).toEqual({ data: 123 });

      // Resume execution on restored resolver
      restored.markInProgress("b");
      restored.markCompleted("b", { data: 456 });
      expect(restored.isComplete()).toBe(true);
      expect(restored.isSuccessful()).toBe(true);
    });

    it("rejects invalid snapshot schema version", () => {
      const dag = new DirectedAcyclicGraph();
      dag.addNode("a");
      const resolver = new DagLevelBatchResolver(dag);

      const invalidSnapshot: DagExecutionSnapshot = {
        schemaVersion: TEST_CONSTANTS.INVALID_SCHEMA_VERSION,
        timestamp: TEST_CONSTANTS.MOCK_SNAPSHOT_TIMESTAMP,
        totalTasks: 1,
        nodes: [],
        options: {
          maxConcurrentWorkers: 4,
          continueOnFailure: true,
          deterministicSort: true,
        },
      };

      expect(() => resolver.importSnapshot(invalidSnapshot)).toThrow(DagValidationError);
    });
  });

  describe("Automated Concurrent Execution Runner (executeConcurrent)", () => {
    it("executes DAG tasks concurrently respecting dependency order and collects results", async () => {
      const dag = new DirectedAcyclicGraph<string>();
      dag.addEdge("init", "step1");
      dag.addEdge("init", "step2");
      dag.addEdge("step1", "finalize");
      dag.addEdge("step2", "finalize");

      const resolver = new DagLevelBatchResolver(dag, { maxConcurrentWorkers: TEST_CONSTANTS.MAX_WORKERS_TWO });
      const executionLog: string[] = [];

      const result = await resolver.executeConcurrent(
        async (node: DagNode<string>) => {
          executionLog.push(`start:${node.id}`);
          await new Promise((resolve) => setTimeout(resolve, TEST_CONSTANTS.ASYNC_DELAY_MS));
          executionLog.push(`finish:${node.id}`);
          return `result-${node.id}`;
        },
        {
          onTaskStart: (node) => {
            expect(node.id).toBeDefined();
          },
          onTaskComplete: (node, res) => {
            expect(res).toBe(`result-${node.id}`);
          },
        }
      );

      expect(result.success).toBe(true);
      expect(result.totalTasks).toBe(TEST_CONSTANTS.FOUR_COUNT);
      expect(result.completedCount).toBe(TEST_CONSTANTS.FOUR_COUNT);
      expect(result.failedCount).toBe(TEST_CONSTANTS.EMPTY_COUNT);
      expect(result.results.get("init")).toBe("result-init");
      expect(result.results.get("finalize")).toBe("result-finalize");

      // Verify that init finishes before step1 and step2 start, and step1 and step2 finish before finalize starts
      const finishInitIndex = executionLog.indexOf("finish:init");
      const startStep1Index = executionLog.indexOf("start:step1");
      const startStep2Index = executionLog.indexOf("start:step2");
      const finishStep1Index = executionLog.indexOf("finish:step1");
      const finishStep2Index = executionLog.indexOf("finish:step2");
      const startFinalizeIndex = executionLog.indexOf("start:finalize");

      expect(finishInitIndex).toBeLessThan(startStep1Index);
      expect(finishInitIndex).toBeLessThan(startStep2Index);
      expect(finishStep1Index).toBeLessThan(startFinalizeIndex);
      expect(finishStep2Index).toBeLessThan(startFinalizeIndex);
    });

    it("continues on failure when continueOnFailure is true, allowing independent branches to finish", async () => {
      // Branch 1: rootA -> failTask -> blockedChild
      // Branch 2: rootB -> okTask
      const dag = new DirectedAcyclicGraph();
      dag.addEdge("rootA", "failTask");
      dag.addEdge("failTask", "blockedChild");
      dag.addEdge("rootB", "okTask");

      const resolver = new DagLevelBatchResolver(dag, {
        maxConcurrentWorkers: TEST_CONSTANTS.MAX_WORKERS_THREE,
        continueOnFailure: true,
      });

      const failedHookCalled: string[] = [];

      const result = await resolver.executeConcurrent(
        async (node) => {
          if (node.id === "failTask") {
            throw new Error("Simulated branch failure");
          }
          await new Promise((resolve) => setTimeout(resolve, TEST_CONSTANTS.ASYNC_DELAY_MS));
          return `done-${node.id}`;
        },
        {
          onTaskFailed: (node) => {
            failedHookCalled.push(node.id);
          },
        }
      );

      expect(result.success).toBe(false);
      expect(result.completedCount).toBe(TEST_CONSTANTS.THREE_COUNT); // rootA, rootB, okTask
      expect(result.failedCount).toBe(TEST_CONSTANTS.SINGLE_COUNT); // failTask
      expect(result.blockedCount).toBe(TEST_CONSTANTS.SINGLE_COUNT); // blockedChild
      expect(failedHookCalled).toEqual(["failTask"]);
      expect(result.errors.get("failTask")).toContain("Simulated branch failure");
      expect(result.results.get("okTask")).toBe("done-okTask");
    });

    it("halts execution when continueOnFailure is false upon first failure", async () => {
      const dag = new DirectedAcyclicGraph();
      dag.addNode("t1");
      dag.addNode("t2");

      const resolver = new DagLevelBatchResolver(dag, {
        maxConcurrentWorkers: TEST_CONSTANTS.SINGLE_COUNT,
        continueOnFailure: false,
      });

      const result = await resolver.executeConcurrent(
        async (node) => {
          if (node.id === "t1") {
            throw new Error("Critical stop");
          }
          return "ok";
        },
        { continueOnFailure: false }
      );

      expect(result.success).toBe(false);
      expect(result.failedCount).toBe(TEST_CONSTANTS.SINGLE_COUNT);
      expect(result.blockedCount).toBe(TEST_CONSTANTS.SINGLE_COUNT); // t2 was halted and blocked
      expect(resolver.getStatus("t2")).toBe(TASK_STATUS.BLOCKED);
    });
  });

  describe("Clean Architecture Aliases & Helper Functions", () => {
    it("exports compatible aliases TaskDAG, DAG, CyclicDependencyError, TaskDagResolver, LevelBatchResolver", () => {
      expect(TaskDAG).toBe(DirectedAcyclicGraph);
      expect(DAG).toBe(DirectedAcyclicGraph);
      expect(CyclicDependencyError).toBe(CircularDependencyError);
      expect(TaskDagResolver).toBe(DagLevelBatchResolver);
      expect(LevelBatchResolver).toBe(DagLevelBatchResolver);
      expect(DagBatchResolver).toBe(DagLevelBatchResolver);
    });

    it("creates resolver directly via createLevelBatchResolver functional helper", () => {
      const tasks: TaskDefinition[] = [{ id: "n1" }, { id: "n2", dependencies: ["n1"] }];
      const resolver = createLevelBatchResolver(tasks, { maxConcurrentWorkers: TEST_CONSTANTS.MAX_WORKERS_TWO });

      expect(resolver).toBeInstanceOf(DagLevelBatchResolver);
      expect(resolver.getDag().size).toBe(TEST_CONSTANTS.TWO_COUNT);
      expect(resolver.getOptions().maxConcurrentWorkers).toBe(TEST_CONSTANTS.MAX_WORKERS_TWO);
    });

    it("exports TASK_STATUS canonical constants matching architecture specifications", () => {
      expect(TASK_STATUS.PENDING).toBe("PENDING");
      expect(TASK_STATUS.IN_PROGRESS).toBe("IN_PROGRESS");
      expect(TASK_STATUS.BLOCKED).toBe("BLOCKED");
      expect(TASK_STATUS.COMPLETED).toBe("COMPLETED");
      expect(TASK_STATUS.FAILED).toBe("FAILED");
      expect(TASK_STATUS.SKIPPED).toBe("SKIPPED");
    });
  });
});
