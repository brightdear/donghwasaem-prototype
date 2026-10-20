import { describe, expect, it } from "vitest";
import fixture from "./fixtures/mini.json";
import { currentView, init, isFinished, step, type EngineState } from "../src/story/engine";
import type { Action, Conditions, Effect, EngineSettings, Story } from "../src/story/types";
import { VALID_CONDITIONS } from "../src/story/types";
import type { EngineLogEvent } from "../src/log/types";
import { STRINGS } from "../src/ui/strings";

const story = fixture as unknown as Story;
const AUTO: EngineSettings = { manualReading: false, confirmMode: "double" };

const OFF: Conditions = { branching: false, mismatch: "na", askWhy: "na" };
const C = (mismatch: "rewind" | "converge" | "altEnding", askWhy: boolean): Conditions => ({ branching: true, mismatch, askWhy });

interface Run {
  nodes: string[];
  logs: EngineLogEvent[];
  speaks: Extract<Effect, { type: "speak" }>[];
  state: EngineState;
}

/** 스텁 TTS(즉시 ended)로 끝까지 돌린다. decisions = 선택 화면에서 차례로 확정할 보기 id */
function run(conditions: Conditions, decisions: string[], settings: EngineSettings = AUTO): Run {
  let t = 0;
  const logs: EngineLogEvent[] = [];
  const speaks: Run["speaks"] = [];
  let r = init(story, conditions, settings, t);
  let state = r.state;
  const absorb = (fx: Effect[]) => {
    const q = [...fx];
    while (q.length) {
      const e = q.shift()!;
      if (e.type === "log") logs.push(e.event);
      if (e.type === "speak") {
        speaks.push(e);
        const d = step(state, { type: "ttsDone", utteranceId: e.utteranceId, outcome: "ended", at: (t += 10) });
        state = d.state;
        q.push(...d.effects);
      }
    }
  };
  absorb(r.effects);
  let di = 0;
  for (let g = 0; !isFinished(state) && g < 1000; g++) {
    const v = currentView(state);
    const at = (t += 100);
    let a: Action;
    if (v.screen === "choice") a = { type: "confirm", optionId: decisions[di++]!, at };
    else if (v.screen === "why") a = { type: "answerWhy", optionId: v.options[0]!.id, at };
    else if (v.screen === "comprehension") {
      const q = story.comprehension.find((x) => x.id === v.questionId)!;
      a = v.feedback === null ? { type: "answerQuestion", optionId: q.answer, at } : { type: "next", at };
    } else a = { type: "next", at };
    r = step(state, a);
    state = r.state;
    absorb(r.effects);
  }
  expect(di).toBe(decisions.length);
  const nodes = logs.filter((e) => e.event_type === "screen_enter" && e.node_id).map((e) => e.node_id!);
  return { nodes, logs, speaks, state };
}

const COMP = ["q1", "q2", "q3", "q4"];
const storyNodes = (r: Run) => r.nodes.filter((n) => !COMP.includes(n));

// ---------- 손으로 쓴 기대 노드 배열 (계획 3.2 하위 노드 id 규칙) ----------

