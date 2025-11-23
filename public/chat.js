/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

// Scheduling UI elements (may not exist in older HTML)
const scheduleButton = document.getElementById("schedule-button");
const schedulePanel = document.getElementById("schedule-panel");
const schedType = document.getElementById("sched-type");
const schedNatural = document.getElementById("sched-natural");
const schedDatetime = document.getElementById("sched-datetime");
const schedDelay = document.getElementById("sched-delay");
const schedParse = document.getElementById("sched-parse");
const schedCreate = document.getElementById("sched-create");
const schedCancel = document.getElementById("sched-cancel");
const schedTitle = document.getElementById("sched-title");
const schedStatus = document.getElementById("sched-status");
const schedNaturalField = document.querySelector('[data-field="natural"]');
const schedDatetimeField = document.querySelector('[data-field="datetime"]');
const schedDelayField = document.querySelector('[data-field="delay"]');
const taskActivityPanel = document.getElementById("task-activity");
const taskActivityList = document.getElementById("task-activity-list");
const taskActivityEmpty = document.getElementById("task-activity-empty");
const taskActivityMeta = document.getElementById("task-activity-meta");

let lastSuggestedTaskTitle = "";

function suggestTaskTitle(raw) {
  if (!raw || typeof raw !== "string") return "";
  let text = raw.trim();
  if (!text) return "";
  text = text.replace(/\s+/g, " ");

  const politePrefixes = [
    /^(?:hey|hi|hello)[,\s]+/i,
    /^(?:please|kindly)\s+/i,
    /^(?:could you|can you|would you|will you)\s+/i,
    /^(?:i need you to|i want you to)\s+/i,
  ];
  for (const pattern of politePrefixes) {
    if (pattern.test(text)) {
      text = text.replace(pattern, "").trim();
    }
  }

  const intentPatterns = [
    [/^remind me to\s+(.*)$/i, "$1"],
    [/^remind me about\s+(.*)$/i, "$1"],
    [/^remind me\s+(.*)$/i, "$1"],
    [/^set (?:a\s+)?reminder to\s+(.*)$/i, "$1"],
    [/^set (?:a\s+)?reminder for\s+(.*)$/i, "$1"],
    [/^schedule (?:a\s+)?(?:task|reminder|event)?\s*(?:for\s+)?(.*)$/i, "$1"],
    [/^add (?:a\s+)?task\s*(?:for|to)?\s*(.*)$/i, "$1"],
    [/^need to\s+(.*)$/i, "$1"],
    [/^please\s+(.*)$/i, "$1"],
  ];
  for (const [pattern, replacement] of intentPatterns) {
    if (pattern.test(text)) {
      text = text.replace(pattern, replacement).trim();
      break;
    }
  }

  text = text.replace(/^(?:to|for)\s+/i, "");
  text = text.replace(/[.!?]+$/g, "");
  text = stripTimingHints(text);
  if (!text) return "";

  if (text.length > 80) {
    text = `${text.slice(0, 77).trimEnd()}...`;
  }

  const firstChar = text.charAt(0);
  if (firstChar) {
    text = firstChar.toUpperCase() + text.slice(1);
  }

  return text;
}

function populateTaskTitleSuggestion() {
  if (!schedTitle) return;
  if (schedTitle.value && schedTitle.value.trim() && schedTitle.value !== lastSuggestedTaskTitle) {
    return;
  }
  const seedCandidates = [];
  if (schedType && schedType.value === "natural" && schedNatural) {
    seedCandidates.push(schedNatural.value.trim());
  }
  if (userInput) seedCandidates.push(userInput.value.trim());
  const seed = seedCandidates.find((value) => value) || "";
  if (!seed) return;
  const suggestion = suggestTaskTitle(seed);
  if (!suggestion) return;
  schedTitle.value = suggestion;
  lastSuggestedTaskTitle = suggestion;
}

