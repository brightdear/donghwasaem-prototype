import { describe, expect, it } from "vitest";
import { containsForbidden } from "../src/report/filter";
import { templateReport } from "../src/report/templates";
import type { ComprehensionResult, ReportChoice, ReportInput } from "../src/report/types";

const base: ReportChoice = {
  prompt: "흥부는 어떻게 할까?",
  original: "제비를 돌봐 줘요",
  firstChosen: "제비를 돌봐 줘요",
  firstMatchesOriginal: true,
  finalChosen: "제비를 돌봐 줘요",
  attempts: 1,
  forced: false,
};
const variants: ReportChoice[] = [
  base,
  { ...base, firstChosen: "모른 척해요", firstMatchesOriginal: false, finalChosen: "모른 척해요" },
  { ...base, firstChosen: "모른 척해요", firstMatchesOriginal: false, attempts: 2 },
  { ...base, firstChosen: "모른 척해요", firstMatchesOriginal: false, attempts: 3, forced: true },
  { ...base, reasonText: "제비가 아파서요" },
];
const results: ComprehensionResult[] = ["all", "most", "some", "none"];
const prompts = ["가장 기억에 남는 장면은?", "너라면 어떻게 했을까?", "왜 그랬을까?", "넷째 질문"];

function inputs(): ReportInput[] {
  const out: ReportInput[] = [];
  for (const branching of [true, false]) {
    for (const v of variants) {
      for (const r of results) {
        out.push({
          storyTitle: "흥부와 놀부",
          branching,
          choices: branching ? [v, base] : [],
          comprehension: [
            { type: "explicit", result: r },
            { type: "inference", result: "all" },
            { type: "sequence", result: r },
          ],
          parentPrompts: prompts,
        });
      }
    }
  }
  return out;
}

describe("templateReport", () => {
  it("모든 조합 출력이 filter 통과, 숫자·이모지 없음, prompts 2~3개", () => {
    for (const i of inputs()) {
      const t = templateReport(i);
      const all = [t.choices, t.comprehension, ...t.prompts].join("\n");
      expect(containsForbidden(all)).toEqual({ hit: false, matches: [] });
      expect(all).not.toMatch(/\d/);
      expect(t.prompts.length).toBeGreaterThanOrEqual(2);
      expect(t.prompts.length).toBeLessThanOrEqual(3);
    }
  });
  it("분기 off면 원작 비교 없이 끝까지 들었다는 문장", () => {
    const t = templateReport({ ...inputs()[0]!, branching: false, choices: [] });
    expect(t.choices).toContain("끝까지 들었어요");
    expect(t.choices).not.toContain("원작");
  });
  it("rewind 다회면 다시 골라서 덧붙임, 강제면 원작대로", () => {
    const re = templateReport({ ...inputs()[0]!, choices: [variants[2]!] });
    expect(re.choices).toContain("다시 골라서");
    const forced = templateReport({ ...inputs()[0]!, choices: [variants[3]!] });
    expect(forced.choices).toContain("원작대로");
  });
  it("틀린 유형 안내가 들어가고 모두 맞으면 없음", () => {
    const miss = templateReport({
      ...inputs()[0]!,
      comprehension: [{ type: "inference", result: "none" }],
    });
    expect(miss.comprehension).toContain("왜 그랬는지 짐작하는 질문에 대해");
    const ok = templateReport({
      ...inputs()[0]!,
      comprehension: [{ type: "inference", result: "all" }],
    });
    expect(ok.comprehension).not.toContain("에 대해");
  });
  it("parentPrompts가 부족하면 기본 질문으로 채움", () => {
    const t = templateReport({ ...inputs()[0]!, parentPrompts: ["하나뿐"] });
    expect(t.prompts.length).toBe(2);
  });
});
