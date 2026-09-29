import { FixedHypothesizer } from "../../src/agents/fixed-hypothesizer.js";
import { CausalBoundary } from "../../src/causal/boundary.js";
import type { Hypothesis, InterventionTrial } from "../../src/causal/types.js";
import { roosterModel } from "../../src/world/models/rooster.js";
import { World } from "../../src/world/world.js";
import { computeMinimalMetrics, type MinimalMetrics } from "../metrics.js";
import { ROOSTER_TRUE_EDGES } from "../oracle.js";

export interface RoosterRunResult {
  observations: ReturnType<CausalBoundary["getObservations"]>;
  hypotheses: Hypothesis[];
  trials: InterventionTrial[];
  metrics: MinimalMetrics;
  narrative: string[];
}

/**
 * v0.1 Falsification — The Rooster:
 * observationally rooster ↔ light, hypothesis rooster → light,
 * do(rooster=false) leaves light=true → hypothesis dies.
 */
export async function runRooster(opts?: {
  observationCount?: number;
  seedRng?: () => number;
}): Promise<RoosterRunResult> {
  const observationCount = opts?.observationCount ?? 5;
  const narrative: string[] = [];

  const world = new World(roosterModel, undefined, opts?.seedRng);
  const hypothesizer = new FixedHypothesizer(
    { cause: "rooster", effect: "light" },
    0.7,
  );
  const boundary = new CausalBoundary(world, hypothesizer);

  for (let i = 0; i < observationCount; i++) {
    const obs = boundary.observeFresh(["rooster", "light"]);
    narrative.push(
      `observe#${i + 1}: rooster=${obs.rooster}, light=${obs.light}`,
    );
  }

  world.do({ variable: "sunrise", value: true });
  const aligned = boundary.observe(["rooster", "light"]);
  narrative.push(
    `aligned observe: rooster=${aligned.rooster}, light=${aligned.light}`,
  );

  const accepted = await boundary.ingestProposals(aligned);
  for (const h of accepted) {
    narrative.push(
      `hypothesis ${h.id}: ${h.cause} → ${h.effect} status=${h.status} confidence=${h.confidence}`,
    );
  }

  if (accepted.length === 0) {
    throw new Error("Rooster: hypothesizer produced no usable proposal");
  }

  const stateBeforeTest = world.getState();
  narrative.push(
    `pre-intervention state: sunrise=${stateBeforeTest.sunrise}, rooster=${stateBeforeTest.rooster}, light=${stateBeforeTest.light}`,
  );

  const target = accepted[0]!;
  const trial = boundary.testHypothesis(target, false);
  narrative.push(
    `do(rooster=false): light ${trial.before.light} → ${trial.after.light}`,
  );
  narrative.push(
    `hypothesisPrediction expectsEffectChange=${trial.prediction.expectsEffectChange}, effectChanged=${trial.effectChanged}, correct=${trial.hypothesisPredictionCorrect}`,
  );
  narrative.push(
    `hypothesis ${target.id} status=${target.status}` +
      (target.deathReason ? ` reason="${target.deathReason}"` : ""),
  );

  const hypotheses = boundary.getHypotheses();
  const trials = boundary.getTrials();
  const metrics = computeMinimalMetrics(hypotheses, trials, {
    trueEdges: ROOSTER_TRUE_EDGES,
    spuriousEdge: { cause: "rooster", effect: "light" },
  });

  return {
    observations: boundary.getObservations(),
    hypotheses,
    trials,
    metrics,
    narrative,
  };
}
