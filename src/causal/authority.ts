import { edgeKey } from "./hypothesis.js";
import type { Hypothesis, HypothesisStatus } from "./types.js";
import type { Var } from "../world/state.js";

/**
 * Claim-level authority.
 * Presence in LLM context ≠ established mechanism ≠ tool permission.
 *
 * `established` — evidence elevated the claim to causal.
 * `executable` — always false at claim level; tools need authorizeAction().
 */
export type CausalAuthority =
  | { status: "proposed"; established: false; executable: false }
  | { status: "weak"; established: false; executable: false }
  | { status: "supported"; established: false; executable: false }
  | { status: "causal"; established: true; executable: false }
  | {
      status: "dead";
      established: false;
      executable: false;
      deathReason?: string;
    };

/** Brand: claim whose mechanism is evidence-established (not a tool capability). */
export type EstablishedCausalClaim = {
  cause: Var;
  effect: Var;
  status: "causal";
  established: true;
  hypothesisId: string;
  confidence: number;
};

/** @deprecated Use EstablishedCausalClaim — claims are not blanket tool capabilities. */
export type AuthorizedCausalClaim = EstablishedCausalClaim;

export type ActionKind = "experimental" | "remediation";

/** Declared remediation/experimental action for justification checks. */
export type ActionSpec = {
  name: string;
  kind: ActionKind;
  /** Variables this action acts on / reverses. */
  targets: readonly Var[];
};

export type ActionDecision =
  | {
      allowed: true;
      claimId: string;
      action: string;
      cause: Var;
      effect: Var;
    }
  | {
      allowed: false;
      reason:
        | "claim_missing"
        | "claim_not_established"
        | "action_not_justified"
        | "experimental_not_via_tools";
      authorityStatus?: HypothesisStatus;
      detail: string;
    };

export function authorityFromStatus(
  status: HypothesisStatus,
  deathReason?: string,
): CausalAuthority {
  switch (status) {
    case "proposed":
      return { status: "proposed", established: false, executable: false };
    case "weak":
      return { status: "weak", established: false, executable: false };
    case "supported":
      return { status: "supported", established: false, executable: false };
    case "causal":
      return { status: "causal", established: true, executable: false };
    case "dead":
      return {
        status: "dead",
        established: false,
        executable: false,
        deathReason,
      };
  }
}

export function authorityOf(h: Hypothesis): CausalAuthority {
  return authorityFromStatus(h.status, h.deathReason);
}

export function isEstablished(auth: CausalAuthority): auth is {
  status: "causal";
  established: true;
  executable: false;
} {
  return auth.established === true;
}

/**
 * @deprecated Claim-level executable is always false. Use isEstablished()
 * for mechanism checks, authorizeAction() for tools.
 */
export function isExecutable(_auth: CausalAuthority): boolean {
  return false;
}

/** Claim established by evidence (mechanism known) — not a tool capability. */
export function requireEstablishedCausal(
  hypotheses: Hypothesis[],
  cause: Var,
  effect: Var,
): EstablishedCausalClaim | null {
  const h = hypotheses.find((x) => x.cause === cause && x.effect === effect);
  return toEstablished(h);
}

export function requireEstablishedById(
  hypotheses: Hypothesis[],
  hypothesisId: string,
): EstablishedCausalClaim | null {
  const h = hypotheses.find((x) => x.id === hypothesisId);
  return toEstablished(h);
}

/** @deprecated Use requireEstablishedCausal */
export const requireAuthorizedCausal = requireEstablishedCausal;
/** @deprecated Use requireEstablishedById */
export const requireAuthorizedById = requireEstablishedById;

function toEstablished(h: Hypothesis | undefined): EstablishedCausalClaim | null {
  if (!h) return null;
  const auth = authorityOf(h);
  if (!isEstablished(auth)) return null;
  return {
    cause: h.cause,
    effect: h.effect,
    status: "causal",
    established: true,
    hypothesisId: h.id,
    confidence: h.confidence,
  };
}

/**
 * Authorize a concrete action against an established claim.
 * Evidence establishes mechanisms; only justified actions become capabilities.
 */
export function authorizeAction(
  hypotheses: Hypothesis[],
  claimId: string,
  action: ActionSpec,
): ActionDecision {
  if (action.kind === "experimental") {
    return {
      allowed: false,
      reason: "experimental_not_via_tools",
      detail:
        "Experimental do() is Boundary-owned (testHypothesis), not a remediation tool",
    };
  }

  const h = hypotheses.find((x) => x.id === claimId);
  if (!h) {
    return {
      allowed: false,
      reason: "claim_missing",
      detail: `No claim with id=${claimId}`,
    };
  }

  const auth = authorityOf(h);
  if (!isEstablished(auth)) {
    return {
      allowed: false,
      reason: "claim_not_established",
      authorityStatus: h.status,
      detail: `Claim ${h.cause}→${h.effect} status=${h.status}; remediation requires causal evidence`,
    };
  }

  if (!action.targets.includes(h.cause)) {
    return {
      allowed: false,
      reason: "action_not_justified",
      authorityStatus: "causal",
      detail:
        `Causal authority exists for ${h.cause}→${h.effect}, ` +
        `but action ${action.name} (targets=[${action.targets.join(",")}]) ` +
        `is not justified by that causal relation`,
    };
  }

  return {
    allowed: true,
    claimId: h.id,
    action: action.name,
    cause: h.cause,
    effect: h.effect,
  };
}

export function claimKey(cause: Var, effect: Var): string {
  return edgeKey(cause, effect);
}
