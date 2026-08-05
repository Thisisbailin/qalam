import type { AgentRuntimeEvent } from "../runtime/types";

const eventKey = (event: AgentRuntimeEvent) => {
  if (event.type === "item_delta") return `${event.itemType}:${event.runId}:${event.itemId}`;
  return null;
};

export class AgentStreamEventBuffer {
  private events: AgentRuntimeEvent[] = [];

  push(event: AgentRuntimeEvent) {
    const key = eventKey(event);
    if (!key) return false;
    const existingIndex = this.events.findIndex((queued) => eventKey(queued) === key);
    if (existingIndex >= 0) {
      const existing = this.events[existingIndex];
      if (existing.type === "item_delta" && event.type === "item_delta") {
        this.events[existingIndex] = {
          ...event,
          delta: `${existing.delta}${event.delta}`,
        };
      }
    }
    else this.events.push(event);
    return true;
  }

  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }

  clear() {
    this.events = [];
  }
}
