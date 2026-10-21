/**
 * 장면 그림 해석 (순수 함수, DOM 없음).
 * 장면 id = 본문 노드 id(#n 접미사 제외). 파일: img/<storyId>/<장면 id의 '.'→'_'>.webp
 * - passage·consequence·ending: 자기 장면
 * - bridge·contrast·contrastFinal·echo·offNarration: 같은 선택지의 consequence 장면(없으면 직전 passage)
 *   단 art.scenes에 그 노드 자체의 그림이 적혀 있으면 그것을 쓴다
 * - 선택·why·이해 질문: 직전에 보여준 그림 유지
 * 오버레이: art.motions의 그 장면·그 페이지에 처음 진입할 때 animate=true로 1회 재생.
 * 그 뒤 같은 그림이 보이는 동안(다음 페이지·재사용 화면·선택·질문 화면)은 animate=false로 마지막 위치에 남는다.
 * fly_away는 화면 밖으로 나가므로 재생 뒤에는 남기지 않는다. 그림이 바뀌면 남은 오버레이도 사라진다.
 */
import type { ArtMotion, Conditions, Story, View } from "../story/types";

export interface ResolvedOverlay {
  src: string;
  motion: ArtMotion["motion"];
  x: number;
  y: number;
  size: number;
  /** false면 동작 없이 끝 위치에 정지 */
  animate: boolean;
  /** 오버레이 식별자(장면|페이지|파일|동작). 재렌더에서 같은 요소를 유지하는 데 쓴다 */
  key: string;
}
export interface ResolvedArt {
  image: string | null;
  /** image를 못 불러오면 시도할 다음 그림 */
  fallback?: string | null;
  /** 비어 있으면 생략 */
  overlays?: ResolvedOverlay[];
  /** 글을 그림 오른쪽 위에 놓을 때만 "right"(기본 왼쪽 위) */
  textSide?: "right";
}

const NO_ART: ResolvedArt = { image: null };

const base = (): string => import.meta.env.BASE_URL;

