# Changelog

## 1.0.0 — 2026-09-29

**Evidence is not blanket permission.**

- `authorizeAction(claimId, action)` — claim established **and** action targets cause
- Claim `causal` = mechanism established; **not** a tool capability (`executable` always false at claim level)
- Experiments (`testHypothesis` / `do`) remain Boundary-owned — separate from remediation tools
- Ops catalog: `rollbackDeploy` targets `deploy`; `restartService` targets `process`
- Demo + suite: justified rollback executes; unjustified restart stays blocked
- Pitch: *Causal Boundary authorizes actions justified by causal evidence*
- Replaces the premature “claim causal ⇒ any tool” product demo

## 0.9.0 — 2026-09-29

Agent + Tools (claim-level gate — superseded by 1.0 action justification).

- `GatedToolRuntime`: tool with `causalClaimId` only if claim established
- Demo path used `restartService` after `deploy→latency` (logically incomplete; fixed in 1.0)
- Metrics: `unauthorizedToolExecutionRate=0`, `authorizedToolExecutionRate=1`

## 0.8.0 — 2026-09-29

LLM Hypothesizer: el modelo entra sin ganar autoridad por ser LLM.

- `LlmHypothesizer` implementa solo `Hypothesizer.propose()` (JSON estructurado + `rationale?`)
- Misma puerta que `ConfidentHypothesizer`: @0.99 → no executable
- Evidencia puede elevar `rain→lawnWet` hasta `causal` / executable
- Métricas: `unauthorizedExecutionRate=0`, `claimsAuthorizedWithoutIntervention=0`
- Live OpenAI opcional: `CAUSAL_BOUNDARY_LIVE_LLM=1` + `OPENAI_API_KEY`

## 0.7.0 — 2026-09-29

Runtime Authority: la causalidad es una autoridad runtime separada del hypothesizer.

- `CausalAuthority` + `authorize()` — sólo `causal` es executable downstream
- Claim @0.99 sigue `proposed` / no executable hasta evidencia
- Immune system: re-propuesta de claim `dead` bloqueada (`deadClaimReintroductionRate=0`)
- Cuatro tests: pluggability, authority, inconclusive, reintroduction immunity
- Pitch: no discovery algorithm — gate de autoridad para agentes

## 0.6.0 — 2026-09-29

Active experiment selection: el Boundary elige qué `do()` correr.

- `ExperimentSelector` + `DisagreementSelector` (desacuerdo pairwise entre predicciones)
- Hipótesis conocidas predicen el efecto bajo cada candidato; se elige la intervención que más las separa
- Métricas: `experimentsToResolution`, `hypothesesResolvedPerExperiment`
- Demo: Disagreement vs Random sobre el mismo mundo competing (sin LLM)

## 0.5.0 — 2026-09-29

Competing explanations: `support` / `contradiction` / `inconclusive`.

- `do(rain=false)` con `sprinkler` activo → `inconclusive`, no mata una causa verdadera
- Evidencia compartida: si el efecto persiste al apagar un rival, refuerza alternativas activas
- Contradicción sólo cuando no hay alternativas activas que expliquen el resultado
- Ausencia de Δ observado ≠ ausencia de causa

## 0.4.0 — 2026-09-29

Multiple causes (antes “competing” en sentido débil): dos causas suficientes + distractor.

- Mundo OR: `rain → lawnWet ← sprinkler`; `forecast` copia `rain`
- Espuria `forecast → lawnWet` muere con rivales apagados
- Ambas causas verdaderas se confirman aislando la otra (aislado por el experimento)

## 0.3.0 — 2026-09-29

Confounding: el sistema distingue correlación por causa común de una flecha causal.

- Mundo `temperature → iceCreamSales`, `temperature → drownings`
- Espuria `iceCreamSales → drownings` muere bajo `do(iceCreamSales=false)`
- Edges verdaderos sobreviven intervenciones y pasan a `causal`
- Mundos pluggables (`WorldModel`); núcleo ya no atado a Rooster

## 0.2.0 — 2026-09-29

Confirmation + higiene de métricas y oracle.

- `sunrise → rooster` sobrevive `do()` y llega a `causal`
- Métrica renombrada a `hypothesisPredictionAccuracy`
- Separación física: `src/` (runtime) vs `benchmark/` (oracle + metrics)

## 0.1.0 — 2026-09-29

Falsification spike — The Rooster.

- Hipótesis `rooster → light` nace débil por correlación
- Muere bajo `do(rooster=false)` con evidencia conservada
- Tres autoridades: Hypothesizer propone, World determina, CausalBoundary decide
