import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  ASK_LLM_MAX_TOKENS,
  ASK_LLM_MODEL,
  ASK_LLM_TIMEOUT_MS,
  buildAskRequest,
  createLlmResponder,
  validateAskReply,
} from "../src/ask/llm";
import type { AskInput, AskResponder } from "../src/ask/responder";
import { ASK_C1, storyAsk } from "./helpers-ask";

const scene = ["숲속에 다람쥐 토리가 살았어요.", "어느 날 토리는 빨간 도토리 세 개를 주웠어요."];
const input: AskInput = {
  storyId: storyAsk.id,
  storyTitle: storyAsk.title,
  choicePointId: "c1",
  characterId: null,
  transcript: "토리야 도토리 어디서 났어",
  alternatives: ["토리야 도토리 어디서 났어?"],
  scene,
};
const reply = (o: Record<string, unknown>) => JSON.stringify(o);
const ok = reply({ characterId: "tori", questionId: null, answer: "저기 큰 나무 밑에서 주웠어." });

function mock(create: ReturnType<typeof vi.fn>) {
  return { messages: { create } } as unknown as Anthropic;
}
const textRes = (text: string, stop_reason = "end_turn") => ({ stop_reason, content: [{ type: "text", text }] });
const FALLBACK_OUT = { characterId: "tori", questionId: "q1", answerText: ["세 개야."] };
const fallback: AskResponder = { respond: vi.fn().mockResolvedValue(FALLBACK_OUT) };

describe("buildAskRequest", () => {
  const req = buildAskRequest(input, ASK_C1);
  const body = JSON.stringify(req);
  it("모델·max_tokens·timeout 상수", () => {
    expect(req.model).toBe(ASK_LLM_MODEL);
    expect(ASK_LLM_MODEL).toBe("claude-haiku-5-5");
    expect(req.max_tokens).toBe(ASK_LLM_MAX_TOKENS);
    expect(ASK_LLM_MAX_TOKENS).toBe(300);
    expect(ASK_LLM_TIMEOUT_MS).toBe(6000);
  });
  it("장면 문단·제목·인물 이름·준비된 대답·인식 글이 들어간다", () => {
    for (const w of [...scene, storyAsk.title, "토리", "새", "세 개야.", "저 나무 위에 살아.", "토리야 도토리 어디서 났어"]) expect(body).toContain(w);
  });
  it("AC-16: 참가자·세션·결말·선택지 본문이 없다", () => {
    expect(body).not.toContain("P01");
    expect(body).not.toContain("session");
    expect(body).not.toContain(storyAsk.endings.original.paragraphs[0]!);
    for (const cp of storyAsk.choicePoints) for (const o of cp.options) expect(body).not.toContain(o.label);
  });
  it("고른 인물이 있으면 본문에 표시", () => {
    const s = JSON.stringify(buildAskRequest({ ...input, characterId: "bird" }, ASK_C1).messages);
    expect(s).toContain("bird");
    expect(s).toMatch(/selected/);
  });
  it("system에 핵심 규칙", () => {
    const sys = String(req.system);
    for (const w of ["1인칭", "반말", "60자", "JSON", "결말", "점수", "이모지", "지시"]) expect(sys).toContain(w);
  });
});

