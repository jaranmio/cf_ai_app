# Chat & Scheduling Assistant

A conversational assistant that can also schedule reminders, built on top of Cloudflare's LLM chat template. The chat side streams responses from Workers AI, while the scheduler stores tasks in a Durable Object so you can plan follow-ups right from the same UI.

> **Cloudflare Optional Assignment Alignment**: This project fulfills the fast-track assignment guidance to build an AI-powered app on Cloudflare. It integrates a Workers AI LLM (Llama 3.3), coordinates workflows through Durable Objects, accepts user input through a chat UI hosted on Pages-compatible static assets, and persists memory/state inside the scheduler Durable Object.

## Highlights

- **Chat-first experience** with streaming replies from `@cf/meta/llama-3.3-70b-instruct-fp8-fast` and a concise system prompt.
- **Task scheduling toolkit** that parses natural-language timing, converts it to concrete datetimes, and hands it to a Durable Object for reliable alarms.
- **Shared activity feed** that shows what was scheduled, when it fires, and any follow-up runs for recurring tasks.
- **All Workers-native**: static assets served from Workers Sites, API logic in TypeScript, state handled through Durable Objects.

## Optional Assignment Checklist

- **LLM**: Runs on Workers AI using the recommended `@cf/meta/llama-3.3-70b-instruct-fp8-fast` model exposed by `src/index.ts`.
- **Workflow / coordination**: Implements scheduling logic in a Durable Object (`src/task_scheduler_do.ts`) to coordinate alarms, retries, and history.
- **User input (chat)**: Provides a streaming chat UI in `public/chat.js` and `public/index.html`, ready for Cloudflare Pages or Realtime hosting.
- **Memory / state**: Persists conversation-relevant reminders and execution logs inside the Durable Object storage layer for recall.

## How It Works

- `src/index.ts` keeps the original Cloudflare template structure for `/api/chat`, then adds `/api/parse-time` for deterministic timestamp parsing and proxies `/api/tasks/*` into the `TaskScheduler` Durable Object.
- `src/task_scheduler_do.ts` persists tasks, enforces timing validation, schedules alarms (with dev fallbacks), and records a capped event history so the UI always knows what happened.
- `public/chat.js` extends the starter client with the scheduling drawer, deterministic time parsing helpers, and calls into the new APIs.
- `public/index.html` houses the polished UI plus the task bar that summarizes upcoming reminders and recent activity.

## Running the App

> **Live demo:** You can try the deployed assistant at <https://cf-ai-app.leokeran.workers.dev/> any time.

You'll need Node.js 18+, Wrangler, and Workers AI access on your Cloudflare account.

```bash
npm install
npm run cf-typegen
npm run dev
```

- Visit `http://localhost:8787` to chat with the assistant and create reminders.
- `npm run deploy` pushes the Worker to Cloudflare when you're ready.

## Using Chat + Scheduling

**To chat, do this…**
- Start typing in the main composer and press Enter (or click **Send**) to stream a reply from `/api/chat`.
- Keep the conversation going with follow-up prompts; the client trims older turns so each request stays lean.
- Watch the response stream in real time, and use the task bar’s activity feed to keep context while you continue chatting.

**To schedule, do this…**
- Click **Schedule** to open the drawer and choose your timing mode (natural phrase, exact datetime, or delay in seconds).
- If you enter natural language, hit **Parse** to convert it; confirm the previewed datetime looks right, then click **Create Task**.
- The client validates the payload, calls `/api/parse-time` when needed, and posts to `/api/tasks` once everything checks out.
- Scheduled items populate the task bar with status updates; when an alarm fires the Durable Object records a `fired` event and reschedules recurring jobs using the `*/N * * * *` pattern.

The task bar along the right keeps everything in view: latest reminders, parse status (including any ambiguity warnings), and quick actions for re-running or inspecting entries—no need to leave the current conversation.

Power users can hit auxiliary endpoints directly:

- `GET /api/tasks` lists stored tasks.
- `GET /api/tasks/due` shows tasks ready to run (useful in dev when alarms fall back to timers).
- `POST /api/tasks/run-due` forces the Durable Object to process due tasks immediately.
- `POST /api/parse-time` converts natural text to JSON `{ iso, durationSeconds, ambiguous }` without opening the UI.

## Testing and Tooling

- `npm test` runs the Vitest suite configured for Workers.
- `npm run check` type-checks and performs a dry-run deploy to catch configuration issues early.

## Acknowledgements

Huge thanks to Cloudflare for the [LLM Chat Application Template](https://github.com/cloudflare/templates/tree/main/llm-chat-app-template). This project keeps their deployment ergonomics, but improves the UI and layers on reminder scheduling so you can chat, plan, and follow through without leaving the page.
