/**
 * Surface-Aware Verification Engine for openspec-cascade.
 *
 * Inspects modified files to classify affected surfaces (frontend UI, backend API, core library)
 * and determines the mandatory verification strategy.
 */

import { CONSTANTS } from "../../config";

export interface SurfaceReport {
  surfaces: {
    frontend: boolean;
    backend: boolean;
    core: boolean;
  };
  detectedFiles: {
    frontend: string[];
    backend: string[];
    core: string[];
  };
  recommendedChecks: string[];
}

/**
 * Classifies an array of modified file paths by runtime surface.
 */
export function classifySurfaces(filePaths: string[]): SurfaceReport {
  const frontendFiles: string[] = [];
  const backendFiles: string[] = [];
  const coreFiles: string[] = [];

  for (const fp of filePaths) {
    const low = ("/" + fp.toLowerCase().replace(/\\/g, "/"));

    const isFrontend = CONSTANTS.SDD_FRONTEND_EXTENSIONS.some((ext) => low.endsWith(ext));
    const isBackend = CONSTANTS.SDD_API_PATH_PATTERNS.some((pat) => low.includes(pat));

    if (isFrontend) {
      frontendFiles.push(fp);
    } else if (isBackend) {
      backendFiles.push(fp);
    } else {
      coreFiles.push(fp);
    }
  }

  const hasFrontend = frontendFiles.length > 0;
  const hasBackend = backendFiles.length > 0;
  const hasCore = coreFiles.length > 0;

  const recommendedChecks: string[] = [...CONSTANTS.DEFAULT_VERIFY];

  if (hasFrontend) {
    recommendedChecks.push("sdd-verify:frontend-render-check");
  }
  if (hasBackend) {
    recommendedChecks.push("sdd-verify:api-contract-smoke");
  }

  return {
    surfaces: {
      frontend: hasFrontend,
      backend: hasBackend,
      core: hasCore,
    },
    detectedFiles: {
      frontend: frontendFiles,
      backend: backendFiles,
      core: coreFiles,
    },
    recommendedChecks,
  };
}