describe("validateAskReply", () => {
  it("정상 JSON 통과 (questionId null → free)", () => {
    expect(validateAskReply(ok, ASK_C1, null)).toEqual({ characterId: "tori", questionId: "free", answerText: ["저기 큰 나무 밑에서 주웠어."] });
  });
  it("준비된 질문 id면 그 id", () => {
    expect(validateAskReply(reply({ characterId: "bird", questionId: "q1", answer: "저 나무 위에 살아." }), ASK_C1, null)).toMatchObject({ characterId: "bird", questionId: "q1" });
  });
  it("```json 코드블록도 파싱", () => {
    expect(validateAskReply("```json\n" + ok + "\n```", ASK_C1, null)).not.toBeNull();
  });
  it("블록에 없는 characterId → null", () => {
    expect(validateAskReply(reply({ characterId: "bear", questionId: null, answer: "안녕 나는 곰이야." }), ASK_C1, null)).toBeNull();
  });
  it("고른 인물과 다른 인물 → null", () => {
    expect(validateAskReply(ok, ASK_C1, "bird")).toBeNull();
    expect(validateAskReply(ok, ASK_C1, "tori")).not.toBeNull();
  });
  it("그 인물에 없는 questionId → null", () => {
    expect(validateAskReply(reply({ characterId: "tori", questionId: "q9", answer: "응 그래." }), ASK_C1, null)).toBeNull();
  });
  it("금지어 '점수' → null", () => {
    expect(validateAskReply(reply({ characterId: "tori", questionId: null, answer: "점수는 몰라." }), ASK_C1, null)).toBeNull();
  });
  it("이모지 → null", () => {
    expect(validateAskReply(reply({ characterId: "tori", questionId: null, answer: "좋아 🌰" }), ASK_C1, null)).toBeNull();
  });
  it("3문장 → null", () => {
    expect(validateAskReply(reply({ characterId: "tori", questionId: null, answer: "응. 좋아. 정말이야." }), ASK_C1, null)).toBeNull();
  });
  it("공백 제외 61자 → null, 60자 → 통과", () => {
    const a60 = "가".repeat(59) + ".";
    const a61 = "가".repeat(60) + ".";
    expect(validateAskReply(reply({ characterId: "tori", questionId: null, answer: a60 }), ASK_C1, null)).not.toBeNull();
    expect(validateAskReply(reply({ characterId: "tori", questionId: null, answer: a61 }), ASK_C1, null)).toBeNull();
  });
  it("1자·문자열 아님·JSON 아님 → null", () => {
    expect(validateAskReply(reply({ characterId: "tori", questionId: null, answer: "응" }), ASK_C1, null)).toBeNull();
    expect(validateAskReply(reply({ characterId: "tori", questionId: null, answer: 3 }), ASK_C1, null)).toBeNull();
    expect(validateAskReply("{not json", ASK_C1, null)).toBeNull();
  });
});

describe("createLlmResponder", () => {
  it("정상 → LLM 결과", async () => {
    const create = vi.fn().mockResolvedValue(textRes(ok));
    const r = createLlmResponder("sk-ant-test", { client: mock(create), fallback });
    await expect(r.respond(input, ASK_C1)).resolves.toEqual({ characterId: "tori", questionId: "free", answerText: ["저기 큰 나무 밑에서 주웠어."] });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("타임아웃(AbortError) → fallback 결과", async () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    const r = createLlmResponder("sk-ant-test", { client: mock(vi.fn().mockRejectedValue(err)), fallback });
    await expect(r.respond(input, ASK_C1)).resolves.toEqual(FALLBACK_OUT);
  });
  it("파싱 실패 → fallback", async () => {
    const r = createLlmResponder("sk-ant-test", { client: mock(vi.fn().mockResolvedValue(textRes("{nope"))), fallback });
    await expect(r.respond(input, ASK_C1)).resolves.toEqual(FALLBACK_OUT);
  });
  it("refusal·max_tokens → fallback", async () => {
    for (const sr of ["refusal", "max_tokens"]) {
      const r = createLlmResponder("sk-ant-test", { client: mock(vi.fn().mockResolvedValue(textRes(ok, sr))), fallback });
      await expect(r.respond(input, ASK_C1)).resolves.toEqual(FALLBACK_OUT);
    }
  });
  it("키 없음 → client를 부르지 않고 fallback", async () => {
    const create = vi.fn();
    const r = createLlmResponder("", { client: mock(create), fallback });
    await expect(r.respond(input, ASK_C1)).resolves.toEqual(FALLBACK_OUT);
    expect(create).not.toHaveBeenCalled();
  });
  it("fallback 기본값은 키워드 매칭", async () => {
    const r = createLlmResponder("sk-ant-test", { client: mock(vi.fn().mockResolvedValue(textRes("{nope"))) });
    await expect(r.respond({ ...input, transcript: "토리야 몇 개야" }, ASK_C1)).resolves.toEqual({ characterId: "tori", questionId: "q1", answerText: ["세 개야."] });
  });
});
