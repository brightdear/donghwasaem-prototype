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
import { renderParentHandoff, renderReport } from "./ui/report";

const LONG_PRESS_MS = 2000;

const clock = () => performance.now();
const nowIso = () => new Date().toISOString();

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    return { ...DEFAULT_SETTINGS, ...parsed };
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
  const koVoice = await tts.findKoVoice();
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
        tts = makeTts(s);
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
      store.abandonOpenSessions("", epoch, "experimenter");
      const voiceName =
        (settings.voiceURI && voices.find((v) => v.voiceURI === settings.voiceURI)?.name) || koVoice?.name || null;
      const m: SessionMeta = {
        session_id: `${cfg.participantCode}.${epoch}`,
        participant_code: cfg.participantCode,
        story_id: cfg.story.id,
        conditions: cfg.conditions,
        confirm_mode: cfg.confirmMode,
        manualReading: cfg.manualReading,
        started_at_iso: new Date(epoch).toISOString(),
        started_epoch_ms: epoch,
        status: "open",
        voice: voiceName,
      };
      const created = store.createSession(m);
      if (!created.ok) console.warn(`[main] 세션 생성 실패(${created.reason})`);
      meta = m;
      sessionActive = true;
      hiddenLogged = false;
      mode = "child";
      root.textContent = "";
      const story = cfg.story;
      const r = createRunner({
        story,
        conditions: cfg.conditions,
        engineSettings: { manualReading: cfg.manualReading, confirmMode: cfg.confirmMode },
        meta: m,
        store,
        tts: cfg.manualReading ? null : tts,
        clock,
        nowIso,
        render: (v) => renderChild(root, v, r.dispatch),
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
    renderExperimenter(root, deps);
  }

  function onFinished(story: Story): void {
    const m = meta;
    const r = runner;
    if (!m || !r) return;
    sessionActive = false;
    mode = "parent";
    store.setStatus(m.session_id, "completed", undefined, nowIso(), r.elapsedMs());
    const late = (ev: Parameters<typeof lateEvent>[1]) => {
      const res = store.appendLateEvent(m.session_id, lateEvent(m, ev, nowIso(), r.elapsedMs()));
      if (!res.ok) console.warn(`[main] ${ev.event_type} 저장 실패(${res.reason})`);
    };
    renderParentHandoff(root, () => {
      void (async () => {
        const record = store.getSession(m.session_id);
        if (!record) {
          showExperimenter();
          return;
        }
        const result = await generateReport(summarize(record, story), settings.apiKey);
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

  // 실험자 복귀: 아이·부모 화면 배경(버튼 밖)을 2초 길게 누르기
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  const clearPress = () => {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
  };
  root.addEventListener("pointerdown", (e) => {
    if (mode === "experimenter") return;
    const t = e.target as Element | null;
    if (t && t.closest("button, a, input, select, textarea")) return;
    clearPress();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      showExperimenter();
    }, LONG_PRESS_MS);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) root.addEventListener(type, clearPress);
  root.addEventListener("contextmenu", (e) => {
    if (mode !== "experimenter") e.preventDefault();
  });

  showExperimenter();
}

const app = document.getElementById("app");
if (app) void boot(app);