const EXPECTED: Record<string, { decisions: string[]; nodes: string[] }> = {
  "off/원작": {
    decisions: [],
    nodes: [
      "p1", "c1.c1a.offNarration", "c1.c1a.consequence",
      "p2", "c2.c2a.offNarration", "c2.c2a.consequence",
      "p3", "c3.c3a.offNarration", "c3.c3a.consequence",
      "end.original",
    ],
  },

  // ---- rewind + why ----
  "rewind-why/원작만": {
    decisions: ["c1a", "c2a", "c3a"],
    nodes: [
      "p1", "c1#1", "c1.c1a.echo#1", "c1.c1a.why#1", "c1.c1a.consequence#1",
      "p2", "c2#1", "c2.c2a.echo#1", "c2.c2a.why#1", "c2.c2a.consequence#1",
      "p3", "c3#1", "c3.c3a.echo#1", "c3.c3a.why#1", "c3.c3a.consequence#1",
      "end.original",
    ],
  },
  "rewind-why/다른만": {
    decisions: ["c1b", "c1b", "c2b", "c2c", "c3b", "c3b"],
    nodes: [
      "p1",
      "c1#1", "c1.c1b.echo#1", "c1.c1b.why#1", "c1.c1b.rewind.consequence#1", "c1.c1b.rewind.contrast#1",
      "c1#2", "c1.c1b.echo#2", "c1.c1b.why#2", "c1.c1b.rewind.consequence#2", "c1.c1b.rewind.contrastFinal#2",
      "c1.c1a.consequence#3",
      "p2",
      "c2#1", "c2.c2b.echo#1", "c2.c2b.why#1", "c2.c2b.rewind.consequence#1", "c2.c2b.rewind.contrast#1",
      "c2#2", "c2.c2c.echo#2", "c2.c2c.why#2", "c2.c2c.rewind.consequence#2", "c2.c2c.rewind.contrastFinal#2",
      "c2.c2a.consequence#3",
      "p3",
      "c3#1", "c3.c3b.echo#1", "c3.c3b.why#1", "c3.c3b.rewind.consequence#1", "c3.c3b.rewind.contrast#1",
      "c3#2", "c3.c3b.echo#2", "c3.c3b.why#2", "c3.c3b.rewind.consequence#2", "c3.c3b.rewind.contrastFinal#2",
      "c3.c3a.consequence#3",
      "end.original",
    ],
  },
  "rewind-why/섞기": {
    decisions: ["c1b", "c1a", "c2a", "c3b", "c3b"],
    nodes: [
      "p1",
      "c1#1", "c1.c1b.echo#1", "c1.c1b.why#1", "c1.c1b.rewind.consequence#1", "c1.c1b.rewind.contrast#1",
      "c1#2", "c1.c1a.echo#2", "c1.c1a.why#2", "c1.c1a.consequence#2",
      "p2",
      "c2#1", "c2.c2a.echo#1", "c2.c2a.why#1", "c2.c2a.consequence#1",
      "p3",
      "c3#1", "c3.c3b.echo#1", "c3.c3b.why#1", "c3.c3b.rewind.consequence#1", "c3.c3b.rewind.contrast#1",
      "c3#2", "c3.c3b.echo#2", "c3.c3b.why#2", "c3.c3b.rewind.consequence#2", "c3.c3b.rewind.contrastFinal#2",
      "c3.c3a.consequence#3",
      "end.original",
    ],
  },

  // ---- rewind, why 없음 ----
  "rewind-nowhy/원작만": {
    decisions: ["c1a", "c2a", "c3a"],
    nodes: [
      "p1", "c1#1", "c1.c1a.echo#1", "c1.c1a.consequence#1",
      "p2", "c2#1", "c2.c2a.echo#1", "c2.c2a.consequence#1",
      "p3", "c3#1", "c3.c3a.echo#1", "c3.c3a.consequence#1",
      "end.original",
    ],
  },
  "rewind-nowhy/다른만": {
    decisions: ["c1b", "c1b", "c2b", "c2c", "c3b", "c3b"],
    nodes: [
      "p1",
      "c1#1", "c1.c1b.echo#1", "c1.c1b.rewind.consequence#1", "c1.c1b.rewind.contrast#1",
      "c1#2", "c1.c1b.echo#2", "c1.c1b.rewind.consequence#2", "c1.c1b.rewind.contrastFinal#2",
      "c1.c1a.consequence#3",
      "p2",
      "c2#1", "c2.c2b.echo#1", "c2.c2b.rewind.consequence#1", "c2.c2b.rewind.contrast#1",
      "c2#2", "c2.c2c.echo#2", "c2.c2c.rewind.consequence#2", "c2.c2c.rewind.contrastFinal#2",
      "c2.c2a.consequence#3",
      "p3",
      "c3#1", "c3.c3b.echo#1", "c3.c3b.rewind.consequence#1", "c3.c3b.rewind.contrast#1",
      "c3#2", "c3.c3b.echo#2", "c3.c3b.rewind.consequence#2", "c3.c3b.rewind.contrastFinal#2",
      "c3.c3a.consequence#3",
      "end.original",
    ],
  },
  "rewind-nowhy/섞기": {
    decisions: ["c1b", "c1a", "c2a", "c3b", "c3b"],
    nodes: [
      "p1",
      "c1#1", "c1.c1b.echo#1", "c1.c1b.rewind.consequence#1", "c1.c1b.rewind.contrast#1",
      "c1#2", "c1.c1a.echo#2", "c1.c1a.consequence#2",
      "p2",
      "c2#1", "c2.c2a.echo#1", "c2.c2a.consequence#1",
      "p3",
      "c3#1", "c3.c3b.echo#1", "c3.c3b.rewind.consequence#1", "c3.c3b.rewind.contrast#1",
      "c3#2", "c3.c3b.echo#2", "c3.c3b.rewind.consequence#2", "c3.c3b.rewind.contrastFinal#2",
      "c3.c3a.consequence#3",
      "end.original",
    ],
  },

  // ---- converge ----
  "converge-why/원작만": {
    decisions: ["c1a", "c2a", "c3a"],
    nodes: [
      "p1", "c1", "c1.c1a.echo", "c1.c1a.why", "c1.c1a.consequence",
      "p2", "c2", "c2.c2a.echo", "c2.c2a.why", "c2.c2a.consequence",
      "p3", "c3", "c3.c3a.echo", "c3.c3a.why", "c3.c3a.consequence",
      "end.original",
    ],
  },
  "converge-why/다른만": {
    decisions: ["c1b", "c2b", "c3b"],
    nodes: [
      "p1", "c1", "c1.c1b.echo", "c1.c1b.why", "c1.c1b.converge.consequence", "c1.c1b.converge.bridge",
      "p2", "c2", "c2.c2b.echo", "c2.c2b.why", "c2.c2b.converge.consequence", "c2.c2b.converge.bridge",
      "p3", "c3", "c3.c3b.echo", "c3.c3b.why", "c3.c3b.converge.consequence", "c3.c3b.converge.bridge",
      "end.original",
    ],
  },
  "converge-why/섞기": {
    decisions: ["c1b", "c2a", "c3b"],
    nodes: [
      "p1", "c1", "c1.c1b.echo", "c1.c1b.why", "c1.c1b.converge.consequence", "c1.c1b.converge.bridge",
      "p2", "c2", "c2.c2a.echo", "c2.c2a.why", "c2.c2a.consequence",
      "p3", "c3", "c3.c3b.echo", "c3.c3b.why", "c3.c3b.converge.consequence", "c3.c3b.converge.bridge",
      "end.original",
    ],
  },
  "converge-nowhy/원작만": {
    decisions: ["c1a", "c2a", "c3a"],
    nodes: [
      "p1", "c1", "c1.c1a.echo", "c1.c1a.consequence",
      "p2", "c2", "c2.c2a.echo", "c2.c2a.consequence",
      "p3", "c3", "c3.c3a.echo", "c3.c3a.consequence",
      "end.original",
    ],
  },
  "converge-nowhy/다른만": {
    decisions: ["c1b", "c2c", "c3b"],
    nodes: [
      "p1", "c1", "c1.c1b.echo", "c1.c1b.converge.consequence", "c1.c1b.converge.bridge",
      "p2", "c2", "c2.c2c.echo", "c2.c2c.converge.consequence", "c2.c2c.converge.bridge",
      "p3", "c3", "c3.c3b.echo", "c3.c3b.converge.consequence", "c3.c3b.converge.bridge",
      "end.original",
    ],
  },
  "converge-nowhy/섞기": {
    decisions: ["c1b", "c2a", "c3b"],
    nodes: [
      "p1", "c1", "c1.c1b.echo", "c1.c1b.converge.consequence", "c1.c1b.converge.bridge",
      "p2", "c2", "c2.c2a.echo", "c2.c2a.consequence",
      "p3", "c3", "c3.c3b.echo", "c3.c3b.converge.consequence", "c3.c3b.converge.bridge",
      "end.original",
    ],
  },

  // ---- altEnding ----
  "altEnding-why/원작만": {
    decisions: ["c1a", "c2a", "c3a"],
    nodes: [
      "p1", "c1", "c1.c1a.echo", "c1.c1a.why", "c1.c1a.consequence",
      "p2", "c2", "c2.c2a.echo", "c2.c2a.why", "c2.c2a.consequence",
      "p3", "c3", "c3.c3a.echo", "c3.c3a.why", "c3.c3a.consequence",
      "end.original",
    ],
  },
  "altEnding-why/다른만": {
    decisions: ["c1b", "c2b", "c3b"],
    nodes: [
      "p1", "c1", "c1.c1b.echo", "c1.c1b.why", "c1.c1b.altEnding.consequence", "c1.c1b.altEnding.bridge",
      "p2", "c2", "c2.c2b.echo", "c2.c2b.why", "c2.c2b.altEnding.consequence", "c2.c2b.altEnding.bridge",
      "p3", "c3", "c3.c3b.echo", "c3.c3b.why", "c3.c3b.altEnding.consequence", "c3.c3b.altEnding.bridge",
      "end.alt",
    ],
  },
  "altEnding-why/섞기": {
    decisions: ["c1b", "c2a", "c3b"],
    nodes: [
      "p1", "c1", "c1.c1b.echo", "c1.c1b.why", "c1.c1b.altEnding.consequence", "c1.c1b.altEnding.bridge",
      "p2", "c2", "c2.c2a.echo", "c2.c2a.why", "c2.c2a.consequence",
      "p3", "c3", "c3.c3b.echo", "c3.c3b.why", "c3.c3b.altEnding.consequence", "c3.c3b.altEnding.bridge",
      "end.alt",
    ],
  },
  "altEnding-nowhy/원작만": {
    decisions: ["c1a", "c2a", "c3a"],
    nodes: [
      "p1", "c1", "c1.c1a.echo", "c1.c1a.consequence",
      "p2", "c2", "c2.c2a.echo", "c2.c2a.consequence",
      "p3", "c3", "c3.c3a.echo", "c3.c3a.consequence",
      "end.original",
    ],
  },
  "altEnding-nowhy/다른만": {
    decisions: ["c1b", "c2c", "c3b"],
    nodes: [
      "p1", "c1", "c1.c1b.echo", "c1.c1b.altEnding.consequence", "c1.c1b.altEnding.bridge",
      "p2", "c2", "c2.c2c.echo", "c2.c2c.altEnding.consequence", "c2.c2c.altEnding.bridge",
      "p3", "c3", "c3.c3b.echo", "c3.c3b.altEnding.consequence", "c3.c3b.altEnding.bridge",
      "end.alt",
    ],
  },
  "altEnding-nowhy/섞기": {
    decisions: ["c1a", "c2a", "c3b"],
    nodes: [
      "p1", "c1", "c1.c1a.echo", "c1.c1a.consequence",
      "p2", "c2", "c2.c2a.echo", "c2.c2a.consequence",
      "p3", "c3", "c3.c3b.echo", "c3.c3b.altEnding.consequence", "c3.c3b.altEnding.bridge",
      "end.alt",
    ],
  },
};

