import { FixedHypothesizer } from "../../src/agents/fixed-hypothesizer.js";
import { CausalBoundary } from "../../src/causal/boundary.js";
import { isAlive } from "../../src/causal/hypothesis.js";
import type { Hypothesis, InterventionTrial } from "../../src/causal/types.js";
import { confounderModel } from "../../src/world/models/confounder.js";
import { World } from "../../src/world/world.js";
import { computeMinimalMetrics, type MinimalMetrics } from "../metrics.js";
import { CONFOUNDER_TRUE_EDGES } from "../oracle.js";

export interface ConfounderRunResult {
  observations: ReturnType<CausalBoundary["getObservations"]>;
  hypotheses: Hypothesis[];
  trials: InterventionTrial[];
  metrics: MinimalMetrics;
  narrative: string[];
}

/**
 * v0.3 Confounding:
 *   temperature → iceCreamSales
 *   temperature → drownings
 *
 * Observationally iceCreamSales ↔ drownings (common cause).
 * Spurious iceCreamSales → drownings dies under do(iceCreamSales=false).
 * True temperature edges survive agreeing interventions.
 */
export async function runConfounder(opts?: {
  observationCount?: number;
  seedRng?: () => number;
}): Promise<ConfounderRunResult> {
  const observationCount = opts?.observationCount ?? 5;
  const narrative: string[] = [];

  const world = new World(confounderModel, undefined, opts?.seedRng);
  const boundary = new CausalBoundary(
    world,
    new FixedHypothesizer({ cause: "iceCreamSales", effect: "drownings" }),
  );

  // --- Phase A: spurious correlation (temperature hidden) ---
  for (let i = 0; i < observationCount; i++) {
    const obs = boundary.observeFresh(["iceCreamSales", "drownings"]);
    narrative.push(
      `observe#${i + 1}: iceCreamSales=${obs.iceCreamSales}, drownings=${obs.drownings}`,
    );
  }

  world.do({ variable: "temperature", value: true });
  const alignedSpurious = boundary.observe(["iceCreamSales", "drownings"]);
  narrative.push(
    `aligned (temp hidden): iceCreamSales=${alignedSpurious.iceCreamSales}, drownings=${alignedSpurious.drownings}`,
  );

  const spuriousAccepted = await boundary.ingestProposals(alignedSpurious);
  for (const h of spuriousAccepted) {
    narrative.push(
      `hypothesis ${h.id}: ${h.cause} → ${h.effect} status=${h.status}`,
    );
  }
  if (spuriousAccepted.length === 0) {
    throw new Error("Confounder: no spurious proposal");
  }

  const spurious = spuriousAccepted[0]!;
  // Keep temperature high so drownings stay true when we zero ice cream.
  const tSpurious = boundary.testHypothesis(spurious, false);
  narrative.push(
    `do(iceCreamSales=false): drownings ${tSpurious.before.drownings} → ${tSpurious.after.drownings}`,
  );
  narrative.push(
    `spurious ${spurious.id} status=${spurious.status}` +
      (spurious.deathReason ? ` reason="${spurious.deathReason}"` : ""),
  );

  // --- Phase B: true common-cause edges (temperature visible) ---
  boundary.setHypothesizer(
    new FixedHypothesizer([
      { cause: "temperature", effect: "iceCreamSales" },
      { cause: "temperature", effect: "drownings" },
    ]),
  );

  world.do({ variable: "temperature", value: true });
  for (let i = 0; i < observationCount; i++) {
    const obs = boundary.observeFresh([
      "temperature",
      "iceCreamSales",
      "drownings",
    ]);
    narrative.push(
      `observe-true#${i + 1}: temperature=${obs.temperature}, iceCreamSales=${obs.iceCreamSales}, drownings=${obs.drownings}`,
    );
  }

  world.do({ variable: "temperature", value: true });
  const alignedTrue = boundary.observe([
    "temperature",
    "iceCreamSales",
    "drownings",
  ]);
  const trueAccepted = await boundary.ingestProposals(alignedTrue);
  for (const h of trueAccepted) {
    narrative.push(
      `hypothesis ${h.id}: ${h.cause} → ${h.effect} status=${h.status}`,
    );
  }

  // Two agreeing interventions per true edge → causal.
  for (const h of trueAccepted.filter(isAlive)) {
    world.do({ variable: "temperature", value: true });
    const t1 = boundary.testHypothesis(h, false);
    narrative.push(
      `do(${h.cause}=false) for ${h.cause}→${h.effect}: ${h.effect} ${t1.before[h.effect]} → ${t1.after[h.effect]}; status=${h.status}`,
    );
    const t2 = boundary.testHypothesis(h, true);
    narrative.push(
      `do(${h.cause}=true) for ${h.cause}→${h.effect}: ${h.effect} ${t2.before[h.effect]} → ${t2.after[h.effect]}; status=${h.status}`,
    );
  }

  const hypotheses = boundary.getHypotheses();
  const trials = boundary.getTrials();
  const metrics = computeMinimalMetrics(hypotheses, trials, {
    trueEdges: CONFOUNDER_TRUE_EDGES,
    spuriousEdge: { cause: "iceCreamSales", effect: "drownings" },
  });

  return {
    observations: boundary.getObservations(),
    hypotheses,
    trials,
    metrics,
    narrative,
  };
}
