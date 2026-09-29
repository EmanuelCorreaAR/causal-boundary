import type { Observation } from "../world/state.js";
import type { HypothesisProposal } from "../causal/types.js";

/**
 * Sole interface between probabilistic proposers (mock or LLM) and the
 * Causal Boundary. Implementations must not touch World, Evidence, or oracle.
 */
export interface Hypothesizer {
  propose(observation: Observation): Promise<HypothesisProposal[]>;
}
