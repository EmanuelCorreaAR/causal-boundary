import type { Var, WorldState } from "../world/state.js";
import type { StateDelta } from "./types.js";

export function compare(
  before: WorldState,
  after: WorldState,
  vars?: readonly Var[],
): StateDelta[] {
  const keys = vars ?? ([...new Set([...Object.keys(before), ...Object.keys(after)])] as Var[]);
  const deltas: StateDelta[] = [];
  for (const variable of keys) {
    if (before[variable] !== after[variable]) {
      deltas.push({
        variable,
        before: Boolean(before[variable]),
        after: Boolean(after[variable]),
      });
    }
  }
  return deltas;
}

export function formatDeltas(deltas: StateDelta[]): string {
  if (deltas.length === 0) return "(no changes)";
  return deltas
    .map((d) => `${d.variable}: ${d.before} → ${d.after}`)
    .join("\n");
}
