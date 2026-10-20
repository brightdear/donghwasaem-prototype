/**
 * 세션 로그 + 이야기 → ReportInput. 참가자 코드·session_id는 결과에 넣지 않는다(AC-16).
 */

import type { LogEvent, SessionRecord } from "../log/types";
import type { QuestionType, Story } from "../story/types";
import type { ComprehensionResult, ReportChoice, ReportInput } from "./types";

const TYPE_ORDER: QuestionType[] = ["explicit", "inference", "sequence"];

export function categorize(correct: number, total: number): ComprehensionResult {
  if (correct === total) return "all";
  if (correct === 0) return "none";
  return correct * 2 > total ? "most" : "some";
}

export function summarize(record: SessionRecord, story: Story): ReportInput {
  const events = record.events;
  const branching = record.meta.conditions.branching;
  const choices: ReportChoice[] = [];

  if (branching) {
    for (const cp of story.choicePoints) {
      const mine = events.filter((e) => e.choice_point_id === cp.id);
      const confirms = mine.filter((e) => e.event_type === "choice_confirm");
      const forcedEv = mine.find((e) => e.event_type === "forced_original");
      const first = confirms.find((e) => e.attempt === 1) ?? confirms[0];
      if (!first) continue;
      const labelOf = (id: string | undefined) => cp.options.find((o) => o.id === id)?.label ?? "";
      const original = cp.options.find((o) => o.matchesOriginal);
      const lastConfirm = confirms[confirms.length - 1] as LogEvent;
      const finalId = forcedEv ? (forcedEv.option_id ?? original?.id) : lastConfirm.option_id;
      const attempts = Math.max(1, ...mine.map((e) => e.attempt ?? 1));
      const whyEv = mine.find((e) => e.event_type === "why_answer");
      const reasonText = whyEv
        ? cp.options.flatMap((o) => o.why).find((w) => w.id === whyEv.option_id)?.text
        : undefined;
      const choice: ReportChoice = {
        prompt: cp.prompt,
        original: original?.label ?? "",
        firstChosen: labelOf(first.option_id),
        firstMatchesOriginal: first.matches_original ?? false,
        finalChosen: labelOf(finalId),
        attempts,
        forced: forcedEv !== undefined,
      };
      if (reasonText) choice.reasonText = reasonText;
      choices.push(choice);
    }
  }

  const comprehension: ReportInput["comprehension"] = [];
  for (const type of TYPE_ORDER) {
    const answers = events.filter(
      (e) => e.event_type === "comprehension_answer" && e.question_type === type,
    );
    if (answers.length === 0) continue;
    const correct = answers.filter((e) => e.correct === true).length;
    comprehension.push({ type, result: categorize(correct, answers.length) });
  }

  return {
    storyTitle: story.title,
    branching,
    choices,
    comprehension,
    parentPrompts: [...story.parentPrompts],
  };
}
