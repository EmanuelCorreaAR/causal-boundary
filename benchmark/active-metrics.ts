import type { InterventionTrial } from "../src/causal/types.js";
import type { Hypothesis } from "../src/causal/types.js";
import type { TrueEdge } from "./oracle.js";
import type { Var } from "../src/world/state.js";

export interface ActiveSelectionMetrics {
  experimentsToResolution: number;
  hypothesesResolvedPerExperiment: number;
  resolved: boolean;
  initialHypothesisCount: number;
  resolvedHypothesisCount: number;
}

/**
 * Resolution for competing explanations: spurious dead, every true edge
 * at least supported|causal, and no hyp left in proposed/weak.
 */
export function isExplanationSetResolved(
  hypotheses: Hypothesis[],
  trueEdges: readonly TrueEdge[],
  spuriousEdge: { cause: Var; effect: Var },
): boolean {
  const spurious = hypotheses.find(
    (h) => h.cause === spuriousEdge.cause && h.effect === spuriousEdge.effect,
  );
  if (spurious?.status !== "dead") return false;

  for (const [cause, effect] of trueEdges) {
    const h = hypotheses.find((x) => x.cause === cause && x.effect === effect);
    if (!h || (h.status !== "supported" && h.status !== "causal")) return false;
  }

  return hypotheses.every(
    (h) =>
      h.status === "dead" ||
      h.status === "supported" ||
      h.status === "causal",
  );
}

export function computeActiveSelectionMetrics(
  hypotheses: Hypothesis[],
  experiments: number,
  opts: {
    trueEdges: readonly TrueEdge[];
    spuriousEdge: { cause: Var; effect: Var };
    initialHypothesisCount: number;
  },
): ActiveSelectionMetrics {
  const resolved = isExplanationSetResolved(
    hypotheses,
    opts.trueEdges,
    opts.spuriousEdge,
  );
  const resolvedHypothesisCount = hypotheses.filter(
    (h) =>
      h.status === "dead" ||
      h.status === "supported" ||
      h.status === "causal",
  ).length;

  return {
    experimentsToResolution: experiments,
    hypothesesResolvedPerExperiment:
      experiments === 0 ? 0 : resolvedHypothesisCount / experiments,
    resolved,
    initialHypothesisCount: opts.initialHypothesisCount,
    resolvedHypothesisCount,
  };
}

/** Keep unused import lint-friendly for trial-aware extensions later. */
export type { InterventionTrial };
