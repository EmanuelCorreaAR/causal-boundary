/**
 * Live Gemini gate test — free tier (Google AI Studio).
 *
 * Only **two** live inferences:
 *   #1 forecast→lawnWet  → blocked → dead → reinject same proposal → immune
 *   #2 rain→lawnWet      → blocked → evidence ×2 → causal → established
 *
 * Reintroduction reuses the real Gemini proposal (no extra RPM).
 * Quota / rate limit ≠ Boundary failure → wait once or SKIP continuation.
 *
 *   npm run test:gemini
 */
import type { Hypothesizer } from "../src/agents/hypothesizer.js";
import {
  GeminiTransport,
  LlmRateLimitError,
  LlmUnavailableError,
} from "../src/agents/llm-transport.js";
import { LlmHypothesizer } from "../src/agents/llm-hypothesizer.js";
import { CausalBoundary } from "../src/causal/boundary.js";
import type { HypothesisProposal } from "../src/causal/types.js";
import { competingModel } from "../src/world/models/competing.js";
import type { Observation } from "../src/world/state.js";
import { World } from "../src/world/world.js";
import { requireGeminiKey } from "./load-env.js";

const VARS = ["rain", "sprinkler", "forecast", "lawnWet"] as const;

/** Replay a captured live proposal without another provider call. */
class ReplayHypothesizer implements Hypothesizer {
  constructor(private readonly proposals: HypothesisProposal[]) {}
  async propose(_observation: Observation): Promise<HypothesisProposal[]> {
    return this.proposals;
  }
}

async function ingestCaptured(
  boundary: CausalBoundary,
  llm: LlmHypothesizer,
  proposals: HypothesisProposal[],
  observation: Observation,
) {
  boundary.setHypothesizer(new ReplayHypothesizer(proposals));
  try {
    return await boundary.ingestProposalsDetailed(observation);
  } finally {
    boundary.setHypothesizer(llm);
  }
}

