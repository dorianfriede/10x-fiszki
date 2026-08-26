import { OPENROUTER_API_KEY } from "astro:env/server";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
// The free-tier model emits a lengthy internal reasoning chain before its answer, which can push
// total response time (including body streaming) well past a header-only timeout.
const REQUEST_TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT = `You turn study text into flashcards for spaced repetition.

Read the text and identify concepts that are distinct and worth memorizing: definitions, facts, procedures, relationships. For each one, write a flashcard with a "front" (a question or prompt) and a "back" (the answer or explanation). Keep both concise.

If the text has no extractable concepts (empty, trivial, or purely procedural without facts), return an empty array. Do not invent filler cards.

Respond with strict JSON only, no prose, no markdown fences, in this exact shape:
{"cards": [{"front": "...", "back": "..."}]}`;

export interface FlashcardProposal {
  front: string;
  back: string;
}

export class GenerationError extends Error {}

function isValidProposal(card: unknown): card is FlashcardProposal {
  if (typeof card !== "object" || card === null) return false;
  const { front, back } = card as Record<string, unknown>;
  return (
    typeof front === "string" &&
    front.trim().length > 0 &&
    front.length <= 2000 &&
    typeof back === "string" &&
    back.trim().length > 0 &&
    back.length <= 2000
  );
}

function extractContent(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const first: unknown = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null) return null;

  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : null;
}

export async function generateFlashcards(sourceText: string): Promise<{ proposals: FlashcardProposal[] }> {
  if (!OPENROUTER_API_KEY) {
    throw new GenerationError("OpenRouter is not configured");
  }

  // The timeout signal must span both the fetch and the body read below — the free-tier model's
  // reasoning chain can arrive well after headers do, so an abort during response.json() is just
  // as real a timeout as one during fetch() itself.
  let payload: unknown;
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: sourceText },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error("openrouter call failed", { status: response.status });
      throw new GenerationError("The AI service returned an error");
    }

    payload = await response.json();
  } catch (err) {
    if (err instanceof GenerationError) throw err;
    if (err instanceof Error && err.name === "TimeoutError") {
      console.error("openrouter call failed", { reason: "timeout" });
      throw new GenerationError("The AI service took too long to respond");
    }
    if (err instanceof SyntaxError) {
      console.error("openrouter call failed", { reason: "unexpected response shape" });
      throw new GenerationError("The AI service returned an unexpected response");
    }
    console.error("openrouter call failed", { reason: "network error" });
    throw new GenerationError("Could not reach the AI service");
  }

  const content = extractContent(payload);

  if (content === null) {
    console.error("openrouter call failed", { reason: "unexpected response shape" });
    throw new GenerationError("The AI service returned an unexpected response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    console.error("openrouter call failed", { reason: "malformed JSON content" });
    throw new GenerationError("The AI service returned malformed output");
  }

  const rawCards =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { cards?: unknown }).cards)
      ? (parsed as { cards: unknown[] }).cards
      : [];

  return { proposals: rawCards.filter(isValidProposal) };
}
