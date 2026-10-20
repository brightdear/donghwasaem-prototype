import type { EngineLogEvent, LogEvent, SessionMeta } from "./types";

/** 세션 메타에서 모든 행에 공통인 열(1~7)을 만든다. */
export function commonColumns(
  meta: SessionMeta,
): Pick<
  LogEvent,
  | "session_id"
  | "participant_code"
  | "story_id"
  | "cond_branching"
  | "cond_mismatch"
  | "cond_ask_why"
  | "confirm_mode"
> {
  const c = meta.conditions;
  return {
    session_id: meta.session_id,
    participant_code: meta.participant_code,
    story_id: meta.story_id,
    cond_branching: c.branching ? "on" : "off",
    cond_mismatch: c.mismatch,
    cond_ask_why: c.askWhy === "na" ? "na" : c.askWhy ? "on" : "off",
    confirm_mode: meta.confirm_mode,
  };
}

/**
 * 이벤트 팩토리. 첫 이벤트의 at을 세션 시작 기준(t_ms=0)으로 보관하고
 * seq를 1부터 증가시킨다. dropout 행은 t_ms null.
 */
export function createEventFactory(
  meta: SessionMeta,
): (e: EngineLogEvent, nowIso: string) => LogEvent {
  const common = commonColumns(meta);
  let seq = 0;
  let baseAt: number | null = null;
  return (e, nowIso) => {
    if (baseAt === null) baseAt = e.at;
    seq += 1;
    const { at, ...rest } = e;
    return {
      ...common,
      ...rest,
      seq,
      ts_iso: nowIso,
      t_ms: e.event_type === "dropout" ? null : at - baseAt,
    };
  };
}