const COND_BY_SLUG: Record<string, Conditions> = {
  off: OFF,
  "rewind-why": C("rewind", true),
  "rewind-nowhy": C("rewind", false),
  "converge-why": C("converge", true),
  "converge-nowhy": C("converge", false),
  "altEnding-why": C("altEnding", true),
  "altEnding-nowhy": C("altEnding", false),
};

describe("경로 규칙 — 7조합 × {원작만, 다른 선택만, 섞기}", () => {
  for (const [key, exp] of Object.entries(EXPECTED)) {
    it(key, () => {
      const cond = COND_BY_SLUG[key.split("/")[0]!]!;
      const r = run(cond, exp.decisions);
      expect(storyNodes(r)).toEqual(exp.nodes);
      expect(r.nodes.slice(-4)).toEqual(COMP);
    });
  }
});

describe("이해 질문 목록", () => {
  it("모든 조합에서 같다", () => {
    const lists = VALID_CONDITIONS.map((c) => {
      const d = !c.branching ? [] : c.mismatch === "rewind" ? ["c1b", "c1b", "c2a", "c3a"] : ["c1b", "c2a", "c3a"];
      const r = run(c, d);
      return r.nodes.filter((n) => COMP.includes(n));
    });
    for (const l of lists) expect(l).toEqual(COMP);
  });
});

