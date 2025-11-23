/**
 * Minimal TaskScheduler Durable Object
 *
 * This file provides a small Durable Object implementation exported as
 * `TaskScheduler`. Wrangler requires the Durable Object class to be
 * exported from the Worker entry module; we'll re-export it from
 * `src/index.ts` so the binding works during `wrangler dev`.
 */

import { Task, TaskEvent } from "./types";

const EVENT_HISTORY_LIMIT = 120;

export class TaskScheduler {
  state: DurableObjectState;
  env: Env;
  private _localTimers: number[] = [];
  private _pendingAlarmIso: string | null = null; // prevent duplicate scheduling
  private _lastAlarmIso: string | null = null; // last fired alarm timestamp (ISO)

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // Alarm scheduling helper with runtime feature detection
  scheduleAlarm(date: Date): void {
    const iso = date.toISOString();
    const now = Date.now();
    // Skip scheduling alarms that are effectively "now" or in the past within a tiny jitter window.
    const JITTER_MS = 50;
    if (date.getTime() <= now + JITTER_MS) {
      console.log("[TaskScheduler] skip scheduling near-past/jitter timestamp", iso);
      return;
    }
    if (this._pendingAlarmIso) {
      const existing = Date.parse(this._pendingAlarmIso);
      const incoming = date.getTime();
      // If we already have an alarm at this exact time or an earlier one, skip.
      if (!isNaN(existing) && existing <= incoming) {
        console.log("[TaskScheduler] skip duplicate alarm request for", iso, "(pending=", this._pendingAlarmIso, ")");
        return;
      }
    }
    // Avoid re-scheduling immediately for a timestamp that just fired to prevent tight loops.
    if (this._lastAlarmIso === iso) {
      console.log("[TaskScheduler] suppress re-schedule for just-fired timestamp", iso);
      return;
    }
    this._pendingAlarmIso = iso;
    // Prefer real durable alarms; they persist across restarts in production.
    if (typeof (this.state as any).setAlarm === "function") {
      try {
        (this.state as any).setAlarm(date);
        console.log("[TaskScheduler] durable alarm scheduled:", date.toISOString());
        return;
      } catch (e) {
        console.warn("[TaskScheduler] setAlarm threw; falling back to in-memory timer", e);
      }
    } else {
      console.warn("[TaskScheduler] setAlarm unavailable in local dev; using in-memory fallback.");
    }

    // Fallback: volatile in‑memory timer (non-durable; may be cancelled by dev runtime).
    const delay = date.getTime() - Date.now();
    if (delay <= 0) {
      // Guard against infinite microtask loop: only fire if not same as last alarm.
      if (this._lastAlarmIso !== iso) {
        queueMicrotask(() => {
          // Fire and log any error to avoid silent rejections which can terminate context.
          this.alarm().catch((err) => console.error("[TaskScheduler] alarm microtask error", err));
        });
      } else {
        console.log("[TaskScheduler] skipped immediate microtask alarm (already fired)", iso);
      }
      return;
    }
    // Clear any previous local fallback timers (only one active timer desired)
    for (const t of this._localTimers) {
      clearTimeout(t);
    }
    this._localTimers = [];
    const id = setTimeout(() => {
      this._localTimers = this._localTimers.filter((t) => t !== id);
      console.log("[TaskScheduler] (fallback) firing for", date.toISOString());
      // Execute alarm and surface errors explicitly; unhandled rejections can lead to context cancellation.
      void this.alarm().catch((err) => console.error("[TaskScheduler] alarm fallback error", err));
    }, delay) as unknown as number;
    this._localTimers.push(id);
    console.warn("[TaskScheduler] Using local in-memory timer fallback (non-durable)", date.toISOString());
  }

  // Basic helper: supports only cron expressions of the form */N * * * * (every N minutes)
  private computeNextFromSimpleCron(expr: string, from: Date): Date | null {
    const m = expr.trim().match(/^\*\/(\d+) \* \* \* \*$/);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(from.getTime() + n * 60_000);
  }

