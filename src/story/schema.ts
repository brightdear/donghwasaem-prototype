/**
 * 시나리오 검증기 — 계획 3.2 "검증기 규칙" R1~R7, R9(art 섹션), R10(ask).
 * 금지어·이모지 검사는 report/filter.ts와 독립적으로 여기서 자체 구현한다.
 */
import { MOTIONS, type Motion, type Story } from "./types";

export interface SchemaError {
  code: string;
  message: string;
  path?: string;
}
export type ValidateResult = { ok: true; story: Story } | { ok: false; errors: SchemaError[] };

const EMOJI_RE = /\p{Extended_Pictographic}/u;
export const FORBIDDEN_STEMS = ["점수", "등급", "향상", "문해력", "발달"] as const;
const REASON_TYPES = ["others_feeling", "outcome", "rule", "other"];
const QUESTION_TYPES = ["explicit", "inference", "sequence"] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(isStr);

export function validateStory(story: unknown): ValidateResult {
  const errors: SchemaError[] = [];
  const err = (code: string, message: string, path?: string) => errors.push({ code, message, path });

  if (!isObj(story)) {
    return { ok: false, errors: [{ code: "S_TYPE", message: "이야기가 객체가 아님" }] };
  }
  if (story.schemaVersion !== 2) err("S_SCHEMA_VERSION", "schemaVersion은 2여야 함", "schemaVersion");
  if (!isStr(story.id)) err("S_TYPE", "id 필요", "id");
  if (!isStr(story.title)) err("S_TYPE", "title 필요", "title");

  // ---- spine ----
  const spine = Array.isArray(story.spine) ? story.spine : [];
  if (!Array.isArray(story.spine)) err("S_TYPE", "spine 배열 필요", "spine");
  const passages = new Map<string, string[]>();
  const choiceRefs: string[] = [];
  spine.forEach((n, i) => {
    const p = `spine[${i}]`;
    if (!isObj(n) || !isStr(n.id)) return err("S_TYPE", "spine 노드 형식 오류", p);
    if (n.type === "passage") {
      if (!isStrArr(n.paragraphs)) err("S_TYPE", "passage.paragraphs 필요", `${p}.paragraphs`);
      if (passages.has(n.id)) err("S_DUP_ID", `passage id 중복: ${n.id}`, p);
      passages.set(n.id, isStrArr(n.paragraphs) ? n.paragraphs : []);
    } else if (n.type === "choice") {
      choiceRefs.push(n.id);
    } else if (n.type !== "ending") {
      err("S_TYPE", `알 수 없는 spine 노드 type`, `${p}.type`);
    }
  });

  // ---- R1 ----
  const cps = Array.isArray(story.choicePoints) ? story.choicePoints : [];
  if (!Array.isArray(story.choicePoints)) err("S_TYPE", "choicePoints 배열 필요", "choicePoints");
  if (choiceRefs.length !== 3) err("R1_CHOICE_COUNT", `choice 노드는 정확히 3개여야 함(현재 ${choiceRefs.length})`, "spine");
  const cpIds = cps.map((c) => (isObj(c) ? c.id : undefined));
  const refSet = new Set(choiceRefs);
  const cpSet = new Set(cpIds.filter(isStr));
  if (
    refSet.size !== choiceRefs.length ||
    cpSet.size !== cps.length ||
    choiceRefs.some((r) => !cpSet.has(r)) ||
    [...cpSet].some((c) => !refSet.has(c))
  ) {
    err("R1_CHOICE_REF", "spine의 choice 노드와 choicePoints id가 1:1이 아님", "choicePoints");
  }

  // ---- R2·R3 ----
  cps.forEach((cp, ci) => {
    const p = `choicePoints[${ci}]`;
    if (!isObj(cp)) return err("S_TYPE", "choicePoint 형식 오류", p);
    if (!isStr(cp.prompt)) err("S_TYPE", "prompt 필요", `${p}.prompt`);
    const opts = Array.isArray(cp.options) ? cp.options : [];
    if (opts.length < 2 || opts.length > 3) err("R2_OPTION_COUNT", "선택지는 2~3개", `${p}.options`);
    const originals = opts.filter((o) => isObj(o) && o.matchesOriginal === true).length;
    if (originals !== 1) err("R2_ORIGINAL_COUNT", `matchesOriginal=true는 정확히 1개(현재 ${originals})`, `${p}.options`);
    if (cp.ask !== undefined) validateAsk(cp.ask, `${p}.ask`, err);
    opts.forEach((o, oi) => {
      const op = `${p}.options[${oi}]`;
      if (!isObj(o) || !isStr(o.id) || !isStr(o.label) || typeof o.matchesOriginal !== "boolean") {
        return err("S_TYPE", "선택지 형식 오류(id·label·matchesOriginal)", op);
      }
      if (!isStr(o.echo)) err("R3_ECHO_MISSING", "echo 필요", `${op}.echo`);
      const why = Array.isArray(o.why) ? o.why : [];
      if (why.length < 2 || why.length > 3) err("R3_WHY_COUNT", "why 보기는 2~3개", `${op}.why`);
      why.forEach((w, wi) => {
        if (!isObj(w) || !isStr(w.id) || !isStr(w.text)) err("S_TYPE", "why 보기 형식 오류", `${op}.why[${wi}]`);
        else if (!REASON_TYPES.includes(w.reasonType as string)) err("R3_REASON_TYPE", "reasonType 오류", `${op}.why[${wi}].reasonType`);
      });
      if (o.matchesOriginal) {
        if (!isStrArr(o.consequence)) err("R3_CONSEQUENCE_MISSING", "원작 선택지에 consequence 필요", `${op}.consequence`);
        if (!isStr(o.offNarration)) err("R3_OFFNARRATION_MISSING", "원작 선택지에 offNarration 필요", `${op}.offNarration`);
        else if (o.offNarration.includes("골랐")) err("R3_OFFNARRATION_WORD", 'offNarration에 "골랐" 금지', `${op}.offNarration`);
      } else {
        const m = o.mismatch;
        const mp = `${op}.mismatch`;
        if (!isObj(m)) {
          err("R2_MISMATCH_MISSING", "다른 선택지에 mismatch 필요", mp);
          return;
        }
        const rw = m.rewind;
        if (!isObj(rw)) err("R2_MISMATCH_MISSING", "mismatch.rewind 필요", `${mp}.rewind`);
        else {
          if (!isStrArr(rw.consequence)) err("R2_MISMATCH_MISSING", "rewind.consequence 필요", `${mp}.rewind.consequence`);
          for (const f of ["contrast", "contrastFinal"] as const) {
            const v = rw[f];
            if (!isStr(v)) err("R2_MISMATCH_MISSING", `rewind.${f} 필요`, `${mp}.rewind.${f}`);
            else if (v.includes("다시 골라")) err("R3_CONTRAST_WORD", `rewind.${f}에 "다시 골라" 금지`, `${mp}.rewind.${f}`);
          }
        }
        for (const k of ["converge", "altEnding"] as const) {
          const v = m[k];
          if (!isObj(v)) err("R2_MISMATCH_MISSING", `mismatch.${k} 필요`, `${mp}.${k}`);
          else {
            if (!isStrArr(v.consequence)) err("R2_MISMATCH_MISSING", `${k}.consequence 필요`, `${mp}.${k}.consequence`);
            if (!isStrArr(v.bridge)) err("R2_MISMATCH_MISSING", `${k}.bridge 필요`, `${mp}.${k}.bridge`);
          }
        }
      }
    });
  });

  // ---- R4·R5 ----
  const qs = Array.isArray(story.comprehension) ? story.comprehension : [];
  if (qs.length < 4 || qs.length > 5) err("R4_QUESTION_COUNT", `이해 질문은 4~5개(현재 ${qs.length})`, "comprehension");
  const typesSeen = new Set<string>();
  qs.forEach((q, qi) => {
    const p = `comprehension[${qi}]`;
    if (!isObj(q) || !isStr(q.id) || !isStr(q.prompt)) return err("S_TYPE", "이해 질문 형식 오류", p);
    if (!QUESTION_TYPES.includes(q.type as (typeof QUESTION_TYPES)[number])) err("S_TYPE", "type 오류", `${p}.type`);
    else typesSeen.add(q.type as string);
    const opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length < 2 || opts.length > 3) err("R4_OPTION_COUNT", "보기는 2~3개", `${p}.options`);
    const optIds = opts.map((o) => (isObj(o) && isStr(o.text) ? o.id : undefined));
    if (optIds.some((x) => !isStr(x))) err("S_TYPE", "보기 형식 오류", `${p}.options`);
    if (!optIds.includes(q.answer as string)) err("R4_ANSWER", "answer가 보기 id가 아님", `${p}.answer`);
    if (!isObj(q.feedback) || !isStr(q.feedback.correct) || !isStr(q.feedback.incorrect)) {
      err("S_TYPE", "feedback.correct·incorrect 필요", `${p}.feedback`);
    }

    const refs = Array.isArray(q.refersTo) ? q.refersTo : [];
    if (refs.length === 0 || refs.some((r) => typeof r !== "string" || !passages.has(r))) {
      err("R5_REFERS_TO", "refersTo는 척추 passage id만(1개 이상)", `${p}.refersTo`);
    }

    const af = q.answerFact;
    let facts: string[] = [];
    if (Array.isArray(af)) {
      if (q.type !== "sequence") err("R4_ANSWERFACT_ARRAY", "answerFact 배열은 sequence 질문에만", `${p}.answerFact`);
      else if (af.length < 2) err("R4_ANSWERFACT_ARRAY", "sequence의 answerFact는 원소 2개 이상", `${p}.answerFact`);
      if (!af.every(isStr)) err("R4_ANSWERFACT_EMPTY", "answerFact 원소가 비어 있음", `${p}.answerFact`);
      facts = af.filter(isStr);
    } else if (isStr(af)) {
      if (q.type === "sequence") err("R4_ANSWERFACT_ARRAY", "sequence 질문의 answerFact는 배열이어야 함", `${p}.answerFact`);
      facts = [af];
    } else {
      err("R4_ANSWERFACT_EMPTY", "answerFact 필요", `${p}.answerFact`);
    }
    const refTexts = refs.filter((r): r is string => typeof r === "string").map((r) => (passages.get(r) ?? []).join(" "));
    facts.forEach((f, fi) => {
      if (!refTexts.some((t) => t.includes(f))) {
        err("R5_ANSWERFACT_NOT_IN_PASSAGE", `answerFact "${f}"가 refersTo passage에 없음`, Array.isArray(af) ? `${p}.answerFact[${fi}]` : `${p}.answerFact`);
      }
    });
  });
  for (const t of QUESTION_TYPES) {
    if (!typesSeen.has(t)) err("R4_TYPE_COVERAGE", `질문 유형 ${t}가 없음`, "comprehension");
  }

  // ---- R6 ----
  const endings = story.endings;
  if (!isObj(endings)) err("R6_ENDINGS", "endings 필요", "endings");
  else {
    for (const k of ["original", "alt"] as const) {
      const e = endings[k];
      if (!isObj(e) || !isStrArr(e.paragraphs)) err("R6_ENDINGS", `endings.${k}.paragraphs 필요`, `endings.${k}`);
    }
  }
  const pp = story.parentPrompts;
  if (!Array.isArray(pp) || pp.length < 2 || !pp.every(isStr)) err("R6_PARENT_PROMPTS", "parentPrompts 2개 이상", "parentPrompts");

  // ---- R7 ----
  walkStrings(story, "", (s, path) => {
    if (EMOJI_RE.test(s)) err("R7_EMOJI", "이모지 금지", path);
    const w = FORBIDDEN_STEMS.find((stem) => s.includes(stem));
    if (w) err("R7_FORBIDDEN_WORD", `금지어 "${w}"`, path);
  });

  // ---- R9 (art 섹션, 선택) ----
  if (story.art !== undefined) {
    const art = story.art;
    if (!isObj(art)) err("R9_ART", "art는 객체여야 함", "art");
    else {
      const pages = bodyNodePages(passages, cps, endings);
      if (art.scenes !== undefined) {
        if (!isObj(art.scenes)) err("R9_ART", "art.scenes는 객체여야 함", "art.scenes");
        else
          for (const [id, v] of Object.entries(art.scenes)) {
            const p = `art.scenes.${id}`;
            if (!pages.has(id)) err("R9_SCENE_ID", `장면 id가 본문 노드 id가 아님: ${id}`, p);
            if (!isObj(v) || !(v.image === null || isStr(v.image))) err("R9_ART", "image는 파일명 또는 null", p);
          }
      }
      if (art.pages !== undefined) {
        if (!isObj(art.pages)) err("R9_ART", "art.pages는 객체여야 함", "art.pages");
        else
          for (const [id, v] of Object.entries(art.pages)) {
            const p = `art.pages.${id}`;
            const count = pages.get(id);
            if (count === undefined) err("R9_SCENE_ID", `장면 id가 본문 노드 id가 아님: ${id}`, p);
            else if (!Array.isArray(v) || !v.every(isStr) || v.length !== count) {
              err("R9_PAGE", `페이지 수(${count})만큼 파일명이 필요`, p);
            }
          }
      }
      if (art.textRight !== undefined && !(Array.isArray(art.textRight) && art.textRight.every(isStr))) {
        err("R9_ART", "art.textRight는 파일명 문자열 배열", "art.textRight");
      }
      if (art.motions !== undefined) {
        if (!Array.isArray(art.motions)) err("R9_ART", "art.motions는 배열이어야 함", "art.motions");
        else
          art.motions.forEach((m, i) => {
            const p = `art.motions[${i}]`;
            if (!isObj(m)) return err("R9_ART", "motion 형식 오류", p);
            if (!MOTIONS.includes(m.motion as Motion)) err("R9_MOTION", `motion은 ${MOTIONS.join("/")} 중 하나`, `${p}.motion`);
            const count = isStr(m.scene) ? pages.get(m.scene) : undefined;
            if (count === undefined) err("R9_SCENE_ID", `scene이 본문 노드 id가 아님: ${String(m.scene)}`, `${p}.scene`);
            else if (!Number.isInteger(m.page) || (m.page as number) < 1 || (m.page as number) > count) {
              err("R9_PAGE", `page는 1~${count}`, `${p}.page`);
            }
            if (!isStr(m.overlay)) err("R9_ART", "overlay 파일명 필요", `${p}.overlay`);
            for (const k of ["x", "y", "size"] as const) {
              const v = m[k];
              if (typeof v !== "number" || !(v >= 0 && v <= 1)) err("R9_ART", `${k}는 0~1 숫자`, `${p}.${k}`);
            }
          });
      }
    }
  }

  return errors.length === 0 ? { ok: true, story: story as unknown as Story } : { ok: false, errors };
}

