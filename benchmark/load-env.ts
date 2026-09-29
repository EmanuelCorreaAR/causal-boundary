import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal .env loader (no dependency on dotenv runtime quirks).
 * Does not override variables already set in the process environment.
 */
export function loadEnvFile(filename = ".env"): void {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function requireOpenAiKey(): string {
  loadEnvFile();
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || key.includes("your-key-here")) {
    throw new Error(
      "Missing OPENAI_API_KEY. Copy .env.example → .env and paste your ChatGPT/OpenAI key.",
    );
  }
  return key;
}

export function requireGeminiKey(): string {
  loadEnvFile();
  const key =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim();
  if (!key || key.includes("your-key-here")) {
    throw new Error(
      "Missing GEMINI_API_KEY. Get a free key at https://aistudio.google.com/app/apikey and put it in .env",
    );
  }
  return key;
}
