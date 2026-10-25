# SDD ledger — plan: D:\youtube\동화샘\prototype\docs\superpowers\plans\2026-10-25-heungbu-original-ask-layer.md

Spec: docs/superpowers/specs/2026-10-25-heungbu-original-ask-layer-design.md (읽음, 구속력 있음)
Branch: feat/original-ask-layer (main a399950에서 분기, 설계·계획 커밋 f62ee14)

Ruling: 워크트리 대신 같은 저장소의 feat/original-ask-layer 브랜치에서 작업 — 계획이 브랜치를 명시했고 node_modules·개발 서버가 이미 준비돼 있음 — 틀리면 사용자가 main을 동시에 써야 할 때 stash가 필요한 정도.

## Pre-flight scan

| 쌍/작업 | 생산 ↔ 소비 | 결과 |
|---|---|---|
| T1↔T5 | types.ts VALID_CONDITIONS ↔ Screen/Action 추가 | 다른 구역, 충돌 없음 |
| T1↔T10 | Settings.askLayer/voiceAsk ↔ experimenter·main | 이름 일치 |
| T2↔T5 | engine confirmChoice ↔ enterSpine 리팩터 | 다른 함수, T2 테스트가 회귀를 잡음 |
| T2↔T11 | converge→원작 consequence ↔ 다리글이 원작 행동 시작으로 끝남 | 일치(c1b·c2b·c3b·c3c 다리글 끝 문장 확인) |
| T3↔T5 | AskBlock(intro·sceneLabel·clue) ↔ helpers-ask ASK_C1 | 필드 일치 |
| T3↔T12 | R10 keywords "공백 제거 2자 이상" ↔ 실데이터 키워드 | **충돌**: 1자 키워드(써·왜·준·줬·춥·떨·겁·밥·놓) 존재 → 아래 Ruling |
| T4↔T6 | AskOutput ↔ voiceResult.matched | 모양 일치 |
| T5↔T8 | AskView(storyId·prompt…) ↔ art.test askView 리터럴 | 필드 일치 |
| T5↔T14 | transcript init 설정(askLayer:false) ↔ renderTranscript 4번째 인자 | 호환 |
| T6↔T9 | voiceFail.reason 문자열 ↔ AsrFailReason | 엔진은 string, 값 일치 |
| T7↔T9↔T10 | createAsr(opts)·Asr ↔ makeAsr ↔ main | 서명 일치 |
| T9↔T10 | RunnerDeps.asrSupported, createVoiceController deps | 일치 |
| T11↔T12 | heungbu.json 순차 수정 | 순서 보장 |
| T10↔T13 | main.ts 리포트 호출부 | T10은 손대지 않음, T13이 바꿈 |
| T5 자체 | ask_listen 로그 순서(at(-2)) ↔ 엔진 listen이 로그 후 speak | 일치 |
| T11 자체 | spine 기대 배열에 "end" ↔ 실제 ending id "end" | 일치 |
| T13 자체 | llm.test 헬퍼 textRes·mock·gen 존재 | 확인됨 |
| 전역 | ant.json 무수정 통과 | ask 선택 항목이라 성립 |

Ruling: Task 12 키워드 중 1자짜리를 2자 이상으로 바꾼다(스펙 6.4 "2자 이상"이 구속) — 써→"뭐에 써"·"쓰는", 왜→"왜 줬"·"왜 준", 준·줬→"줬어", 춥→"춥지"·"추운", 떨→"떨려"·"떨고", 겁→"겁나", 밥→"밥 있"·"밥은", 놓→"놓을"·"어디 놓" — 틀리면 몇몇 아이 발화를 못 맞춰 카드로 넘어가는 정도. (계획 Task 12 본문도 갱신함)

