import type { Conditions, MismatchKind, Story } from "../story/types";
import type { SessionRecord, Settings } from "../log/types";
import { PARTICIPANT_CODE_RE } from "../log/types";
import type { AuditResult } from "../log/audit";
import type { Store } from "../log/store";

export interface ExperimenterDeps {
  settings: Settings;
  saveSettings(s: Settings): void;
  stories: { story: Story; errors: string[] }[];
  store: Store;
  voices: { name: string; voiceURI: string }[];
  koVoiceFound: boolean;
  storagePersisted: boolean | null;
  otherTabOpen?: boolean;
  /** 저장 실패 등 로그 경고 문구(있으면 실험자 화면 경고로 표시) */
  storageWarning?: string;
  onHandoff(cfg: {
    participantCode: string;
    story: Story;
    conditions: Conditions;
    confirmMode: "double" | "single";
    manualReading: boolean;
  }): void;
  onExportCsv(): void;
  onExportJson(): void;
  onClearLogs(): void;
  auditFor(record: SessionRecord): AuditResult;
}

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

function btn(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", `btn ${cls}`, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function labeled(text: string, control: HTMLElement): HTMLLabelElement {
  const l = el("label", "field");
  l.appendChild(el("span", "field-label", text));
  l.appendChild(control);
  return l;
}

const MISMATCH_LABEL: Record<MismatchKind, string> = {
  rewind: "rewind (되감기)",
  converge: "converge (수렴)",
  altEnding: "altEnding (다른 결말)",
};

interface FormState {
  code: string;
  storyId: string;
  branching: boolean;
  mismatch: MismatchKind;
  askWhy: boolean;
  confirmMode: "double" | "single";
  manualReading: boolean;
  keyDraft: string;
}

// 재렌더(조건 토글 등) 사이에 입력값을 유지한다.
let kept: FormState | null = null;

