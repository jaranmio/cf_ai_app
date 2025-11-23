/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { ChatMessage } from "./types";
import { TaskScheduler } from "./task_scheduler_do";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Default system prompt
const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses.";

export default {
  /**
   * Main request handler for the Worker
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Handle static assets (frontend)
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // API Routes
    if (url.pathname === "/api/chat") {
      if (request.method === "GET") {
        return new Response(
          JSON.stringify({ ok: true, model: MODEL_ID }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (request.method === "POST") {
        return handleChatRequest(request, env);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // Non-streaming strict time parsing endpoint
    if (url.pathname === "/api/parse-time" && request.method === "POST") {
      return handleParseTimeRequest(request, env);
    }

    if (url.pathname.startsWith("/api/tasks")) {
      // Map incoming request to the durable object
      // Use a fixed name (singleton) or one per user (use session/user id)
      const id = env.TASK_SCHEDULER.idFromName("shared"); // or use an id derived from user
      const stub = env.TASK_SCHEDULER.get(id);
      // Construct a URL within the DO context that strips the leading /api
      const doUrl = new URL(request.url);
      // Remove the `/api` prefix so the Durable Object sees `/tasks...`
      doUrl.pathname = doUrl.pathname.replace(/^\/api/, "");
      const forwardReq = new Request(doUrl.toString(), request);
      return stub.fetch(forwardReq);
    }

    // Handle 404 for unmatched routes
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// Export Durable Object class so Wrangler and the runtime can wire it up.
export { TaskScheduler } from "./task_scheduler_do";

/**
 * Handles chat API requests
 */
async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    // Parse JSON request body
    const { messages = [] } = (await request.json()) as {
      messages: ChatMessage[];
    };

    // Basic payload validation to prevent excessive context size / cost
    if (!Array.isArray(messages) || messages.length > 40) {
      return new Response(JSON.stringify({ error: "Too many messages" }), {
        status: 413,
        headers: { "content-type": "application/json" },
      });
    }
    let totalChars = 0;
    for (const m of messages) {
      if (typeof m.content !== "string" || m.content.length === 0) {
        return new Response(JSON.stringify({ error: "Invalid message content" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      totalChars += m.content.length;
      if (totalChars > 25_000) {
        return new Response(JSON.stringify({ error: "Message content too large" }), {
          status: 413,
          headers: { "content-type": "application/json" },
        });
      }
    }

    // Add system prompt if not present
    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    // Request streaming response from Workers AI. Some models / runtimes may
    // return a single JSON if streaming is not supported; frontend has a
    // fallback for that scenario.
    const response = await env.AI.run(
      MODEL_ID,
      {
        messages,
        max_tokens: 1024,
        stream: true,
      },
      {
        returnRawResponse: true,
        // Uncomment to use AI Gateway
        // gateway: {
        //   id: "YOUR_GATEWAY_ID", // Replace with your AI Gateway ID
        //   skipCache: false,      // Set to true to bypass cache
        //   cacheTtl: 3600,        // Cache time-to-live in seconds
        // },
      },
    );

    // Return streaming response
    return response;
  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process request" }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
}

/**
 * Handles natural-language time parsing requests (non-streaming)
 * Request body: { text: string }
 * Response JSON: { iso: string | null, durationSeconds?: number | null, ambiguous?: boolean }
 */
async function handleParseTimeRequest(request: Request, env: Env): Promise<Response> {
  try {
    const { text } = (await request.json()) as { text?: string };
    const expr = (text || "").trim();
    if (!expr) {
      return Response.json({ error: "EMPTY", message: "No expression provided" }, { status: 400 });
    }

    // System prompt demanding strict JSON only.
    const systemPrompt =
      'You convert a user natural-language time expression into JSON ONLY. Return strictly one JSON object: {"iso":"<UTC ISO or null>","durationSeconds":<number or null>,"ambiguous":<true|false>} with no extra text. "iso" is an absolute UTC ISO8601 time if resolvable. If the expression is relative (e.g. "in 5 minutes") compute durationSeconds and leave iso null. If specific date/time (e.g. "tomorrow at 9am") compute iso and durationSeconds null. If ambiguous set ambiguous true and iso null. Never output anything except the JSON.';

    // Use smaller model for cost; fall back to main if unavailable.
    const PARSE_MODEL_ID = '@cf/meta/llama-3-8b-instruct';
    const modelId = PARSE_MODEL_ID || MODEL_ID;

    const aiResp: any = await env.AI.run(modelId, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: expr },
      ],
      max_tokens: 256,
      temperature: 0,
      stream: false,
    });

    // Expect aiResp.response string containing JSON.
    let raw = '';
    if (aiResp && typeof aiResp.response === 'string') raw = aiResp.response.trim();
    else if (typeof aiResp === 'string') raw = aiResp.trim();
    else raw = JSON.stringify(aiResp);

    // Extract first JSON object.
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ error: 'NO_JSON', raw }, { status: 422 });
    }
    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return Response.json({ error: 'PARSE_FAIL', raw }, { status: 422 });
    }

    // Basic shape validation
    if (!('iso' in parsed)) parsed.iso = null;
    if (!('durationSeconds' in parsed)) parsed.durationSeconds = null;
    if (!('ambiguous' in parsed)) parsed.ambiguous = false;

    return Response.json(parsed, { status: 200 });
  } catch (err) {
    console.error('Parse time error', err);
    return Response.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}
