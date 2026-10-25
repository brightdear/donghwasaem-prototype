/**
 * 이야기 진행 리듀서 — 계획 3.2(경로 규칙·화면 진행 규칙·하위 노드 id·rewind 재제시), 3.3(반응시간).
 * 순수 함수. EngineState는 JSON 직렬화 가능. 공통 로그 열과 session_end는 runner가 맡는다.
 */
import type {
  Action,
  AskBlock,
  AskQuestion,
  BodyScreen,
  ChoiceOption,
  ChoicePoint,
  ComprehensionQuestion,
  Conditions,
  Effect,
  EngineSettings,
  Screen,
  SpeakKind,
  StepResult,
  Story,
  View,
} from "./types";
import type { EngineLogEvent } from "../log/types";
import { STRINGS } from "../ui/strings";
import { computeRt, updateBasis, type RtBasisPoint } from "../log/rt";

type Role = "body" | "prompt" | "replay_prompt" | "option" | "feedback";

interface LiveUtterance {
  kind: SpeakKind;
  role: Role;
  screenSeq: number;
  screen: Screen;
  nodeId: string;
  cpId: string | null;
}

interface BodyCur {
  t: "body";
  seq: number;
  screen: BodyScreen;
  nodeId: string;
  cpId: string | null;
  /** 문단 1개 = 화면 1페이지 */
  paragraphs: string[];
  /** 현재 페이지(0부터) */
  page: number;
  attempt: number | null;
  nextVisible: boolean;
  replayCount: number;
  enteredAt: number;
}
interface InteractiveBase {
  seq: number;
  nodeId: string;
  enteredAt: number;
  basis: RtBasisPoint | null;
  replayCount: number;
  selected: string | null;
}
interface ChoiceCur extends InteractiveBase {
  t: "choice";
  cpId: string;
  attempt: number;
}
interface WhyCur extends InteractiveBase {
  t: "why";
  cpId: string;
  optionId: string;
  attempt: number;
}
interface CompCur extends InteractiveBase {
  t: "comprehension";
  qIndex: number;
  feedback: string | null;
  nextVisible: boolean;
}
interface AskCur extends InteractiveBase {
  t: "ask";
  cpId: string;
  selectedCharacterId: string | null;
  listening: boolean;
}
interface HandoffCur {
  t: "parent_handoff";
  seq: number;
}
type Cur = BodyCur | ChoiceCur | WhyCur | CompCur | AskCur | HandoffCur;

type Pending =
  | {
      t: "body";
      screen: BodyScreen;
      nodeId: string;
      cpId: string | null;
      paragraphs: string[];
      attempt: number | null;
      forcedOptionId?: string;
    }
  | { t: "why"; cpId: string; optionId: string; attempt: number; nodeId: string }
  | { t: "choice"; cpId: string; attempt: number }
  | { t: "ask"; cpId: string };

export interface EngineState {
  story: Story;
  conditions: Conditions;
  settings: EngineSettings;
  spineIndex: number;
  queue: Pending[];
  cur: Cur;
  screenSeq: number;
  uttSeq: number;
  live: Record<string, LiveUtterance>;
  /** 마지막으로 발급한 utteranceId. 화면 상태(nextVisible·반응시간 기준점)는 이 발화의 ttsDone만 바꾼다 */
  lastUtt: string | null;
  mismatchCount: number;
  /** 묻기 층: cpId → 이미 한 질문(`${characterId}.${questionId}`). 첫 진입 시 []로 생성 */
  asked: Record<string, string[]>;
  /** 묻기 층: cpId → 음성 실패 횟수(Task 6) */
  voiceFails: Record<string, number>;
}

interface Ctx {
  s: EngineState;
  fx: Effect[];
}

// ---------- 조회 ----------

