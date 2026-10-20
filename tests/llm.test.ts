import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { buildRequest, generateReport } from "../src/report/llm";
import { LLM_MAX_TOKENS, LLM_MODEL, type ReportInput } from "../src/report/types";

const input: ReportInput = {
  storyTitle: "흥부와 놀부",
  branching: true,
  choices: [
    { prompt: "흥부는 어떻게 할까?", original: "돌봐 줘요", firstChosen: "모른 척해요", firstMatchesOriginal: false, finalChosen: "돌봐 줘요", attempts: 2, forced: false },
  ],
  comprehension: [{ type: "explicit", result: "most" }],
  parentPrompts: ["무엇이 기억나?", "왜 그랬을까?"],
};
const good = JSON.stringify({ choices: "모른 척을 골랐다가 다시 골랐어요.", comprehension: "대부분 맞혔어요.", prompts: ["무엇이 기억나?", "왜 그랬을까?"] });

function mock(create: ReturnType<typeof vi.fn>) {
  return { messages: { create } } as unknown as Anthropic;
}
const textRes = (text: string, stop_reason = "end_turn") => ({ stop_reason, content: [{ type: "text", text }] });
const gen = (create: ReturnType<typeof vi.fn>, key: string | null = "sk-ant-test") =>
  generateReport(input, key, { client: mock(create) });

describe("buildRequest", () => {
  const req = buildRequest(input);
  it("AC-16 식별자 없음", () => {
    const s = JSON.stringify(req);
    for (const w of ["P01", "session_id", "나이", "participant"]) expect(s).not.toContain(w);
    expect(s).not.toMatch(/\bage\b/i);
    expect(s).not.toMatch(/\d+\s*개\s*중/);
  });
  it("모델·토큰·effort 일치", () => {
    expect(req.model).toBe(LLM_MODEL);
    expect(req.max_tokens).toBe(LLM_MAX_TOKENS);
    expect(req.max_tokens).toBe(2048);
    expect(req.output_config).toEqual({ effort: "low" });
  });
  it("thinking 키 없음", () => {
    // Haiku 5.5 기본 adaptive. 모델을 바꾸면 thinking 기본 동작 재확인 — ADR Follow-ups
    expect("thinking" in req).toBe(false);
  });
  it("messages는 user 1개", () => {
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0]!.role).toBe("user");
  });
  it("system에 핵심 규칙", () => {
    const sys = String(req.system);
    for (const w of ["점수", "숫자", "대화의 기록", "~했어요", "JSON"]) expect(sys).toContain(w);
  });
});

describe("generateReport", () => {
  it("키 없음 → 호출 안 함", async () => {
    const create = vi.fn();
    const r = await gen(create, null);
    expect(create).not.toHaveBeenCalled();
    expect(r).toMatchObject({ source: "template", fallbackReason: "no_key" });
  });
  it("타임아웃 오류", async () => {
    const r = await gen(vi.fn().mockRejectedValue(new Anthropic.APIConnectionTimeoutError()));
    expect(r.fallbackReason).toBe("timeout");
    const abort = Object.assign(new Error("x"), { name: "AbortError" });
    expect((await gen(vi.fn().mockRejectedValue(abort))).fallbackReason).toBe("timeout");
  });
  it("API 500", async () => {
    const err = new Anthropic.APIError(500, undefined, "boom", undefined);
    const r = await gen(vi.fn().mockRejectedValue(err));
    expect(r).toMatchObject({ source: "template", fallbackReason: "http_error" });
  });
  it("비JSON·형태 불일치 → parse_error", async () => {
    expect((await gen(vi.fn().mockResolvedValue(textRes("그냥 글")))).fallbackReason).toBe("parse_error");
    const one = JSON.stringify({ choices: "a", comprehension: "b", prompts: ["하나"] });
    expect((await gen(vi.fn().mockResolvedValue(textRes(one)))).fallbackReason).toBe("parse_error");
  });
  it("금지어 → filtered", async () => {
    const bad = JSON.stringify({ choices: "a", comprehension: "이해력이 향상됐어요", prompts: ["가", "나"] });
    const r = await gen(vi.fn().mockResolvedValue(textRes(bad)));
    expect(r).toMatchObject({ source: "template", fallbackReason: "filtered" });
  });
  it("refusal / max_tokens", async () => {
    expect((await gen(vi.fn().mockResolvedValue(textRes(good, "refusal")))).fallbackReason).toBe("refusal");
    expect((await gen(vi.fn().mockResolvedValue(textRes(good, "max_tokens")))).fallbackReason).toBe("max_tokens");
  });
  it("정상 → llm, 코드펜스 허용, text 블록만 사용", async () => {
    let t = 0;
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "무시" }, { type: "text", text: "```json\n" + good + "\n```" }],
    });
    const r = await generateReport(input, "sk-ant-test", { client: mock(create), now: () => (t += 50) });
    expect(r.source).toBe("llm");
    expect(r.fallbackReason).toBeUndefined();
    expect(r.llmLatencyMs).toBe(50);
    expect(r.text.prompts).toHaveLength(2);
  });
});
