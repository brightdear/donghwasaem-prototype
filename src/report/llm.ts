/**
 * LLM 리포트 — 계획 단계 4. 브라우저에서 직접 호출(dangerouslyAllowBrowser).
 * 모든 실패는 템플릿으로 대체하고 fallbackReason을 기록한다. 예외를 밖으로 던지지 않는다.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { FallbackReason } from "../log/types";
import { containsForbidden } from "./filter";
import { templateReport } from "./templates";
import {
  LLM_MAX_TOKENS,
  LLM_MODEL,
  LLM_TIMEOUT_MS,
  type ReportInput,
  type ReportResult,
  type ReportText,
} from "./types";

const SYSTEM_PROMPT = [
  "당신은 4~5세 아이와 동화를 읽은 뒤 부모에게 전하는 짧은 리포트를 쓰는 도우미입니다.",
  "이 리포트는 아이를 측정한 결과가 아니라 오늘 아이와 나눈 대화의 기록입니다. 평가하지 말고 있었던 일을 전하세요.",
  "규칙:",
  "- 문체는 모두 '~했어요'로 씁니다.",
  "- 아라비아 숫자, 퍼센트, 'n개 중 m개' 같은 비율 표기를 쓰지 않습니다. 세는 말은 한글('두 번', '세 가지')로 씁니다.",
  "- '점수', '등급', '향상', '문해력', '발달' 같은 단어와 그 활용형을 쓰지 않습니다.",
  "- 이모지를 쓰지 않습니다.",
  "- 아이를 다른 아이와 비교하거나 잘못했다고 말하지 않습니다.",
  "- curiosity: 입력 asks를 바탕으로 아이가 어느 장면에서 누구에게 무엇을 물었는지 한두 문장으로 씁니다. asks가 비어 있으면 '오늘은 인물에게 따로 물어보지 않고 이야기를 끝까지 들었어요.'라고 씁니다. 아이의 능력이나 성향을 판단하지 않습니다.",
  "- comprehension의 결과는 all(모두 맞힘), most(대부분), some(일부), none(아직 어려워함) 범주로만 전달되며, 숫자로 바꾸지 않습니다.",
  "- prompts는 부모가 아이에게 물어볼 열린 질문 2개 또는 3개입니다. 입력의 parentPrompts를 참고하세요.",
  "출력은 JSON 객체 하나만 씁니다. 설명이나 코드 블록 없이 다음 형태를 따르세요.",
  '{"curiosity": "아이가 인물에게 물어본 것", "choices": "아이의 선택 요약(원작과 비교)", "comprehension": "유형별 결과를 문장으로", "prompts": ["질문", "질문"]}',
].join("\n");

/** 순수 함수. 요청 본문에 들어가는 데이터는 ReportInput뿐이다(AC-16). */
export function buildRequest(input: ReportInput): Anthropic.MessageCreateParamsNonStreaming {
  // thinking 키는 일부러 생략: Haiku 5.5는 기본 adaptive. 모델을 바꾸면 기본 동작을 재확인할 것.
  return {
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    output_config: { effort: "low" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(input) }],
  };
}

/** 모델이 ```json 코드블록으로 감싸 보내도 JSON으로 읽는다. 실패하면 undefined. 묻기 응답기와 공유 */
export function parseJsonReply(raw: string): unknown {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * 브라우저 직접 호출 클라이언트. 묻기 응답기와 공유.
 * 정적 호스팅·서버 없음: 실험자 본인 키를 쓰고(한도 낮은 전용 키 권장), 키는 해당 기기 localStorage에만 보관한다.
 */
export function createClient(apiKey: string, timeoutMs: number): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: timeoutMs, maxRetries: 0 });
}

/** 응답 본문의 text 블록을 이어 붙인다 */
export function replyText(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function parseReportText(raw: string): ReportText | null {
  const data = parseJsonReply(raw);
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  const { curiosity, choices, comprehension, prompts } = d;
  if (typeof curiosity !== "string") return null;
  if (typeof choices !== "string" || typeof comprehension !== "string") return null;
  if (!Array.isArray(prompts) || prompts.length < 2 || prompts.length > 3) return null;
  if (!prompts.every((p) => typeof p === "string")) return null;
  return { curiosity, choices, comprehension, prompts: prompts as string[] };
}

export function isTimeout(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return true;
  return err instanceof Error && err.name === "AbortError";
}

export async function generateReport(
  input: ReportInput,
  apiKey: string | null,
  deps: { client?: Anthropic; now?: () => number; said?: (string | undefined)[] } = {},
): Promise<ReportResult> {
  const now = deps.now ?? (() => Date.now());
  const fallback = (reason: FallbackReason): ReportResult => ({
    text: templateReport(input, deps.said ?? []),
    source: "template",
    fallbackReason: reason,
  });

  if (!apiKey) return fallback("no_key");

  const started = now();
  try {
    const client = deps.client ?? createClient(apiKey, LLM_TIMEOUT_MS);
    const res = await client.messages.create(buildRequest(input));
    const latency = now() - started;

    if (res.stop_reason === "refusal") return fallback("refusal");
    if (res.stop_reason === "max_tokens") return fallback("max_tokens");

    const text = parseReportText(replyText(res));
    if (!text) return fallback("parse_error");

    const all = [text.curiosity, text.choices, text.comprehension, ...text.prompts].join("\n");
    if (containsForbidden(all).hit) return fallback("filtered");

    return { text, source: "llm", llmLatencyMs: latency };
  } catch (err) {
    return fallback(isTimeout(err) ? "timeout" : "http_error");
  }
}
