import { describe, expect, it } from "vitest";
import fixture from "./fixtures/mini.json";
import heungbu from "../src/data/heungbu.json";
import ant from "../src/data/ant.json";
import { CHARS_PER_MINUTE, askChars, countChars, enumeratePaths, renderTranscript } from "../src/story/transcript";
import { ASK_ON, storyAsk } from "./helpers-ask";
import { VALID_CONDITIONS, conditionsSlug, type Conditions, type Story } from "../src/story/types";
import { STRINGS } from "../src/ui/strings";

const stories: Story[] = [fixture as unknown as Story, heungbu as unknown as Story, ant as unknown as Story];

function expectedPathCount(story: Story, c: Conditions): number {
  if (!c.branching) return 1;
  const ks = story.choicePoints.map((cp) => cp.options.length);
  if (c.mismatch === "rewind") return ks.reduce((a, k) => a * (1 + (k - 1) + (k - 1) ** 2), 1);
  return ks.reduce((a, k) => a * k, 1);
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

for (const story of stories) {
  describe(`대본 — ${story.id}`, () => {
    it("fixture 경로 수: off 1, converge 12, rewind 63", () => {
      const n = (c: Conditions) => enumeratePaths(story, c).length;
      expect(VALID_CONDITIONS.map(n)).toEqual([1, 63, 63, 12, 12]);
    });

    for (const c of VALID_CONDITIONS) {
      describe(conditionsSlug(c), () => {
        const paths = enumeratePaths(story, c);

        it("경로 수가 공식과 일치", () => {
          expect(paths).toHaveLength(expectedPathCount(story, c));
          expect(new Set(paths.map((p) => p.label)).size).toBe(paths.length);
        });

        it("정답 사실(answerFact, 배열이면 각 원소)이 모든 경로의 이야기 대본에 나온다", () => {
          const facts = story.comprehension.flatMap((q) => (Array.isArray(q.answerFact) ? q.answerFact : [q.answerFact]));
          for (const p of paths) {
            const tr = renderTranscript(story, c, p.choicesPerPoint);
            const text = tr.storyLines.map((l) => l.text).join("\n");
            for (const f of facts) expect(text, `${p.label} / ${f}`).toContain(f);
          }
        });

        if (c.mismatch === "converge") {
          it("다른 선택 경로의 대본에 원작 consequence 첫 문단이 들어 있다", () => {
            const cp = story.choicePoints[0]!;
            const orig = cp.options.find((o) => o.matchesOriginal)!;
            const other = cp.options.find((o) => !o.matchesOriginal)!;
            const rest = story.choicePoints.slice(1).map((x) => [x.options.find((o) => o.matchesOriginal)!.id]);
            const tr = renderTranscript(story, c, [[other.id], ...rest]);
            expect(tr.storyLines.map((l) => l.text).join("\n")).toContain(orig.consequence![0]!);
          });
        }

        if (c.mismatch === "rewind") {
          it('"다시 골라" 횟수 = 1회째 다른 선택이 있었던 선택 지점 수(1회째 contrast 뒤에만)', () => {
            for (const p of paths) {
              const tr = renderTranscript(story, c, p.choicesPerPoint);
              const full = tr.lines.map((l) => l.text).join("\n");
              const firstDifferent = p.choicesPerPoint.filter((seq) => seq.length >= 2).length;
              expect(count(full, "다시 골라"), p.label).toBe(firstDifferent);
              for (const l of tr.lines.filter((x) => x.text.includes("다시 골라"))) {
                expect(l.nodeId).toMatch(/\.rewind\.contrast#1$/);
                expect(l.text.endsWith(STRINGS.chooseAgain)).toBe(true);
              }
            }
          });
        } else {
          it('"다시 골라"는 나오지 않는다', () => {
            for (const p of paths) {
              const tr = renderTranscript(story, c, p.choicesPerPoint);
              expect(tr.lines.some((l) => l.text.includes("다시 골라"))).toBe(false);
            }
          });
        }
      });
    }

    it("rewind [다른, 다른, 강제] 대본: 다시 골라 1번, contrastFinal, 원작 consequence#3", () => {
      const c: Conditions = { branching: true, mismatch: "rewind", askWhy: true };
      const tr = renderTranscript(story, c, [["c1b", "c1b"], ["c2a"], ["c3a"]]);
      const full = tr.lines.map((l) => l.text).join("\n");
      expect(count(full, "다시 골라")).toBe(1);
      expect(tr.nodeIds).toContain("c1.c1b.rewind.contrastFinal#2");
      expect(tr.nodeIds).toContain("c1.c1a.consequence#3");
    });

    it("라벨에 선택 내역이 들어간다", () => {
      const c: Conditions = { branching: true, mismatch: "rewind", askWhy: false };
      const labels = enumeratePaths(story, c).map((p) => p.label);
      expect(labels).toContain("c1 원작(c1a) / c2 원작(c2a) / c3 원작(c3a)");
      expect(labels).toContain("c1 다른(c1b)→다른(c1b)→강제 / c2 다른(c2b)→원작(c2a) / c3 원작(c3a)");
      expect(enumeratePaths(story, VALID_CONDITIONS[0]!)[0]!.label).toBe("선택 없음(원작 서술)");
    });

    it("글자 수(공백 제외)·분 추정", () => {
      expect(countChars("가 나\n다 ")).toBe(3);
      const tr = renderTranscript(story, VALID_CONDITIONS[0]!, [[], [], []]);
      const sum = tr.storyLines.reduce((a, l) => a + countChars(l.text), 0);
      expect(tr.storyChars).toBe(sum);
      expect(tr.storyMinutes).toBeCloseTo(sum / CHARS_PER_MINUTE);
      expect(tr.totalChars).toBeGreaterThan(tr.storyChars);
      expect(CHARS_PER_MINUTE).toBe(270);
    });

    it("askWhy on/off는 경로 수가 같고 why 프롬프트만 다르다", () => {
      const on: Conditions = { branching: true, mismatch: "converge", askWhy: true };
      const off: Conditions = { branching: true, mismatch: "converge", askWhy: false };
      expect(enumeratePaths(story, on).length).toBe(enumeratePaths(story, off).length);
      const a = renderTranscript(story, on, [["c1a"], ["c2a"], ["c3a"]]);
      const b = renderTranscript(story, off, [["c1a"], ["c2a"], ["c3a"]]);
      expect(a.lines.filter((l) => l.text === STRINGS.whyPrompt)).toHaveLength(3);
      expect(a.lines.filter((l) => l.text !== STRINGS.whyPrompt)).toEqual(b.lines);
    });
  });
}

describe("흥부와 놀부 원작 복원", () => {
  const h = heungbu as unknown as Story;
  it("척추에 p2n이 c2와 p3 사이에 있다", () => {
    expect(h.spine.map((n) => n.id)).toEqual(["p1", "c1", "p2", "c2", "p2n", "p3", "c3", "p4", "end"]);
  });
  it("원작 경로 ≤ 2,000자, 되돌리기 최장 ≤ 2,500자", () => {
    const conv: Conditions = { branching: true, mismatch: "converge", askWhy: false };
    const orig = h.choicePoints.map((cp) => [cp.options.find((o) => o.matchesOriginal)!.id]);
    expect(renderTranscript(h, conv, orig).storyChars).toBeLessThanOrEqual(2000);
    const rw: Conditions = { branching: true, mismatch: "rewind", askWhy: false };
    const longest = Math.max(...enumeratePaths(h, rw).map((p) => renderTranscript(h, rw, p.choicesPerPoint).storyChars));
    expect(longest).toBeLessThanOrEqual(2500);
  });
  it("이해 질문 중 하나는 p2n을 가리킨다", () => {
    expect(h.comprehension.some((q) => q.refersTo.includes("p2n"))).toBe(true);
  });
});

describe("askChars·묻기 제외 대본", () => {
  it("storyAsk c1: intro 10 + 대답 14 + 6 = 30", () => {
    // intro "다람쥐한테 물어볼까?" → 10자, bird.q1 → 14자, bird.q2 → 6자
    expect(askChars(storyAsk)).toEqual({ perPoint: [{ cpId: "c1", chars: 30 }], total: 30 });
  });
  it("실제 흥부 묻기 글자 수 > 0", () => expect(askChars(heungbu as unknown as Story).total).toBeGreaterThan(0));
  it("ask 없는 이야기는 빈 표", () => expect(askChars(fixture as unknown as Story)).toEqual({ perPoint: [], total: 0 }));
  it("askLayer 켠 설정으로도 대본은 묻기를 건너뛴다", () => {
    const c: Conditions = { branching: true, mismatch: "converge", askWhy: false };
    const tr = renderTranscript(storyAsk, c, [["c1a"], ["c2a"], ["c3a"]], ASK_ON);
    expect(tr.nodeIds.filter((n) => n.includes(".ask"))).toEqual([]);
  });
});
