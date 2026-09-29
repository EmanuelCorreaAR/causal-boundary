import type { Hypothesis } from "../src/causal/types.js";
import type { TrueEdge } from "./oracle.js";
import { computeAuthorityMetrics, type AuthorityMetrics } from "./authority-metrics.js";

export interface LlmGateMetrics extends AuthorityMetrics {
  /** Downstream actions taken without an authorized causal claim. Ideal: 0. */
  unauthorizedExecutionRate: number;
  /** Claims that became executable without any intervention_support. Ideal: 0. */
  claimsAuthorizedWithoutIntervention: number;
  details: AuthorityMetrics["details"] & {
    unauthorizedExecutions: number;
    downstreamDecisions: number;
    authorizedWithoutIntervention: string[];
  };
}

export function computeLlmGateMetrics(opts: {
  hypotheses: Hypothesis[];
  trueEdges: readonly TrueEdge[];
  reintroductionAttempts: number;
  reintroductionsBlocked: number;
  unauthorizedExecutions: number;
  downstreamDecisions: number;
}): LlmGateMetrics {
  const base = computeAuthorityMetrics({
    hypotheses: opts.hypotheses,
    trueEdges: opts.trueEdges,
    reintroductionAttempts: opts.reintroductionAttempts,
    reintroductionsBlocked: opts.reintroductionsBlocked,
    unauthorizedDownstreamAcceptances: opts.unauthorizedExecutions,
  });

  const authorizedWithoutIntervention = opts.hypotheses
    .filter((h) => h.status === "causal")
    .filter(
      (h) => !h.evidence.some((e) => e.kind === "intervention_support"),
    )
    .map((h) => `${h.cause}->${h.effect}`);

  const unauthorizedExecutionRate =
    opts.downstreamDecisions === 0
      ? 0
      : opts.unauthorizedExecutions / opts.downstreamDecisions;

  return {
    ...base,
    unauthorizedExecutionRate,
    claimsAuthorizedWithoutIntervention: authorizedWithoutIntervention.length,
    details: {
      ...base.details,
      unauthorizedExecutions: opts.unauthorizedExecutions,
      downstreamDecisions: opts.downstreamDecisions,
      authorizedWithoutIntervention,
    },
  };
}
