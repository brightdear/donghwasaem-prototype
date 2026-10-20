import type { ReportResult } from "../report/types";
import { STRINGS } from "./strings";

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

export function renderParentHandoff(root: HTMLElement, onContinue: () => void): void {
  root.textContent = "";
  const wrap = el("div", "child");
  wrap.appendChild(el("p", "handoff-text", STRINGS.parentHandoff));
  const b = el("button", "btn btn-primary", "부모님이 보기");
  b.type = "button";
  const status = el("p", "note");
  b.addEventListener("click", () => {
    if (b.disabled) return;
    b.disabled = true;
    status.textContent = "준비하고 있어요";
    onContinue();
  });
  wrap.appendChild(b);
  wrap.appendChild(status);
  root.appendChild(wrap);
}

export function renderReport(
  root: HTMLElement,
  result: ReportResult,
  onAskedCheck: () => void,
  onDone: () => void,
): void {
  root.textContent = "";
  const wrap = el("div", "report");
  wrap.appendChild(el("h1", undefined, "오늘의 동화 리포트"));
  wrap.appendChild(el("p", undefined, result.text.choices));
  wrap.appendChild(el("p", undefined, result.text.comprehension));

  wrap.appendChild(el("h2", undefined, "오늘 이렇게 물어보세요"));
  const ul = el("ul");
  for (const p of result.text.prompts) ul.appendChild(el("li", undefined, p));
  wrap.appendChild(ul);

  const asked = el("button", "btn btn-primary", STRINGS.askedCheck);
  asked.type = "button";
  const thanks = el("span", "thanks");
  asked.addEventListener("click", () => {
    if (asked.disabled) return;
    asked.disabled = true;
    thanks.textContent = "고마워요";
    onAskedCheck();
  });
  const row = el("div", "actions");
  row.appendChild(asked);
  row.appendChild(thanks);
  wrap.appendChild(row);

  const label = result.source === "llm" ? "AI 문장" : "기본 문장";
  const src = result.fallbackReason ? `${label} (${result.fallbackReason})` : label;
  wrap.appendChild(el("p", "source", src));

  const done = el("button", "btn btn-secondary", "처음으로");
  done.type = "button";
  done.addEventListener("click", onDone);
  wrap.appendChild(done);
  root.appendChild(wrap);
}
