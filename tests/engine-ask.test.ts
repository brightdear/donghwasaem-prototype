import { describe, expect, it } from "vitest";
import { STRINGS } from "../src/ui/strings";
import { ASK_C1, ASK_ON, CONV, act, endSpeech, nodes, storyAsk, toC1, view, withMaxAsks } from "./helpers-ask";
import fixture from "./fixtures/mini.json";
import type { Story } from "../src/story/types";

describe("묻기 화면 진입", () => {
  it("askLayer 켬 + ask 있음 → p1 뒤 'c1.ask', intro 낭독, asksLeft 2, 인물 2명, 카드 없음", () => {
    const sim = toC1();
    expect(view(sim)).toMatchObject({ screen: "ask", nodeId: "c1.ask", choicePointId: "c1", storyId: "mini", prompt: ASK_C1.intro, selectedCharacterId: null, questions: [], asksLeft: 2, voice: "idle", voiceFails: 0 });
    expect((view(sim) as any).characters.map((c: any) => c.id)).toEqual(["tori", "bird"]);
    expect(sim.speaks[sim.speaks.length - 1]).toMatchObject({ kind: "prompt", text: ASK_C1.intro });
    expect(nodes(sim)).toEqual(["p1", "c1.ask"]);
  });
  it("askLayer 끔 → 바로 선택", () => {
    expect(view(toC1(storyAsk, CONV, { ...ASK_ON, askLayer: false })).screen).toBe("choice");
  });
  it("ask 없는 이야기 → 바로 선택", () => {
    expect(view(toC1(fixture as unknown as Story)).screen).toBe("choice");
  });
  it("분기 off에서도 묻기 화면이 나오고 건너뛰면 offNarration", () => {
    const sim = toC1(storyAsk, { branching: false, mismatch: "na", askWhy: "na" });
    expect(view(sim).screen).toBe("ask");
    act(sim, { type: "askSkip" });
    expect(view(sim)).toMatchObject({ screen: "echo", nodeId: "c1.c1a.offNarration" });
  });
  it("voiceAsk 끔이면 voice hidden", () => {
    expect((view(toC1(storyAsk, CONV, { ...ASK_ON, voiceAsk: false })) as any).voice).toBe("hidden");
  });
});

