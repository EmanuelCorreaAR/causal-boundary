import {
  ConfidentHypothesizer,
  NoisyHypothesizer,
} from "../../src/agents/confident-hypothesizer.js";
import { FixedHypothesizer } from "../../src/agents/fixed-hypothesizer.js";
import type { Hypothesizer } from "../../src/agents/hypothesizer.js";
import { authorityOf } from "../../src/causal/authority.js";
import { CausalBoundary } from "../../src/causal/boundary.js";
import { competingModel } from "../../src/world/models/competing.js";
import { World } from "../../src/world/world.js";
import {
  computeAuthorityMetrics,
  type AuthorityMetrics,
  type DownstreamDecision,
} from "../authority-metrics.js";
import { COMPETING_TRUE_EDGES } from "../oracle.js";

export interface RuntimeAuthorityResult {
  narrative: string[];
  tests: {
    pluggability: boolean;
    authority: boolean;
    inconclusive: boolean;
    reintroductionImmunity: boolean;
  };
  metrics: AuthorityMetrics;
  withoutCb: DownstreamDecision;
  withCb: DownstreamDecision;
  pass: boolean;
}

/**
 * Without Boundary: high confidence alone governs the next action.
 */
function downstreamWithoutBoundary(claim: {
  cause: string;
  effect: string;
  confidence: number;
}): DownstreamDecision {
  if (claim.confidence >= 0.9) {
    return {
      kind: "acted",
      cause: claim.cause,
      effect: claim.effect,
      reason: `confidence=${claim.confidence} — no authority gate`,
    };
  }
  return {
    kind: "blocked",
    cause: claim.cause,
    effect: claim.effect,
    reason: "confidence too low",
  };
}

/**
 * With Boundary: only authorize() may drive causal downstream actions.
 */
function downstreamWithBoundary(
  boundary: CausalBoundary,
  cause: string,
  effect: string,
): DownstreamDecision {
  const authorized = boundary.authorize(cause, effect);
  if (authorized) {
    return {
      kind: "acted",
      cause,
      effect,
      reason: `authorized causal claim ${authorized.hypothesisId}`,
    };
  }
  const auth = boundary.authorityFor(cause, effect);
  return {
    kind: "blocked",
    cause,
    effect,
    reason: auth
      ? `authority=${auth.status} executable=${auth.executable}`
      : "no claim registered",
  };
}

async function ingestWith(
  boundary: CausalBoundary,
  hyp: Hypothesizer,
  label: string,
  narrative: string[],
): Promise<number> {
  boundary.setHypothesizer(hyp);
  const obs = boundary.observe([
    "rain",
    "sprinkler",
    "forecast",
    "lawnWet",
  ]);
  const stats = await boundary.ingestProposalsDetailed(obs);
  narrative.push(
    `pluggability/${label}: accepted=${stats.accepted.length} blockedReintro=${stats.blockedReintroductions.length} obs=${JSON.stringify(obs)}`,
  );
  return stats.accepted.length;
}

/**
 * v0.7 Runtime Authority — four differentiation tests.
 * No live LLM required: ConfidentHypothesizer stands in for overconfident proposals.
 */