/** R10 — ChoicePoint.ask(묻기 층) 검증 */
function validateAsk(ask: unknown, path: string, err: (code: string, message: string, path?: string) => void): void {
  if (!isObj(ask)) return err("S_TYPE", "ask는 객체여야 함", path);
  if (typeof ask.voice !== "boolean") err("S_TYPE", "ask.voice는 boolean", `${path}.voice`);
  if (ask.maxAsks !== undefined && !(Number.isInteger(ask.maxAsks) && (ask.maxAsks as number) >= 1 && (ask.maxAsks as number) <= 3))
    err("R10_ASK_MAXASKS", "maxAsks는 1~3 정수", `${path}.maxAsks`);
  for (const f of ["intro", "sceneLabel"] as const)
    if (ask[f] !== undefined && !isStr(ask[f])) err("S_TYPE", `ask.${f}는 문자열`, `${path}.${f}`);
  const chars = Array.isArray(ask.characters) ? ask.characters : [];
  if (!Array.isArray(ask.characters)) err("S_TYPE", "ask.characters는 배열", `${path}.characters`);
  else if (chars.length < 1 || chars.length > 2) err("R10_ASK_CHARACTERS", "묻기 인물은 1~2명", `${path}.characters`);
  chars.forEach((ch, ci) => {
    const cp = `${path}.characters[${ci}]`;
    if (!isObj(ch)) return err("S_TYPE", "ask 인물 형식 오류", cp);
    if (!isStr(ch.id)) err("S_TYPE", "인물 id 필요", `${cp}.id`);
    if (!isStr(ch.name)) err("S_TYPE", "인물 name 필요", `${cp}.name`);
    if (ch.portrait !== undefined && !isStr(ch.portrait)) err("S_TYPE", "portrait는 문자열", `${cp}.portrait`);
    if (ask.voice === true)
      for (const f of ["unmatched", "unmatchedFinal"] as const)
        if (!isStr(ch[f])) err("R10_ASK_UNMATCHED", `voice=true면 ${f} 필요`, `${cp}.${f}`);
    if (!Array.isArray(ch.questions)) return err("S_TYPE", "questions는 배열", `${cp}.questions`);
    if (ch.questions.length < 2 || ch.questions.length > 3) err("R10_ASK_QUESTIONS", "인물당 질문은 2~3개", `${cp}.questions`);
    const seen = new Set<string>();
    ch.questions.forEach((q, qi) => {
      const qp = `${cp}.questions[${qi}]`;
      if (!isObj(q)) return err("S_TYPE", "질문 형식 오류", qp);
      if (!isStr(q.id)) err("S_TYPE", "질문 id 필요", `${qp}.id`);
      else if (q.id === "free") err("R10_ASK_QID_RESERVED", "질문 id 'free'는 준비 밖 질문용으로 예약됨", `${qp}.id`);
      else if (seen.has(q.id)) err("R10_ASK_QID_DUP", `질문 id 중복: ${q.id}`, `${qp}.id`);
      else seen.add(q.id);
      if (!isStr(q.text)) err("S_TYPE", "질문 text 필요", `${qp}.text`);
      if (q.clue !== undefined && !isStr(q.clue)) err("S_TYPE", "clue는 문자열", `${qp}.clue`);
      if (!Array.isArray(q.keywords) || q.keywords.length < 1 || !q.keywords.every((k) => typeof k === "string" && k.replace(/\s/g, "").length >= 2))
        err("R10_ASK_KEYWORDS", "keywords는 1개 이상, 각 공백 제외 2자 이상", `${qp}.keywords`);
      if (!isStrArr(q.answer) || q.answer.length > 2) err("R10_ASK_ANSWER", "answer는 비어 있지 않은 문자열 1~2개", `${qp}.answer`);
    });
  });
}

