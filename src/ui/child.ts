import type { Action, View } from "../story/types";
import { STRINGS } from "./strings";
import type { ResolvedArt, ResolvedOverlay } from "./art";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ChildDispatch = (a: DistributiveOmit<Action, "at">) => void;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function optionList(
  options: { id: string; text: string }[],
  selectedId: string | null,
  onListen: (id: string) => void,
): HTMLElement {
  const list = el("div", "options");
  for (const o of options) {
    const cls = o.id === selectedId ? "btn btn-option selected" : "btn btn-option";
    list.appendChild(button(cls, o.text, () => onListen(o.id)));
  }
  return list;
}

/** 불러오기에 실패한 그림 주소(재렌더 때 깜빡이지 않게 다시 시도하지 않는다) */
const failed = new Set<string>();

/** 그림 요소를 유지할지 판단하는 키(오버레이는 따로 맞춘다) */
function artKey(art: ResolvedArt): string {
  return `${art.image}|${art.fallback ?? ""}`;
}

function overlayEl(o: ResolvedOverlay): HTMLImageElement {
  // animate=false면 동작 클래스 없이 끝 위치(변형 없음)에 그린다
  const ov = el("img", o.animate ? `overlay motion-${o.motion}` : "overlay");
  ov.alt = "";
  ov.draggable = false;
  ov.dataset.key = o.key;
  ov.style.left = `${o.x * 100}%`;
  ov.style.top = `${o.y * 100}%`;
  ov.style.width = `${o.size * 100}%`;
  ov.addEventListener("error", () => {
    failed.add(o.src);
    ov.remove();
  });
  ov.src = o.src;
  return ov;
}

/**
 * 오버레이 맞추기: 같은 key의 요소는 그대로 둬(재생 중이면 계속, 끝났으면 끝 위치) 다시 틀지 않는다.
 * 새로 생긴 것만 만들고, 빠진 것은 지운다.
 */
function syncOverlays(box: HTMLElement, art: ResolvedArt): void {
  const want = (art.overlays ?? []).filter((o) => !failed.has(o.src));
  const keys = new Set(want.map((o) => o.key));
  const have = new Map<string, HTMLElement>();
  for (const c of Array.from(box.querySelectorAll<HTMLElement>(":scope > .overlay"))) {
    const k = c.dataset.key ?? "";
    if (keys.has(k) && !have.has(k)) have.set(k, c);
    else c.remove();
  }
  for (const o of want) if (!have.has(o.key)) box.appendChild(overlayEl(o));
}

/**
 * 그림 영역. 그림 후보를 차례로 시도하고 모두 실패하면 영역을 지우고 has-scene을 뗀다(글만 남음).
 * 오버레이 애니메이션은 animate=true인 요소가 만들어질 때 1회 재생되고 끝 상태로 멈춘다.
 */
function sceneEl(wrap: HTMLElement, art: ResolvedArt): HTMLElement | null {
  const srcs = [art.image, art.fallback].filter((x): x is string => !!x && !failed.has(x));
  if (srcs.length === 0) return null;
  const box = el("div", "scene");
  box.dataset.key = artKey(art);
  const img = el("img", "scene-img");
  img.alt = "";
  img.draggable = false;
  let i = 0;
  img.addEventListener("error", () => {
    failed.add(srcs[i]!);
    i += 1;
    if (i < srcs.length) {
      img.src = srcs[i]!;
      return;
    }
    box.remove();
    wrap.classList.remove("has-scene");
  });
  img.src = srcs[0]!;
  box.appendChild(img);
  syncOverlays(box, art);
  return box;
}

/**
 * art가 null이면 그림을 그리지 않는다(그림 끄기 또는 그림 없는 화면).
 * 같은 그림으로 다시 그릴 때는 그림 요소를 그대로 두고 오버레이만 맞춰, 이미 나온 오버레이가 다시 돌지 않게 한다.
 */
export function renderChild(root: HTMLElement, view: View, dispatch: ChildDispatch, art: ResolvedArt | null = null): void {
  const prevWrap = root.firstElementChild;
  const prevScene = prevWrap?.classList.contains("child") ? prevWrap.querySelector<HTMLElement>(":scope > .scene") : null;
  const keep = art && prevScene && prevScene.dataset.key === artKey(art) ? prevScene : null;
  let wrap: HTMLElement;
  if (keep) {
    wrap = prevWrap as HTMLElement;
    if (art) syncOverlays(keep, art);
    for (const c of Array.from(wrap.children)) if (c !== keep) c.remove();
    for (const c of Array.from(root.children)) if (c !== wrap) c.remove();
  } else {
    root.textContent = "";
    wrap = el("div", "child");
    root.appendChild(wrap);
    const scene = art && view.screen !== "parent_handoff" ? sceneEl(wrap, art) : null;
    if (scene) {
      wrap.appendChild(scene);
      wrap.classList.add("has-scene");
    }
  }

  if (view.screen === "parent_handoff") {
    wrap.appendChild(el("p", "child-text", STRINGS.parentHandoff));
    return;
  }

  // 그림책 지면처럼 글은 그림 위 빈 곳(하늘)에 얹는 상자 하나에 모은다
  const text = el("div", "page-text");
  wrap.appendChild(text);

  const replay = () => button("btn btn-secondary", STRINGS.replay, () => dispatch({ type: "replay" }));

  if (view.screen === "choice") {
    text.appendChild(el("p", "child-text prompt", view.prompt));
    wrap.appendChild(
      optionList(
        view.options.map((o) => ({ id: o.id, text: o.label })),
        view.selectedOptionId,
        (id) => dispatch({ type: "listen", optionId: id }),
      ),
    );
    const sel = view.selectedOptionId;
    const actions = el("div", "actions");
    if (sel) {
      actions.appendChild(
        button("btn btn-primary", STRINGS.confirm, () => dispatch({ type: "confirm", optionId: sel })),
      );
    }
    actions.appendChild(replay());
    wrap.appendChild(actions);
    return;
  }

  if (view.screen === "why" || view.screen === "comprehension") {
    text.appendChild(el("p", "child-text prompt", view.prompt));
    const isWhy = view.screen === "why";
    const feedback = view.screen === "comprehension" ? view.feedback : null;
    if (feedback === null) {
      wrap.appendChild(
        optionList(view.options, view.selectedOptionId, (id) => dispatch({ type: "listen", optionId: id })),
      );
    }
    const actions = el("div", "actions");
    const sel = view.selectedOptionId;
    if (feedback === null && sel) {
      actions.appendChild(
        button("btn btn-primary", STRINGS.confirm, () =>
          dispatch({ type: isWhy ? "answerWhy" : "answerQuestion", optionId: sel }),
        ),
      );
    }
    if (feedback !== null) {
      text.appendChild(el("p", "child-text feedback", feedback));
      if (view.screen === "comprehension" && view.nextVisible) {
        actions.appendChild(button("btn btn-primary", STRINGS.next, () => dispatch({ type: "next" })));
      }
    }
    actions.appendChild(replay());
    wrap.appendChild(actions);
    return;
  }

  // BodyView: 한 페이지(문단 1개)만. 페이지 번호는 아이 화면에 표시하지 않는다
  for (const p of view.paragraphs) text.appendChild(el("p", "child-text child-page", p));
  const actions = el("div", "actions");
  if (view.nextVisible) {
    actions.appendChild(button("btn btn-primary", STRINGS.next, () => dispatch({ type: "next" })));
  }
  actions.appendChild(replay());
  wrap.appendChild(actions);
}
