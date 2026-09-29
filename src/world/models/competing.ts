import type { WorldModel, WorldState } from "../state.js";

/**
 * Competing causes (OR):
 *   rain ──────► lawnWet
 *   sprinkler ─► lawnWet
 *
 * Distractor (copy of rain, no causal path to lawnWet):
 *   rain → forecast
 *
 * Observationally forecast ↔ lawnWet often enough to tempt forecast → lawnWet.
 */
export const competingModel: WorldModel = {
  name: "competing",
  vars: ["rain", "sprinkler", "lawnWet", "forecast"],

  sample(rng) {
    const rain = rng() < 0.5;
    const sprinkler = rng() < 0.5;
    return {
      rain,
      sprinkler,
      lawnWet: rain || sprinkler,
      forecast: rain,
    };
  },

  evolve(state, fixed) {
    const next: WorldState = { ...state };
    if (!fixed.has("forecast")) next.forecast = Boolean(next.rain);
    if (!fixed.has("lawnWet")) {
      next.lawnWet = Boolean(next.rain) || Boolean(next.sprinkler);
    }
    return next;
  },
};