function cpById(story: Story, id: string): ChoicePoint {
  const cp = story.choicePoints.find((c) => c.id === id);
  if (!cp) throw new Error(`choice point 없음: ${id}`);
  return cp;
}
function originalOf(cp: ChoicePoint): ChoiceOption {
  const o = cp.options.find((x) => x.matchesOriginal);
  if (!o) throw new Error(`원작 선택지 없음: ${cp.id}`);
  return o;
}
function question(s: EngineState, i: number): ComprehensionQuestion {
  const q = s.story.comprehension[i];
  if (!q) throw new Error(`이해 질문 없음: ${i}`);
  return q;
}
function askOf(s: EngineState, cpId: string): AskBlock {
  const ask = cpById(s.story, cpId).ask;
  if (!ask) throw new Error(`묻기 블록 없음: ${cpId}`);
  return ask;
}
const introOf = (ask: AskBlock): string => ask.intro ?? STRINGS.askIntroDefault;
/** `${characterId}.${questionId}` → 질문 (없으면 null) */
function askQuestion(ask: AskBlock, key: string): { characterId: string; q: AskQuestion } | null {
  const dot = key.indexOf(".");
  if (dot < 0) return null;
  const characterId = key.slice(0, dot);
  const qid = key.slice(dot + 1);
  const q = ask.characters.find((c) => c.id === characterId)?.questions.find((x) => x.id === qid);
  return q ? { characterId, q } : null;
}
/** 마이크 상태: 설정·콘텐츠가 꺼져 있거나 두 번 실패하면 숨김 */
function currentViewVoice(s: EngineState, cur: AskCur): "hidden" | "idle" | "listening" {
  if (!s.settings.voiceAsk || !askOf(s, cur.cpId).voice || (s.voiceFails[cur.cpId] ?? 0) >= 2) return "hidden";
  return cur.listening ? "listening" : "idle";
}
function asksLeft(s: EngineState, cpId: string): number {
  return (askOf(s, cpId).maxAsks ?? 2) - (s.asked[cpId]?.length ?? 0);
}
const isRewind = (s: EngineState) => s.conditions.branching && s.conditions.mismatch === "rewind";

function screenOf(cur: Cur): Screen {
  return cur.t === "body" ? cur.screen : cur.t;
}
function nodeIdOf(cur: Cur): string | undefined {
  return cur.t === "parent_handoff" ? undefined : cur.nodeId;
}
function cpIdOf(cur: Cur): string | null {
  if (cur.t === "body") return cur.cpId;
  if (cur.t === "choice" || cur.t === "why" || cur.t === "ask") return cur.cpId;
  return null;
}

// ---------- effect 헬퍼 ----------

function log(ctx: Ctx, ev: EngineLogEvent): void {
  ctx.fx.push({ type: "log", event: ev });
}
function render(ctx: Ctx): void {
  ctx.fx.push({ type: "render", view: currentView(ctx.s) });
}

/** 현재 화면 맥락 열(screen, node_id, choice_point_id, question_id/type) */
function ctxCols(cur: Cur, s: EngineState): Partial<EngineLogEvent> {
  const ev: Partial<EngineLogEvent> = { screen: screenOf(cur) };
  const nodeId = nodeIdOf(cur);
  if (nodeId !== undefined) ev.node_id = nodeId;
  const cp = cpIdOf(cur);
  if (cp) ev.choice_point_id = cp;
  if (cur.t === "why") {
    ev.question_id = `${cur.optionId}-why`;
    ev.question_type = "why";
  } else if (cur.t === "comprehension") {
    const q = question(s, cur.qIndex);
    ev.question_id = q.id;
    ev.question_type = q.type;
  }
  if ((cur.t === "body" && cur.attempt !== null) || cur.t === "choice" || cur.t === "why") {
    ev.attempt = cur.attempt as number;
  }
  return ev;
}

function speak(ctx: Ctx, kind: SpeakKind, role: Role, text: string, at: number): void {
  const { s } = ctx;
  if (s.settings.manualReading) return;
  const cur = s.cur;
  const nodeId = nodeIdOf(cur) ?? screenOf(cur);
  s.uttSeq += 1;
  const utteranceId = `${nodeId}:${kind}:${s.uttSeq}`;
  s.live[utteranceId] = { kind, role, screenSeq: cur.seq, screen: screenOf(cur), nodeId, cpId: cpIdOf(cur) };
  s.lastUtt = utteranceId;
  log(ctx, { event_type: "tts_start", at, ...ctxCols(cur, s), detail: { utterance_id: utteranceId, kind } });
  ctx.fx.push({ type: "speak", utteranceId, kind, text });
}

/** 현재 화면에 끝나지 않은 낭독이 있으면 취소 effect 1개 */
function cancelLive(ctx: Ctx): void {
  const seq = ctx.s.cur.seq;
  if (Object.values(ctx.s.live).some((u) => u.screenSeq === seq)) ctx.fx.push({ type: "cancelSpeech" });
}

// ---------- 화면 진입 ----------

function beginScreen(ctx: Ctx, cur: Cur, at: number): void {
  cancelLive(ctx);
  ctx.s.cur = cur;
  log(ctx, { event_type: "screen_enter", at, ...ctxCols(cur, ctx.s) });
}

