/**
 * 이벤트 로그 타입 — 계획 3.3 (CSV 27열, 순서 고정) · 3.4 설정.
 * 팀 리드 작성. 열 순서를 바꾸면 csv.ts·테스트·분석이 모두 깨지므로 리드와 상의.
 */

import type { Conditions, Screen, QuestionType, ReasonType } from "../story/types";

export type EventType =
  | "session_start"
  | "session_end"
  | "screen_enter"
  | "tts_start"
  | "tts_end" // detail.outcome = ended/cancelled/watchdog
  | "tts_error"
  | "replay"
  | "option_listen"
  | "choice_confirm"
  | "forced_original" // attempt=3 행에만
  | "next_click" // 모든 본문 화면
  | "prev_click" // 본문 화면에서 같은 노드의 앞 페이지로
  | "why_answer"
  | "comprehension_answer"
  | "page_hidden"
  | "dropout"
  | "report_view"
  | "report_source"
  | "asked_check"
  | "ask_character"
  | "ask_listen"
  | "ask_confirm"
  | "ask_repeat"
  | "ask_skip"
  | "voice_start"
  | "voice_result"
  | "voice_fail";

export type RtBasis = "tts_end" | "shown" | "watchdog";
export type ReportSource = "llm" | "template";
export type FallbackReason =
  | "no_key"
  | "timeout"
  | "http_error"
  | "parse_error"
  | "filtered"
  | "refusal"
  | "max_tokens";

/** 엔진이 내는 이벤트 (공통 열은 runner/events.ts가 채움) */
export interface EngineLogEvent {
  event_type: EventType;
  at: number; // ms, action.at 기준 → t_ms
  screen?: Screen;
  node_id?: string;
  choice_point_id?: string;
  question_id?: string; // q1 / why는 `<option id>-why`
  question_type?: QuestionType | "why";
  option_id?: string;
  matches_original?: boolean;
  attempt?: number; // 1~3
  correct?: boolean;
  rt_ms?: number;
  rt_basis?: RtBasis;
  replay_count?: number;
  reason_type?: ReasonType;
  report_source?: ReportSource;
  fallback_reason?: FallbackReason;
  detail?: Record<string, unknown>;
}

/** 저장·내보내기 되는 완전한 행 */
export interface LogEvent extends Omit<EngineLogEvent, "at"> {
  session_id: string; // <참가자코드>.<epoch>
  participant_code: string; // ^[PR]\d{2,3}$
  story_id: string;
  cond_branching: "on" | "off";
  cond_mismatch: "rewind" | "converge" | "altEnding" | "na";
  cond_ask_why: "on" | "off" | "na";
  confirm_mode: "double" | "single";
  seq: number;
  ts_iso: string;
  t_ms: number | null; // dropout 행은 null
}

/** CSV 열 순서 (3.3 표 그대로, 27열) */
export const CSV_COLUMNS = [
  "session_id",
  "participant_code",
  "story_id",
  "cond_branching",
  "cond_mismatch",
  "cond_ask_why",
  "confirm_mode",
  "seq",
  "ts_iso",
  "t_ms",
  "event_type",
  "screen",
  "node_id",
  "choice_point_id",
  "question_id",
  "question_type",
  "option_id",
  "matches_original",
  "attempt",
  "correct",
  "rt_ms",
  "rt_basis",
  "replay_count",
  "reason_type",
  "report_source",
  "fallback_reason",
  "detail",
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];

export type SessionStatus = "open" | "completed" | "abandoned" | "dropout";

export interface SessionMeta {
  session_id: string;
  participant_code: string;
  story_id: string;
  conditions: Conditions;
  confirm_mode: "double" | "single";
  manualReading: boolean;
  started_at_iso: string;
  started_epoch_ms: number;
  status: SessionStatus;
  voice?: string | null;
  /** 장면 그림 표시 여부. 이 필드가 없는 이전 세션은 그림 기능 전(그림 없음) */
  pictures?: boolean;
  exported?: boolean; // 내보내기 여부(미내보내기 세션 수 배지용)
}

export interface SessionRecord {
  meta: SessionMeta;
  events: LogEvent[];
}

/** localStorage `dh.settings` (3.4). apiKey는 코드·로그·내보내기에 절대 포함하지 않는다. */
export interface Settings {
  apiKey: string | null;
  defaultConditions: Conditions;
  confirmMode: "double" | "single";
  ttsRate: number; // 기본 0.9
  voiceURI: string | null;
  manualReading: boolean;
  /** 아이 화면 장면 그림·오버레이 표시(분기 조건과 독립) */
  pictures: boolean;
  /** 묻기 층 토글(원작 되묻기). 분기 조건과 독립 */
  askLayer: boolean;
  /** 음성 질문 토글. `voice`(낭독 목소리)와 다름 */
  voiceAsk: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: null,
  defaultConditions: { branching: true, mismatch: "converge", askWhy: true },
  confirmMode: "double",
  ttsRate: 0.9,
  voiceURI: null,
  manualReading: false,
  pictures: true,
  askLayer: true,
  voiceAsk: true,
};

export const STORAGE_KEYS = {
  settings: "dh.settings",
  index: "dh.index", // 세션 키 배열
  sessionPrefix: "dh.session.", // + <참가자코드>.<epoch>
} as const;

export const PARTICIPANT_CODE_RE = /^[PR]\d{2,3}$/;
