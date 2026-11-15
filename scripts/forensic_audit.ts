/**
 * Forensic audit CLI gate. Audits the milestone-scoped path set and exits
 * non-zero when any constitution violation is found.
 */
import { EXIT_CODE_CONSTANTS, RUNTIME_CONSTANTS } from "../src/config/constants";
import { FORENSIC_AUDIT_SCOPE, auditFiles, formatForensicReport } from "../src/audit/forensic";

const scopeArguments = process.argv.slice(RUNTIME_CONSTANTS.ARGV_START_INDEX);
const report = auditFiles(process.cwd(), scopeArguments.length > 0 ? scopeArguments : FORENSIC_AUDIT_SCOPE);
console.log(formatForensicReport(report));
process.exitCode = report.violations.length === 0
  ? EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS
  : EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR;
