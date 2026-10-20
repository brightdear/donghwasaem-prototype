import { describe, expect, it } from "vitest";
import { auditSession } from "../src/log/audit";
import type { EngineLogEvent } from "../src/log/types";
import { makeMeta, rec } from "./helpers-log";

const story = { choicePointIds: ["c1", "c2", "c3"], questionCount: 2 };
const E = (event_type: EngineLogEvent["event_type"], extra: Partial<EngineLogEvent> = {}): EngineLogEvent => ({
  event_type,
  at: 0,
  ...extra,
});
const confirm = (cp: string) =>
  E("choice_confirm", { choice_point_id: cp, rt_ms: 100, rt_basis: "tts_end", attempt: 1 });
const answers = () => [
  E("comprehension_answer", { rt_ms: 5, rt_basis: "shown" }),
  E("comprehension_answer", { rt_ms: 5, rt_basis: "shown" }),
];
const onOk = (): EngineLogEvent[] => [
  E("session_start"),
  confirm("c1"),
  confirm("c2"),
  confirm("c3"),
  ...answers(),
  E("session_end"),
];
const run = (
  evs: EngineLogEvent[],
  branching = true,
  status: "completed" | "open" | "abandoned" | "dropout" = "completed",
) => auditSession(rec(makeMeta("P01", 1, branching), evs, status), story);
const codes = (evs: EngineLogEvent[], b = true) => run(evs, b).violations.map((v) => v.code);

describe("audit", () => {
  it("정상: on 원작만", () => expect(run(onOk())).toEqual({ status: "ok", violations: [] }));

  it("정상: off", () => {
    const evs = [
      E("session_start"),
      ...["c1", "c2", "c3"].map((c) => E("next_click", { choice_point_id: c })),
      ...answers(),
    ];
    expect(run(evs, false).status).toBe("ok");
  });

  it("정상: rewind forced_original 포함", () => {
    const forced = (cp: string) => E("forced_original", { choice_point_id: cp, attempt: 3 });
    const evs = [
      E("session_start"),
      confirm("c1"),
      forced("c2"),
      confirm("c3"),
      ...answers(),
      E("report_view"),
      E("report_source"),
    ];
    expect(run(evs).status).toBe("ok");
  });

  it("(a) session_start 0개 또는 2개", () => {
    expect(codes(onOk().slice(1))).toContain("a");
    expect(codes([E("session_start"), ...onOk()])).toContain("a");
  });

  it("(b) 선택 지점 누락 (on/off)", () => {
    const evs = onOk().filter((e) => e.choice_point_id !== "c2");
    expect(codes(evs)).toEqual(["b"]);
    const off = [E("session_start"), E("next_click", { choice_point_id: "c1" }), ...answers()];
    expect(codes(off, false)).toEqual(["b", "b"]);
  });

  it("(c) comprehension_answer 수 불일치", () => {
    expect(codes(onOk().slice(0, -2))).toEqual(["c"]);
  });

  it("(d) rt_ms 있는데 rt_basis 없음", () => {
    const evs = onOk();
    evs[1] = E("choice_confirm", { choice_point_id: "c1", rt_ms: 100 });
    expect(codes(evs)).toEqual(["d"]);
  });

  it("(e) forced_original이 attempt 3이 아님", () => {
    const evs = [...onOk(), E("forced_original", { choice_point_id: "c1", attempt: 2 })];
    expect(codes(evs)).toEqual(["e"]);
  });

  it("(f) report_source만 있고 report_view 없음", () => {
    expect(codes([...onOk(), E("report_source")])).toEqual(["f"]);
  });

  it("open, abandoned, dropout은 위반 아닌 incomplete", () => {
    for (const s of ["open", "abandoned", "dropout"] as const)
      expect(run([E("screen_enter")], true, s)).toEqual({ status: "incomplete", violations: [] });
  });
});
