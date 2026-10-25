/**
 * localStorage `dh.settings` 값 검증. 잘못된 필드는 기본값으로 되돌린다.
 * 이전 버전이 저장한 altEnding 기본 조건은 UI에서 제거됐으므로 converge로 읽는다.
 */
import { DEFAULT_SETTINGS, type Settings } from "./types";

export function parseSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...d, defaultConditions: { ...d.defaultConditions } };
  const p = raw as Record<string, unknown>;
  const dc = p.defaultConditions as Record<string, unknown> | null | undefined;
  const dcOk =
    !!dc &&
    typeof dc === "object" &&
    typeof dc.branching === "boolean" &&
    (dc.mismatch === "rewind" || dc.mismatch === "converge" || dc.mismatch === "altEnding" || dc.mismatch === "na") &&
    (typeof dc.askWhy === "boolean" || dc.askWhy === "na");
  const conditions = dcOk
    ? ({ ...dc, mismatch: dc.mismatch === "altEnding" ? "converge" : dc.mismatch } as unknown as Settings["defaultConditions"])
    : { ...d.defaultConditions };
  return {
    apiKey: typeof p.apiKey === "string" ? p.apiKey : d.apiKey,
    ttsRate:
      typeof p.ttsRate === "number" && Number.isFinite(p.ttsRate) && p.ttsRate >= 0.5 && p.ttsRate <= 1.5
        ? p.ttsRate
        : d.ttsRate,
    voiceURI: typeof p.voiceURI === "string" ? p.voiceURI : d.voiceURI,
    confirmMode: p.confirmMode === "double" || p.confirmMode === "single" ? p.confirmMode : d.confirmMode,
    manualReading: typeof p.manualReading === "boolean" ? p.manualReading : d.manualReading,
    pictures: typeof p.pictures === "boolean" ? p.pictures : d.pictures,
    askLayer: typeof p.askLayer === "boolean" ? p.askLayer : d.askLayer,
    voiceAsk: typeof p.voiceAsk === "boolean" ? p.voiceAsk : d.voiceAsk,
    defaultConditions: conditions,
  };
}
