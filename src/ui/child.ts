import type { Action, View } from "../story/types";
import { STRINGS } from "./strings";

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

export function renderChild(root: HTMLElement, view: View, dispatch: ChildDispatch): void {
  root.textContent = "";
  const wrap = el("div", "child");
  root.appendChild(wrap);

  if (view.screen === "parent_handoff") {
    wrap.appendChild(el("p", "child-text", STRINGS.parentHandoff));
    return;
  }

  const replay = () => button("btn btn-secondary", STRINGS.replay, () => dispatch({ type: "replay" }));

  if (view.screen === "choice") {
    wrap.appendChild(el("p", "child-text prompt", view.prompt));
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
    wrap.appendChild(el("p", "child-text prompt", view.prompt));
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
      wrap.appendChild(el("p", "child-text feedback", feedback));
      if (view.screen === "comprehension" && view.nextVisible) {
        actions.appendChild(button("btn btn-primary", STRINGS.next, () => dispatch({ type: "next" })));
      }
    }
    actions.appendChild(replay());
    wrap.appendChild(actions);
    return;
  }

  // BodyView: 한 페이지(문단 1개)만. 페이지 번호는 아이 화면에 표시하지 않는다
  for (const p of view.paragraphs) wrap.appendChild(el("p", "child-text child-page", p));
  const actions = el("div", "actions");
  if (view.nextVisible) {
    actions.appendChild(button("btn btn-primary", STRINGS.next, () => dispatch({ type: "next" })));
  }
  actions.appendChild(replay());
  wrap.appendChild(actions);
}
