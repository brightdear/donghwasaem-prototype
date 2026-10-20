# 동화샘 시제품

분기 선택 동화(흥부와 놀부, 개미와 베짱이)를 브라우저 TTS로 읽어 주고, 아이의 선택·반응을 로그로 남겨 부모 리포트를 만드는 첫 실험용 시제품.

## 실행

```
npm install
npm run dev          # 개발 서버
npm test             # Vitest (검증기 R1~R7, 엔진, 로그, TTS 등)
npm run build        # 타입 검사 + 빌드(dist/)
npm run preview      # 빌드 결과 미리보기 (개발용. 실험·점검은 Pages 주소만 사용)
npm run transcripts  # 경로별 낭독 전문·분량표를 docs/transcripts/ 에 생성 (커밋하지 않음)
```

`file://` 로 직접 여는 방식은 지원하지 않는다.

## GitHub Pages 배포와 origin 주의

- 배포는 `.github/workflows/pages.yml` 하나로 한다. 모든 push·PR에서 `test` 잡(`npm ci` → `npm test`)이 돌고, `main` 에서만 테스트 통과 뒤 `deploy` 잡(`npm run build` → Pages 배포)이 돈다.
- **JSON을 고친 뒤에는 Actions가 초록인지 확인한다. 빨강이면 배포되지 않고 이전 버전이 그대로 떠 있다.**
- **로그와 API 키는 origin(Pages 주소)에 묶인 localStorage 에 저장된다.** 로컬 IP, 다른 도메인 등 다른 주소로 열면 이전 로그와 키가 보이지 않는다. 기기 점검·리허설·가정 방문 모두 같은 Pages 주소만 쓴다.
- **배포 주소: https://brightdear.github.io/donghwasaem-prototype/** (저장소 `brightdear/donghwasaem-prototype`, 공개).
- 같은 GitHub 계정의 다른 Pages 사이트는 origin(`brightdear.github.io`)을 공유한다. 이 계정에는 가치기상 앱 공개 페이지(`brightdear.github.io`, 처리방침·삭제 요청·초대 링크, 외부 스크립트 없음)가 이미 있다. 그 페이지에 외부 스크립트·광고·분석 코드를 넣지 않는다. 넣어야 한다면 이 시제품을 새 GitHub 조직으로 옮긴다(주소가 바뀌면 기기 로그는 새로 시작).
- API 키는 **실험 전용·월 한도 낮은 키**를 따로 만들어 쓰고, 세션이 끝날 때마다 JSON 내보내기, 방문을 마칠 때마다 실험자 화면에서 키 삭제.

## 시나리오 JSON 편집

- 파일: `src/data/heungbu.json`, `src/data/ant.json`. **JSON은 주석을 쓸 수 없다.** 문법 오류는 `npm test`·빌드에서 파일·줄 위치와 함께 실패한다.
- 앱 로드 시와 테스트에서 검증기(`src/story/schema.ts`)가 돈다. 위반 시 실험자 화면에 오류 목록이 뜨고 그 이야기는 선택할 수 없다.
- 검증기 규칙 요약:
  - R1 `choice` 노드 정확히 3개, `choicePoints` id와 1:1
  - R2 선택지 2~3개, `matchesOriginal: true` 정확히 1개, 나머지는 `mismatch.rewind{consequence, contrast, contrastFinal}`·`converge{consequence, bridge}`·`altEnding{consequence, bridge}` 3종 모두 보유
  - R3 모든 선택지에 `echo`, `why` 2~3개. 원작 선택지에 `consequence`·`offNarration` 필수(`offNarration` 에 "골랐" 금지). `contrast`·`contrastFinal` 둘 다 필수, 두 필드에 "다시 골라" 금지(재선택 안내는 `strings.ts` 에만)
  - R4 `comprehension` 4~5개, 유형 3종(explicit/inference/sequence) 각 1개 이상, 보기 2~3개, `answer` 가 보기 id, `answerFact` 비어 있지 않음. 배열 `answerFact` 는 `sequence` 에만(원소 2개 이상)
  - R5 `refersTo` 는 척추 `passage` id만, `answerFact`(배열이면 각 원소)는 참조한 passage 안에 문자열로 존재
  - R6 `endings.original`·`endings.alt` 둘 다 존재, `parentPrompts` 2개 이상
  - R7 모든 텍스트에 이모지·금지어 없음
- R8(의미 규칙): 척추 passage 는 직전 선택의 결과를 전제하지 않는다. 결과 의존 내용은 `consequence`/`bridge` 안에만 둔다. 정답 사실은 척추 passage 안에만 둔다.

## 분석 메모

- 참가자 코드 `R` 접두(R01~R14)는 리허설 전용이며 **분석에서 제외**한다. 실험 참가자는 `P` 접두.
- **(참가자 코드, 이야기)별로 시작 epoch 가 가장 이른 첫 세션만** 분석한다. 재시작 세션은 기록표에 적는다.
- 분기 off 의 `offNarration` 낭독도 `screen=echo` 로 기록된다. 되짚기 분석은 `screen` 이 아니라 `node_id` 접미사 `.echo` 로 거른다(분기 off 는 `.offNarration`).
- `forced_original` 행은 rewind 조건에서 다른 선택을 2회 한 뒤 3회째에 원작 결과로 강제 진행될 때만, `attempt=3` 으로 기록된다.
- `manualReading=true`(실험자 낭독 모드) 세션은 분석에서 제외하거나 따로 본다.
- `rt_basis` 가 `tts_end` 가 아닌 행(`shown`, `watchdog`)은 반응시간 분석에서 걸러낼 수 있다.

## 금지 사항

- 이미지·이모지·효과음·보상 요소를 넣지 않는다.
- API 키를 커밋하지 않는다(키는 실험자 기기 localStorage 에만, CSV·JSON 내보내기에서 제외).
- `innerHTML` 을 쓰지 않는다. 모든 텍스트는 `textContent` 로 렌더링한다.
- `docs/transcripts/` 는 생성물이므로 커밋하지 않는다.

## 점검·리허설 문서

- `docs/기기점검표.md` — Chrome 안드로이드 태블릿 / Safari iPad 점검
- `docs/리허설절차.md` — 참가자 코드 R01~R14 리허설