function stripTimingHints(source) {
  if (!source) return source;
  let text = source.trim();
  if (!text) return text;
  const weekday = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
  const relative = "today|tonight|tomorrow|weekend|week|month|year";
  const dayParts = "morning|afternoon|evening|night";
  const clean = () => text.replace(/\s{2,}/g, " ").trim();
  let prev;
  do {
    prev = text;
    text = text
      .replace(/\s+(?:in\s+\d+(?:\.\d+)?\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?))$/i, "")
      .replace(/\s+(?:in\s+\d+(?:\.\d+)?\s*(?:s|m|h|d|w))$/i, "")
      .replace(/\s+(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i, "")
      .replace(/\s+(?:at\s+\d{1,2}(?::\d{2})?)$/i, "")
      .replace(new RegExp(`\\s+(?:on|by)\s+(?:${weekday})(?:\s+(?:morning|afternoon|evening|night))?$`, "i"), "")
      .replace(new RegExp(`\\s+(?:next\s+(?:${weekday}|week|month|year))$`, "i"), "")
      .replace(new RegExp(`\\s+(?:this\s+(?:${dayParts}|week|weekend|month|year))$`, "i"), "")
      .replace(new RegExp(`\\s+(?:${relative})$`, "i"), "")
      .replace(/\s+(?:soon|later)$/i, "");
    text = text.replace(/[,.!?]+$/g, "");
    text = clean();
  } while (text && text !== prev);
  return text;
}

/**
 * Deterministic parser for common natural-language time expressions.
 * Returns a Date object in the user's local timezone or null if not recognized.
 */
function parseNaturalToDate(text) {
  if (!text || typeof text !== "string") return null;
  const s = text.trim().toLowerCase();
  const now = new Date();

  // 1. Relative 'in X unit' anywhere in sentence (choose last occurrence if multiple).
  const relMatches = [...s.matchAll(/\bin\s+(\d+)\s*(second|seconds|minute|minutes|hour|hours|day|days|week|weeks)\b/g)];
  if (relMatches.length) {
    const m = relMatches[relMatches.length - 1]; // take last to handle sentences like 'in 1 hour then again in 3 hours'
    const n = Number(m[1]);
    const unit = m[2];
    const mul = unit.startsWith("second") ? 1000 : unit.startsWith("minute") ? 60000 : unit.startsWith("hour") ? 3600000 : unit.startsWith("day") ? 86400000 : 7 * 86400000;
    return new Date(now.getTime() + n * mul);
  }

  // 2. today/tomorrow with optional time/period anywhere
  let m = s.match(/\b(today|tomorrow)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?(?:.*?\b(morning|afternoon|evening|night)\b)?/);
  if (m) {
    const dayWord = m[1];
    const atHour = m[2] ? Number(m[2]) : null;
    const atMin = m[3] ? Number(m[3]) : 0;
    const ampm = m[4] || null;
    const period = m[5] || null;
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (dayWord === "tomorrow") base.setDate(base.getDate() + 1);

    let hour = 9; // default morning
    if (atHour !== null) {
      hour = atHour;
      if (ampm === "pm" && hour < 12) hour += 12;
      if (ampm === "am" && hour === 12) hour = 0;
    } else if (period) {
      if (period === "morning") hour = 9;
      else if (period === "afternoon") hour = 15;
      else if (period === "evening") hour = 18;
      else if (period === "night") hour = 21;
    }

    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, atMin || 0, 0);
  }

  // 3. Weekday (optionally preceded by 'next') anywhere
  m = s.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (m) {
    const isNext = !!m[1];
    const weekday = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"].indexOf(m[2]);
    const atHour = m[3] ? Number(m[3]) : null;
    const atMin = m[4] ? Number(m[4]) : 0;
    const ampm = m[5] || null;
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const curWeekday = base.getDay();
    let daysAhead = (weekday - curWeekday + 7) % 7;
    if (daysAhead === 0 && (isNext || atHour !== null)) daysAhead = 7;
    if (isNext && daysAhead === 0) daysAhead = 7;
    base.setDate(base.getDate() + daysAhead);
    let hour = 9;
    if (atHour !== null) {
      hour = atHour;
      if (ampm === "pm" && hour < 12) hour += 12;
      if (ampm === "am" && hour === 12) hour = 0;
    }
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, atMin || 0, 0);
  }

  return null;
}
// Chat state
let chatHistory = [
  {
    role: "assistant",
    content:
      "Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?",
  },
];
let isProcessing = false;
const MAX_TURNS = 20; // limit number of turns sent to backend
const observedTaskEventIds = new Set();
let hasLoadedTaskEvents = false;
let latestTaskEventIso = null;
let isPollingEvents = false;
const TASK_EVENT_POLL_INTERVAL_MS = 5000;
const MAX_TASK_ACTIVITY_ITEMS = 30;
const TASK_EVENT_BACKGROUND_POLL_INTERVAL_MS = 20000; // slower cadence while tab is hidden
let taskEventPollTimerId = null;

