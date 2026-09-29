import type { Observation, Var } from "../world/state.js";
import type { HypothesisProposal } from "../causal/types.js";
import type { Hypothesizer } from "./hypothesizer.js";
import type { LlmTransport } from "./llm-transport.js";

const SYSTEM = `You are a causal hypothesizer. Given a partial observation of boolean variables,
propose possible cause→effect edges. Respond with JSON only:
{"hypotheses":[{"cause":"var","effect":"var","confidence":0.0,"rationale":"..."}]}
confidence is in [0,1]. Do not claim certainty equals truth. Only propose edges among observed keys.`;

/**
 * LLM as Hypothesizer only.
 * Must not import or call authorize(), World, EvidenceStore, or CausalBoundary.
 */
export class LlmHypothesizer implements Hypothesizer {
  private steer: string | undefined;

  constructor(
    private readonly transport: LlmTransport,
    private readonly opts?: {
      /** If set, only keep proposals whose cause/effect are in this allowlist. */
      allowedVars?: readonly Var[];
    },
  ) {}

  get transportName(): string {
    return this.transport.name;
  }

  /** Optional per-call instruction (used in live ChatGPT demos). */
  setSteer(instruction: string | undefined): void {
    this.steer = instruction;
  }

  async propose(observation: Observation): Promise<HypothesisProposal[]> {
    const keys = Object.keys(observation);
    if (keys.length < 2) return [];

    const user = JSON.stringify({
      observation,
      instruction:
        this.steer ??
        "Propose zero or more causal hypotheses among the observed variables.",
    });

    const raw = await this.transport.complete(SYSTEM, user);
    return parseHypothesesJson(raw, keys, this.opts?.allowedVars);
  }
}

/** Pure parser — shared by live and scripted transports. */
export function parseHypothesesJson(
  raw: string,
  observedKeys: string[],
  allowedVars?: readonly Var[],
): HypothesisProposal[] {
  const trimmed = raw.trim();
  const jsonText = extractJsonObject(trimmed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }

  const list = normalizeHypothesesArray(parsed);
  const observed = new Set(observedKeys);
  const allowed = allowedVars ? new Set(allowedVars) : null;
  const out: HypothesisProposal[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const cause = String(rec.cause ?? "");
    const effect = String(rec.effect ?? "");
    const confidence = Number(rec.confidence);
    if (!cause || !effect || cause === effect) continue;
    if (!observed.has(cause) || !observed.has(effect)) continue;
    if (allowed && (!allowed.has(cause) || !allowed.has(effect))) continue;
    if (!Number.isFinite(confidence)) continue;
    const rationale =
      typeof rec.rationale === "string" ? rec.rationale : undefined;
    out.push({
      cause,
      effect,
      confidence: Math.min(1, Math.max(0, confidence)),
      rationale,
    });
  }
  return out;
}

function normalizeHypothesesArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const hyp = (parsed as { hypotheses?: unknown }).hypotheses;
    if (Array.isArray(hyp)) return hyp;
  }
  return [];
}

function extractJsonObject(text: string): string {
  if (text.startsWith("{") || text.startsWith("[")) return text;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}
