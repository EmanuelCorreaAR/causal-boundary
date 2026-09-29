import type { WorldModel, WorldState } from "../state.js";

/**
 * Rooster world structural equations:
 *   sunrise → rooster
 *   sunrise → light
 */
export const roosterModel: WorldModel = {
  name: "rooster",
  vars: ["sunrise", "rooster", "light"],

  sample(rng) {
    const sunrise = rng() < 0.7;
    return { sunrise, rooster: sunrise, light: sunrise };
  },

  evolve(state, fixed) {
    const next: WorldState = { ...state };
    if (!fixed.has("rooster")) next.rooster = next.sunrise!;
    if (!fixed.has("light")) next.light = next.sunrise!;
    return next;
  },
};
