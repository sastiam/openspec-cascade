/**
 * Directed Acyclic Graph (DAG) & Topological Scheduler Engine.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 6.1 (LOOPER-CORE-002) and
 * OpenSpec change proposal `looper-core-dag-scheduler`.
 *
 * Provides a strongly typed, deterministic Directed Acyclic Graph data structure
 * with Kahn's algorithm for topological sorting, cycle detection with actionable
 * circular dependency tracing, and level-batching resolution for concurrent execution.
 */

/**
 * Central constants ensuring zero magic numbers across DAG operations.
 */
export const DAG_CONSTANTS = {
  INITIAL_IN_DEGREE: 0,
  INITIAL_OUT_DEGREE: 0,
  ROOT_LEVEL: 0,
  LEVEL_INCREMENT: 1,
  DEGREE_DECREMENT: 1,
  DEGREE_INCREMENT: 1,
  EMPTY_COUNT: 0,
  FIRST_INDEX: 0,
  CYCLE_MIN_NODES: 1,
  NOT_FOUND_INDEX: -1,
  INDEX_OFFSET_ONE: 1,
  MIN_CYCLE_PATH_LENGTH: 2,
  MAX_CYCLES_SEARCH: 50,
  DEFAULT_MAX_CONCURRENT_WORKERS: 4,
  MIN_CONCURRENT_WORKERS: 1,
  SUB_BATCH_START_INDEX: 0,
  DEFAULT_SUB_BATCHES_TOTAL: 1,
  PERCENT_MULTIPLIER: 100,
  DEFAULT_PROGRESS_PERCENTAGE: 0,
  COMPLETE_PROGRESS_PERCENTAGE: 100,
  SNAPSHOT_SCHEMA_VERSION: 1,
} as const;

/**
 * Standardized error thrown when a circular dependency is detected in the DAG.
 * Carries actionable diagnostics including the ordered cycle path, participating nodes,
 * culprit edges, and concrete resolution hints.
 */
export class CircularDependencyError extends Error {
  readonly cycle: readonly string[];
  readonly cyclePath: string;
  readonly cycleNodes: readonly string[];
  readonly cycleEdges: readonly (readonly [string, string])[];
  readonly dependencyChain: readonly string[];
  readonly resolutionHint: string;

  constructor(cycle: readonly string[] = [], detail?: string) {
    const cycleStr = cycle.length > DAG_CONSTANTS.EMPTY_COUNT ? cycle.join(" -> ") : "unknown";

    // Extract unique nodes in order of appearance
    const uniqueNodes: string[] = [];
    const seenNodes = new Set<string>();
    for (const node of cycle) {
      if (!seenNodes.has(node)) {
        seenNodes.add(node);
        uniqueNodes.push(node);
      }
    }

    // Build culprit edges along the cycle path
    const edges: [string, string][] = [];
    if (cycle.length >= DAG_CONSTANTS.MIN_CYCLE_PATH_LENGTH) {
      for (let i = DAG_CONSTANTS.FIRST_INDEX; i < cycle.length - DAG_CONSTANTS.INDEX_OFFSET_ONE; i++) {
        const fromNode = cycle[i];
        const toNode = cycle[i + DAG_CONSTANTS.INDEX_OFFSET_ONE];
        if (fromNode !== undefined && toNode !== undefined) {
          edges.push([fromNode, toNode]);
        }
      }
    } else if (cycle.length === DAG_CONSTANTS.CYCLE_MIN_NODES) {
      const single = cycle[DAG_CONSTANTS.FIRST_INDEX];
      if (single !== undefined) {
        edges.push([single, single]);
      }
    }

    // Formulate human-readable dependency chain
    const chain: string[] = [];
    for (const [prereq, dependent] of edges) {
      if (prereq === dependent) {
        chain.push(`Task '${prereq}' depends on itself`);
      } else {
        chain.push(`Task '${dependent}' depends on prerequisite '${prereq}'`);
      }
    }

    // Formulate actionable resolution guidance
    let hint: string;
    const firstEdge = edges[DAG_CONSTANTS.FIRST_INDEX];
    if (cycle.length === DAG_CONSTANTS.EMPTY_COUNT) {
      hint = "Review task definitions to eliminate cyclic dependencies.";
    } else if (
      edges.length === DAG_CONSTANTS.CYCLE_MIN_NODES &&
      firstEdge !== undefined &&
      firstEdge[DAG_CONSTANTS.FIRST_INDEX] === firstEdge[DAG_CONSTANTS.INDEX_OFFSET_ONE]
    ) {
      const selfNode = firstEdge[DAG_CONSTANTS.FIRST_INDEX];
      hint = `Task '${selfNode}' has a self-dependency. Remove '${selfNode}' from its own prerequisite list to resolve.`;
    } else {
      const breakOptions = edges
        .map(([prereq, dependent]) => `  • Break dependency: Task '${dependent}' -> requires '${prereq}'`)
        .join("\n");
      hint = `To resolve this circular dependency, break at least one prerequisite relationship:\n${breakOptions}`;
    }

    const message = detail
      ? `[CircularDependencyError] ${detail} (Cycle: ${cycleStr})\nResolution: ${hint}`
      : `[CircularDependencyError] Detected circular dependency in task DAG: ${cycleStr}\nResolution: ${hint}`;

    super(message);
    this.name = "CircularDependencyError";
    this.cycle = Object.freeze([...cycle]);
    this.cyclePath = cycleStr;
    this.cycleNodes = Object.freeze(uniqueNodes);
    this.cycleEdges = Object.freeze(edges.map((edge) => Object.freeze([...edge]) as readonly [string, string]));
    this.dependencyChain = Object.freeze(chain);
    this.resolutionHint = hint;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Generates a comprehensive, human-readable diagnostic report for troubleshooting.
   */
  public toDetailedReport(): string {
    const lines: string[] = [
      "Circular Dependency Diagnostic Report",
      "=====================================",
      `Cycle Path:       ${this.cyclePath}`,
      `Culprit Nodes:    ${this.cycleNodes.join(", ")}`,
      "Participating Edges (Prerequisite -> Dependent):",
      ...this.cycleEdges.map(([from, to]) => `  - ${from} -> ${to}`),
      "Dependency Relationships:",
      ...this.dependencyChain.map((dep) => `  - ${dep}`),
      "Actionable Remediation:",
      `  ${this.resolutionHint}`,
    ];
    return lines.join("\n");
  }
}

/**
 * Error thrown when an operation targets a node identifier that does not exist.
 */
export class DagNodeNotFoundError extends Error {
  readonly nodeId: string;

