/**
 * 아이·부모 화면 고정 문구 (계획 4 단계 1). 이모지·금지어 검사 대상.
 * 엔진은 rewind 1회째 contrast 화면 끝에 `chooseAgain`을 붙인다.
 */
export const STRINGS = {
  whyPrompt: "왜 그렇게 골랐어?",
  chooseAgain: "다시 골라 볼까?",
  next: "다음",
  replay: "다시 듣기",
  confirm: "이걸로 할래",
  play: "들려줘",
  start: "시작",
  parentHandoff: "부모님께 넘겨주세요",
  askedCheck: "물어봤어요",
} as const;

export type StringKey = keyof typeof STRINGS;
