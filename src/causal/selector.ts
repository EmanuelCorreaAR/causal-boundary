import type { Intervention } from "../world/intervene.js";
import type { WorldState } from "../world/state.js";
import { isAlive } from "./hypothesis.js";
import type { Hypothesis } from "./types.js";

export interface RankedIntervention {
  intervention: Intervention;
  /** Pairwise disagreements among alive hypotheses' predicted effect values. */
  score: number;
  /** Predicted value of `effectVar` under each alive hypothesis id. */
  predictions: Record<string, boolean>;
}

export interface RankContext {
  /** Effect variable whose post-intervention value hypotheses are predicting. */
  effectVar: string;
  currentState: WorldState;
}

/**
 * Chooses which intervention best separates the current hypothesis set.
 * Does not know the true graph — only compares hypotheses' predictions.
 */
export interface ExperimentSelector {
  rank(
    hypotheses: Hypothesis[],
    candidates: Intervention[],
    context: RankContext,
  ): RankedIntervention[];
}

/**
 * Under hypothesis H: cause → effect, treat H as claiming a direct sufficient link
 * for prediction purposes:
 * - do(cause=v) ⇒ predict effect=v
 * - do(other=v) ⇒ predict effect unchanged
 */
export function predictEffectUnderHypothesis(
  h: Hypothesis,
  intervention: Intervention,
  currentEffect: boolean,
): boolean {
  if (intervention.variable === h.cause) {
    return intervention.value;
  }
  return currentEffect;
}

function pairwiseDisagreement(values: boolean[]): number {
  let score = 0;
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      if (values[i] !== values[j]) score += 1;
    }
  }
  return score;
}

/**
 * Spike selector: score(intervention) = pairwise disagreement of predicted outcomes.
 * Higher = more hypotheses diverge under that do().
 */
export class DisagreementSelector implements ExperimentSelector {
  rank(
    hypotheses: Hypothesis[],
    candidates: Intervention[],
    context: RankContext,
  ): RankedIntervention[] {
    const alive = hypotheses.filter(isAlive);
    const currentEffect = Boolean(context.currentState[context.effectVar]);

    const ranked: RankedIntervention[] = candidates.map((intervention) => {
      const predictions: Record<string, boolean> = {};
      const values: boolean[] = [];
      for (const h of alive) {
        const pred = predictEffectUnderHypothesis(h, intervention, currentEffect);
        predictions[h.id] = pred;
        values.push(pred);
      }
      return {
        intervention,
        score: pairwiseDisagreement(values),
        predictions,
      };
    });

    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Prefer turning off a currently-true claimed cause (more likely informative).
      const aOff =
        a.intervention.value === false &&
        Boolean(context.currentState[a.intervention.variable]) &&
        alive.some((h) => h.cause === a.intervention.variable)
          ? 1
          : 0;
      const bOff =
        b.intervention.value === false &&
        Boolean(context.currentState[b.intervention.variable]) &&
        alive.some((h) => h.cause === b.intervention.variable)
          ? 1
          : 0;
      if (bOff !== aOff) return bOff - aOff;
      return `${a.intervention.variable}:${a.intervention.value}`.localeCompare(
        `${b.intervention.variable}:${b.intervention.value}`,
      );
    });

    return ranked;
  }
}

/** Uniform random ranking — baseline for experiments-to-resolution demos. */
export class RandomSelector implements ExperimentSelector {
  constructor(private readonly rng: () => number = Math.random) {}

  rank(
    hypotheses: Hypothesis[],
    candidates: Intervention[],
    context: RankContext,
  ): RankedIntervention[] {
    const disagreement = new DisagreementSelector();
    const base = disagreement.rank(hypotheses, candidates, context);
    // Re-sort by random keys while keeping prediction diagnostics.
    return [...base].sort(() => this.rng() - 0.5);
  }
}
