import fixture from "./fixtures/mini.json";
import { currentView, init, isFinished, step, type EngineState } from "../src/story/engine";
import type { Action, AskBlock, Conditions, Effect, EngineSettings, Story } from "../src/story/types";
import type { EngineLogEvent } from "../src/log/types";
import type { RunnerAction } from "../src/ui/runner";   // DistributiveOmit<Action, "at"> — 유니언을 뭉개지 않음

export const ASK_C1: AskBlock = {
  voice: true, maxAsks: 2, intro: "다람쥐한테 물어볼까?", sceneLabel: "도토리를 주운 장면",
  characters: [
    { id: "tori", name: "토리", questions: [
      { id: "q1", text: "도토리 몇 개야?", keywords: ["몇 개", "몇개"], answer: ["세 개야."], clue: "tori_q1" },
      { id: "q2", text: "배고파?", keywords: ["배고"], answer: ["조금 고파."] },
    ], unmatched: "응? 다시 말해 줄래?", unmatchedFinal: "여기서 골라 줄래?" },
    { id: "bird", name: "새", questions: [
      { id: "q1", text: "어디 살아?", keywords: ["어디", "살아"], answer: ["저 나무 위에 살아.", "둥지가 있어."] },
      { id: "q2", text: "도토리 좋아해?", keywords: ["좋아"], answer: ["응, 좋아해."] },
    ], unmatched: "짹? 다시 말해 줄래?", unmatchedFinal: "짹, 여기서 골라 줄래?" },
  ],
};
const base = fixture as unknown as Story;
export const storyAsk: Story = { ...base, choicePoints: base.choicePoints.map((cp) => (cp.id === "c1" ? { ...cp, ask: ASK_C1 } : cp)) };
export const withMaxAsks = (n: number): Story => ({ ...base, choicePoints: base.choicePoints.map((cp) => (cp.id === "c1" ? { ...cp, ask: { ...ASK_C1, maxAsks: n } } : cp)) });
export const ASK_ON: EngineSettings = { manualReading: false, confirmMode: "double", askLayer: true, voiceAsk: true };
export const CONV: Conditions = { branching: true, mismatch: "converge", askWhy: false };

export interface Sim { state: EngineState; logs: EngineLogEvent[]; speaks: Extract<Effect, { type: "speak" }>[]; t: number }
/** effects를 흡수하되 ttsDone은 자동으로 넣지 않는다(음성 테스트가 낭독 중 상태를 다뤄야 함) */
export function absorb(sim: Sim, fx: Effect[]): void { for (const e of fx) { if (e.type === "log") sim.logs.push(e.event); if (e.type === "speak") sim.speaks.push(e); } }
export function act(sim: Sim, a: RunnerAction): Effect[] { const r = step(sim.state, { ...a, at: (sim.t += 100) } as Action); sim.state = r.state; absorb(sim, r.effects); return r.effects; }
/** 마지막 speak를 ended로 끝낸다 */
export function endSpeech(sim: Sim): void { const s = sim.speaks[sim.speaks.length - 1]; if (s) act(sim, { type: "ttsDone", utteranceId: s.utteranceId, outcome: "ended" }); }
/** p1 두 페이지를 읽고 넘겨 c1 직전까지 */
export function toC1(story: Story = storyAsk, conditions: Conditions = CONV, settings: EngineSettings = ASK_ON): Sim {
  const r = init(story, conditions, settings, 0);
  const sim: Sim = { state: r.state, logs: [], speaks: [], t: 0 };
  absorb(sim, r.effects);
  for (let i = 0; i < 2; i++) { endSpeech(sim); act(sim, { type: "next" }); }
  return sim;
}
export const view = (sim: Sim) => currentView(sim.state);
export const nodes = (sim: Sim) => sim.logs.filter((e) => e.event_type === "screen_enter" && e.node_id).map((e) => e.node_id!);
export { isFinished };
