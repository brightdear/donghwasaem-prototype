/**
 * 템플릿 리포트 — LLM 없이/실패 시 쓰는 기본 문장. 숫자·점수·향상 표현 없음, 문체 "~했어요".
 */

import type { QuestionType } from "../story/types";
import type { ReportChoice, ReportInput, ReportText } from "./types";

const TYPE_LABEL: Record<QuestionType, string> = {
  explicit: "이야기에 나온 내용",
  inference: "왜 그랬는지 짐작하는 질문",
  sequence: "일이 일어난 순서",
};

const FALLBACK_PROMPTS = [
  "오늘 이야기에서 어떤 부분이 제일 기억에 남아?",
  "너라면 어떻게 했을 것 같아?",
];

function choiceSentence(c: ReportChoice): string {
  const parts: string[] = [];
  parts.push(`「${c.prompt}」 장면에서 「${c.firstChosen}」 쪽을 골랐어요.`);
  parts.push(c.firstMatchesOriginal ? "원작과 같은 선택이었어요." : `원작은 「${c.original}」 쪽이었어요.`);
  if (c.reasonText) parts.push(`이유를 물으니 「${c.reasonText}」라고 답했어요.`);
  if (c.forced) {
    parts.push("여러 번 다르게 골라 봤고, 이야기는 원작대로 이어졌어요.");
  } else if (c.attempts > 1) {
    parts.push(`다시 골라서 「${c.finalChosen}」 쪽으로 했어요.`);
  }
  return parts.join(" ");
}

export function templateReport(input: ReportInput): ReportText {
  const choices =
    !input.branching || input.choices.length === 0
      ? "오늘은 이야기를 끝까지 들었어요."
      : input.choices.map(choiceSentence).join("\n");

  let comprehension: string;
  if (input.comprehension.length === 0) {
    comprehension = "오늘은 이야기 속 질문에 답한 기록이 없어요.";
  } else {
    const lines = input.comprehension.map(({ type, result }) => {
      const label = TYPE_LABEL[type];
      switch (result) {
        case "all":
          return `${label}은 모두 잘 맞혔어요.`;
        case "most":
          return `${label}은 대부분 맞혔고, 한두 가지는 헷갈려 했어요.`;
        case "some":
          return `${label}은 일부만 맞혔어요. 이야기를 다시 떠올려 보면 좋겠어요.`;
        case "none":
          return `${label}은 아직 어려워했어요. 함께 이야기를 되짚어 보면 좋겠어요.`;
      }
    });
    const missed = input.comprehension.filter((c) => c.result === "some" || c.result === "none");
    if (missed.length > 0) {
      lines.push(
        `${missed.map((m) => TYPE_LABEL[m.type]).join(", ")}에 대해 아이와 이야기를 나눠 보세요. 정답을 가르치기보다 이야기 속 장면을 같이 떠올려 보는 정도면 충분해요.`,
      );
    }
    comprehension = lines.join("\n");
  }

  let prompts = input.parentPrompts.slice(0, 3);
  for (const p of FALLBACK_PROMPTS) {
    if (prompts.length >= 2) break;
    prompts.push(p);
  }
  prompts = prompts.slice(0, 3);

  return { choices, comprehension, prompts };
}
