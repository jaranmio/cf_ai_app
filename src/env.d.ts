// Ambient augmentation for Worker environment bindings.
// Refine TASK_SCHEDULER to include the TaskScheduler class for stronger typing.
import type { TaskScheduler } from "./task_scheduler_do";
declare interface Env {
  TASK_SCHEDULER: DurableObjectNamespace<TaskScheduler>;
}
