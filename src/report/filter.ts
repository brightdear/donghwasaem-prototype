/**
 * 부모 리포트 금지 표현 필터 — 계획 단계 1, 근거 3.4.
 * 금지어는 어간으로 매칭해 활용형("향상됐", "발달이")도 잡는다.
 * 리포트에는 아라비아 숫자·비율 표기·이모지가 없어야 한다(한글 수사 "세 가지"는 통과).
 */

const FORBIDDEN_STEMS = ["점수", "등급", "향상", "문해력", "발달"];

export interface FilterResult {
  hit: boolean;
  matches: string[];
}

export function containsForbidden(text: string): FilterResult {
  const matches: string[] = [];
  for (const stem of FORBIDDEN_STEMS) {
    if (text.includes(stem)) matches.push(stem);
  }
  // 숫자 비율: "3개 중 2개", "2/3", "%"
  for (const m of text.matchAll(/\d+\s*개\s*중\s*\d+\s*개?/g)) matches.push(m[0]);
  for (const m of text.matchAll(/\d+\s*[/／]\s*\d+/g)) matches.push(m[0]);
  if (/[%％]/.test(text)) matches.push("%");
  // 아라비아 숫자(전각 포함) 자체
  for (const m of text.matchAll(/[0-9０-９]+/g)) matches.push(m[0]);
  for (const m of text.matchAll(/\p{Extended_Pictographic}/gu)) matches.push(m[0]);
  const unique = [...new Set(matches)];
  return { hit: unique.length > 0, matches: unique };
}