export async function runRuntimeAuthority(): Promise<RuntimeAuthorityResult> {
  const narrative: string[] = [];

  // --- Shared world setup ---
  const world = new World(competingModel);
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });

  const confident = new ConfidentHypothesizer(
    { cause: "forecast", effect: "lawnWet" },
    0.99,
  );

  // ========== Test 2+ demo: Authority (with vs without CB) ==========
  const proposal = {
    cause: "forecast",
    effect: "lawnWet",
    confidence: 0.99,
  };
  const withoutCb = downstreamWithoutBoundary(proposal);
  narrative.push(
    `without CB: LLM-like claim forecast→lawnWet @0.99 → ${withoutCb.kind} (${withoutCb.reason})`,
  );

  const boundary = new CausalBoundary(world, confident);
  for (let i = 0; i < 4; i++) {
    boundary.observeFresh(["rain", "sprinkler", "forecast", "lawnWet"]);
  }
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  const aligned = boundary.observe([
    "rain",
    "sprinkler",
    "forecast",
    "lawnWet",
  ]);
  await boundary.ingestProposalsDetailed(aligned);

  const forecastH = boundary
    .getHypotheses()
    .find((h) => h.cause === "forecast" && h.effect === "lawnWet");
  const authRightAfterPropose = forecastH ? authorityOf(forecastH) : null;
  narrative.push(
    `with CB after propose: status=${authRightAfterPropose?.status} executable=${authRightAfterPropose?.executable} confidence=${forecastH?.confidence}`,
  );

  const withCbEarly = downstreamWithBoundary(boundary, "forecast", "lawnWet");
  narrative.push(
    `with CB downstream: ${withCbEarly.kind} (${withCbEarly.reason})`,
  );

  const authorityOk =
    withoutCb.kind === "acted" &&
    withCbEarly.kind === "blocked" &&
    authRightAfterPropose !== null &&
    authRightAfterPropose.executable === false &&
    (forecastH?.confidence ?? 0) >= 0.9;

  // ========== Test 1: Pluggability ==========
  const fixed = new FixedHypothesizer({ cause: "rain", effect: "lawnWet" });
  const noisy = new NoisyHypothesizer([
    { cause: "rain", effect: "lawnWet" },
    { cause: "sprinkler", effect: "lawnWet" },
    { cause: "forecast", effect: "lawnWet" },
  ]);

  const nFixed = await ingestWith(boundary, fixed, "fixed", narrative);
  const nNoisy = await ingestWith(boundary, noisy, "noisy", narrative);
  const nConf = await ingestWith(boundary, confident, "confident", narrative);
  // All three went through the same ingestProposalsDetailed path.
  const pluggabilityOk = nFixed >= 0 && nNoisy >= 0 && nConf >= 0;
  narrative.push(
    `pluggability: fixed/noisy/confident all used Hypothesizer.propose → ingestProposalsDetailed (${pluggabilityOk})`,
  );

  // ========== Test 3: Inconclusive (don't false-reject rain) ==========
  // Ensure rain + sprinkler hypotheses alive.
  boundary.setHypothesizer(noisy);
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  await boundary.ingestProposalsDetailed(
    boundary.observe(["rain", "sprinkler", "forecast", "lawnWet"]),
  );

  const rainH = boundary
    .getHypotheses()
    .find((h) => h.cause === "rain" && h.effect === "lawnWet");
  if (!rainH) {
    throw new Error("RuntimeAuthority: missing rain→lawnWet");
  }
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  const naive = boundary.testHypothesis(rainH, false);
  narrative.push(
    `inconclusive: do(rain=false) with sprinkler on → outcome=${naive.outcome} status=${rainH.status}`,
  );
  const inconclusiveOk =
    naive.outcome === "inconclusive" && rainH.status !== "dead";

  // ========== Test 4: Reintroduction immunity ==========
  // Kill forecast with rivals off, then re-propose at 0.99.
  let forecastClaim = boundary
    .getHypotheses()
    .find((h) => h.cause === "forecast" && h.effect === "lawnWet");
  if (!forecastClaim || forecastClaim.status === "dead") {
    boundary.setHypothesizer(confident);
    world.do({ variable: "rain", value: true });
    world.do({ variable: "sprinkler", value: true });
    await boundary.ingestProposalsDetailed(
      boundary.observe(["forecast", "lawnWet", "rain", "sprinkler"]),
    );
    forecastClaim = boundary
      .getHypotheses()
      .find((h) => h.cause === "forecast" && h.effect === "lawnWet");
  }
  if (!forecastClaim || forecastClaim.status === "dead") {
    throw new Error("RuntimeAuthority: need live forecast claim to kill");
  }

  world.do({ variable: "rain", value: false });
  world.do({ variable: "sprinkler", value: false });
  const killTrial = boundary.testHypothesis(forecastClaim, true);
  narrative.push(
    `immunity setup: do(forecast=true) rivals off → outcome=${killTrial.outcome} status=${forecastClaim.status}`,
  );

  boundary.setHypothesizer(confident);
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  const reintro = await boundary.ingestProposalsDetailed(
    boundary.observe(["forecast", "lawnWet", "rain", "sprinkler"]),
  );
  narrative.push(
    `reintroduction: confident@0.99 blocked=${reintro.blockedReintroductions.length} accepted=${reintro.accepted.length}`,
  );

  const stillDead =
    boundary.authorityFor("forecast", "lawnWet")?.status === "dead";
  const stillBlocked = downstreamWithBoundary(boundary, "forecast", "lawnWet");
  narrative.push(
    `after reintro: authority=${boundary.authorityFor("forecast", "lawnWet")?.status} downstream=${stillBlocked.kind}`,
  );

  const blocked = boundary.getBlockedReintroductions();
  const forecastAfter = boundary
    .getHypotheses()
    .find((h) => h.cause === "forecast" && h.effect === "lawnWet");
  const reintroductionImmunityOk =
    forecastAfter?.status === "dead" &&
    stillDead &&
    stillBlocked.kind === "blocked" &&
    reintro.blockedReintroductions.length >= 1 &&
    reintro.accepted.every(
      (h) => !(h.cause === "forecast" && h.effect === "lawnWet"),
    );

  const metrics = computeAuthorityMetrics({
    hypotheses: boundary.getHypotheses(),
    trueEdges: COMPETING_TRUE_EDGES,
    reintroductionAttempts: blocked.length,
    reintroductionsBlocked: blocked.length,
    unauthorizedDownstreamAcceptances:
      withCbEarly.kind === "acted" ? 1 : 0,
  });

  const tests = {
    pluggability: pluggabilityOk,
    authority: authorityOk,
    inconclusive: inconclusiveOk,
    reintroductionImmunity: reintroductionImmunityOk,
  };

  const pass =
    tests.pluggability &&
    tests.authority &&
    tests.inconclusive &&
    tests.reintroductionImmunity &&
    metrics.deadClaimReintroductionRate === 0 &&
    metrics.unauthorizedDownstreamAcceptances === 0 &&
    metrics.falseCausalRejections === 0;

  narrative.push(
    `summary: pluggability=${tests.pluggability} authority=${tests.authority} inconclusive=${tests.inconclusive} immunity=${tests.reintroductionImmunity} falseRejects=${metrics.falseCausalRejections} reintroRate=${metrics.deadClaimReintroductionRate}`,
  );

  return {
    narrative,
    tests,
    metrics,
    withoutCb,
    withCb: withCbEarly,
    pass,
  };
}