## Progress
Task 1: ⚠️ 해소 — 테스트·타입검사 통과는 구현자 보고(283/283, typecheck clean)로 확인; Settings 리터럴 소비자 파손은 typecheck 통과로 해소.
Task 1: minor (deferred): main.ts loadSettings catch가 { ...DEFAULT_SETTINGS } 얕은 복사(parseSettings(null)로 바꾸면 됨); parseSettings가 defaultConditions의 알 수 없는 키를 통과시킴; settings.test에 잘못된 mismatch·askWhy "na"·배열 입력 사례 없음.
Task 1: complete (commits 0eb2d0f..edbbd95, review clean)
Task 2: ⚠️ 해소 — 커밋 트레일러는 git log로 확인; CSV·art.test는 291/291 통과 보고로 해소; 기존 "converge·altEnding 낭독 내용" 테스트 뒤집기는 새 동작에 필요한 변경으로 인정.
Task 2: minor (deferred): engine.ts 원작 consequence Pending 리터럴을 손으로 만듦(세 번째 등장 시 헬퍼 추출); transcript 테스트가 c1만 확인; engine.test it 제목의 중첩 삼항.
Task 2: complete (commits edbbd95..bb84d5f, review clean)
Task 3: minor (deferred): voice false일 때 unmatched 타입 미검사; 인물 id 중복 미검사(bodyNodePages 키 충돌 가능); S_TYPE 경로·질문 4개·voice false+unmatched 테스트 없음; 비문자열 keyword가 S_TYPE 아닌 R10_ASK_KEYWORDS.
Task 3: complete (commits bb84d5f..fbb911f, review clean)
Task 4: ⚠️ 해소 — 커밋 트레일러·LF는 git log·file로 확인.
Task 4: minor (deferred): 키워드·이름 normalize를 후보마다 재계산(호이스팅 가능); NFC·인물 간 동점·transcript 중복·빈 키워드 가드·선택 인물 responder 테스트 없음; 가드에 주석 없음; 인물·질문 id 중복은 검증기(T3 minor)와 함께 처리.
Task 4: complete (commits fbb911f..c65f04f, review clean)
Task 5: Ruling: 구현자가 typecheck 통과를 위해 brief 밖 파일을 고친 것(rt.test·session.test 설정 리터럴, main.ts 고정값 askLayer:false/voiceAsk:false, art.ts ask=choice 규칙, child.ts 자리표시, Screen에 "askAnswer" 포함)을 인정 — 계획이 BodyScreen⊂Screen 관계와 리터럴 소비처를 빠뜨린 결과이며 Task 8·10이 덮어쓴다 — 틀리면 Task 10에서 자리표시를 지우는 정도.
Task 5: ⚠️ 해소 — 트레일러 git log 확인; ant.json·csv.ts는 diff --stat 비어 있음.
Task 5: Ruling: 인물을 고르지 않아도 카드 id로 listen/confirm이 되는 것은 유지 — 음성 경로(voiceResult)가 어느 인물의 질문이든 확정해야 하므로 같은 함수가 필요하고 UI는 고른 인물의 카드만 보여 줌 — 틀리면 UI 밖 입력으로 다른 인물 카드가 확정되는 정도(실험 환경에서는 무해).
Task 5: minor (deferred): asked·voiceFails 불변성 회귀 테스트 없음; askCharacter가 카드 낭독을 cancelLive하지 않음; maxAsks가 질문 수보다 크거나 0이면 카드만 회색/asksLeft 0 화면(검증기로 막을 수 있음, 현재 데이터는 해당 없음); askAnswer 그림 규칙은 Task 8에서 확정; ask_listen 테스트가 로그 순서(at(-2))에 의존.
Task 5: complete (commits c65f04f..784b4a6, review clean)
Task 6: ⚠️ 해소 — 트레일러 git log 확인.
Task 6: minor (deferred): 되묻기 낭독 중 voiceStart가 cancel하는지 테스트 없음; 반복 테스트가 voiceFails 0에서만 확인; 존재하지 않는 matched id 분기 테스트 없음; 입력 상태 불변 테스트 없음; askQuestion 중복 호출.
Task 6: complete (commits 784b4a6..d4a1388, review clean)
PAUSE: 2026-10-25 사용자에게 기획서 v2.0(지석) 충돌 보고 — Task 7 이후 진행은 사용자 답(계속/조정/멈춤) 대기.
RESUME: 사용자 결정(2026-10-25 저녁) — 대상 "한글 막 뗀 아이", 작품 흥부 유지(v2.0의 돼지·사자는 예시), 핫스팟 제외 → 계획 14개 전부 진행. Ruling: LLM 응답기(LlmResponder, 키워드는 복구용)를 Task 15로 추가하고 Task 14(머지) 앞에 둔다 — v2.0이 영상에 실제 LLM 응답을 요구 — 틀리면 Task 15가 안 쓰이는 정도.
Task 7: 참고 — 구현자가 구현 후 모듈을 치워 RED를 확인(순서 역행). 테스트가 독립 가짜 객체로 행동을 검증하므로 인정.
Task 7: minor (deferred): 세대(gen) 가드 테스트 없음(stale 인스턴스 onend); start() 예외·빈 results[0] 경로 테스트 없음; 가짜 abort()가 이벤트를 안 냄; 비문자열 transcript 묵살.
Task 7: complete (commits d4a1388..0bf1cee, review clean)
Task 8: Ruling: 커밋 트레일러가 'Claude Haiku 5.5'로 적힘(구현 모델) — 실제 작성 모델 표기라 수정하지 않음 — 비용 없음.
Task 8: minor (deferred): clue 경로에서 art.motions 무시(검증기는 허용) — bodyOverlays로 얹거나 주석; askAnswer 노드의 art.pages 우선 규칙 테스트 없음; questionOf가 id에 점이 없다고 가정(주석 필요).
Task 8: complete (commits 9f278f3..633a664, review clean)
Task 9: ⚠️ 해소 — 트레일러 git log 확인; CSV·ant.json은 diff에 없음.
Task 9: minor (deferred): respond() 지연 중 재탭 시 stale 결과가 새 세션 답으로 소비될 수 있음(세대 토큰 없음) → **Task 15(LLM 지연 생김) 브리프에 세대 토큰 요구를 넣는다**; .then(...).catch가 dispatch 예외를 voiceFail로 삼킴; 비-ask 화면 결과·respond 거부·null match 테스트 없음; runner asr:"available" 케이스 없음; flush 헬퍼가 프라미스 깊이에 의존.
Task 9: complete (commits 633a664..40af4dc, review clean)
Task 10: ⚠️ 해소 — 듣는 중 마이크 재탭은 엔진 unchanged + asr.start() no-op(Task 7)이라 무해; 귀퉁이·확정 버튼 겹침은 시각적 문제로 Task 14 브라우저 확인 때 재점검.
Task 10: minor (deferred): 마이크 버튼 listening 중 disabled 처리 없음; 귀퉁이와 "이걸로 할래" 버튼 시각 겹침; 그림 없는 화면 "다음" 버튼 btn-secondary(결정).
Task 10: complete (commits d0846af..4ff596b, review clean)
Task 11: Ruling: 트레일러 'Claude Opus 5.5'(구현 모델) 유지 — 비용 없음. p3_02.webp(놀부 비단옷·큰 집)가 새 문장과 어긋남 → 그림 지시서 §8에 재작업 권고 포함, 사용자 몫.
Task 11: ⚠️ 해소 — 점검표 c3b/c3c 다리글 글자 수는 구현자 node 집계 신뢰; 저장소 밖 두 문서는 존재·제목 확인.
Task 11: minor (deferred, 재검수 때): p2n 제비 계절 단서("봄이 오자") 없음; q3 정답과 q4 오답("박씨를 얻으려고")이 겹침 → q4 오답 교체 검토; c3c 다리글(밖으로 뛰어나감) 뒤 c3a "문을 활짝 열었어요"가 살짝 어색; 점검표 §1 분량 표의 옛 숫자(1,474/2,000) 미갱신; §2 어휘 점검 목록에 비단옷·휩쓸어 추가 필요.
Task 11: complete (commits 4ff596b..11ab017, review clean)
Task 12: Ruling: c3 흥부 q1 키워드 '밉'·'싫'(1자)을 '미워','미웠','미운','싫어'로 교체 — R10 2자 규칙 — 틀리면 '형 싫어?' 변형 일부를 못 맞추는 정도. matcher.test의 heungbu 이름 충돌은 heungbuStory로 회피.
Task 12: Ruling: 리뷰 Important — '엄마 어디 있어?'가 tie-break로 swallow q2에 잡힘. 계획의 '그대로 붙여 넣기'보다 아이가 올바른 대답을 듣는 것이 우선(스펙 6.2) → q3 keywords에 '엄마 어디' 추가 + 회귀 테스트. 함께 c3 흥부 q1에 '밉지','싫지' 추가(minor 수용). — 틀리면 없음.
Task 12: fix round 1/5 (2 addressed, 0 open — '엄마 어디' + '엄마는' 키워드, '밉지'·'싫지'; commits 2461d39..2a3a4fd). Ruling: '엄마는' 추가(승인 밖) 수용 — '엄마는 어디 있어' 동점 해소에 필요 — 틀리면 c1에서 '엄마는…' 발화가 제비 q3으로 쏠리는 정도(무해).
Task 12: minor (deferred): '엄마 어디 아파?' 같은 중의 발화는 여전히 동점→앞 질문; c3 흥부 q2 '할 거' 키워드가 포괄적; c3 흥부 q1 대답이 원작 쪽으로 기우는 편; JSON 들여쓰기 불일치.
Task 12: complete (commits 11ab017..2a3a4fd, review clean after 1 fix round)
Task 13: Ruling: saidByAsk(record, story) 2인자 서명 수용 — 미해결 question_id를 asks와 같은 규칙으로 건너뛰어야 인덱스가 맞음(계획 누락) — 비용 없음.
Task 13: ⚠️ 해소 — 트레일러 git log 확인; 빌드·브라우저는 구현자 보고(369/369, 5174 확인).
Task 13: minor (deferred): templates 전수 테스트가 curiosity 숫자 검사를 안 함; llm.test '형태 불일치' 페이로드에 curiosity 누락(두 이유로 실패); buildRequest AC-16 단언이 자명; 인식 글 원문은 템플릿에 필터 없이 들어감(부모 화면·아이 발화라 허용).
Task 13: complete (commits 2a3a4fd..8fe5d87, review clean)
Task 15: Ruling: ask_free의 리포트 question에 인식 글을 넣지 않고 고정 문구 "스스로 생각한 질문"+free:true, 인식 글은 saidByAsk(템플릿 전용)로만 — 계획 문구대로 하면 리포트 LLM 요청에 아이 발화가 들어가 AC-16 불변식(Task 13)이 깨짐 — 틀리면 LLM 리포트에서 자유 질문 내용이 안 보이는 정도(템플릿엔 보임). AskInput.storyTitle? 추가 수용. 실제 키로 6초·품질 확인은 Task 14 브라우저 확인 항목으로 이월(사용자 키 필요).
Task 15: review — Important 1건(voice_result.responder가 설정값 기록) → fix round 1 진행 중. 승인 minor: 질문 id "free" 예약어 검증.
Task 15: minor (deferred): containsForbidden이 아라비아 숫자 전반을 막지 않음(설명 과장); 문장 수 계산이 …·~·줄바꿈 미인식; 이모지 정규식의 국기·키캡 누락; questionId undefined→free 처리; 엔진 free 경로가 선택 인물 재검사 안 함; fallback이 throw하면 respond 밖으로 새어 나감(이론상); 테스트 공백(create 인자·HTTP 오류·금지어 응답·catch 경로); 사용자 턴에 "다음은 데이터" 안내문 추가 권고; **자유 질문은 asksLeft에 안 세므로 LLM 호출 무제한(비용) → Task 14·실험 운영 메모**.
Task 15: fix round 1/5 (2 addressed, 0 open — AskOutput.source/fallbackReason/latencyMs 실제 응답기 기록, "free" 예약어; commits f9304e1..bfc6b41)
Task 15: Ruling: LLM 실패+키워드도 못 맞춘 경우 voice_result에 이유가 안 남는 것은 지금 수용(답을 잘못 귀속시키는 건 아님) — 후속으로 AskResponder가 miss 객체({matched:null, fallbackReason, latencyMs})를 돌려주게 바꾸는 것을 Task 14 뒤 과제로 — 틀리면 타임아웃 미응답 원인을 로그에서 못 보는 정도.
Task 15: minor (deferred): Action.fallbackReason 타입을 AskFallbackReason으로 조이기; 첫 커밋이 matcher 테스트 1개를 깨뜨린 채 커밋됨(둘째 커밋으로 수정, squash 선택).
Task 15: complete (commits 8fe5d87..bfc6b41, review clean after 1 fix round)
Task 14: minor (deferred): .child.has-scene:has(.ask-panel) .actions 규칙이 세로 모드 @media의 .actions 위치를 덮어쓸 수 있음(iPad 세로 확인); ASK_ON 대본 테스트가 lines의 ask 낭독 부재·storyChars 동일성까지 단언하지 않음; README R10이 R9 앞에 적힘; 기기점검표에 "묻기 끄기" 기기 확인 행 없음.
Task 14: complete (commits bfc6b41..fd7c07b, review clean) — merge/push 제외(사용자 확인 뒤)
FINAL REVIEW (a399950..fd7c07b, opus): With fixes. Important I1 LLM 대기 중 마이크 재탭이 질문을 버림(voice.start 재진입); I2 listening 중 카드·replay 낭독이 열린 마이크로 들어감(스펙 6.2 위반); I3 계획 제약(인식 글 LLM 전송 금지)과 Task 15(askLlm 켜면 전송) 불일치 + README/점검표 동의 문구 없음. 머지 전 수정 지정: T9 stale 재탭(I1), T10 마이크 disabled(I2), T11 점검표 §1 옛 숫자.
Ruling: 준비된 질문에 매칭되면 LLM 대답 대신 저작된 대답을 낭독(스펙 6.3 문구와 다름) — 저작 글이 더 안전하고 Task 6 설계가 그렇게 됨 — voice_result.detail.spoken으로 어느 글이 나갔는지 기록해 로그 오해를 막는다. 틀리면 LLM 대답 품질을 로그로 못 보는 정도.
Ruling: c3 흥부 q2 대답 "네가 골라 주면 그렇게 해 볼게" → "생각 중이야. 네 생각을 들려줘." (converge에서 약속이 깨지므로).
Ruling: I3는 계획 제약을 "askLlm 옵트인 예외"로 개정하고 README·점검표에 두 데이터 흐름(크롬 음성→구글, askLlm→Anthropic) 명시, 시스템 프롬프트에 들은 이름 반복 금지 추가 — 동의서 자체는 범위 밖.
FINAL FIX WAVE: commit 60851e3 (F1~F6) — scoped re-review: all addressed, no new breakage. 414/414 tests.
READY: 머지·push는 사용자 확인 대기(2026-10-25).
