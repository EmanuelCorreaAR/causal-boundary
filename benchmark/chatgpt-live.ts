/**
 * Live ChatGPT hypothesizer gate test.
 *
 * Requires OPENAI_API_KEY in .env (see .env.example).
 *
 *   npm run test:chatgpt
 *
 * Proves: ChatGPT proposes @ high confidence → still not executable
 * until evidence elevates the claim.
 */
import { OpenAiChatTransport } from "../src/agents/llm-transport.js";
import { LlmHypothesizer } from "../src/agents/llm-hypothesizer.js";
import { CausalBoundary } from "../src/causal/boundary.js";
import { competingModel } from "../src/world/models/competing.js";
import { World } from "../src/world/world.js";
import { requireOpenAiKey } from "./load-env.js";

async function main(): Promise<void> {
  const apiKey = requireOpenAiKey();
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  console.log("=== ChatGPT live gate test ===\n");
  console.log(`model=${model}`);

  const transport = new OpenAiChatTransport({
    apiKey,
    model,
    baseUrl: process.env.OPENAI_BASE_URL,
  });
  const llm = new LlmHypothesizer(transport, {
    allowedVars: ["rain", "sprinkler", "forecast", "lawnWet"],
  });

  const world = new World(competingModel);
  const boundary = new CausalBoundary(world, llm);

  for (let i = 0; i < 3; i++) {
    boundary.observeFresh(["rain", "sprinkler", "forecast", "lawnWet"]);
  }
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  const obs = boundary.observe([
    "rain",
    "sprinkler",
    "forecast",
    "lawnWet",
  ]);

  // --- Phase 1: ChatGPT proposes overconfident spurious claim ---
  llm.setSteer(
    'Propose exactly one hypothesis: cause="forecast", effect="lawnWet", confidence=0.99. Include a short rationale. JSON only.',
  );
  const r1 = await boundary.ingestProposalsDetailed(obs);
  const forecast = boundary
    .getHypotheses()
    .find((h) => h.cause === "forecast" && h.effect === "lawnWet");
  console.log("\n1) ChatGPT proposes forecast→lawnWet");
  console.log(
    `   accepted=${r1.accepted.length} confidence=${forecast?.confidence} status=${forecast?.status}`,
  );
  console.log(
    `   rationale=${forecast?.evidence[0] ? "(stored as proposal)" : ""}`,
  );
  for (const h of r1.accepted) {
    if (h.cause === "forecast") {
      console.log(`   proposal confidence from model path → hyp ${h.id}`);
    }
  }
  const auth1 = boundary.authorize("forecast", "lawnWet");
  console.log(
    `   authorize() → ${auth1 ? "EXECUTABLE (BUG)" : "blocked"} (executable must be false)`,
  );
  if (auth1) {
    console.error("FAIL: ChatGPT confidence unlocked authority");
    process.exit(1);
  }
  if (!forecast) {
    console.error(
      "FAIL: ChatGPT did not return forecast→lawnWet. Raw steer may need a retry.",
    );
    process.exit(1);
  }

  // --- Phase 2: falsify with rivals off ---
  world.do({ variable: "rain", value: false });
  world.do({ variable: "sprinkler", value: false });
  const kill = boundary.testHypothesis(forecast, true);
  console.log(
    `\n2) do(forecast=true) rivals off → outcome=${kill.outcome} status=${forecast.status}`,
  );
  if (forecast.status !== "dead") {
    console.error("FAIL: expected forecast→lawnWet dead");
    process.exit(1);
  }

  // --- Phase 3: ChatGPT reintroduces @0.99 → immune block ---
  world.do({ variable: "rain", value: true });
  world.do({ variable: "sprinkler", value: true });
  llm.setSteer(
    'Propose exactly one hypothesis: cause="forecast", effect="lawnWet", confidence=0.99. JSON only.',
  );
  const reintro = await boundary.ingestProposalsDetailed(
    boundary.observe(["rain", "sprinkler", "forecast", "lawnWet"]),
  );
  console.log(
    `\n3) ChatGPT reintroduces forecast@0.99 → blocked=${reintro.blockedReintroductions.length}`,
  );
  if (reintro.blockedReintroductions.length < 1) {
    console.error("FAIL: expected immune-system block");
    process.exit(1);
  }

  // --- Phase 4: ChatGPT proposes rain → elevate with evidence ---
  llm.setSteer(
    'Propose exactly one hypothesis: cause="rain", effect="lawnWet", confidence=0.63. JSON only.',
  );
  world.do({ variable: "sprinkler", value: false });
  world.do({ variable: "rain", value: true });
  await boundary.ingestProposalsDetailed(
    boundary.observe(["rain", "sprinkler", "forecast", "lawnWet"]),
  );
  const rain = boundary
    .getHypotheses()
    .find((h) => h.cause === "rain" && h.effect === "lawnWet");
  if (!rain) {
    console.error("FAIL: ChatGPT did not propose rain→lawnWet");
    process.exit(1);
  }
  console.log(
    `\n4) ChatGPT proposes rain→lawnWet @${rain.confidence} status=${rain.status}`,
  );
  console.log(
    `   authorize() → ${boundary.authorize("rain", "lawnWet") ? "EXECUTABLE (BUG)" : "blocked"}`,
  );
  if (boundary.authorize("rain", "lawnWet")) {
    console.error("FAIL: rain claim executable before evidence");
    process.exit(1);
  }

  world.do({ variable: "sprinkler", value: false });
  world.do({ variable: "rain", value: true });
  boundary.testHypothesis(rain, false);
  boundary.testHypothesis(rain, true);
  const authRain = boundary.authorize("rain", "lawnWet");
  console.log(
    `\n5) after evidence status=${rain.status} authorize() → ${authRain ? "executable=true" : "blocked"}`,
  );

  if (rain.status !== "causal" || !authRain) {
    console.error("FAIL: expected rain→lawnWet causal + executable after evidence");
    process.exit(1);
  }

  console.log("\nPASS: ChatGPT proposes; Boundary authorizes only after evidence.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
