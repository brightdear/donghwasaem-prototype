import { describe, expect, it } from "vitest";
import { matchQuestion, normalize } from "../src/ask/matcher";
import { keywordResponder } from "../src/ask/responder";
import type { AskBlock, AskCharacter } from "../src/story/types";

const swallow: AskCharacter = { id: "swallow", name: "제비", unmatched: "u", unmatchedFinal: "f", questions: [
  { id: "q1", text: "왜 못 날아?", keywords: ["못 날", "왜 못", "안 날", "날개", "날지"], answer: ["다리를 다쳤어."] },
  { id: "q2", text: "어디가 아파?", keywords: ["어디", "아파", "아프", "다쳤"], answer: ["이쪽 다리야."] },
  { id: "q3", text: "엄마는 어디 있어?", keywords: ["엄마", "가족", "혼자", "아빠"], answer: ["엄마는 멀리 갔어."] },
]};
const heungbu: AskCharacter = { id: "heungbu", name: "흥부", unmatched: "u", unmatchedFinal: "f", questions: [
  { id: "q1", text: "제비 어떻게 할 거야?", keywords: ["어떻게", "어떡", "할 거야"], answer: ["생각 중이야."] },
  { id: "q2", text: "제비 무서워?", keywords: ["무서", "무섭", "겁"], answer: ["아니."] },
]};
const chars = [swallow, heungbu];

describe("normalize", () => {
  it("공백·문장부호 제거, 소문자", () => {
    expect(normalize("왜 못 날아?")).toBe("왜못날아");
    expect(normalize("  Hello, World! ")).toBe("helloworld");
  });
});

describe("matchQuestion", () => {
  it("키워드 2개 + 이름 보너스 → swallow.q1 점수 4", () => {
    expect(matchQuestion("제비야 왜 못 날아", [], chars, null)).toEqual({ characterId: "swallow", questionId: "q1", score: 4 });
  });
  it("띄어쓰기·존댓말 변형", () => {
    expect(matchQuestion("왜못날아요?", [], chars, null)?.questionId).toBe("q1");
  });
  it("빈 글·무관한 글 → null", () => {
    expect(matchQuestion("", [], chars, null)).toBeNull();
    expect(matchQuestion("   ", [], chars, null)).toBeNull();
    expect(matchQuestion("오늘 날씨 좋다", [], chars, null)).toBeNull();
  });
  it("대안 후보에서 맞으면 그것을 쓴다", () => {
    expect(matchQuestion("모르겠어", ["어디가 아파"], chars, null)?.questionId).toBe("q2");
  });
  it("인물을 골랐으면 그 인물의 질문만", () => {
    expect(matchQuestion("어디가 아파", [], chars, "heungbu")).toBeNull();
    expect(matchQuestion("흥부야 어떻게 할 거야", [], chars, null)).toEqual({ characterId: "heungbu", questionId: "q1", score: 4 });
  });
  it("'어디'는 q2·q3 모두 1점 → 앞선 q2", () => {
    expect(matchQuestion("어디", [], [swallow], null)?.questionId).toBe("q2");
  });
  it("이름만 있고 키워드가 없으면 null(이름 보너스는 점수 1 이상일 때만)", () => {
    expect(matchQuestion("제비야 안녕", [], chars, null)).toBeNull();
  });
});

describe("keywordResponder", () => {
  const ask: AskBlock = { voice: true, characters: chars };
  it("맞으면 answer를 채워 돌려준다", async () => {
    await expect(keywordResponder.respond({ storyId: "h", choicePointId: "c1", characterId: null, transcript: "제비야 왜 못 날아", alternatives: [] }, ask))
      .resolves.toEqual({ characterId: "swallow", questionId: "q1", answerText: ["다리를 다쳤어."] });
  });
  it("못 맞추면 null", async () => {
    await expect(keywordResponder.respond({ storyId: "h", choicePointId: "c1", characterId: null, transcript: "안녕", alternatives: [] }, ask)).resolves.toBeNull();
  });
});
