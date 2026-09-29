import type { Observation, Var, WorldState } from "../world/state.js";

export type HypothesisStatus =
  | "proposed"
  | "weak"
  | "supported"
  | "causal"
  | "dead";

export type EvidenceKind =
  | "observational_correlation"
  | "temporal_precedence"
  | "intervention_support"
  | "intervention_contradiction"
  | "intervention_inconclusive";

export type InterventionOutcome = "support" | "contradiction" | "inconclusive";

export interface EvidenceItem {
  kind: EvidenceKind;
  detail: string;
  at: number;
}

export interface Hypothesis {
  id: string;
  cause: Var;
  effect: Var;
  confidence: number;
  status: HypothesisStatus;
  evidence: EvidenceItem[];
  deathReason?: string;
}

export interface HypothesisProposal {
  cause: Var;
  effect: Var;
  confidence: number;
  /** Optional natural-language rationale from an LLM — never grants authority. */
  rationale?: string;
}

export interface StateDelta {
  variable: Var;
  before: boolean;
  after: boolean;
}

export interface InterventionPrediction {
  hypothesisId: string;
  cause: Var;
  effect: Var;
  expectsEffectChange: boolean;
  predictedEffect?: boolean;
}

export interface InterventionTrial {
  hypothesisId: string;
  cause: Var;
  effect: Var;
  doValue: boolean;
  before: WorldState;
  after: WorldState;
  prediction: InterventionPrediction;
  effectChanged: boolean;
  outcome: InterventionOutcome;
  /** Did the *hypothesis* correctly predict Δeffect? (not the causal model.) */
  hypothesisPredictionCorrect: boolean;
  /** Alive rivals for the same effect whose cause was still true after the do(). */
  activeAlternatives: string[];
}

/** Stub for a later counterfactual primitive — no logic yet. */
export interface CounterfactualQuery {
  observedWorld: Observation;
  intervention: Partial<WorldState>;
  query: Var;
}
