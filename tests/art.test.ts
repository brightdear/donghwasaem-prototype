import { describe, expect, it } from "vitest";
import fixture from "./fixtures/mini.json";
import heungbu from "../src/data/heungbu.json";
import { resolveArt, sceneFile, sceneIdOf } from "../src/ui/art";
import type { BodyScreen, BodyView, Conditions, Story, View } from "../src/story/types";

const story = fixture as unknown as Story;
const B = import.meta.env.BASE_URL;
const img = (id: string, file: string) => `${B}img/${id}/${file}`;

function body(screen: BodyScreen, nodeId: string, page = 1, cp: string | null = null): BodyView {
  return { screen, nodeId, choicePointId: cp, paragraphs: ["x"], page, pageCount: 2, nextVisible: false };
}
const choice: View = {
  screen: "choice",
  nodeId: "c1",
  choicePointId: "c1",
  attempt: 1,
  prompt: "?",
  options: [],
  selectedOptionId: null,
};
const CONV: Conditions = { branching: true, mismatch: "converge", askWhy: true };

describe("장면 id·파일 규칙", () => {
  it("'.'→'_', #n 접미사 제거", () => {
    expect(sceneFile("c1.c1b.rewind.consequence")).toBe("c1_c1b_rewind_consequence.webp");
    expect(sceneIdOf("c1.c1b.rewind.consequence#2")).toBe("c1.c1b.rewind.consequence");
  });
});

