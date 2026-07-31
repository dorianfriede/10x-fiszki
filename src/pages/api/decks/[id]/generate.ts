import type { APIRoute } from "astro";
import { generateFlashcards, GenerationError } from "@/lib/openrouter";

const MAX_TEXT_LENGTH = 10_000;

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body: unknown = await context.request.json().catch(() => null);
  const text = body && typeof body === "object" ? (body as Record<string, unknown>).text : undefined;

  if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_TEXT_LENGTH) {
    return new Response(JSON.stringify({ error: `Text must be between 1 and ${MAX_TEXT_LENGTH} characters` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { proposals } = await generateFlashcards(text);
    return new Response(JSON.stringify({ proposals }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof GenerationError ? error.message : "The AI service returned an error";
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
