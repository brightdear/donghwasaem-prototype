import { describe, expect, it } from "vitest";
import { categorize, saidByAsk, summarize } from "../src/report/summarize";
import type { LogEvent, SessionRecord } from "../src/log/types";
import type { Story } from "../src/story/types";

const story = {
  schemaVersion: 2,
  id: "t",
  title: "시험 이야기",
  spine: [],
  choicePoints: [
    {
      id: "c1",
      prompt: "어떻게 할까?",
      options: [
        { id: "c1a", label: "돕기", matchesOriginal: true, echo: "", why: [{ id: "c1a-w1", text: "불쌍해서", reasonType: "others_feeling" }] },
        { id: "c1b", label: "모른 척", matchesOriginal: false, echo: "", why: [{ id: "c1b-w1", text: "귀찮아서", reasonType: "other" }] },
        { id: "c1c", label: "도망", matchesOriginal: false, echo: "", why: [] },
      ],
      ask: {
        voice: true,
        sceneLabel: "다친 제비를 본 장면",
        characters: [
          {
            id: "swallow",
            name: "제비",
            questions: [
              { id: "q1", text: "왜 못 날아?", keywords: ["못 날"], answer: ["다쳤어."] },
              { id: "q2", text: "어디가 아파?", keywords: ["아파"], answer: ["다리."] },
            ],
            unmatched: "u",
            unmatchedFinal: "f",
          },
        ],
      },
    },
  ],
  endings: { original: { paragraphs: [] }, alt: { paragraphs: [] } },
  comprehension: [],
  parentPrompts: ["a", "b"],
} as unknown as Story;

let seq = 0;
function ev(e: Partial<LogEvent>): LogEvent {
  return {
    session_id: "P01.1", participant_code: "P01", story_id: "t",
    cond_branching: "on", cond_mismatch: "rewind", cond_ask_why: "on", confirm_mode: "double",
    seq: ++seq, ts_iso: "", t_ms: 0, event_type: "next_click", ...e,
  };
}
function rec(events: LogEvent[], branching = true): SessionRecord {
  return {
    meta: {
      session_id: "P01.1", participant_code: "P01", story_id: "t",
      conditions: { branching, mismatch: branching ? "rewind" : "na", askWhy: branching ? true : "na" },
      confirm_mode: "double", manualReading: false, started_at_iso: "", started_epoch_ms: 0, status: "completed",
    },
    events,
  };
}
const cc = (opt: string, attempt: number, orig: boolean) =>
  ev({ event_type: "choice_confirm", choice_point_id: "c1", option_id: opt, attempt, matches_original: orig });
const qa = (type: "explicit" | "inference" | "sequence", correct: boolean) =>
  ev({ event_type: "comprehension_answer", question_type: type, correct });

describe("summarize", () => {
  it("rewind 2회 시도 후 원작", () => {
    const r = summarize(rec([cc("c1b", 1, false), ev({ event_type: "why_answer", choice_point_id: "c1", option_id: "c1b-w1" }), cc("c1a", 2, true)]), story);
    expect(r.choices[0]).toMatchObject({
      firstChosen: "모른 척", firstMatchesOriginal: false, finalChosen: "돕기",
      attempts: 2, forced: false, reasonText: "귀찮아서", original: "돕기",
    });
  });
  it("강제 원작", () => {
    const r = summarize(rec([cc("c1b", 1, false), cc("c1c", 2, false), ev({ event_type: "forced_original", choice_point_id: "c1", option_id: "c1a", attempt: 3 })]), story);
    expect(r.choices[0]).toMatchObject({ firstChosen: "모른 척", finalChosen: "돕기", attempts: 3, forced: true });
    expect(r.choices[0]!.reasonText).toBeUndefined();
  });
  it("분기 off", () => {
    const r = summarize(rec([ev({})], false), story);
    expect(r.branching).toBe(false);
    expect(r.choices).toEqual([]);
  });
  it("참가자 코드·session_id가 결과에 없음", () => {
    const s = JSON.stringify(summarize(rec([cc("c1a", 1, true)]), story));
    expect(s).not.toContain("P01");
    expect(s).not.toContain("session_id");
  });
  it("유형별 범주", () => {
    const r = summarize(rec([qa("explicit", true), qa("explicit", true), qa("inference", false), qa("inference", false), qa("sequence", true), qa("sequence", false), qa("sequence", false)]), story);
    expect(r.comprehension).toEqual([
      { type: "explicit", result: "all" },
      { type: "inference", result: "none" },
      { type: "sequence", result: "some" },
    ]);
  });
  it("ask_confirm → asks(순서·via), saidByAsk는 음성 글만", () => {
    const r = rec([
      ev({ event_type: "ask_confirm", choice_point_id: "c1", question_id: "c1.ask.swallow.q1", option_id: "swallow.q1", detail: { via: "voice", transcript: "제비야 왜 못 날아" } }),
      ev({ event_type: "ask_repeat", choice_point_id: "c1", question_id: "c1.ask.swallow.q1", option_id: "swallow.q1", detail: { via: "voice", transcript: "왜 못 날아" } }),
      ev({ event_type: "ask_confirm", choice_point_id: "c1", question_id: "c1.ask.swallow.q2", option_id: "swallow.q2", detail: { via: "card" } }),
      ev({ event_type: "ask_confirm", choice_point_id: "c1", question_id: "c1.ask.swallow.q9", option_id: "swallow.q9", detail: { via: "card" } }),
    ]);
    expect(summarize(r, story).asks).toEqual([
      { scene: "다친 제비를 본 장면", character: "제비", question: "왜 못 날아?", via: "voice" },
      { scene: "다친 제비를 본 장면", character: "제비", question: "어디가 아파?", via: "card" },
    ]);
    expect(saidByAsk(r, story)).toEqual(["제비야 왜 못 날아", undefined]);
  });
  it("ask 없는 세션은 asks []", () => expect(summarize(rec([]), story).asks).toEqual([]));
  it("범주 경계값", () => {
    expect(categorize(2, 4)).toBe("some");
    expect(categorize(3, 4)).toBe("most");
    expect(categorize(1, 2)).toBe("some");
    expect(categorize(2, 3)).toBe("most");
    expect(categorize(4, 4)).toBe("all");
    expect(categorize(0, 4)).toBe("none");
  });
});