function enterBody(ctx: Ctx, p: Extract<Pending, { t: "body" }>, at: number): void {
  const { s } = ctx;
  s.screenSeq += 1;
  const cur: BodyCur = {
    t: "body",
    seq: s.screenSeq,
    screen: p.screen,
    nodeId: p.nodeId,
    cpId: p.cpId,
    paragraphs: p.paragraphs,
    page: 0,
    attempt: p.attempt,
    nextVisible: s.settings.manualReading,
    replayCount: 0,
    enteredAt: at,
  };
  beginScreen(ctx, cur, at);
  if (p.forcedOptionId !== undefined) {
    log(ctx, {
      event_type: "forced_original",
      at,
      screen: p.screen,
      node_id: p.nodeId,
      choice_point_id: p.cpId ?? undefined,
      option_id: p.forcedOptionId,
      matches_original: true,
      attempt: p.attempt ?? 3,
    });
  }
  speak(ctx, "passage", "body", p.paragraphs[0] ?? "", at);
  render(ctx);
}

/** 같은 노드의 다음 페이지: screen_enter 없이 그 페이지만 낭독 */
function nextPage(ctx: Ctx, cur: BodyCur, at: number): void {
  cancelLive(ctx);
  cur.page += 1;
  cur.nextVisible = ctx.s.settings.manualReading;
  speak(ctx, "passage", "body", cur.paragraphs[cur.page] ?? "", at);
  render(ctx);
}

/** 같은 노드의 앞 페이지(노드 첫 페이지면 호출하지 않는다). 다시 읽고 '다음'은 낭독 뒤에 연다 */
function prevPage(ctx: Ctx, cur: BodyCur, at: number): void {
  cancelLive(ctx);
  cur.page -= 1;
  cur.nextVisible = ctx.s.settings.manualReading;
  speak(ctx, "passage", "body", cur.paragraphs[cur.page] ?? "", at);
  render(ctx);
}

function interactiveBase(s: EngineState, nodeId: string, at: number): InteractiveBase {
  s.screenSeq += 1;
  return { seq: s.screenSeq, nodeId, enteredAt: at, basis: null, replayCount: 0, selected: null };
}

function enterChoice(ctx: Ctx, cpId: string, attempt: number, at: number): void {
  const { s } = ctx;
  const nodeId = isRewind(s) ? `${cpId}#${attempt}` : cpId;
  beginScreen(ctx, { t: "choice", cpId, attempt, ...interactiveBase(s, nodeId, at) }, at);
  speak(ctx, "prompt", "prompt", cpById(s.story, cpId).prompt, at);
  render(ctx);
}

function enterAsk(ctx: Ctx, cpId: string, first: boolean, at: number): void {
  const { s } = ctx;
  beginScreen(ctx, { t: "ask", cpId, selectedCharacterId: null, listening: false, ...interactiveBase(s, `${cpId}.ask`, at) }, at);
  if (first) speak(ctx, "prompt", "prompt", introOf(askOf(s, cpId)), at);
  render(ctx);
}

function enterWhy(ctx: Ctx, p: Extract<Pending, { t: "why" }>, at: number): void {
  const { s } = ctx;
  beginScreen(
    ctx,
    { t: "why", cpId: p.cpId, optionId: p.optionId, attempt: p.attempt, ...interactiveBase(s, p.nodeId, at) },
    at,
  );
  speak(ctx, "prompt", "prompt", STRINGS.whyPrompt, at);
  render(ctx);
}

function enterComprehension(ctx: Ctx, qIndex: number, at: number): void {
  const { s } = ctx;
  if (qIndex >= s.story.comprehension.length) return enterHandoff(ctx, at);
  const q = question(s, qIndex);
  beginScreen(
    ctx,
    { t: "comprehension", qIndex, feedback: null, nextVisible: false, ...interactiveBase(s, q.id, at) },
    at,
  );
  speak(ctx, "prompt", "prompt", q.prompt, at);
  render(ctx);
}

function enterHandoff(ctx: Ctx, at: number): void {
  ctx.s.screenSeq += 1;
  beginScreen(ctx, { t: "parent_handoff", seq: ctx.s.screenSeq }, at);
  render(ctx);
}

function enterPending(ctx: Ctx, p: Pending, at: number): void {
  if (p.t === "body") enterBody(ctx, p, at);
  else if (p.t === "why") enterWhy(ctx, p, at);
  else if (p.t === "ask") {
    if (asksLeft(ctx.s, p.cpId) > 0) enterAsk(ctx, p.cpId, false, at);
    else enterChoiceNode(ctx, cpById(ctx.s.story, p.cpId), at);
  } else enterChoice(ctx, p.cpId, p.attempt, at);
}

