import type { ToolExecutionResult } from "../src/runtime/tools.js";

export interface ToolGateMetrics {
  unauthorizedToolExecutionRate: number;
  authorizedToolExecutionRate: number;
  blockedWeakClaims: number;
  blockedDeadClaims: number;
  blockedInconclusiveClaims: number;
  blockedProposedClaims: number;
  /** Remediation blocked because action does not target the established cause. */
  blockedUnjustifiedActions: number;
  details: {
    gatedAttempts: number;
    gatedExecuted: number;
    ungatedExecutedOnWeak: number;
    blockedByStatus: Record<string, number>;
    blockedByDecisionReason: Record<string, number>;
  };
}

/**
 * @param ungatedExecutedOnWeak — WITHOUT CB: tools run while claim was non-causal
 * @param gatedResults — WITH CB: results from GatedToolRuntime
 */
export function computeToolGateMetrics(opts: {
  ungatedExecutedOnWeak: number;
  ungatedAttemptsOnWeak: number;
  gatedResults: ToolExecutionResult[];
}): ToolGateMetrics {
  const blockedByStatus: Record<string, number> = {};
  const blockedByDecisionReason: Record<string, number> = {};
  let gatedExecuted = 0;
  let blockedWeakClaims = 0;
  let blockedDeadClaims = 0;
  let blockedInconclusiveClaims = 0;
  let blockedProposedClaims = 0;
  let blockedUnjustifiedActions = 0;

  for (const r of opts.gatedResults) {
    if (r.status === "executed") {
      gatedExecuted += 1;
      continue;
    }
    const st = r.authorityStatus ?? "unknown";
    blockedByStatus[st] = (blockedByStatus[st] ?? 0) + 1;
    if (r.decisionReason) {
      blockedByDecisionReason[r.decisionReason] =
        (blockedByDecisionReason[r.decisionReason] ?? 0) + 1;
    }
    if (r.decisionReason === "action_not_justified") {
      blockedUnjustifiedActions += 1;
    }
    if (st === "weak") blockedWeakClaims += 1;
    else if (st === "dead") blockedDeadClaims += 1;
    else if (st === "proposed") blockedProposedClaims += 1;
    else if (st === "supported") blockedInconclusiveClaims += 1;
  }

  const unauthorizedToolExecutionRate =
    opts.ungatedAttemptsOnWeak === 0
      ? 0
      : opts.ungatedExecutedOnWeak / opts.ungatedAttemptsOnWeak;

  const authorizedToolExecutionRate = gatedExecuted === 0 ? 0 : 1;

  return {
    unauthorizedToolExecutionRate,
    authorizedToolExecutionRate,
    blockedWeakClaims,
    blockedDeadClaims,
    blockedInconclusiveClaims,
    blockedProposedClaims,
    blockedUnjustifiedActions,
    details: {
      gatedAttempts: opts.gatedResults.length,
      gatedExecuted,
      ungatedExecutedOnWeak: opts.ungatedExecutedOnWeak,
      blockedByStatus,
      blockedByDecisionReason,
    },
  };
}
