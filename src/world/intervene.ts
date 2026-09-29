import { cloneState, type Var, type WorldState } from "./state.js";
import type { WorldModel } from "./state.js";

export interface Intervention {
  variable: Var;
  value: boolean;
}

/**
 * Pearl-style do(variable = value):
 * force the variable, sever its incoming causes, let the rest evolve.
 */
export function intervene(
  model: WorldModel,
  state: WorldState,
  intervention: Intervention,
): WorldState {
  const next = cloneState(state);
  next[intervention.variable] = intervention.value;
  const fixed = new Set<Var>([intervention.variable]);
  return model.evolve(next, fixed);
}
