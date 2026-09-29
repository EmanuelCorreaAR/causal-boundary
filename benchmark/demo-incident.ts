/**
 * Product demo — simulated ops incident (~20s read).
 *
 *   npm run demo
 *   npm run demo -- --pace
 *
 * Invariants:
 *   Confidence is not evidence.
 *   Evidence is not blanket permission.
 *
 * Causal claim deploy→latency justifies rollbackDeploy (targets deploy),
 * not restartService (targets process).
 */
import { ConfidentHypothesizer } from "../src/agents/confident-hypothesizer.js";
import { CausalBoundary } from "../src/causal/boundary.js";
import {
  createOpsToolRegistry,
  GatedToolRuntime,
  UngatedToolRuntime,
  type OpsToolState,
  type ToolRequest,
} from "../src/runtime/tools.js";
import { opsModel } from "../src/world/models/ops.js";
import { World } from "../src/world/world.js";

const PACE = process.argv.includes("--pace");

async function beat(ms = 450): Promise<void> {
  if (!PACE) return;
  await new Promise((r) => setTimeout(r, ms));
}

function line(text = ""): void {
  console.log(text);
}

function stamp(t: string, text: string): void {
  console.log(`  ${t.padEnd(5)}  ${text}`);
}

function emptyState(): OpsToolState {
  return { rollbackCount: 0, restartCount: 0 };
}

async function main(): Promise<void> {
  line();
  line("╔══════════════════════════════════════════════════════════╗");
  line("║  Causal Boundary — incident demo                         ║");
  line("║  Confidence ≠ evidence · Evidence ≠ blanket permission   ║");
  line("╚══════════════════════════════════════════════════════════╝");
  line();
  line("INCIDENT  checkout-api · latency spike after deploy");
  line("────────────────────────────────────────────────────────────");
  await beat();

  stamp("14:02", "deploy rolled out");
  stamp("14:03", "metrics: deploy=true · latency=true");
  await beat();

  stamp(
    "14:03",
    'agent proposes claim: deploy → latency @0.97  ("pretty sure")',
  );
  stamp("14:03", "agent requests remediation: rollbackDeploy()");
  await beat(600);

  const world = new World(opsModel);
  const boundary = new CausalBoundary(
    world,
    new ConfidentHypothesizer({ cause: "deploy", effect: "latency" }, 0.97),
  );
  for (let i = 0; i < 4; i++) boundary.observeFresh(["deploy", "latency"]);
  world.do({ variable: "deploy", value: true });
  await boundary.ingestProposalsDetailed(
    boundary.observe(["deploy", "latency"]),
  );
  const claim = boundary
    .getHypotheses()
    .find((h) => h.cause === "deploy" && h.effect === "latency");
  if (!claim) throw new Error("demo: missing deploy→latency claim");

  const rollbackReq: ToolRequest = {
    tool: "rollbackDeploy",
    args: { reason: "deploy causes latency — roll back" },
    causalClaimId: claim.id,
  };
  const restartReq: ToolRequest = {
    tool: "restartService",
    args: { reason: "maybe restart helps?" },
    causalClaimId: claim.id,
  };

  // ── Path A: without Boundary ──────────────────────────────────────────
  line();
  line("── WITHOUT Causal Boundary ─────────────────────────────────");
  await beat();
  const naiveState = emptyState();
  const naive = new UngatedToolRuntime(createOpsToolRegistry(naiveState));
  const without = naive.execute(rollbackReq, { confidence: 0.97 });
  stamp(
    "14:03",
    without.status === "executed"
      ? "rollbackDeploy → EXECUTED  (confidence ≥ 0.9)"
      : `rollbackDeploy → ${without.status}`,
  );
  stamp("     ", "⚠  irreversible remediation on a correlation — no do() evidence");
  await beat(700);

  // ── Path B: with Boundary ─────────────────────────────────────────────
  line();
  line("── WITH Causal Boundary ────────────────────────────────────");
  await beat();
  const gatedState = emptyState();
  const gated = new GatedToolRuntime(
    createOpsToolRegistry(gatedState, world),
    boundary,
  );

  const blocked = gated.execute(rollbackReq);
  stamp(
    "14:03",
    blocked.status === "blocked"
      ? `rollbackDeploy → BLOCKED  (${blocked.decisionReason ?? blocked.reason})`
      : `rollbackDeploy → ${blocked.status} (unexpected)`,
  );
  stamp("     ", `claim status=${claim.status} — not established`);
  await beat(700);

  stamp("14:04", "Boundary experiment (owned do): do(deploy=false), do(deploy=true)");
  world.do({ variable: "deploy", value: true });
  const t1 = boundary.testHypothesis(claim, false);
  const t2 = boundary.testHypothesis(claim, true);
  stamp(
    "14:04",
    `outcomes: ${t1.outcome}, ${t2.outcome}  →  claim status=${claim.status}`,
  );
  await beat(600);

  const allowed = gated.execute(rollbackReq);
  stamp(
    "14:04",
    allowed.status === "executed"
      ? "rollbackDeploy → EXECUTED  (action targets established cause=deploy)"
      : `rollbackDeploy → ${allowed.status}`,
  );
  await beat(500);

  const unjustified = gated.execute(restartReq);
  stamp(
    "14:04",
    unjustified.status === "blocked"
      ? `restartService → BLOCKED  (${unjustified.decisionReason})`
      : `restartService → ${unjustified.status} (BUG)`,
  );
  stamp(
    "     ",
    "causal authority exists, but action is not justified by that relation",
  );
  await beat(500);

  // ── Punchline ─────────────────────────────────────────────────────────
  line();
  line("────────────────────────────────────────────────────────────");
  line("  Same agent. Same claim @0.97.");
  line(
    `  Without CB: rollback ${without.status.padEnd(9)}  With CB: blocked → ${allowed.status}`,
  );
  line(
    `  After evidence: rollback justified · restartService still blocked`,
  );
  line();
  line("  Causal Boundary authorizes actions justified by causal evidence.");
  line();

  const ok =
    without.status === "executed" &&
    blocked.status === "blocked" &&
    blocked.decisionReason === "claim_not_established" &&
    allowed.status === "executed" &&
    unjustified.status === "blocked" &&
    unjustified.decisionReason === "action_not_justified" &&
    claim.status === "causal" &&
    gatedState.rollbackCount === 1 &&
    gatedState.restartCount === 0 &&
    naiveState.rollbackCount === 1;

  if (!ok) {
    console.error("DEMO FAIL: expected claim→action justification path");
    process.exit(1);
  }
  line("DEMO PASS");
  line();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