async function livePropose(
  llm: LlmHypothesizer,
  observation: Observation,
  steer: string,
): Promise<HypothesisProposal[]> {
  llm.setSteer(steer);
  return llm.propose(observation);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * One live call. On 429: wait retryAfter + margin, then one more attempt.
 * Still 429 → null (caller may SKIP). Boundary semantics unchanged.
 */
async function liveProposeRespectingQuota(
  llm: LlmHypothesizer,
  observation: Observation,
  steer: string,
  label: string,
): Promise<HypothesisProposal[] | null> {
  try {
    return await livePropose(llm, observation, steer);
  } catch (err) {
    if (err instanceof LlmUnavailableError) {
      console.log(
        `\n   [${label}] hypothesizer unavailable (${err.message}) → ` +
          `SKIP (authority state unchanged)`,
      );
      return null;
    }
    if (!(err instanceof LlmRateLimitError)) throw err;
    const waitMs = err.retryAfterMs + 2000;
    console.log(
      `\n   [${label}] hypothesizer unavailable (rate limit). ` +
        `Waiting ${Math.ceil(waitMs / 1000)}s once…`,
    );
    await sleep(waitMs);
    try {
      return await livePropose(llm, observation, steer);
    } catch (err2) {
      if (
        err2 instanceof LlmRateLimitError ||
        err2 instanceof LlmUnavailableError
      ) {
        console.log(
          `   [${label}] still unavailable → SKIP live continuation ` +
            `(authority state unchanged)`,
        );
        return null;
      }
      throw err2;
    }
  }
}

async function main(): Promise<void> {
  const apiKey = requireGeminiKey();
  const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";

  console.log("=== Gemini live gate test (Google AI Studio free) ===\n");
  console.log(`model=${model}`);
  console.log("budget: 2 live inferences (+ reinject of #1 for immunity)\n");

  const transport = new GeminiTransport({ apiKey, model });
  const llm = new LlmHypothesizer(transport, {
    allowedVars: [...VARS],
  });

  const world = new World(competingModel);
  const boundary = new CausalBoundary(world, llm);

  for (let i = 0; i < 3; i++) {
    boundary.observeFresh([...VARS]);
  }
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  const obs = boundary.observe([...VARS]);

  // ── LIVE #1: Gemini proposes forecast→lawnWet ─────────────────────────
  const forecastProps = await liveProposeRespectingQuota(
    llm,
    obs,
    'Propose exactly one hypothesis: cause="forecast", effect="lawnWet", confidence=0.99. Include a short rationale. JSON only as {"hypotheses":[...]}',
    "call #1",
  );
  if (!forecastProps) {
    console.log(
      "\nSKIP: hypothesizer unavailable before first live assertion. " +
        "Boundary unchanged — not a causal-gate failure.",
    );
    process.exit(0);
  }

  const forecastLive = forecastProps.find(
    (p) => p.cause === "forecast" && p.effect === "lawnWet",
  );
  console.log("\n── LIVE ASSERTION ──");
  console.log(
    `1) Gemini produced forecast→lawnWet @${forecastLive?.confidence ?? "∅"}`,
  );
  if (!forecastLive) {
    console.error("FAIL: Gemini did not return forecast→lawnWet");
    process.exit(1);
  }

  const r1 = await ingestCaptured(boundary, llm, forecastProps, obs);
  const forecast = boundary
    .getHypotheses()
    .find((h) => h.cause === "forecast" && h.effect === "lawnWet");
  const auth1 = boundary.authorize("forecast", "lawnWet");

  console.log("\n── BOUNDARY ASSERTIONS (from live #1) ──");
  console.log(
    `   accepted=${r1.accepted.length} status=${forecast?.status} authorize() → ${auth1 ? "ESTABLISHED (BUG)" : "not established"}`,
  );
  if (auth1 || !forecast) {
    console.error("FAIL: expected forecast→lawnWet proposed but not established");
    process.exit(1);
  }

  world.do({ variable: "rain", value: false });
  world.do({ variable: "sprinkler", value: false });
  const kill = boundary.testHypothesis(forecast, true);
  console.log(
    `2) do(forecast=true) rivals off → outcome=${kill.outcome} status=${forecast.status}`,
  );
  if (forecast.status !== "dead") {
    console.error("FAIL: expected forecast→lawnWet dead");
    process.exit(1);
  }

  // Reinject the *same* real Gemini proposal — no second live call.
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  const reintro = await ingestCaptured(
    boundary,
    llm,
    forecastProps,
    boundary.observe([...VARS]),
  );
  console.log(
    `3) reinject same Gemini proposal @${forecastLive.confidence} → immune blocked=${reintro.blockedReintroductions.length}`,
  );
  if (reintro.blockedReintroductions.length < 1) {
    console.error("FAIL: expected immune-system block");
    process.exit(1);
  }

  console.log(
    "\n   ✓ live #1 gate: propose → BLOCKED → DEAD → IMMUNE (no privilege from Gemini)",
  );

  // ── LIVE #2: rain→lawnWet (may wait once for free-tier RPM) ────────────
  world.do({ variable: "sprinkler", value: false });
  world.do({ variable: "rain", value: true });
  const rainObs = boundary.observe([...VARS]);

  const rainProps = await liveProposeRespectingQuota(
    llm,
    rainObs,
    'Propose exactly one hypothesis: cause="rain", effect="lawnWet", confidence=0.63. JSON only.',
    "call #2",
  );
  if (!rainProps) {
    console.log(
      "\nPARTIAL PASS: call #1 proved the gate with a real Gemini claim. " +
        "call #2 skipped (hypothesizer unavailable / quota). " +
        "Authority state unchanged for rain.",
    );
    process.exit(0);
  }

  const rainLive = rainProps.find(
    (p) => p.cause === "rain" && p.effect === "lawnWet",
  );
  console.log("\n── LIVE ASSERTION ──");
  console.log(
    `4) Gemini produced rain→lawnWet @${rainLive?.confidence ?? "∅"}`,
  );
  if (!rainLive) {
    console.error("FAIL: Gemini did not return rain→lawnWet");
    process.exit(1);
  }

  await ingestCaptured(boundary, llm, rainProps, rainObs);
  const rain = boundary
    .getHypotheses()
    .find((h) => h.cause === "rain" && h.effect === "lawnWet");
  if (!rain) {
    console.error("FAIL: rain→lawnWet not ingested");
    process.exit(1);
  }

  console.log("\n── BOUNDARY ASSERTIONS (from live #2) ──");
  console.log(
    `   status=${rain.status} authorize() → ${boundary.authorize("rain", "lawnWet") ? "ESTABLISHED (BUG)" : "not established"}`,
  );
  if (boundary.authorize("rain", "lawnWet")) {
    console.error("FAIL: rain claim established before evidence");
    process.exit(1);
  }

  world.do({ variable: "sprinkler", value: false });
  world.do({ variable: "rain", value: true });
  boundary.testHypothesis(rain, false);
  boundary.testHypothesis(rain, true);
  const authRain = boundary.authorize("rain", "lawnWet");
  console.log(
    `5) after evidence status=${rain.status} authorize() → ${authRain ? "ESTABLISHED" : "not established"}`,
  );

  if (rain.status !== "causal" || !authRain) {
    console.error("FAIL: expected rain→lawnWet causal + established");
    process.exit(1);
  }

  console.log(
    "\nPASS: 2 live Gemini inferences; Boundary establishes claims only after evidence.",
  );
}

main().catch((err) => {
  if (err instanceof LlmRateLimitError || err instanceof LlmUnavailableError) {
    console.error(
      `\nSKIP: hypothesizer unavailable (${err.message}). ` +
        `LLM quota/capacity ≠ Boundary failure.`,
    );
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
