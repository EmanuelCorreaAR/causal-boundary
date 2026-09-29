/** Variable name in a simulated world. */
export type Var = string;

/** Full assignment of all variables. */
export type WorldState = Record<Var, boolean>;

/** Partial photograph available to hypothesizers. */
export type Observation = Partial<WorldState>;

/**
 * Structural simulator for one scenario.
 * Encodes *how* the world evolves — not oracle labels for scoring.
 */
export interface WorldModel {
  readonly name: string;
  readonly vars: readonly Var[];
  sample(rng: () => number): WorldState;
  /** Recompute non-fixed variables from structural equations. */
  evolve(state: WorldState, fixed: ReadonlySet<Var>): WorldState;
}

export function cloneState(state: WorldState): WorldState {
  return { ...state };
}

export function toObservation(
  state: WorldState,
  vars: readonly Var[],
): Observation {
  const obs: Observation = {};
  for (const v of vars) {
    obs[v] = state[v];
  }
  return obs;
}