export function renderExperimenter(root: HTMLElement, deps: ExperimenterDeps): void {
  const advanced = new URLSearchParams(location.search).get("advanced") === "1";
  const firstOk = deps.stories.find((s) => s.errors.length === 0);
  const dc = deps.settings.defaultConditions;
  const state: FormState = kept ?? {
    code: "",
    storyId: firstOk ? firstOk.story.id : "",
    branching: dc.branching,
    mismatch: dc.mismatch === "na" ? "rewind" : dc.mismatch,
    askWhy: dc.askWhy === true || dc.askWhy === "na",
    confirmMode: deps.settings.confirmMode,
    manualReading: deps.settings.manualReading,
    keyDraft: "",
  };
  kept = state;

  const rerender = () => renderExperimenter(root, deps);

  const currentConditions = (): Conditions =>
    state.branching
      ? { branching: true, mismatch: state.mismatch, askWhy: state.askWhy }
      : { branching: false, mismatch: "na", askWhy: "na" };

  const patchSettings = (patch: Partial<Settings>) => {
    deps.settings = { ...deps.settings, ...patch };
    deps.saveSettings(deps.settings);
  };

  root.textContent = "";
  const page = el("div", "experimenter");
  page.appendChild(el("h1", undefined, "동화샘 실험자 화면"));

  const warnings = el("div", "warnings");
  if (!deps.koVoiceFound) {
    warnings.appendChild(
      el("p", "warn", "한국어 음성을 찾지 못했어요. 실험자 낭독 모드를 쓰거나 기기 설정을 확인하세요."),
    );
  }
  if (deps.storagePersisted !== true) {
    warnings.appendChild(
      el("p", "warn", "저장 보호 안 됨: 브라우저가 기록을 지울 수 있어요. 세션마다 내보내기를 해 주세요."),
    );
  }
  if (deps.storageWarning) {
    warnings.appendChild(el("p", "warn", deps.storageWarning));
  }
  if (deps.otherTabOpen) {
    warnings.appendChild(el("p", "warn", "다른 탭에서도 이 앱이 열려 있어요. 한 탭만 사용하세요."));
  }
  page.appendChild(warnings);

  const form = el("section", "panel");
  form.appendChild(el("h2", undefined, "세션 설정"));

  const codeInput = el("input");
  codeInput.type = "text";
  codeInput.value = state.code;
  codeInput.placeholder = "예: P01 (리허설은 R01)";
  codeInput.autocomplete = "off";
  const codeNote = el("span", "note");
  const updateCodeNote = () => {
    const c = state.code;
    if (c === "") codeNote.textContent = "";
    else if (!PARTICIPANT_CODE_RE.test(c)) codeNote.textContent = "코드 형식: P 또는 R 뒤에 숫자 2~3자리";
    else if (c.startsWith("R")) codeNote.textContent = "리허설 전용 코드예요. 분석에서 제외됩니다.";
    else codeNote.textContent = "";
  };
  codeInput.addEventListener("input", () => {
    state.code = codeInput.value.trim().toUpperCase();
    updateCodeNote();
  });
  updateCodeNote();
  form.appendChild(labeled("참가자 코드", codeInput));
  form.appendChild(codeNote);

  const storyBox = el("fieldset", "group");
  storyBox.appendChild(el("legend", undefined, "이야기"));
  for (const { story, errors } of deps.stories) {
    const row = el("label", "radio-row");
    const r = el("input");
    r.type = "radio";
    r.name = "story";
    r.checked = state.storyId === story.id;
    r.disabled = errors.length > 0;
    r.addEventListener("change", () => {
      state.storyId = story.id;
    });
    row.appendChild(r);
    row.appendChild(el("span", undefined, `${story.title} (${story.id})`));
    storyBox.appendChild(row);
    if (errors.length > 0) {
      const ul = el("ul", "errors");
      for (const e of errors) ul.appendChild(el("li", undefined, e));
      storyBox.appendChild(ul);
    }
  }
  form.appendChild(storyBox);

  const cond = el("fieldset", "group");
  cond.appendChild(el("legend", undefined, "조건"));
  const brRow = el("label", "radio-row");
  const br = el("input");
  br.type = "checkbox";
  br.checked = state.branching;
  br.addEventListener("change", () => {
    state.branching = br.checked;
    rerender();
  });
  brRow.appendChild(br);
  brRow.appendChild(el("span", undefined, "분기 (끄면 원작 그대로 낭독)"));
  cond.appendChild(brRow);

  const mm = el("select");
  for (const k of ["rewind", "converge", "altEnding"] as MismatchKind[]) {
    const o = el("option", undefined, MISMATCH_LABEL[k]);
    o.value = k;
    mm.appendChild(o);
  }
  mm.value = state.mismatch;
  mm.disabled = !state.branching;
  mm.addEventListener("change", () => {
    state.mismatch = mm.value as MismatchKind;
  });
  cond.appendChild(labeled("원작과 다른 선택 처리", mm));
  if (!state.branching) cond.appendChild(el("span", "note", "na"));

  const awRow = el("label", "radio-row");
  const aw = el("input");
  aw.type = "checkbox";
  aw.checked = state.branching && state.askWhy;
  aw.disabled = !state.branching;
  aw.addEventListener("change", () => {
    state.askWhy = aw.checked;
  });
  awRow.appendChild(aw);
  awRow.appendChild(el("span", undefined, state.branching ? "이유 묻기" : "이유 묻기 (na)"));
  cond.appendChild(awRow);
  form.appendChild(cond);

  const mrRow = el("label", "radio-row");
  const mr = el("input");
  mr.type = "checkbox";
  mr.checked = state.manualReading;
  mr.addEventListener("change", () => {
    state.manualReading = mr.checked;
    patchSettings({ manualReading: mr.checked });
  });
  mrRow.appendChild(mr);
  mrRow.appendChild(el("span", undefined, "실험자 낭독 모드 (기기 음성 끔)"));
  form.appendChild(mrRow);

  if (advanced) {
    const cm = el("select");
    const opts: [string, string][] = [
      ["double", "double (같은 보기 다시 탭 또는 이걸로 할래)"],
      ["single", "single (한 번 탭하면 확정)"],
    ];
    for (const [v, t] of opts) {
      const o = el("option", undefined, t);
      o.value = v;
      cm.appendChild(o);
    }
    cm.value = state.confirmMode;
    cm.addEventListener("change", () => {
      state.confirmMode = cm.value as "double" | "single";
      patchSettings({ confirmMode: state.confirmMode });
    });
    form.appendChild(labeled("확정 방식 (고급)", cm));
  }

  const vs = el("select");
  const auto = el("option", undefined, "자동 선택");
  auto.value = "";
  vs.appendChild(auto);
  for (const v of deps.voices) {
    const o = el("option", undefined, v.name);
    o.value = v.voiceURI;
    vs.appendChild(o);
  }
  vs.value = deps.settings.voiceURI ?? "";
  vs.addEventListener("change", () => patchSettings({ voiceURI: vs.value === "" ? null : vs.value }));
  form.appendChild(labeled("음성", vs));

  const keyInput = el("input");
  keyInput.type = "password";
  keyInput.autocomplete = "off";
  keyInput.placeholder = deps.settings.apiKey ? "저장됨 (입력하면 교체)" : "API 키 (선택)";
  keyInput.value = state.keyDraft;
  keyInput.addEventListener("input", () => {
    state.keyDraft = keyInput.value;
  });
  form.appendChild(labeled("API 키 (부모 리포트 문장용)", keyInput));
  form.appendChild(el("span", "note", deps.settings.apiKey ? "키 저장됨" : "키 없음: 기본 문장으로 리포트"));
  const keyRow = el("div", "actions");
  keyRow.appendChild(
    btn("키 저장", "btn-secondary", () => {
      const k = state.keyDraft.trim();
      if (k === "") return;
      patchSettings({ apiKey: k });
      state.keyDraft = "";
      rerender();
    }),
  );
  keyRow.appendChild(
    btn("키 삭제", "btn-secondary", () => {
      patchSettings({ apiKey: null });
      state.keyDraft = "";
      rerender();
    }),
  );
  form.appendChild(keyRow);

  // 아래 핸들러는 동기 검증 후 같은 클릭 안에서 onHandoff를 호출한다(iOS TTS 잠금 해제).
  form.appendChild(
    btn("아이에게 넘기기", "btn-primary", () => {
      if (!PARTICIPANT_CODE_RE.test(state.code)) {
        window.alert("참가자 코드 형식이 맞지 않아요. 예: P01, R01");
        return;
      }
      const entry = deps.stories.find((s) => s.story.id === state.storyId);
      if (!entry || entry.errors.length > 0) {
        window.alert("사용할 수 있는 이야기를 선택하세요.");
        return;
      }
      const unexported = deps.store.countUnexported();
      if (
        unexported > 0 &&
        !window.confirm(`아직 내보내지 않은 세션이 ${unexported}개 있어요. 그래도 계속할까요?`)
      ) {
        return;
      }
      if (
        deps.store.hasSessionFor(state.code, entry.story.id) &&
        !window.confirm("이 코드로 이 이야기를 이미 시작한 기록이 있어요. 같은 아이가 맞나요?")
      ) {
        return;
      }
      let manualReading = state.manualReading;
      if (!deps.koVoiceFound && !manualReading) {
        if (!window.confirm("한국어 음성이 없어요. 실험자가 직접 읽는 모드로 진행할까요?")) return;
        manualReading = true;
      }
      const conditions = currentConditions();
      patchSettings({ defaultConditions: conditions });
      deps.onHandoff({
        participantCode: state.code,
        story: entry.story,
        conditions,
        confirmMode: advanced ? state.confirmMode : "double",
        manualReading,
      });
    }),
  );
  page.appendChild(form);

  const sessions = el("section", "panel");
  sessions.appendChild(el("h2", undefined, "세션 기록"));
  sessions.appendChild(el("p", "badge", `미내보내기 세션: ${deps.store.countUnexported()}개`));
  const records = deps.store.listSessions();
  if (records.length === 0) {
    sessions.appendChild(el("p", "note", "기록 없음"));
  } else {
    const table = el("table");
    const head = el("tr");
    for (const h of ["참가자", "이야기", "상태", "체크", "검사", "내보냄"]) head.appendChild(el("th", undefined, h));
    table.appendChild(head);
    for (const r of records) {
      const tr = el("tr");
      const audit = deps.auditFor(r);
      const waiting = r.meta.status === "completed" && !r.events.some((e) => e.event_type === "asked_check");
      const auditText =
        audit.status === "violation"
          ? `위반 ${audit.violations.length}건: ${audit.violations.map((v) => v.message).join("; ")}`
          : audit.status === "ok"
            ? "정상"
            : "미완료";
      const cells = [
        r.meta.participant_code,
        r.meta.story_id,
        r.meta.status,
        waiting ? "체크 대기" : "",
        auditText,
        r.meta.exported ? "예" : "아니오",
      ];
      for (const c of cells) tr.appendChild(el("td", undefined, c));
      table.appendChild(tr);
    }
    sessions.appendChild(table);
  }
  const exp = el("div", "actions");
  exp.appendChild(
    btn("CSV 내보내기", "btn-secondary", () => {
      deps.onExportCsv();
      rerender();
    }),
  );
  exp.appendChild(
    btn("JSON 내보내기", "btn-secondary", () => {
      deps.onExportJson();
      rerender();
    }),
  );
  exp.appendChild(
    btn("로그 비우기", "btn-secondary", () => {
      if (!window.confirm("모든 세션 기록을 지울까요?")) return;
      if (!window.confirm("정말 지울까요? 되돌릴 수 없어요.")) return;
      deps.onClearLogs();
      rerender();
    }),
  );
  sessions.appendChild(exp);
  page.appendChild(sessions);

  root.appendChild(page);
}
