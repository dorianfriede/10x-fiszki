import { OPENROUTER_API_KEY } from "astro:env/server";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openai/gpt-oss-20b:free";

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
  return typeof front === "string" && front.trim().length > 0 && typeof back === "string" && back.trim().length > 0;
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

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
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
    });
  } catch {
    throw new GenerationError("Could not reach the AI service");
  }

  if (!response.ok) {
    throw new GenerationError("The AI service returned an error");
  }

  const payload: unknown = await response.json().catch(() => null);
  const content = extractContent(payload);

  if (content === null) {
    throw new GenerationError("The AI service returned an unexpected response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new GenerationError("The AI service returned malformed output");
  }

  const rawCards =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { cards?: unknown }).cards)
      ? (parsed as { cards: unknown[] }).cards
      : [];

  return { proposals: rawCards.filter(isValidProposal) };
}
