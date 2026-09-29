/**
 * LLM transport: returns raw text only.
 * Hypothesizer parses text → HypothesisProposal[].
 * No access to Boundary, World, Evidence, or authorize().
 */
export interface LlmTransport {
  readonly name: string;
  complete(system: string, user: string): Promise<string>;
}

/** Provider quota / rate limit — not a Boundary failure. */
export class LlmRateLimitError extends Error {
  readonly provider: string;
  readonly retryAfterMs: number;

  constructor(opts: {
    provider: string;
    retryAfterMs: number;
    detail?: string;
  }) {
    super(
      `LLM rate limit (${opts.provider}): retry after ${Math.ceil(opts.retryAfterMs / 1000)}s` +
        (opts.detail ? ` — ${opts.detail}` : ""),
    );
    this.name = "LlmRateLimitError";
    this.provider = opts.provider;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/** Provider down / overloaded after retries — not a Boundary failure. */
export class LlmUnavailableError extends Error {
  readonly provider: string;
  readonly status?: number;

  constructor(opts: { provider: string; status?: number; detail?: string }) {
    super(
      `LLM unavailable (${opts.provider}` +
        (opts.status != null ? ` ${opts.status}` : "") +
        ")" +
        (opts.detail ? `: ${opts.detail}` : ""),
    );
    this.name = "LlmUnavailableError";
    this.provider = opts.provider;
    this.status = opts.status;
  }
}

/** OpenAI Chat Completions compatible endpoint. */
export class OpenAiChatTransport implements LlmTransport {
  readonly name = "openai";

  constructor(
    private readonly opts: {
      apiKey: string;
      model?: string;
      baseUrl?: string;
    },
  ) {}

  async complete(system: string, user: string): Promise<string> {
    const base = (this.opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: this.opts.model ?? "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI transport failed ${res.status}: ${body}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI transport: empty content");
    return content;
  }
}

/**
 * Google AI Studio / Gemini generateContent (free daily quota).
 * Get a key: https://aistudio.google.com/app/apikey
 *
 * 429 RESOURCE_EXHAUSTED → LlmRateLimitError (caller waits or skips).
 * 503/500 → short exponential backoff (transient capacity).
 */
export class GeminiTransport implements LlmTransport {
  readonly name = "gemini";

  constructor(
    private readonly opts: {
      apiKey: string;
      model?: string;
    },
  ) {}

  async complete(system: string, user: string): Promise<string> {
    const model = this.opts.model ?? "gemini-3.5-flash-lite";
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    });

    let lastError = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.opts.apiKey,
        },
        body,
      });
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const content = data.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? "")
          .join("");
        if (!content) throw new Error("Gemini transport: empty content");
        return content;
      }

      lastError = await res.text();

      if (res.status === 429) {
        const retryAfterMs = extractGeminiRetryAfterMs(lastError) ?? 35_000;
        throw new LlmRateLimitError({
          provider: "gemini",
          retryAfterMs,
          detail: summarizeGeminiError(lastError),
        });
      }

      // Transient overload only — do not burn free-tier RPM on 429.
      if (res.status === 503 || res.status === 500) {
        if (attempt < 3) {
          const waitMs = 1000 * 2 ** (attempt - 1);
          await sleep(waitMs);
          continue;
        }
        throw new LlmUnavailableError({
          provider: "gemini",
          status: res.status,
          detail: summarizeGeminiError(lastError),
        });
      }

      throw new Error(`Gemini transport failed ${res.status}: ${lastError}`);
    }
    throw new LlmUnavailableError({
      provider: "gemini",
      detail: summarizeGeminiError(lastError),
    });
  }
}

/**
 * Scripted "LLM" that only emits JSON text — same parse path as a live model.
 */
export class ScriptedJsonTransport implements LlmTransport {
  readonly name = "scripted-llm-json";
  private i = 0;

  constructor(private readonly replies: string[]) {}

  async complete(_system: string, _user: string): Promise<string> {
    const reply = this.replies[Math.min(this.i, this.replies.length - 1)];
    this.i += 1;
    if (reply === undefined) return JSON.stringify({ hypotheses: [] });
    return reply;
  }
}

export function createDefaultLlmTransport(scriptedReplies?: string[]): LlmTransport {
  const gemini = process.env.GEMINI_API_KEY?.trim();
  if (gemini && !gemini.includes("your-key-here") && !gemini.includes("your-gemini")) {
    return new GeminiTransport({
      apiKey: gemini,
      model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
    });
  }
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (openai && !openai.includes("your-key-here")) {
    return new OpenAiChatTransport({
      apiKey: openai,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      baseUrl: process.env.OPENAI_BASE_URL,
    });
  }
  if (!scriptedReplies || scriptedReplies.length === 0) {
    throw new Error(
      "No GEMINI_API_KEY / OPENAI_API_KEY and no scripted replies",
    );
  }
  return new ScriptedJsonTransport(scriptedReplies);
}

/** Parse google.rpc.RetryInfo.retryDelay ("35s", "49.12s") from Gemini error JSON. */
export function extractGeminiRetryAfterMs(body: string): number | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: { details?: { "@type"?: string; retryDelay?: string }[] };
    };
    const details = parsed.error?.details ?? [];
    for (const d of details) {
      if (
        typeof d?.["@type"] === "string" &&
        d["@type"].includes("RetryInfo") &&
        typeof d.retryDelay === "string"
      ) {
        const m = /^([\d.]+)s$/.exec(d.retryDelay.trim());
        if (m) return Math.ceil(Number(m[1]) * 1000);
      }
    }
  } catch {
    /* ignore */
  }
  const m = /retryDelay["\s:]+"?([\d.]+)s"?/i.exec(body);
  if (m) return Math.ceil(Number(m[1]) * 1000);
  return null;
}

function summarizeGeminiError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; status?: string } };
    return parsed.error?.message ?? parsed.error?.status ?? body.slice(0, 120);
  } catch {
    return body.slice(0, 120);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