// Auto-resize textarea as user types
userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

// Wire up scheduling UI if present
if (scheduleButton && schedulePanel) {
  const updateSchedFieldsVisibility = () => {
    if (!schedType) return;
    const mode = schedType.value;
    const naturalActive = mode === "natural";
    const datetimeActive = mode === "datetime";
    const delayActive = mode === "delay";

    if (schedNaturalField) schedNaturalField.hidden = !naturalActive;
    if (schedDatetimeField) schedDatetimeField.hidden = !datetimeActive;
    if (schedDelayField) schedDelayField.hidden = !delayActive;

    if (schedNatural)
      schedNatural.style.display = naturalActive ? "block" : "none";
    if (schedDatetime)
      schedDatetime.style.display = datetimeActive ? "block" : "none";
    if (schedDelay) schedDelay.style.display = delayActive ? "block" : "none";
  };

  scheduleButton.addEventListener("click", () => {
    // toggle panel
    if (schedulePanel.style.display === "none" || !schedulePanel.style.display) {
      schedulePanel.style.display = "flex";
      schedulePanel.classList.add("is-visible");
      scheduleButton.setAttribute("aria-expanded", "true");
      updateSchedFieldsVisibility();
      // prefill natural field with current user input if present
      if (userInput.value.trim()) schedNatural.value = userInput.value.trim();
      populateTaskTitleSuggestion();
      if (schedNatural && schedNaturalField && !schedNaturalField.hidden) {
        schedNatural.focus();
      }
    } else {
      schedulePanel.style.display = "none";
      schedulePanel.classList.remove("is-visible");
      scheduleButton.setAttribute("aria-expanded", "false");
    }
  });

  // cancel
  if (schedCancel) {
    schedCancel.addEventListener("click", () => {
      schedulePanel.style.display = "none";
      schedulePanel.classList.remove("is-visible");
      scheduleButton.setAttribute("aria-expanded", "false");
      schedStatus.textContent = "";
      lastSuggestedTaskTitle = "";
    });
  }

  // toggle fields based on type
  if (schedType) {
    schedType.addEventListener("change", updateSchedFieldsVisibility);
    updateSchedFieldsVisibility();
    if (schedTitle && !schedTitle.value.trim()) populateTaskTitleSuggestion();
  }

  // Parse natural language into ISO datetime using the chat LLM endpoint
  if (schedParse) {
    schedParse.addEventListener("click", async () => {
      schedStatus.textContent = "Parsing...";
      try {
        let inputText = "";
        if (schedType.value === "natural") inputText = schedNatural.value.trim();
        else if (schedType.value === "datetime") inputText = schedDatetime.value;
        else if (schedType.value === "delay") inputText = schedDelay.value;

        if (!inputText) {
          schedStatus.textContent = "Enter a time expression to parse.";
          return;
        }

        // First, try our deterministic parser for common phrases
        try {
          if (schedType.value === "natural") {
            const dtParsed = parseNaturalToDate(inputText);
            if (dtParsed && !isNaN(dtParsed.getTime())) {
              const iso = dtParsed.toISOString();
              schedStatus.textContent = `Parsed: ${iso}`;
              const pad = (n) => n.toString().padStart(2, "0");
              const localStr = `${dtParsed.getFullYear()}-${pad(dtParsed.getMonth()+1)}-${pad(dtParsed.getDate())}T${pad(dtParsed.getHours())}:${pad(dtParsed.getMinutes())}:${pad(dtParsed.getSeconds())}`;
              schedDatetime.value = localStr;
              schedType.value = "datetime";
              schedType.dispatchEvent(new Event('change'));
              return;
            }
          }
        } catch (e) {
          console.warn('local deterministic parse failed', e);
        }

        // Next try client-side chrono parsing (if available)
        try {
          if (schedType.value === "natural" && window.chrono && typeof window.chrono.parseDate === 'function') {
            const dt = window.chrono.parseDate(inputText);
            if (dt && !isNaN(dt.getTime())) {
              const iso = dt.toISOString();
              schedStatus.textContent = `Parsed (chrono): ${iso}`;
              const pad = (n) => n.toString().padStart(2, "0");
              const localStr = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
              schedDatetime.value = localStr;
              schedType.value = "datetime";
              schedType.dispatchEvent(new Event('change'));
              return; // success, skip LLM
            }
          }
        } catch (e) {
          // chrono may not be available or failed; fall back to LLM below
          console.warn('chrono parse failed or not available', e);
        }

        // Call dedicated non-streaming parse endpoint for natural language only
        if (schedType.value === 'natural') {
          const resp = await fetch('/api/parse-time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: inputText }),
          });
          if (!resp.ok) {
            const txt = await resp.text();
            schedStatus.textContent = `Parsing failed (${resp.status}): ${txt.slice(0,120)}`;
            return;
          }
          const data = await resp.json();
          if (data.ambiguous) {
            schedStatus.textContent = 'Ambiguous time — please clarify.';
            return;
          }
          if (data.iso) {
            schedStatus.textContent = `Parsed: ${data.iso}`;
            const dtLocal = new Date(data.iso);
            const pad = (n) => n.toString().padStart(2, '0');
            const localStr = `${dtLocal.getFullYear()}-${pad(dtLocal.getMonth()+1)}-${pad(dtLocal.getDate())}T${pad(dtLocal.getHours())}:${pad(dtLocal.getMinutes())}:${pad(dtLocal.getSeconds())}`;
            schedDatetime.value = localStr;
            schedType.value = 'datetime';
            schedType.dispatchEvent(new Event('change'));
            return;
          }
          // If only durationSeconds provided, convert to absolute time now + duration
          if (data.durationSeconds && Number.isFinite(data.durationSeconds)) {
            const future = new Date(Date.now() + data.durationSeconds * 1000);
            const iso = future.toISOString();
            schedStatus.textContent = `Parsed (duration -> ${iso})`;
            const pad = (n) => n.toString().padStart(2, '0');
            const localStr = `${future.getFullYear()}-${pad(future.getMonth()+1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}:${pad(future.getSeconds())}`;
            schedDatetime.value = localStr;
            schedType.value = 'datetime';
            schedType.dispatchEvent(new Event('change'));
            return;
          }
          schedStatus.textContent = 'Could not parse time.';
          return;
        }

        // If user selected datetime or delay, nothing to parse here.
        schedStatus.textContent = 'No parsing needed for this type.';
      } catch (e) {
        console.error(e);
        schedStatus.textContent = "Parse error.";
      }
    });
  }

  // Create task (POST to /api/tasks). If /api/tasks is not implemented server-side yet, the call may fail.
  if (schedCreate) {
    schedCreate.addEventListener("click", async () => {
      schedStatus.textContent = "Creating...";
      try {
        let title = schedTitle.value.trim();
        if (!title) {
          const seeds = [];
          if (schedType && schedType.value === "natural" && schedNatural) {
            seeds.push(schedNatural.value.trim());
          }
          if (userInput) seeds.push(userInput.value.trim());
          const fallbackSeed = seeds.find((value) => value);
          const suggestion = fallbackSeed ? suggestTaskTitle(fallbackSeed) : "";
          title = suggestion || fallbackSeed || "Scheduled task";
          if (suggestion) lastSuggestedTaskTitle = suggestion;
        }
        let timing = null;
        if (schedType.value === "natural") {
          schedStatus.textContent = "Parse natural expression first (use Parse).";
          return;
        } else if (schedType.value === "datetime") {
          // convert datetime-local value to ISO in UTC
          const local = schedDatetime.value;
          if (!local) {
            schedStatus.textContent = "Enter a date/time.";
            return;
          }
          const dt = new Date(local);
          const iso = dt.toISOString();
          timing = { type: "datetime", when: iso };
        } else if (schedType.value === "delay") {
          const seconds = Number(schedDelay.value);
          if (!seconds || seconds <= 0) {
            schedStatus.textContent = "Enter a positive delay in seconds.";
            return;
          }
          timing = { type: "delay", seconds };
        }

        const payload = { title, description: null, timing };

        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const txt = await res.text();
          schedStatus.textContent = `Server error: ${res.status} ${txt}`;
          return;
        }

        const body = await res.json();
        schedStatus.textContent = "Task created.";
        // hide panel after a short delay
        setTimeout(() => {
          schedulePanel.style.display = "none";
          schedulePanel.classList.remove("is-visible");
          scheduleButton.setAttribute("aria-expanded", "false");
          schedStatus.textContent = "";
        }, 800);
      } catch (e) {
        console.error(e);
        schedStatus.textContent = "Create failed.";
      }
    });
  }
}

