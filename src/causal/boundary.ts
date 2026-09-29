import type { Hypothesizer } from "../agents/hypothesizer.js";
import type { World } from "../world/world.js";
import type { Observation, Var, WorldState } from "../world/state.js";
import {
  authorityOf,
  authorizeAction,
  requireEstablishedById,
  requireEstablishedCausal,
  type ActionDecision,
  type ActionSpec,
  type CausalAuthority,
  type EstablishedCausalClaim,
} from "./authority.js";
import { compare } from "./compare.js";
import { EvidenceStore } from "./evidence.js";
import {
  appendEvidence,
  edgeKey,
  isAlive,
  kill,
  promote,
  supportCount,
} from "./hypothesis.js";
import type {
  Hypothesis,
  HypothesisProposal,
  InterventionOutcome,
  InterventionPrediction,
  InterventionTrial,
} from "./types.js";

export interface BoundaryResult {
  hypotheses: Hypothesis[];
  trials: InterventionTrial[];
  observations: Observation[];
}

export interface IngestStats {
  accepted: Hypothesis[];
  /** Proposals that matched a dead claim and were refused revival. */
  blockedReintroductions: HypothesisProposal[];
}

/**
 * Causal Boundary: hypothesizer proposals never become causal knowledge
 * until they survive interventions against the world.
 *
 * Must never import benchmark/oracle — production layer has no true graph.
 *
 * Experiments (do) are Boundary-owned via testHypothesis.
 * Remediation tools require authorizeAction(claimId, action) — established
 * claims are not blanket tool permissions.
 */
export class CausalBoundary {
  private readonly hypotheses = new Map<string, Hypothesis>();
  private readonly deadKeys = new Set<string>();
  private readonly evidence = new EvidenceStore();
  private readonly trials: InterventionTrial[] = [];
  private readonly observations: Observation[] = [];
  private readonly blockedReintroductionLog: HypothesisProposal[] = [];
  private idSeq = 0;

  constructor(
    private readonly world: World,
    private hypothesizer: Hypothesizer,
  ) {}

  setHypothesizer(hypothesizer: Hypothesizer): void {
    this.hypothesizer = hypothesizer;
  }

  getHypotheses(): Hypothesis[] {
    return [...this.hypotheses.values()];
  }

  getTrials(): InterventionTrial[] {
    return [...this.trials];
  }

  getObservations(): Observation[] {
    return [...this.observations];
  }

  getBlockedReintroductions(): HypothesisProposal[] {
    return [...this.blockedReintroductionLog];
  }

  authorityFor(cause: Var, effect: Var): CausalAuthority | null {
    const h = this.hypotheses.get(edgeKey(cause, effect));
    if (!h) return null;
    return authorityOf(h);
  }

  /** Claim established by evidence (mechanism known) — not a tool capability. */
  authorize(cause: Var, effect: Var): EstablishedCausalClaim | null {
    return requireEstablishedCausal(this.getHypotheses(), cause, effect);
  }

  /** Claim established by id — not a tool capability. */
  authorizeById(hypothesisId: string): EstablishedCausalClaim | null {
    return requireEstablishedById(this.getHypotheses(), hypothesisId);
  }

  /**
   * Authorize a remediation action against an established claim.
   * Confidence ≠ evidence; evidence ≠ blanket permission.
   */
  authorizeAction(claimId: string, action: ActionSpec): ActionDecision {
    return authorizeAction(this.getHypotheses(), claimId, action);
  }

  observe(vars?: readonly Var[]): Observation {
    const obs = this.world.observe(vars);
    this.observations.push(obs);
    this.evidence.recordObservation(obs);
    for (const h of this.hypotheses.values()) {
      if (isAlive(h)) this.evidence.reinforceFromCorrelation(h);
    }
    return obs;
  }

  observeFresh(vars?: readonly Var[]): Observation {
    this.world.resample();
    return this.observe(vars);
  }

  async ingestProposals(observation: Observation): Promise<Hypothesis[]> {
    const stats = await this.ingestProposalsDetailed(observation);
    return stats.accepted;
  }

  /**
   * Ingest with immune-system accounting: dead claims cannot be revived
   * by mere re-proposal (including confidence 0.99 from an LLM).
   */
  async ingestProposalsDetailed(observation: Observation): Promise<IngestStats> {
    const proposals = await this.hypothesizer.propose(observation);
    const accepted: Hypothesis[] = [];
    const blockedReintroductions: HypothesisProposal[] = [];

    for (const p of proposals) {
      const key = edgeKey(p.cause, p.effect);
      if (this.deadKeys.has(key)) {
        blockedReintroductions.push(p);
        this.blockedReintroductionLog.push(p);
        continue;
      }

      const existing = this.hypotheses.get(key);
      if (existing) {
        if (isAlive(existing)) {
          this.evidence.reinforceFromCorrelation(existing);
          accepted.push(existing);
        }
        continue;
      }

      const h = this.createHypothesis(p);
      this.hypotheses.set(key, h);
      this.evidence.reinforceFromCorrelation(h);
      accepted.push(h);
    }

    return { accepted, blockedReintroductions };
  }