describe("altEnding 결말 선택(OQ-2)", () => {
  it("다른 선택 1회 → end.alt, 0회 → end.original", () => {
    expect(run(C("altEnding", false), ["c1a", "c2b", "c3a"]).nodes).toContain("end.alt");
    expect(run(C("altEnding", false), ["c1a", "c2a", "c3a"]).nodes).toContain("end.original");
  });
  it("converge는 다른 선택이 있어도 end.original", () => {
    expect(run(C("converge", false), ["c1b", "c2b", "c3b"]).nodes).toContain("end.original");
  });
});

describe("converge·altEnding 낭독 내용", () => {
  const origC1 = story.choicePoints[0]!.options[0]!.consequence!.join(" ");
  for (const kind of ["converge", "altEnding"] as const) {
    it(`${kind}: 다른 선택이면 원작 consequence 미낭독, bridge 낭독`, () => {
      const r = run(C(kind, true), ["c1b", "c2a", "c3a"]);
      const texts = r.speaks.map((s) => s.text);
      expect(texts).not.toContain(origC1);
      const m = story.choicePoints[0]!.options[1]!.mismatch![kind];
      expect(texts).toContain(m.bridge.join(" "));
      expect(texts).toContain(m.consequence.join(" "));
    });
  }
});

describe("rewind [다른, 다른, 강제]", () => {
  const r = run(C("rewind", true), ["c1b", "c1b", "c2a", "c3a"]);
  const m = story.choicePoints[0]!.options[1]!.mismatch!.rewind;
  const textOf = (node: string) => {
    const i = r.speaks.findIndex((s) => s.utteranceId.startsWith(`${node}:`));
    return r.speaks[i]?.text;
  };
  it("1회째 contrast 끝에 재선택 안내", () => {
    const t = textOf("c1.c1b.rewind.contrast#1")!;
    expect(t.startsWith(m.contrast)).toBe(true);
    expect(t.endsWith(STRINGS.chooseAgain)).toBe(true);
  });
  it("2회째 contrastFinal에는 재선택 안내 없음", () => {
    const t = textOf("c1.c1b.rewind.contrastFinal#2")!;
    expect(t).toBe(m.contrastFinal);
    expect(t).not.toContain(STRINGS.chooseAgain);
  });
  it("3회째는 질문·why 없이 원작 consequence#3 + forced_original(attempt=3)", () => {
    expect(r.nodes).not.toContain("c1#3");
    expect(r.nodes.some((n) => n.startsWith("c1.") && n.includes(".why#3"))).toBe(false);
    const f = r.logs.filter((e) => e.event_type === "forced_original");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      screen: "consequence",
      node_id: "c1.c1a.consequence#3",
      choice_point_id: "c1",
      option_id: "c1a",
      matches_original: true,
      attempt: 3,
    });
    expect(f[0]!.rt_ms).toBeUndefined();
    expect(textOf("c1.c1a.consequence#3")).toBe(story.choicePoints[0]!.options[0]!.consequence!.join(" "));
  });
  it("choice_confirm 행은 attempt 1·2만, why_answer도 attempt 1·2", () => {
    const cc = r.logs.filter((e) => e.event_type === "choice_confirm" && e.choice_point_id === "c1");
    expect(cc.map((e) => e.attempt)).toEqual([1, 2]);
    const wa = r.logs.filter((e) => e.event_type === "why_answer" && e.choice_point_id === "c1");
    expect(wa.map((e) => e.attempt)).toEqual([1, 2]);
    expect(wa[0]).toMatchObject({ question_id: "c1b-why", question_type: "why", option_id: "c1b-w1", reason_type: "other" });
  });
});

