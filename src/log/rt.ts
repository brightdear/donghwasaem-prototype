/**
 * 반응시간 순수 헬퍼 — 계획 3.3 "반응시간 정의".
 * - 기준점은 현재 화면(시도)의 프롬프트(kind=prompt) 낭독이 ended로 끝났을 때만 세운다.
 * - 워치독으로 끝나면 워치독 시각을 기준점으로(rt_basis=watchdog).
 * - 이미 기준점이 있으면 덮어쓰지 않는다. 다시 듣기가 처음 세운 기준점이면 fromReplay=true.
 * - 기준점이 없으면 화면 진입 시각 기준(rt_basis=shown).
 */
import type { SpeakKind, TtsOutcome } from "../story/types";
import type { RtBasis } from "./types";

export interface RtBasisPoint {
  at: number;
  basis: Exclude<RtBasis, "shown">;
  fromReplay: boolean;
}

export interface RtUtterance {
  kind: SpeakKind;
  isReplay: boolean;
}

export function updateBasis(
  current: RtBasisPoint | null,
  utterance: RtUtterance,
  outcome: TtsOutcome,
  at: number,
): RtBasisPoint | null {
  if (current) return current;
  if (utterance.kind !== "prompt") return null;
  if (outcome === "ended") return { at, basis: "tts_end", fromReplay: utterance.isReplay };
  if (outcome === "watchdog") return { at, basis: "watchdog", fromReplay: utterance.isReplay };
  return null;
}

export interface RtResult {
  rt_ms: number;
  rt_basis: RtBasis;
  detail?: { basis_from: "replay" };
}

export function computeRt(basis: RtBasisPoint | null, shownAt: number, confirmAt: number): RtResult {
  if (!basis) return { rt_ms: Math.max(0, Math.round(confirmAt - shownAt)), rt_basis: "shown" };
  const r: RtResult = { rt_ms: Math.max(0, Math.round(confirmAt - basis.at)), rt_basis: basis.basis };
  if (basis.fromReplay) r.detail = { basis_from: "replay" };
  return r;
}