  constructor(nodeId: string, operation?: string) {
    const context = operation ? ` during ${operation}` : "";
    super(`[DagNodeNotFoundError] Node '${nodeId}' does not exist in DAG${context}.`);
    this.name = "DagNodeNotFoundError";
    this.nodeId = nodeId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when invalid structural parameters are supplied to the DAG.
 */
export class DagValidationError extends Error {
  constructor(message: string) {
    super(`[DagValidationError] ${message}`);
    this.name = "DagValidationError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Normalized representation of a node within the Directed Acyclic Graph.
 */
export interface DagNode<T = unknown> {
  readonly id: string;
  readonly dependencies: readonly string[];
  readonly data?: T;
}

/**
 * External task definition schema acceptable by the DAG constructor and loaders.
 * Supports multiple property aliases for prerequisites (dependencies, dependsOn, prerequisites).
 */
export interface TaskDefinition<T = unknown> {
  readonly id: string;
  readonly dependencies?: readonly string[];
  readonly dependsOn?: readonly string[];
  readonly prerequisites?: readonly string[];
  readonly data?: T;
  readonly [key: string]: unknown;
}

/**
 * Structural result payload produced by topological sorting.
 */
export interface TopologicalSortResult<T = unknown> {
  readonly order: readonly string[];
  readonly nodes: readonly DagNode<T>[];
  readonly totalNodes: number;
}

/**
 * Represents a discrete level of tasks that can be scheduled concurrently.
 */
export interface DagLevelBatch<T = unknown> {
  readonly level: number;
  readonly taskIds: readonly string[];
  readonly nodes: readonly DagNode<T>[];
  readonly subBatchIndex?: number;
  readonly totalSubBatches?: number;
}

/**
 * Options for level batching resolution.
 */
export interface LevelBatchOptions {
  /**
   * Maximum concurrent workers per batch. If provided and greater than 0,
   * levels containing more tasks than maxConcurrentWorkers are partitioned into sub-batches.
   */
  readonly maxConcurrentWorkers?: number;

  /**
   * When true, preserves deterministic alphabetical sorting within batches.
   * Default: true.
   */
  readonly deterministicSort?: boolean;
}

/**
 * Canonical task execution states for DAG parallel scheduling.
 */
export const TASK_STATUS = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  BLOCKED: "BLOCKED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

/**
 * Standardized error thrown when task execution or state transition fails within the resolver.
 */
export class DagExecutionError extends Error {
  readonly taskId?: string;
  readonly currentStatus?: TaskStatus;

  constructor(message: string, taskId?: string, currentStatus?: TaskStatus) {
    super(`[DagExecutionError] ${message}${taskId ? ` (Task: '${taskId}')` : ""}`);
    this.name = "DagExecutionError";
    this.taskId = taskId;
    this.currentStatus = currentStatus;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Immutable snapshot record of an individual task node's execution state.
 */
export interface TaskExecutionNode<T = unknown> {
  readonly id: string;
  readonly status: TaskStatus;
  readonly level: number;
  readonly dependencies: readonly string[];
  readonly dependents: readonly string[];
  readonly data?: T;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly error?: string;
  readonly result?: unknown;
}

/**
 * Options configuring the DagLevelBatchResolver.
 */
export interface ResolverOptions {
  /**
   * Maximum tasks that can be scheduled or dispatched concurrently.
   * Default: 4.
   */
  readonly maxConcurrentWorkers?: number;

  /**
   * When true, failures in one branch do not halt execution of independent branches.
   * Default: true.
   */
  readonly continueOnFailure?: boolean;

  /**
   * When true, sorts batches and executable tasks deterministically.
   * Default: true.
   */
  readonly deterministicSort?: boolean;
}

/**
 * Summary metrics of DAG execution progress.
 */
export interface DagExecutionSummary {
  readonly totalTasks: number;
  readonly pendingCount: number;
  readonly inProgressCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly blockedCount: number;
  readonly skippedCount: number;
  readonly isComplete: boolean;
  readonly isSuccessful: boolean;
  readonly progressPercentage: number;
}

/**
 * Snapshot representation of DAG execution state for persistence and recovery.
 */
export interface DagExecutionSnapshot<T = unknown> {
  readonly schemaVersion: number;
  readonly timestamp: number;
  readonly totalTasks: number;
  readonly nodes: readonly TaskExecutionNode<T>[];
  readonly options: Required<ResolverOptions>;
}

/**
 * Options for automated concurrent execution runner.
 */
export interface ExecuteConcurrentOptions<T = unknown> {
  readonly maxConcurrentWorkers?: number;
  readonly continueOnFailure?: boolean;
  readonly onTaskStart?: (node: DagNode<T>) => void | Promise<void>;
  readonly onTaskComplete?: (node: DagNode<T>, result: unknown) => void | Promise<void>;
  readonly onTaskFailed?: (node: DagNode<T>, error: unknown) => void | Promise<void>;
}

/**
 * Final result produced by concurrent execution runner.
 */
export interface DagExecutionResult<R = unknown> {
  readonly success: boolean;
  readonly totalTasks: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly blockedCount: number;
  readonly skippedCount: number;
  readonly results: ReadonlyMap<string, R>;
  readonly errors: ReadonlyMap<string, string>;
  readonly durationMs: number;
  readonly summary: DagExecutionSummary;
}

/**
 * Configuration options for DirectedAcyclicGraph behavior.
 */
export interface DirectedAcyclicGraphOptions {
  /**
   * When true, adding dependencies or edges to un-registered node IDs
   * automatically creates placeholder nodes instead of throwing DagNodeNotFoundError.
   * Default: true.
   */
  readonly autoCreateNodes?: boolean;

  /**
   * When true, sorting ties among nodes of equal in-degree are resolved
   * deterministically using alphabetical ID order.
   * Default: true.
   */
  readonly deterministicSort?: boolean;

  /**
   * When true, asserts the graph is acyclic upon construction or loading.
   * Throws CircularDependencyError immediately if a cycle is present.
   * Default: false.
   */
  readonly validateAcyclic?: boolean;
}

/**
 * Three-color DFS traversal state for cycle detection.
 */
const enum DfsState {
  UNVISITED = 0,
  VISITING = 1,
  VISITED = 2,
}

/**
 * Directed Acyclic Graph (DAG) for task dependency scheduling and topological sorting.
 */
export class DirectedAcyclicGraph<T = unknown> {
  private readonly nodesMap: Map<string, { data?: T }> = new Map();
  private readonly adjacencyMap: Map<string, Set<string>> = new Map(); // prerequisite -> dependents (outward)
  private readonly prerequisitesMap: Map<string, Set<string>> = new Map(); // dependent -> prerequisites (inward)
  private readonly options: Required<DirectedAcyclicGraphOptions>;

  constructor(
    tasksOrNodes?: Iterable<TaskDefinition<T> | DagNode<T>>,
    options?: DirectedAcyclicGraphOptions
  ) {
    this.options = {
      autoCreateNodes: options?.autoCreateNodes ?? true,
      deterministicSort: options?.deterministicSort ?? true,
      validateAcyclic: options?.validateAcyclic ?? false,
    };

    if (tasksOrNodes) {
      for (const item of tasksOrNodes) {
        this.addFromTaskDefinition(item);
      }
    }

    if (this.options.validateAcyclic) {
      this.assertAcyclic();
    }
  }

  /**
   * Total number of registered nodes in the graph.
   */
  public get size(): number {
    return this.nodesMap.size;
  }

  /**
   * Checks whether a node exists by ID.
   */
  public hasNode(id: string): boolean {
    return this.nodesMap.has(id);
  }

  /**
   * Adds or updates a node with optional payload data and explicit prerequisite dependencies.
   */
  public addNode(
    id: string,
    data?: T,
    dependencies?: readonly string[]
  ): this {
    if (!id || typeof id !== "string") {
      throw new DagValidationError("Node ID must be a non-empty string.");
    }

    if (!this.nodesMap.has(id)) {
      this.nodesMap.set(id, { data });
      this.adjacencyMap.set(id, new Set());
      this.prerequisitesMap.set(id, new Set());
    } else if (data !== undefined) {
      const existing = this.nodesMap.get(id);
      if (existing) {
        existing.data = data;
      }
    }

    if (dependencies && dependencies.length > DAG_CONSTANTS.EMPTY_COUNT) {
      for (const depId of dependencies) {
        this.addDependency(id, depId);
      }
    }

    return this;
  }

  /**
   * Removes a node and all incoming/outgoing edges.
   * Returns true if the node was found and removed, false otherwise.
   */
  public removeNode(id: string): boolean {
    if (!this.nodesMap.has(id)) {
      return false;
    }

    // Remove outgoing edges (where id is a prerequisite)
    const dependents = this.adjacencyMap.get(id);
    if (dependents) {
      for (const dependentId of dependents) {
        const depPrereqs = this.prerequisitesMap.get(dependentId);
        if (depPrereqs) {
          depPrereqs.delete(id);
        }
      }
    }

    // Remove incoming edges (where id is dependent)
    const prerequisites = this.prerequisitesMap.get(id);
    if (prerequisites) {
      for (const prereqId of prerequisites) {
        const prereqAdjacency = this.adjacencyMap.get(prereqId);
        if (prereqAdjacency) {
          prereqAdjacency.delete(id);
        }
      }
    }

    this.adjacencyMap.delete(id);
    this.prerequisitesMap.delete(id);
    this.nodesMap.delete(id);

    return true;
  }

  /**
   * Retrieves a node by ID, returning undefined if not found.
   */
  public getNode(id: string): DagNode<T> | undefined {
    const entry = this.nodesMap.get(id);
    if (!entry) {
      return undefined;
    }
    const prerequisites = this.prerequisitesMap.get(id);
    const deps = prerequisites ? Array.from(prerequisites) : [];
    if (this.options.deterministicSort) {
      deps.sort();
    }
    return {
      id,
      dependencies: Object.freeze(deps),
      data: entry.data,
    };
  }

  /**
   * Retrieves a node by ID, throwing DagNodeNotFoundError if absent.
   */
  public requireNode(id: string): DagNode<T> {
    const node = this.getNode(id);
    if (!node) {
      throw new DagNodeNotFoundError(id, "requireNode");
    }
    return node;
  }

  /**
   * Retrieves all registered node IDs.
   */
  public getNodeIds(): string[] {
    const ids = Array.from(this.nodesMap.keys());
    if (this.options.deterministicSort) {
      ids.sort();
    }
    return ids;
  }

  /**
   * Retrieves all registered nodes as DagNode objects.
   */
  public getNodes(): DagNode<T>[] {
    const ids = this.getNodeIds();
    return ids.map((id) => this.getNode(id)!);
  }

  /**
   * Retrieves the payload data associated with a node.
   */
  public getData(id: string): T | undefined {
    return this.nodesMap.get(id)?.data;
  }

  /**
   * Updates the payload data associated with a node.
   */
  public setData(id: string, data: T | undefined): this {
    const entry = this.nodesMap.get(id);
    if (!entry) {
      if (this.options.autoCreateNodes) {
        this.addNode(id, data);
        return this;
      }
      throw new DagNodeNotFoundError(id, "setData");
    }
    entry.data = data;
    return this;
  }

  /**
   * Adds a directed edge from prerequisite to dependent (prerequisite -> dependent).
   * Semantics: `from` must be executed/resolved before `to` can execute.
   * When `options.checkCycles` is true, verifies that the new edge does not introduce
   * a cycle before mutating the graph, throwing CircularDependencyError if a cycle forms.
   */
  public addEdge(
    from: string,
    to: string,
    options?: { readonly checkCycles?: boolean }
  ): this {
    if (!from || typeof from !== "string") {
      throw new DagValidationError("Prerequisite node ID must be a non-empty string.");
    }
    if (!to || typeof to !== "string") {
      throw new DagValidationError("Dependent node ID must be a non-empty string.");
    }

    if (!this.nodesMap.has(from)) {
      if (this.options.autoCreateNodes) {
        this.addNode(from);
      } else {
        throw new DagNodeNotFoundError(from, "addEdge (prerequisite)");
      }
    }

    if (!this.nodesMap.has(to)) {
      if (this.options.autoCreateNodes) {
        this.addNode(to);
      } else {
        throw new DagNodeNotFoundError(to, "addEdge (dependent)");
      }
    }

    if (options?.checkCycles && this.wouldCreateCycle(from, to)) {
      const potential = this.getPotentialCycle(from, to) ?? [from, to, from];
      throw new CircularDependencyError(
        potential,
        `Cannot add edge '${from}' -> '${to}': edge would introduce a circular dependency.`
      );
    }

    this.adjacencyMap.get(from)!.add(to);
    this.prerequisitesMap.get(to)!.add(from);

    return this;
  }

  /**
   * Declarative helper: specifies that `dependentId` requires `prerequisiteId`.
   * Equivalent to `addEdge(prerequisiteId, dependentId, options)`.
   * When `options.checkCycles` is true, verifies that the dependency does not introduce
   * a cycle before mutating the graph, throwing CircularDependencyError if a cycle forms.
   */
  public addDependency(
    dependentId: string,
    prerequisiteId: string,
    options?: { readonly checkCycles?: boolean }
  ): this {
    return this.addEdge(prerequisiteId, dependentId, options);
  }

  /**
   * Checks whether a directed edge from `from` to `to` exists.
   */
  public hasEdge(from: string, to: string): boolean {
    const dependents = this.adjacencyMap.get(from);
    return dependents !== undefined && dependents.has(to);
  }

  /**
   * Removes a directed edge from `from` to `to`.
   */
  public removeEdge(from: string, to: string): boolean {
    const dependents = this.adjacencyMap.get(from);
    const prereqs = this.prerequisitesMap.get(to);

    let removed = false;
    if (dependents && dependents.has(to)) {
      dependents.delete(to);
      removed = true;
    }
    if (prereqs && prereqs.has(from)) {
      prereqs.delete(from);
      removed = true;
    }

    return removed;
  }

  /**
   * Returns all direct prerequisites (dependencies) that must execute before `id`.
   */
  public getDependencies(id: string): string[] {
    const prereqs = this.prerequisitesMap.get(id);
    if (!prereqs) {
      if (!this.nodesMap.has(id)) {
        throw new DagNodeNotFoundError(id, "getDependencies");
      }
      return [];
    }
    const list = Array.from(prereqs);
    if (this.options.deterministicSort) {
      list.sort();
    }
    return list;
  }

  /**
   * Returns all direct dependents that depend on `id`.
   */
  public getDependents(id: string): string[] {
    const dependents = this.adjacencyMap.get(id);
    if (!dependents) {
      if (!this.nodesMap.has(id)) {
        throw new DagNodeNotFoundError(id, "getDependents");
      }
      return [];
    }
    const list = Array.from(dependents);
    if (this.options.deterministicSort) {
      list.sort();
    }
    return list;
  }

  /**
   * In-degree represents the count of prerequisite dependencies for a node.
   */
  public getInDegree(id: string): number {
    const prereqs = this.prerequisitesMap.get(id);
    if (!prereqs) {
      if (!this.nodesMap.has(id)) {
        throw new DagNodeNotFoundError(id, "getInDegree");
      }
      return DAG_CONSTANTS.INITIAL_IN_DEGREE;
    }
    return prereqs.size;
  }

  /**
   * Out-degree represents the count of dependents relying on a node.
   */
  public getOutDegree(id: string): number {
    const dependents = this.adjacencyMap.get(id);
    if (!dependents) {
      if (!this.nodesMap.has(id)) {
        throw new DagNodeNotFoundError(id, "getOutDegree");
      }
      return DAG_CONSTANTS.INITIAL_OUT_DEGREE;
    }
    return dependents.size;
  }

  /**
   * Returns root nodes (nodes with 0 prerequisites / in-degree 0).
   */
  public getRoots(): string[] {
    const roots: string[] = [];
    for (const [id, prereqs] of this.prerequisitesMap.entries()) {
      if (prereqs.size === DAG_CONSTANTS.INITIAL_IN_DEGREE) {
        roots.push(id);
      }
    }
    if (this.options.deterministicSort) {
      roots.sort();
    }
    return roots;
  }

  /**
   * Returns leaf nodes (nodes with 0 dependents / out-degree 0).
   */
  public getLeaves(): string[] {
    const leaves: string[] = [];
    for (const [id, dependents] of this.adjacencyMap.entries()) {
      if (dependents.size === DAG_CONSTANTS.INITIAL_OUT_DEGREE) {
        leaves.push(id);
      }
    }
    if (this.options.deterministicSort) {
      leaves.sort();
    }
    return leaves;
  }

  /**
   * Checks whether a directed path exists from `from` node to `to` node.
   */
  public hasPath(from: string, to: string): boolean {
    if (!this.nodesMap.has(from) || !this.nodesMap.has(to)) {
      return false;
    }
    if (from === to) {
      return true;
    }

    const visited = new Set<string>();
    const queue: string[] = [from];
    visited.add(from);

    while (queue.length > DAG_CONSTANTS.EMPTY_COUNT) {
      const current = queue.shift()!;
      const dependents = this.getDependents(current);
      for (const next of dependents) {
        if (next === to) {
          return true;
        }
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    return false;
  }

  /**
   * Finds the shortest directed path from `from` node to `to` node using BFS.
   * Returns an array of node IDs representing the path, or null if unreachable.
   */
  public getPath(from: string, to: string): string[] | null {
    if (!this.nodesMap.has(from) || !this.nodesMap.has(to)) {
      return null;
    }
    if (from === to) {
      return [from];
    }

    const visited = new Set<string>([from]);
    const parentMap = new Map<string, string>();
    const queue: string[] = [from];

    while (queue.length > DAG_CONSTANTS.EMPTY_COUNT) {
      const current = queue.shift()!;
      if (current === to) {
        const path: string[] = [];
        let curr: string | undefined = to;
        while (curr !== undefined) {
          path.unshift(curr);
          curr = parentMap.get(curr);
        }
        return path;
      }

      const dependents = this.getDependents(current);
      for (const next of dependents) {
        if (!visited.has(next)) {
          visited.add(next);
          parentMap.set(next, current);
          queue.push(next);
        }
      }
    }

    return null;
  }

  /**
   * Evaluates whether adding a directed edge from `from` to `to` would introduce a cycle.
   */
  public wouldCreateCycle(from: string, to: string): boolean {
    if (from === to) {
      return true;
    }
    return this.hasPath(to, from);
  }

  /**
   * Predicts the exact cycle path that would be created if an edge from `from` to `to` were added.
   * Returns null if no cycle would be introduced.
   */
  public getPotentialCycle(from: string, to: string): string[] | null {
    if (from === to) {
      return [from, from];
    }
    const path = this.getPath(to, from);
    if (!path) {
      return null;
    }
    const potential = [from, ...path];
    return this.normalizeCycle(potential);
  }

  /**
   * Normalizes a cycle path by rotating it so that the lexicographically smallest node
   * appears at the start and end of the cycle array.
   */
  private normalizeCycle(cycle: readonly string[]): string[] {
    if (cycle.length <= DAG_CONSTANTS.MIN_CYCLE_PATH_LENGTH) {
      return [...cycle];
    }
    const nodes = cycle.slice(DAG_CONSTANTS.FIRST_INDEX, cycle.length - DAG_CONSTANTS.INDEX_OFFSET_ONE);
    let minIndex: number = DAG_CONSTANTS.FIRST_INDEX;
    const firstNode = nodes[DAG_CONSTANTS.FIRST_INDEX];
    if (firstNode === undefined) {
      return [...cycle];
    }
    let minVal = firstNode;
    for (let i = DAG_CONSTANTS.INDEX_OFFSET_ONE; i < nodes.length; i++) {
      const curr = nodes[i];
      if (curr !== undefined && curr < minVal) {
        minIndex = i;
        minVal = curr;
      }
    }
    if (minIndex === DAG_CONSTANTS.FIRST_INDEX) {
      return [...cycle];
    }
    const rotated = [
      ...nodes.slice(minIndex),
      ...nodes.slice(DAG_CONSTANTS.FIRST_INDEX, minIndex),
    ];
    const rotatedFirst = rotated[DAG_CONSTANTS.FIRST_INDEX];
    if (rotatedFirst !== undefined) {
      rotated.push(rotatedFirst);
    }
    return rotated;
  }

  /**
   * Detects whether the graph contains any cycle.
   */
  public hasCycle(): boolean {
    return this.findCycle() !== null;
  }

  /**
   * Discovers all distinct elementary cycles in the graph up to DAG_CONSTANTS.MAX_CYCLES_SEARCH.
   * Returns an array of normalized cycle paths.
   */
  public findCycles(): string[][] {
    const cycles: string[][] = [];
    const seenSignatures = new Set<string>();
    const nodeIds = this.getNodeIds();

    const visitedInDfs = new Set<string>();
    const pathStack: string[] = [];

    const dfs = (currentId: string): void => {
      if (cycles.length >= DAG_CONSTANTS.MAX_CYCLES_SEARCH) {
        return;
      }

      visitedInDfs.add(currentId);
      pathStack.push(currentId);

      const dependents = this.getDependents(currentId);
      for (const nextId of dependents) {
        if (cycles.length >= DAG_CONSTANTS.MAX_CYCLES_SEARCH) {
          break;
        }

        const startIndex = pathStack.indexOf(nextId);
        if (startIndex !== DAG_CONSTANTS.NOT_FOUND_INDEX) {
          const rawCycle = pathStack.slice(startIndex);
          rawCycle.push(nextId);
          const normalized = this.normalizeCycle(rawCycle);
          const sig = normalized.join(" -> ");
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            cycles.push(normalized);
          }
        } else if (!visitedInDfs.has(nextId)) {
          dfs(nextId);
        }
      }

      pathStack.pop();
      visitedInDfs.delete(currentId);
    };

    for (const id of nodeIds) {
      if (cycles.length >= DAG_CONSTANTS.MAX_CYCLES_SEARCH) {
        break;
      }
      dfs(id);
    }

    if (this.options.deterministicSort) {
      cycles.sort((a, b) => a.join(" -> ").localeCompare(b.join(" -> ")));
    }

    return cycles;
  }

  /**
   * Performs cycle detection using Depth-First Search with path tracking.
   * If a cycle exists, returns the normalized ordered cycle path (e.g. ['A', 'B', 'C', 'A']).
   * If the graph is acyclic, returns null.
   */
  public findCycle(): string[] | null {
    const state = new Map<string, DfsState>();
    const nodeIds = this.getNodeIds();

    for (const id of nodeIds) {
      state.set(id, DfsState.UNVISITED);
    }

    const pathStack: string[] = [];

    const dfs = (currentId: string): string[] | null => {
      state.set(currentId, DfsState.VISITING);
      pathStack.push(currentId);

      const dependents = this.getDependents(currentId);
      for (const nextId of dependents) {
        const nextState = state.get(nextId) ?? DfsState.UNVISITED;

        if (nextState === DfsState.VISITING) {
          // Cycle found! Reconstruct the cycle from pathStack
          const startIndex = pathStack.indexOf(nextId);
          if (startIndex !== DAG_CONSTANTS.NOT_FOUND_INDEX) {
            const cyclePath = pathStack.slice(startIndex);
            cyclePath.push(nextId);
            return this.normalizeCycle(cyclePath);
          }
          return [nextId, nextId];
        }

        if (nextState === DfsState.UNVISITED) {
          const detected = dfs(nextId);
          if (detected) {
            return detected;
          }
        }
      }

      pathStack.pop();
      state.set(currentId, DfsState.VISITED);
      return null;
    };

    for (const id of nodeIds) {
      if (state.get(id) === DfsState.UNVISITED) {
        const cycle = dfs(id);
        if (cycle) {
          return cycle;
        }
      }
    }

    return null;
  }

  /**
   * Asserts that the graph is acyclic.
   * Throws actionable CircularDependencyError if any cycle is detected.
   */
  public assertAcyclic(): void {
    const cycle = this.findCycle();
    if (cycle && cycle.length >= DAG_CONSTANTS.CYCLE_MIN_NODES) {
      throw new CircularDependencyError(cycle);
    }
  }

  /**
   * Alias for assertAcyclic adhering to standard validator naming.
   */
  public validateAcyclic(): void {
    this.assertAcyclic();
  }

  /**
   * Generates a formatted diagnostic cycle report for the graph.
   * Returns null if the graph is acyclic.
   */
  public getCycleReport(): string | null {
    const cycle = this.findCycle();
    if (!cycle) {
      return null;
    }
    const err = new CircularDependencyError(cycle);
    return err.toDetailedReport();
  }

  /**
   * Computes the deterministic topological order of task definitions using Kahn's algorithm.
   * Ensures prerequisites precede all dependent tasks.
   * Throws CircularDependencyError if any cycle exists.
   */
  public topologicalSort(): string[] {
    const inDegreeMap = new Map<string, number>();
    for (const [id, prereqs] of this.prerequisitesMap.entries()) {
      inDegreeMap.set(id, prereqs.size);
    }

    const queue: string[] = [];
    for (const [id, inDegree] of inDegreeMap.entries()) {
      if (inDegree === DAG_CONSTANTS.INITIAL_IN_DEGREE) {
        queue.push(id);
      }
    }

    if (this.options.deterministicSort) {
      queue.sort();
    }

    const order: string[] = [];

    while (queue.length > DAG_CONSTANTS.EMPTY_COUNT) {
      const current = queue.shift()!;
      order.push(current);

      const dependents = this.getDependents(current);
      const readyNext: string[] = [];

      for (const dependent of dependents) {
        const remaining = (inDegreeMap.get(dependent) ?? DAG_CONSTANTS.INITIAL_IN_DEGREE) - DAG_CONSTANTS.DEGREE_DECREMENT;
        inDegreeMap.set(dependent, remaining);

        if (remaining === DAG_CONSTANTS.INITIAL_IN_DEGREE) {
          readyNext.push(dependent);
        }
      }

      if (readyNext.length > DAG_CONSTANTS.EMPTY_COUNT) {
        if (this.options.deterministicSort) {
          readyNext.sort();
        }
        for (const item of readyNext) {
          queue.push(item);
        }
        if (this.options.deterministicSort) {
          queue.sort();
        }
      }
    }

    if (order.length !== this.nodesMap.size) {
      this.assertAcyclic();
      throw new CircularDependencyError(
        [],
        `Cycle detected: ${this.nodesMap.size - order.length} unreachable task(s).`
      );
    }

    return order;
  }

  /**
   * Computes topological order returning rich DagNode objects.
   */
  public topologicalSortNodes(): DagNode<T>[] {
    const order = this.topologicalSort();
    return order.map((id) => this.getNode(id)!);
  }

  /**
   * Computes topological order along with metadata.
   */
  public getTopologicalSort(): TopologicalSortResult<T> {
    const order = this.topologicalSort();
    const nodes = order.map((id) => this.getNode(id)!);
    return {
      order: Object.freeze(order),
      nodes: Object.freeze(nodes),
      totalNodes: nodes.length,
    };
  }

  /**
   * Computes level batches for parallel task execution.
   * Tasks in Level 0 have zero dependencies. Tasks in Level N depend only on Level < N.
   * When options.maxConcurrentWorkers is specified, large levels are partitioned into sub-batches.
   */
  public getBatches(options?: LevelBatchOptions): DagLevelBatch<T>[] {
    const inDegreeMap = new Map<string, number>();
    for (const [id, prereqs] of this.prerequisitesMap.entries()) {
      inDegreeMap.set(id, prereqs.size);
    }

    let currentBatch: string[] = [];
    for (const [id, inDegree] of inDegreeMap.entries()) {
      if (inDegree === DAG_CONSTANTS.INITIAL_IN_DEGREE) {
        currentBatch.push(id);
      }
    }

    const deterministic = options?.deterministicSort ?? this.options.deterministicSort;
    if (deterministic) {
      currentBatch.sort();
    }

    const batches: DagLevelBatch<T>[] = [];
    let currentLevel = DAG_CONSTANTS.ROOT_LEVEL;
    let processedCount = DAG_CONSTANTS.EMPTY_COUNT;
    const maxWorkers = options?.maxConcurrentWorkers;

    while (currentBatch.length > DAG_CONSTANTS.EMPTY_COUNT) {
      if (
        maxWorkers !== undefined &&
        maxWorkers > DAG_CONSTANTS.EMPTY_COUNT &&
        currentBatch.length > maxWorkers
      ) {
        const totalSubBatches = Math.ceil(currentBatch.length / maxWorkers);
        for (let subIndex = DAG_CONSTANTS.SUB_BATCH_START_INDEX; subIndex < totalSubBatches; subIndex++) {
          const start = subIndex * maxWorkers;
          const chunk = currentBatch.slice(start, start + maxWorkers);
          const chunkNodes = chunk.map((id) => this.getNode(id)!);
          batches.push({
            level: currentLevel,
            taskIds: Object.freeze([...chunk]),
            nodes: Object.freeze(chunkNodes),
            subBatchIndex: subIndex,
            totalSubBatches,
          });
        }
      } else {
        const levelNodes = currentBatch.map((id) => this.getNode(id)!);
        batches.push({
          level: currentLevel,
          taskIds: Object.freeze([...currentBatch]),
          nodes: Object.freeze(levelNodes),
          subBatchIndex: DAG_CONSTANTS.SUB_BATCH_START_INDEX,
          totalSubBatches: DAG_CONSTANTS.DEFAULT_SUB_BATCHES_TOTAL,
        });
      }

      processedCount += currentBatch.length;
      const nextBatch: string[] = [];

      for (const current of currentBatch) {
        const dependents = this.getDependents(current);
        for (const dependent of dependents) {
          const remaining = (inDegreeMap.get(dependent) ?? DAG_CONSTANTS.INITIAL_IN_DEGREE) - DAG_CONSTANTS.DEGREE_DECREMENT;
          inDegreeMap.set(dependent, remaining);
          if (remaining === DAG_CONSTANTS.INITIAL_IN_DEGREE) {
            nextBatch.push(dependent);
          }
        }
      }

      if (deterministic) {
        nextBatch.sort();
      }

      currentBatch = nextBatch;
      currentLevel += DAG_CONSTANTS.LEVEL_INCREMENT;
    }

    if (processedCount !== this.nodesMap.size) {
      this.assertAcyclic();
      throw new CircularDependencyError([], "Cycle detected during level batching.");
    }

    return batches;
  }

  /**
   * Helper returning discrete batches as arrays of node ID strings.
   */
  public resolveLevels(options?: LevelBatchOptions): string[][] {
    return this.getBatches(options).map((batch) => [...batch.taskIds]);
  }

  /**
   * Instantiates a dedicated level-batching resolver for orchestrating parallel execution.
   */
  public createResolver(options?: ResolverOptions): DagLevelBatchResolver<T> {
    return new DagLevelBatchResolver<T>(this, options);
  }

  /**
   * Checks whether a task is executable given a set of completed task IDs.
   * Returns true if all prerequisites of `id` are in `completedIds`.
   */
  public isExecutable(id: string, completedIds: Iterable<string>): boolean {
    if (!this.nodesMap.has(id)) {
      throw new DagNodeNotFoundError(id, "isExecutable");
    }
    const completedSet = completedIds instanceof Set ? completedIds : new Set(completedIds);
    if (completedSet.has(id)) {
      return false; // Already completed
    }
    const prerequisites = this.prerequisitesMap.get(id);
    if (!prerequisites || prerequisites.size === DAG_CONSTANTS.INITIAL_IN_DEGREE) {
      return true;
    }
    for (const prereq of prerequisites) {
      if (!completedSet.has(prereq)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns all tasks eligible for immediate execution given already completed task IDs.
   */
  public getExecutableTasks(completedIds: Iterable<string>): string[] {
    const completedSet = completedIds instanceof Set ? completedIds : new Set(completedIds);
    const executable: string[] = [];

    for (const id of this.getNodeIds()) {
      if (!completedSet.has(id) && this.isExecutable(id, completedSet)) {
        executable.push(id);
      }
    }

    if (this.options.deterministicSort) {
      executable.sort();
    }

    return executable;
  }

  /**
   * Creates an independent deep clone of the graph.
   */
  public clone(): DirectedAcyclicGraph<T> {
    const cloned = new DirectedAcyclicGraph<T>(undefined, this.options);
    for (const [id, entry] of this.nodesMap.entries()) {
      cloned.addNode(id, entry.data);
    }
    for (const [prereq, dependents] of this.adjacencyMap.entries()) {
      for (const dep of dependents) {
        cloned.addEdge(prereq, dep);
      }
    }
    return cloned;
  }

  /**
   * Internal helper parsing a task definition object into the DAG.
   */
  private addFromTaskDefinition(item: TaskDefinition<T> | DagNode<T>): void {
    if (!item || typeof item.id !== "string") {
      throw new DagValidationError("Task item must have a valid string 'id'.");
    }

    const prereqs: string[] = [];

    const rawDeps =
      item.dependencies ??
      (item as TaskDefinition<T>).dependsOn ??
      (item as TaskDefinition<T>).prerequisites;

    if (Array.isArray(rawDeps)) {
      for (const d of rawDeps) {
        if (typeof d === "string" && d.trim().length > DAG_CONSTANTS.EMPTY_COUNT) {
          prereqs.push(d.trim());
        }
      }
    }

    this.addNode(item.id, item.data, prereqs);
  }

  /**
   * Static factory method to instantiate a DAG from a collection of tasks.
   */
  public static fromTasks<T = unknown>(
    tasks: Iterable<TaskDefinition<T> | DagNode<T>>,
    options?: DirectedAcyclicGraphOptions
  ): DirectedAcyclicGraph<T> {
    return new DirectedAcyclicGraph<T>(tasks, options);
  }
}

/**
 * Functional helper for one-shot topological sorting of tasks.
 */
export function topologicalSort<T = unknown>(
  tasks: Iterable<TaskDefinition<T> | DagNode<T>>,
  options?: DirectedAcyclicGraphOptions
): string[] {
  const dag = DirectedAcyclicGraph.fromTasks(tasks, options);
  return dag.topologicalSort();
}

/**
 * Functional helper to check if a collection of task definitions contains any cycles.
 * Returns true if a circular dependency exists, false otherwise.
 */
export function hasCycle<T = unknown>(
  tasks: Iterable<TaskDefinition<T> | DagNode<T>>,
  options?: DirectedAcyclicGraphOptions
): boolean {
  const dag = DirectedAcyclicGraph.fromTasks(tasks, options);
  return dag.hasCycle();
}

/**
 * Functional helper to find and return the first circular dependency path if present.
 * Returns the normalized cycle path (e.g. ['A', 'B', 'A']) or null if acyclic.
 */
export function findCycle<T = unknown>(
  tasks: Iterable<TaskDefinition<T> | DagNode<T>>,
  options?: DirectedAcyclicGraphOptions
): string[] | null {
  const dag = DirectedAcyclicGraph.fromTasks(tasks, options);
  return dag.findCycle();
}

/**
 * Functional helper to discover all circular dependency paths in a task collection.
 */
export function findCycles<T = unknown>(
  tasks: Iterable<TaskDefinition<T> | DagNode<T>>,
  options?: DirectedAcyclicGraphOptions
): string[][] {
  const dag = DirectedAcyclicGraph.fromTasks(tasks, options);
  return dag.findCycles();
}

/**
 * Functional helper to assert that task definitions form a valid acyclic graph.
 * Throws actionable CircularDependencyError if any cycle exists.
 */
export function assertAcyclic<T = unknown>(
  tasks: Iterable<TaskDefinition<T> | DagNode<T>>,
  options?: DirectedAcyclicGraphOptions
): void {
  const dag = DirectedAcyclicGraph.fromTasks(tasks, options);
  dag.assertAcyclic();
}

/**
 * Internal mutable tracking state for a node in the resolver.
 */
interface MutableNodeExecutionState {
  status: TaskStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  result?: unknown;
}

/**
 * Level-batching resolver orchestrating parallel and concurrent DAG task execution.
 *
 * Implements:
 * - Topological level batching with configurable worker concurrency limits (`maxConcurrentWorkers`).
 * - Per-node status tracking across canonical states (`PENDING`, `IN_PROGRESS`, `BLOCKED`, `COMPLETED`, `FAILED`, `SKIPPED`).
 * - Automatic cascading failure propagation to downstream dependents.
 * - Dynamic executable batch dispatch respecting prerequisite resolution and in-flight slots.
 * - Serializable execution snapshots for persistent checkpointing, idempotence, and crash recovery.
 * - Automated concurrent runner with lifecycle hooks and graceful failure handling.
 */
export class DagLevelBatchResolver<T = unknown> {
  private readonly dag: DirectedAcyclicGraph<T>;
  private readonly options: Required<ResolverOptions>;
  private readonly nodeStateMap: Map<string, MutableNodeExecutionState> = new Map();
  private readonly nodeLevels: Map<string, number> = new Map();

  constructor(
    dag: DirectedAcyclicGraph<T>,
    options?: ResolverOptions
  ) {
    this.dag = dag;
    this.dag.assertAcyclic();

    this.options = {
      maxConcurrentWorkers: options?.maxConcurrentWorkers ?? DAG_CONSTANTS.DEFAULT_MAX_CONCURRENT_WORKERS,
      continueOnFailure: options?.continueOnFailure ?? true,
      deterministicSort: options?.deterministicSort ?? true,
    };

    if (this.options.maxConcurrentWorkers < DAG_CONSTANTS.MIN_CONCURRENT_WORKERS) {
      throw new DagValidationError("maxConcurrentWorkers must be greater than or equal to 1.");
    }

    // Initialize topological levels
    const batches = this.dag.getBatches({ deterministicSort: this.options.deterministicSort });
    for (const batch of batches) {
      for (const taskId of batch.taskIds) {
        this.nodeLevels.set(taskId, batch.level);
      }
    }

    // Initialize all nodes in PENDING status
    for (const node of this.dag.getNodes()) {
      this.nodeStateMap.set(node.id, {
        status: TASK_STATUS.PENDING,
      });
    }
  }

  /**
   * Returns the underlying DirectedAcyclicGraph.
   */
  public getDag(): DirectedAcyclicGraph<T> {
    return this.dag;
  }

  /**
   * Returns the active resolver configuration options.
   */
  public getOptions(): Required<ResolverOptions> {
    return { ...this.options };
  }

  /**
   * Retrieves the current execution status of a task node.
   */
  public getStatus(taskId: string): TaskStatus {
    const state = this.nodeStateMap.get(taskId);
    if (!state) {
      throw new DagNodeNotFoundError(taskId, "getStatus");
    }
    return state.status;
  }

  /**
   * Retrieves a map of all task IDs to their current execution status.
   */
  public getAllStatuses(): Map<string, TaskStatus> {
    const map = new Map<string, TaskStatus>();
    for (const [id, state] of this.nodeStateMap.entries()) {
      map.set(id, state.status);
    }
    return map;
  }

  /**
   * Retrieves an immutable TaskExecutionNode representing the current execution state of a node.
   */
  public getNode(taskId: string): TaskExecutionNode<T> {
    const state = this.nodeStateMap.get(taskId);
    if (!state) {
      throw new DagNodeNotFoundError(taskId, "getNode");
    }
    const dagNode = this.dag.requireNode(taskId);
    const dependents = this.dag.getDependents(taskId);
    const level = this.nodeLevels.get(taskId) ?? DAG_CONSTANTS.ROOT_LEVEL;

    return {
      id: taskId,
      status: state.status,
      level,
      dependencies: dagNode.dependencies,
      dependents: Object.freeze(dependents),
      data: dagNode.data,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      error: state.error,
      result: state.result,
    };
  }

  /**
   * Retrieves execution nodes for all registered tasks.
   */
  public getAllNodes(): TaskExecutionNode<T>[] {
    const ids = this.dag.getNodeIds();
    return ids.map((id) => this.getNode(id));
  }

  /**
   * Marks a task as IN_PROGRESS.
   * Throws DagExecutionError if the task is not PENDING or if any prerequisites are not COMPLETED.
   */
  public markInProgress(taskId: string): TaskExecutionNode<T> {
    const state = this.nodeStateMap.get(taskId);
    if (!state) {
      throw new DagNodeNotFoundError(taskId, "markInProgress");
    }

    if (state.status !== TASK_STATUS.PENDING) {
      throw new DagExecutionError(
        `Cannot start task: current status is '${state.status}', expected '${TASK_STATUS.PENDING}'.`,
        taskId,
        state.status
      );
    }

    // Verify all prerequisites are COMPLETED
    const prerequisites = this.dag.getDependencies(taskId);
    for (const prereqId of prerequisites) {
      const prereqState = this.nodeStateMap.get(prereqId);
      if (!prereqState || prereqState.status !== TASK_STATUS.COMPLETED) {
        throw new DagExecutionError(
          `Cannot start task: prerequisite '${prereqId}' is not COMPLETED (status: '${prereqState?.status ?? "UNKNOWN"}').`,
          taskId,
          state.status
        );
      }
    }

    state.status = TASK_STATUS.IN_PROGRESS;
    state.startedAt = Date.now();
    return this.getNode(taskId);
  }

  /**
   * Marks a task as COMPLETED with optional result payload.
   * Throws DagExecutionError if the task has already failed or been blocked.
   */
  public markCompleted(taskId: string, result?: unknown): TaskExecutionNode<T> {
    const state = this.nodeStateMap.get(taskId);
    if (!state) {
      throw new DagNodeNotFoundError(taskId, "markCompleted");
    }

    if (state.status === TASK_STATUS.BLOCKED || state.status === TASK_STATUS.FAILED) {
      throw new DagExecutionError(
        `Cannot mark task as COMPLETED: task is already in terminal failure status '${state.status}'.`,
        taskId,
        state.status
      );
    }

    if (state.startedAt === undefined) {
      state.startedAt = Date.now();
    }
    state.status = TASK_STATUS.COMPLETED;
    state.completedAt = Date.now();
    state.result = result;
    return this.getNode(taskId);
  }

  /**
   * Marks a task as FAILED and cascades blocking to all downstream dependent tasks.
   */
  public markFailed(taskId: string, error?: string | Error): TaskExecutionNode<T> {
    const state = this.nodeStateMap.get(taskId);
    if (!state) {
      throw new DagNodeNotFoundError(taskId, "markFailed");
    }

    if (state.startedAt === undefined) {
      state.startedAt = Date.now();
    }
    state.status = TASK_STATUS.FAILED;
    state.completedAt = Date.now();
    state.error = error instanceof Error ? error.message : (error ?? "Task execution failed");

    // Cascading failure propagation
    this.cascadeBlockDownstream(taskId, `Prerequisite task '${taskId}' failed.`);

    return this.getNode(taskId);
  }

  /**
   * Marks a task as BLOCKED and cascades blocking to downstream dependents.
   */
  public markBlocked(taskId: string, reason?: string): TaskExecutionNode<T> {
    const state = this.nodeStateMap.get(taskId);
    if (!state) {
      throw new DagNodeNotFoundError(taskId, "markBlocked");
    }

    state.status = TASK_STATUS.BLOCKED;
    state.completedAt = Date.now();
    state.error = reason ?? "Task marked as BLOCKED.";

    this.cascadeBlockDownstream(taskId, `Prerequisite task '${taskId}' is blocked.`);

    return this.getNode(taskId);
  }

  /**
   * Marks a task as SKIPPED and cascades blocking or skipping to downstream dependents.
   */
  public markSkipped(taskId: string, reason?: string): TaskExecutionNode<T> {
    const state = this.nodeStateMap.get(taskId);
    if (!state) {
      throw new DagNodeNotFoundError(taskId, "markSkipped");
    }

    state.status = TASK_STATUS.SKIPPED;
    state.completedAt = Date.now();
    state.error = reason ?? "Task was skipped.";

    this.cascadeBlockDownstream(taskId, `Prerequisite task '${taskId}' was skipped.`);

    return this.getNode(taskId);
  }

  /**
   * Resets a task back to PENDING status, clearing timestamps and errors.
   */
  public resetTask(
    taskId: string,
    options?: { readonly resetDependents?: boolean }
  ): TaskExecutionNode<T> {
    const state = this.nodeStateMap.get(taskId);
    if (!state) {
      throw new DagNodeNotFoundError(taskId, "resetTask");
    }

    state.status = TASK_STATUS.PENDING;
    delete state.startedAt;
    delete state.completedAt;
    delete state.error;
    delete state.result;

    if (options?.resetDependents) {
      const queue = [...this.dag.getDependents(taskId)];
      const visited = new Set<string>(queue);

      while (queue.length > DAG_CONSTANTS.EMPTY_COUNT) {
        const curr = queue.shift()!;
        const currState = this.nodeStateMap.get(curr);
        if (currState && (currState.status === TASK_STATUS.BLOCKED || currState.status === TASK_STATUS.FAILED)) {
          currState.status = TASK_STATUS.PENDING;
          delete currState.startedAt;
          delete currState.completedAt;
          delete currState.error;
          delete currState.result;
        }
        for (const next of this.dag.getDependents(curr)) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }
    }

    return this.getNode(taskId);
  }

  /**
   * Cascades blocking downstream to all transitive dependents of a failed or blocked task.
   */
  private cascadeBlockDownstream(rootTaskId: string, reason: string): void {
    const queue = [...this.dag.getDependents(rootTaskId)];
    const visited = new Set<string>(queue);

    while (queue.length > DAG_CONSTANTS.EMPTY_COUNT) {
      const depId = queue.shift()!;
      const depState = this.nodeStateMap.get(depId);
      if (
        depState &&
        (depState.status === TASK_STATUS.PENDING || depState.status === TASK_STATUS.IN_PROGRESS)
      ) {
        depState.status = TASK_STATUS.BLOCKED;
        depState.completedAt = Date.now();
        depState.error = reason;
      }
      for (const next of this.dag.getDependents(depId)) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
  }

  /**
   * Resolves the next batch of task IDs eligible for immediate parallel execution.
   * Tasks are eligible if status is PENDING and all prerequisites are COMPLETED.
   * Caps the returned batch by remaining available worker capacity or explicit limit.
   */
  public getNextExecutableBatch(limit?: number): string[] {
    const inProgressCount = this.getInProgressTasks().length;
    let maxToTake: number;

    if (limit !== undefined) {
      maxToTake = Math.max(DAG_CONSTANTS.EMPTY_COUNT, limit);
    } else {
      maxToTake = Math.max(DAG_CONSTANTS.EMPTY_COUNT, this.options.maxConcurrentWorkers - inProgressCount);
    }

    if (maxToTake <= DAG_CONSTANTS.EMPTY_COUNT) {
      return [];
    }

    const eligible: string[] = [];

    for (const [id, state] of this.nodeStateMap.entries()) {
      if (state.status !== TASK_STATUS.PENDING) {
        continue;
      }

      const prereqs = this.dag.getDependencies(id);
      let canRun = true;

      for (const prereqId of prereqs) {
        const prereqState = this.nodeStateMap.get(prereqId);
        if (!prereqState || prereqState.status !== TASK_STATUS.COMPLETED) {
          canRun = false;
          break;
        }
      }

      if (canRun) {
        eligible.push(id);
      }
    }

    if (this.options.deterministicSort) {
      // Sort primarily by topological level ascending, then alphabetically by ID
      eligible.sort((a, b) => {
        const levelA = this.nodeLevels.get(a) ?? DAG_CONSTANTS.ROOT_LEVEL;
        const levelB = this.nodeLevels.get(b) ?? DAG_CONSTANTS.ROOT_LEVEL;
        if (levelA !== levelB) {
          return levelA - levelB;
        }
        return a.localeCompare(b);
      });
    }

    return eligible.slice(DAG_CONSTANTS.FIRST_INDEX, maxToTake);
  }

  /**
   * Resolves the next batch of executable tasks returning rich DagNode objects.
   */
  public getNextBatch(limit?: number): DagNode<T>[] {
    const ids = this.getNextExecutableBatch(limit);
    return ids.map((id) => this.dag.getNode(id)!);
  }

  /**
   * Computes static topological level batches partitioned by concurrency limit.
   */
  public getBatches(options?: LevelBatchOptions): DagLevelBatch<T>[] {
    return this.dag.getBatches({
      maxConcurrentWorkers: options?.maxConcurrentWorkers ?? this.options.maxConcurrentWorkers,
      deterministicSort: options?.deterministicSort ?? this.options.deterministicSort,
    });
  }

  /**
   * Computes static topological levels as arrays of task ID strings.
   */
  public getLevels(options?: LevelBatchOptions): string[][] {
    return this.getBatches(options).map((batch) => [...batch.taskIds]);
  }

  public getInProgressTasks(): string[] {
    return this.getTasksByStatus(TASK_STATUS.IN_PROGRESS);
  }

  public getCompletedTasks(): string[] {
    return this.getTasksByStatus(TASK_STATUS.COMPLETED);
  }

  public getFailedTasks(): string[] {
    return this.getTasksByStatus(TASK_STATUS.FAILED);
  }

  public getBlockedTasks(): string[] {
    return this.getTasksByStatus(TASK_STATUS.BLOCKED);
  }

  public getSkippedTasks(): string[] {
    return this.getTasksByStatus(TASK_STATUS.SKIPPED);
  }

  public getPendingTasks(): string[] {
    return this.getTasksByStatus(TASK_STATUS.PENDING);
  }

  private getTasksByStatus(targetStatus: TaskStatus): string[] {
    const result: string[] = [];
    for (const [id, state] of this.nodeStateMap.entries()) {
      if (state.status === targetStatus) {
        result.push(id);
      }
    }
    if (this.options.deterministicSort) {
      result.sort();
    }
    return result;
  }

  /**
   * Checks whether all tasks have reached a terminal status (COMPLETED, FAILED, BLOCKED, SKIPPED).
   */
  public isComplete(): boolean {
    for (const state of this.nodeStateMap.values()) {
      if (state.status === TASK_STATUS.PENDING || state.status === TASK_STATUS.IN_PROGRESS) {
        return false;
      }
    }
    return true;
  }

  /**
   * Checks whether all tasks completed successfully.
   */
  public isSuccessful(): boolean {
    const total = this.dag.size;
    if (total === DAG_CONSTANTS.EMPTY_COUNT) {
      return true;
    }
    return this.getCompletedTasks().length === total;
  }

  /**
   * Checks whether any tasks failed or were blocked.
   */
  public hasFailures(): boolean {
    return (
      this.getFailedTasks().length > DAG_CONSTANTS.EMPTY_COUNT ||
      this.getBlockedTasks().length > DAG_CONSTANTS.EMPTY_COUNT
    );
  }

  /**
   * Generates a high-level summary of execution status metrics.
   */
  public getSummary(): DagExecutionSummary {
    let pending = DAG_CONSTANTS.EMPTY_COUNT;
    let inProgress = DAG_CONSTANTS.EMPTY_COUNT;
    let completed = DAG_CONSTANTS.EMPTY_COUNT;
    let failed = DAG_CONSTANTS.EMPTY_COUNT;
    let blocked = DAG_CONSTANTS.EMPTY_COUNT;
    let skipped = DAG_CONSTANTS.EMPTY_COUNT;

    for (const state of this.nodeStateMap.values()) {
      switch (state.status) {
        case TASK_STATUS.PENDING:
          pending += DAG_CONSTANTS.INDEX_OFFSET_ONE;
          break;
        case TASK_STATUS.IN_PROGRESS:
          inProgress += DAG_CONSTANTS.INDEX_OFFSET_ONE;
          break;
        case TASK_STATUS.COMPLETED:
          completed += DAG_CONSTANTS.INDEX_OFFSET_ONE;
          break;
        case TASK_STATUS.FAILED:
          failed += DAG_CONSTANTS.INDEX_OFFSET_ONE;
          break;
        case TASK_STATUS.BLOCKED:
          blocked += DAG_CONSTANTS.INDEX_OFFSET_ONE;
          break;
        case TASK_STATUS.SKIPPED:
          skipped += DAG_CONSTANTS.INDEX_OFFSET_ONE;
          break;
      }
    }

    const total = this.dag.size;
    const isComplete = (pending === DAG_CONSTANTS.EMPTY_COUNT && inProgress === DAG_CONSTANTS.EMPTY_COUNT);
    const isSuccessful = (total > DAG_CONSTANTS.EMPTY_COUNT ? completed === total : true);
    const progressPercentage =
      total === DAG_CONSTANTS.EMPTY_COUNT
        ? DAG_CONSTANTS.COMPLETE_PROGRESS_PERCENTAGE
        : Math.round((completed / total) * DAG_CONSTANTS.PERCENT_MULTIPLIER);

    return {
      totalTasks: total,
      pendingCount: pending,
      inProgressCount: inProgress,
      completedCount: completed,
      failedCount: failed,
      blockedCount: blocked,
      skippedCount: skipped,
      isComplete,
      isSuccessful,
      progressPercentage,
    };
  }

  /**
   * Serializes current DAG execution state into an immutable snapshot for persistence.
   */
  public exportSnapshot(): DagExecutionSnapshot<T> {
    const nodes = this.getAllNodes();
    return {
      schemaVersion: DAG_CONSTANTS.SNAPSHOT_SCHEMA_VERSION,
      timestamp: Date.now(),
      totalTasks: this.dag.size,
      nodes: Object.freeze(nodes),
      options: { ...this.options },
    };
  }

  /**
   * Rehydrates DAG execution state from a snapshot to resume execution without duplicating work.
   */
  public importSnapshot(snapshot: DagExecutionSnapshot<T>): void {
    if (!snapshot || snapshot.schemaVersion !== DAG_CONSTANTS.SNAPSHOT_SCHEMA_VERSION) {
      throw new DagValidationError(
        `Invalid snapshot schema version: expected ${DAG_CONSTANTS.SNAPSHOT_SCHEMA_VERSION}.`
      );
    }

    for (const nodeSnap of snapshot.nodes) {
      if (this.nodeStateMap.has(nodeSnap.id)) {
        const state = this.nodeStateMap.get(nodeSnap.id)!;
        state.status = nodeSnap.status;
        state.startedAt = nodeSnap.startedAt;
        state.completedAt = nodeSnap.completedAt;
        state.error = nodeSnap.error;
        state.result = nodeSnap.result;
      }
    }
  }

  /**
   * Factory restoring a DagLevelBatchResolver instance from a saved snapshot.
   */
  public static fromSnapshot<T = unknown>(
    dag: DirectedAcyclicGraph<T>,
    snapshot: DagExecutionSnapshot<T>
  ): DagLevelBatchResolver<T> {
    const resolver = new DagLevelBatchResolver<T>(dag, snapshot.options);
    resolver.importSnapshot(snapshot);
    return resolver;
  }

  /**
   * Drives automated concurrent execution of tasks across parallel workers.
   */
  public async executeConcurrent<R = unknown>(
    worker: (task: DagNode<T>) => Promise<R> | R,
    options?: ExecuteConcurrentOptions<T>
  ): Promise<DagExecutionResult<R>> {
    const maxWorkers = options?.maxConcurrentWorkers ?? this.options.maxConcurrentWorkers;
    const continueOnFailure = options?.continueOnFailure ?? this.options.continueOnFailure;
    const results = new Map<string, R>();
    const errors = new Map<string, string>();
    const startTime = Date.now();

    const activeWorkers = new Map<string, Promise<void>>();
    let hasHaltedDueToFailure = false;

    while (!this.isComplete()) {
      if (hasHaltedDueToFailure && activeWorkers.size === DAG_CONSTANTS.EMPTY_COUNT) {
        break;
      }

      const availableSlots = Math.max(
        DAG_CONSTANTS.EMPTY_COUNT,
        maxWorkers - activeWorkers.size
      );

      if (availableSlots > DAG_CONSTANTS.EMPTY_COUNT && !hasHaltedDueToFailure) {
        const nextTaskIds = this.getNextExecutableBatch(availableSlots);
        for (const taskId of nextTaskIds) {
          this.markInProgress(taskId);
          const node = this.dag.getNode(taskId)!;

          const taskPromise = (async () => {
            try {
              if (options?.onTaskStart) {
                await options.onTaskStart(node);
              }
              const result = await worker(node);
              this.markCompleted(taskId, result);
              results.set(taskId, result);
              if (options?.onTaskComplete) {
                await options.onTaskComplete(node, result);
              }
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              this.markFailed(taskId, errMsg);
              errors.set(taskId, errMsg);
              if (options?.onTaskFailed) {
                await options.onTaskFailed(node, err);
              }
              if (!continueOnFailure) {
                hasHaltedDueToFailure = true;
              }
            } finally {
              activeWorkers.delete(taskId);
            }
          })();

          activeWorkers.set(taskId, taskPromise);
        }
      }

      if (activeWorkers.size === DAG_CONSTANTS.EMPTY_COUNT) {
        if (!this.isComplete()) {
          // Prerequisite cannot be satisfied
          for (const [, state] of this.nodeStateMap.entries()) {
            if (state.status === TASK_STATUS.PENDING) {
              state.status = TASK_STATUS.BLOCKED;
              state.completedAt = Date.now();
              state.error = "Prerequisites could not be satisfied.";
            }
          }
        }
        break;
      }

      await Promise.race(Array.from(activeWorkers.values()));
    }

    if (activeWorkers.size > DAG_CONSTANTS.EMPTY_COUNT) {
      await Promise.allSettled(Array.from(activeWorkers.values()));
    }

    if (hasHaltedDueToFailure) {
      for (const [, state] of this.nodeStateMap.entries()) {
        if (state.status === TASK_STATUS.PENDING) {
          state.status = TASK_STATUS.BLOCKED;
          state.completedAt = Date.now();
          state.error = "Execution halted due to failure in another task.";
        }
      }
    }

    const summary = this.getSummary();
    const durationMs = Date.now() - startTime;

    return {
      success: summary.isSuccessful,
      totalTasks: summary.totalTasks,
      completedCount: summary.completedCount,
      failedCount: summary.failedCount,
      blockedCount: summary.blockedCount,
      skippedCount: summary.skippedCount,
      results,
      errors,
      durationMs,
      summary,
    };
  }
}

/**
 * Functional helper to create a DagLevelBatchResolver.
 */
export function createLevelBatchResolver<T = unknown>(
  tasksOrDag: Iterable<TaskDefinition<T> | DagNode<T>> | DirectedAcyclicGraph<T>,
  options?: ResolverOptions
): DagLevelBatchResolver<T> {
  const dag =
    tasksOrDag instanceof DirectedAcyclicGraph
      ? tasksOrDag
      : DirectedAcyclicGraph.fromTasks(tasksOrDag, options);
  return new DagLevelBatchResolver<T>(dag, options);
}

/**
 * Functional helper to resolve level batches directly.
 */
export function resolveLevelBatches<T = unknown>(
  tasksOrDag: Iterable<TaskDefinition<T> | DagNode<T>> | DirectedAcyclicGraph<T>,
  options?: LevelBatchOptions
): DagLevelBatch<T>[] {
  const dag =
    tasksOrDag instanceof DirectedAcyclicGraph
      ? tasksOrDag
      : DirectedAcyclicGraph.fromTasks(tasksOrDag, options);
  return dag.getBatches(options);
}

/**
 * Aliases matching Agnostic Looper terminology.
 */
export { DirectedAcyclicGraph as TaskDAG };
export { DirectedAcyclicGraph as DAG };
export { CircularDependencyError as CyclicDependencyError };
export { DagLevelBatchResolver as TaskDagResolver };
export { DagLevelBatchResolver as LevelBatchResolver };
export { DagLevelBatchResolver as DagBatchResolver };
