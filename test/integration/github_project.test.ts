import { describe, expect, it } from "bun:test";
import {
  GITHUB_PROJECT_CONSTANTS,
  GITHUB_PROJECT_ERROR_CODES,
  GitHubProjectError,
  GitHubProjectService,
  PROJECT_PRIORITY_VALUES,
  PROJECT_SIZE_VALUES,
  PROJECT_STATUS_VALUES,
  createDefaultGhCliExecutor,
  createGitHubProjectService,
  extractTaskKey,
  isRateLimitError,
  isTransientNetworkError,
  isRetryableError,
  extractRetryAfterMs,
  calculateExponentialBackoffDelay,
  executeWithRetry,
  normalizeProjectV2Item,
  type BackoffOptions,
  type RetryOptions,
  type GraphQLExecutor,
  type ProjectItemPriority,
  type ProjectItemSize,
  type ProjectItemStatus,
} from "../../src/integration/github_project";

describe("GitHubProjectService (Task 1.1)", () => {
  describe("Constants, Utilities and Error Taxonomy", () => {
    it("exposes expected default constants without magic numbers", () => {
      expect(GITHUB_PROJECT_CONSTANTS.DEFAULT_OWNER).toBe("sastiam");
      expect(GITHUB_PROJECT_CONSTANTS.DEFAULT_PROJECT_NUMBER).toBe(4);
      expect(GITHUB_PROJECT_CONSTANTS.DEFAULT_PROJECT_NODE_ID).toBe("PVT_kwHOA0KY4s4Boie_");
      expect(GITHUB_PROJECT_CONSTANTS.DEFAULT_PAGE_SIZE).toBe(100);
      expect(GITHUB_PROJECT_CONSTANTS.DEFAULT_TIMEOUT_MS).toBe(30_000);
      expect(GITHUB_PROJECT_CONSTANTS.FIELD_NAME_STATUS).toBe("Status");
      expect(GITHUB_PROJECT_CONSTANTS.FIELD_NAME_PRIORITY).toBe("Priority");
      expect(GITHUB_PROJECT_CONSTANTS.FIELD_NAME_SIZE).toBe("Size");
      expect(GITHUB_PROJECT_CONSTANTS.STATUS_DONE).toBe("Done");
      expect(GITHUB_PROJECT_CONSTANTS.STATUS_BACKLOG).toBe("Backlog");
    });

    it("correctly extracts LOOPER task keys from titles", () => {
      expect(extractTaskKey("[LOOPER-INT-002] GitHub Project #4 Integration Service")).toBe(
        "LOOPER-INT-002",
      );
      expect(extractTaskKey("feat: [looper-core-001] FSM Lifecycle Engine")).toBe(
        "LOOPER-CORE-001",
      );
      expect(extractTaskKey("General task without key")).toBeNull();
      expect(extractTaskKey("")).toBeNull();
    });

    it("classifies rate limit errors accurately", () => {
      const rateLimitError = new GitHubProjectError(
        "API rate limit exceeded",
        GITHUB_PROJECT_ERROR_CODES.RATE_LIMITED,
      );
      expect(rateLimitError.isRateLimited()).toBe(true);
      expect(isRateLimitError(rateLimitError)).toBe(true);

      const genericError = new Error("secondary rate limit reached for client");
      expect(isRateLimitError(genericError)).toBe(true);

      const otherError = new GitHubProjectError(
        "Field not found",
        GITHUB_PROJECT_ERROR_CODES.FIELD_NOT_FOUND,
      );
      expect(otherError.isRateLimited()).toBe(false);
      expect(isRateLimitError(otherError)).toBe(false);
    });

    it("instantiates GitHubProjectService via factory helper with default config", () => {
      const service = createGitHubProjectService();
      const config = service.getConfig();
      expect(config.owner).toBe("sastiam");
      expect(config.projectNumber).toBe(4);
      expect(config.ownerType).toBe("user");
      expect(typeof service.getExecutor()).toBe("function");
    });

    it("accepts custom configuration options", () => {
      const customExecutor: GraphQLExecutor = async () => ({});
      const service = new GitHubProjectService({
        owner: "custom-org",
        ownerType: "organization",
        projectNumber: 12,
        projectId: "PVT_custom_123",
        timeoutMs: 15_000,
        executor: customExecutor,
      });

      const config = service.getConfig();
      expect(config.owner).toBe("custom-org");
      expect(config.ownerType).toBe("organization");
      expect(config.projectNumber).toBe(12);
      expect(config.projectId).toBe("PVT_custom_123");
      expect(config.timeoutMs).toBe(15_000);
      expect(service.getExecutor()).toBe(customExecutor);
    });
  });

  describe("GraphQL Query & Mutation Execution", () => {
    it("executes GraphQL queries and unwraps data payload cleanly", async () => {
      const mockExecutor: GraphQLExecutor = async (query, variables) => {
        expect(query).toContain("GetProjectByUser");
        expect(variables?.owner).toBe("sastiam");
        return {
          data: {
            user: {
              projectV2: {
                id: "PVT_test_123",
                title: "Test Project",
                number: 4,
                fields: {
                  nodes: [
                    {
                      id: "FIELD_STATUS_ID",
                      name: "Status",
                      dataType: "SINGLE_SELECT",
                      options: [
                        { id: "OPT_BACKLOG", name: "Backlog" },
                        { id: "OPT_DONE", name: "Done" },
                      ],
                    },
                  ],
                },
              },
            },
          },
        };
      };

      const service = new GitHubProjectService({ executor: mockExecutor });
      const details = await service.getProjectDetails();

      expect(details.id).toBe("PVT_test_123");
      expect(details.title).toBe("Test Project");
      expect(details.number).toBe(4);
      expect(details.fields.length).toBe(1);
      expect(details.fields[0]?.name).toBe("Status");
      expect(details.fields[0]?.options?.[1]?.name).toBe("Done");
    });

    it("throws GitHubProjectError when GraphQL response contains errors", async () => {
      const mockExecutor: GraphQLExecutor = async () => ({
        errors: [
          {
            message: "Field 'invalid' does not exist on type 'ProjectV2'",
            type: "GRAPHQL_VALIDATION_FAILED",
          },
        ],
      });

      const service = new GitHubProjectService({ executor: mockExecutor });
      expect(service.getProjectDetails()).rejects.toThrow(GitHubProjectError);
    });

    it("throws RATE_LIMITED when GraphQL returns rate limit error", async () => {
      const mockExecutor: GraphQLExecutor = async () => ({
        errors: [
          {
            message: "API rate limit exceeded for user ID 12345",
            type: "RATE_LIMITED",
          },
        ],
      });

      const service = new GitHubProjectService({ executor: mockExecutor });
      try {
        await service.getProjectDetails();
        expect.unreachable();
      } catch (err) {
        expect(err instanceof GitHubProjectError).toBe(true);
        const ghErr = err as GitHubProjectError;
        expect(ghErr.code).toBe(GITHUB_PROJECT_ERROR_CODES.RATE_LIMITED);
        expect(ghErr.isRateLimited()).toBe(true);
      }
    });

    it("throws PROJECT_NOT_FOUND when project does not exist", async () => {
      const mockExecutor: GraphQLExecutor = async () => ({
        data: {
          user: {
            projectV2: null,
          },
        },
      });

      const service = new GitHubProjectService({ executor: mockExecutor });
      try {
        await service.getProjectDetails();
        expect.unreachable();
      } catch (err) {
        expect(err instanceof GitHubProjectError).toBe(true);
        const ghErr = err as GitHubProjectError;
        expect(ghErr.code).toBe(GITHUB_PROJECT_ERROR_CODES.PROJECT_NOT_FOUND);
      }
    });
  });

  describe("Field Definitions & Single-Select Option Resolution", () => {
    const mockFields = [
      {
        id: "STATUS_FIELD_ID",
        name: "Status",
        dataType: "SINGLE_SELECT",
        options: [
          { id: "OPT_BACKLOG", name: "Backlog" },
          { id: "OPT_IN_PROGRESS", name: "In progress" },
          { id: "OPT_DONE", name: "Done" },
        ],
      },
      {
        id: "PRIORITY_FIELD_ID",
        name: "Priority",
        dataType: "SINGLE_SELECT",
        options: [
          { id: "OPT_P0", name: "P0" },
          { id: "OPT_P1", name: "P1" },
          { id: "OPT_P2", name: "P2" },
        ],
      },
      {
        id: "SIZE_FIELD_ID",
        name: "Size",
        dataType: "SINGLE_SELECT",
        options: [
          { id: "OPT_XS", name: "XS" },
          { id: "OPT_S", name: "S" },
          { id: "OPT_M", name: "M" },
          { id: "OPT_L", name: "L" },
          { id: "OPT_XL", name: "XL" },
        ],
      },
    ];

    const mockExecutor: GraphQLExecutor = async () => ({
      data: {
        user: {
          projectV2: {
            id: "PVT_kwHOA0KY4s4Boie_",
            title: "Spec Cascade Project",
            number: 4,
            fields: {
              nodes: mockFields,
            },
          },
        },
      },
    });

    it("resolves fields by name (case-insensitive)", async () => {
      const service = new GitHubProjectService({ executor: mockExecutor });
      const statusField = await service.getFieldByName("status");
      expect(statusField?.id).toBe("STATUS_FIELD_ID");
      expect(statusField?.name).toBe("Status");

      const priorityField = await service.getFieldByName("PRIORITY");
      expect(priorityField?.id).toBe("PRIORITY_FIELD_ID");

      const unknownField = await service.getFieldByName("NonExistent");
      expect(unknownField).toBeUndefined();
    });

    it("resolves fields by ID", async () => {
      const service = new GitHubProjectService({ executor: mockExecutor });
      const sizeField = await service.getFieldById("SIZE_FIELD_ID");
      expect(sizeField?.name).toBe("Size");
      expect(sizeField?.options?.length).toBe(5);
    });

    it("resolves single-select options by field name and option name", async () => {
      const service = new GitHubProjectService({ executor: mockExecutor });
      const doneOption = await service.getSingleSelectOption("Status", "Done");
      expect(doneOption?.id).toBe("OPT_DONE");
      expect(doneOption?.name).toBe("Done");

      const p0Option = await service.getSingleSelectOption("Priority", "p0");
      expect(p0Option?.id).toBe("OPT_P0");

      const invalidOption = await service.getSingleSelectOption("Status", "Invalid");
      expect(invalidOption).toBeUndefined();

      const invalidFieldOption = await service.getSingleSelectOption("InvalidField", "Done");
      expect(invalidFieldOption).toBeUndefined();
    });

    it("caches project details and clears cache on demand", async () => {
      let callCount = 0;
      const countExecutor: GraphQLExecutor = async () => {
        callCount++;
        return {
          data: {
            user: {
              projectV2: {
                id: "PVT_cached_123",
                title: "Cached Project",
                number: 4,
                fields: { nodes: [] },
              },
            },
          },
        };
      };

      const service = new GitHubProjectService({ executor: countExecutor });
      await service.getProjectDetails();
      expect(callCount).toBe(1);

      await service.getProjectDetails();
      expect(callCount).toBe(1); // Cached

      await service.getProjectDetails(true);
      expect(callCount).toBe(2); // Forced refresh

      service.clearCache();
      await service.getProjectDetails();
      expect(callCount).toBe(3); // Refetched after clearCache
    });
  });

  describe("Item Querying and Normalization", () => {
    const rawItemsData = {
      data: {
        user: {
          projectV2: {
            items: {
              pageInfo: {
                hasNextPage: true,
                endCursor: "CURSOR_PAGE_1",
              },
              nodes: [
                {
                  id: "ITEM_1",
                  type: "ISSUE",
                  status: { name: "Done", optionId: "OPT_DONE" },
                  priority: { name: "P0", optionId: "OPT_P0" },
                  size: { name: "M", optionId: "OPT_M" },
                  content: {
                    __typename: "Issue",
                    id: "ISSUE_1_ID",
                    number: 42,
                    title: "[LOOPER-INT-002] Implement GitHub Project Service",
                    body: "Task description body",
                    url: "https://github.com/sastiam/openspec-cascade/issues/42",
                  },
                },
                {
                  id: "ITEM_2",
                  type: "DRAFT_ISSUE",
                  status: { name: "Backlog", optionId: "OPT_BACKLOG" },
                  priority: null,
                  size: null,
                  content: {
                    __typename: "DraftIssue",
                    id: "DRAFT_2_ID",
                    title: "[LOOPER-CORE-001] FSM Lifecycle",
                    body: "Draft body",
                  },
                },
              ],
            },
          },
        },
      },
    };

    it("normalizes ProjectV2 items accurately", () => {
      const normalized = normalizeProjectV2Item(rawItemsData.data.user.projectV2.items.nodes[0] as any);
      expect(normalized.id).toBe("ITEM_1");
      expect(normalized.type).toBe("ISSUE");
      expect(normalized.status).toBe("Done");
      expect(normalized.statusOptionId).toBe("OPT_DONE");
      expect(normalized.priority).toBe("P0");
      expect(normalized.priorityOptionId).toBe("OPT_P0");
      expect(normalized.size).toBe("M");
      expect(normalized.sizeOptionId).toBe("OPT_M");
      expect(normalized.content?.__typename).toBe("Issue");
      if (normalized.content?.__typename === "Issue") {
        expect(normalized.content.number).toBe(42);
        expect(normalized.content.title).toContain("LOOPER-INT-002");
        expect(normalized.content.url).toBe(
          "https://github.com/sastiam/openspec-cascade/issues/42",
        );
      }
    });

    it("retrieves paginated items with hasNextPage and endCursor", async () => {
      const service = new GitHubProjectService({
        executor: async () => rawItemsData,
      });

      const result = await service.getItems({ first: 10 });
      expect(result.items.length).toBe(2);
      expect(result.hasNextPage).toBe(true);
      expect(result.endCursor).toBe("CURSOR_PAGE_1");
      expect(result.items[0]?.content?.title).toContain("LOOPER-INT-002");
    });

    it("fetches single item by ID using node query", async () => {
      const singleItemData = {
        data: {
          node: {
            id: "ITEM_TARGET_99",
            type: "ISSUE",
            status: { name: "In progress", optionId: "OPT_IN_PROGRESS" },
            priority: { name: "P1", optionId: "OPT_P1" },
            size: { name: "S", optionId: "OPT_S" },
            content: {
              __typename: "Issue",
              id: "ISSUE_99",
              number: 99,
              title: "Specific target task",
              body: "Details",
              url: "https://github.com/issue/99",
            },
          },
        },
      };

      const service = new GitHubProjectService({
        executor: async (query, vars) => {
          expect(query).toContain("GetItemById");
          expect(vars?.itemId).toBe("ITEM_TARGET_99");
          return singleItemData;
        },
      });

      const item = await service.getItemById("ITEM_TARGET_99");
      expect(item?.id).toBe("ITEM_TARGET_99");
      expect(item?.status).toBe("In progress");
      expect(item?.priority).toBe("P1");
      expect(item?.size).toBe("S");
      expect(item?.content?.title).toBe("Specific target task");
    });

    it("returns undefined when item ID is not found", async () => {
      const service = new GitHubProjectService({
        executor: async () => ({ data: { node: null } }),
      });

      const item = await service.getItemById("NON_EXISTENT");
      expect(item).toBeUndefined();
    });

    it("finds item by task key", async () => {
      const service = new GitHubProjectService({
        executor: async (_query, vars) => {
          if (!vars?.after) {
            return rawItemsData;
          }
          return {
            data: {
              user: {
                projectV2: {
                  items: {
                    pageInfo: { hasNextPage: false, endCursor: undefined },
                    nodes: [],
                  },
                },
              },
            },
          };
        },
      });

      const item = await service.findItemByTaskKey("LOOPER-INT-002");
      expect(item?.id).toBe("ITEM_1");
      expect(item?.content?.title).toContain("LOOPER-INT-002");

      const itemWithBrackets = await service.findItemByTaskKey("[LOOPER-INT-002]");
      expect(itemWithBrackets?.id).toBe("ITEM_1");
    });

    it("finds item by title substring", async () => {
      const service = new GitHubProjectService({
        executor: async (_query, vars) => {
          if (!vars?.after) {
            return rawItemsData;
          }
          return {
            data: {
              user: {
                projectV2: {
                  items: {
                    pageInfo: { hasNextPage: false, endCursor: undefined },
                    nodes: [],
                  },
                },
              },
            },
          };
        },
      });

      const item = await service.findItemByTitle("FSM Lifecycle");
      expect(item?.id).toBe("ITEM_2");
      expect(item?.status).toBe("Backlog");
    });
  });

  describe("Mutation Primitives", () => {
    it("updates field value on an item", async () => {
      let mutationPayload: unknown = null;
      const service = new GitHubProjectService({
        projectId: "PVT_kwHOA0KY4s4Boie_",
        executor: async (query, vars) => {
          expect(query).toContain("UpdateProjectV2ItemFieldValue");
          mutationPayload = vars;
          return {
            data: {
              updateProjectV2ItemFieldValue: {
                projectV2Item: {
                  id: "ITEM_TO_MUTATE",
                },
              },
            },
          };
        },
      });

      const res = await service.updateFieldValue("ITEM_TO_MUTATE", "FIELD_STATUS_ID", {
        singleSelectOptionId: "OPT_DONE",
      });

      expect(res.itemId).toBe("ITEM_TO_MUTATE");
      expect(mutationPayload).toEqual({
        input: {
          projectId: "PVT_kwHOA0KY4s4Boie_",
          itemId: "ITEM_TO_MUTATE",
          fieldId: "FIELD_STATUS_ID",
          value: {
            singleSelectOptionId: "OPT_DONE",
          },
        },
      });
    });

    it("adds draft issue to project", async () => {
      let draftPayload: unknown = null;
      const service = new GitHubProjectService({
        projectId: "PVT_kwHOA0KY4s4Boie_",
        executor: async (query, vars) => {
          expect(query).toContain("AddProjectV2DraftIssue");
          draftPayload = vars;
          return {
            data: {
              addProjectV2DraftIssue: {
                projectV2Item: {
                  id: "NEW_DRAFT_ITEM_ID",
                },
              },
            },
          };
        },
      });

      const res = await service.addDraftIssue("Draft Title", "Draft Body Content");
      expect(res.itemId).toBe("NEW_DRAFT_ITEM_ID");
      expect(draftPayload).toEqual({
        input: {
          projectId: "PVT_kwHOA0KY4s4Boie_",
          title: "Draft Title",
          body: "Draft Body Content",
        },
      });
    });

    it("deletes item from project", async () => {
      let deletePayload: unknown = null;
      const service = new GitHubProjectService({
        projectId: "PVT_kwHOA0KY4s4Boie_",
        executor: async (query, vars) => {
          expect(query).toContain("DeleteProjectV2Item");
          deletePayload = vars;
          return {
            data: {
              deleteProjectV2Item: {
                deletedItemId: "DELETED_ITEM_ID",
              },
            },
          };
        },
      });

      const res = await service.deleteItem("ITEM_TO_DELETE");
      expect(res.deletedItemId).toBe("DELETED_ITEM_ID");
      expect(deletePayload).toEqual({
        input: {
          projectId: "PVT_kwHOA0KY4s4Boie_",
          itemId: "ITEM_TO_DELETE",
        },
      });
    });
  });

  describe("Ambient gh CLI Integration", () => {
    it("creates default gh CLI executor function", () => {
      const executor = createDefaultGhCliExecutor({
        ghCliPath: "gh",
        timeoutMs: 5000,
      });
      expect(typeof executor).toBe("function");
    });
  });
});

