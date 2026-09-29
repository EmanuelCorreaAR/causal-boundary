import { FixedHypothesizer } from "../../src/agents/fixed-hypothesizer.js";
import { CausalBoundary } from "../../src/causal/boundary.js";
import { isAlive } from "../../src/causal/hypothesis.js";
import {
  DisagreementSelector,
  RandomSelector,
  type ExperimentSelector,
} from "../../src/causal/selector.js";
import type { Hypothesis } from "../../src/causal/types.js";
import type { Intervention } from "../../src/world/intervene.js";
import { competingModel } from "../../src/world/models/competing.js";
import { World } from "../../src/world/world.js";
import {
  computeActiveSelectionMetrics,
  isExplanationSetResolved,
  type ActiveSelectionMetrics,
} from "../active-metrics.js";
import { COMPETING_TRUE_EDGES } from "../oracle.js";

const EFFECT = "lawnWet";
const SPURIOUS = { cause: "forecast", effect: "lawnWet" } as const;

/** Five+ candidate dos — enough to force real choice. */
export const ACTIVE_CANDIDATES: Intervention[] = [
  { variable: "rain", value: false },
  { variable: "sprinkler", value: false },
  { variable: "forecast", value: false },
  { variable: "forecast", value: true },
  { variable: "sprinkler", value: true },
  { variable: "rain", value: true },
];

export interface ActiveRunResult {
  policy: "disagreement" | "random";
  narrative: string[];
  hypotheses: Hypothesis[];
  metrics: ActiveSelectionMetrics;
  choices: { intervention: Intervention; score: number }[];
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function runActivePolicy(opts: {
  policy: "disagreement" | "random";
  seed: number;
  maxExperiments?: number;
}): Promise<ActiveRunResult> {
  const maxExperiments = opts.maxExperiments ?? 20;
  const rng = mulberry32(opts.seed);
  const narrative: string[] = [];
  const choices: { intervention: Intervention; score: number }[] = [];

  const world = new World(competingModel, undefined, rng);
  const boundary = new CausalBoundary(
    world,
    new FixedHypothesizer([
      { cause: "rain", effect: "lawnWet" },
      { cause: "sprinkler", effect: "lawnWet" },
      { cause: "forecast", effect: "lawnWet" },
    ]),
  );

  // Observational warm-up so FixedHypothesizer can propose.
  for (let i = 0; i < 5; i++) {
    boundary.observeFresh(["rain", "sprinkler", "forecast", "lawnWet"]);
  }
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  const aligned = boundary.observe([
    "rain",
    "sprinkler",
    "forecast",
    "lawnWet",
  ]);
  const accepted = await boundary.ingestProposals(aligned);
  narrative.push(
    `policy=${opts.policy} seed=${opts.seed} hypotheses: ${accepted
      .map((h) => `${h.id}:${h.cause}→${h.effect}`)
      .join(", ")}`,
  );

  const initialHypothesisCount = boundary.getHypotheses().length;
  const selector: ExperimentSelector =
    opts.policy === "disagreement"
      ? new DisagreementSelector()
      : new RandomSelector(rng);

  let experiments = 0;
  while (
    experiments < maxExperiments &&
    !isExplanationSetResolved(
      boundary.getHypotheses(),
      COMPETING_TRUE_EDGES,
      SPURIOUS,
    )
  ) {
    const state = world.getState();
    const ranked = selector.rank(
      boundary.getHypotheses(),
      ACTIVE_CANDIDATES,
      { effectVar: EFFECT, currentState: state },
    );
    const best = ranked[0];
    if (!best) break;

    choices.push({
      intervention: best.intervention,
      score: best.score,
    });
    narrative.push(
      `exp#${experiments + 1} choose do(${best.intervention.variable}=${best.intervention.value}) score=${best.score} preds=${JSON.stringify(best.predictions)}`,
    );

    const target = boundary
      .getHypotheses()
      .filter(isAlive)
      .find((h) => h.cause === best.intervention.variable);

    if (target) {
      const trial = boundary.testHypothesis(target, best.intervention.value);
      narrative.push(
        `  → ${target.id} outcome=${trial.outcome} status=${target.status}`,
      );
    } else {
      world.do(best.intervention);
      narrative.push(`  → no alive hyp for ${best.intervention.variable}; world.do only`);
    }

    experiments += 1;
  }

  const hypotheses = boundary.getHypotheses();
  const metrics = computeActiveSelectionMetrics(hypotheses, experiments, {
    trueEdges: COMPETING_TRUE_EDGES,
    spuriousEdge: SPURIOUS,
    initialHypothesisCount,
  });
  narrative.push(
    `done experiments=${experiments} resolved=${metrics.resolved} statuses=${hypotheses
      .map((h) => `${h.cause}:${h.status}`)
      .join(", ")}`,
  );

  return {
    policy: opts.policy,
    narrative,
    hypotheses,
    metrics,
    choices,
  };
}

export interface ActiveSelectionSuiteResult {
  demoDisagreement: ActiveRunResult;
  demoRandom: ActiveRunResult;
  aggregate: {
    seeds: number;
    disagreementMeanExperiments: number;
    randomMeanExperiments: number;
    disagreementResolveRate: number;
    randomResolveRate: number;
  };
  pass: boolean;
}

/**
 * v0.6 Active experiment selection:
 * DisagreementSelector vs RandomSelector on the same competing world.
 */
export async function runActiveSelection(opts?: {
  demoSeed?: number;
  aggregateSeeds?: number[];
}): Promise<ActiveSelectionSuiteResult> {
  const demoSeed = opts?.demoSeed ?? 42;
  const aggregateSeeds =
    opts?.aggregateSeeds ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  const demoDisagreement = await runActivePolicy({
    policy: "disagreement",
    seed: demoSeed,
  });
  const demoRandom = await runActivePolicy({
    policy: "random",
    seed: demoSeed,
  });

  let dSum = 0;
  let rSum = 0;
  let dResolved = 0;
  let rResolved = 0;

  for (const seed of aggregateSeeds) {
    const d = await runActivePolicy({ policy: "disagreement", seed });
    const r = await runActivePolicy({ policy: "random", seed });
    dSum += d.metrics.experimentsToResolution;
    rSum += r.metrics.experimentsToResolution;
    if (d.metrics.resolved) dResolved += 1;
    if (r.metrics.resolved) rResolved += 1;
  }

  const n = aggregateSeeds.length;
  const disagreementMeanExperiments = dSum / n;
  const randomMeanExperiments = rSum / n;
  const disagreementResolveRate = dResolved / n;
  const randomResolveRate = rResolved / n;

  // Pass: disagreement resolves at least as often and uses fewer experiments on average.
  const pass =
    disagreementResolveRate >= 0.8 &&
    disagreementMeanExperiments < randomMeanExperiments;

  return {
    demoDisagreement,
    demoRandom,
    aggregate: {
      seeds: n,
      disagreementMeanExperiments,
      randomMeanExperiments,
      disagreementResolveRate,
      randomResolveRate,
    },
    pass,
  };
}
