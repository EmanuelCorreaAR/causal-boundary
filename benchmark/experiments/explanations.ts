import { FixedHypothesizer } from "../../src/agents/fixed-hypothesizer.js";
import { CausalBoundary } from "../../src/causal/boundary.js";
import type { Hypothesis, InterventionTrial } from "../../src/causal/types.js";
import { competingModel } from "../../src/world/models/competing.js";
import { World } from "../../src/world/world.js";
import { computeMinimalMetrics, type MinimalMetrics } from "../metrics.js";
import { COMPETING_TRUE_EDGES } from "../oracle.js";

export interface ExplanationsRunResult {
  observations: ReturnType<CausalBoundary["getObservations"]>;
  hypotheses: Hypothesis[];
  trials: InterventionTrial[];
  metrics: MinimalMetrics;
  narrative: string[];
}

/**
 * v0.5 Competing explanations:
 *
 * Same world as v0.4, but interventions are NOT pre-isolated by the experimenter.
 * Key demo: with rain=true, sprinkler=true, lawnWet=true,
 *   do(rain=false) → lawnWet stays true → H(rain→lawnWet) is inconclusive,
 *   NOT dead.
 *
 * Then resolve by turning rivals off / on, and falsify forecast only when
 * no active alternative can explain the outcome.
 */
export async function runCompetingExplanations(opts?: {
  observationCount?: number;
  seedRng?: () => number;
}): Promise<ExplanationsRunResult> {
  const observationCount = opts?.observationCount ?? 6;
  const narrative: string[] = [];

  const world = new World(competingModel, undefined, opts?.seedRng);
  const boundary = new CausalBoundary(
    world,
    new FixedHypothesizer([
      { cause: "rain", effect: "lawnWet" },
      { cause: "sprinkler", effect: "lawnWet" },
      { cause: "forecast", effect: "lawnWet" },
    ]),
  );

  for (let i = 0; i < observationCount; i++) {
    const obs = boundary.observeFresh([
      "rain",
      "sprinkler",
      "forecast",
      "lawnWet",
    ]);
    narrative.push(
      `observe#${i + 1}: rain=${obs.rain}, sprinkler=${obs.sprinkler}, forecast=${obs.forecast}, lawnWet=${obs.lawnWet}`,
    );
  }

  // All three hypotheses visible together — the competing set.
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  const aligned = boundary.observe([
    "rain",
    "sprinkler",
    "forecast",
    "lawnWet",
  ]);
  const accepted = await boundary.ingestProposals(aligned);
  for (const h of accepted) {
    narrative.push(
      `hypothesis ${h.id}: ${h.cause} → ${h.effect} status=${h.status}`,
    );
  }

  const rainH = accepted.find((h) => h.cause === "rain");
  const sprinklerH = accepted.find((h) => h.cause === "sprinkler");
  const forecastH = accepted.find((h) => h.cause === "forecast");
  if (!rainH || !sprinklerH || !forecastH) {
    throw new Error("Explanations: need rain, sprinkler, and forecast hypotheses");
  }

  // --- Critical: naive intervention must NOT kill a true cause ---
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  const naive = boundary.testHypothesis(rainH, false);
  narrative.push(
    `naive do(rain=false) with sprinkler on: lawnWet ${naive.before.lawnWet} → ${naive.after.lawnWet}`,
  );
  narrative.push(
    `outcome=${naive.outcome} activeAlternatives=[${naive.activeAlternatives.join(", ")}] status=${rainH.status}`,
  );
  if (naive.outcome !== "inconclusive" || rainH.status === "dead") {
    throw new Error(
      "Explanations: expected inconclusive (not dead) for rain→lawnWet under active sprinkler",
    );
  }

  // Symmetric inconclusive for sprinkler while rain is back on.
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  const naiveSp = boundary.testHypothesis(sprinklerH, false);
  narrative.push(
    `naive do(sprinkler=false) with rain on: lawnWet ${naiveSp.before.lawnWet} → ${naiveSp.after.lawnWet}; outcome=${naiveSp.outcome}; rainStatus=${rainH.status}; sprinklerStatus=${sprinklerH.status}`,
  );

  // Resolve rain: rivals off, flip rain.
  world.do({ variable: "sprinkler", value: false });
  world.do({ variable: "rain", value: true });
  const r1 = boundary.testHypothesis(rainH, false);
  narrative.push(
    `resolve rain do(rain=false) rivals off: lawnWet ${r1.before.lawnWet} → ${r1.after.lawnWet}; outcome=${r1.outcome}; status=${rainH.status}`,
  );
  const r2 = boundary.testHypothesis(rainH, true);
  narrative.push(
    `resolve rain do(rain=true): lawnWet ${r2.before.lawnWet} → ${r2.after.lawnWet}; outcome=${r2.outcome}; status=${rainH.status}`,
  );

  // Resolve sprinkler: rain off, flip sprinkler.
  world.do({ variable: "rain", value: false });
  world.do({ variable: "sprinkler", value: true });
  const s1 = boundary.testHypothesis(sprinklerH, false);
  narrative.push(
    `resolve sprinkler do(sprinkler=false) rivals off: lawnWet ${s1.before.lawnWet} → ${s1.after.lawnWet}; outcome=${s1.outcome}; status=${sprinklerH.status}`,
  );
  const s2 = boundary.testHypothesis(sprinklerH, true);
  narrative.push(
    `resolve sprinkler do(sprinkler=true): lawnWet ${s2.before.lawnWet} → ${s2.after.lawnWet}; outcome=${s2.outcome}; status=${sprinklerH.status}`,
  );

  // Falsify forecast only with rivals off — cannot produce lawnWet alone.
  world.do({ variable: "rain", value: false });
  world.do({ variable: "sprinkler", value: false });
  const fKill = boundary.testHypothesis(forecastH, true);
  narrative.push(
    `falsify forecast do(forecast=true) rivals off: lawnWet ${fKill.before.lawnWet} → ${fKill.after.lawnWet}; outcome=${fKill.outcome}; status=${forecastH.status}`,
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