describe("카드로 묻기", () => {
  it("인물 선택 → 카드 목록, ask_character 로그; 같은 인물 재탭은 무시", () => {
    const sim = toC1();
    endSpeech(sim);
    act(sim, { type: "askCharacter", characterId: "tori" });
    expect(view(sim)).toMatchObject({ selectedCharacterId: "tori", questions: [{ id: "tori.q1", text: "도토리 몇 개야?", asked: false }, { id: "tori.q2", text: "배고파?", asked: false }] });
    expect(sim.logs.at(-1)).toMatchObject({ event_type: "ask_character", screen: "ask", node_id: "c1.ask", choice_point_id: "c1", option_id: "tori" });
    expect(act(sim, { type: "askCharacter", characterId: "tori" })).toEqual([]);
  });
  it("listen 1회 → 카드 낭독·ask_listen, 2회 → 확정·ask_confirm(rt_basis tts_end)·대답 화면", () => {
    const sim = toC1();
    endSpeech(sim);
    act(sim, { type: "askCharacter", characterId: "tori" });
    act(sim, { type: "listen", optionId: "tori.q1" });
    expect(sim.logs.at(-2)).toMatchObject({ event_type: "ask_listen", option_id: "tori.q1" });   // 그 뒤 tts_start
    expect(sim.speaks.at(-1)).toMatchObject({ kind: "option", text: "도토리 몇 개야?" });
    expect((view(sim) as any).selectedQuestionId).toBe("tori.q1");
    act(sim, { type: "listen", optionId: "tori.q1" });
    const confirm = sim.logs.find((e) => e.event_type === "ask_confirm")!;
    expect(confirm).toMatchObject({ node_id: "c1.ask", choice_point_id: "c1", question_id: "c1.ask.tori.q1", option_id: "tori.q1", rt_basis: "tts_end", detail: { via: "card" } });
    expect(typeof confirm.rt_ms).toBe("number");
    expect(view(sim)).toMatchObject({ screen: "askAnswer", nodeId: "c1.ask.tori.q1", choicePointId: "c1", paragraphs: ["세 개야."], pageCount: 1 });
  });
  it("대답 뒤 → 묻기 화면(asksLeft 1, 그 카드 asked, 인물 선택 초기화, intro 재낭독 없음) → 두 번째 대답 뒤 → 선택 화면", () => {
    const sim = toC1();
    endSpeech(sim);
    act(sim, { type: "askCharacter", characterId: "tori" });
    act(sim, { type: "confirm", optionId: "tori.q1" });
    endSpeech(sim);
    const speaksBefore = sim.speaks.length;
    act(sim, { type: "next" });                                        // 대답 마지막 페이지 → 묻기 화면 복귀
    expect(view(sim)).toMatchObject({ screen: "ask", asksLeft: 1, selectedCharacterId: null, questions: [] });
    expect(sim.speaks.length).toBe(speaksBefore);                      // intro 재낭독 없음
    act(sim, { type: "askCharacter", characterId: "tori" });
    expect((view(sim) as any).questions[0]).toMatchObject({ id: "tori.q1", asked: true });
    expect(act(sim, { type: "confirm", optionId: "tori.q1" })).toEqual([]);          // 이미 한 질문
    act(sim, { type: "confirm", optionId: "tori.q2" });
    const rt = sim.logs.filter((e) => e.event_type === "ask_confirm").at(-1)!;
    expect(rt.rt_basis).toBe("shown");
    endSpeech(sim); act(sim, { type: "next" });
    expect(view(sim)).toMatchObject({ screen: "choice", nodeId: "c1", attempt: 1 });
    expect(nodes(sim)).toEqual(["p1", "c1.ask", "c1.ask.tori.q1", "c1.ask", "c1.ask.tori.q2", "c1"]);
  });
  it("두 페이지 대답은 next로 넘긴 뒤 복귀", () => {
    const sim = toC1();
    endSpeech(sim);
    act(sim, { type: "askCharacter", characterId: "bird" });
    act(sim, { type: "confirm", optionId: "bird.q1" });
    expect(view(sim)).toMatchObject({ page: 1, pageCount: 2 });
    endSpeech(sim); act(sim, { type: "next" });
    expect(view(sim)).toMatchObject({ page: 2 });
    endSpeech(sim); act(sim, { type: "next" });
    expect(view(sim).screen).toBe("ask");
  });
  it("건너뛰기 → ask_skip detail.asked, 선택 화면; next·prev는 묻기 화면에서 무시", () => {
    const sim = toC1();
    endSpeech(sim);
    expect(act(sim, { type: "next" })).toEqual([]);
    expect(act(sim, { type: "prev" })).toEqual([]);
    act(sim, { type: "askSkip" });
    expect(sim.logs.find((e) => e.event_type === "ask_skip")).toMatchObject({ node_id: "c1.ask", detail: { asked: 0 } });
    expect(view(sim).screen).toBe("choice");
  });
  it("replay는 intro를 다시 읽는다(replay 로그)", () => {
    const sim = toC1();
    endSpeech(sim);
    act(sim, { type: "replay" });
    expect(sim.speaks.at(-1)).toMatchObject({ kind: "prompt", text: ASK_C1.intro });
    expect(sim.logs.find((e) => e.event_type === "replay")).toMatchObject({ node_id: "c1.ask", replay_count: 1 });
  });
  it("maxAsks 1 → 한 번 묻고 바로 선택", () => {
    const sim = toC1(withMaxAsks(1));
    endSpeech(sim);
    act(sim, { type: "askCharacter", characterId: "tori" });
    act(sim, { type: "confirm", optionId: "tori.q1" });
    endSpeech(sim); act(sim, { type: "next" });
    expect(view(sim).screen).toBe("choice");
  });
  it("되돌리기 재선택(attempt 2)에서는 묻기 화면이 다시 나오지 않는다", () => {
    const sim = toC1(storyAsk, { branching: true, mismatch: "rewind", askWhy: false });
    endSpeech(sim); act(sim, { type: "askSkip" });
    act(sim, { type: "confirm", optionId: "c1b" });
    for (let g = 0; view(sim).screen !== "choice" && g < 20; g++) { endSpeech(sim); act(sim, { type: "next" }); }
    expect(view(sim)).toMatchObject({ screen: "choice", nodeId: "c1#2", attempt: 2 });
    expect(nodes(sim).filter((n) => n === "c1.ask")).toHaveLength(1);
  });
  it("상태는 JSON 왕복 뒤에도 진행된다", () => {
    const sim = toC1();
    endSpeech(sim);
    sim.state = JSON.parse(JSON.stringify(sim.state));
    act(sim, { type: "askCharacter", characterId: "tori" });
    expect((view(sim) as any).selectedCharacterId).toBe("tori");
  });
  it("intro 없는 ask는 기본 문구", () => {
    const noIntro: Story = { ...storyAsk, choicePoints: storyAsk.choicePoints.map((cp) => (cp.id === "c1" ? { ...cp, ask: { ...ASK_C1, intro: undefined } } : cp)) };
    expect((view(toC1(noIntro)) as any).prompt).toBe(STRINGS.askIntroDefault);
  });
});

