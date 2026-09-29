import { edgeKey } from "../src/causal/hypothesis.js";
import type { Hypothesis, InterventionTrial } from "../src/causal/types.js";
import type { Var } from "../src/world/state.js";
import { isTrueEdge, type TrueEdge } from "./oracle.js";

export interface MinimalMetrics {
  edgeDiscovery: number;
  spuriousRejection: number;
  /**
   * Accuracy of predictions *derived from the hypothesis under test*.
   * A false H that predicts the wrong Δ is expected to score low —
   * that failure is what enables falsification.
   *
   * Reserved for later: causalModelPredictionAccuracy,
   * causalPrecision, causalRecall, spuriousRejectionRate.
   */
  hypothesisPredictionAccuracy: number;
  details: {
    discoveredTrueEdges: string[];
    spuriousDead: boolean;
    trialsTotal: number;
    trialsHypothesisCorrect: number;
  };
}

export function computeMinimalMetrics(
  hypotheses: Hypothesis[],
  trials: InterventionTrial[],
  opts: {
    trueEdges: readonly TrueEdge[];
    spuriousEdge?: { cause: Var; effect: Var };
  },
): MinimalMetrics {
  const { trueEdges, spuriousEdge } = opts;

  const discoveredTrueEdges = hypotheses
    .filter((h) => h.status === "supported" || h.status === "causal")
    .filter((h) => isTrueEdge(trueEdges, h.cause, h.effect))
    .map((h) => edgeKey(h.cause, h.effect));

  const edgeDiscovery =
    trueEdges.length === 0
      ? 0
      : discoveredTrueEdges.length / trueEdges.length;

  let spuriousRejection = 0;
  let spuriousDead = false;
  if (spuriousEdge) {
    const spuriousHyp = hypotheses.find(
      (h) => h.cause === spuriousEdge.cause && h.effect === spuriousEdge.effect,
    );
    spuriousDead = spuriousHyp?.status === "dead";
    spuriousRejection = spuriousDead ? 1 : 0;
  }

  const trialsTotal = trials.length;
  const trialsHypothesisCorrect = trials.filter(
    (t) => t.hypothesisPredictionCorrect,
  ).length;
  const hypothesisPredictionAccuracy =
    trialsTotal === 0 ? 0 : trialsHypothesisCorrect / trialsTotal;

  return {
    edgeDiscovery,
    spuriousRejection,
    hypothesisPredictionAccuracy,
    details: {
      discoveredTrueEdges,
      spuriousDead,
      trialsTotal,
      trialsHypothesisCorrect,
    },
  };
}