  // Called when the DO receives an HTTP request forwarded from the Worker
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, "");
    const segments = path.split("/").filter(Boolean);

    // Simple health endpoint
    if (request.method === "GET" && (segments.length === 0 || segments[0] === "health")) {
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    // Simple list/create tasks at /tasks
    if (segments[0] === "tasks") {
      if (segments[1] === "events") {
        if (request.method === "GET") {
          const since = url.searchParams.get("since");
          const events = await this.getEvents(since);
          const latest = events.length ? events[events.length - 1].occurredAt : null;
          return json({ events, latest });
        }
        return json({ error: "Method not allowed" }, 405);
      }
      // List only tasks that are currently due (nextRun <= now & enabled)
      if (segments[1] === "due" && request.method === "GET") {
        const now = Date.now();
        const idx = (await this.state.storage.get<string[]>("__index")) || [];
        const due: Task[] = [];
        for (const id of idx) {
          const t = await this.state.storage.get<Task>(`task:${id}`);
          if (t && t.enabled && t.nextRun) {
            const nr = Date.parse(t.nextRun);
            if (!isNaN(nr) && nr <= now) due.push(t);
          }
        }
        return json({ due });
      }
      // Run all currently due tasks and reschedule next
      if (segments[1] === "run-due" && request.method === "POST") {
        await this.alarm(); // alarm logic already processes due tasks + reschedules
        return json({ ok: true, ran: true });
      }
      // Manual trigger to process due tasks when alarms unavailable: GET /tasks/force-run
      if (segments[1] === "force-run" && request.method === "POST") {
        await this.alarm();
        return json({ ok: true, forced: true });
      }
      if (request.method === "GET") {
        // list tasks
        const idx = (await this.state.storage.get<string[]>("__index")) || [];
        const tasks: Task[] = [];
        for (const id of idx) {
          const t = await this.state.storage.get<Task>(`task:${id}`);
          if (t) tasks.push(t);
        }
        return json({ tasks });
      }

      if (request.method === "POST") {
        try {
          const body = (await request.json()) as any;

          // Validate timing
          if (!body.timing || typeof body.timing !== "object" || !body.timing.type) {
            return json({ error: "Missing or invalid timing property" }, 400);
          }

            // Enforce allowed timing types
          const timingType = body.timing.type;
          if (!["datetime", "delay", "natural", "recurring"].includes(timingType)) {
            return json({ error: `Unsupported timing type: ${timingType}` }, 400);
          }

          if (timingType === "delay") {
            const secs = Number(body.timing.seconds);
            if (!Number.isFinite(secs) || secs <= 0) {
              return json({ error: "Delay seconds must be a positive number" }, 400);
            }
          }

          if (timingType === "datetime") {
            const when = body.timing.when;
            if (!when || isNaN(Date.parse(when))) {
              return json({ error: "Invalid datetime 'when' value" }, 400);
            }
          }

          // Natural language currently not auto-scheduled here; client is expected to convert to datetime
          if (timingType === "natural") {
            return json({ error: "Timing type 'natural' must be converted to 'datetime' before creation" }, 400);
          }

          const id = crypto.randomUUID();
          const nowIso = new Date().toISOString();
          const task: Task = {
            id,
            title: body.title || "Untitled",
            description: body.description ?? undefined,
            createdAt: nowIso,
            timing: body.timing,
            recurrence: body.recurrence ?? null,
            enabled: body.enabled !== false,
            metadata: body.metadata ?? {},
          };

          // compute basic nextRun for datetime/delay types
          if (task.timing.type === "datetime") {
            task.nextRun = task.timing.when;
          } else if (task.timing.type === "delay") {
            task.nextRun = new Date(Date.now() + task.timing.seconds * 1000).toISOString();
          } else if (task.timing.type === "recurring") {
            const cron = task.timing.cron.trim();
            const next = this.computeNextFromSimpleCron(cron, new Date());
            if (next) {
              task.nextRun = next.toISOString();
            } else {
              console.warn("Unsupported or invalid cron expression; task will remain without nextRun", cron);
              task.nextRun = undefined;
            }
          }

          await this.state.storage.put(`task:${id}`, task);
          const idx = (await this.state.storage.get<string[]>("__index")) || [];
          idx.push(id);
          await this.state.storage.put("__index", idx);

          // schedule alarm if nextRun set
          if (task.nextRun) {
            const next = Date.parse(task.nextRun);
            if (!isNaN(next)) {
              this.scheduleAlarm(new Date(next));
            }
          }

          const creationNote = buildCreationNote(task);
          await this.appendEvents([
            {
              id: crypto.randomUUID(),
              taskId: task.id,
              title: task.title,
              kind: "created",
              occurredAt: new Date().toISOString(),
              nextRun: task.nextRun ?? null,
              note: creationNote,
            },
          ]);

          return json({ task }, 201);
        } catch (e) {
          return json({ error: String(e) }, 400);
        }
      }
    }

    return new Response("Not found", { status: 404 });
  }

  // Called when setAlarm fires
  async alarm(): Promise<void> {
    // Alarm is firing; capture and clear the pending alarm timestamp so we know what just executed.
    const justFiredIso = this._pendingAlarmIso; // the timestamp we originally scheduled
    this._pendingAlarmIso = null;
    // Record last fired as the originally scheduled time (if available) rather than "now"
    // so duplicate reschedules for the same past timestamp can be suppressed.
    const nowIso = new Date().toISOString();
    this._lastAlarmIso = justFiredIso || nowIso;
    console.log("TaskScheduler alarm fired");
    // naive implementation: find due tasks and mark them as executed
    const now = Date.now();
    const TOLERANCE_MS = 250; // allow early timer jitter without double-firing
    const effectiveNow = now + TOLERANCE_MS;
    const idx = (await this.state.storage.get<string[]>("__index")) || [];
    let earliest: number | null = null;

    const firedEvents: TaskEvent[] = [];

    for (const id of idx) {
      const task = await this.state.storage.get<Task>(`task:${id}`);
      if (!task || !task.enabled || !task.nextRun) continue;
      const nextRun = Date.parse(task.nextRun);
      if (isNaN(nextRun)) continue;
      // Treat tasks as due if within tolerance window (accounts for early timer triggers)
      if (nextRun <= effectiveNow) {
        // mark as run (store lastRun)
        const firedIso = new Date().toISOString();
        await this.state.storage.put(`task:${id}:lastRun`, { at: firedIso });
        let note = "Task completed";
        if (!task.recurrence) {
          // single-run task
          task.enabled = false;
          task.nextRun = undefined;
        } else {
          // recurring: recompute nextRun
          const cronExpr = task.timing.type === "recurring" ? task.timing.cron : task.recurrence || "";
          const next = this.computeNextFromSimpleCron(cronExpr, new Date());
          if (next) {
            const nextTime = next.getTime();
            task.nextRun = new Date(nextTime).toISOString();
            if (earliest === null || nextTime < earliest) earliest = nextTime;
            note = "Recurring task rescheduled";
          } else {
            console.warn("Could not compute nextRun for recurring task; disabling.", cronExpr);
            task.enabled = false;
            task.nextRun = undefined;
            note = "Recurring task disabled (invalid cron)";
          }
        }
        await this.state.storage.put(`task:${id}`, task);

        firedEvents.push({
          id: crypto.randomUUID(),
          taskId: id,
          title: task.title || "Untitled task",
          kind: "fired",
          occurredAt: firedIso,
          nextRun: task.nextRun ?? null,
          note,
        });
      } else {
        // Only consider for earliest if sufficiently in the future beyond tolerance to avoid immediate reschedule
        if (nextRun > effectiveNow && (earliest === null || nextRun < earliest)) earliest = nextRun;
      }
    }

    if (firedEvents.length) {
      await this.appendEvents(firedEvents);
    }

    if (earliest !== null) {
      // Prevent pathological rescheduling to a timestamp that is already past/now.
      const MIN_FUTURE_MS = 25; // small buffer
      const target = earliest <= Date.now() + MIN_FUTURE_MS ? new Date(Date.now() + 500) : new Date(earliest);
      if (target.getTime() !== earliest) {
        console.log("[TaskScheduler] adjusted earliest from past/near-past", new Date(earliest).toISOString(), "->", target.toISOString());
      }
      this.scheduleAlarm(target);
    }
  }

  private async getEvents(sinceIso: string | null): Promise<TaskEvent[]> {
    const events = (await this.state.storage.get<TaskEvent[]>("__events")) || [];
    if (!sinceIso) return events;
    const since = Date.parse(sinceIso);
    if (Number.isNaN(since)) return events;
    return events.filter((evt) => {
      const ts = Date.parse(evt.occurredAt);
      return !Number.isNaN(ts) && ts > since;
    });
  }

  private async appendEvents(events: TaskEvent[]): Promise<void> {
    if (!events.length) return;
    const key = "__events";
    const existing = (await this.state.storage.get<TaskEvent[]>(key)) || [];
    const merged = existing.concat(events);
    const trimmed =
      merged.length <= EVENT_HISTORY_LIMIT
        ? merged
        : merged.slice(merged.length - EVENT_HISTORY_LIMIT);
    await this.state.storage.put(key, trimmed);
  }
}