  /**
   * Test a live hypothesis with do(cause = value).
   *
   * Outcomes:
   * - support: effect changed as the intervention flipped the cause
   * - inconclusive: effect unchanged but rival causes of the same effect are still on
   * - contradiction: effect unchanged and no active rival can explain it
   */
  testHypothesis(h: Hypothesis, doValue: boolean): InterventionTrial {
    if (!isAlive(h)) {
      throw new Error(`Cannot test dead hypothesis ${h.id}`);
    }

    const before = this.world.getState();
    const prediction = this.predictUnderHypothesis(h, doValue, before);

    const after = this.world.do({ variable: h.cause, value: doValue });
    const deltas = compare(before, after, this.world.model.vars);
    const effectChanged = before[h.effect] !== after[h.effect];
    const hypothesisPredictionCorrect =
      prediction.expectsEffectChange === effectChanged;

    const rivals = this.activeAlternatives(h, after);
    const step = this.evidence.nextStep();
    let outcome: InterventionOutcome;

    if (effectChanged && before[h.cause] !== doValue) {
      outcome = "support";
      appendEvidence(h, {
        kind: "intervention_support",
        detail: `do(${h.cause}=${doValue}) changed ${h.effect}: ${before[h.effect]} → ${after[h.effect]}`,
        at: step,
      });
      const supports = supportCount(h);
      if (supports >= 2) promote(h, "causal");
      else promote(h, "supported");
      h.confidence = Math.min(0.99, h.confidence + 0.15);
    } else if (this.isInconclusive(doValue, effectChanged, after, h, rivals)) {
      outcome = "inconclusive";
      appendEvidence(h, {
        kind: "intervention_inconclusive",
        detail: `do(${h.cause}=${doValue}): ${h.effect} unchanged; active alternatives [${rivals.map((r) => r.cause).join(", ")}] — absence of Δ ≠ absence of cause`,
        at: step,
      });
      if (doValue === false && Boolean(after[h.effect]) && rivals.length === 1) {
        const rival = rivals[0]!;
        appendEvidence(rival, {
          kind: "intervention_support",
          detail: `shared: after do(${h.cause}=false), ${h.effect} stayed ${after[h.effect]} while ${rival.cause}=true (sole active alternative)`,
          at: step,
        });
        const supports = supportCount(rival);
        if (supports >= 2) promote(rival, "causal");
        else promote(rival, "supported");
        rival.confidence = Math.min(0.99, rival.confidence + 0.1);
      }
    } else {
      outcome = "contradiction";
      kill(
        h,
        `intervention on cause did not change effect (do(${h.cause}=${doValue}), ${h.effect}=${after[h.effect]})`,
        {
          kind: "intervention_contradiction",
          detail: `do(${h.cause}=${doValue}); deltas: ${
            deltas.length === 0
              ? "none"
              : deltas.map((d) => `${d.variable}:${d.before}→${d.after}`).join(", ")
          }; ${h.effect} stayed ${after[h.effect]}; no active alternatives`,
          at: step,
        },
      );
      this.deadKeys.add(edgeKey(h.cause, h.effect));
    }

    const trial: InterventionTrial = {
      hypothesisId: h.id,
      cause: h.cause,
      effect: h.effect,
      doValue,
      before,
      after,
      prediction,
      effectChanged,
      outcome,
      hypothesisPredictionCorrect,
      activeAlternatives: rivals.map((r) => edgeKey(r.cause, r.effect)),
    };
    this.trials.push(trial);
    return trial;
  }

  testAllAlive(): InterventionTrial[] {
    const results: InterventionTrial[] = [];
    const alive = this.getHypotheses().filter(isAlive);
    for (const h of alive) {
      const current = Boolean(this.world.getState()[h.cause]);
      results.push(this.testHypothesis(h, !current));
    }
    return results;
  }

  snapshot(): BoundaryResult {
    return {
      hypotheses: this.getHypotheses(),
      trials: this.getTrials(),
      observations: this.getObservations(),
    };
  }

  private activeAlternatives(h: Hypothesis, state: WorldState): Hypothesis[] {
    return this.getHypotheses().filter(
      (other) =>
        other.id !== h.id &&
        isAlive(other) &&
        other.effect === h.effect &&
        Boolean(state[other.cause]),
    );
  }

  private isInconclusive(
    doValue: boolean,
    effectChanged: boolean,
    after: WorldState,
    h: Hypothesis,
    rivals: Hypothesis[],
  ): boolean {
    if (effectChanged) return false;
    if (doValue === false && rivals.length > 0) return true;
    if (doValue === true && Boolean(after[h.effect]) && rivals.length > 0) {
      return true;
    }
    return false;
  }

  private predictUnderHypothesis(
    h: Hypothesis,
    doValue: boolean,
    before: WorldState,
  ): InterventionPrediction {
    const expectsEffectChange = before[h.cause] !== doValue;
    return {
      hypothesisId: h.id,
      cause: h.cause,
      effect: h.effect,
      expectsEffectChange,
      predictedEffect: expectsEffectChange ? doValue : before[h.effect],
    };
  }

  private createHypothesis(p: HypothesisProposal): Hypothesis {
    const step = this.evidence.nextStep();
    return {
      id: `H${++this.idSeq}`,
      cause: p.cause,
      effect: p.effect,
      confidence: p.confidence,
      status: "proposed",
      evidence: [
        {
          kind: "observational_correlation",
          detail: "proposed by hypothesizer",
          at: step,
        },
      ],
    };
  }
}
