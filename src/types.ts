/**
 * Type definitions for the LLM chat application.
 *
 * NOTE: We intentionally do NOT redefine the global `Env` interface here to
 * avoid shadowing the Wrangler generated types in `worker-configuration.d.ts`.
 * Those generated types already include the durable object binding with the
 * correct generic reference. Keep application-specific interfaces separate.
 */

/**
 * Represents a chat message.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Represents a task in the task scheduler.
 */
export interface Task {
  id: string;
  title: string;
  description?: string;
  createdAt: string; // ISO timestamp
  nextRun?: string; // ISO timestamp of next scheduled run
  timing: TaskTiming;
  recurrence?: string | null; // optional recurrence rule (i.e., cron-like or rrule)
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Represents the timing information for a task.
 */
export type TaskTiming =
  | { type: "datetime"; when: string } // ISO datetime
  | { type: "delay"; seconds: number } // relative delay
  | { type: "natural"; text: string } // free-text e.g. 'tomorrow morning'
  | { type: "recurring"; cron: string }; // cron-like expression

export type TaskEventKind = "created" | "updated" | "fired" | "disabled" | "error";

export interface TaskEvent {
  id: string;
  taskId: string;
  title: string;
  kind: TaskEventKind;
  occurredAt: string; // ISO timestamp
  nextRun?: string | null;
  note?: string;
}
