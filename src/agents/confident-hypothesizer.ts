import type { Observation, Var } from "../world/state.js";
import type { HypothesisProposal } from "../causal/types.js";
import type { Hypothesizer } from "./hypothesizer.js";
import type { FixedEdge } from "./fixed-hypothesizer.js";

/**
 * Always proposes a fixed edge at very high confidence when visible —
 * simulates an overconfident LLM claim that must still remain unauthorized.
 */
export class ConfidentHypothesizer implements Hypothesizer {
  constructor(
    private readonly edge: FixedEdge,
    private readonly confidence = 0.99,
  ) {}

  async propose(observation: Observation): Promise<HypothesisProposal[]> {
    const c = observation[this.edge.cause];
    const e = observation[this.edge.effect];
    if (c === undefined || e === undefined) return [];
    return [
      {
        cause: this.edge.cause,
        effect: this.edge.effect,
        confidence: this.confidence,
      },
    ];
  }
}

/**
 * Proposes a noisy mix of edges (true + spurious) — same Hypothesizer interface.
 */
export class NoisyHypothesizer implements Hypothesizer {
  constructor(
    private readonly edges: FixedEdge[],
    private readonly confidence = 0.8,
  ) {}

  async propose(observation: Observation): Promise<HypothesisProposal[]> {
    const out: HypothesisProposal[] = [];
    for (const edge of this.edges) {
      const c = observation[edge.cause];
      const e = observation[edge.effect];
      if (c === undefined || e === undefined) continue;
      if (c !== e) continue;
      out.push({
        cause: edge.cause,
        effect: edge.effect,
        confidence: this.confidence,
      });
    }
    return out;
  }
}

/** Placeholder: real LLM hypothesizer must implement the same interface only. */
export type LlmHypothesizerConfig = {
  model: string;
  /** Reserved — not wired in v0.7 (no API required for authority demo). */
  apiKey?: string;
};

export function assertHypothesizerContract(_h: Hypothesizer): void {
  // Compile-time / API-surface marker: LLM adapters plug here later.
}