// Helper to build JSON responses consistently
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildCreationNote(task: Task): string {
  try {
    const { timing } = task;
    if (timing.type === "datetime") {
      if (task.nextRun) return `Scheduled for ${formatIsoUtc(task.nextRun)}`;
      return `Scheduled for ${formatIsoUtc(timing.when)}`;
    }
    if (timing.type === "delay") {
      const duration = formatDuration(timing.seconds);
      if (task.nextRun) {
        return `Runs in ${duration} (≈ ${formatIsoUtc(task.nextRun)})`;
      }
      return `Runs in ${duration}`;
    }
    if (timing.type === "recurring") {
      const recurringCopy = describeRecurringCron(timing.cron);
      if (task.nextRun) {
        return `${recurringCopy}. Next at ${formatIsoUtc(task.nextRun)}`;
      }
      return recurringCopy;
    }
    if (timing.type === "natural") {
      const text = typeof timing.text === "string" ? timing.text.trim() : "";
      return text ? `Natural timing "${text}"` : "Timing: natural";
    }
  } catch (err) {
    console.warn("Failed to build creation note", err);
  }
  return `Timing: ${task.timing.type}`;
}

function formatIsoUtc(iso: string): string {
  if (!iso) return "unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
  return `${formatter.format(date)} UTC`;
}

