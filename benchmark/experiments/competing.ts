import { FixedHypothesizer } from "../../src/agents/fixed-hypothesizer.js";
import { CausalBoundary } from "../../src/causal/boundary.js";
import type { Hypothesis, InterventionTrial } from "../../src/causal/types.js";
import { competingModel } from "../../src/world/models/competing.js";
import { World } from "../../src/world/world.js";
import { computeMinimalMetrics, type MinimalMetrics } from "../metrics.js";
import { COMPETING_TRUE_EDGES } from "../oracle.js";

export interface CompetingRunResult {
  observations: ReturnType<CausalBoundary["getObservations"]>;
  hypotheses: Hypothesis[];
  trials: InterventionTrial[];
  metrics: MinimalMetrics;
  narrative: string[];
}

/**
 * v0.4 Multiple causes (hand-isolated):
 *   rain → lawnWet ← sprinkler; forecast distractor.
 * Strong competition / inconclusive = v0.5.
 */
export async function runCompeting(opts?: {
  observationCount?: number;
  seedRng?: () => number;
}): Promise<CompetingRunResult> {
  const observationCount = opts?.observationCount ?? 6;
  const narrative: string[] = [];

  const world = new World(competingModel, undefined, opts?.seedRng);
  const boundary = new CausalBoundary(
    world,
    new FixedHypothesizer({ cause: "forecast", effect: "lawnWet" }),
  );

  // Correlate forecast ↔ lawnWet with sprinkler off.
  for (let i = 0; i < observationCount; i++) {
    world.resample();
    world.do({ variable: "sprinkler", value: false });
    const obs = boundary.observe(["forecast", "lawnWet"]);
    narrative.push(
      `observe-spurious#${i + 1}: forecast=${obs.forecast}, lawnWet=${obs.lawnWet}`,
    );
  }

  world.do({ variable: "sprinkler", value: false });
  world.do({ variable: "rain", value: true });
  const correlated = boundary.observe(["forecast", "lawnWet"]);
  const spuriousAccepted = await boundary.ingestProposals(correlated);
  if (spuriousAccepted.length === 0) {
    throw new Error("Competing: no forecast→lawnWet proposal");
  }
  const spurious = spuriousAccepted[0]!;
  narrative.push(
    `hypothesis ${spurious.id}: ${spurious.cause} → ${spurious.effect} status=${spurious.status}`,
  );

  // Falsify with rivals off: forecast alone cannot wet the lawn.
  world.do({ variable: "rain", value: false });
  world.do({ variable: "sprinkler", value: false });
  const tSpurious = boundary.testHypothesis(spurious, true);
  narrative.push(
    `do(forecast=true) rivals off: lawnWet ${tSpurious.before.lawnWet} → ${tSpurious.after.lawnWet}; outcome=${tSpurious.outcome}`,
  );
  narrative.push(`distractor ${spurious.id} status=${spurious.status}`);

  boundary.setHypothesizer(
    new FixedHypothesizer([
      { cause: "rain", effect: "lawnWet" },
      { cause: "sprinkler", effect: "lawnWet" },
    ]),
  );

  for (let i = 0; i < observationCount; i++) {
    const obs = boundary.observeFresh(["rain", "sprinkler", "lawnWet"]);
    narrative.push(
      `observe-true#${i + 1}: rain=${obs.rain}, sprinkler=${obs.sprinkler}, lawnWet=${obs.lawnWet}`,
    );
  }

  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  const alignedTrue = boundary.observe(["rain", "sprinkler", "lawnWet"]);
  const trueAccepted = await boundary.ingestProposals(alignedTrue);
  for (const h of trueAccepted) {
    narrative.push(
      `hypothesis ${h.id}: ${h.cause} → ${h.effect} status=${h.status}`,
    );
  }

  const rainH = trueAccepted.find((h) => h.cause === "rain" && h.effect === "lawnWet");
  const sprinklerH = trueAccepted.find(
    (h) => h.cause === "sprinkler" && h.effect === "lawnWet",
  );
  if (!rainH || !sprinklerH) {
    throw new Error("Competing: missing true cause proposals");
  }

  world.do({ variable: "sprinkler", value: false });
  world.do({ variable: "rain", value: true });
  const r1 = boundary.testHypothesis(rainH, false);
  narrative.push(
    `isolate rain, do(rain=false): lawnWet ${r1.before.lawnWet} → ${r1.after.lawnWet}; outcome=${r1.outcome}; status=${rainH.status}`,
  );
  const r2 = boundary.testHypothesis(rainH, true);
  narrative.push(
    `isolate rain, do(rain=true): lawnWet ${r2.before.lawnWet} → ${r2.after.lawnWet}; outcome=${r2.outcome}; status=${rainH.status}`,
  );

  world.do({ variable: "rain", value: false });
  world.do({ variable: "sprinkler", value: true });
  const s1 = boundary.testHypothesis(sprinklerH, false);
  narrative.push(
    `isolate sprinkler, do(sprinkler=false): lawnWet ${s1.before.lawnWet} → ${s1.after.lawnWet}; outcome=${s1.outcome}; status=${sprinklerH.status}`,
  );
  const s2 = boundary.testHypothesis(sprinklerH, true);
  narrative.push(
    `isolate sprinkler, do(sprinkler=true): lawnWet ${s2.before.lawnWet} → ${s2.after.lawnWet}; outcome=${s2.outcome}; status=${sprinklerH.status}`,
  );

  const hypotheses = boundary.getHypotheses();
  const trials = boundary.getTrials();
  const metrics = computeMinimalMetrics(hypotheses, trials, {
    trueEdges: COMPETING_TRUE_EDGES,
    spuriousEdge: { cause: "forecast", effect: "lawnWet" },
  });

  return {
    observations: boundary.getObservations(),
    hypotheses,
    trials,
    metrics,
    narrative,
  };
}
