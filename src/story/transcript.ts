/**
 * 대본 생성기(순수) — 계획 4 단계 1.
 * 엔진을 스텁 TTS(모든 speak에 즉시 ttsDone ended)로 돌려 경로별 낭독 전문과 분량을 낸다.
 * why 보기는 첫 보기로 고정, 이해 질문은 정답을 고른다.
 */
import type { Conditions, Screen, SpeakKind, Story } from "./types";
import { currentView, init, isFinished, step, type EngineState } from "./engine";
import type { Effect } from "./types";

/** 분당 낭독 글자 수(공백 제외, rate 0.9 가정 초기값) */
export const CHARS_PER_MINUTE = 270;

export interface PathSpec {
  /** 사람이 읽는 라벨. 예: "c1 원작(c1a) / c2 다른(c2b)→원작(c2a) / c3 다른(c3b)→다른(c3b)→강제" */
  label: string;
  /** 선택 지점(척추 순서)별 확정 보기 id 순서 */
  choicesPerPoint: string[][];
}

export interface TranscriptLine {
  nodeId: string;
  screen: Screen;
  kind: SpeakKind;
  text: string;
}

export interface Transcript {
  conditions: Conditions;
  choicesPerPoint: string[][];
  /** 진입한 화면 node_id 순서(parent_handoff 제외) */
  nodeIds: string[];
  /** 전체 낭독(이해 질문 포함) */
  lines: TranscriptLine[];
  /** 이야기 부분(이해 질문 화면 제외) */
  storyLines: TranscriptLine[];
  storyChars: number;
  totalChars: number;
  storyMinutes: number;
  totalMinutes: number;
}

export const countChars = (text: string): number => text.replace(/\s/g, "").length;

function choicePointsInOrder(story: Story) {
  return story.spine
    .filter((n) => n.type === "choice")
    .map((n) => {
      const cp = story.choicePoints.find((c) => c.id === n.id);
      if (!cp) throw new Error(`choice point 없음: ${n.id}`);
      return cp;
    });
}

/** 선택 지점별 시도 열 후보 */
function perPointSequences(cp: Story["choicePoints"][number], conditions: Conditions): string[][] {
  const orig = cp.options.find((o) => o.matchesOriginal);
  if (!orig) throw new Error(`원작 선택지 없음: ${cp.id}`);
  const others = cp.options.filter((o) => !o.matchesOriginal).map((o) => o.id);
  if (!conditions.branching) return [[]];
  if (conditions.mismatch !== "rewind") return [orig.id, ...others].map((id) => [id]);
  const seqs: string[][] = [[orig.id]];
  for (const d of others) seqs.push([d, orig.id]);
  for (const d1 of others) for (const d2 of others) seqs.push([d1, d2]);
  return seqs;
}

export function pathLabel(story: Story, conditions: Conditions, choicesPerPoint: string[][]): string {
  if (!conditions.branching) return "선택 없음(원작 서술)";
  const cps = choicePointsInOrder(story);
  return cps
    .map((cp, i) => {
      const seq = choicesPerPoint[i] ?? [];
      const parts = seq.map((id) => {
        const o = cp.options.find((x) => x.id === id);
        return `${o?.matchesOriginal ? "원작" : "다른"}(${id})`;
      });
      const forced = conditions.mismatch === "rewind" && seq.length >= 2 && seq.every((id) => !cp.options.find((x) => x.id === id)?.matchesOriginal);
      if (forced) parts.push("강제");
      return `${cp.id} ${parts.join("→")}`;
    })
    .join(" / ");
}

/** 조건의 모든 선택 경우. 경로 수: off=1, converge·altEnding=Πk_i, rewind=Π(1+(k_i−1)+(k_i−1)²) */
export function enumeratePaths(story: Story, conditions: Conditions): PathSpec[] {
  const per = choicePointsInOrder(story).map((cp) => perPointSequences(cp, conditions));
  let combos: string[][][] = [[]];
  for (const seqs of per) combos = combos.flatMap((c) => seqs.map((s) => [...c, s]));
  return combos.map((choicesPerPoint) => ({ label: pathLabel(story, conditions, choicesPerPoint), choicesPerPoint }));
}

export function renderTranscript(story: Story, conditions: Conditions, choicesPerPoint: string[][]): Transcript {
  const decisions = choicesPerPoint.flat();
  let di = 0;
  const lines: TranscriptLine[] = [];
  const nodeIds: string[] = [];
  let t = 0;

  let r = init(story, conditions, { manualReading: false, confirmMode: "double", askLayer: false, voiceAsk: false }, t);
  let state: EngineState = r.state;

  const absorb = (effects: Effect[]) => {
    const queue = [...effects];
    while (queue.length) {
      const e = queue.shift()!;
      if (e.type === "log" && e.event.event_type === "screen_enter" && e.event.node_id) nodeIds.push(e.event.node_id);
      if (e.type === "speak") {
        const v = currentView(state);
        lines.push({ nodeId: "nodeId" in v ? v.nodeId : "", screen: v.screen, kind: e.kind, text: e.text });
        const d = step(state, { type: "ttsDone", utteranceId: e.utteranceId, outcome: "ended", at: ++t });
        state = d.state;
        queue.push(...d.effects);
      }
    }
  };
  absorb(r.effects);

  for (let guard = 0; !isFinished(state); guard++) {
    if (guard > 10000) throw new Error("대본 생성 무한 루프");
    const v = currentView(state);
    t += 1;
    if (v.screen === "choice") {
      const id = decisions[di++];
      if (id === undefined) throw new Error(`선택 열이 모자람: ${v.nodeId}`);
      r = step(state, { type: "confirm", optionId: id, at: t });
    } else if (v.screen === "why") {
      r = step(state, { type: "answerWhy", optionId: v.options[0]!.id, at: t });
    } else if (v.screen === "comprehension") {
      if (v.feedback === null) {
        const q = story.comprehension.find((x) => x.id === v.questionId)!;
        r = step(state, { type: "answerQuestion", optionId: q.answer, at: t });
      } else {
        r = step(state, { type: "next", at: t });
      }
    } else if (v.screen === "parent_handoff") {
      break;
    } else {
      r = step(state, { type: "next", at: t });
    }
    if (r.state === state && r.effects.length === 0) throw new Error(`진행 불가: ${v.nodeId}`);
    state = r.state;
    absorb(r.effects);
  }
  if (di !== decisions.length) throw new Error(`선택 열이 남음: ${di}/${decisions.length}`);

  const storyLines = lines.filter((l) => l.screen !== "comprehension");
  const storyChars = storyLines.reduce((a, l) => a + countChars(l.text), 0);
  const totalChars = lines.reduce((a, l) => a + countChars(l.text), 0);
  return {
    conditions,
    choicesPerPoint,
    nodeIds,
    lines,
    storyLines,
    storyChars,
    totalChars,
    storyMinutes: storyChars / CHARS_PER_MINUTE,
    totalMinutes: totalChars / CHARS_PER_MINUTE,
  };
}
