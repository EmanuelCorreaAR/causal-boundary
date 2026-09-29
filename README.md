# causal-boundary

**Causal Boundary doesn't authorize claims. It authorizes actions justified by causal evidence.**

**Confidence is not evidence. Evidence is not blanket permission.**

Not another causal-discovery algorithm. A pluggable gate: any hypothesizer may *propose*; the Boundary decides whether a **specific remediation action** may run.

```
Hypothesizer / LLM     →  proposes (probabilistic)
Causal Boundary        →  experiments (do) + establishes claims
Action justification   →  claim + action.targets(cause) → capability
Tool runtime           →  executes only if action is justified
World                  →  outcomes under Pearl-style do()
```

A claim can be `causal` and still unlock **nothing** unless the action targets that cause.

## Authorities

| Layer | Role |
|-------|------|
| Hypothesizer | proposes only — never authorizes |
| CausalBoundary | evidence protocol (`testHypothesis` / `do`) |
| `authorizeAction(claim, action)` | remediation capability gate |
| World | outcomes under interventions |
| Oracle (`benchmark/`) | scoring only — never imported by `src/` |

## Invariants

1. **Confidence is not evidence** — @0.99 stays non-established until `do()` evidence
2. **Evidence is not blanket permission** — established `deploy→latency` justifies `rollbackDeploy`, not `restartService`
3. **Experiments ≠ remediations** — `do()` is Boundary-owned; tools need action justification

## Differentiation tests

1. **Pluggability** — fixed / noisy / LLM; same authority protocol
2. **Authority** — high-confidence proposal stays non-established
3. **Inconclusive** — active alternative causes ⇒ do not false-reject a true cause
4. **Reintroduction immunity** — dead claims re-proposed stay unauthorized
5. **Action justification** — causal claim ≠ arbitrary tool permission

## Layout

```
src/                 # runtime: world, boundary, authority, agents, tools
benchmark/           # oracle, metrics, experiments, product demo
```

## Run

```bash
npm install
npm run demo          # product demo (~20s read) — why this exists
npm run demo:pace     # same demo with theatrical pauses
npm run benchmark     # full suite through v1.0
```

### Product demo (v1.0)

Simulated incident: post-deploy latency → agent wants remediation.

| Path | What happens |
|------|----------------|
| Without CB | @0.97 → `rollbackDeploy` **EXECUTED** |
| With CB | same claim → **BLOCKED** until `do()` evidence |
| After evidence | `rollbackDeploy` **EXECUTED** (targets `deploy`) |
| Unjustified | `restartService` **BLOCKED** (`action_not_justified`) |

### LLM live (gate test)

**Gemini — gratis (recomendado):**

1. Key: https://aistudio.google.com/app/apikey  
2. `.env`: `GEMINI_API_KEY=...` / `GEMINI_MODEL=gemini-3.5-flash-lite`
3. `npm run test:gemini`

**ChatGPT / OpenAI — pago:**

```bash
npm run test:chatgpt
```

Ver [CHANGELOG.md](CHANGELOG.md).

## Roadmap

- **v0.1–v0.6** Causal sandbox (falsify → confirm → confound → compete → select) ✓
- **v0.7** Runtime Authority — claim establishment gate ✓
- **v0.8** LLM Hypothesizer — same gate; confidence ≠ evidence ✓
- **v0.9** Agent + Tools — gated remediations (claim-level) ✓
- **v1.0** Action-justified capabilities — evidence ≠ blanket permission ✓
