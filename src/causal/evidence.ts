import type { Observation, Var } from "../world/state.js";
import { appendEvidence, promote } from "./hypothesis.js";
import type { Hypothesis } from "./types.js";

/**
 * Track co-occurrence of boolean pairs to support weak observational evidence.
 */
export class EvidenceStore {
  private step = 0;
  private readonly pairCounts = new Map<string, { both: number; either: number }>();

  nextStep(): number {
    return ++this.step;
  }

  currentStep(): number {
    return this.step;
  }

  recordObservation(obs: Observation): void {
    const keys = Object.keys(obs) as Var[];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = keys[i]!;
        const b = keys[j]!;
        const va = obs[a];
        const vb = obs[b];
        if (va === undefined || vb === undefined) continue;
        this.bumpPair(a, b, va === vb);
      }
    }
  }

  reinforceFromCorrelation(h: Hypothesis): void {
    if (h.status === "dead") return;
    const stats = this.pairCounts.get(pairKey(h.cause, h.effect));
    if (!stats || stats.either < 2) return;
    const rate = stats.both / stats.either;
    if (rate >= 0.8) {
      appendEvidence(h, {
        kind: "observational_correlation",
        detail: `co-occurrence rate ${rate.toFixed(2)} over ${stats.either} joint observations`,
        at: this.step,
      });
      promote(h, "weak");
      h.confidence = Math.min(0.95, Math.max(h.confidence, 0.5 + rate * 0.3));
    }
  }

  private bumpPair(a: Var, b: Var, same: boolean): void {
    const key = pairKey(a, b);
    const cur = this.pairCounts.get(key) ?? { both: 0, either: 0 };
    cur.either += 1;
    if (same) cur.both += 1;
    this.pairCounts.set(key, cur);
  }
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}
