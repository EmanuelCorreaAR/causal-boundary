import type { Observation, Var } from "../world/state.js";
import type { HypothesisProposal } from "../causal/types.js";
import type { Hypothesizer } from "./hypothesizer.js";

export interface FixedEdge {
  cause: Var;
  effect: Var;
}

/**
 * Deterministic mock that proposes configured edge(s) when both endpoints
 * are visible and equal. No World / Evidence / oracle privileges.
 */
export class FixedHypothesizer implements Hypothesizer {
  private readonly edges: FixedEdge[];

  constructor(edgeOrEdges: FixedEdge | FixedEdge[], private readonly confidence = 0.7) {
    this.edges = Array.isArray(edgeOrEdges) ? edgeOrEdges : [edgeOrEdges];
  }

  async propose(observation: Observation): Promise<HypothesisProposal[]> {
    const out: HypothesisProposal[] = [];
    for (const edge of this.edges) {
      const causeVal = observation[edge.cause];
      const effectVal = observation[edge.effect];
      if (causeVal === undefined || effectVal === undefined) continue;
      if (causeVal !== effectVal) continue;
      out.push({
        cause: edge.cause,
        effect: edge.effect,
        confidence: this.confidence,
      });
    }
    return out;
  }
}
