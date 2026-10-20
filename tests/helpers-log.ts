import { createEventFactory } from "../src/log/events";
import type { Storage } from "../src/log/store";
import type { EngineLogEvent, LogEvent, SessionMeta, SessionRecord } from "../src/log/types";

export class MemStorage implements Storage {
  data = new Map<string, string>();
  limit = Infinity;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.limit) {
      const e = new Error("quota");
      e.name = "QuotaExceededError";
      throw e;
    }
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  get length() {
    return this.data.size;
  }
}

export function makeMeta(code = "P01", epoch = 1000, branching = true): SessionMeta {
  return {
    session_id: `${code}.${epoch}`,
    participant_code: code,
    story_id: "heungbu",
    conditions: branching
      ? { branching: true, mismatch: "rewind", askWhy: true }
      : { branching: false, mismatch: "na", askWhy: "na" },
    confirm_mode: "double",
    manualReading: false,
    started_at_iso: new Date(epoch).toISOString(),
    started_epoch_ms: epoch,
    status: "open",
  };
}

export function build(meta: SessionMeta, evs: EngineLogEvent[]): LogEvent[] {
  const f = createEventFactory(meta);
  return evs.map((e, i) => f(e, `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`));
}

export function rec(meta: SessionMeta, evs: EngineLogEvent[], status = meta.status): SessionRecord {
  return { meta: { ...meta, status }, events: build(meta, evs) };
}