/** 노드 id에서 rewind 시도 접미사(#n) 제거 */
export function sceneIdOf(nodeId: string): string {
  return nodeId.replace(/#\d+$/, "");
}

export function sceneFile(sceneId: string): string {
  return `${sceneId.replace(/\./g, "_")}.webp`;
}

/** 장면 그림 경로. art.scenes에 null로 적혀 있으면 null */
function imageOf(story: Story, sceneId: string): string | null {
  const entry = story.art?.scenes?.[sceneId];
  if (entry && entry.image === null) return null;
  const file = entry?.image ?? sceneFile(sceneId);
  return `${base()}img/${story.id}/${file}`;
}

/** 그 장면의 page번째(1부터) 그림. art.pages가 있으면 페이지별 파일, 없으면 장면 그림 하나. page가 -1이면 마지막 페이지 */
function imageAt(story: Story, sceneId: string, page: number): string | null {
  const list = story.art?.pages?.[sceneId];
  if (!list || list.length === 0) return imageOf(story, sceneId);
  const file = page < 0 ? list[list.length - 1]! : (list[page - 1] ?? list[list.length - 1]!);
  return `${base()}img/${story.id}/${file}`;
}

/** choice point 바로 앞 척추 passage id */
function passageBefore(story: Story, cpId: string): string | null {
  const i = story.spine.findIndex((n) => n.type === "choice" && n.id === cpId);
  for (let j = i - 1; j >= 0; j--) {
    const n = story.spine[j]!;
    if (n.type === "passage") return n.id;
  }
  return null;
}

/** 재사용 화면이 빌려 올 consequence 장면 id. 모르면 null */
function consequenceFor(story: Story, sceneId: string, conditions?: Conditions): string | null {
  const parts = sceneId.split(".");
  const [cpId, optId] = parts;
  const last = parts[parts.length - 1];
  if (!cpId || !optId) return null;
  if (last === "bridge" || last === "contrast" || last === "contrastFinal") {
    return [...parts.slice(0, -1), "consequence"].join(".");
  }
  if (last === "offNarration") return `${cpId}.${optId}.consequence`;
  if (last === "echo") {
    const o = story.choicePoints.find((c) => c.id === cpId)?.options.find((x) => x.id === optId);
    if (!o) return null;
    if (o.matchesOriginal) return `${cpId}.${optId}.consequence`;
    const kind = conditions?.mismatch;
    if (kind === "rewind" || kind === "converge" || kind === "altEnding") return `${cpId}.${optId}.${kind}.consequence`;
    return null;
  }
  return null;
}

/** 그 장면·그 페이지의 motion들(아직 animate 미결정) */
function motionsAt(story: Story, sceneId: string, page: number): ResolvedOverlay[] {
  return (story.art?.motions ?? [])
    .filter((x) => x.scene === sceneId && x.page === page)
    .map((m) => ({
      src: `${base()}img/common/${m.overlay}`,
      motion: m.motion,
      x: m.x,
      y: m.y,
      size: m.size,
      animate: true,
      key: `${sceneId}|${page}|${m.overlay}|${m.motion}|${m.x},${m.y}`,
    }));
}

/** 직전 그림과 같은 그림이면 그 오버레이를 정적으로 이어받는다(fly_away 제외) */
function carried(image: string | null, lastArt: ResolvedArt | null): ResolvedOverlay[] {
  if (!image || !lastArt || lastArt.image !== image) return [];
  return (lastArt.overlays ?? []).filter((o) => o.motion !== "fly_away");
}

function withOverlays(a: ResolvedArt, overlays: ResolvedOverlay[]): ResolvedArt {
  return overlays.length > 0 ? { ...a, overlays } : a;
}

/**
 * 본문 화면의 오버레이: 이어받은 것은 정적, 이 페이지의 motion은 처음이면 animate.
 * 같은 페이지 재렌더(직전에 animate=true)면 animate를 유지하고, 이미 정적으로 이어받은 것이면 다시 틀지 않는다.
 */
function bodyOverlays(story: Story, sceneId: string, page: number, image: string | null, lastArt: ResolvedArt | null) {
  const prev = carried(image, lastArt);
  const here = motionsAt(story, sceneId, page);
  const hereKeys = new Set(here.map((o) => o.key));
  const kept = prev.filter((o) => !hereKeys.has(o.key)).map((o) => ({ ...o, animate: false }));
  const now = here.map((o) => {
    const before = prev.find((p) => p.key === o.key);
    return before ? { ...o, animate: before.animate } : o;
  });
  return [...kept, ...now];
}

export function resolveArt(
  story: Story,
  view: View,
  lastArt: ResolvedArt | null,
  conditions?: Conditions,
): ResolvedArt {
  const a = resolveImage(story, view, lastArt, conditions);
  const stem = a.image?.split("/").pop()?.replace(/\.[^.]+$/, "");
  return stem && story.art?.textRight?.includes(stem) ? { ...a, textSide: "right" } : a;
}

function resolveImage(
  story: Story,
  view: View,
  lastArt: ResolvedArt | null,
  conditions?: Conditions,
): ResolvedArt {
  if (view.screen === "parent_handoff") return NO_ART;
  if (view.screen === "choice" || view.screen === "why" || view.screen === "comprehension") {
    if (!lastArt) return NO_ART;
    const still = carried(lastArt.image, lastArt).map((o) => ({ ...o, animate: false }));
    return withOverlays({ image: lastArt.image, fallback: lastArt.fallback ?? null }, still);
  }
  const sceneId = sceneIdOf(view.nodeId);
  const withOverlay = (a: ResolvedArt): ResolvedArt =>
    withOverlays(a, bodyOverlays(story, sceneId, view.page, a.image, lastArt));

  const reuse = view.screen === "bridge" || view.screen === "contrast" || view.screen === "echo";
  if (!reuse) return withOverlay({ image: imageAt(story, sceneId, view.page), fallback: null });

  // 그 노드 자체 그림이 art.pages·art.scenes에 명시돼 있으면 우선
  if (story.art?.pages?.[sceneId]) return withOverlay({ image: imageAt(story, sceneId, view.page), fallback: null });
  const own = story.art?.scenes?.[sceneId];
  if (own && own.image !== null) return withOverlay({ image: imageOf(story, sceneId), fallback: null });

  // echo는 이어질 consequence의 첫 그림, bridge·contrast는 앞선 consequence의 마지막 그림으로 이어 붙인다
  const conseq = consequenceFor(story, sceneId, conditions);
  const prev = view.choicePointId ? passageBefore(story, view.choicePointId) : null;
  const conseqPage = view.screen === "echo" ? 1 : -1;
  const candidates = [
    conseq ? imageAt(story, conseq, conseqPage) : null,
    prev ? imageAt(story, prev, -1) : null,
  ].filter((x): x is string => x !== null);
  return withOverlay({ image: candidates[0] ?? null, fallback: candidates[1] ?? null });
}