describe("Typed Mutation Methods: Status, Priority, and Size (Task 1.2)", () => {
  const mockFields = [
    {
      id: "STATUS_FIELD_ID",
      name: "Status",
      dataType: "SINGLE_SELECT",
      options: [
        { id: "OPT_BACKLOG", name: "Backlog" },
        { id: "OPT_READY", name: "Ready" },
        { id: "OPT_IN_PROGRESS", name: "In progress" },
        { id: "OPT_IN_REVIEW", name: "In review" },
        { id: "OPT_DONE", name: "Done" },
      ],
    },
    {
      id: "PRIORITY_FIELD_ID",
      name: "Priority",
      dataType: "SINGLE_SELECT",
      options: [
        { id: "OPT_P0", name: "P0" },
        { id: "OPT_P1", name: "P1" },
        { id: "OPT_P2", name: "P2" },
        { id: "OPT_P3", name: "P3" },
      ],
    },
    {
      id: "SIZE_FIELD_ID",
      name: "Size",
      dataType: "SINGLE_SELECT",
      options: [
        { id: "OPT_XS", name: "XS" },
        { id: "OPT_S", name: "S" },
        { id: "OPT_M", name: "M" },
        { id: "OPT_L", name: "L" },
        { id: "OPT_XL", name: "XL" },
      ],
    },
  ];

  const mockItems = [
    {
      id: "ITEM_100",
      type: "DRAFT_ISSUE",
      status: { name: "Backlog", optionId: "OPT_BACKLOG" },
      priority: { name: "P1", optionId: "OPT_P1" },
      size: { name: "M", optionId: "OPT_M" },
      content: {
        __typename: "DraftIssue",
        title: "[LOOPER-INT-002] GitHub Project #4 Integration",
        body: "Integration service task",
      },
    },
    {
      id: "ITEM_200",
      type: "ISSUE",
      status: { name: "In progress", optionId: "OPT_IN_PROGRESS" },
      priority: { name: "P0", optionId: "OPT_P0" },
      size: { name: "L", optionId: "OPT_L" },
      content: {
        __typename: "Issue",
        number: 42,
        title: "[LOOPER-INT-003] Task Catalog Sync",
        body: "Catalog sync task",
        url: "https://github.com/sastiam/openspec-cascade/issues/42",
      },
    },
  ];

  function createMockExecutor(options?: {
    customFields?: Array<{
      id: string;
      name: string;
      dataType: string;
      options?: Array<{ id: string; name: string; description?: string; color?: string }>;
    }>;
    onMutation?: (vars: Record<string, unknown> | undefined) => void;
  }): GraphQLExecutor {
    const fieldsToUse = options?.customFields ?? mockFields;

    return async (query, vars) => {
      if (query.includes("GetProjectByUser")) {
        return {
          data: {
            user: {
              projectV2: {
                id: "PVT_kwHOA0KY4s4Boie_",
                title: "Spec Cascade Project",
                number: 4,
                fields: {
                  nodes: fieldsToUse,
                },
              },
            },
          },
        };
      }

      if (query.includes("GetProjectItemsByUser")) {
        return {
          data: {
            user: {
              projectV2: {
                items: {
                  pageInfo: { hasNextPage: false, endCursor: undefined },
                  nodes: mockItems,
                },
              },
            },
          },
        };
      }

      if (query.includes("UpdateProjectV2ItemFieldValue")) {
        options?.onMutation?.(vars);
        const input = (vars as { input: { itemId: string } })?.input;
        return {
          data: {
            updateProjectV2ItemFieldValue: {
              projectV2Item: {
                id: input?.itemId ?? "MUTATED_ITEM_ID",
              },
            },
          },
        };
      }

      if (query.includes("AddProjectV2DraftIssue")) {
        return {
          data: {
            addProjectV2DraftIssue: {
              projectV2Item: {
                id: "NEW_CREATED_ITEM_ID",
              },
            },
          },
        };
      }

      return { data: {} };
    };
  }

  describe("Exported Values and Constants", () => {
    it("exports standard option value arrays", () => {
      expect(PROJECT_STATUS_VALUES).toEqual([
        "Backlog",
        "Ready",
        "In progress",
        "In review",
        "Done",
      ]);
      expect(PROJECT_PRIORITY_VALUES).toEqual(["P0", "P1", "P2", "P3"]);
      expect(PROJECT_SIZE_VALUES).toEqual(["XS", "S", "M", "L", "XL"]);
    });

    it("exports known Project #4 option IDs in GITHUB_PROJECT_CONSTANTS", () => {
      expect(GITHUB_PROJECT_CONSTANTS.STATUS_OPTION_IDS.Backlog).toBe("f75ad846");
      expect(GITHUB_PROJECT_CONSTANTS.STATUS_OPTION_IDS["In progress"]).toBe("47fc9ee4");
      expect(GITHUB_PROJECT_CONSTANTS.STATUS_OPTION_IDS.Done).toBe("98236657");

      expect(GITHUB_PROJECT_CONSTANTS.PRIORITY_OPTION_IDS.P0).toBe("79628723");
      expect(GITHUB_PROJECT_CONSTANTS.PRIORITY_OPTION_IDS.P1).toBe("0a877460");
      expect(GITHUB_PROJECT_CONSTANTS.PRIORITY_OPTION_IDS.P2).toBe("da944a9c");

      expect(GITHUB_PROJECT_CONSTANTS.SIZE_OPTION_IDS.XS).toBe("6c6483d2");
      expect(GITHUB_PROJECT_CONSTANTS.SIZE_OPTION_IDS.S).toBe("f784b110");
      expect(GITHUB_PROJECT_CONSTANTS.SIZE_OPTION_IDS.M).toBe("7515a9f1");
      expect(GITHUB_PROJECT_CONSTANTS.SIZE_OPTION_IDS.L).toBe("817d0097");
      expect(GITHUB_PROJECT_CONSTANTS.SIZE_OPTION_IDS.XL).toBe("db339eb2");
    });
  });

  describe("Status Mutations (Done, In progress, Backlog)", () => {
    it("updates item Status to Done with correct fieldId and singleSelectOptionId", async () => {
      let capturedVars: Record<string, unknown> | undefined;
      const service = new GitHubProjectService({
        executor: createMockExecutor({
          onMutation: (vars) => {
            capturedVars = vars;
          },
        }),
      });

      const result = await service.updateItemStatus("ITEM_100", "Done");

      expect(result.itemId).toBe("ITEM_100");
      expect(result.fieldId).toBe("STATUS_FIELD_ID");
      expect(result.optionId).toBe("OPT_DONE");
      expect(result.status).toBe("Done");
      expect(result.value).toBe("Done");

      expect(capturedVars).toEqual({
        input: {
          projectId: "PVT_kwHOA0KY4s4Boie_",
          itemId: "ITEM_100",
          fieldId: "STATUS_FIELD_ID",
          value: {
            singleSelectOptionId: "OPT_DONE",
          },
        },
      });
    });

    it("updates item Status to In progress", async () => {
      let capturedVars: Record<string, unknown> | undefined;
      const service = new GitHubProjectService({
        executor: createMockExecutor({
          onMutation: (vars) => {
            capturedVars = vars;
          },
        }),
      });

      const result = await service.updateItemStatus("ITEM_100", "In progress");

      expect(result.itemId).toBe("ITEM_100");
      expect(result.optionId).toBe("OPT_IN_PROGRESS");
      expect(result.status).toBe("In progress");
      expect(capturedVars).toEqual({
        input: {
          projectId: "PVT_kwHOA0KY4s4Boie_",
          itemId: "ITEM_100",
          fieldId: "STATUS_FIELD_ID",
          value: {
            singleSelectOptionId: "OPT_IN_PROGRESS",
          },
        },
      });
    });

    it("updates item Status to Backlog", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const result = await service.updateItemStatus("ITEM_200", "Backlog");

      expect(result.itemId).toBe("ITEM_200");
      expect(result.optionId).toBe("OPT_BACKLOG");
      expect(result.status).toBe("Backlog");
    });

    it("normalizes case and delimiters (e.g. in_progress, done, backlog)", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const inProgResult = await service.updateItemStatus("ITEM_100", "in_progress");
      expect(inProgResult.status).toBe("In progress");
      expect(inProgResult.optionId).toBe("OPT_IN_PROGRESS");

      const doneResult = await service.updateItemStatus("ITEM_100", "done");
      expect(doneResult.status).toBe("Done");
      expect(doneResult.optionId).toBe("OPT_DONE");

      const backlogResult = await service.updateItemStatus("ITEM_100", "backlog");
      expect(backlogResult.status).toBe("Backlog");
      expect(backlogResult.optionId).toBe("OPT_BACKLOG");
    });

    it("provides convenience methods: markAsDone, markAsInProgress, markAsBacklog", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const doneRes = await service.markAsDone("ITEM_100");
      expect(doneRes.status).toBe("Done");
      expect(doneRes.optionId).toBe("OPT_DONE");

      const inProgRes = await service.markAsInProgress("ITEM_100");
      expect(inProgRes.status).toBe("In progress");
      expect(inProgRes.optionId).toBe("OPT_IN_PROGRESS");

      const backlogRes = await service.markAsBacklog("ITEM_100");
      expect(backlogRes.status).toBe("Backlog");
      expect(backlogRes.optionId).toBe("OPT_BACKLOG");
    });

    it("provides updateStatus alias method", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const res = await service.updateStatus("ITEM_100", "Done");
      expect(res.status).toBe("Done");
      expect(res.itemId).toBe("ITEM_100");
    });

    it("throws INVALID_ARGUMENT when itemId or status is empty", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      expect(service.updateItemStatus("", "Done")).rejects.toThrow(
        /Item ID cannot be empty/,
      );
      expect(
        service.updateItemStatus("   ", "Done"),
      ).rejects.toThrow(GitHubProjectError);
      expect(
        service.updateItemStatus("ITEM_100", "" as unknown as ProjectItemStatus),
      ).rejects.toThrow(/Status value cannot be empty/);
    });

    it("throws OPTION_NOT_FOUND when status option does not exist", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      try {
        await service.updateItemStatus(
          "ITEM_100",
          "NonExistentStatus" as unknown as ProjectItemStatus,
        );
        expect.unreachable();
      } catch (err) {
        expect(err instanceof GitHubProjectError).toBe(true);
        const ghErr = err as GitHubProjectError;
        expect(ghErr.code).toBe(GITHUB_PROJECT_ERROR_CODES.OPTION_NOT_FOUND);
        expect(ghErr.message).toContain("NonExistentStatus");
      }
    });

    it("throws FIELD_NOT_FOUND when Status field is missing from project", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor({
          customFields: [],
        }),
      });

      try {
        await service.updateItemStatus("ITEM_100", "Done");
        expect.unreachable();
      } catch (err) {
        expect(err instanceof GitHubProjectError).toBe(true);
        const ghErr = err as GitHubProjectError;
        expect(ghErr.code).toBe(GITHUB_PROJECT_ERROR_CODES.FIELD_NOT_FOUND);
      }
    });
  });

  describe("Priority Mutations", () => {
    it("updates item Priority to P0, P1, P2 with correct singleSelectOptionId", async () => {
      let capturedVars: Record<string, unknown> | undefined;
      const service = new GitHubProjectService({
        executor: createMockExecutor({
          onMutation: (vars) => {
            capturedVars = vars;
          },
        }),
      });

      const p0Result = await service.updateItemPriority("ITEM_100", "P0");
      expect(p0Result.priority).toBe("P0");
      expect(p0Result.optionId).toBe("OPT_P0");
      expect(capturedVars).toEqual({
        input: {
          projectId: "PVT_kwHOA0KY4s4Boie_",
          itemId: "ITEM_100",
          fieldId: "PRIORITY_FIELD_ID",
          value: {
            singleSelectOptionId: "OPT_P0",
          },
        },
      });

      const p1Result = await service.updateItemPriority("ITEM_100", "P1");
      expect(p1Result.priority).toBe("P1");
      expect(p1Result.optionId).toBe("OPT_P1");

      const p2Result = await service.updateItemPriority("ITEM_100", "P2");
      expect(p2Result.priority).toBe("P2");
      expect(p2Result.optionId).toBe("OPT_P2");
    });

    it("normalizes case for priority ('p0' -> 'P0')", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const res = await service.updateItemPriority("ITEM_100", "p0");
      expect(res.priority).toBe("P0");
      expect(res.optionId).toBe("OPT_P0");
    });

    it("provides updatePriority alias method", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const res = await service.updatePriority("ITEM_100", "P0");
      expect(res.priority).toBe("P0");
      expect(res.itemId).toBe("ITEM_100");
    });

    it("throws INVALID_ARGUMENT when priority is empty", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      expect(
        service.updateItemPriority("ITEM_100", "" as unknown as ProjectItemPriority),
      ).rejects.toThrow(/Priority value cannot be empty/);
    });

    it("throws OPTION_NOT_FOUND when priority option does not exist", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      try {
        await service.updateItemPriority(
          "ITEM_100",
          "P99" as unknown as ProjectItemPriority,
        );
        expect.unreachable();
      } catch (err) {
        expect(err instanceof GitHubProjectError).toBe(true);
        const ghErr = err as GitHubProjectError;
        expect(ghErr.code).toBe(GITHUB_PROJECT_ERROR_CODES.OPTION_NOT_FOUND);
      }
    });

    it("throws FIELD_NOT_FOUND when Priority field is missing from project", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor({
          customFields: [],
        }),
      });

      try {
        await service.updateItemPriority("ITEM_100", "P0");
        expect.unreachable();
      } catch (err) {
        expect(err instanceof GitHubProjectError).toBe(true);
        const ghErr = err as GitHubProjectError;
        expect(ghErr.code).toBe(GITHUB_PROJECT_ERROR_CODES.FIELD_NOT_FOUND);
      }
    });
  });

  describe("Size Mutations", () => {
    it("updates item Size to XS, S, M, L, XL on single-select schema", async () => {
      let capturedVars: Record<string, unknown> | undefined;
      const service = new GitHubProjectService({
        executor: createMockExecutor({
          onMutation: (vars) => {
            capturedVars = vars;
          },
        }),
      });

      const mResult = await service.updateItemSize("ITEM_100", "M");
      expect(mResult.size).toBe("M");
      expect(mResult.optionId).toBe("OPT_M");
      expect(capturedVars).toEqual({
        input: {
          projectId: "PVT_kwHOA0KY4s4Boie_",
          itemId: "ITEM_100",
          fieldId: "SIZE_FIELD_ID",
          value: {
            singleSelectOptionId: "OPT_M",
          },
        },
      });

      const xlResult = await service.updateItemSize("ITEM_100", "XL");
      expect(xlResult.size).toBe("XL");
      expect(xlResult.optionId).toBe("OPT_XL");
    });

    it("normalizes case for size ('s' -> 'S', 'xl' -> 'XL')", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const res = await service.updateItemSize("ITEM_100", "s");
      expect(res.size).toBe("S");
      expect(res.optionId).toBe("OPT_S");
    });

    it("updates item Size on numeric schema", async () => {
      let capturedVars: Record<string, unknown> | undefined;
      const numericFields = [
        {
          id: "NUMERIC_SIZE_FIELD_ID",
          name: "Size",
          dataType: "NUMBER",
        },
      ];

      const service = new GitHubProjectService({
        executor: createMockExecutor({
          customFields: numericFields,
          onMutation: (vars) => {
            capturedVars = vars;
          },
        }),
      });

      const res = await service.updateItemSize("ITEM_100", 8);
      expect(res.size).toBe(8);
      expect(res.fieldId).toBe("NUMERIC_SIZE_FIELD_ID");
      expect(capturedVars).toEqual({
        input: {
          projectId: "PVT_kwHOA0KY4s4Boie_",
          itemId: "ITEM_100",
          fieldId: "NUMERIC_SIZE_FIELD_ID",
          value: {
            number: 8,
          },
        },
      });
    });

    it("provides updateSize alias method", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const res = await service.updateSize("ITEM_100", "L");
      expect(res.size).toBe("L");
      expect(res.itemId).toBe("ITEM_100");
    });

    it("throws INVALID_ARGUMENT when size is empty or invalid number", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      expect(
        service.updateItemSize("ITEM_100", "" as unknown as ProjectItemSize),
      ).rejects.toThrow(/Size value cannot be empty/);
    });

    it("throws OPTION_NOT_FOUND when single-select size option does not exist", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      try {
        await service.updateItemSize(
          "ITEM_100",
          "XXL" as unknown as ProjectItemSize,
        );
        expect.unreachable();
      } catch (err) {
        expect(err instanceof GitHubProjectError).toBe(true);
        const ghErr = err as GitHubProjectError;
        expect(ghErr.code).toBe(GITHUB_PROJECT_ERROR_CODES.OPTION_NOT_FOUND);
      }
    });

    it("throws FIELD_NOT_FOUND when Size field is missing from project", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor({
          customFields: [],
        }),
      });

      try {
        await service.updateItemSize("ITEM_100", "M");
        expect.unreachable();
      } catch (err) {
        expect(err instanceof GitHubProjectError).toBe(true);
        const ghErr = err as GitHubProjectError;
        expect(ghErr.code).toBe(GITHUB_PROJECT_ERROR_CODES.FIELD_NOT_FOUND);
      }
    });
  });

  describe("Task Key Mutations", () => {
    it("updates Status by task key", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const res = await service.updateStatusByTaskKey("LOOPER-INT-002", "Done");
      expect(res.itemId).toBe("ITEM_100");
      expect(res.status).toBe("Done");
      expect(res.optionId).toBe("OPT_DONE");
    });

    it("updates Priority by task key", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const res = await service.updatePriorityByTaskKey("[LOOPER-INT-002]", "P0");
      expect(res.itemId).toBe("ITEM_100");
      expect(res.priority).toBe("P0");
    });

    it("updates Size by task key", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const res = await service.updateSizeByTaskKey("LOOPER-INT-003", "XL");
      expect(res.itemId).toBe("ITEM_200");
      expect(res.size).toBe("XL");
    });

    it("provides convenience methods: markTaskAsDone, markTaskAsInProgress, markTaskAsBacklog", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const doneRes = await service.markTaskAsDone("LOOPER-INT-002");
      expect(doneRes.itemId).toBe("ITEM_100");
      expect(doneRes.status).toBe("Done");

      const inProgRes = await service.markTaskAsInProgress("LOOPER-INT-002");
      expect(inProgRes.status).toBe("In progress");

      const backlogRes = await service.markTaskAsBacklog("LOOPER-INT-003");
      expect(backlogRes.status).toBe("Backlog");
    });

    it("satisfies Gate 3 forensic audit scenario: updates corresponding item Status to Done", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      // WHEN a task passes Gate 3 forensic audit
      const taskKey = "LOOPER-INT-002";
      const result = await service.markTaskAsDone(taskKey);

      // THEN the service updates the corresponding item Status to Done
      expect(result.itemId).toBe("ITEM_100");
      expect(result.status).toBe("Done");
      expect(result.optionId).toBe("OPT_DONE");
    });

    it("throws ITEM_NOT_FOUND when task key is not found", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      try {
        await service.updateStatusByTaskKey("LOOPER-NONEXISTENT-999", "Done");
        expect.unreachable();
      } catch (err) {
        expect(err instanceof GitHubProjectError).toBe(true);
        const ghErr = err as GitHubProjectError;
        expect(ghErr.code).toBe(GITHUB_PROJECT_ERROR_CODES.ITEM_NOT_FOUND);
      }
    });

    it("throws INVALID_ARGUMENT when task key is empty", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      expect(service.updateStatusByTaskKey("", "Done")).rejects.toThrow(
        /Task key cannot be empty/,
      );
    });
  });

  describe("Multi-Field Updates and Helper Aliases", () => {
    it("updates multiple fields sequentially via updateItemFields", async () => {
      const mutatedCalls: string[] = [];
      const service = new GitHubProjectService({
        executor: createMockExecutor({
          onMutation: (vars) => {
            const input = (vars as { input: { fieldId: string } })?.input;
            mutatedCalls.push(input?.fieldId);
          },
        }),
      });

      const res = await service.updateItemFields("ITEM_100", {
        status: "Done",
        priority: "P0",
        size: "L",
      });

      expect(res.itemId).toBe("ITEM_100");
      expect(res.status?.status).toBe("Done");
      expect(res.priority?.priority).toBe("P0");
      expect(res.size?.size).toBe("L");
      expect(mutatedCalls).toEqual([
        "STATUS_FIELD_ID",
        "PRIORITY_FIELD_ID",
        "SIZE_FIELD_ID",
      ]);
    });

    it("provides createItem as an alias for addDraftIssue", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const res = await service.createItem("Draft Task Title", "Task Body");
      expect(res.itemId).toBe("NEW_CREATED_ITEM_ID");
    });

    it("provides listItems as an alias for getAllItems", async () => {
      const service = new GitHubProjectService({
        executor: createMockExecutor(),
      });

      const items = await service.listItems();
      expect(items.length).toBe(2);
      expect(items[0]?.id).toBe("ITEM_100");
      expect(items[1]?.id).toBe("ITEM_200");
    });
  });
});