function enterSpine(ctx: Ctx, at: number): void {
  const { s } = ctx;
  const node = s.story.spine[s.spineIndex];
  if (!node) return enterComprehension(ctx, 0, at);
  if (node.type === "passage") {
    return enterBody(ctx, { t: "body", screen: "passage", nodeId: node.id, cpId: null, paragraphs: node.paragraphs, attempt: null }, at);
  }
  if (node.type === "ending") {
    const alt = s.conditions.branching && s.conditions.mismatch === "altEnding" && s.mismatchCount > 0;
    const paragraphs = alt ? s.story.endings.alt.paragraphs : s.story.endings.original.paragraphs;
    return enterBody(ctx, { t: "body", screen: "ending", nodeId: alt ? "end.alt" : "end.original", cpId: null, paragraphs, attempt: null }, at);
  }
  const cp = cpById(s.story, node.id);
  if (s.settings.askLayer && cp.ask && s.asked[cp.id] === undefined) {
    s.asked[cp.id] = [];
    return enterAsk(ctx, cp.id, true, at);
  }
  enterChoiceNode(ctx, cp, at);
}

/** 선택 노드 본 진입: 분기 off면 원작 서술 큐, on이면 선택 화면 */
function enterChoiceNode(ctx: Ctx, cp: ChoicePoint, at: number): void {
  const { s } = ctx;
  if (!s.conditions.branching) {
    const o = originalOf(cp);
    const base = `${cp.id}.${o.id}`;
    s.queue = [
      { t: "body", screen: "echo", nodeId: `${base}.offNarration`, cpId: cp.id, paragraphs: [o.offNarration ?? ""], attempt: null },
      { t: "body", screen: "consequence", nodeId: `${base}.consequence`, cpId: cp.id, paragraphs: o.consequence ?? [], attempt: null },
    ];
    return advance(ctx, at);
  }
  enterChoice(ctx, cp.id, 1, at);
}

/** 큐가 남았으면 다음 하위 화면, 비었으면 다음 척추 노드 */
function advance(ctx: Ctx, at: number): void {
  const next = ctx.s.queue.shift();
  if (next) return enterPending(ctx, next, at);
  ctx.s.spineIndex += 1;
  enterSpine(ctx, at);
}

// ---------- 확정 ----------

function confirmChoice(ctx: Ctx, cur: ChoiceCur, optionId: string, at: number): void {
  const { s } = ctx;
  const cp = cpById(s.story, cur.cpId);
  const o = cp.options.find((x) => x.id === optionId);
  if (!o) return;
  const rt = computeRt(cur.basis, cur.enteredAt, at);
  log(ctx, {
    event_type: "choice_confirm",
    at,
    ...ctxCols(cur, s),
    option_id: o.id,
    matches_original: o.matchesOriginal,
    rt_ms: rt.rt_ms,
    rt_basis: rt.rt_basis,
    replay_count: cur.replayCount,
    ...(rt.detail ? { detail: rt.detail } : {}),
  });
  if (!o.matchesOriginal) s.mismatchCount += 1;

  const rewind = isRewind(s);
  const a = cur.attempt;
  const sfx = rewind ? `#${a}` : "";
  const base = `${cp.id}.${o.id}`;
  const body = (screen: BodyScreen, part: string, paragraphs: string[]): Pending => ({
    t: "body",
    screen,
    nodeId: `${base}.${part}${sfx}`,
    cpId: cp.id,
    paragraphs,
    attempt: a,
  });
  const q: Pending[] = [body("echo", "echo", [o.echo])];
  if (s.conditions.askWhy === true) q.push({ t: "why", cpId: cp.id, optionId: o.id, attempt: a, nodeId: `${base}.why${sfx}` });

  if (o.matchesOriginal) {
    q.push(body("consequence", "consequence", o.consequence ?? []));
  } else if (rewind) {
    const m = o.mismatch!.rewind;
    q.push(body("consequence", "rewind.consequence", m.consequence));
    if (a <= 1) {
      // 재선택 안내는 마지막 페이지에 붙인다(contrast는 문자열 1개 = 1페이지)
      q.push(body("contrast", "rewind.contrast", [`${m.contrast} ${STRINGS.chooseAgain}`]));
      q.push({ t: "choice", cpId: cp.id, attempt: a + 1 });
    } else {
      q.push(body("contrast", "rewind.contrastFinal", [m.contrastFinal]));
      const orig = originalOf(cp);
      q.push({
        t: "body",
        screen: "consequence",
        nodeId: `${cp.id}.${orig.id}.consequence#${a + 1}`,
        cpId: cp.id,
        paragraphs: orig.consequence ?? [],
        attempt: a + 1,
        forcedOptionId: orig.id,
      });
    }
  } else {
    const kind = s.conditions.mismatch === "altEnding" ? "altEnding" : "converge";
    const m = o.mismatch![kind];
    q.push(body("consequence", `${kind}.consequence`, m.consequence));
    q.push(body("bridge", `${kind}.bridge`, m.bridge));
    if (kind === "converge") {
      // 다리글 뒤에 원작 선택지의 consequence를 이어 읽는다(원작 사건이 모든 경로에서 일어나도록). forced_original은 아님
      const orig = originalOf(cp);
      q.push({ t: "body", screen: "consequence", nodeId: `${cp.id}.${orig.id}.consequence`, cpId: cp.id, paragraphs: orig.consequence ?? [], attempt: a });
    }
  }
  s.queue = q;
  advance(ctx, at);
}

