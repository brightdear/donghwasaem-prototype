/**
 * 부모 리포트 타입 — 계획 3.5. 팀 리드 작성.
 * ReportInput에는 참가자 코드·나이·session_id 필드가 타입 수준에서 없다(AC-16).
 */

import type { QuestionType } from "../story/types";
import type { FallbackReason, ReportSource } from "../log/types";

export type ComprehensionResult = "all" | "most" | "some" | "none";

export interface ReportChoice {
  prompt: string; // 선택 지점 질문
  original: string; // 원작 선택지 label
  firstChosen: string; // 첫 시도 label
  firstMatchesOriginal: boolean;
  finalChosen: string; // 최종(강제 포함) label
  attempts: number; // 1~3
  forced: boolean; // forced_original 발생
  reasonText?: string; // 첫 시도 why 보기 문장
}

export interface ReportInput {
  storyTitle: string;
  branching: boolean;
  choices: ReportChoice[]; // 분기 off면 []
  comprehension: { type: QuestionType; result: ComprehensionResult }[];
  parentPrompts: string[];
}

export interface ReportText {
  choices: string; // 아이의 선택 요약 (원작 비교)
  comprehension: string; // 유형별 결과를 문장으로
  prompts: string[]; // '오늘 이렇게 물어보세요' 2~3개
}

export interface ReportResult {
  text: ReportText;
  source: ReportSource;
  fallbackReason?: FallbackReason;
  llmLatencyMs?: number;
}

export const LLM_MODEL = "claude-haiku-5-5";
export const LLM_TIMEOUT_MS = 8000;
export const LLM_MAX_TOKENS = 2048;