/** 첫 본문(p1)을 끝내고 c1 선택 화면에 들어간 상태 */
function toChoice(cond: Conditions, settings: EngineSettings = AUTO) {
  let r = init(story, cond, settings, 0);
  const sp = r.effects.find((e) => e.type === "speak") as Extract<Effect, { type: "speak" }> | undefined;
  if (sp) r = step(r.state, { type: "ttsDone", utteranceId: sp.utteranceId, outcome: "ended", at: 50 });
  return step(r.state, { type: "next", at: 100 });
}

describe("rewind 재제시", () => {
  it("screen_enter(attempt=2)·프롬프트 재낭독·replay_count 초기화", () => {
    let r = toChoice(C("rewind", false));
    r = step(r.state, { type: "replay", at: 110 });
    r = step(r.state, { type: "replay", at: 120 });
    r = step(r.state, { type: "confirm", optionId: "c1b", at: 130 });
    const c1 = r.effects.find((e) => e.type === "log" && e.event.event_type === "choice_confirm") as Extract<Effect, { type: "log" }>;
    expect(c1.event.replay_count).toBe(2);
    // echo → rewind.consequence → contrast 를 '다음'으로 넘긴다
    let t = 200;
    while (currentView(r.state).screen !== "choice") {
      const sp = r.effects.filter((e) => e.type === "speak") as Extract<Effect, { type: "speak" }>[];
      for (const s of sp) r = step(r.state, { type: "ttsDone", utteranceId: s.utteranceId, outcome: "ended", at: (t += 10) });
      r = step(r.state, { type: "next", at: (t += 10) });
    }
    const enter = r.effects.find((e) => e.type === "log" && e.event.event_type === "screen_enter") as Extract<Effect, { type: "log" }>;
    expect(enter.event).toMatchObject({ screen: "choice", node_id: "c1#2", attempt: 2, choice_point_id: "c1" });
    const sp = r.effects.filter((e) => e.type === "speak") as Extract<Effect, { type: "speak" }>[];
    expect(sp).toHaveLength(1);
    expect(sp[0]).toMatchObject({ kind: "prompt", text: story.choicePoints[0]!.prompt });
    const v = currentView(r.state);
    expect(v).toMatchObject({ screen: "choice", nodeId: "c1#2", attempt: 2, selectedOptionId: null });
    r = step(r.state, { type: "confirm", optionId: "c1a", at: (t += 10) });
    const c2 = r.effects.find((e) => e.type === "log" && e.event.event_type === "choice_confirm") as Extract<Effect, { type: "log" }>;
    expect(c2.event).toMatchObject({ replay_count: 0, attempt: 2, node_id: "c1#2" });
  });
});