/** 묻기 확정: 대답 화면 → 묻기 화면 복귀(또는 선택) */
function confirmAsk(ctx: Ctx, cur: AskCur, optionId: string, at: number, via: "card" | "voice", transcript?: string): void {
  const { s } = ctx;
  const found = askQuestion(askOf(s, cur.cpId), optionId);
  const done = s.asked[cur.cpId] ?? [];
  if (!found || done.includes(optionId)) return;
  const nodeId = `${cur.cpId}.ask.${found.characterId}.${found.q.id}`;
  const rt = computeRt(cur.basis, cur.enteredAt, at);
  log(ctx, {
    event_type: "ask_confirm",
    at,
    ...ctxCols(cur, s),
    question_id: nodeId,
    option_id: optionId,
    rt_ms: rt.rt_ms,
    rt_basis: rt.rt_basis,
    replay_count: cur.replayCount,
    detail: { ...(rt.detail ?? {}), via, ...(transcript !== undefined ? { transcript } : {}) },
  });
  s.asked[cur.cpId] = [...done, optionId];
  s.queue = [
    { t: "body", screen: "askAnswer", nodeId, cpId: cur.cpId, paragraphs: found.q.answer, attempt: null },
    { t: "ask", cpId: cur.cpId },
  ];
  advance(ctx, at);
}

/** 음성 미인식: 실패 횟수를 올리고 인물의 되묻기(2회째부터 마무리 문구)를 낭독 */
function voiceMiss(ctx: Ctx, cur: AskCur, at: number): void {
  const { s } = ctx;
  const fails = (s.voiceFails[cur.cpId] ?? 0) + 1;
  s.voiceFails = { ...s.voiceFails, [cur.cpId]: fails };
  const ask = askOf(s, cur.cpId);
  const ch = ask.characters.find((c) => c.id === cur.selectedCharacterId) ?? ask.characters[0];
  const text = fails >= 2 ? (ch?.unmatchedFinal ?? STRINGS.voiceUnmatchedFinal) : (ch?.unmatched ?? STRINGS.voiceUnmatched);
  speak(ctx, "prompt", "feedback", text, at);
  render(ctx);
}

function answerWhy(ctx: Ctx, cur: WhyCur, optionId: string, at: number): void {
  const { s } = ctx;
  const o = cpById(s.story, cur.cpId).options.find((x) => x.id === cur.optionId);
  const w = o?.why.find((x) => x.id === optionId);
  if (!w) return;
  const rt = computeRt(cur.basis, cur.enteredAt, at);
  log(ctx, {
    event_type: "why_answer",
    at,
    ...ctxCols(cur, s),
    option_id: w.id,
    reason_type: w.reasonType,
    rt_ms: rt.rt_ms,
    rt_basis: rt.rt_basis,
    replay_count: cur.replayCount,
    ...(rt.detail ? { detail: rt.detail } : {}),
  });
  advance(ctx, at);
}

function answerQuestion(ctx: Ctx, cur: CompCur, optionId: string, at: number): void {
  const { s } = ctx;
  if (cur.feedback !== null) return;
  const q = question(s, cur.qIndex);
  if (!q.options.some((x) => x.id === optionId)) return;
  const correct = optionId === q.answer;
  const rt = computeRt(cur.basis, cur.enteredAt, at);
  log(ctx, {
    event_type: "comprehension_answer",
    at,
    ...ctxCols(cur, s),
    option_id: optionId,
    correct,
    rt_ms: rt.rt_ms,
    rt_basis: rt.rt_basis,
    replay_count: cur.replayCount,
    ...(rt.detail ? { detail: rt.detail } : {}),
  });
  cancelLive(ctx);
  const feedback = correct ? q.feedback.correct : q.feedback.incorrect;
  s.cur = { ...cur, selected: optionId, feedback, nextVisible: s.settings.manualReading };
  speak(ctx, "passage", "feedback", feedback, at);
  render(ctx);
}

