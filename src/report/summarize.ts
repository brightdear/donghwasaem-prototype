/**
 * 세션 로그 + 이야기 → ReportInput. 참가자 코드·session_id는 결과에 넣지 않는다(AC-16).
 */

import type { LogEvent, SessionRecord } from "../log/types";
import type { QuestionType, Story } from "../story/types";
import type { ComprehensionResult, ReportAsk, ReportChoice, ReportInput } from "./types";

const TYPE_ORDER: QuestionType[] = ["explicit", "inference", "sequence"];

export function categorize(correct: number, total: number): ComprehensionResult {
  if (correct === total) return "all";
  if (correct === 0) return "none";
  return correct * 2 > total ? "most" : "some";
}

interface ResolvedAsk {
  ask: ReportAsk;
  said: string | undefined;
}

function resolveAsks(record: SessionRecord, story: Story): ResolvedAsk[] {
  const out: ResolvedAsk[] = [];
  for (const e of record.events) {
    if (e.event_type !== "ask_confirm") continue;
    const cp = story.choicePoints.find((c) => c.id === e.choice_point_id);
    const block = cp?.ask;
    if (!cp || !block || !e.question_id) continue;
    const rest = e.question_id.startsWith(`${cp.id}.ask.`) ? e.question_id.slice(cp.id.length + 5) : undefined;
    if (rest === undefined) continue;
    for (const ch of block.characters) {
      const q = ch.questions.find((x) => `${ch.id}.${x.id}` === rest);
      if (!q) continue;
      const via = e.detail?.via === "voice" ? "voice" : "card";
      const t = e.detail?.transcript;
      const said = via === "voice" && typeof t === "string" && t.trim() !== "" ? t : undefined;
      out.push({ ask: { scene: block.sceneLabel ?? cp.prompt, character: ch.name, question: q.text, via }, said });
      break;
    }
  }
  return out;
}

/** summarize().asks와 같은 순서·길이. 음성 인식 글은 부모 화면 전용이며 LLM에 보내지 않는다. */
export function saidByAsk(record: SessionRecord, story: Story): (string | undefined)[] {
  return resolveAsks(record, story).map((r) => r.said);
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
    asks: resolveAsks(record, story).map((r) => r.ask),
  };
}