describe("Error Handling and Exponential Backoff (Task 1.3)", () => {
    describe("Constants, Taxonomy and Classification", () => {
      it("exposes expected backoff constants without magic numbers", () => {
        expect(GITHUB_PROJECT_CONSTANTS.DEFAULT_MAX_RETRIES).toBe(5);
        expect(GITHUB_PROJECT_CONSTANTS.DEFAULT_BASE_BACKOFF_MS).toBe(1000);
        expect(GITHUB_PROJECT_CONSTANTS.DEFAULT_MAX_BACKOFF_MS).toBe(60_000);
        expect(GITHUB_PROJECT_CONSTANTS.DEFAULT_BACKOFF_FACTOR).toBe(2);
        expect(GITHUB_PROJECT_CONSTANTS.DEFAULT_JITTER_MIN).toBe(0.5);
        expect(GITHUB_PROJECT_CONSTANTS.DEFAULT_JITTER_MAX).toBe(1.5);
        expect(GITHUB_PROJECT_CONSTANTS.INITIAL_RETRY_ATTEMPT).toBe(0);
        expect(GITHUB_PROJECT_CONSTANTS.MS_PER_SECOND).toBe(1000);
        expect(GITHUB_PROJECT_ERROR_CODES.NETWORK_ERROR).toBe("GITHUB_PROJECT_NETWORK_ERROR");
        expect(GITHUB_PROJECT_ERROR_CODES.TIMEOUT).toBe("GITHUB_PROJECT_TIMEOUT");
      });

      it("identifies transient network errors via instance methods on GitHubProjectError", () => {
        const netErr = new GitHubProjectError(
          "connect ECONNRESET 140.82.121.4:443",
          GITHUB_PROJECT_ERROR_CODES.NETWORK_ERROR,
        );
        expect(netErr.isTransientNetworkError()).toBe(true);
        expect(netErr.isTransient()).toBe(true);
        expect(netErr.isRetryable()).toBe(true);
        expect(netErr.isRateLimited()).toBe(false);

        const timeoutErr = new GitHubProjectError(
          "Operation timed out",
          GITHUB_PROJECT_ERROR_CODES.TIMEOUT,
        );
        expect(timeoutErr.isTransientNetworkError()).toBe(true);
        expect(timeoutErr.isRetryable()).toBe(true);

        const rateErr = new GitHubProjectError(
          "API rate limit exceeded",
          GITHUB_PROJECT_ERROR_CODES.RATE_LIMITED,
          undefined,
          undefined,
          5000,
        );
        expect(rateErr.isRateLimited()).toBe(true);
        expect(rateErr.isTransient()).toBe(true);
        expect(rateErr.isRetryable()).toBe(true);
        expect(rateErr.retryAfterMs).toBe(5000);

        const nonTransientErr = new GitHubProjectError(
          "Field Status not found in project",
          GITHUB_PROJECT_ERROR_CODES.FIELD_NOT_FOUND,
        );
        expect(nonTransientErr.isTransientNetworkError()).toBe(false);
        expect(nonTransientErr.isTransient()).toBe(false);
        expect(nonTransientErr.isRetryable()).toBe(false);
      });

      it("classifies transient network errors using isTransientNetworkError", () => {
        expect(isTransientNetworkError(new Error("socket hang up"))).toBe(true);
        expect(isTransientNetworkError(new Error("read ECONNRESET"))).toBe(true);
        expect(isTransientNetworkError(new Error("connect ETIMEDOUT 192.30.255.112:443"))).toBe(true);
        expect(isTransientNetworkError(new Error("503 Service Unavailable"))).toBe(true);
        expect(isTransientNetworkError(new Error("502 Bad Gateway"))).toBe(true);
        expect(isTransientNetworkError(new Error("504 Gateway Timeout"))).toBe(true);
        expect(isTransientNetworkError(new Error("temporary failure in name resolution"))).toBe(true);
        expect(isTransientNetworkError(new Error("fetch failed"))).toBe(true);

        const sysErr = new Error("System socket failure");
        (sysErr as unknown as { code: string }).code = "ECONNRESET";
        expect(isTransientNetworkError(sysErr)).toBe(true);

        expect(isTransientNetworkError({ status: 503 })).toBe(true);
        expect(isTransientNetworkError({ statusCode: 502 })).toBe(true);
        expect(isTransientNetworkError({ type: "SERVICE_UNAVAILABLE" })).toBe(true);

        expect(isTransientNetworkError(new Error("Invalid syntax: mutation update"))).toBe(false);
        expect(isTransientNetworkError(new Error("Resource not found"))).toBe(false);
        expect(isTransientNetworkError(null)).toBe(false);
        expect(isTransientNetworkError(undefined)).toBe(false);
      });

      it("classifies rate limit errors using isRateLimitError", () => {
        expect(isRateLimitError(new Error("API rate limit exceeded"))).toBe(true);
        expect(isRateLimitError(new Error("secondary rate limit reached"))).toBe(true);
        expect(isRateLimitError(new Error("HTTP 429 Too Many Requests"))).toBe(true);
        expect(isRateLimitError({ status: 429 })).toBe(true);
        expect(isRateLimitError({ type: "RATE_LIMITED" })).toBe(true);
        expect(isRateLimitError(new Error("Normal database failure"))).toBe(false);
      });

      it("classifies retryable errors using isRetryableError", () => {
        expect(isRetryableError(new Error("rate limit exceeded"))).toBe(true);
        expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
        expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
        expect(isRetryableError(new Error("Field 'Unknown' not found"))).toBe(false);
        expect(isRetryableError(new Error("Invalid mutation arguments"))).toBe(false);
      });

      it("extracts retry-after duration via extractRetryAfterMs", () => {
        const errWithMs = new GitHubProjectError(
          "Rate limit",
          GITHUB_PROJECT_ERROR_CODES.RATE_LIMITED,
          undefined,
          undefined,
          4500,
        );
        expect(extractRetryAfterMs(errWithMs)).toBe(4500);

        expect(extractRetryAfterMs(new Error("Retry after 30 seconds"))).toBe(30_000);
        expect(extractRetryAfterMs(new Error("retry-after: 15"))).toBe(15_000);
        expect(extractRetryAfterMs(new Error("rate limited; retry after 500ms"))).toBe(500);

        expect(
          extractRetryAfterMs({
            details: {
              headers: { "retry-after": "45" },
            },
          }),
        ).toBe(45_000);

        expect(
          extractRetryAfterMs({
            details: {
              retryAfter: 12,
            },
          }),
        ).toBe(12_000);

        expect(extractRetryAfterMs(new Error("General failure without delay header"))).toBeNull();
        expect(extractRetryAfterMs(null)).toBeNull();
        expect(extractRetryAfterMs(undefined)).toBeNull();
      });
    });

    describe("Exponential Backoff Calculation", () => {
      it("computes exact exponential backoff progression without jitter", () => {
        const opts: BackoffOptions = {
          baseDelayMs: 1000,
          maxDelayMs: 60_000,
          backoffFactor: 2,
          useJitter: false,
        };

        expect(calculateExponentialBackoffDelay(0, opts)).toBe(1000);
        expect(calculateExponentialBackoffDelay(1, opts)).toBe(2000);
        expect(calculateExponentialBackoffDelay(2, opts)).toBe(4000);
        expect(calculateExponentialBackoffDelay(3, opts)).toBe(8000);
        expect(calculateExponentialBackoffDelay(4, opts)).toBe(16_000);
      });

      it("clamps computed backoff delay at maxDelayMs", () => {
        const opts: BackoffOptions = {
          baseDelayMs: 1000,
          maxDelayMs: 5000,
          backoffFactor: 2,
          useJitter: false,
        };

        expect(calculateExponentialBackoffDelay(0, opts)).toBe(1000);
        expect(calculateExponentialBackoffDelay(1, opts)).toBe(2000);
        expect(calculateExponentialBackoffDelay(2, opts)).toBe(4000);
        expect(calculateExponentialBackoffDelay(3, opts)).toBe(5000);
        expect(calculateExponentialBackoffDelay(4, opts)).toBe(5000);
      });

      it("applies jitter within configured min and max bounds", () => {
        const opts: BackoffOptions = {
          baseDelayMs: 1000,
          maxDelayMs: 60_000,
          backoffFactor: 2,
          jitterMin: 0.5,
          jitterMax: 1.5,
          useJitter: true,
        };

        for (let attempt = 0; attempt < 5; attempt++) {
          const raw = 1000 * Math.pow(2, attempt);
          const minExpected = Math.round(raw * 0.5);
          const maxExpected = Math.round(raw * 1.5);
          const delay = calculateExponentialBackoffDelay(attempt, opts);
          expect(delay).toBeGreaterThanOrEqual(minExpected);
          expect(delay).toBeLessThanOrEqual(maxExpected);
        }
      });

      it("defaults to standard constants when options are omitted", () => {
        const delay = calculateExponentialBackoffDelay(0, { useJitter: false });
        expect(delay).toBe(GITHUB_PROJECT_CONSTANTS.DEFAULT_BASE_BACKOFF_MS);
      });
    });

    describe("executeWithRetry Utility Function", () => {
      it("returns immediately on first attempt when no error occurs", async () => {
        let sleepCalled = false;
        let calls = 0;

        const result = await executeWithRetry(
          async () => {
            calls += 1;
            return "success_payload";
          },
          {
            sleepFn: async () => {
              sleepCalled = true;
            },
          },
        );

        expect(result).toBe("success_payload");
        expect(calls).toBe(1);
        expect(sleepCalled).toBe(false);
      });

      it("retries on transient network errors and succeeds after recovery", async () => {
        let attempts = 0;
        const delaysRecorded: number[] = [];

        const result = await executeWithRetry(
          async (attempt) => {
            attempts = attempt;
            if (attempt < 2) {
              throw new Error("socket hang up (ECONNRESET)");
            }
            return { status: "recovered", finalAttempt: attempt };
          },
          {
            maxRetries: 3,
            baseDelayMs: 100,
            useJitter: false,
            sleepFn: async (delay) => {
              delaysRecorded.push(delay);
            },
          },
        );

        expect(result).toEqual({ status: "recovered", finalAttempt: 2 });
        expect(attempts).toBe(2);
        expect(delaysRecorded).toEqual([100, 200]);
      });

      it("retries on rate limit errors and honors retry-after duration", async () => {
        let attempts = 0;
        const delaysRecorded: number[] = [];

        const result = await executeWithRetry(
          async (attempt) => {
            attempts = attempt;
            if (attempt === 0) {
              throw new Error("API rate limit exceeded. Retry after 3 seconds");
            }
            return "ok_after_rate_limit";
          },
          {
            maxRetries: 3,
            useJitter: false,
            sleepFn: async (delay) => {
              delaysRecorded.push(delay);
            },
          },
        );

        expect(result).toBe("ok_after_rate_limit");
        expect(attempts).toBe(1);
        expect(delaysRecorded).toEqual([3000]);
      });

      it("re-throws immediately on non-retryable errors without retrying", async () => {
        let attempts = 0;
        let sleepCalled = false;

        const nonRetryableCall = executeWithRetry(
          async (attempt) => {
            attempts = attempt;
            throw new GitHubProjectError(
              "Project not found",
              GITHUB_PROJECT_ERROR_CODES.PROJECT_NOT_FOUND,
            );
          },
          {
            maxRetries: 3,
            sleepFn: async () => {
              sleepCalled = true;
            },
          },
        );

        expect(nonRetryableCall).rejects.toThrow(GitHubProjectError);
        expect(attempts).toBe(0);
        expect(sleepCalled).toBe(false);
      });

      it("re-throws the final error when retries are exhausted", async () => {
        let attempts = 0;
        const delaysRecorded: number[] = [];

        const exhaustedCall = executeWithRetry(
          async (attempt) => {
            attempts = attempt;
            throw new Error("503 Service Unavailable");
          },
          {
            maxRetries: 3,
            baseDelayMs: 50,
            useJitter: false,
            sleepFn: async (delay) => {
              delaysRecorded.push(delay);
            },
          },
        );

        expect(exhaustedCall).rejects.toThrow(/503 Service Unavailable/);
        expect(attempts).toBe(3);
        expect(delaysRecorded.length).toBe(3);
        expect(delaysRecorded).toEqual([50, 100, 200]);
      });

      it("invokes onRetry callback with error, attempt, and delayMs", async () => {
        const retryEvents: Array<{ errorMsg: string; attempt: number; delayMs: number }> = [];

        const result = await executeWithRetry(
          async (attempt) => {
            if (attempt < 2) {
              throw new Error(`socket hang up at step ${attempt}`);
            }
            return "done";
          },
          {
            maxRetries: 3,
            baseDelayMs: 50,
            useJitter: false,
            sleepFn: async () => {},
            onRetry: (err, attempt, delayMs) => {
              retryEvents.push({
                errorMsg: (err as Error).message,
                attempt,
                delayMs,
              });
            },
          },
        );

        expect(result).toBe("done");
        expect(retryEvents).toEqual([
          { errorMsg: "socket hang up at step 0", attempt: 1, delayMs: 50 },
          { errorMsg: "socket hang up at step 1", attempt: 2, delayMs: 100 },
        ]);
      });

      it("does not retry when maxRetries is 0", async () => {
        let callCount = 0;

        const call = executeWithRetry(
          async () => {
            callCount += 1;
            throw new Error("503 Service Unavailable");
          },
          {
            maxRetries: 0,
            sleepFn: async () => {},
          },
        );

        expect(call).rejects.toThrow(/503 Service Unavailable/);
        expect(callCount).toBe(1);
      });
    });

    describe("GitHubProjectService Integration with Backoff and Retry", () => {
      it("transparently retries on transient network error during query execution", async () => {
        let attempts = 0;
        const service = new GitHubProjectService({
          baseDelayMs: 10,
          maxRetries: 3,
          useJitter: false,
          executor: async () => {
            attempts += 1;
            if (attempts < 3) {
              throw new Error("connect ECONNRESET");
            }
            return {
              data: {
                user: {
                  projectV2: {
                    id: "PVT_RECOVERED",
                    title: "Recovered Project",
                    number: 4,
                    fields: { nodes: [] },
                  },
                },
              },
            };
          },
        });

        const details = await service.getProjectDetails();
        expect(details.id).toBe("PVT_RECOVERED");
        expect(attempts).toBe(3);
      });

      it("transparently retries on rate limit GraphQL response during query execution", async () => {
        let attempts = 0;
        const service = new GitHubProjectService({
          baseDelayMs: 10,
          maxRetries: 3,
          useJitter: false,
          executor: async () => {
            attempts += 1;
            if (attempts === 1) {
              return {
                errors: [
                  {
                    message: "API rate limit exceeded. Retry after 100ms",
                    type: "RATE_LIMITED",
                  },
                ],
              };
            }
            return {
              data: {
                user: {
                  projectV2: {
                    id: "PVT_RECOVERED_FROM_RATELIMIT",
                    title: "Recovered Rate Limit",
                    number: 4,
                    fields: { nodes: [] },
                  },
                },
              },
            };
          },
        });

        const details = await service.getProjectDetails();
        expect(details.id).toBe("PVT_RECOVERED_FROM_RATELIMIT");
        expect(attempts).toBe(2);
      });

      it("retries mutations upon transient failure and returns mutation result", async () => {
        let mutationCalls = 0;
        const mockFields = [
          {
            id: "STATUS_FIELD_ID",
            name: "Status",
            dataType: "SINGLE_SELECT",
            options: [
              { id: "OPT_DONE", name: "Done" },
            ],
          },
        ];

        const service = new GitHubProjectService({
          projectId: "PVT_MUT_TEST",
          baseDelayMs: 10,
          maxRetries: 3,
          useJitter: false,
          executor: async (query) => {
            if (query.includes("GetProjectByUser")) {
              return {
                data: {
                  user: {
                    projectV2: {
                      id: "PVT_MUT_TEST",
                      title: "Mutation Test Project",
                      number: 4,
                      fields: { nodes: mockFields },
                    },
                  },
                },
              };
            }

            if (query.includes("UpdateProjectV2ItemFieldValue")) {
              mutationCalls += 1;
              if (mutationCalls < 2) {
                throw new Error("HTTP 502 Bad Gateway");
              }
              return {
                data: {
                  updateProjectV2ItemFieldValue: {
                    projectV2Item: { id: "ITEM_MUT_RECOVERED" },
                  },
                },
              };
            }

            return {};
          },
        });

        const res = await service.updateItemStatus("ITEM_MUT_RECOVERED", "Done");
        expect(res.itemId).toBe("ITEM_MUT_RECOVERED");
        expect(res.status).toBe("Done");
        expect(mutationCalls).toBe(2);
      });

      it("triggers onRetry callback configured on GitHubProjectService", async () => {
        const onRetryEvents: Array<{ attempt: number; delayMs: number }> = [];

        let attempts = 0;
        const service = new GitHubProjectService({
          baseDelayMs: 25,
          maxRetries: 2,
          useJitter: false,
          onRetry: (_err, attempt, delayMs) => {
            onRetryEvents.push({ attempt, delayMs });
          },
          executor: async () => {
            attempts += 1;
            if (attempts <= 2) {
              throw new Error("503 Service Unavailable");
            }
            return {
              data: {
                user: {
                  projectV2: {
                    id: "PVT_ONRETRY_TEST",
                    title: "OnRetry Test",
                    number: 4,
                    fields: { nodes: [] },
                  },
                },
              },
            };
          },
        });

        const details = await service.getProjectDetails();
        expect(details.id).toBe("PVT_ONRETRY_TEST");
        expect(attempts).toBe(3);
        expect(onRetryEvents.length).toBe(2);
        expect(onRetryEvents[0]?.attempt).toBe(1);
        expect(onRetryEvents[1]?.attempt).toBe(2);
      });

      it("exhausts retries and rethrows RATE_LIMITED error when rate limits persist", async () => {
        let attempts = 0;
        const service = new GitHubProjectService({
          baseDelayMs: 5,
          maxRetries: 2,
          useJitter: false,
          executor: async () => {
            attempts += 1;
            return {
              errors: [
                {
                  message: "API rate limit exceeded",
                  type: "RATE_LIMITED",
                },
              ],
            };
          },
        });

        try {
          await service.getProjectDetails();
          expect.unreachable();
        } catch (err) {
          expect(err instanceof GitHubProjectError).toBe(true);
          const ghErr = err as GitHubProjectError;
          expect(ghErr.code).toBe(GITHUB_PROJECT_ERROR_CODES.RATE_LIMITED);
          expect(ghErr.isRateLimited()).toBe(true);
        }
        expect(attempts).toBe(3); // 1 initial + 2 retries
      });

      it("exhausts retries and rethrows NETWORK_ERROR when network failures persist", async () => {
        let attempts = 0;
        const service = new GitHubProjectService({
          baseDelayMs: 5,
          maxRetries: 2,
          useJitter: false,
          executor: async () => {
            attempts += 1;
            throw new GitHubProjectError(
              "Connection reset by peer",
              GITHUB_PROJECT_ERROR_CODES.NETWORK_ERROR,
            );
          },
        });

        try {
          await service.getProjectDetails();
          expect.unreachable();
        } catch (err) {
          expect(err instanceof GitHubProjectError).toBe(true);
          const ghErr = err as GitHubProjectError;
          expect(ghErr.code).toBe(GITHUB_PROJECT_ERROR_CODES.NETWORK_ERROR);
          expect(ghErr.isTransientNetworkError()).toBe(true);
        }
        expect(attempts).toBe(3); // 1 initial + 2 retries
      });

      it("does not retry non-transient errors like PROJECT_NOT_FOUND", async () => {
        let attempts = 0;
        const service = new GitHubProjectService({
          maxRetries: 5,
          executor: async () => {
            attempts += 1;
            return {
              data: {
                user: {
                  projectV2: null,
                },
              },
            };
          },
        });

        expect(service.getProjectDetails()).rejects.toThrow(
          /Project #4 not found/,
        );
        expect(attempts).toBe(1);
      });

      it("disables retries when maxRetries is set to 0", async () => {
        let attempts = 0;
        const service = new GitHubProjectService({
          maxRetries: 0,
          executor: async () => {
            attempts += 1;
            throw new Error("connect ECONNRESET");
          },
        });

        expect(service.getProjectDetails()).rejects.toThrow(/ECONNRESET/);
        expect(attempts).toBe(1);
      });

      it("exposes configured retry options via getRetryConfig()", () => {
        const service = new GitHubProjectService({
          maxRetries: 7,
          baseDelayMs: 250,
          maxDelayMs: 15_000,
          backoffFactor: 3,
          jitterMin: 0.8,
          jitterMax: 1.2,
        });

        const retryCfg = service.getRetryConfig();
        expect(retryCfg.maxRetries).toBe(7);
        expect(retryCfg.baseDelayMs).toBe(250);
        expect(retryCfg.maxDelayMs).toBe(15_000);
        expect(retryCfg.backoffFactor).toBe(3);
        expect(retryCfg.jitterMin).toBe(0.8);
        expect(retryCfg.jitterMax).toBe(1.2);
      });
  });
});
