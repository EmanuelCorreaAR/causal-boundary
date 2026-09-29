import type { WorldModel, WorldState } from "../state.js";

/**
 * Tiny ops world for v0.9:
 *   deploy → latency
 * Evidence via do(deploy=false/true) changes latency.
 */
export const opsModel: WorldModel = {
  name: "ops",
  vars: ["deploy", "latency"],

  sample(rng) {
    const deploy = rng() < 0.6;
    return { deploy, latency: deploy };
  },

  evolve(state, fixed) {
    const next: WorldState = { ...state };
    if (!fixed.has("latency")) next.latency = Boolean(next.deploy);
    return next;
  },
};
