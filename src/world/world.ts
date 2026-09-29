import { intervene, type Intervention } from "./intervene.js";
import {
  cloneState,
  toObservation,
  type Observation,
  type Var,
  type WorldModel,
  type WorldState,
} from "./state.js";

export type { Intervention, WorldModel };

/**
 * In-memory world. Hypothesizers never see this object — only Observations.
 */
export class World {
  private state: WorldState;

  constructor(
    readonly model: WorldModel,
    initial?: WorldState,
    private readonly rng: () => number = Math.random,
  ) {
    this.state = initial ?? model.sample(this.rng);
  }

  getState(): WorldState {
    return cloneState(this.state);
  }

  observe(vars?: readonly Var[]): Observation {
    return toObservation(this.state, vars ?? this.model.vars);
  }

  resample(): WorldState {
    this.state = this.model.sample(this.rng);
    return this.getState();
  }

  do(intervention: Intervention): WorldState {
    this.state = intervene(this.model, this.state, intervention);
    return this.getState();
  }
}
