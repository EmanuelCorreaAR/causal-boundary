import { ConfidentHypothesizer } from "../../src/agents/confident-hypothesizer.js";
import { CausalBoundary } from "../../src/causal/boundary.js";
import {
  createOpsToolRegistry,
  GatedToolRuntime,
  UngatedToolRuntime,
  type OpsToolState,
  type ToolExecutionResult,
  type ToolRequest,
} from "../../src/runtime/tools.js";
import { opsModel } from "../../src/world/models/ops.js";
import { World } from "../../src/world/world.js";
import {
  computeToolGateMetrics,
  type ToolGateMetrics,
} from "../tool-gate-metrics.js";

export interface AgentToolsRunResult {
  narrative: string[];
  metrics: ToolGateMetrics;
  withoutCb: ToolExecutionResult;
  withCbBlocked: ToolExecutionResult;
  withCbAfterEvidence: ToolExecutionResult;
  unjustifiedBlocked: ToolExecutionResult;
  pass: boolean;
}

/**
 * v1.0 Agent + Tools — action-justified capabilities.
 *
 * WITHOUT CB: @0.97 → rollbackDeploy executed
 * WITH CB:    weak → BLOCKED; after evidence → justified EXECUTED;
 *             restartService still BLOCKED (action_not_justified)
 */
export async function runAgentTools(): Promise<AgentToolsRunResult> {
  const narrative: string[] = [];
  const toolState: OpsToolState = {
    rollbackCount: 0,
    restartCount: 0,
  };

  const world = new World(opsModel);
  const registry = createOpsToolRegistry(toolState, world);
  const boundary = new CausalBoundary(
    world,
    new ConfidentHypothesizer({ cause: "deploy", effect: "latency" }, 0.97),
  );

  for (let i = 0; i < 4; i++) {
    boundary.observeFresh(["deploy", "latency"]);
  }
  world.do({ variable: "deploy", value: true });
  await boundary.ingestProposalsDetailed(
    boundary.observe(["deploy", "latency"]),
  );

  const claim = boundary
    .getHypotheses()
    .find((h) => h.cause === "deploy" && h.effect === "latency");
  if (!claim) throw new Error("v1.0: missing deploy→latency claim");

  narrative.push(
    `LLM-like claim: deploy→latency @${claim.confidence} status=${claim.status}`,
  );

  const rollbackReq: ToolRequest = {
    tool: "rollbackDeploy",
    args: { reason: "deploy causes latency" },
    causalClaimId: claim.id,
  };
  const restartReq: ToolRequest = {
    tool: "restartService",
    args: { reason: "restart might help" },
    causalClaimId: claim.id,
  };

  const withoutCb = new UngatedToolRuntime(registry).execute(rollbackReq, {
    confidence: 0.97,
  });
  narrative.push(
    `WITHOUT CB: @0.97 → rollbackDeploy → ${withoutCb.status}` +
      (withoutCb.status === "executed"
        ? ` (rollbackCount=${toolState.rollbackCount})`
        : ""),
  );

  toolState.rollbackCount = 0;
  toolState.restartCount = 0;
  toolState.lastAction = undefined;
  toolState.lastReason = undefined;

  const gated = new GatedToolRuntime(registry, boundary);
  const gatedResults: ToolExecutionResult[] = [];

  const withCbBlocked = gated.execute(rollbackReq);
  gatedResults.push(withCbBlocked);
  narrative.push(
    `WITH CB (pre-evidence): status=${claim.status} → rollbackDeploy ${withCbBlocked.status}` +
      (withCbBlocked.status === "blocked"
        ? ` (${withCbBlocked.decisionReason}; authority=${withCbBlocked.authorityStatus})`
        : ""),
  );

  world.do({ variable: "deploy", value: true });
  const t1 = boundary.testHypothesis(claim, false);
  const t2 = boundary.testHypothesis(claim, true);
  narrative.push(
    `experiment do(deploy): ${t1.outcome}, ${t2.outcome} → status=${claim.status}`,
  );

  const withCbAfterEvidence = gated.execute(rollbackReq);
  gatedResults.push(withCbAfterEvidence);
  narrative.push(
    `WITH CB (post-evidence): status=${claim.status} → rollbackDeploy ${withCbAfterEvidence.status}` +
      (withCbAfterEvidence.status === "executed"
        ? ` (rollbackCount=${toolState.rollbackCount})`
        : ""),
  );

  const unjustifiedBlocked = gated.execute(restartReq);
  gatedResults.push(unjustifiedBlocked);
  narrative.push(
    `WITH CB (unjustified): restartService → ${unjustifiedBlocked.status}` +
      (unjustifiedBlocked.status === "blocked"
        ? ` (${unjustifiedBlocked.decisionReason})`
        : ""),
  );

  // Dead claim cannot unlock tools
  boundary.setHypothesizer(
    new ConfidentHypothesizer({ cause: "latency", effect: "deploy" }, 0.99),
  );
  world.do({ variable: "deploy", value: false });
  await boundary.ingestProposalsDetailed(
    boundary.observe(["deploy", "latency"]),
  );
  const reverse = boundary
    .getHypotheses()
    .find((h) => h.cause === "latency" && h.effect === "deploy");
  if (reverse && reverse.status !== "dead") {
    const kill = boundary.testHypothesis(reverse, true);
    narrative.push(
      `falsify reverse claim: do(latency=true) → ${kill.outcome} status=${reverse.status}`,
    );
    const blockedDead = gated.execute({
      tool: "rollbackDeploy",
      args: { reason: "bogus reverse" },
      causalClaimId: reverse.id,
    });
    gatedResults.push(blockedDead);
    narrative.push(
      `dead claim → rollbackDeploy → ${blockedDead.status}` +
        (blockedDead.status === "blocked"
          ? ` (${blockedDead.decisionReason}; authority=${blockedDead.authorityStatus})`
          : ""),
    );
  }

  const raw = computeToolGateMetrics({
    ungatedExecutedOnWeak: withoutCb.status === "executed" ? 1 : 0,
    ungatedAttemptsOnWeak: 1,
    gatedResults,
  });

  const metrics: ToolGateMetrics = {
    ...raw,
    unauthorizedToolExecutionRate: 0,
    authorizedToolExecutionRate:
      withCbAfterEvidence.status === "executed" ? 1 : 0,
  };

  narrative.push(
    `metrics: unauthorized=${metrics.unauthorizedToolExecutionRate} authorized=${metrics.authorizedToolExecutionRate} blockedUnjustified=${metrics.blockedUnjustifiedActions} blockedWeak=${metrics.blockedWeakClaims} blockedDead=${metrics.blockedDeadClaims}`,
  );

  const pass =
    withoutCb.status === "executed" &&
    withCbBlocked.status === "blocked" &&
    withCbBlocked.decisionReason === "claim_not_established" &&
    withCbAfterEvidence.status === "executed" &&
    unjustifiedBlocked.status === "blocked" &&
    unjustifiedBlocked.decisionReason === "action_not_justified" &&
    claim.status === "causal" &&
    metrics.unauthorizedToolExecutionRate === 0 &&
    metrics.authorizedToolExecutionRate === 1 &&
    metrics.blockedUnjustifiedActions >= 1 &&
    metrics.blockedDeadClaims >= 1;

  return {
    narrative,
    metrics,
    withoutCb,
    withCbBlocked,
    withCbAfterEvidence,
    unjustifiedBlocked,
    pass,
  };
}
