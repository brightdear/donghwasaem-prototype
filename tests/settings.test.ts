import { describe, expect, it } from "vitest";
import { parseSettings } from "../src/log/settings";
import { DEFAULT_SETTINGS } from "../src/log/types";

describe("parseSettings", () => {
  it("빈 객체 → 기본값(askLayer·voiceAsk 켬, converge)", () => {
    const s = parseSettings({});
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.askLayer).toBe(true);
    expect(s.voiceAsk).toBe(true);
    expect(s.defaultConditions).toEqual({ branching: true, mismatch: "converge", askWhy: true });
  });
  it("이전 버전의 altEnding 기본 조건은 converge로 읽는다", () => {
    const s = parseSettings({ defaultConditions: { branching: true, mismatch: "altEnding", askWhy: false } });
    expect(s.defaultConditions).toEqual({ branching: true, mismatch: "converge", askWhy: false });
  });
  it("rewind·off는 그대로", () => {
    expect(parseSettings({ defaultConditions: { branching: true, mismatch: "rewind", askWhy: true } }).defaultConditions.mismatch).toBe("rewind");
    expect(parseSettings({ defaultConditions: { branching: false, mismatch: "na", askWhy: "na" } }).defaultConditions.branching).toBe(false);
  });
  it("askLayer·voiceAsk false 저장값 유지, 엉뚱한 타입은 기본값", () => {
    expect(parseSettings({ askLayer: false, voiceAsk: false })).toMatchObject({ askLayer: false, voiceAsk: false });
    expect(parseSettings({ askLayer: "no", voiceAsk: 1 })).toMatchObject({ askLayer: true, voiceAsk: true });
  });
  it("객체가 아니면 기본값", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("x")).toEqual(DEFAULT_SETTINGS);
  });
});