describe("화면 진행 규칙", () => {
  it("본문: ttsDone 전 next는 무시, 후에는 진행", () => {
    const r0 = init(story, C("converge", true), AUTO, 0);
    expect(currentView(r0.state)).toMatchObject({ screen: "passage", nodeId: "p1", nextVisible: false });
    const ignored = step(r0.state, { type: "next", at: 10 });
    expect(ignored.state).toBe(r0.state);
    expect(ignored.effects).toEqual([]);
    const sp = r0.effects.find((e) => e.type === "speak") as Extract<Effect, { type: "speak" }>;
    const r1 = step(r0.state, { type: "ttsDone", utteranceId: sp.utteranceId, outcome: "error", at: 20 });
    expect(currentView(r1.state)).toMatchObject({ nextVisible: true });
    const r2 = step(r1.state, { type: "next", at: 30 });
    expect(currentView(r2.state)).toMatchObject({ screen: "choice", nodeId: "c1" });
  });

  it("실험자 낭독 모드: speak 없이 진입 즉시 '다음' 표시·진행", () => {
    const s: EngineSettings = { manualReading: true, confirmMode: "double" };
    const r0 = init(story, OFF, s, 0);
    expect(r0.effects.some((e) => e.type === "speak")).toBe(false);
    expect(currentView(r0.state)).toMatchObject({ nextVisible: true });
    const r1 = step(r0.state, { type: "next", at: 5 });
    expect(currentView(r1.state)).toMatchObject({ screen: "echo", nodeId: "c1.c1a.offNarration", nextVisible: true });
    const full = run(C("rewind", true), ["c1b", "c1b", "c2a", "c3a"], s);
    expect(full.speaks).toHaveLength(0);
    expect(isFinished(full.state)).toBe(true);
  });

  it("선택 화면 진입 시 speak는 prompt 1개(보기 자동 낭독 없음)", () => {
    for (const c of VALID_CONDITIONS.filter((x) => x.branching)) {
      const r = toChoice(c);
      const sp = r.effects.filter((e) => e.type === "speak") as Extract<Effect, { type: "speak" }>[];
      expect(sp).toHaveLength(1);
      expect(sp[0]!.kind).toBe("prompt");
    }
  });

  it("why·이해 질문 화면 진입 시에도 prompt 1개", () => {
    let r = toChoice(C("converge", true));
    r = step(r.state, { type: "confirm", optionId: "c1a", at: 200 });
    const sp = r.effects.find((e) => e.type === "speak") as Extract<Effect, { type: "speak" }>;
    r = step(r.state, { type: "ttsDone", utteranceId: sp.utteranceId, outcome: "ended", at: 210 });
    r = step(r.state, { type: "next", at: 220 });
    expect(currentView(r.state)).toMatchObject({ screen: "why", nodeId: "c1.c1a.why", prompt: STRINGS.whyPrompt });
    const wsp = r.effects.filter((e) => e.type === "speak") as Extract<Effect, { type: "speak" }>[];
    expect(wsp.map((x) => [x.kind, x.text])).toEqual([["prompt", STRINGS.whyPrompt]]);
  });

  it("보기 탭은 그 보기만 낭독(option_listen), 같은 보기 재탭이면 확정", () => {
    let r = toChoice(C("converge", false));
    r = step(r.state, { type: "listen", optionId: "c1b", at: 200 });
    const sp = r.effects.filter((e) => e.type === "speak") as Extract<Effect, { type: "speak" }>[];
    expect(sp.map((x) => [x.kind, x.text])).toEqual([["option", "혼자 다 먹는다"]]);
    expect(r.effects.some((e) => e.type === "cancelSpeech")).toBe(true);
    expect(r.effects.some((e) => e.type === "log" && e.event.event_type === "option_listen" && e.event.option_id === "c1b")).toBe(true);
    expect(currentView(r.state)).toMatchObject({ selectedOptionId: "c1b" });
    r = step(r.state, { type: "listen", optionId: "c1b", at: 300 });
    expect(r.effects.some((e) => e.type === "log" && e.event.event_type === "choice_confirm" && e.event.option_id === "c1b")).toBe(true);
    expect(currentView(r.state)).toMatchObject({ screen: "echo", nodeId: "c1.c1b.echo" });
  });

  it("confirmMode single: 첫 탭이 확정", () => {
    let r = toChoice(C("converge", false), { manualReading: false, confirmMode: "single" });
    r = step(r.state, { type: "listen", optionId: "c1a", at: 200 });
    expect(currentView(r.state)).toMatchObject({ screen: "echo", nodeId: "c1.c1a.echo" });
  });

  it("모든 본문 화면에서 next_click, 선택 지점 하위 본문은 choice_point_id 채움", () => {
    for (const c of VALID_CONDITIONS) {
      const d = !c.branching ? [] : c.mismatch === "rewind" ? ["c1b", "c1b", "c2b", "c2a", "c3a"] : ["c1b", "c2a", "c3b"];
      const r = run(c, d);
      const bodyScreens = ["passage", "echo", "consequence", "contrast", "bridge", "ending"];
      const enters = r.logs.filter((e) => e.event_type === "screen_enter" && bodyScreens.includes(e.screen!));
      const clicks = r.logs.filter((e) => e.event_type === "next_click");
      expect(clicks.map((e) => e.node_id)).toEqual(enters.map((e) => e.node_id));
      for (const e of clicks) {
        if (/^c\d\./.test(e.node_id!)) expect(e.choice_point_id).toBe(e.node_id!.split(".")[0]);
        else expect(e.choice_point_id).toBeUndefined();
        expect(e.rt_ms).toBeUndefined();
      }
    }
  });

  it("이해 질문: 확정 → comprehension_answer → 피드백 낭독 → ttsDone 뒤 next → 다음 질문, 마지막 뒤 parent_handoff", () => {
    const r = run(C("converge", false), ["c1a", "c2a", "c3a"]);
    const ans = r.logs.filter((e) => e.event_type === "comprehension_answer");
    expect(ans.map((e) => e.question_id)).toEqual(COMP);
    expect(ans.every((e) => e.correct === true && typeof e.rt_ms === "number" && e.rt_basis)).toBe(true);
    expect(ans.map((e) => e.question_type)).toEqual(["explicit", "inference", "sequence", "explicit"]);
    const fb = r.speaks.filter((s) => s.utteranceId.startsWith("q1:"));
    expect(fb.map((s) => [s.kind, s.text])).toEqual([
      ["prompt", story.comprehension[0]!.prompt],
      ["passage", story.comprehension[0]!.feedback.correct],
    ]);
    expect(isFinished(r.state)).toBe(true);
    expect(currentView(r.state)).toEqual({ screen: "parent_handoff" });
    expect(r.logs.some((e) => e.event_type === "session_end")).toBe(false);
  });

  it("이해 질문 피드백 낭독 전 next는 무시, 오답이면 incorrect 피드백", () => {
    let r = init(story, OFF, AUTO, 0);
    let t = 0;
    while (currentView(r.state).screen !== "comprehension") {
      for (const e of r.effects) if (e.type === "speak") r = step(r.state, { type: "ttsDone", utteranceId: e.utteranceId, outcome: "ended", at: (t += 1) });
      r = step(r.state, { type: "next", at: (t += 1) });
    }
    r = step(r.state, { type: "answerQuestion", optionId: "q1b", at: (t += 1) });
    expect(currentView(r.state)).toMatchObject({ feedback: story.comprehension[0]!.feedback.incorrect, nextVisible: false, selectedOptionId: "q1b" });
    const log = r.effects.find((e) => e.type === "log" && e.event.event_type === "comprehension_answer") as Extract<Effect, { type: "log" }>;
    expect(log.event.correct).toBe(false);
    const ignored = step(r.state, { type: "next", at: (t += 1) });
    expect(ignored.effects).toEqual([]);
    const again = step(r.state, { type: "answerQuestion", optionId: "q1a", at: (t += 1) });
    expect(again.effects).toEqual([]);
    const fb = r.effects.find((e) => e.type === "speak") as Extract<Effect, { type: "speak" }>;
    r = step(r.state, { type: "ttsDone", utteranceId: fb.utteranceId, outcome: "cancelled", at: (t += 1) });
    r = step(r.state, { type: "next", at: (t += 1) });
    expect(currentView(r.state)).toMatchObject({ screen: "comprehension", nodeId: "q2" });
  });

  it("분기 off: offNarration은 screen=echo, choice_point_id 채움, 선택 화면 없음", () => {
    const r = run(OFF, []);
    const e = r.logs.find((x) => x.event_type === "screen_enter" && x.node_id === "c1.c1a.offNarration")!;
    expect(e).toMatchObject({ screen: "echo", choice_point_id: "c1" });
    expect(e.attempt).toBeUndefined();
    expect(r.logs.some((x) => x.screen === "choice" || x.event_type === "choice_confirm")).toBe(false);
    expect(r.speaks.map((s) => s.text)).toContain(story.choicePoints[0]!.options[0]!.offNarration);
  });

  it("utteranceId는 결정적이고 tts_start/tts_end가 짝지어 기록된다", () => {
    const a = run(C("rewind", true), ["c1b", "c1a", "c2a", "c3a"]);
    const b = run(C("rewind", true), ["c1b", "c1a", "c2a", "c3a"]);
    expect(a.speaks.map((s) => s.utteranceId)).toEqual(b.speaks.map((s) => s.utteranceId));
    expect(a.speaks[0]!.utteranceId).toMatch(/^p1:passage:\d+$/);
    expect(a.logs.filter((e) => e.event_type === "tts_start")).toHaveLength(a.speaks.length);
    expect(a.logs.filter((e) => e.event_type === "tts_end")).toHaveLength(a.speaks.length);
  });

  it("EngineState는 JSON 왕복 후에도 같은 결과", () => {
    const r = toChoice(C("rewind", true));
    const copy = JSON.parse(JSON.stringify(r.state)) as EngineState;
    expect(copy).toEqual(r.state);
    const x = step(r.state, { type: "confirm", optionId: "c1b", at: 500 });
    const y = step(copy, { type: "confirm", optionId: "c1b", at: 500 });
    expect(y.effects).toEqual(x.effects);
  });

  it("parent_handoff 뒤 action은 무시", () => {
    const r = run(OFF, []);
    const n = step(r.state, { type: "next", at: 1e6 });
    expect(n.effects).toEqual([]);
    expect(n.state).toBe(r.state);
  });
});

