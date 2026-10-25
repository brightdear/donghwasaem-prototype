import { describe, expect, it } from "vitest";
import heungbu from "../src/data/heungbu.json";
import ant from "../src/data/ant.json";
import type { Story } from "../src/story/types";

/**
 * 문장 분리: . ! ? … (닫는 작은따옴표 허용) 뒤 공백에서 나눈다.
 * 작은따옴표 인용('…') 안에서는 나누지 않는다 — 인용 한 덩어리를 한 문장으로 센다.
 */
function splitSentences(t: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (c === "'") quoted = !quoted;
    if (!quoted && /\s/.test(c) && /[.!?…]'?$/.test(t.slice(start, i))) {
      out.push(t.slice(start, i));
      while (i + 1 < t.length && /\s/.test(t[i + 1]!)) i++;
      start = i + 1;
    }
  }
  out.push(t.slice(start));
  return out.filter((s) => s.length > 0);
}

/** 화면 페이지가 되는 배열(문단 1개 = 1페이지) */
function pageArrays(story: Story): { path: string; pages: string[] }[] {
  const out: { path: string; pages: string[] }[] = [];
  for (const n of story.spine) if (n.type === "passage") out.push({ path: n.id, pages: n.paragraphs });
  for (const cp of story.choicePoints) {
    for (const o of cp.options) {
      if (o.consequence) out.push({ path: `${o.id}.consequence`, pages: o.consequence });
      if (o.mismatch) {
        out.push({ path: `${o.id}.rewind.consequence`, pages: o.mismatch.rewind.consequence });
        for (const k of ["converge", "altEnding"] as const) {
          out.push({ path: `${o.id}.${k}.consequence`, pages: o.mismatch[k].consequence });
          out.push({ path: `${o.id}.${k}.bridge`, pages: o.mismatch[k].bridge });
        }
      }
    }
    if (cp.ask) for (const ch of cp.ask.characters) for (const q of ch.questions) out.push({ path: `${cp.id}.ask.${ch.id}.${q.id}`, pages: q.answer });
  }
  out.push({ path: "endings.original", pages: story.endings.original.paragraphs });
  out.push({ path: "endings.alt", pages: story.endings.alt.paragraphs });
  return out;
}

describe("문장 분리", () => {
  it("마침표·물음표·느낌표·말줄임표 뒤에서 나누고, 인용 안은 나누지 않는다", () => {
    expect(splitSentences("하나예요. 둘이에요! 셋일까? 넷…")).toEqual(["하나예요.", "둘이에요!", "셋일까?", "넷…"]);
    expect(splitSentences("말했어요. '안녕. 반가워.' 웃었어요.")).toEqual(["말했어요.", "'안녕. 반가워.'", "웃었어요."]);
  });
});

describe("실제 시나리오: 문단 1개 = 화면 1페이지 = 1~2문장, 70자 이하", () => {
  for (const [name, raw] of [["heungbu", heungbu], ["ant", ant]] as const) {
    const story = raw as unknown as Story;
    it(name, () => {
      const bad: string[] = [];
      for (const { path, pages } of pageArrays(story))
        pages.forEach((p, i) => {
          const n = splitSentences(p).length;
          if (n > 2 || p.length > 70) bad.push(`${path}[${i}] ${n}문장 ${p.length}자: ${p}`);
        });
      expect(bad).toEqual([]);
    });
  }
});
