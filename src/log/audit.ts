import type { SessionRecord } from "./types";

export interface AuditViolation {
  code: string;
  message: string;
}
export interface AuditResult {
  status: "ok" | "violation" | "incomplete";
  violations: AuditViolation[];
}

/** 불변식만 검사한다(순서는 engine.test 담당). open·abandoned·dropout은 "incomplete". */
export function auditSession(
  record: SessionRecord,
  story: { choicePointIds: string[]; questionCount: number },
): AuditResult {
  if (record.meta.status !== "completed") return { status: "incomplete", violations: [] };
  const ev = record.events;
  const v: AuditViolation[] = [];

  const starts = ev.filter((e) => e.event_type === "session_start").length;
  if (starts !== 1) v.push({ code: "a", message: `session_start ${starts}개 (1개여야 함)` });

  const branching = record.meta.conditions.branching;
  for (const cp of story.choicePointIds) {
    const ok = branching
      ? ev.some(
          (e) =>
            e.choice_point_id === cp &&
            (e.event_type === "choice_confirm" ||
              (e.event_type === "forced_original" && e.attempt === 3)),
        )
      : ev.some((e) => e.event_type === "next_click" && e.choice_point_id === cp);
    if (!ok) v.push({ code: "b", message: `선택 지점 ${cp}에 ${branching ? "choice_confirm" : "next_click"} 없음` });
  }

  const answers = ev.filter((e) => e.event_type === "comprehension_answer").length;
  if (answers !== story.questionCount)
    v.push({ code: "c", message: `comprehension_answer ${answers}개 (${story.questionCount}개여야 함)` });

  for (const e of ev) {
    if (e.rt_ms != null && !e.rt_basis)
      v.push({ code: "d", message: `seq ${e.seq}: rt_ms 있는데 rt_basis 없음` });
    if (e.event_type === "forced_original" && e.attempt !== 3)
      v.push({ code: "e", message: `seq ${e.seq}: forced_original이 attempt=${e.attempt}` });
  }

  if (
    ev.some((e) => e.event_type === "report_source") &&
    !ev.some((e) => e.event_type === "report_view")
  )
    v.push({ code: "f", message: "report_source가 있는데 report_view 없음" });

  return { status: v.length ? "violation" : "ok", violations: v };
}
