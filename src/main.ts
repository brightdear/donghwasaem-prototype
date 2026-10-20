/**
 * 전체 배선 (계획 4 단계 2·3). 실험자 화면 → 아이 화면(runner) → 부모 넘기기 → 리포트 → 실험자 화면.
 * 모든 텍스트는 각 화면 모듈이 textContent로 넣는다(HTML 문자열 삽입 금지).
 */
import "./styles.css";
import heungbu from "./data/heungbu.json";
import ant from "./data/ant.json";
import { validateStory } from "./story/schema";
import type { Story } from "./story/types";
import { createStore } from "./log/store";
import { auditSession } from "./log/audit";
import { toCsv, toJson } from "./log/csv";
import { downloadText, exportFilename } from "./log/export";
import { DEFAULT_SETTINGS, STORAGE_KEYS, type SessionMeta, type Settings } from "./log/types";
import { createTts, type Tts, type TtsEvent } from "./tts";
import { summarize } from "./report/summarize";
import { generateReport } from "./report/llm";
import { createRunner, lateEvent, ttsEventToAction, type Runner } from "./ui/runner";
import { renderExperimenter, type ExperimenterDeps } from "./ui/experimenter";
import { renderChild } from "./ui/child";
import { resolveArt, type ResolvedArt } from "./ui/art";
import { renderParentHandoff, renderReport } from "./ui/report";

const LONG_PRESS_MS = 2000;

const clock = () => performance.now();
const nowIso = () => new Date().toISOString();

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    const p = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
    const d = DEFAULT_SETTINGS;
    const dc = p.defaultConditions as Record<string, unknown> | null | undefined;
    const dcOk =
      !!dc &&
      typeof dc === "object" &&
      typeof dc.branching === "boolean" &&
      (dc.mismatch === "rewind" || dc.mismatch === "converge" || dc.mismatch === "altEnding" || dc.mismatch === "na") &&
      (typeof dc.askWhy === "boolean" || dc.askWhy === "na");
    return {
      apiKey: typeof p.apiKey === "string" ? p.apiKey : d.apiKey,
      ttsRate:
        typeof p.ttsRate === "number" && Number.isFinite(p.ttsRate) && p.ttsRate >= 0.5 && p.ttsRate <= 1.5
          ? p.ttsRate
          : d.ttsRate,
      voiceURI: typeof p.voiceURI === "string" ? p.voiceURI : d.voiceURI,
      confirmMode: p.confirmMode === "double" || p.confirmMode === "single" ? p.confirmMode : d.confirmMode,
      manualReading: typeof p.manualReading === "boolean" ? p.manualReading : d.manualReading,
      pictures: typeof p.pictures === "boolean" ? p.pictures : d.pictures,
      defaultConditions: dcOk ? (dc as unknown as Settings["defaultConditions"]) : { ...d.defaultConditions },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettingsToStorage(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(s));
  } catch {
    console.warn("[main] 설정 저장 실패");
  }
}

async function requestPersist(): Promise<boolean | null> {
  try {
    const st = navigator.storage;
    if (!st || typeof st.persist !== "function") return null;
    return await st.persist();
  } catch {
    return null;
  }
}

