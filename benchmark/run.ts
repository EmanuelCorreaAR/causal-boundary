import { runActiveSelection } from "./experiments/active-selection.js";
import { runAgentTools } from "./experiments/agent-tools.js";
import { runCompeting } from "./experiments/competing.js";
import { runCompetingExplanations } from "./experiments/explanations.js";
import { runConfirmation } from "./experiments/confirmation.js";
import { runConfounder } from "./experiments/confounder.js";
import { runLlmHypothesizer } from "./experiments/llm-hypothesizer.js";
import { runRooster } from "./experiments/rooster.js";
import { runRuntimeAuthority } from "./experiments/runtime-authority.js";

function printSection(
  title: string,
  narrative: string[],
  hypotheses: {
    id: string;
    cause: string;
    effect: string;
    status: string;
    confidence: number;
    deathReason?: string;
    evidence: { kind: string; at: number; detail: string }[];
  }[],
  metrics: unknown,
): void {
  console.log(`\n=== ${title} ===\n`);
  console.log("Narrative:");
  for (const line of narrative) {
    console.log(`  ${line}`);
  }
  console.log("\nHypotheses:");
  for (const h of hypotheses) {
    console.log(
      `  ${h.id} ${h.cause} → ${h.effect}  status=${h.status}  confidence=${h.confidence}`,
    );
    if (h.deathReason) {
      console.log(`    deathReason: ${h.deathReason}`);
    }
    for (const e of h.evidence) {
      console.log(`    [${e.kind}@${e.at}] ${e.detail}`);
    }
  }
  console.log("\nMetrics:");
  console.log(JSON.stringify(metrics, null, 2));
}

function metricsPayload(m: {
  edgeDiscovery: number;
  spuriousRejection: number;
  hypothesisPredictionAccuracy: number;
  details: unknown;
}) {
  return {
    edgeDiscovery: m.edgeDiscovery,
    spuriousRejection: m.spuriousRejection,
    hypothesisPredictionAccuracy: m.hypothesisPredictionAccuracy,
    details: m.details,
  };
}

