import type { EvidenceItem, Hypothesis, HypothesisStatus } from "./types.js";

const RANK: Record<HypothesisStatus, number> = {
  proposed: 0,
  weak: 1,
  supported: 2,
  causal: 3,
  dead: -1,
};

export function appendEvidence(h: Hypothesis, item: EvidenceItem): void {
  h.evidence.push(item);
}

export function promote(h: Hypothesis, next: HypothesisStatus): void {
  if (h.status === "dead") return;
  if (RANK[next] > RANK[h.status]) {
    h.status = next;
  }
}

export function kill(h: Hypothesis, reason: string, evidence: EvidenceItem): void {
  appendEvidence(h, evidence);
  h.status = "dead";
  h.deathReason = reason;
}

export function isAlive(h: Hypothesis): boolean {
  return h.status !== "dead";
}

export function edgeKey(cause: string, effect: string): string {
  return `${cause}->${effect}`;
}

/** Count confirming intervention evidence items. */
export function supportCount(h: Hypothesis): number {
  return h.evidence.filter((e) => e.kind === "intervention_support").length;
}
