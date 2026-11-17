import { z } from "zod";
import { HARDENING_CONSTANTS, MANIFEST_CONSTANTS } from "../config/constants";

const ONE_LINE = /^[^\r\n]+$/;
const QUOTE_OR_DOLLAR = /['"$]/;

const checkSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "check is blank")
  .refine((value) => !QUOTE_OR_DOLLAR.test(value) && !HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN.test(value), "check is unsafe");

export const ManifestEntrySchema = z
  .object({
    name: z.string().regex(ONE_LINE, "name is required"),
    type: z.enum(MANIFEST_CONSTANTS.ENTRY_TYPES),
    whenToUse: z
      .string()
      .regex(ONE_LINE, "whenToUse is required")
      .max(MANIFEST_CONSTANTS.WHEN_TO_USE_MAX_LENGTH, `whenToUse is longer than ${MANIFEST_CONSTANTS.WHEN_TO_USE_MAX_LENGTH} characters`),
    required: z.boolean().default(false),
    check: checkSchema.optional(),
    profile: z.string().regex(MANIFEST_CONSTANTS.PROFILE_PATTERN).optional(),
    hosts: z
      .array(z.enum(MANIFEST_CONSTANTS.HOSTS))
      .refine((hosts) => new Set(hosts).size === hosts.length, "hosts has duplicates")
      .optional(),
  })
  .strict();

export const ManifestLayerSchema = z.object({ entries: z.array(z.unknown()) }).strict();

export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;
export type ManifestLayerName = "global" | "project";
export type MergedEntry = ManifestEntry & { layer: ManifestLayerName };
export interface ManifestPaths {
  home: string;
  xdgConfigHome: string;
}
