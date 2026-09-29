/**
 * Benchmark-only ground truth graphs.
 *
 * The production causal layer (`src/`) must never import this module.
 * Simulation mechanics live in `src/world/models/*`; scoring labels live here.
 */
import type { Var } from "../src/world/state.js";

export type TrueEdge = readonly [Var, Var];

export const ROOSTER_TRUE_EDGES: readonly TrueEdge[] = [
  ["sunrise", "rooster"],
  ["sunrise", "light"],
] as const;

export const CONFOUNDER_TRUE_EDGES: readonly TrueEdge[] = [
  ["temperature", "iceCreamSales"],
  ["temperature", "drownings"],
] as const;

/** Structural rain→forecast exists in the simulator but is not the competing target;
 *  oracle scores the two causes of lawnWet. */
export const COMPETING_TRUE_EDGES: readonly TrueEdge[] = [
  ["rain", "lawnWet"],
  ["sprinkler", "lawnWet"],
] as const;

export function isTrueEdge(
  trueEdges: readonly TrueEdge[],
  cause: Var,
  effect: Var,
): boolean {
  return trueEdges.some(([c, e]) => c === cause && e === effect);
}
