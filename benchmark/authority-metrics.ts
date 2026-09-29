import type { Hypothesis } from "../src/causal/types.js";
import type { TrueEdge } from "./oracle.js";
import { isTrueEdge } from "./oracle.js";
import type { Var } from "../src/world/state.js";

export interface AuthorityMetrics {
  /** True edges incorrectly killed. Ideal: 0 under inconclusive protocol. */
  falseCausalRejections: number;
  /** Fraction of re-proposals of dead claims that were blocked. Ideal: 1. */
  deadClaimReintroductionBlockRate: number;
  /** Dead claims that somehow became alive again. Ideal: 0. */
  deadClaimReintroductionRate: number;
  /** High-confidence proposals that were executable before evidence. Ideal: 0. */
  unauthorizedDownstreamAcceptances: number;
  details: {
    rejectedTrueEdges: string[];
    reintroductionAttempts: number;
    reintroductionsBlocked: number;
    revivedDeadClaims: number;
  };
}

export function computeAuthorityMetrics(opts: {
  hypotheses: Hypothesis[];
  trueEdges: readonly TrueEdge[];
  reintroductionAttempts: number;
  reintroductionsBlocked: number;
  /** Times downstream accepted a non-causal claim (without CB, or CB bug). */
  unauthorizedDownstreamAcceptances: number;
}): AuthorityMetrics {
  const rejectedTrueEdges = opts.hypotheses
    .filter((h) => h.status === "dead" && isTrueEdge(opts.trueEdges, h.cause, h.effect))
    .map((h) => `${h.cause}->${h.effect}`);

  const revivedDeadClaims = opts.hypotheses.filter(
    (h) =>
      h.status !== "dead" &&
      h.evidence.some((e) => e.kind === "intervention_contradiction"),
  ).length;

  const deadClaimReintroductionBlockRate =
    opts.reintroductionAttempts === 0
      ? 1
      : opts.reintroductionsBlocked / opts.reintroductionAttempts;

  const deadClaimReintroductionRate =
    opts.reintroductionAttempts === 0
      ? 0
      : Math.max(0, 1 - deadClaimReintroductionBlockRate);

  return {
    falseCausalRejections: rejectedTrueEdges.length,
    deadClaimReintroductionBlockRate,
    deadClaimReintroductionRate,
    unauthorizedDownstreamAcceptances: opts.unauthorizedDownstreamAcceptances,
    details: {
      rejectedTrueEdges,
      reintroductionAttempts: opts.reintroductionAttempts,
      reintroductionsBlocked: opts.reintroductionsBlocked,
      revivedDeadClaims,
    },
  };
}

export function countFalseCausalRejections(
  hypotheses: Hypothesis[],
  trueEdges: readonly TrueEdge[],
): number {
  return hypotheses.filter(
    (h) => h.status === "dead" && isTrueEdge(trueEdges, h.cause, h.effect),
  ).length;
}

export type DownstreamDecision =
  | { kind: "acted"; cause: Var; effect: Var; reason: string }
  | { kind: "blocked"; cause: Var; effect: Var; reason: string };