function formatDuration(secondsRaw: number): string {
  const seconds = Number.isFinite(secondsRaw) ? Math.max(0, Math.round(secondsRaw)) : 0;
  if (seconds <= 0) return "less than a second";
  const units = [
    { label: "day", value: 86_400 },
    { label: "hour", value: 3_600 },
    { label: "minute", value: 60 },
    { label: "second", value: 1 },
  ];
  const parts: string[] = [];
  let remaining = seconds;
  for (const { label, value } of units) {
    if (remaining < value) continue;
    const count = Math.floor(remaining / value);
    remaining -= count * value;
    const suffix = count === 1 ? label : `${label}s`;
    parts.push(`${count} ${suffix}`);
    if (parts.length === 2) break;
  }
  return parts.join(" ") || "less than a second";
}

function describeRecurringCron(expr: string): string {
  const cron = expr.trim();
  if (cron === "* * * * *") return "Repeats every minute";
  const everyMinutes = cron.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMinutes) {
    const minutes = Number(everyMinutes[1]);
    if (Number.isFinite(minutes) && minutes > 0) {
      const unit = minutes === 1 ? "minute" : "minutes";
      return `Repeats every ${minutes} ${unit}`;
    }
  }
  return `Repeats with cron "${cron}"`;
}

// (No external cron parser; minimal implementation lives inside class.)