/** 화면 종류별 확정 */
function confirmOnScreen(ctx: Ctx, cur: ChoiceCur | WhyCur | CompCur | AskCur, optionId: string, at: number): void {
  if (cur.t === "choice") confirmChoice(ctx, cur, optionId, at);
  else if (cur.t === "ask") confirmAsk(ctx, cur, optionId, at, "card");
  else if (cur.t === "why") answerWhy(ctx, cur, optionId, at);
  else answerQuestion(ctx, cur, optionId, at);
}

function optionText(s: EngineState, cur: ChoiceCur | WhyCur | CompCur | AskCur, optionId: string): string | null {
  if (cur.t === "ask") return askQuestion(askOf(s, cur.cpId), optionId)?.q.text ?? null;
  if (cur.t === "choice") return cpById(s.story, cur.cpId).options.find((o) => o.id === optionId)?.label ?? null;
  if (cur.t === "why") {
    const o = cpById(s.story, cur.cpId).options.find((x) => x.id === cur.optionId);
    return o?.why.find((w) => w.id === optionId)?.text ?? null;
  }
  return question(s, cur.qIndex).options.find((o) => o.id === optionId)?.text ?? null;
}

// ---------- 공개 API ----------

export function init(story: Story, conditions: Conditions, settings: EngineSettings, at: number): StepResult<EngineState> {
  const s: EngineState = {
    story,
    conditions,
    settings,
    spineIndex: 0,
    queue: [],
    // 진입 전 자리표시 (beginScreen이 곧 덮어씀)
    cur: { t: "parent_handoff", seq: 0 },
    screenSeq: 0,
    uttSeq: 0,
    live: {},
    lastUtt: null,
    mismatchCount: 0,
    asked: {},
    voiceFails: {},
  };
  const ctx: Ctx = { s, fx: [] };
  enterSpine(ctx, at);
  return { state: s, effects: ctx.fx };
}

export function isFinished(state: EngineState): boolean {
  return state.cur.t === "parent_handoff";
}

