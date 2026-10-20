/**
 * 동화샘 시제품 — 공통 타입 계약.
 * 계획: D:\youtube\.omc\plans\donghwasaem-prototype-plan.md 3.1·3.2·3.3(화면 진행 규칙·하위 노드 id 규칙)
 *
 * 이 파일은 팀 리드가 작성했고 모든 모듈이 의존한다. 바꿔야 하면 리드에게 먼저 알린다.
 */

import type { EngineLogEvent } from "../log/types";

// ---------- 시나리오 JSON (src/data/*.json) ----------

export interface Passage {
  type: "passage";
  id: string; // p1, p2, ...
  paragraphs: string[];
}
export interface ChoiceRef {
  type: "choice";
  id: string; // choicePoints[].id 참조 (c1, c2, c3)
}
export interface EndingRef {
  type: "ending";
  id: string; // "end"
}
export type SpineNode = Passage | ChoiceRef | EndingRef;

/** why 보기의 이유 유형 (근거 4.4 선택 이유 유형) */
export type ReasonType = "others_feeling" | "outcome" | "rule" | "other";

export interface WhyOption {
  id: string; // 예: c1a-w1
  text: string;
  reasonType: ReasonType;
}

export interface MismatchRewind {
  consequence: string[]; // 짧게
  contrast: string; // 1회째 "만약 ~했다면" 대비 문장. 재선택 안내는 엔진이 strings.ts에서 붙임. "다시 골라" 금지
  contrastFinal: string; // 2회째, 재선택 없이 원작으로 돌아가는 문장. "다시 골라" 금지
}
export interface MismatchConverge {
  consequence: string[];
  bridge: string[]; // 필수. 다음 척추 passage로 연결
}
export interface MismatchAltEnding {
  consequence: string[];
  bridge: string[]; // 필수(R2)
}
export interface Mismatch {
  rewind: MismatchRewind;
  converge: MismatchConverge;
  altEnding: MismatchAltEnding;
}

export interface ChoiceOption {
  id: string; // 예: c1a
  label: string; // 버튼 글자 (주인공 행동)
  matchesOriginal: boolean;
  echo: string; // 되짚기 "~하기로 했구나. 그래서…" (아이가 고른 경우에만 낭독)
  why: WhyOption[]; // 2~3개
  /** 원작 선택지에만 필수. 3인칭 서술, "골랐" 금지. 분기 off에서 낭독 */
  offNarration?: string;
  /** 원작 선택지에만 필수. 좋은 결과, 길게 */
  consequence?: string[];
  /** 원작과 다른 선택지에만 필수 */
  mismatch?: Mismatch;
}

export interface ChoicePoint {
  id: string; // c1, c2, c3
  prompt: string; // "흥부는 어떻게 할까?"
  options: ChoiceOption[]; // 2~3개, matchesOriginal=true 정확히 1개
}

export type QuestionType = "explicit" | "inference" | "sequence";

export interface QuestionOption {
  id: string; // 예: q1a
  text: string;
}

export interface ComprehensionQuestion {
  id: string; // q1..q5
  type: QuestionType;
  prompt: string;
  options: QuestionOption[]; // 2~3개
  answer: string; // options[].id
  refersTo: string[]; // 척추 passage id만 (R5)
  /** 정답 근거 문자열. refersTo passage 안에 그대로 존재해야 함. sequence 유형만 배열(원소 2개 이상) */
  answerFact: string | string[];
  feedback: { correct: string; incorrect: string }; // 이야기 문장 피드백 (원칙 1)
}

export interface Story {
  schemaVersion: 2;
  id: string; // 로그 story_id (heungbu / ant)
  title: string;
  spine: SpineNode[];
  choicePoints: ChoicePoint[];
  endings: {
    original: { paragraphs: string[] };
    alt: { paragraphs: string[] };
  };
  comprehension: ComprehensionQuestion[]; // 4~5개
  parentPrompts: string[]; // 2개 이상
}

// ---------- 실험 조건 (3.1) ----------

export type MismatchKind = "rewind" | "converge" | "altEnding";

export interface Conditions {
  branching: boolean;
  mismatch: MismatchKind | "na"; // branching=false면 "na"
  askWhy: boolean | "na"; // branching=false면 "na"
}

/** 유효 조합 7개 (3.1). 리허설·transcript 열거에 사용 */
export const VALID_CONDITIONS: readonly Conditions[] = [
  { branching: false, mismatch: "na", askWhy: "na" },
  { branching: true, mismatch: "rewind", askWhy: true },
  { branching: true, mismatch: "rewind", askWhy: false },
  { branching: true, mismatch: "converge", askWhy: true },
  { branching: true, mismatch: "converge", askWhy: false },
  { branching: true, mismatch: "altEnding", askWhy: true },
  { branching: true, mismatch: "altEnding", askWhy: false },
];

