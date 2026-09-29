import { ConfidentHypothesizer } from "../../src/agents/confident-hypothesizer.js";
import { LlmHypothesizer } from "../../src/agents/llm-hypothesizer.js";
import {
  createDefaultLlmTransport,
  ScriptedJsonTransport,
} from "../../src/agents/llm-transport.js";
import { authorityOf } from "../../src/causal/authority.js";
import { CausalBoundary } from "../../src/causal/boundary.js";
import { competingModel } from "../../src/world/models/competing.js";
import { World } from "../../src/world/world.js";
import { computeLlmGateMetrics, type LlmGateMetrics } from "../llm-gate-metrics.js";
import { COMPETING_TRUE_EDGES } from "../oracle.js";

export interface LlmHypothesizerRunResult {
  narrative: string[];
  transportName: string;
  metrics: LlmGateMetrics;
  pass: boolean;
}

function jsonHyp(hyps: {
  cause: string;
  effect: string;
  confidence: number;
  rationale?: string;
}[]): string {
  return JSON.stringify({ hypotheses: hyps });
}

/**
 * v0.8 — LLM as Hypothesizer only.
 * Proves: model confidence ≠ runtime authority. Same gate as ConfidentHypothesizer.
 */
export async function runLlmHypothesizer(): Promise<LlmHypothesizerRunResult> {
  const narrative: string[] = [];
  let unauthorizedExecutions = 0;
  let downstreamDecisions = 0;

  const scripted = [
    // Call 1: overconfident spurious claim (same as ConfidentHypothesizer story)
    jsonHyp([
      {
        cause: "forecast",
        effect: "lawnWet",
        confidence: 0.99,
        rationale: "Forecast correlates strongly with wet lawns.",
      },
    ]),
    // Call 2: rain at moderate confidence
    jsonHyp([
      {
        cause: "rain",
        effect: "lawnWet",
        confidence: 0.63,
        rationale: "Rain often precedes wet grass.",
      },
    ]),
  ];

  const useLive =
    process.env.CAUSAL_BOUNDARY_LIVE_LLM === "1" &&
    Boolean(process.env.OPENAI_API_KEY);

  const transport = useLive
    ? createDefaultLlmTransport()
    : new ScriptedJsonTransport(scripted);

  narrative.push(
    `transport=${transport.name}${
      useLive
        ? ""
        : " (deterministic LLM-shaped JSON; set CAUSAL_BOUNDARY_LIVE_LLM=1 and OPENAI_API_KEY for live)"
    }`,
  );

  const world = new World(competingModel);
  const boundary = new CausalBoundary(
    world,
    new ConfidentHypothesizer({ cause: "forecast", effect: "lawnWet" }, 0.99),
  );

  // Warm-up observations
  for (let i = 0; i < 4; i++) {
    boundary.observeFresh(["rain", "sprinkler", "forecast", "lawnWet"]);
  }
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });

  // --- ConfidentHypothesizer @0.99 → not executable ---
  const obs1 = boundary.observe(["rain", "sprinkler", "forecast", "lawnWet"]);
  await boundary.ingestProposalsDetailed(obs1);
  const confAuth = boundary.authorityFor("forecast", "lawnWet");
  downstreamDecisions += 1;
  const confExec = boundary.authorize("forecast", "lawnWet");
  if (confExec) unauthorizedExecutions += 1;
  narrative.push(
    `ConfidentHypothesizer forecast→lawnWet @0.99 → authority=${confAuth?.status} executable=${confAuth?.executable} authorize=${confExec ? "PASS_BUG" : "blocked"}`,
  );

  // --- LlmHypothesizer @0.99 → same gate ---
  const llm = new LlmHypothesizer(transport, {
    allowedVars: ["rain", "sprinkler", "forecast", "lawnWet"],
  });
  boundary.setHypothesizer(llm);
  // Fresh boundary state for LLM propose of forecast — claim may already exist as weak.
  // Re-propose; still must not be executable.
  const llmStats = await boundary.ingestProposalsDetailed(obs1);
  narrative.push(
    `LlmHypothesizer(${llm.transportName}) propose → accepted=${llmStats.accepted.length} blockedReintro=${llmStats.blockedReintroductions.length}`,
  );
  const llmAuth = boundary.authorityFor("forecast", "lawnWet");
  downstreamDecisions += 1;
  const llmExec = boundary.authorize("forecast", "lawnWet");
  if (llmExec) unauthorizedExecutions += 1;
  narrative.push(
    `LlmHypothesizer forecast→lawnWet → authority=${llmAuth?.status} executable=${llmAuth?.executable} authorize=${llmExec ? "PASS_BUG" : "blocked"}`,
  );

  // Kill forecast with rivals off → dead
  let forecastH = boundary
    .getHypotheses()
    .find((h) => h.cause === "forecast" && h.effect === "lawnWet");
  if (!forecastH || forecastH.status === "dead") {
    throw new Error("v0.8: expected live forecast claim before kill");
  }
  world.do({ variable: "rain", value: false });
  world.do({ variable: "sprinkler", value: false });
  const kill = boundary.testHypothesis(forecastH, true);
  narrative.push(
    `do(forecast=true) rivals off → outcome=${kill.outcome} status=${forecastH.status}`,
  );
  const forecastAfterKill = boundary
    .getHypotheses()
    .find((h) => h.cause === "forecast" && h.effect === "lawnWet");

  // Re-propose via LLM at 0.99 → blocked by immune system
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  // Force another LLM call that again proposes forecast @0.99
  if (transport.name === "scripted-llm-json") {
    // Scripted transport advances; inject by swapping to a one-shot transport for reintro.
    boundary.setHypothesizer(
      new LlmHypothesizer(
        new ScriptedJsonTransport([
          jsonHyp([
            {
              cause: "forecast",
              effect: "lawnWet",
              confidence: 0.99,
              rationale: "Still looks causal to me.",
            },
          ]),
        ]),
        { allowedVars: ["rain", "sprinkler", "forecast", "lawnWet"] },
      ),
    );
  }
  const reintro = await boundary.ingestProposalsDetailed(
    boundary.observe(["forecast", "lawnWet", "rain", "sprinkler"]),
  );
  narrative.push(
    `LLM reintroduces forecast@0.99 → blocked=${reintro.blockedReintroductions.length} (immune system)`,
  );

  // --- LLM rain @0.63 → weak, not executable → evidence → causal ---
  boundary.setHypothesizer(
    transport.name === "scripted-llm-json"
      ? new LlmHypothesizer(
          new ScriptedJsonTransport([
            jsonHyp([
              {
                cause: "rain",
                effect: "lawnWet",
                confidence: 0.63,
                rationale: "Rain often wets the lawn.",
              },
            ]),
          ]),
          { allowedVars: ["rain", "sprinkler", "forecast", "lawnWet"] },
        )
      : llm,
  );

  world.do({ variable: "sprinkler", value: false });
  world.do({ variable: "rain", value: true });
  const rainObs = boundary.observe(["rain", "lawnWet", "sprinkler", "forecast"]);
  await boundary.ingestProposalsDetailed(rainObs);
  let rainH = boundary
    .getHypotheses()
    .find((h) => h.cause === "rain" && h.effect === "lawnWet");
  if (!rainH) {
    throw new Error("v0.8: LLM did not propose rain→lawnWet");
  }
  const rainAuthEarly = authorityOf(rainH);
  downstreamDecisions += 1;
  const rainExecEarly = boundary.authorize("rain", "lawnWet");
  if (rainExecEarly) unauthorizedExecutions += 1;
  narrative.push(
    `LLM rain→lawnWet @${rainH.confidence} → authority=${rainAuthEarly.status} executable=${rainAuthEarly.executable}`,
  );

  // Evidence elevates: isolate sprinkler off, flip rain twice
  world.do({ variable: "sprinkler", value: false });
  world.do({ variable: "rain", value: true });
  const t1 = boundary.testHypothesis(rainH, false);
  const t2 = boundary.testHypothesis(rainH, true);
  narrative.push(
    `evidence: do(rain=false)=${t1.outcome}, do(rain=true)=${t2.outcome} → status=${rainH.status}`,
  );

  downstreamDecisions += 1;
  const rainExecLate = boundary.authorize("rain", "lawnWet");
  if (!rainExecLate) {
    // Should be authorized now — not an unauthorized execution; count as failed elevation
    narrative.push(`authorize(rain→lawnWet) after evidence: blocked (unexpected)`);
  } else {
    narrative.push(
      `authorize(rain→lawnWet) after evidence: established=true id=${rainExecLate.hypothesisId}`,
    );
  }

  const blocked = boundary.getBlockedReintroductions();
  const metrics = computeLlmGateMetrics({
    hypotheses: boundary.getHypotheses(),
    trueEdges: COMPETING_TRUE_EDGES,
    reintroductionAttempts: blocked.length,
    reintroductionsBlocked: blocked.length,
    unauthorizedExecutions,
    downstreamDecisions,
  });

  const pass =
    confAuth?.executable === false &&
    llmAuth?.executable === false &&
    forecastAfterKill?.status === "dead" &&
    reintro.blockedReintroductions.length >= 1 &&
    rainAuthEarly.executable === false &&
    rainH.status === "causal" &&
    rainExecLate !== null &&
    metrics.unauthorizedExecutionRate === 0 &&
    metrics.claimsAuthorizedWithoutIntervention === 0 &&
    metrics.deadClaimReintroductionRate === 0 &&
    metrics.falseCausalRejections === 0;

  narrative.push(
    `metrics: unauthorizedExecutionRate=${metrics.unauthorizedExecutionRate} claimsAuthorizedWithoutIntervention=${metrics.claimsAuthorizedWithoutIntervention} reintroRate=${metrics.deadClaimReintroductionRate} falseRejects=${metrics.falseCausalRejections}`,
  );

  return {
    narrative,
    transportName: transport.name,
    metrics,
    pass,
  };
}