export function step(state: EngineState, action: Action): StepResult<EngineState> {
  const s: EngineState = {
    ...state,
    queue: [...state.queue],
    live: { ...state.live },
    cur: { ...state.cur },
    // 값 배열은 수정할 때 새 배열로 바꾼다
    asked: { ...state.asked },
    voiceFails: { ...state.voiceFails },
  };
  const ctx: Ctx = { s, fx: [] };
  const at = action.at;
  const cur = s.cur;
  const unchanged = { state, effects: [] as Effect[] };

  if (action.type === "ttsDone") {
    const u = s.live[action.utteranceId];
    if (!u) return unchanged;
    delete s.live[action.utteranceId];
    const cols: Partial<EngineLogEvent> = { screen: u.screen, node_id: u.nodeId };
    if (u.cpId) cols.choice_point_id = u.cpId;
    log(ctx, {
      event_type: action.outcome === "error" ? "tts_error" : "tts_end",
      at,
      ...cols,
      detail: { utterance_id: action.utteranceId, kind: u.kind, outcome: action.outcome },
    });
    if (u.screenSeq !== cur.seq) return { state: s, effects: ctx.fx };
    // 다시 듣기·보기 낭독 등으로 대체된 이전 발화의 done(cancelled 등)은 로그만 남긴다
    if (action.utteranceId !== s.lastUtt) return { state: s, effects: ctx.fx };
    if (cur.t === "body" && u.role === "body" && !cur.nextVisible) {
      cur.nextVisible = true;
      render(ctx);
    } else if (cur.t === "comprehension" && u.role === "feedback" && !cur.nextVisible) {
      cur.nextVisible = true;
      render(ctx);
    } else if ((cur.t === "choice" || cur.t === "why" || cur.t === "comprehension" || cur.t === "ask") && (u.role === "prompt" || u.role === "replay_prompt")) {
      cur.basis = updateBasis(cur.basis, { kind: u.kind, isReplay: u.role === "replay_prompt" }, action.outcome, at);
    }
    return { state: s, effects: ctx.fx };
  }

  if (cur.t === "parent_handoff") return unchanged;

  switch (action.type) {
    case "next": {
      if (cur.t === "body") {
        if (!cur.nextVisible) return unchanged;
        const pageCount = cur.paragraphs.length;
        log(ctx, { event_type: "next_click", at, ...ctxCols(cur, s), detail: { page: cur.page + 1, page_count: pageCount } });
        if (cur.page + 1 < pageCount) nextPage(ctx, cur, at);
        else advance(ctx, at);
        break;
      }
      if (cur.t === "comprehension") {
        if (cur.feedback === null || !cur.nextVisible) return unchanged;
        enterComprehension(ctx, cur.qIndex + 1, at);
        break;
      }
      return unchanged;
    }
    case "prev": {
      // 같은 노드 안에서만 뒤로 간다. 노드 첫 페이지(선택 직후 등)에서는 앞 노드로 넘어가지 않는다
      if (cur.t !== "body" || cur.page === 0) return unchanged;
      log(ctx, { event_type: "prev_click", at, ...ctxCols(cur, s), detail: { page: cur.page + 1, page_count: cur.paragraphs.length } });
      prevPage(ctx, cur, at);
      break;
    }
    case "replay": {
      if (cur.t === "body") {
        cur.replayCount += 1;
        log(ctx, { event_type: "replay", at, ...ctxCols(cur, s), replay_count: cur.replayCount });
        cancelLive(ctx);
        speak(ctx, "passage", "body", cur.paragraphs[cur.page] ?? "", at);
        break;
      }
      cur.replayCount += 1;
      log(ctx, { event_type: "replay", at, ...ctxCols(cur, s), replay_count: cur.replayCount });
      cancelLive(ctx);
      if (cur.t === "comprehension" && cur.feedback !== null) {
        speak(ctx, "passage", "feedback", cur.feedback, at);
      } else {
        const prompt =
          cur.t === "choice"
            ? cpById(s.story, cur.cpId).prompt
            : cur.t === "why"
              ? STRINGS.whyPrompt
              : cur.t === "ask"
                ? introOf(askOf(s, cur.cpId))
                : question(s, cur.qIndex).prompt;
        speak(ctx, "prompt", "replay_prompt", prompt, at);
      }
      break;
    }
    case "listen": {
      if (cur.t === "body") return unchanged;
      if (cur.t === "comprehension" && cur.feedback !== null) return unchanged;
      const text = optionText(s, cur, action.optionId);
      if (text === null) return unchanged;
      if (cur.t === "ask" && (s.asked[cur.cpId] ?? []).includes(action.optionId)) return unchanged;
      if (s.settings.confirmMode === "single" || cur.selected === action.optionId) {
        confirmOnScreen(ctx, cur, action.optionId, at);
        break;
      }
      cur.selected = action.optionId;
      log(ctx, { event_type: cur.t === "ask" ? "ask_listen" : "option_listen", at, ...ctxCols(cur, s), option_id: action.optionId, replay_count: cur.replayCount });
      cancelLive(ctx);
      speak(ctx, "option", "option", text, at);
      render(ctx);
      break;
    }
    case "confirm": {
      if (cur.t === "ask") confirmAsk(ctx, cur, action.optionId, at, "card");
      else if (cur.t === "choice") confirmChoice(ctx, cur, action.optionId, at);
      else return unchanged;
      break;
    }
    case "askCharacter": {
      if (cur.t !== "ask" || cur.selectedCharacterId === action.characterId) return unchanged;
      if (!askOf(s, cur.cpId).characters.some((c) => c.id === action.characterId)) return unchanged;
      cur.selectedCharacterId = action.characterId;
      cur.selected = null;
      log(ctx, { event_type: "ask_character", at, ...ctxCols(cur, s), option_id: action.characterId });
      render(ctx);
      break;
    }
    case "askSkip": {
      if (cur.t !== "ask") return unchanged;
      log(ctx, { event_type: "ask_skip", at, ...ctxCols(cur, s), detail: { asked: (s.asked[cur.cpId] ?? []).length } });
      enterChoiceNode(ctx, cpById(s.story, cur.cpId), at);
      break;
    }
    case "voiceStart": {
      if (cur.t !== "ask" || currentViewVoice(s, cur) !== "idle") return unchanged;
      cur.listening = true;
      cancelLive(ctx);
      log(ctx, { event_type: "voice_start", at, ...ctxCols(cur, s) });
      render(ctx);
      break;
    }
    case "voiceResult": {
      if (cur.t !== "ask" || !cur.listening) return unchanged;
      cur.listening = false;
      const m = action.matched;
      const key = m ? `${m.characterId}.${m.questionId}` : null;
      const found = key !== null && askQuestion(askOf(s, cur.cpId), key) ? key : null;
      log(ctx, {
        event_type: "voice_result",
        at,
        ...ctxCols(cur, s),
        detail: { transcript: action.transcript, alternatives: action.alternatives, matched: found ? `${cur.cpId}.ask.${found}` : null },
      });
      if (found === null) {
        voiceMiss(ctx, cur, at);
      } else if (!(s.asked[cur.cpId] ?? []).includes(found)) {
        confirmAsk(ctx, cur, found, at, "voice", action.transcript);
      } else {
        // 이미 한 질문: 대답만 다시 들려주고 횟수는 건드리지 않는다
        const nodeId = `${cur.cpId}.ask.${found}`;
        log(ctx, { event_type: "ask_repeat", at, ...ctxCols(cur, s), question_id: nodeId, option_id: found, detail: { via: "voice", transcript: action.transcript } });
        s.queue = [
          { t: "body", screen: "askAnswer", nodeId, cpId: cur.cpId, paragraphs: askQuestion(askOf(s, cur.cpId), found)!.q.answer, attempt: null },
          { t: "ask", cpId: cur.cpId },
        ];
        advance(ctx, at);
      }
      break;
    }
    case "voiceFail": {
      if (cur.t !== "ask" || !cur.listening) return unchanged;
      cur.listening = false;
      log(ctx, { event_type: "voice_fail", at, ...ctxCols(cur, s), detail: { reason: action.reason } });
      voiceMiss(ctx, cur, at);
      break;
    }
    case "answerWhy": {
      if (cur.t !== "why") return unchanged;
      answerWhy(ctx, cur, action.optionId, at);
      break;
    }
    case "answerQuestion": {
      if (cur.t !== "comprehension") return unchanged;
      answerQuestion(ctx, cur, action.optionId, at);
      break;
    }
  }
  if (ctx.fx.length === 0) return unchanged;
  return { state: s, effects: ctx.fx };
}

