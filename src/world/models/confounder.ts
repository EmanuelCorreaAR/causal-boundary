import type { WorldModel, WorldState } from "../state.js";

/**
 * Confounder world structural equations:
 *   temperature → iceCreamSales
 *   temperature → drownings
 *
 * iceCreamSales and drownings are correlated via common cause only.
 */
export const confounderModel: WorldModel = {
  name: "confounder",
  vars: ["temperature", "iceCreamSales", "drownings"],

  sample(rng) {
    const temperature = rng() < 0.7; // true = high
    return {
      temperature,
      iceCreamSales: temperature,
      drownings: temperature,
    };
  },

  evolve(state, fixed) {
    const next: WorldState = { ...state };
    if (!fixed.has("iceCreamSales")) next.iceCreamSales = next.temperature!;
    if (!fixed.has("drownings")) next.drownings = next.temperature!;
    return next;
  },
};
