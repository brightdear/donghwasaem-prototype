/**
 * `npm run transcripts` — docs/transcripts/<story>-<조합>.md(조합 5개 × 이야기)와 <story>-분량.md 생성.
 * 실제 시나리오(src/data/heungbu.json, ant.json)가 없으면 tests/fixtures/mini.json으로 대체하고 경고한다.
 * 출력 폴더는 커밋하지 않는다(.gitignore).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateStory } from "../src/story/schema";
import { CHARS_PER_MINUTE, askChars, enumeratePaths, renderTranscript, type PathSpec, type Transcript } from "../src/story/transcript";
import { VALID_CONDITIONS, conditionsSlug, type Conditions, type Story } from "../src/story/types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "transcripts");
const MAX_FULL = 30;

function gitHash(): string {
  try {
    const hash = execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return dirty ? `${hash}-dirty` : hash;
  } catch {
    return "unknown";
  }
}

function loadStories(): Story[] {
  const files = ["heungbu.json", "ant.json"].map((f) => join(ROOT, "src", "data", f));
  // TRANSCRIPTS_FIXTURE=1 이면 실제 시나리오를 무시하고 fixture로 생성(생성기 점검용)
  const found = process.env.TRANSCRIPTS_FIXTURE ? [] : files.filter((f) => existsSync(f));
  const missing = files.filter((f) => !existsSync(f)).map((f) => f.replace(ROOT, "."));
  if (missing.length > 0) console.warn(`[경고] 실제 시나리오가 없음: ${missing.join(", ")}`);
  const paths = found.length > 0 ? found : [join(ROOT, "tests", "fixtures", "mini.json")];
  if (found.length === 0) console.warn("[경고] tests/fixtures/mini.json으로 대체해 생성합니다.");
  const out: Story[] = [];
  for (const p of paths) {
    const r = validateStory(JSON.parse(readFileSync(p, "utf8")));
    if (!r.ok) {
      console.error(`[오류] ${p} 검증 실패 — 대본을 만들지 않음`);
      for (const e of r.errors) console.error(`  ${e.code} ${e.path ?? ""} ${e.message}`);
      process.exitCode = 1;
      continue;
    }
    out.push(r.story);
  }
  return out;
}

const fmtMin = (m: number) => `${m.toFixed(1)}분`;

/** 30개 초과 시 대표 경로: 원작만 / 지점별 다른 선택 / 섞기 / 최장 */
function representative(story: Story, c: Conditions, all: { p: PathSpec; tr: Transcript }[]) {
  if (all.length <= MAX_FULL) return all.map((x) => ({ ...x, tag: "" }));
  const cps = story.spine.filter((n) => n.type === "choice").map((n) => story.choicePoints.find((x) => x.id === n.id)!);
  const orig = cps.map((cp) => cp.options.find((o) => o.matchesOriginal)!.id);
  const diff = cps.map((cp) => cp.options.find((o) => !o.matchesOriginal)!.id);
  const one = (i: number, useDiff: boolean) => (useDiff ? (c.mismatch === "rewind" ? [diff[i]!, orig[i]!] : [diff[i]!]) : [orig[i]!]);
  const wanted: { tag: string; seq: string[][] }[] = [{ tag: "원작만", seq: cps.map((_, i) => one(i, false)) }];
  cps.forEach((cp, j) => wanted.push({ tag: `${cp.id}만 다른 선택`, seq: cps.map((_, i) => one(i, i === j)) }));
  wanted.push({ tag: "섞기", seq: cps.map((_, i) => one(i, i % 2 === 0)) });
  const key = (seq: string[][]) => JSON.stringify(seq);
  const picked = wanted.map((w) => ({ tag: w.tag, ...all.find((x) => key(x.p.choicesPerPoint) === key(w.seq))! }));
  const longest = all.reduce((a, b) => (b.tr.totalChars > a.tr.totalChars ? b : a));
  picked.push({ tag: c.mismatch === "rewind" ? "rewind 최장" : "최장", ...longest });
  return picked;
}