export function currentView(state: EngineState): View {
  const cur = state.cur;
  switch (cur.t) {
    case "body":
      return {
        screen: cur.screen,
        nodeId: cur.nodeId,
        choicePointId: cur.cpId,
        paragraphs: [cur.paragraphs[cur.page] ?? ""],
        page: cur.page + 1,
        pageCount: cur.paragraphs.length,
        nextVisible: cur.nextVisible,
      };
    case "choice": {
      const cp = cpById(state.story, cur.cpId);
      return {
        screen: "choice",
        nodeId: cur.nodeId,
        choicePointId: cur.cpId,
        attempt: cur.attempt,
        prompt: cp.prompt,
        options: cp.options.map((o) => ({ id: o.id, label: o.label })),
        selectedOptionId: cur.selected,
      };
    }
    case "why": {
      const o = cpById(state.story, cur.cpId).options.find((x) => x.id === cur.optionId);
      return {
        screen: "why",
        nodeId: cur.nodeId,
        choicePointId: cur.cpId,
        attempt: cur.attempt,
        prompt: STRINGS.whyPrompt,
        options: (o?.why ?? []).map((w) => ({ id: w.id, text: w.text })),
        selectedOptionId: cur.selected,
      };
    }
    case "comprehension": {
      const q = question(state, cur.qIndex);
      return {
        screen: "comprehension",
        nodeId: q.id,
        questionId: q.id,
        questionType: q.type,
        prompt: q.prompt,
        options: q.options.map((o) => ({ id: o.id, text: o.text })),
        selectedOptionId: cur.selected,
        feedback: cur.feedback,
        nextVisible: cur.nextVisible,
      };
    }
    case "ask": {
      const ask = askOf(state, cur.cpId);
      const done = state.asked[cur.cpId] ?? [];
      const ch = ask.characters.find((c) => c.id === cur.selectedCharacterId);
      return {
        screen: "ask",
        nodeId: cur.nodeId,
        choicePointId: cur.cpId,
        storyId: state.story.id,
        prompt: introOf(ask),
        characters: ask.characters.map((c) => ({ id: c.id, name: c.name, ...(c.portrait !== undefined ? { portrait: c.portrait } : {}) })),
        selectedCharacterId: cur.selectedCharacterId,
        questions: (ch?.questions ?? []).map((q) => {
          const id = `${ch!.id}.${q.id}`;
          return { id, text: q.text, asked: done.includes(id) };
        }),
        selectedQuestionId: cur.selected,
        asksLeft: asksLeft(state, cur.cpId),
        voice: currentViewVoice(state, cur),
        voiceFails: state.voiceFails[cur.cpId] ?? 0,
      };
    }
    case "parent_handoff":
      return { screen: "parent_handoff" };
  }
}
