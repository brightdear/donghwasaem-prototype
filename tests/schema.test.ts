import { describe, expect, it } from "vitest";
import fixture from "./fixtures/mini.json";
import heungbu from "../src/data/heungbu.json";
import ant from "../src/data/ant.json";
import { validateStory } from "../src/story/schema";

// 위반 사례를 만들려고 fixture 복제본을 자유롭게 고친다
type Any = any;
const clone = (): Any => JSON.parse(JSON.stringify(fixture));
const codes = (s: unknown): string[] => {
  const r = validateStory(s);
  return r.ok ? [] : r.errors.map((e) => e.code);
};
const badOpt = (s: Any) => s.choicePoints[0].options[1]; // c1b (원작과 다른 선택지)
const origOpt = (s: Any) => s.choicePoints[0].options[0]; // c1a (원작)

describe("validateStory", () => {
  it("fixture 통과", () => {
    const r = validateStory(fixture);
    expect(r.ok ? [] : r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  for (const [name, real] of [["heungbu", heungbu], ["ant", ant]] as const) {
    it(`실제 시나리오 ${name} 통과`, () => {
      const r = validateStory(real);
      expect(r.ok ? [] : r.errors).toEqual([]);
    });
  }

  it("객체가 아니면 실패", () => {
    expect(validateStory(null).ok).toBe(false);
  });

  it("R1 choice 노드 3개가 아니면 R1_CHOICE_COUNT", () => {
    const s = clone();
    s.spine = s.spine.filter((n: Any) => n.id !== "c3");
    expect(codes(s)).toContain("R1_CHOICE_COUNT");
  });
  it("R1 choicePoints id 불일치 → R1_CHOICE_REF", () => {
    const s = clone();
    s.choicePoints[2].id = "c9";
    expect(codes(s)).toContain("R1_CHOICE_REF");
  });

  it("R2 선택지 수 → R2_OPTION_COUNT", () => {
    const s = clone();
    s.choicePoints[0].options = [origOpt(s)];
    expect(codes(s)).toContain("R2_OPTION_COUNT");
  });
  it("R2 원작 선택지 2개 → R2_ORIGINAL_COUNT", () => {
    const s = clone();
    s.choicePoints[1].options[1].matchesOriginal = true;
    expect(codes(s)).toContain("R2_ORIGINAL_COUNT");
  });
  it("R2 altEnding bridge 누락 → R2_MISMATCH_MISSING", () => {
    const s = clone();
    delete badOpt(s).mismatch.altEnding.bridge;
    expect(codes(s)).toContain("R2_MISMATCH_MISSING");
  });
  it("R2 converge 전체 누락 → R2_MISMATCH_MISSING", () => {
    const s = clone();
    delete badOpt(s).mismatch.converge;
    expect(codes(s)).toContain("R2_MISMATCH_MISSING");
  });
  it.each(["contrast", "contrastFinal"])("R2 rewind.%s 누락 → R2_MISMATCH_MISSING", (f) => {
    const s = clone();
    delete badOpt(s).mismatch.rewind[f];
    expect(codes(s)).toContain("R2_MISMATCH_MISSING");
  });

  it("R3 why 1개 → R3_WHY_COUNT", () => {
    const s = clone();
    origOpt(s).why = [origOpt(s).why[0]];
    expect(codes(s)).toContain("R3_WHY_COUNT");
  });
  it("R3 echo 누락 → R3_ECHO_MISSING", () => {
    const s = clone();
    delete badOpt(s).echo;
    expect(codes(s)).toContain("R3_ECHO_MISSING");
  });
  it("R3 offNarration 누락 → R3_OFFNARRATION_MISSING", () => {
    const s = clone();
    delete origOpt(s).offNarration;
    expect(codes(s)).toContain("R3_OFFNARRATION_MISSING");
  });
  it('R3 offNarration에 "골랐" → R3_OFFNARRATION_WORD', () => {
    const s = clone();
    origOpt(s).offNarration = "토리는 나눠 주기를 골랐어요.";
    expect(codes(s)).toContain("R3_OFFNARRATION_WORD");
  });
  it("R3 원작 consequence 누락 → R3_CONSEQUENCE_MISSING", () => {
    const s = clone();
    delete origOpt(s).consequence;
    expect(codes(s)).toContain("R3_CONSEQUENCE_MISSING");
  });
  it.each(["contrast", "contrastFinal"])('R3 rewind.%s에 "다시 골라" → R3_CONTRAST_WORD', (f) => {
    const s = clone();
    badOpt(s).mismatch.rewind[f] = "다시 골라 보자.";
    expect(codes(s)).toContain("R3_CONTRAST_WORD");
  });

  it("R4 질문 3개 → R4_QUESTION_COUNT", () => {
    const s = clone();
    s.comprehension = s.comprehension.slice(0, 3);
    expect(codes(s)).toContain("R4_QUESTION_COUNT");
  });
  it("R4 유형 누락 → R4_TYPE_COVERAGE", () => {
    const s = clone();
    s.comprehension[1].type = "explicit";
    expect(codes(s)).toContain("R4_TYPE_COVERAGE");
  });
  it("R4 answer가 보기 id가 아님 → R4_ANSWER", () => {
    const s = clone();
    s.comprehension[0].answer = "q9z";
    expect(codes(s)).toContain("R4_ANSWER");
  });
  it("R4 보기 1개 → R4_OPTION_COUNT", () => {
    const s = clone();
    s.comprehension[0].options = [s.comprehension[0].options[0]];
    expect(codes(s)).toContain("R4_OPTION_COUNT");
  });
  it("R4 sequence 아닌 질문의 answerFact 배열 → R4_ANSWERFACT_ARRAY", () => {
    const s = clone();
    s.comprehension[0].answerFact = ["빨간 도토리", "다람쥐 토리"];
    expect(codes(s)).toContain("R4_ANSWERFACT_ARRAY");
  });
  it("R4 sequence 질문의 answerFact가 문자열/원소 1개 → R4_ANSWERFACT_ARRAY", () => {
    const s = clone();
    s.comprehension[2].answerFact = "작은 냇물";
    expect(codes(s)).toContain("R4_ANSWERFACT_ARRAY");
    const t = clone();
    t.comprehension[2].answerFact = ["작은 냇물"];
    expect(codes(t)).toContain("R4_ANSWERFACT_ARRAY");
  });
  it("R4 answerFact 비어 있음 → R4_ANSWERFACT_EMPTY", () => {
    const s = clone();
    s.comprehension[0].answerFact = "";
    expect(codes(s)).toContain("R4_ANSWERFACT_EMPTY");
  });

  it("R5 refersTo가 passage가 아님 → R5_REFERS_TO", () => {
    const s = clone();
    s.comprehension[0].refersTo = ["c1"];
    expect(codes(s)).toContain("R5_REFERS_TO");
  });
  it("R5 answerFact가 refersTo passage에 없음 → R5_ANSWERFACT_NOT_IN_PASSAGE", () => {
    const s = clone();
    s.comprehension[0].answerFact = "곰은 고맙다며"; // consequence 텍스트(선택 결과)는 금지
    expect(codes(s)).toContain("R5_ANSWERFACT_NOT_IN_PASSAGE");
    const t = clone();
    t.comprehension[2].answerFact = ["작은 냇물", "아기 토끼"];
    expect(codes(t)).toContain("R5_ANSWERFACT_NOT_IN_PASSAGE");
  });

  it("R6 endings.alt 누락 → R6_ENDINGS", () => {
    const s = clone();
    delete s.endings.alt;
    expect(codes(s)).toContain("R6_ENDINGS");
  });
  it("R6 parentPrompts 1개 → R6_PARENT_PROMPTS", () => {
    const s = clone();
    s.parentPrompts = [s.parentPrompts[0]];
    expect(codes(s)).toContain("R6_PARENT_PROMPTS");
  });

  it("R7 이모지 → R7_EMOJI (경로 포함)", () => {
    const s = clone();
    s.spine[0].paragraphs[0] = "숲속에 다람쥐 토리가 살았어요 🐿️";
    const r = validateStory(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.find((e) => e.code === "R7_EMOJI")?.path).toBe("spine[0].paragraphs[0]");
  });
  it.each(["점수", "등급", "향상", "문해력", "발달"])("R7 금지어 %s → R7_FORBIDDEN_WORD", (w) => {
    const s = clone();
    s.parentPrompts[1] = `오늘 ${w}에 대해 이야기해 보세요.`;
    expect(codes(s)).toContain("R7_FORBIDDEN_WORD");
  });
});

describe("R9 art 섹션(선택)", () => {
  it("art가 없어도 통과", () => {
    const s = clone();
    delete s.art;
    expect(codes(s)).toEqual([]);
  });
  it("motion 값이 집합 밖 → R9_MOTION", () => {
    const s = clone();
    s.art.motions[0].motion = "spin";
    expect(codes(s)).toContain("R9_MOTION");
  });
  it("motion scene이 노드 id가 아님 → R9_SCENE_ID", () => {
    const s = clone();
    s.art.motions[0].scene = "p9";
    expect(codes(s)).toContain("R9_SCENE_ID");
  });
  it("scenes 키가 노드 id가 아님 → R9_SCENE_ID", () => {
    const s = clone();
    s.art.scenes["c1.c1a.bridge"] = { image: "x.webp" };
    expect(codes(s)).toContain("R9_SCENE_ID");
  });
  it("page가 문단 수 초과 → R9_PAGE", () => {
    const s = clone();
    s.art.motions[0].page = 3; // p1 문단 2개
    expect(codes(s)).toContain("R9_PAGE");
    s.art.motions[0].page = 0;
    expect(codes(s)).toContain("R9_PAGE");
  });
  it("결말·하위 노드 id도 허용", () => {
    const s = clone();
    s.art.motions.push({ scene: "end.alt", page: 2, overlay: "leaf.webp", motion: "drift_down", x: 0.5, y: 0.1, size: 0.1 });
    s.art.scenes["c2.c2c.altEnding.bridge"] = { image: "turtle.webp" };
    expect(codes(s)).toEqual([]);
  });
  it("x·y·size 범위 밖 → R9_ART", () => {
    const s = clone();
    s.art.motions[0].size = 1.5;
    expect(codes(s)).toContain("R9_ART");
  });
});

const ASK_OK = {
  voice: true, maxAsks: 2, intro: "토리한테 물어볼까?", sceneLabel: "도토리를 주운 장면",
  characters: [
    { id: "tori", name: "토리", questions: [
      { id: "q1", text: "도토리 몇 개야?", keywords: ["몇 개"], answer: ["세 개야."], clue: "tori_q1" },
      { id: "q2", text: "배고파?", keywords: ["배고"], answer: ["조금 고파."] },
    ], unmatched: "응? 다시 말해 줄래?", unmatchedFinal: "여기서 골라 줄래?" },
  ],
};
const withAsk = (mut?: (a: Any) => void) => { const s = clone(); s.choicePoints[0].ask = JSON.parse(JSON.stringify(ASK_OK)); mut?.(s.choicePoints[0].ask); return s; };

describe("R10 ask", () => {
  it("올바른 ask 통과", () => expect(codes(withAsk())).toEqual([]));
  it("characters 0명·3명 → R10_ASK_CHARACTERS", () => {
    expect(codes(withAsk((a) => (a.characters = [])))).toContain("R10_ASK_CHARACTERS");
    expect(codes(withAsk((a) => (a.characters = [a.characters[0], a.characters[0], a.characters[0]])))).toContain("R10_ASK_CHARACTERS");
  });
  it("questions 1개 → R10_ASK_QUESTIONS", () => expect(codes(withAsk((a) => a.characters[0].questions.pop()))).toContain("R10_ASK_QUESTIONS"));
  it("질문 id 'free'(예약) → R10_ASK_QID_RESERVED", () => expect(codes(withAsk((a) => (a.characters[0].questions[0].id = "free")))).toContain("R10_ASK_QID_RESERVED"));
  it("질문 id 중복 → R10_ASK_QID_DUP", () => expect(codes(withAsk((a) => (a.characters[0].questions[1].id = "q1")))).toContain("R10_ASK_QID_DUP"));
  it("keywords 없음·1자 → R10_ASK_KEYWORDS", () => {
    expect(codes(withAsk((a) => (a.characters[0].questions[0].keywords = [])))).toContain("R10_ASK_KEYWORDS");
    expect(codes(withAsk((a) => (a.characters[0].questions[0].keywords = ["왜 "])))).toContain("R10_ASK_KEYWORDS");
  });
  it("answer 0개·3개 → R10_ASK_ANSWER", () => {
    expect(codes(withAsk((a) => (a.characters[0].questions[0].answer = [])))).toContain("R10_ASK_ANSWER");
    expect(codes(withAsk((a) => (a.characters[0].questions[0].answer = ["a", "b", "c"])))).toContain("R10_ASK_ANSWER");
  });
  it("voice true인데 unmatched 없음 → R10_ASK_UNMATCHED; voice false면 없어도 됨", () => {
    expect(codes(withAsk((a) => delete a.characters[0].unmatchedFinal))).toContain("R10_ASK_UNMATCHED");
    expect(codes(withAsk((a) => { a.voice = false; delete a.characters[0].unmatched; delete a.characters[0].unmatchedFinal; }))).toEqual([]);
  });
  it("maxAsks 0·4·1.5 → R10_ASK_MAXASKS", () => {
    for (const v of [0, 4, 1.5]) expect(codes(withAsk((a) => (a.maxAsks = v)))).toContain("R10_ASK_MAXASKS");
  });
  it("대답에 금지어가 있으면 R7", () => expect(codes(withAsk((a) => (a.characters[0].questions[0].answer = ["점수가 올랐어."])))).toContain("R7_FORBIDDEN_WORD"));
  it("art.pages가 대답 노드를 가리킬 수 있다", () => {
    const s = withAsk();
    s.art.pages = { "c1.ask.tori.q1": ["x.webp"] };
    expect(codes(s)).toEqual([]);
    s.art.pages = { "c1.ask.tori.q1": ["x.webp", "y.webp"] };
    expect(codes(s)).toContain("R9_PAGE");
  });
});
