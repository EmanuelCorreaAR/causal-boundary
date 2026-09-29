import { FixedHypothesizer } from "../../src/agents/fixed-hypothesizer.js";
import { CausalBoundary } from "../../src/causal/boundary.js";
import type { Hypothesis, InterventionTrial } from "../../src/causal/types.js";
import { roosterModel } from "../../src/world/models/rooster.js";
import { World } from "../../src/world/world.js";
import { computeMinimalMetrics, type MinimalMetrics } from "../metrics.js";
import { ROOSTER_TRUE_EDGES } from "../oracle.js";

export interface ConfirmationRunResult {
  observations: ReturnType<CausalBoundary["getObservations"]>;
  hypotheses: Hypothesis[];
  trials: InterventionTrial[];
  metrics: MinimalMetrics;
  narrative: string[];
}

/**
 * v0.2 Confirmation:
 * hypothesize sunrise → rooster, two agreeing interventions → supported → causal.
 */
export async function runConfirmation(opts?: {
  observationCount?: number;
  seedRng?: () => number;
}): Promise<ConfirmationRunResult> {
  const observationCount = opts?.observationCount ?? 5;
  const narrative: string[] = [];

  const world = new World(roosterModel, undefined, opts?.seedRng);
  const hypothesizer = new FixedHypothesizer(
    { cause: "sunrise", effect: "rooster" },
    0.7,
  );
  const boundary = new CausalBoundary(world, hypothesizer);

  for (let i = 0; i < observationCount; i++) {
    const obs = boundary.observeFresh(["sunrise", "rooster"]);
    narrative.push(
      `observe#${i + 1}: sunrise=${obs.sunrise}, rooster=${obs.rooster}`,
    );
  }

  world.do({ variable: "sunrise", value: true });
  const aligned = boundary.observe(["sunrise", "rooster"]);
  narrative.push(
    `aligned observe: sunrise=${aligned.sunrise}, rooster=${aligned.rooster}`,
  );

  const accepted = await boundary.ingestProposals(aligned);
  for (const h of accepted) {
    narrative.push(
      `hypothesis ${h.id}: ${h.cause} → ${h.effect} status=${h.status} confidence=${h.confidence}`,
    );
  }

  if (accepted.length === 0) {
    throw new Error("Confirmation: hypothesizer produced no usable proposal");
  }

  const target = accepted[0]!;

  const t1 = boundary.testHypothesis(target, false);
  narrative.push(
    `do(sunrise=false): rooster ${t1.before.rooster} → ${t1.after.rooster}`,
  );
  narrative.push(
    `hypothesisPrediction correct=${t1.hypothesisPredictionCorrect}; status=${target.status}`,
  );

  const t2 = boundary.testHypothesis(target, true);
  narrative.push(
    `do(sunrise=true): rooster ${t2.before.rooster} → ${t2.after.rooster}`,
  );
  narrative.push(
    `hypothesisPrediction correct=${t2.hypothesisPredictionCorrect}; status=${target.status}`,
  );

  const hypotheses = boundary.getHypotheses();
  const trials = boundary.getTrials();
  const metrics = computeMinimalMetrics(hypotheses, trials, {
    trueEdges: ROOSTER_TRUE_EDGES,
  });

  return {
    observations: boundary.getObservations(),
    hypotheses,
    trials,
    metrics,
    narrative,
  };
}