/** 본문 노드 id(하위 노드 id 규칙, #n 접미사 제외) → 페이지 수 */
function bodyNodePages(passages: Map<string, string[]>, cps: unknown[], endings: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, ps] of passages) out.set(id, ps.length);
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  if (isObj(endings)) {
    for (const k of ["original", "alt"] as const) {
      const e = endings[k];
      out.set(`end.${k}`, isObj(e) ? len(e.paragraphs) : 0);
    }
  }
  for (const cp of cps) {
    if (!isObj(cp) || !isStr(cp.id) || !Array.isArray(cp.options)) continue;
    if (isObj(cp.ask) && Array.isArray(cp.ask.characters))
      for (const ch of cp.ask.characters) {
        if (!isObj(ch) || !isStr(ch.id) || !Array.isArray(ch.questions)) continue;
        for (const q of ch.questions) if (isObj(q) && isStr(q.id)) out.set(`${cp.id}.ask.${ch.id}.${q.id}`, len(q.answer));
      }
    for (const o of cp.options) {
      if (!isObj(o) || !isStr(o.id)) continue;
      const base = `${cp.id}.${o.id}`;
      out.set(`${base}.echo`, 1);
      if (o.matchesOriginal === true) {
        out.set(`${base}.offNarration`, 1);
        out.set(`${base}.consequence`, len(o.consequence));
      }
      const m = o.mismatch;
      if (!isObj(m)) continue;
      if (isObj(m.rewind)) {
        out.set(`${base}.rewind.consequence`, len(m.rewind.consequence));
        out.set(`${base}.rewind.contrast`, 1);
        out.set(`${base}.rewind.contrastFinal`, 1);
      }
      for (const k of ["converge", "altEnding"] as const) {
        const v = m[k];
        if (!isObj(v)) continue;
        out.set(`${base}.${k}.consequence`, len(v.consequence));
        out.set(`${base}.${k}.bridge`, len(v.bridge));
      }
    }
  }
  return out;
}

function walkStrings(v: unknown, path: string, fn: (s: string, path: string) => void): void {
  if (typeof v === "string") fn(v, path);
  else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${path}[${i}]`, fn));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) walkStrings(x, path ? `${path}.${k}` : k, fn);
}
