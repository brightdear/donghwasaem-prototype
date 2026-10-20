import { describe, expect, it } from "vitest";
import { containsForbidden } from "../src/report/filter";

describe("containsForbidden", () => {
  it.each(["점수", "등급", "향상", "문해력", "발달"])("금지어 %s 검출", (w) => {
    expect(containsForbidden(`오늘 ${w}을 말했어요`).hit).toBe(true);
  });
  it("활용형 검출", () => {
    expect(containsForbidden("이해가 향상됐어요").matches).toContain("향상");
    expect(containsForbidden("언어가 발달이 빨라요").hit).toBe(true);
    expect(containsForbidden("점수가 좋아요").hit).toBe(true);
  });
  it("숫자 비율 검출", () => {
    expect(containsForbidden("세 개 중 두 개").hit).toBe(false);
    expect(containsForbidden("3개 중 2개 맞혔어요").hit).toBe(true);
    expect(containsForbidden("2/3 맞혔어요").hit).toBe(true);
    expect(containsForbidden("절반 정도 50% 맞혔어요").hit).toBe(true);
  });
  it("아라비아 숫자 자체와 이모지 검출", () => {
    expect(containsForbidden("한 번 들었어요 1번").hit).toBe(true);
    expect(containsForbidden("잘했어요 😀").hit).toBe(true);
  });
  it("정상 문장 통과", () => {
    const r = containsForbidden("세 가지를 기억했어요. 두 번 다시 들었어요.");
    expect(r).toEqual({ hit: false, matches: [] });
  });
});