async function main(): Promise<void> {
  console.log("Causal Boundary — suite\n");
  console.log("Authorities: Hypothesizer proposes | World determines | Boundary decides.");
  console.log("Oracle (true graph) is benchmark-only — never imported by src/.\n");

  const falsification = await runRooster({ observationCount: 5 });
  printSection(
    "v0.1 Falsification — The Rooster",
    falsification.narrative,
    falsification.hypotheses,
    metricsPayload(falsification.metrics),
  );

  const confirmation = await runConfirmation({ observationCount: 5 });
  printSection(
    "v0.2 Confirmation — sunrise → rooster",
    confirmation.narrative,
    confirmation.hypotheses,
    metricsPayload(confirmation.metrics),
  );

  const confounder = await runConfounder({ observationCount: 5 });
  printSection(
    "v0.3 Confounding — common cause",
    confounder.narrative,
    confounder.hypotheses,
    metricsPayload(confounder.metrics),
  );

  const competing = await runCompeting({ observationCount: 6 });
  printSection(
    "v0.4 Multiple causes — rain / sprinkler → lawnWet",
    competing.narrative,
    competing.hypotheses,
    metricsPayload(competing.metrics),
  );

  const explanations = await runCompetingExplanations({ observationCount: 6 });
  printSection(
    "v0.5 Competing explanations — inconclusive vs contradiction",
    explanations.narrative,
    explanations.hypotheses,
    metricsPayload(explanations.metrics),
  );

  const active = await runActiveSelection();
  console.log("\n=== v0.6 Active experiment selection — Disagreement vs Random ===\n");
  console.log("Disagreement demo:");
  for (const line of active.demoDisagreement.narrative) {
    console.log(`  ${line}`);
  }
  console.log("\nRandom demo (same seed):");
  for (const line of active.demoRandom.narrative) {
    console.log(`  ${line}`);
  }
  console.log("\nAggregate:");
  console.log(JSON.stringify(active.aggregate, null, 2));
  console.log(
    `\nDemo experimentsToResolution: disagreement=${active.demoDisagreement.metrics.experimentsToResolution} random=${active.demoRandom.metrics.experimentsToResolution}`,
  );

  const runtime = await runRuntimeAuthority();
  console.log("\n=== v0.7 Runtime Authority — four differentiation tests ===\n");
  for (const line of runtime.narrative) {
    console.log(`  ${line}`);
  }
  console.log("\nTests:");
  console.log(JSON.stringify(runtime.tests, null, 2));
  console.log("\nAuthority metrics:");
  console.log(JSON.stringify(runtime.metrics, null, 2));
  console.log(
    `\nDemo contrast: withoutCB=${runtime.withoutCb.kind} withCB=${runtime.withCb.kind}`,
  );

  const llmGate = await runLlmHypothesizer();
  console.log("\n=== v0.8 LLM Hypothesizer — same gate, no free authority ===\n");
  for (const line of llmGate.narrative) {
    console.log(`  ${line}`);
  }
  console.log("\nLLM gate metrics:");
  console.log(
    JSON.stringify(
      {
        unauthorizedExecutionRate: llmGate.metrics.unauthorizedExecutionRate,
        claimsAuthorizedWithoutIntervention:
          llmGate.metrics.claimsAuthorizedWithoutIntervention,
        deadClaimReintroductionRate: llmGate.metrics.deadClaimReintroductionRate,
        falseCausalRejections: llmGate.metrics.falseCausalRejections,
        details: llmGate.metrics.details,
      },
      null,
      2,
    ),
  );

  const agentTools = await runAgentTools();
  console.log(
    "\n=== v1.0 Action-justified tools — evidence ≠ blanket permission ===\n",
  );
  for (const line of agentTools.narrative) {
    console.log(`  ${line}`);
  }
  console.log("\nTool gate metrics:");
  console.log(JSON.stringify(agentTools.metrics, null, 2));
  console.log(
    `\nDemo: withoutCB=${agentTools.withoutCb.status} withCB(pre)=${agentTools.withCbBlocked.status} withCB(post)=${agentTools.withCbAfterEvidence.status} unjustified=${agentTools.unjustifiedBlocked.status}`,
  );

  const spuriousRooster = falsification.hypotheses.find(
    (h) => h.cause === "rooster" && h.effect === "light",
  );
  const trueRooster = confirmation.hypotheses.find(
    (h) => h.cause === "sunrise" && h.effect === "rooster",
  );
  const spuriousIce = confounder.hypotheses.find(
    (h) => h.cause === "iceCreamSales" && h.effect === "drownings",
  );
  const trueTempEdges = confounder.hypotheses.filter(
    (h) =>
      (h.cause === "temperature" && h.effect === "iceCreamSales") ||
      (h.cause === "temperature" && h.effect === "drownings"),
  );
  const spuriousForecast = competing.hypotheses.find(
    (h) => h.cause === "forecast" && h.effect === "lawnWet",
  );
  const trueCompeting = competing.hypotheses.filter(
    (h) =>
      (h.cause === "rain" && h.effect === "lawnWet") ||
      (h.cause === "sprinkler" && h.effect === "lawnWet"),
  );
  const expForecast = explanations.hypotheses.find(
    (h) => h.cause === "forecast" && h.effect === "lawnWet",
  );
  const expRain = explanations.hypotheses.find(
    (h) => h.cause === "rain" && h.effect === "lawnWet",
  );
  const expSprinkler = explanations.hypotheses.find(
    (h) => h.cause === "sprinkler" && h.effect === "lawnWet",
  );
  const hadInconclusive = explanations.trials.some((t) => t.outcome === "inconclusive");

  const falsificationOk =
    spuriousRooster?.status === "dead" &&
    falsification.metrics.spuriousRejection === 1;
  const confirmationOk =
    trueRooster !== undefined &&
    (trueRooster.status === "supported" || trueRooster.status === "causal") &&
    confirmation.metrics.edgeDiscovery > 0 &&
    confirmation.metrics.hypothesisPredictionAccuracy === 1;
  const confounderOk =
    spuriousIce?.status === "dead" &&
    confounder.metrics.spuriousRejection === 1 &&
    trueTempEdges.length === 2 &&
    trueTempEdges.every((h) => h.status === "supported" || h.status === "causal") &&
    confounder.metrics.edgeDiscovery === 1;
  const competingOk =
    spuriousForecast?.status === "dead" &&
    competing.metrics.spuriousRejection === 1 &&
    trueCompeting.length === 2 &&
    trueCompeting.every((h) => h.status === "causal") &&
    competing.metrics.edgeDiscovery === 1;
  const explanationsOk =
    hadInconclusive &&
    expRain !== undefined &&
    expRain.status !== "dead" &&
    (expRain.status === "supported" || expRain.status === "causal") &&
    expSprinkler !== undefined &&
    (expSprinkler.status === "supported" || expSprinkler.status === "causal") &&
    expForecast?.status === "dead" &&
    explanations.metrics.spuriousRejection === 1 &&
    explanations.metrics.edgeDiscovery === 1;
  const activeOk = active.pass;
  const runtimeOk = runtime.pass;
  const llmOk = llmGate.pass;
  const toolsOk = agentTools.pass;

  console.log("\n=== Suite summary ===");
  console.log(`  v0.1 falsification: ${falsificationOk ? "PASS" : "FAIL"}`);
  console.log(`  v0.2 confirmation:  ${confirmationOk ? "PASS" : "FAIL"}`);
  console.log(`  v0.3 confounding:   ${confounderOk ? "PASS" : "FAIL"}`);
  console.log(`  v0.4 multi-causes:  ${competingOk ? "PASS" : "FAIL"}`);
  console.log(
    `  v0.5 explanations:  ${explanationsOk ? "PASS" : "FAIL"} (inconclusive=${hadInconclusive})`,
  );
  console.log(
    `  v0.6 active select: ${activeOk ? "PASS" : "FAIL"} (disagreement mean ${active.aggregate.disagreementMeanExperiments.toFixed(1)} < random ${active.aggregate.randomMeanExperiments.toFixed(1)})`,
  );
  console.log(
    `  v0.7 runtime auth:  ${runtimeOk ? "PASS" : "FAIL"} (authority=${runtime.tests.authority} immunity=${runtime.tests.reintroductionImmunity} falseRejects=${runtime.metrics.falseCausalRejections})`,
  );
  console.log(
    `  v0.8 LLM hypothesizer: ${llmOk ? "PASS" : "FAIL"} (unauthorizedExec=${llmGate.metrics.unauthorizedExecutionRate} authWithoutIntervention=${llmGate.metrics.claimsAuthorizedWithoutIntervention} transport=${llmGate.transportName})`,
  );
  console.log(
    `  v1.0 action-justified: ${toolsOk ? "PASS" : "FAIL"} (unauthorized=${agentTools.metrics.unauthorizedToolExecutionRate} authorized=${agentTools.metrics.authorizedToolExecutionRate} unjustified=${agentTools.metrics.blockedUnjustifiedActions} blockedDead=${agentTools.metrics.blockedDeadClaims})`,
  );

  if (
    !falsificationOk ||
    !confirmationOk ||
    !confounderOk ||
    !competingOk ||
    !explanationsOk ||
    !activeOk ||
    !runtimeOk ||
    !llmOk ||
    !toolsOk
  ) {
    process.exit(1);
  }

  console.log(
    "\nPASS: full suite through v1.0 — actions justified by causal evidence.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