describe("resolveArt", () => {
  it("passage → 자기 장면(기본 경로 추정)", () => {
    const h = heungbu as unknown as Story;
    expect(resolveArt(h, body("passage", "p1"), null)).toEqual({ image: img("heungbu", "p1.webp"), fallback: null });
  });

  it("art.scenes 파일명 우선, null이면 그림 없음", () => {
    expect(resolveArt(story, body("passage", "p3"), null).image).toBe(img("mini", "oak_tree.webp"));
    expect(resolveArt(story, body("consequence", "c3.c3b.converge.consequence", 1, "c3"), null).image).toBeNull();
  });

  it("bridge → 같은 선택지 consequence 재사용, 다음 후보는 직전 passage", () => {
    const a = resolveArt(story, body("bridge", "c1.c1b.converge.bridge", 1, "c1"), null, CONV);
    expect(a.image).toBe(img("mini", "c1_c1b_converge_consequence.webp"));
    expect(a.fallback).toBe(img("mini", "p1.webp"));
  });

  it("consequence 그림이 null이면 bridge는 직전 passage", () => {
    const a = resolveArt(story, body("bridge", "c3.c3b.converge.bridge", 1, "c3"), null, CONV);
    expect(a.image).toBe(img("mini", "oak_tree.webp"));
  });

  it("contrast(rewind #n) → rewind.consequence 재사용", () => {
    const a = resolveArt(story, body("contrast", "c1.c1b.rewind.contrast#1", 1, "c1"), null);
    expect(a.image).toBe(img("mini", "c1_c1b_rewind_consequence.webp"));
  });

  it("echo → 원작이면 consequence, 다른 선택이면 조건의 consequence, offNarration도 consequence", () => {
    expect(resolveArt(story, body("echo", "c1.c1a.echo", 1, "c1"), null).image).toBe(img("mini", "c1_c1a_consequence.webp"));
    expect(resolveArt(story, body("echo", "c1.c1b.echo", 1, "c1"), null, CONV).image).toBe(
      img("mini", "c1_c1b_converge_consequence.webp"),
    );
    expect(resolveArt(story, body("echo", "c1.c1a.offNarration", 1, "c1"), null).image).toBe(img("mini", "c1_c1a_consequence.webp"));
  });

  it("선택 화면 → 직전 그림 유지, 직전이 없으면 그림 없음", () => {
    const last = resolveArt(story, body("passage", "p1", 1), null);
    expect(resolveArt(story, choice, last)).toEqual({ image: img("mini", "p1.webp"), fallback: null });
    expect(resolveArt(story, choice, null)).toEqual({ image: null });
  });

  it("altEnding 결말 → end_alt", () => {
    expect(resolveArt(story, body("ending", "end.alt"), null).image).toBe(img("mini", "end_alt.webp"));
  });

  it("motion은 해당 페이지에 처음 들어올 때 animate", () => {
    expect(resolveArt(story, body("passage", "p1", 1), null).overlays).toBeUndefined();
    const o = resolveArt(story, body("passage", "p1", 2), null).overlays;
    expect(o).toHaveLength(1);
    expect(o?.[0]).toMatchObject({ src: `${B}img/common/acorn.webp`, motion: "fall", x: 0.6, y: 0.4, size: 0.25, animate: true });
    // rewind #n 노드도 장면 id로 맞춘다
    const r = resolveArt(story, body("consequence", "c1.c1b.rewind.consequence#1", 1, "c1"), null).overlays;
    expect(r?.[0]?.motion).toBe("walk_in");
  });

  it("같은 페이지 재렌더에서는 animate 유지(요소 key 동일)", () => {
    const first = resolveArt(story, body("passage", "p1", 2), null);
    const again = resolveArt(story, body("passage", "p1", 2), first);
    expect(again.overlays).toEqual(first.overlays);
  });

  it("motion 페이지 이후 같은 장면의 다음 페이지·선택 화면에서 overlay가 animate=false로 유지", () => {
    const s = structuredClone(story);
    s.art!.motions![0]!.page = 1; // p1 문단 2개: 1쪽에서 재생, 2쪽은 그 뒤
    const p1 = resolveArt(s, body("passage", "p1", 1), null);
    expect(p1.overlays?.[0]?.animate).toBe(true);
    // 다음 페이지(같은 그림)
    const p2 = resolveArt(s, body("passage", "p1", 2), p1);
    expect(p2.overlays).toHaveLength(1);
    expect(p2.overlays?.[0]).toMatchObject({ motion: "fall", animate: false, key: p1.overlays?.[0]?.key });
    // 선택 화면 → 같은 그림 + 정적 오버레이, 선택 재렌더에서도 유지
    const ch = resolveArt(s, choice, p2);
    expect(ch.image).toBe(img("mini", "p1.webp"));
    expect(ch.overlays?.[0]).toMatchObject({ motion: "fall", animate: false });
    expect(resolveArt(s, { ...choice, selectedOptionId: "c1a" } as View, ch).overlays?.[0]?.animate).toBe(false);
  });

  it("재사용 화면(contrast)·재진입(#2)에서는 정적으로 유지하고 다시 틀지 않는다", () => {
    const c1 = resolveArt(story, body("consequence", "c1.c1b.rewind.consequence#1", 1, "c1"), null);
    expect(c1.overlays?.[0]?.animate).toBe(true);
    const ct = resolveArt(story, body("contrast", "c1.c1b.rewind.contrast#1", 1, "c1"), c1);
    expect(ct.image).toBe(c1.image);
    expect(ct.overlays?.[0]).toMatchObject({ motion: "walk_in", animate: false });
    const ch = resolveArt(story, { ...choice, nodeId: "c1#2", attempt: 2 } as View, ct);
    const c2 = resolveArt(story, body("consequence", "c1.c1b.rewind.consequence#2", 1, "c1"), ch);
    expect(c2.overlays).toHaveLength(1);
    expect(c2.overlays?.[0]?.animate).toBe(false);
  });

  it("fly_away 뒤에는 없음", () => {
    const s = structuredClone(story);
    s.art!.motions = [{ scene: "p1", page: 1, overlay: "bird.webp", motion: "fly_away", x: 0.5, y: 0.3, size: 0.2 }];
    const a = resolveArt(s, body("passage", "p1", 1), null);
    expect(a.overlays?.[0]).toMatchObject({ motion: "fly_away", animate: true });
    expect(resolveArt(s, body("passage", "p1", 1), a).overlays?.[0]?.animate).toBe(true); // 재렌더
    expect(resolveArt(s, body("passage", "p1", 2), a).overlays).toBeUndefined();
    expect(resolveArt(s, choice, a).overlays).toBeUndefined();
  });

  it("장면(그림)이 바뀌면 오버레이 초기화", () => {
    const p2 = resolveArt(story, body("passage", "p1", 2), null);
    const echo = resolveArt(story, body("echo", "c1.c1a.echo", 1, "c1"), p2);
    expect(echo.image).toBe(img("mini", "c1_c1a_consequence.webp"));
    expect(echo.overlays).toBeUndefined();
    expect(resolveArt(story, body("passage", "p2", 1), p2).overlays).toBeUndefined();
  });

  it("parent_handoff → 그림 없음", () => {
    expect(resolveArt(story, { screen: "parent_handoff" }, null)).toEqual({ image: null });
  });
});
