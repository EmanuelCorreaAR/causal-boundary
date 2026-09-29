import type { CausalBoundary } from "../causal/boundary.js";
import type { ActionSpec } from "../causal/authority.js";
import { authorityOf } from "../causal/authority.js";
import type { Var } from "../world/state.js";
import type { World } from "../world/world.js";

export type ToolRequest = {
  tool: string;
  args: unknown;
  /** Claim used to justify this remediation action. */
  causalClaimId?: string;
};

export type ToolExecutionResult =
  | { status: "executed"; tool: string; result: unknown }
  | {
      status: "blocked";
      tool: string;
      reason: string;
      /** Machine reason from authorizeAction when available. */
      decisionReason?: string;
      authorityStatus?: string;
    };

export type ToolHandler = (args: unknown) => unknown;

type RegisteredTool = {
  spec: ActionSpec;
  handler: ToolHandler;
};

/**
 * Tool registry — dumb executors + action metadata for justification.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(spec: ActionSpec, handler: ToolHandler): void {
    this.tools.set(spec.name, { spec, handler });
  }

  getSpec(name: string): ActionSpec | undefined {
    return this.tools.get(name)?.spec;
  }

  run(request: ToolRequest): unknown {
    const entry = this.tools.get(request.tool);
    if (!entry) throw new Error(`Unknown tool: ${request.tool}`);
    return entry.handler(request.args);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

/**
 * Agent proposes remediation; Boundary authorizes claim→action; runtime executes.
 * Established claims are not blanket permissions.
 */
export class GatedToolRuntime {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly boundary: CausalBoundary,
  ) {}

  execute(request: ToolRequest): ToolExecutionResult {
    const spec = this.registry.getSpec(request.tool);
    if (!spec) {
      return {
        status: "blocked",
        tool: request.tool,
        reason: `unknown tool: ${request.tool}`,
      };
    }

    if (!request.causalClaimId) {
      return {
        status: "blocked",
        tool: request.tool,
        reason: "remediation requires causalClaimId",
        decisionReason: "claim_missing",
      };
    }

    const decision = this.boundary.authorizeAction(
      request.causalClaimId,
      spec,
    );
    if (!decision.allowed) {
      const hyp = this.boundary
        .getHypotheses()
        .find((h) => h.id === request.causalClaimId);
      return {
        status: "blocked",
        tool: request.tool,
        reason: decision.detail,
        decisionReason: decision.reason,
        authorityStatus: decision.authorityStatus ?? (hyp ? authorityOf(hyp).status : "missing"),
      };
    }

    const result = this.registry.run(request);
    return { status: "executed", tool: request.tool, result };
  }
}

/**
 * Naive agent runtime: high confidence alone executes irreversible tools.
 * Used only for WITHOUT-CB contrast demos.
 */
export class UngatedToolRuntime {
  constructor(private readonly registry: ToolRegistry) {}

  execute(
    request: ToolRequest,
    opts?: { confidence?: number; threshold?: number },
  ): ToolExecutionResult {
    const threshold = opts?.threshold ?? 0.9;
    const confidence = opts?.confidence ?? 1;
    if (confidence < threshold) {
      return {
        status: "blocked",
        tool: request.tool,
        reason: `confidence ${confidence} below threshold ${threshold}`,
      };
    }
    const result = this.registry.run(request);
    return { status: "executed", tool: request.tool, result };
  }
}

export type OpsToolState = {
  rollbackCount: number;
  restartCount: number;
  lastAction?: string;
  lastReason?: string;
};

/**
 * Ops remediation catalog:
 * - rollbackDeploy targets deploy → justified by deploy→latency
 * - restartService targets process → NOT justified by deploy→latency
 */
export function createOpsToolRegistry(
  state: OpsToolState,
  world?: World,
): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(
    {
      name: "rollbackDeploy",
      kind: "remediation",
      targets: ["deploy"] as const satisfies readonly Var[],
    },
    (args) => {
      if (world) world.do({ variable: "deploy", value: false });
      state.rollbackCount += 1;
      const reason =
        args && typeof args === "object" && "reason" in args
          ? String((args as { reason: unknown }).reason)
          : "unspecified";
      state.lastAction = "rollbackDeploy";
      state.lastReason = reason;
      return {
        ok: true,
        irreversible: true,
        action: "rollbackDeploy",
        rollbackCount: state.rollbackCount,
        reason,
      };
    },
  );

  registry.register(
    {
      name: "restartService",
      kind: "remediation",
      targets: ["process"] as const satisfies readonly Var[],
    },
    (args) => {
      state.restartCount += 1;
      const reason =
        args && typeof args === "object" && "reason" in args
          ? String((args as { reason: unknown }).reason)
          : "unspecified";
      state.lastAction = "restartService";
      state.lastReason = reason;
      return {
        ok: true,
        irreversible: true,
        action: "restartService",
        restartCount: state.restartCount,
        reason,
      };
    },
  );

  return registry;
}