describe("대체된 발화의 ttsDone(실제 tts처럼 cancel·speak가 이전 발화를 동기로 cancelled 처리)", () => {
  /** 가짜 TTS: speak는 끝나지 않고 대기, cancelSpeech·새 speak는 진행 중 발화에 done(cancelled)을 즉시 낸다 */
  function realisticTts(r0: ReturnType<typeof init>) {
    let t = 0;
    let state = r0.state;
    let active: string | null = null;
    const logs: EngineLogEvent[] = [];
    const absorb = (fx: Effect[]) => {
      const q = [...fx];
      while (q.length) {
        const e = q.shift()!;
        if (e.type === "log") logs.push(e.event);
        const closePrev = () => {
          if (active === null) return;
          const id = active;
          active = null;
          const d = step(state, { type: "ttsDone", utteranceId: id, outcome: "cancelled", at: (t += 1) });
          state = d.state;
          q.unshift(...d.effects);
        };
        if (e.type === "cancelSpeech") closePrev();
        if (e.type === "speak") {
          closePrev();
          active = e.utteranceId;
        }
      }
    };
    absorb(r0.effects);
    return {
      get state() {
        return state;
      },
      get active() {
        return active;
      },
      logs,
      act(a: Omit<Action, "at"> & Record<string, unknown>) {
        const r = step(state, { ...a, at: (t += 10) } as Action);
        state = r.state;
        absorb(r.effects);
      },
      end() {
        const id = active!;
        active = null;
        const r = step(state, { type: "ttsDone", utteranceId: id, outcome: "ended", at: (t += 10) });
        state = r.state;
        absorb(r.effects);
      },
    };
  }

  it("본문 화면에서 replay → 이전 utterance cancelled 도착 → nextVisible false 유지 → 새 utterance ended → true", () => {
    const x = realisticTts(init(story, OFF, AUTO, 0));
    const first = x.active!;
    expect(currentView(x.state)).toMatchObject({ screen: "passage", nextVisible: false });
    x.act({ type: "replay" });
    const second = x.active!;
    expect(second).not.toBe(first);
    // 이전 발화의 cancelled는 로그(tts_end)만 남는다
    expect(x.logs.some((e) => e.event_type === "tts_end" && (e.detail as { utterance_id: string }).utterance_id === first)).toBe(true);
    expect(currentView(x.state)).toMatchObject({ nextVisible: false });
    x.act({ type: "next" });
    expect(currentView(x.state)).toMatchObject({ screen: "passage", nextVisible: false });
    x.end();
    expect(currentView(x.state)).toMatchObject({ screen: "passage", nextVisible: true });
  });

  it("이해 질문 피드백 재낭독도 같다", () => {
    const x = realisticTts(init(story, OFF, AUTO, 0));
    for (let g = 0; currentView(x.state).screen !== "comprehension" && g < 100; g++) {
      x.end();
      x.act({ type: "next" });
    }
    expect(currentView(x.state)).toMatchObject({ screen: "comprehension", feedback: null });
    x.act({ type: "answerQuestion", optionId: story.comprehension[0]!.answer });
    expect(currentView(x.state)).toMatchObject({ nextVisible: false });
    const fb1 = x.active!;
    x.act({ type: "replay" });
    expect(x.active).not.toBe(fb1);
    expect(currentView(x.state)).toMatchObject({ nextVisible: false });
    x.end();
    expect(currentView(x.state)).toMatchObject({ nextVisible: true });
  });

  it("선택 화면: 대체된 prompt의 늦은 ended는 반응시간 기준점을 세우지 않는다", () => {
    let r = init(story, C("converge", false), AUTO, 0);
    const sp = (fx: Effect[]) => fx.filter((e): e is Extract<Effect, { type: "speak" }> => e.type === "speak");
    r = step(r.state, { type: "ttsDone", utteranceId: sp(r.effects)[0]!.utteranceId, outcome: "ended", at: 100 });
    r = step(r.state, { type: "next", at: 200 });
    const promptId = sp(r.effects)[0]!.utteranceId;
    r = step(r.state, { type: "listen", optionId: "c1b", at: 300 });
    r = step(r.state, { type: "ttsDone", utteranceId: promptId, outcome: "ended", at: 400 }); // 대체된 발화
    r = step(r.state, { type: "confirm", optionId: "c1b", at: 1200 });
    const e = r.effects.find((x) => x.type === "log" && x.event.event_type === "choice_confirm") as Extract<Effect, { type: "log" }>;
    expect(e.event).toMatchObject({ rt_ms: 1000, rt_basis: "shown" });
  });
});