if (schedTitle) {
  schedTitle.addEventListener("input", () => {
    if (schedTitle.value.trim() === lastSuggestedTaskTitle) return;
    if (schedTitle.value.trim()) {
      lastSuggestedTaskTitle = "";
    }
  });
}

if (schedNatural) {
  schedNatural.addEventListener('input', () => {
    if (!schedTitle || schedTitle.value.trim()) return;
    populateTaskTitleSuggestion();
  });
}

if (taskActivityPanel && taskActivityList) {
  void startTaskEventPolling();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleNextTaskEventPoll(0, { force: true });
    } else if (taskActivityMeta && hasLoadedTaskEvents) {
      taskActivityMeta.textContent = "Paused (tab inactive)";
    }
  });
  window.addEventListener("focus", () => {
    if (document.visibilityState === "visible") {
      scheduleNextTaskEventPoll(0, { force: true });
    }
  });
  window.addEventListener("online", () => {
    scheduleNextTaskEventPoll(0, { force: true });
  });
  window.addEventListener("offline", () => {
    if (taskActivityMeta) taskActivityMeta.textContent = "Offline";
  });
}

async function startTaskEventPolling() {
  await pollTaskEvents(true, { force: true });
  scheduleNextTaskEventPoll();
}

function scheduleNextTaskEventPoll(customDelay, options = {}) {
  if (!taskActivityList) return;
  const { force = false } = options;
  const visible = document.visibilityState !== "hidden";
  const delay =
    typeof customDelay === "number"
      ? Math.max(0, customDelay)
      : visible
      ? TASK_EVENT_POLL_INTERVAL_MS
      : TASK_EVENT_BACKGROUND_POLL_INTERVAL_MS;

  if (taskEventPollTimerId !== null) {
    clearTimeout(taskEventPollTimerId);
  }

  const timerId = window.setTimeout(async () => {
    if (taskEventPollTimerId !== timerId) return;
    const shouldForce = force || document.visibilityState !== "hidden";
    await pollTaskEvents(false, { force: shouldForce });
    scheduleNextTaskEventPoll();
  }, delay);

  taskEventPollTimerId = timerId;
}
/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage() {
  const message = userInput.value.trim();

  // Don't send empty messages
  if (message === "" || isProcessing) return;

  // Disable input while processing
  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  // Add user message to chat
  addMessageToChat("user", message);

  // Clear input
  userInput.value = "";
  userInput.style.height = "auto";

  // Show typing indicator
  typingIndicator.classList.add("visible");

  // Add message to history
  chatHistory.push({ role: "user", content: message });

  try {
    // Create new assistant response element
    const assistantMessageEl = document.createElement("div");
    assistantMessageEl.className = "message assistant-message";
    assistantMessageEl.innerHTML = "<p></p>";
    chatMessages.appendChild(assistantMessageEl);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Send request to API (trim history)
    const trimmedHistory = chatHistory.slice(-MAX_TURNS);
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: trimmedHistory,
      }),
    });

    // Handle errors
    if (!response.ok) {
      throw new Error("Failed to get response");
    }

    // Process response (streaming SSE or single JSON fallback)
    let responseText = "";
    if (response.body) {
      try {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            // Ignore comment / event lines
            if (line.startsWith("event:")) continue;
            const dataLine = line.startsWith("data:") ? line.slice(5).trim() : line;
            if (!dataLine) continue;
            try {
              const jsonData = JSON.parse(dataLine);
              const chunkText =
                jsonData.response ||
                jsonData.output ||
                (jsonData.result && jsonData.result.response) ||
                "";
              if (chunkText) {
                responseText += chunkText;
                assistantMessageEl.querySelector("p").textContent = responseText;
                chatMessages.scrollTop = chatMessages.scrollHeight;
              }
            } catch (e) {
              // Non-JSON line in stream (ignore)
            }
          }
        }
      } catch (e) {
        console.warn("Streaming parse failed, falling back to full body", e);
      }
    }
    // Fallback: if nothing parsed yet, try full JSON body
    if (!responseText) {
      try {
        const full = await response.clone().json();
        responseText =
          full.response ||
          full.output ||
          (full.result && full.result.response) ||
          JSON.stringify(full).slice(0, 800);
        assistantMessageEl.querySelector("p").textContent = responseText;
      } catch (e) {
        console.error("Failed to parse full JSON fallback", e);
        responseText = "(No response parsed)";
        assistantMessageEl.querySelector("p").textContent = responseText;
      }
    }

    // Add completed response to chat history
    chatHistory.push({ role: "assistant", content: responseText });
  } catch (error) {
    console.error("Error:", error);
    addMessageToChat(
      "assistant",
      "Sorry, there was an error processing your request.",
    );
  } finally {
    // Hide typing indicator
    typingIndicator.classList.remove("visible");

    // Re-enable input
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

/**
 * Helper function to add message to chat
 */
function addMessageToChat(role, content) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}-message`;
  messageEl.innerHTML = `<p>${content}</p>`;
  chatMessages.appendChild(messageEl);

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Creates a task from the UI input
 * @param {Object} task - The task details
 * @returns {Object|null} - The created task or null if failed
 */
async function createTaskFromUI(task) {
  // task: { title, description, timing: { type, ... }, recurrence? }
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
  });
  if (!res.ok) {
    const err = await res.json();
    console.error('Task create error', err);
    return null;
  }
  const { task: created } = await res.json();
  return created;
}

async function pollTaskEvents(initial = false, options = {}) {
  const { force = false } = options;
  if (!taskActivityList) return;
  if (!force && document.visibilityState === 'hidden') {
    if (taskActivityMeta && hasLoadedTaskEvents) {
      taskActivityMeta.textContent = 'Paused (tab inactive)';
    }
    return;
  }
  if (!force && typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    if (taskActivityMeta) taskActivityMeta.textContent = 'Offline';
    return;
  }
  if (isPollingEvents) return;
  isPollingEvents = true;
  try {
    if (taskActivityMeta) {
      taskActivityMeta.textContent = initial ? 'Loading...' : 'Updating...';
    }
    const params = new URLSearchParams();
    if (latestTaskEventIso && !initial) params.set('since', latestTaskEventIso);
    const query = params.toString();
    const res = await fetch(`/api/tasks/events${query ? `?${query}` : ''}`, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const rawEvents = Array.isArray(payload.events) ? payload.events : [];
    const toMs = (value) => {
      const ms = Date.parse(value || '');
      return Number.isNaN(ms) ? 0 : ms;
    };
    const events = rawEvents.slice().sort((a, b) => toMs(a?.occurredAt) - toMs(b?.occurredAt));

    if (typeof payload.latest === 'string' && payload.latest) {
      latestTaskEventIso = payload.latest;
    }

    let appended = 0;
    const initialLoad = !hasLoadedTaskEvents;
    for (const event of events) {
      if (!event || !event.id) continue;
      if (observedTaskEventIds.has(event.id)) continue;
      observedTaskEventIds.add(event.id);
      if (event.occurredAt) latestTaskEventIso = event.occurredAt;
      renderTaskActivity(event, !initialLoad);
      if (!initialLoad) announceTaskEvent(event);
      appended += 1;
    }

    updateTaskActivityUi(appended);
    hasLoadedTaskEvents = true;
  } catch (err) {
    if (taskActivityMeta) taskActivityMeta.textContent = 'Offline';
    console.warn('Task event poll failed', err);
  } finally {
    isPollingEvents = false;
  }
}

function renderTaskActivity(event, highlight) {
  if (!taskActivityList || !event) return;
  syncTaskActivityPlaceholder(true);
  const item = document.createElement('li');
  item.className = 'task-activity-item';
  if (highlight) {
    item.classList.add('is-new');
    setTimeout(() => {
      item.classList.remove('is-new');
    }, 1200);
  }

  const timeEl = document.createElement('time');
  if (event.occurredAt) {
    timeEl.dateTime = event.occurredAt;
    timeEl.textContent = formatTaskTimestamp(event.occurredAt);
  } else {
    timeEl.textContent = 'Unknown time';
  }
  item.appendChild(timeEl);

  const titleEl = document.createElement('div');
  titleEl.className = 'task-activity-title';
  titleEl.textContent = event.title || 'Untitled task';
  item.appendChild(titleEl);

  const kindEl = document.createElement('div');
  kindEl.className = 'task-activity-kind';
  kindEl.textContent = describeEventKind(event.kind);
  item.appendChild(kindEl);

  if (event.note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'task-activity-note';
    noteEl.textContent = event.note;
    item.appendChild(noteEl);
  }

  if (event.nextRun && event.kind !== 'created') {
    const nextEl = document.createElement('div');
    nextEl.className = 'task-activity-note';
    nextEl.textContent = `Next run ${formatTaskTimestamp(event.nextRun)}`;
    item.appendChild(nextEl);
  } else if (event.kind === 'fired') {
    const nextEl = document.createElement('div');
    nextEl.className = 'task-activity-note';
    nextEl.textContent = 'No further runs scheduled.';
    item.appendChild(nextEl);
  }

  const firstExistingItem = taskActivityList.querySelector('.task-activity-item');
  if (firstExistingItem) {
    taskActivityList.insertBefore(item, firstExistingItem);
  } else {
    taskActivityList.appendChild(item);
  }

  const items = taskActivityList.querySelectorAll('.task-activity-item');
  if (items.length > MAX_TASK_ACTIVITY_ITEMS) {
    for (let i = MAX_TASK_ACTIVITY_ITEMS; i < items.length; i += 1) {
      const itemToRemove = items[i];
      if (itemToRemove?.parentElement === taskActivityList) {
        taskActivityList.removeChild(itemToRemove);
      }
    }
  }
}

function updateTaskActivityUi(appendedCount) {
  if (!taskActivityList) return;
  const hasItems = Boolean(taskActivityList.querySelector('.task-activity-item'));
  syncTaskActivityPlaceholder(hasItems);
  if (taskActivityMeta) {
    if (hasItems) {
      const now = new Date();
      const timeText = now.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      taskActivityMeta.textContent = `${appendedCount > 0 ? 'Updated' : 'Checked'} ${timeText}`;
    } else {
      taskActivityMeta.textContent = 'Awaiting events';
    }
  }
}

function announceTaskEvent(event) {
  if (!event || event.kind !== 'fired') return;
  const title = event.title || 'Scheduled task';
  let message = `Task "${title}" triggered at ${formatTaskTimestamp(event.occurredAt)}.`;
  if (event.nextRun) {
    message += ` Next run at ${formatTaskTimestamp(event.nextRun)}.`;
  }
  addMessageToChat('system', message);
}

function describeEventKind(kind) {
  if (!kind) return 'Event';
  const normalized = String(kind).toLowerCase();
  switch (normalized) {
    case 'created':
      return 'Created';
    case 'updated':
      return 'Updated';
    case 'fired':
      return 'Fired';
    case 'disabled':
      return 'Disabled';
    case 'error':
      return 'Error';
    default:
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
}

function formatTaskTimestamp(value) {
  if (!value) return 'Unknown time';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function syncTaskActivityPlaceholder(hasItems) {
  if (!taskActivityList || !taskActivityEmpty) return;
  const attached = taskActivityEmpty.parentElement === taskActivityList;
  if (hasItems && attached) {
    taskActivityList.removeChild(taskActivityEmpty);
  } else if (!hasItems && !attached) {
    taskActivityList.appendChild(taskActivityEmpty);
  }
}
