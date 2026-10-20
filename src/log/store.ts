import { commonColumns } from "./events";
import {
  STORAGE_KEYS,
  type LogEvent,
  type SessionMeta,
  type SessionRecord,
  type SessionStatus,
} from "./types";

/** localStorage 호환 최소 인터페이스 (테스트에서 메모리 객체로 대체) */
export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export type WriteResult = { ok: true } | { ok: false; reason: "quota" | "missing" | "error" };

const LATE_TYPES = new Set(["report_view", "report_source", "asked_check"]);

function isQuota(err: unknown): boolean {
  const e = err as { name?: string; code?: number } | null;
  return !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
}

export function createStore(storage: Storage) {
  const keyOf = (id: string) => STORAGE_KEYS.sessionPrefix + id;

  function readIndex(): string[] {
    try {
      const raw = storage.getItem(STORAGE_KEYS.index);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? arr.filter((k): k is string => typeof k === "string") : [];
    } catch {
      return [];
    }
  }

  function write(key: string, value: string): WriteResult {
    try {
      storage.setItem(key, value);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: isQuota(err) ? "quota" : "error" };
    }
  }

  function read(id: string): SessionRecord | null {
    try {
      const raw = storage.getItem(keyOf(id));
      return raw ? (JSON.parse(raw) as SessionRecord) : null;
    } catch {
      return null;
    }
  }

  function save(rec: SessionRecord): WriteResult {
    return write(keyOf(rec.meta.session_id), JSON.stringify(rec));
  }

  const lastSeq = (rec: SessionRecord) =>
    rec.events.reduce((m, e) => Math.max(m, e.seq), 0);

  function lastScreen(rec: SessionRecord): string | null {
    for (let i = rec.events.length - 1; i >= 0; i--) {
      const s = rec.events[i]?.screen;
      if (s) return s;
    }
    return null;
  }

  function pushEnd(
    rec: SessionRecord,
    type: "session_end" | "dropout",
    ts: string,
    tMs: number | null,
    detail: Record<string, unknown>,
  ) {
    rec.events.push({
      ...commonColumns(rec.meta),
      event_type: type,
      seq: lastSeq(rec) + 1,
      ts_iso: ts,
      t_ms: tMs,
      detail,
    });
  }

  const api = {
    createSession(meta: SessionMeta): WriteResult {
      const rec: SessionRecord = { meta, events: [] };
      const r = save(rec);
      if (!r.ok) return r;
      const idx = readIndex();
      if (!idx.includes(keyOf(meta.session_id))) {
        idx.push(keyOf(meta.session_id));
        return write(STORAGE_KEYS.index, JSON.stringify(idx));
      }
      return r;
    },

    /** write-through. 용량 초과 등은 예외 대신 결과로 돌려준다. */
    appendEvent(sessionId: string, event: LogEvent): WriteResult {
      const rec = read(sessionId);
      if (!rec) return { ok: false, reason: "missing" };
      rec.events.push(event);
      return save(rec);
    },

    listSessions(): SessionRecord[] {
      const out: SessionRecord[] = [];
      for (const key of readIndex()) {
        const rec = read(key.slice(STORAGE_KEYS.sessionPrefix.length));
        if (rec) out.push(rec);
      }
      return out;
    },

    getSession: read,

    /** completed/abandoned로 바꾸면서 session_end가 없으면 한 줄 남긴다. */
    setStatus(
      id: string,
      status: SessionStatus,
      detail?: Record<string, unknown>,
      nowIso: string = new Date().toISOString(),
      tMs: number | null = null,
    ): WriteResult {
      const rec = read(id);
      if (!rec) return { ok: false, reason: "missing" };
      rec.meta.status = status;
      if ((status === "completed" || status === "abandoned") && !rec.events.some((e) => e.event_type === "session_end")) {
        pushEnd(rec, "session_end", nowIso, tMs, { status, ...detail });
      }
      return save(rec);
    },

    markCompleted(id: string): WriteResult {
      return api.setStatus(id, "completed");
    },

    /** 새 세션 시작 시: 이전 open 세션을 abandoned로. atMs = 현재 epoch ms. */
    abandonOpenSessions(exceptId: string, atMs: number, lastScreenName: string | null): void {
      for (const rec of api.findOpenSessions()) {
        if (rec.meta.session_id === exceptId) continue;
        api.setStatus(
          rec.meta.session_id,
          "abandoned",
          { last_screen: lastScreenName },
          new Date(atMs).toISOString(),
          atMs - rec.meta.started_epoch_ms,
        );
      }
    },

    /** 앱 시작 시: session_end 없는 open 세션에 dropout 1회. */
    markDropouts(nowIso: string): void {
      for (const rec of api.findOpenSessions()) {
        if (rec.events.some((e) => e.event_type === "session_end" || e.event_type === "dropout")) continue;
        pushEnd(rec, "dropout", nowIso, null, { last_seq: lastSeq(rec), last_screen: lastScreen(rec) });
        rec.meta.status = "dropout";
        save(rec);
      }
    },

    /** completed 세션에 report_view/report_source/asked_check 덧붙임. seq는 이어서 매긴다. */
    appendLateEvent(id: string, event: LogEvent): WriteResult {
      if (!LATE_TYPES.has(event.event_type)) return { ok: false, reason: "error" };
      const rec = read(id);
      if (!rec) return { ok: false, reason: "missing" };
      rec.events.push({ ...event, seq: lastSeq(rec) + 1 });
      return save(rec);
    },

    /** dh.* 키 전체 크기 추정(UTF-16, 바이트) */
    estimateBytes(): number {
      let total = 0;
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith("dh.")) total += (k.length + (storage.getItem(k) ?? "").length) * 2;
      }
      return total;
    },

    countUnexported(): number {
      return api.listSessions().filter((r) => !r.meta.exported).length;
    },

    markExported(ids: string[]): void {
      for (const id of ids) {
        const rec = read(id);
        if (rec) {
          rec.meta.exported = true;
          save(rec);
        }
      }
    },

    /** 세션 로그만 삭제. dh.settings 등은 유지. */
    clearSessions(): void {
      const keys = new Set(readIndex());
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(STORAGE_KEYS.sessionPrefix)) keys.add(k);
      }
      for (const k of keys) storage.removeItem(k);
      storage.removeItem(STORAGE_KEYS.index);
    },

    hasSessionFor(participantCode: string, storyId: string): boolean {
      return api.listSessions().some(
        (r) => r.meta.participant_code === participantCode && r.meta.story_id === storyId,
      );
    },

    findOpenSessions(): SessionRecord[] {
      return api.listSessions().filter((r) => r.meta.status === "open");
    },
  };
  return api;
}

export type Store = ReturnType<typeof createStore>;