function renderPathMd(i: number, tag: string, p: PathSpec, tr: Transcript): string {
  const head = `## 경로 ${i + 1}${tag ? ` — ${tag}` : ""}\n\n- 선택: ${p.label}\n- 분량: 이야기 ${tr.storyChars}자(${fmtMin(tr.storyMinutes)}), 이해 질문 포함 ${tr.totalChars}자(${fmtMin(tr.totalMinutes)})\n`;
  const body = tr.lines.map((l) => `- \`${l.nodeId}\` (${l.screen}${l.kind === "prompt" ? ", 질문" : ""}) ${l.text}`).join("\n");
  return `${head}\n${body}\n`;
}

function main(): void {
  const header = `생성: ${new Date().toISOString()} · 커밋 ${gitHash()}`;
  mkdirSync(OUT, { recursive: true });
  const stories = loadStories();
  for (const story of stories) {
    const rows: string[] = [];
    for (const c of VALID_CONDITIONS) {
      const slug = conditionsSlug(c);
      const all = enumeratePaths(story, c).map((p) => ({ p, tr: renderTranscript(story, c, p.choicesPerPoint) }));
      const shown = representative(story, c, all);
      const note =
        all.length > MAX_FULL ? `경로 ${all.length}개 중 대표 ${shown.length}개만 싣는다(전수는 테스트가 확인).` : `경로 ${all.length}개 전부.`;
      const md = [
        header,
        "",
        `# ${story.title} — ${slug}`,
        "",
        `조건: branching=${c.branching}, mismatch=${c.mismatch}, askWhy=${c.askWhy}. ${note} 분량은 공백 제외 글자 수 ÷ 분당 ${CHARS_PER_MINUTE}자.`,
        "why 보기는 첫 보기, 이해 질문은 정답을 고른 경로다.",
        "",
        ...shown.map((x, i) => renderPathMd(i, x.tag, x.p, x.tr)),
      ].join("\n");
      writeFileSync(join(OUT, `${story.id}-${slug}.md`), md, "utf8");

      const byStory = [...all].sort((a, b) => a.tr.storyChars - b.tr.storyChars);
      const shortest = byStory[0]!;
      const longest = byStory[byStory.length - 1]!;
      const originalIds = new Set(story.choicePoints.flatMap((cp) => cp.options.filter((o) => o.matchesOriginal).map((o) => o.id)));
      const original =
        all.find((x) => x.p.choicesPerPoint.every((seq) => seq.length === 0 || (seq.length === 1 && originalIds.has(seq[0]!)))) ?? shortest;
      const cell = (x: { tr: Transcript }) => `${x.tr.storyChars}자 · ${fmtMin(x.tr.storyMinutes)} (질문 포함 ${fmtMin(x.tr.totalMinutes)})`;
      rows.push(`| ${slug} | ${all.length} | ${cell(shortest)} | ${cell(original)} | ${cell(longest)} |`);
    }
    const ask = askChars(story);
    const askSection =
      ask.perPoint.length === 0
        ? []
        : [
            "",
            "## 묻기 추가 글자 수(지점별 안내 + 가장 긴 대답 2개)",
            "",
            "| 지점 | 글자 수 |",
            "|---|---|",
            ...ask.perPoint.map((p) => `| ${p.cpId} | ${p.chars}자 |`),
            `| 합계 | ${ask.total}자(${fmtMin(ask.total / CHARS_PER_MINUTE)}) |`,
          ];
    const md = [
      header,
      "",
      `# ${story.title} — 분량`,
      "",
      `공백 제외 글자 수 ÷ 분당 ${CHARS_PER_MINUTE}자(rate 0.9 가정). 이야기 = 이해 질문 전까지.`,
      "",
      "| 조합 | 경로 수 | 최단 | 원작만 | 최장 |",
      "|---|---|---|---|---|",
      ...rows,
      ...askSection,
      "",
    ].join("\n");
    writeFileSync(join(OUT, `${story.id}-분량.md`), md, "utf8");
    console.log(`${story.id}: ${VALID_CONDITIONS.length + 1}개 파일 → ${OUT}`);
  }
}

main();