async function boot(root: HTMLElement): Promise<void> {
  let settings = loadSettings();
  const stories = [heungbu, ant].map((raw) => {
    const r = validateStory(raw);
    return r.ok
      ? { story: r.story, errors: [] as string[] }
      : {
          story: raw as unknown as Story,
          errors: r.errors.map((e) => `${e.code}: ${e.message}`),
        };
  });
  const store = createStore(localStorage);
  store.markDropouts(nowIso());
  const STORAGE_FULL_MSG = "로그 저장에 실패했어요(저장 공간 부족 가능). 지금 CSV를 내보내고 로그를 비운 뒤 다시 시도하세요.";
  // runner.ts는 수정하지 않고, appendEvent 실패를 main에서 잡기 위해 store를 감싼다.
  const runnerStore: typeof store = {
    ...store,
    appendEvent(id, ev) {
      const res = store.appendEvent(id, ev);
      if (!res.ok) deps.storageWarning = STORAGE_FULL_MSG;
      return res;
    },
  };
  const storagePersisted = await requestPersist();

  // 현재 세션 상태
  let runner: Runner | null = null;
  let meta: SessionMeta | null = null;
  let sessionActive = false; // 아이 화면 진행 중(session_end 전)
  let mode: "experimenter" | "child" | "parent" = "experimenter";
  let hiddenLogged = false;

  const onTtsEvent = (e: TtsEvent) => {
    const a = ttsEventToAction(e);
    if (a && runner && sessionActive) runner.dispatch(a);
  };
  const makeTts = (s: Settings): Tts => createTts({ rate: s.ttsRate, voiceURI: s.voiceURI, onEvent: onTtsEvent });
  let tts = makeTts(settings);
  let koVoice = await tts.findKoVoice();
  const voices = tts.listKoVoices().map((v) => ({ name: v.name, voiceURI: v.voiceURI }));

  const storyById = (id: string): Story | undefined => stories.find((s) => s.story.id === id)?.story;

  const deps: ExperimenterDeps = {
    settings,
    saveSettings(s) {
      const ttsChanged = s.ttsRate !== settings.ttsRate || s.voiceURI !== settings.voiceURI;
      settings = s;
      deps.settings = s;
      saveSettingsToStorage(s);
      if (ttsChanged) {
        tts.cancel();
        const next = makeTts(s);
        tts = next;
        // 새 tts의 voice를 다시 잡는다. 완료 전에는 이전 값 유지.
        void next.findKoVoice().then((v) => {
          if (tts === next) koVoice = v;
        });
      }
    },
    stories,
    store,
    voices,
    koVoiceFound: koVoice !== null,
    storagePersisted,
    otherTabOpen: false,
    onHandoff: (cfg) => {
      // 클릭 핸들러 안에서 동기로 호출된다(iOS TTS 잠금 해제).
      tts.unlock();
      const epoch = Date.now();
      store.abandonOpenSessions("", epoch);
      const voiceName =
        (settings.voiceURI && voices.find((v) => v.voiceURI === settings.voiceURI)?.name) || koVoice?.name || null;
      const m: SessionMeta = {
        session_id: `${cfg.participantCode}.${epoch}`,
        participant_code: cfg.participantCode,
        story_id: cfg.story.id,
        conditions: cfg.conditions,
        confirm_mode: cfg.confirmMode,
        manualReading: cfg.manualReading,
        pictures: cfg.pictures,
        started_at_iso: new Date(epoch).toISOString(),
        started_epoch_ms: epoch,
        status: "open",
        voice: voiceName,
      };
      const created = store.createSession(m);
      if (!created.ok) {
        deps.storageWarning = STORAGE_FULL_MSG;
        window.alert("저장 공간이 부족해 세션을 시작할 수 없어요. 로그를 내보내고 비운 뒤 다시 시도하세요.");
        return;
      }
      meta = m;
      sessionActive = true;
      hiddenLogged = false;
      mode = "child";
      syncCorner();
      root.textContent = "";
      const story = cfg.story;
      // 선택·질문 화면은 직전 그림을 유지한다. 그림 끄기면 그림을 아예 그리지 않는다
      let lastArt: ResolvedArt | null = null;
      const renderView = (v: Parameters<typeof renderChild>[1]) => {
        const art = cfg.pictures ? resolveArt(story, v, lastArt, cfg.conditions) : null;
        lastArt = art;
        renderChild(root, v, r.dispatch, art);
      };
      const r = createRunner({
        story,
        conditions: cfg.conditions,
        engineSettings: { manualReading: cfg.manualReading, confirmMode: cfg.confirmMode },
        meta: m,
        store: runnerStore,
        tts: cfg.manualReading ? null : tts,
        clock,
        nowIso,
        render: renderView,
        onFinished: () => onFinished(story),
      });
      runner = r;
      r.start();
    },
    onExportCsv() {
      const recs = store.listSessions();
      downloadText(exportFilename("csv"), toCsv(recs), "text/csv;charset=utf-8");
      store.markExported(recs.map((x) => x.meta.session_id));
    },
    onExportJson() {
      const recs = store.listSessions();
      downloadText(exportFilename("json"), toJson(recs), "application/json;charset=utf-8");
      store.markExported(recs.map((x) => x.meta.session_id));
    },
    onClearLogs() {
      store.clearSessions();
      deps.storageWarning = undefined;
    },
    auditFor(record) {
      const s = storyById(record.meta.story_id);
      return auditSession(record, {
        choicePointIds: s ? s.choicePoints.map((c) => c.id) : [],
        questionCount: s ? s.comprehension.length : 0,
      });
    },
  };

  function showExperimenter(): void {
    tts.cancel();
    sessionActive = false;
    runner = null;
    meta = null;
    mode = "experimenter";
    syncCorner();
    renderExperimenter(root, deps);
  }

  function onFinished(story: Story): void {
    const m = meta;
    const r = runner;
    if (!m || !r) return;
    sessionActive = false;
    mode = "parent";
    syncCorner();
    const token = m.session_id;
    const stale = () => meta?.session_id !== token || mode !== "parent";
    store.setStatus(m.session_id, "completed", undefined, nowIso(), r.elapsedMs());
    const late = (ev: Parameters<typeof lateEvent>[1]) => {
      const res = store.appendLateEvent(m.session_id, lateEvent(m, ev, nowIso(), r.elapsedMs()));
      if (!res.ok) {
        deps.storageWarning = STORAGE_FULL_MSG;
        console.warn(`[main] ${ev.event_type} 저장 실패(${res.reason})`);
      }
    };
    renderParentHandoff(root, () => {
      void (async () => {
        const record = store.getSession(m.session_id);
        if (!record) {
          showExperimenter();
          return;
        }
        const result = await generateReport(summarize(record, story), settings.apiKey);
        if (stale()) return;
        late({
          event_type: "report_source",
          report_source: result.source,
          ...(result.fallbackReason ? { fallback_reason: result.fallbackReason } : {}),
          detail: { latency: result.llmLatencyMs ?? null },
        });
        late({ event_type: "report_view", detail: { text: result.text } });
        renderReport(
          root,
          result,
          () => late({ event_type: "asked_check" }),
          () => showExperimenter(),
        );
      })();
    });
  }

  // 화면 숨김 → 낭독 취소 + page_hidden (숨김 1회당 1행)
  const onHidden = (reason: string) => {
    if (!sessionActive || !runner || hiddenLogged) return;
    hiddenLogged = true;
    tts.cancel();
    runner.logExtra({ event_type: "page_hidden", detail: { reason } });
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onHidden("visibilitychange");
    else hiddenLogged = false;
  });
  window.addEventListener("pagehide", () => onHidden("pagehide"));

  // 다른 탭 경고
  const flagOtherTab = () => {
    if (deps.otherTabOpen) return;
    deps.otherTabOpen = true;
    if (mode === "experimenter") renderExperimenter(root, deps);
  };
  window.addEventListener("storage", (e) => {
    if (e.key && e.key.startsWith("dh.")) flagOtherTab();
  });
  if (typeof BroadcastChannel !== "undefined") {
    const ch = new BroadcastChannel("dh.tabs");
    ch.onmessage = (e: MessageEvent) => {
      if (e.data === "hello") ch.postMessage("here");
      flagOtherTab();
    };
    ch.postMessage("hello");
  }

  // 실험자 복귀: 화면 좌상단 숨은 영역(80x80, 투명)을 2초 길게 누른 뒤 확인
  const corner = document.createElement("div");
  corner.setAttribute("aria-hidden", "true");
  Object.assign(corner.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "80px",
    height: "80px",
    zIndex: "1000",
    background: "transparent",
    touchAction: "none",
    display: "none",
  });
  document.body.appendChild(corner);
  function syncCorner(): void {
    corner.style.display = mode === "experimenter" ? "none" : "block";
  }
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  const clearPress = () => {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
  };
  corner.addEventListener("pointerdown", () => {
    if (mode === "experimenter") return;
    clearPress();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (mode === "experimenter") return;
      if (window.confirm("실험자 화면으로 돌아갈까요? 진행 중인 세션은 중단됩니다.")) showExperimenter();
    }, LONG_PRESS_MS);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) corner.addEventListener(type, clearPress);
  root.addEventListener("contextmenu", (e) => {
    if (mode !== "experimenter") e.preventDefault();
  });

  showExperimenter();
}

const app = document.getElementById("app");
if (app) void boot(app);
