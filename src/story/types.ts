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

// ---------- 묻기 층 (설계 6.4, 선택 직전 선택) ----------

export interface AskQuestion {
  id: string;
  text: string;
  keywords: string[];
  answer: string[];
  clue?: string;
}
export interface AskCharacter {
  id: string;
  name: string;
  portrait?: string;
  questions: AskQuestion[];
  unmatched?: string;
  unmatchedFinal?: string;
}
export interface AskBlock {
  voice: boolean;
  maxAsks?: number;
  intro?: string;
  sceneLabel?: string;
  characters: AskCharacter[];
}

export interface ChoicePoint {
  id: string; // c1, c2, c3
  prompt: string; // "흥부는 어떻게 할까?"
  options: ChoiceOption[]; // 2~3개, matchesOriginal=true 정확히 1개
  ask?: AskBlock; // 설계 6.4, 선택 직전 묻기 층
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
  /** 장면 그림·일치 애니메이션(선택). 없으면 장면 id로 파일 경로를 추정한다 */
  art?: StoryArt;
}

// ---------- 장면 그림 (선택) ----------

/** 오버레이 동작 집합(고정) */
export const MOTIONS = ["fall", "grow", "fly_away", "walk_in", "walk_in_right", "shiver", "drift_down"] as const;
export type Motion = (typeof MOTIONS)[number];

export interface ArtMotion {
  scene: string; // 본문 노드 id
  page: number; // 1부터, 그 노드 문단 수 이하
  overlay: string; // public/img/common/<overlay>
  motion: Motion;
  x: number; // 0~1, 그림 영역 대비 왼쪽 위치
  y: number; // 0~1, 위쪽 위치
  size: number; // 0~1, 그림 폭 대비 오버레이 폭
}

export interface StoryArt {
  /** 장면 id → 파일명(public/img/<storyId>/). null이면 그 장면은 그림 없음 */
  scenes?: Record<string, { image: string | null }>;
  motions?: ArtMotion[];
  /** 장면 id → 페이지별 그림 파일명(페이지 수와 같은 길이). 있으면 페이지마다 그림이 바뀐다 */
  pages?: Record<string, string[]>;
  /** 글을 오른쪽 위에 놓을 그림 파일명(확장자 제외). 나머지는 왼쪽 위. 그림의 빈 곳에 맞춘다 */
  textRight?: string[];
}

// ---------- 실험 조건 (3.1) ----------

export type MismatchKind = "rewind" | "converge" | "altEnding";

export interface Conditions {
  branching: boolean;
  mismatch: MismatchKind | "na"; // branching=false면 "na"
  askWhy: boolean | "na"; // branching=false면 "na"
}

/** 유효 조합 5개 (3.1; altEnding은 2026-10-25 UI에서 제거, 타입·엔진은 유지). 리허설·transcript 열거에 사용 */
export const VALID_CONDITIONS: readonly Conditions[] = [
  { branching: false, mismatch: "na", askWhy: "na" },
  { branching: true, mismatch: "rewind", askWhy: true },
  { branching: true, mismatch: "rewind", askWhy: false },
  { branching: true, mismatch: "converge", askWhy: true },
  { branching: true, mismatch: "converge", askWhy: false },
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
  | "report"
  | "ask"
  | "askAnswer";

/** 본문 화면: 페이지(문단 1개)마다 자동 낭독 → ttsDone 뒤 '다음' 표시 → next로 다음 페이지, 마지막 페이지면 다음 노드 */
export type BodyScreen = "passage" | "echo" | "consequence" | "contrast" | "bridge" | "ending" | "askAnswer";

export type SpeakKind = "passage" | "prompt" | "option";
export type TtsOutcome = "ended" | "cancelled" | "error" | "watchdog";

export interface EngineSettings {
  /** 실험자 낭독 모드: speak effect를 내지 않고 본문 화면의 '다음'을 즉시 표시 */
  manualReading: boolean;
  /** 기본 double(같은 보기 재탭 또는 '이걸로 할래'). single은 숨김 설정 */
  confirmMode: "double" | "single";
  /** 선택 직전 묻기 층(설계 6.1) */
  askLayer: boolean;
  /** 말로 묻기 = 실험자 토글 AND 브라우저 지원. 러너/main이 합쳐서 넘긴다 */
  voiceAsk: boolean;
}

/** 모든 action은 at(ms, performance.now() 기준)을 가진다. 시계는 주입. */
export type Action =
  | { type: "next"; at: number }
  | { type: "prev"; at: number }
  | { type: "listen"; optionId: string; at: number }
  | { type: "confirm"; optionId: string; at: number }
  | { type: "answerWhy"; optionId: string; at: number }
  | { type: "answerQuestion"; optionId: string; at: number }
  | { type: "replay"; at: number }
  | { type: "ttsDone"; utteranceId: string; outcome: TtsOutcome; at: number }
  | { type: "askCharacter"; characterId: string; at: number }
  | { type: "askSkip"; at: number }
  | { type: "voiceStart"; at: number }
  | {
      type: "voiceResult";
      transcript: string;
      alternatives: string[];
      /** questionId "free" = 준비 밖 질문에 LLM이 지은 대답(answerText) */
      matched: { characterId: string; questionId: string; answerText: string[] } | null;
      /** 실제로 대답한 응답기(voice_result 로그용). 못 맞췄으면 설정된 응답기. 기본 "keyword" */
      responder?: "llm" | "keyword";
      /** LLM이 실패해 키워드로 대답했을 때 그 이유 */
      fallbackReason?: string;
      /** LLM 호출 소요(ms) */
      latencyMs?: number;
      at: number;
    }
  | { type: "voiceFail"; reason: string; at: number };

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
export interface AskView {
  screen: "ask";
  nodeId: string; // c1.ask
  choicePointId: string;
  storyId: string;
  prompt: string; // intro ?? STRINGS.askIntroDefault
  characters: { id: string; name: string; portrait?: string }[];
  selectedCharacterId: string | null;
  questions: { id: string; text: string; asked: boolean }[]; // id = `${characterId}.${questionId}`, 고른 인물 것만
  selectedQuestionId: string | null; // listen으로 강조된 카드
  asksLeft: number;
  voice: "hidden" | "idle" | "listening";
  voiceFails: number;
}
export interface ParentHandoffView {
  screen: "parent_handoff";
}
export type View = BodyView | ChoiceView | WhyView | ComprehensionView | AskView | ParentHandoffView;

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