describe("말로 묻기", () => {
  const M = { characterId: "tori", questionId: "q1", answerText: ["세 개야."] };
  it("voiceStart → listening·voice_start·cancelSpeech; 연타는 무시", () => {
    const sim = toC1();
    const fx = act(sim, { type: "voiceStart" });                      // intro 낭독 중
    expect(fx.some((e) => e.type === "cancelSpeech")).toBe(true);
    expect(view(sim)).toMatchObject({ voice: "listening" });
    expect(sim.logs.at(-1)).toMatchObject({ event_type: "voice_start", node_id: "c1.ask" });
    expect(act(sim, { type: "voiceStart" })).toEqual([]);
  });
  it("맞으면 ask_confirm(via voice, transcript)·voice_result(matched)·대답 화면", () => {
    const sim = toC1();
    act(sim, { type: "voiceStart" });
    act(sim, { type: "voiceResult", transcript: "토리야 몇 개야", alternatives: ["몇 개"], matched: M });
    expect(sim.logs.find((e) => e.event_type === "voice_result")).toMatchObject({ detail: { transcript: "토리야 몇 개야", alternatives: ["몇 개"], matched: "c1.ask.tori.q1" } });
    expect(sim.logs.find((e) => e.event_type === "ask_confirm")).toMatchObject({ question_id: "c1.ask.tori.q1", option_id: "tori.q1", detail: { via: "voice", transcript: "토리야 몇 개야" } });
    expect(view(sim)).toMatchObject({ screen: "askAnswer", nodeId: "c1.ask.tori.q1" });
  });
  it("못 맞추면 unmatched 낭독·voiceFails 1·idle; 두 번째는 unmatchedFinal·hidden; 세 번째 voiceStart 무시", () => {
    const sim = toC1();
    act(sim, { type: "voiceStart" });
    act(sim, { type: "voiceResult", transcript: "", alternatives: [], matched: null });
    expect(sim.speaks.at(-1)!.text).toBe("응? 다시 말해 줄래?");
    expect(view(sim)).toMatchObject({ voice: "idle", voiceFails: 1, asksLeft: 2 });
    act(sim, { type: "voiceStart" });
    act(sim, { type: "voiceResult", transcript: "아무말", alternatives: [], matched: null });
    expect(sim.speaks.at(-1)!.text).toBe("여기서 골라 줄래?");
    expect(view(sim)).toMatchObject({ voice: "hidden", voiceFails: 2 });
    expect(act(sim, { type: "voiceStart" })).toEqual([]);
  });
  it("고른 인물의 unmatched를 쓴다", () => {
    const sim = toC1();
    endSpeech(sim);
    act(sim, { type: "askCharacter", characterId: "bird" });
    act(sim, { type: "voiceStart" });
    act(sim, { type: "voiceFail", reason: "not_allowed" });
    expect(sim.logs.find((e) => e.event_type === "voice_fail")).toMatchObject({ detail: { reason: "not_allowed" } });
    expect(sim.speaks.at(-1)!.text).toBe("짹? 다시 말해 줄래?");
    expect((view(sim) as any).voiceFails).toBe(1);
  });
  it("이미 한 질문을 다시 말하면 ask_repeat, 대답 재생, asksLeft 불변, voiceFails 불변", () => {
    const sim = toC1();
    endSpeech(sim);
    act(sim, { type: "askCharacter", characterId: "tori" });
    act(sim, { type: "confirm", optionId: "tori.q1" });
    endSpeech(sim); act(sim, { type: "next" });
    act(sim, { type: "voiceStart" });
    act(sim, { type: "voiceResult", transcript: "몇 개야", alternatives: [], matched: M });
    expect(sim.logs.filter((e) => e.event_type === "ask_confirm")).toHaveLength(1);
    expect(sim.logs.find((e) => e.event_type === "ask_repeat")).toMatchObject({ question_id: "c1.ask.tori.q1", detail: { via: "voice", transcript: "몇 개야" } });
    expect(view(sim)).toMatchObject({ screen: "askAnswer", nodeId: "c1.ask.tori.q1" });
    endSpeech(sim); act(sim, { type: "next" });
    expect(view(sim)).toMatchObject({ screen: "ask", asksLeft: 1, voiceFails: 0 });
  });
  it("maxAsks 1: 대답 화면에서 온 voiceResult는 무시되고, 대답 뒤에는 선택 화면", () => {
    const sim = toC1(withMaxAsks(1));
    endSpeech(sim);
    act(sim, { type: "askCharacter", characterId: "tori" });
    act(sim, { type: "confirm", optionId: "tori.q1" });
    expect(act(sim, { type: "voiceResult", transcript: "x", alternatives: [], matched: M })).toEqual([]);
    endSpeech(sim); act(sim, { type: "next" });
    expect(view(sim).screen).toBe("choice");
  });
  it("듣는 중 건너뛰어 화면이 바뀐 뒤 온 결과는 무시", () => {
    const sim = toC1();
    act(sim, { type: "voiceStart" });
    act(sim, { type: "askSkip" });
    expect(view(sim).screen).toBe("choice");
    expect(act(sim, { type: "voiceResult", transcript: "몇 개야", alternatives: [], matched: M })).toEqual([]);
    expect(act(sim, { type: "voiceFail", reason: "aborted" })).toEqual([]);
  });
  it("준비 밖 질문(questionId free): ask_free 로그·대답 화면 c1.ask.tori.free·asksLeft 그대로", () => {
    const sim = toC1();
    act(sim, { type: "voiceStart" });
    act(sim, { type: "voiceResult", transcript: "토리야 집에 도토리 많아", alternatives: [], matched: { characterId: "tori", questionId: "free", answerText: ["다섯 개쯤 있어."] }, responder: "llm" });
    expect(sim.logs.find((e) => e.event_type === "voice_result")).toMatchObject({ detail: { matched: "c1.ask.tori.free", responder: "llm" } });
    expect(sim.logs.some((e) => e.event_type === "ask_confirm")).toBe(false);
    expect(sim.logs.find((e) => e.event_type === "ask_free")).toMatchObject({
      choice_point_id: "c1",
      question_id: "c1.ask.tori.free",
      option_id: "tori.free",
      detail: { via: "voice", transcript: "토리야 집에 도토리 많아", answer: "다섯 개쯤 있어." },
    });
    expect(view(sim)).toMatchObject({ screen: "askAnswer", nodeId: "c1.ask.tori.free", paragraphs: ["다섯 개쯤 있어."] });
    endSpeech(sim); act(sim, { type: "next" });
    expect(view(sim)).toMatchObject({ screen: "ask", asksLeft: 2, voiceFails: 0 });
  });
  it("free인데 블록에 없는 인물이면 미인식 처리", () => {
    const sim = toC1();
    act(sim, { type: "voiceStart" });
    act(sim, { type: "voiceResult", transcript: "곰아", alternatives: [], matched: { characterId: "bear", questionId: "free", answerText: ["응."] } });
    expect(sim.logs.some((e) => e.event_type === "ask_free")).toBe(false);
    expect(view(sim)).toMatchObject({ screen: "ask", voiceFails: 1 });
  });
  it("responder keyword + fallbackReason timeout + latencyMs → voice_result.detail에 모두", () => {
    const sim = toC1();
    act(sim, { type: "voiceStart" });
    act(sim, { type: "voiceResult", transcript: "토리야 몇 개야", alternatives: [], matched: M, responder: "keyword", fallbackReason: "timeout", latencyMs: 6001 });
    expect(sim.logs.find((e) => e.event_type === "voice_result")).toMatchObject({ detail: { matched: "c1.ask.tori.q1", responder: "keyword", fallbackReason: "timeout", latencyMs: 6001 } });
  });
  it("responder 없으면 voice_result.detail.responder는 keyword", () => {
    const sim = toC1();
    act(sim, { type: "voiceStart" });
    act(sim, { type: "voiceResult", transcript: "x", alternatives: [], matched: null });
    expect(sim.logs.find((e) => e.event_type === "voice_result")).toMatchObject({ detail: { responder: "keyword" } });
  });
  it("듣는 중에는 listen·confirm·replay·askCharacter를 무시하고 askSkip은 된다(스펙 6.2)", () => {
    const sim = toC1();
    act(sim, { type: "askCharacter", characterId: "tori" });
    act(sim, { type: "voiceStart" });
    expect(act(sim, { type: "listen", optionId: "tori.q1" })).toEqual([]);
    expect(act(sim, { type: "confirm", optionId: "tori.q1" })).toEqual([]);
    expect(act(sim, { type: "replay" })).toEqual([]);
    expect(act(sim, { type: "askCharacter", characterId: "bird" })).toEqual([]);
    expect(view(sim)).toMatchObject({ screen: "ask", voice: "listening", selectedCharacterId: "tori" });
    act(sim, { type: "askSkip" });
    expect(sim.logs.some((e) => e.event_type === "ask_skip")).toBe(true);
    expect(view(sim).screen).toBe("choice");
  });
  it("voice_result.detail.spoken: 준비된 질문이면 prepared, 준비 밖이면 free, 못 맞추면 없음", () => {
    const a = toC1();
    act(a, { type: "voiceStart" });
    act(a, { type: "voiceResult", transcript: "토리야 몇 개야", alternatives: [], matched: { ...M, answerText: ["LLM 글"] }, responder: "llm" });
    expect(a.logs.find((e) => e.event_type === "voice_result")).toMatchObject({ detail: { matched: "c1.ask.tori.q1", spoken: "prepared" } });
    expect(view(a)).toMatchObject({ paragraphs: ["세 개야."] }); // 작성된 대답을 낭독
    const b = toC1();
    act(b, { type: "voiceStart" });
    act(b, { type: "voiceResult", transcript: "집에 도토리 많아", alternatives: [], matched: { characterId: "tori", questionId: "free", answerText: ["다섯 개쯤 있어."] }, responder: "llm" });
    expect(b.logs.find((e) => e.event_type === "voice_result")).toMatchObject({ detail: { matched: "c1.ask.tori.free", spoken: "free" } });
    const c = toC1();
    act(c, { type: "voiceStart" });
    act(c, { type: "voiceResult", transcript: "x", alternatives: [], matched: null });
    expect("spoken" in c.logs.find((e) => e.event_type === "voice_result")!.detail!).toBe(false);
  });
  it("듣지 않는 중의 voiceResult·voiceFail은 무시", () => {
    const sim = toC1();
    expect(act(sim, { type: "voiceResult", transcript: "x", alternatives: [], matched: null })).toEqual([]);
    expect(act(sim, { type: "voiceFail", reason: "timeout" })).toEqual([]);
  });
});
