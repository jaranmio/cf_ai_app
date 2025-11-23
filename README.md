# Chat & Scheduling Assistant

A conversational assistant that can also schedule reminders, built on top of Cloudflare's LLM chat template. The chat side streams responses from Workers AI, while the scheduler stores tasks in a Durable Object so you can plan follow-ups right from the same UI.

## Highlights

- **Chat-first experience** with streaming replies from `@cf/meta/llama-3.3-70b-instruct-fp8-fast` and a concise system prompt.
- **Task scheduling toolkit** that parses natural-language timing, converts it to concrete datetimes, and hands it to a Durable Object for reliable alarms.
- **Shared activity feed** that shows what was scheduled, when it fires, and any follow-up runs for recurring tasks.
- **All Workers-native**: static assets served from Workers Sites, API logic in TypeScript, state handled through Durable Objects.

## How It Works

- `src/index.ts` keeps the original Cloudflare template structure for `/api/chat`, then adds `/api/parse-time` for deterministic timestamp parsing and proxies `/api/tasks/*` into the `TaskScheduler` Durable Object.
- `src/task_scheduler_do.ts` persists tasks, enforces timing validation, schedules alarms (with dev fallbacks), and records a capped event history so the UI always knows what happened.
- `public/chat.js` extends the starter client with the scheduling drawer, deterministic time parsing helpers, and calls into the new APIs.
- `public/index.html` houses the polished UI plus the task bar that summarizes upcoming reminders and recent activity.

## Running the App

You'll need Node.js 18+, Wrangler, and Workers AI access on your Cloudflare account.

```bash
npm install
npm run cf-typegen
npm run dev
```

- Visit `http://localhost:8787` to chat with the assistant and create reminders.
- `npm run deploy` pushes the Worker to Cloudflare when you're ready.

## Using Chat + Scheduling

- Start a conversation as usual; the frontend keeps the last few turns so `/api/chat` stays lean.
- Open the **Schedule** drawer to create a reminder. You can type natural language (“remind me tomorrow at 9am”), pick an ISO datetime, or specify a delay in seconds.
- When you enter natural language, click **Parse** to lock in the time, review the converted datetime, and then click **Create Task** to save it.
- The client normalizes natural phrases locally, then calls `/api/parse-time` if needed. Ambiguous phrases surface a gentle prompt so you can clarify before anything is saved.
- Confirming a task posts it to `/api/tasks`, where the Durable Object stores it, schedules the next run, and logs the event for the activity feed.
- When an alarm fires, the Durable Object records a `fired` event and reschedules recurring entries using a simple `*/N * * * *` cadence.

The task bar along the right keeps everything in view: latest reminders, status updates (including parsing errors), and quick actions for re-running or inspecting entries—no need to leave the current conversation.

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