/** 조합 슬러그 (파일명·로그 표시용): off | rewind-why | rewind-nowhy | ... */
export function conditionsSlug(c: Conditions): string {
  if (!c.branching) return "off";
  return `${c.mismatch}-${c.askWhy === true ? "why" : "nowhy"}`;
}

// ---------- 엔진 입출력 (3.2 화면 진행 규칙, 단계 1) ----------

export type Screen =
  | "experimenter"
  | "handoff"
  | "passage"
  | "choice"
  | "echo"
  | "why"
  | "consequence"
  | "contrast"
  | "bridge"
  | "ending"
  | "comprehension"
  | "parent_handoff"
  | "report";

/** 본문 화면: 페이지(문단 1개)마다 자동 낭독 → ttsDone 뒤 '다음' 표시 → next로 다음 페이지, 마지막 페이지면 다음 노드 */
export type BodyScreen = "passage" | "echo" | "consequence" | "contrast" | "bridge" | "ending";

export type SpeakKind = "passage" | "prompt" | "option";
export type TtsOutcome = "ended" | "cancelled" | "error" | "watchdog";

export interface EngineSettings {
  /** 실험자 낭독 모드: speak effect를 내지 않고 본문 화면의 '다음'을 즉시 표시 */
  manualReading: boolean;
  /** 기본 double(같은 보기 재탭 또는 '이걸로 할래'). single은 숨김 설정 */
  confirmMode: "double" | "single";
}

/** 모든 action은 at(ms, performance.now() 기준)을 가진다. 시계는 주입. */
export type Action =
  | { type: "next"; at: number }
  | { type: "listen"; optionId: string; at: number }
  | { type: "confirm"; optionId: string; at: number }
  | { type: "answerWhy"; optionId: string; at: number }
  | { type: "answerQuestion"; optionId: string; at: number }
  | { type: "replay"; at: number }
  | { type: "ttsDone"; utteranceId: string; outcome: TtsOutcome; at: number };

export interface BodyView {
  screen: BodyScreen;
  nodeId: string; // 하위 노드 id 규칙
  choicePointId: string | null;
  /** 현재 페이지의 문단 1개만 담는다(길이 1). 문단 1개 = 화면 1페이지 = 1~2문장 */
  paragraphs: string[];
  page: number; // 1부터. 아이 화면에는 표시하지 않음
  pageCount: number;
  nextVisible: boolean; // 페이지 낭독 ttsDone 뒤 true (manualReading이면 페이지 진입 즉시 true)
}
export interface ChoiceView {
  screen: "choice";
  nodeId: string; // c1 또는 c1#2
  choicePointId: string;
  attempt: number;
  prompt: string;
  options: { id: string; label: string }[];
  selectedOptionId: string | null; // 첫 탭으로 강조된 보기
}
export interface WhyView {
  screen: "why";
  nodeId: string; // c1.c1b.why[#n]
  choicePointId: string;
  attempt: number;
  prompt: string; // strings.whyPrompt
  options: { id: string; text: string }[];
  selectedOptionId: string | null;
}
export interface ComprehensionView {
  screen: "comprehension";
  nodeId: string; // q1
  questionId: string;
  questionType: QuestionType;
  prompt: string;
  options: { id: string; text: string }[];
  selectedOptionId: string | null;
  /** 확정 뒤 피드백 문장(이야기 문장). 피드백 낭독 후 next로 다음 질문 */
  feedback: string | null;
  nextVisible: boolean;
}
export interface ParentHandoffView {
  screen: "parent_handoff";
}
export type View = BodyView | ChoiceView | WhyView | ComprehensionView | ParentHandoffView;

export type Effect =
  | { type: "speak"; utteranceId: string; kind: SpeakKind; text: string } // utteranceId는 리듀서가 결정적으로 발급
  | { type: "cancelSpeech" }
  | { type: "log"; event: EngineLogEvent }
  | { type: "render"; view: View };

export interface StepResult<S> {
  state: S;
  effects: Effect[];
}

/**
 * 엔진 모듈(src/story/engine.ts)이 내보내야 하는 함수:
 *   init(story, conditions, settings, at): StepResult<EngineState>
 *   step(state, action): StepResult<EngineState>
 *   isFinished(state): boolean   // parent_handoff 진입 여부
 *   currentView(state): View
 * EngineState의 내부 구조는 엔진이 정하되, 직렬화 가능(JSON)해야 한다.
 */
