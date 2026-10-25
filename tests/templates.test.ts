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
          asks: [],
        });
      }
    }
  }
  return out;
}

describe("curiosity", () => {
  const base: ReportInput = { storyTitle: "t", branching: true, choices: [], comprehension: [], parentPrompts: ["a", "b"], asks: [] };
  it("없으면 중립 문장", () => expect(templateReport(base).curiosity).toBe("오늘은 인물에게 따로 물어보지 않고 이야기를 끝까지 들었어요."));
  it("카드·음성(said) 문장", () => {
    const t = templateReport({ ...base, asks: [
      { scene: "다친 제비를 본 장면", character: "제비", question: "왜 못 날아?", via: "voice" },
      { scene: "다친 제비를 본 장면", character: "흥부", question: "제비 무서워?", via: "card" },
    ] }, ["제비야 왜 못 날아", undefined]);
    expect(t.curiosity).toBe("다친 제비를 본 장면에서 제비에게 「왜 못 날아?」 하고 물어봤어요. 직접 말로 「제비야 왜 못 날아」라고 물었어요.\n다친 제비를 본 장면에서 흥부에게 「제비 무서워?」 하고 물어봤어요.");
    expect(containsForbidden(t.curiosity).hit).toBe(false);
  });
  it("준비 밖 음성 질문(free)은 아이 말을 그대로 한 문장으로", () => {
    const a = { scene: "다친 제비를 본 장면", character: "제비", question: "스스로 생각한 질문", via: "voice" as const, free: true as const };
    expect(templateReport({ ...base, asks: [a] }, ["제비야 몇 살이야"]).curiosity).toBe("다친 제비를 본 장면에서 제비에게 직접 말로 「제비야 몇 살이야」라고 물었어요.");
    expect(templateReport({ ...base, asks: [a] }).curiosity).toBe("다친 제비를 본 장면에서 제비에게 스스로 생각한 질문을 해 봤어요.");
  });
});

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
