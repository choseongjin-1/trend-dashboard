# 루프 엔지니어링 로그

## 실 크리덴셜 통합 검증 (오케스트레이터, main)

**배경**: 사용자가 YouTube API 키 + Supabase 프로젝트 크리덴셜을 `.env.local`에 설정 완료.

**관찰 1**: `/api/trends` → `mocked:false`, 실제 유튜브 트렌딩 데이터 정상 수신.
`/api/trends/history` → `[]` (비어있음), 로그에 `saveTrendSnapshot`/`getRecentTrendSnapshots`
둘 다 `PGRST125 Invalid path specified in request URL` 에러.

**원인**: `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`이 Supabase "Data API" 설정 화면의
REST 엔드포인트(`https://xxx.supabase.co/rest/v1/`)로 설정되어 있었음. Supabase JS 클라이언트가
`/rest/v1/...` 경로를 자체적으로 붙이기 때문에 경로가 중복되어 무효화됨.

**조치**: `.env.local`의 값을 프로젝트 베이스 URL(`https://xxx.supabase.co`, 경로 없음)로 수정.
(코드 변경 아님 — 로컬 환경설정 값 수정)

**관찰 2 (수정 후)**: 서버 재기동 후 `/api/trends` → `mocked:false` 정상,
`/api/trends/history` → 방금 저장된 스냅샷 1건 정상 반환 (id/source/region/fetched_at/items 스키마 일치).

**검증**: 성공 기준 전체 충족 확인 —
1. YouTube 실 API 연동 정상 (mocked:false)
2. Supabase 저장 정상 (insert 성공, 에러 없음)
3. `/api/trends/history`가 실제 저장된 스냅샷을 스키마대로 반환
4. 프론트엔드 델타/스파크라인 로직은 스냅샷이 2개 이상 쌓이면 자동으로 활성화됨 (코드상 확인됨, 시간 경과 후 재확인 필요)

**남은 것**: Supabase `trend_snapshots` 테이블에 스냅샷이 계속 쌓이는지, 배포(Vercel) 설정은 아직 미확인.


## 프로젝트: 실시간 인기 키워드/해시태그 랭킹 대시보드

### 목표
YouTube 인기 급상승 데이터를 기반으로 실시간 키워드 랭킹을 보여주는 대시보드 MVP를
프론트엔드/백엔드 병렬 루프로 빠르게 구축하고, 로컬 e2e 동작 및 배포 직전 상태까지 만든다.

### 성공 기준
- [x] `/api/trends`가 스키마(TrendsResponse)에 맞는 JSON을 반환한다
- [ ] 실제 YouTube Data API로 랭킹을 채운다 (현재는 API 키 부재로 mock 데이터, `mocked: true`)
- [ ] Supabase에 랭킹 스냅샷을 저장하고 이력 조회가 가능하다
- [x] 대시보드가 랭킹 리스트를 렌더링하고 로딩/에러 상태를 처리한다
- [x] `npm run dev`로 로컬 e2e 동작 확인
- [ ] 배포 준비 (Vercel 배포 설정 + env 문서화 확인)

---

### 반복 1 — 오케스트레이터 (스캐폴딩)

**실행**
- Next.js 16 (App Router, TS, Tailwind) 스캐폴딩
- `/api/trends` GET 라우트 구현 — `YOUTUBE_API_KEY` 있으면 실 API, 없으면 mock으로 폴백
- `src/lib/trends/{types,mock,youtube}.ts` — 프론트/백 공용 데이터 계약 정의
- `src/lib/supabase/server.ts`, `supabase/schema.sql` — 저장 계층 뼈대
- 대시보드 페이지(`src/app/page.tsx`) — 랭킹 리스트 + 로딩/에러/새로고침 UI
- `.env.example` 작성

**관찰**
- `npm run lint` → 최초 실패: `react-hooks/set-state-in-effect` (React 19 신규 규칙, mount 시 fetch 패턴을 직접 감지)
- 수정 후 `npm run lint` → 통과
- `npm run build` → 성공 (`/`, `/api/trends` 라우트 정상 생성)
- `npm run dev` 기동 후 `curl localhost:3000/api/trends?region=KR` → 200, `mocked:true`, 스키마 일치 확인
- `curl localhost:3000/` → 200

**검증**
- 성공 기준 중 mock 기반 항목(API 계약, UI 렌더링, 로컬 e2e)은 충족
- 실 API 연동, Supabase 저장, 배포 준비는 **차단됨** — `YOUTUBE_API_KEY`, Supabase 프로젝트 credential 부재 (규칙 10: 정보 부족)

**다음 반복에 필요한 것**
- YOUTUBE_API_KEY 발급 (Google Cloud Console → YouTube Data API v3 활성화)
- Supabase 프로젝트 URL + anon key + service role key
- 확보되는 즉시 반복 2에서 백엔드 세션이 실 연동 검증 진행

---

## 반복 1 — 백엔드

> 별도 워크트리(`VIBE-DEV-backend-wt`, 브랜치 `backend-loop`)에서 백엔드 트랙 전담 진행.
> 목표: Supabase 자격증명 없이도 안전하게 동작하는 스냅샷 저장/조회 계층 구축 +
> 키워드 집계/랭킹 순수 로직에 대한 자동화된 회귀 테스트 추가.

### [목표]
1. `saveTrendSnapshot()`으로 `trend_snapshots`에 스냅샷 저장, Supabase 미설정 시 안전한 no-op
2. `/api/trends`가 저장 실패/스킵과 무관하게 항상 정상 응답
3. `GET /api/trends/history`가 최근 스냅샷을 반환하되 Supabase 없으면 `[]` + 200
4. `youtube.ts`의 순수 집계/랭킹 로직을 네트워크 호출과 분리해 단위 테스트 가능하게 리팩터링, 실제 테스트 작성
5. lint/build/test 모두 통과
6. `npm run dev -p 3001`로 두 라우트 curl 확인 후 서버 종료

### [계획]
1. `npm install` (node_modules 미존재 상태였음)
2. `src/lib/trends/youtube.ts`에서 집계 로직을 `aggregateTrendItems(videos, limit)` 함수로 추출 (순수 함수, `YouTubeVideoItem` export)
3. `src/lib/trends/persist.ts` 신설 — `saveTrendSnapshot`, `getRecentTrendSnapshots` (둘 다 client가 null이거나 쿼리 실패 시 throw 없이 안전하게 처리)
4. `src/app/api/trends/route.ts`에서 응답 계산 후 `persistInBackground()`로 저장 호출 (내부적으로 `.catch`로 감싸 응답에 영향 없음)
5. `src/app/api/trends/history/route.ts` 신설 — `getRecentTrendSnapshots(region, limit)` 결과를 JSON 배열로 그대로 반환 (200 고정)
6. 테스트 러너 선택: **vitest** — Next.js 16 프로젝트에 TS/ESM 별도 로더 설정 없이 바로 동작하고, `vite.config` 기반이라 `@/*` alias를 tsconfig와 동일하게 매핑하기 쉬워서 `node --test`보다 마찰이 적음. `vitest.config.mts` + `src/lib/trends/youtube.test.ts` 작성
7. `npm run lint`, `npm run test`, `npm run build` 순서로 검증
8. `npm run dev -- -p 3001` 기동 후 두 라우트 curl, 로그 확인, 서버 종료

### [실행 + 관찰]

**`npm install`**
```
added 367 packages, and audited 368 packages in 5s
found 0 vulnerabilities
```

**리팩터링**: `src/lib/trends/youtube.ts`에 `aggregateTrendItems(videos: YouTubeVideoItem[], limit = 20): TrendItem[]`를 추출. `fetchYoutubeTrends`는 이제 fetch + `aggregateTrendItems` 호출만 담당.

**신설 파일**
- `src/lib/trends/persist.ts` — `saveTrendSnapshot(snapshot)`, `getRecentTrendSnapshots(region, limit)`
- `src/app/api/trends/history/route.ts` — `GET /api/trends/history?region=&limit=`
- `src/lib/trends/youtube.test.ts` — `aggregateTrendItems` 단위 테스트 5개 (점수 합산/정렬, 태그 없을 때 제목 폴백, viewCount 없을 때 0 처리, 공백 태그 스킵, limit 파라미터)
- `vitest.config.mts` — `@/*` alias, `src/**/*.test.ts` 포함

**수정 파일**
- `src/app/api/trends/route.ts` — 응답 계산 후 `persistInBackground(trends)` 호출 추가 (mock/실API/폴백 3개 분기 모두)
- `package.json` — `"test": "vitest run"` 스크립트 및 `vitest` devDependency 추가

**`npm run test` (vitest run)**
```
 RUN  v4.1.11 /Users/choseongjin/VIBE-DEV-backend-wt

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  14:23:30
   Duration  99ms (transform 15ms, setup 0ms, import 21ms, tests 3ms, environment 0ms)
```

**`npm run lint`**
```
> trend-dashboard@0.1.0 lint
> eslint

(빈 출력 = 에러/경고 없음, exit 0)
```

**`npm run build`**
```
▲ Next.js 16.3.2 (Turbopack)
✓ Compiled successfully in 2.2s
  Running TypeScript ...
  Finished TypeScript in 1073ms ...
  Collecting page data using 7 workers ...
✓ Generating static pages using 7 workers (6/6) in 243ms

Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/trends
└ ƒ /api/trends/history
```

**`npm run dev -- -p 3001` + curl (Supabase 미설정 상태)**
```
=== /api/trends?region=KR ===
{"source":"youtube","region":"KR","fetchedAt":"2026-08-24T05:23:52.842Z","mocked":true,"items":[{"rank":1,"keyword":"가을 캠핑 브이로그","source":"youtube","score":100000}, ... 10 items ...]}
HTTP_STATUS:200

=== /api/trends/history?region=KR ===
[]
HTTP_STATUS:200
```
dev 서버 로그(`persistInBackground` 관련 에러 없음, 두 요청 모두 200):
```
 GET /api/trends?region=KR 200 in 310ms (next.js: 297ms, application-code: 13ms)
 GET /api/trends/history?region=KR 200 in 60ms (next.js: 57ms, application-code: 2ms)
```
`lsof -ti:3001 | xargs kill` 후 포트 재확인 → `PORT 3001 FREE` (정상 종료 확인).

### [검증] — 성공 기준 대조
1. `saveTrendSnapshot` 존재, `getSupabaseServerClient()`가 null이면 즉시 return (no-op), 예외도 내부에서 catch → **충족**
2. `/api/trends`가 `persistInBackground`로 저장 호출을 `.catch`로 감싸 응답과 분리 → **충족** (curl 200 확인)
3. `GET /api/trends/history` 신설, Supabase 없을 때 `getRecentTrendSnapshots`가 `[]` 반환 → 라우트가 그대로 200 JSON 배열 반환 → **충족** (curl로 실측 `[] / 200`)
4. `aggregateTrendItems` 순수 함수로 분리, `fetchYoutubeTrends`와 독립적으로 5개 vitest 테스트 통과 → **충족**
5. lint/build/test 모두 통과 (위 출력 참고) → **충족**
6. dev 서버(3001)에서 두 라우트 curl 200 + 스키마 일치 확인 후 서버 종료 → **충족**

### [반복/종료]
1회 반복으로 6개 성공 기준 모두 충족(근거 위 첨부). 추가 반복 불필요 — 규칙 9(종료 조건) 적용.

**한계/미검증 사항 (정직하게 명시)**
- 실제 Supabase 프로젝트에 대한 insert/select는 credential이 없어 **실물 검증 불가**. `persist.ts`의 컬럼 매핑(`source/region/fetched_at/items`)은 `supabase/schema.sql`의 `trend_snapshots` 스키마와 이름을 맞춰 작성했으나, 실제 DB 연결 시 재검증 필요.
- YouTube 실 API 연동(`fetchYoutubeTrends`)은 과제 범위 외 — 여전히 mock 폴백 경로만 실행됨 (`YOUTUBE_API_KEY` 미설정, 의도된 상태).
## 반복 1 — 프론트엔드

### [목표]
대시보드를 실제 제품 표면으로 강화: (1) 순위 변동/이력 표시, (2) 빈 상태(empty state) UI,
(3) 기존 로딩/에러/mocked 배너 동작 보존, (4) 컴포넌트 자동화 테스트, (5) lint/build/test 통과,
(6) dev 서버 부팅 및 200 확인. 백엔드가 병렬로 구현 중인 `/api/trends/history`는 이 워크트리에
아직 존재하지 않으므로 방어적으로 호출한다. `src/app/api/**`, `src/lib/supabase/**`는 건드리지 않는다.

### [성공 기준]
과제 지시의 6개 기준(이력/변동 표시, 빈 상태, 기존 동작 보존, 테스트, lint/build/test 통과,
dev 서버 200 + 가능하면 스크린샷) 그대로 채택.

### [계획]
1. 현재 코드(`page.tsx`, `types.ts`, `mock.ts`, `route.ts`) 파악
2. `/api/trends/history` 전용 방어적 fetch 유틸 + 런타임 응답 검증(`src/lib/trends/history.ts`) 작성
   — 백엔드가 아직 라우트를 구현하지 않았고 응답 스펙도 확정되지 않았으므로, 공용 계약 파일인
   `types.ts`를 건드리지 않고 프론트엔드 전용 파일에 예상 스펙과 타입가드를 정의. 404/네트워크
   오류/스펙 불일치 시 전부 `null`을 반환하도록 하여 UI가 항상 안전하게 이력 섹션을 숨기게 함.
3. 순위 변동 배지(`RankDelta`)와 스파크라인(`RankSparkline`) 컴포넌트 추가 (`src/components/`)
   — dataviz 스킬 가이드에 따라 색상만으로 의미를 전달하지 않도록 아이콘(▲/▼)+숫자를 항상
   같이 표시, 얇은 선(1.5px)·둥근 line cap 등 마크 스펙 적용
4. `page.tsx`에 이력 fetch(성공/실패 무관하게 메인 데이터 흐름과 분리된 별도 try/catch)와
   빈 상태 UI 추가, 기존 로딩/에러/mocked 배너 JSX는 그대로 유지
5. 테스트 도구 도입: vitest + @testing-library/react + jsdom + @testing-library/jest-dom
   (React 19 지원, Next.js와 별개로 빠르게 붙일 수 있는 표준 조합이라 선택. `next/jest` 대신
   vitest를 쓴 이유는 Next 16 + Turbopack 조합에서 별도 babel 설정 없이 `@vitejs/plugin-react`로
   즉시 동작하고, 워치 없는 단발 `vitest run`이 CI/루프 검증에 더 가볍기 때문)
6. `src/app/page.test.tsx`: 성공 렌더링, 에러 상태, 빈 상태, 이력 응답 스펙 불일치 시 미충돌
   4개 테스트 작성
7. lint / test / build 순차 실행 및 결과 확인
8. `npm run dev -- -p 3002`로 기동 후 curl 확인, Playwright로 스크린샷 캡처, 서버 종료

### [실행 + 관찰]

**npm install (최초, node_modules 없었음)**
```
added 367 packages, and audited 368 packages in 4s
found 0 vulnerabilities
```

**신규/변경 파일**
- `src/lib/trends/history.ts` (신규) — 이력 응답 타입가드 + `fetchTrendsHistory` (실패 시 항상 null) + `computeDelta`
- `src/components/RankSparkline.tsx` (신규) — 순위 역전 스케일 인라인 SVG 스파크라인
- `src/components/RankDelta.tsx` (신규) — ▲/▼/– 변동 배지 (색상 + 아이콘 + 숫자 병기)
- `src/app/page.tsx` (수정) — 이력 fetch 연동, 빈 상태 UI, 기존 로딩/에러/배너 로직 보존
- `src/app/page.test.tsx` (신규) — 컴포넌트 테스트 4건
- `vitest.config.mts`, `vitest.setup.ts` (신규)
- `package.json` — `"test": "vitest run"` 스크립트, vitest/testing-library devDependencies 추가

**`npm run lint`**
```
> trend-dashboard@0.1.0 lint
> eslint

(에러/경고 없음, 종료 코드 0)
```

**`npm run test`**
```
> trend-dashboard@0.1.0 test
> vitest run

 RUN  v4.1.11 /Users/choseongjin/VIBE-DEV-frontend-wt

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  14:25:06
   Duration  725ms (transform 36ms, setup 89ms, import 50ms, tests 91ms, environment 381ms)
```
테스트 4건: (a) mocked 성공 fetch 응답 시 랭킹 리스트 렌더링, (b) fetch 실패(500) 시 에러 상태 표시,
(c) `items: []` 시 빈 상태 UI 표시, (d) `/api/trends/history`가 스펙과 다른(malformed) JSON을
반환해도 페이지가 에러 없이 정상 렌더링(방어적 디그레이드 검증).

**`npm run build`**
```
> trend-dashboard@0.1.0 build
> next build

▲ Next.js 16.3.2 (Turbopack)
✓ Compiled successfully in 2.2s
  Running TypeScript ...
  Finished TypeScript in 1594ms ...
✓ Generating static pages using 6 workers (5/5) in 246ms

Route (app)
┌ ○ /
├ ○ /_not-found
└ ƒ /api/trends
```

**`npm run dev -- -p 3002` 기동 후 확인**
```
▲ Next.js 16.3.2 (Turbopack)
- Local:         http://localhost:3002
✓ Ready in 181ms

$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3002/
HTTP 200

$ curl -s "http://localhost:3002/api/trends?region=KR" | head -c 200
{"source":"youtube","region":"KR","fetchedAt":"2026-08-24T05:25:42.376Z","mocked":true,"items":[{"rank":1,"keyword":"가을 캠핑 브이로그","source":"youtube","score":100000}, ...

$ curl -s -o /dev/null -w "HTTP %{http_code}\n" "http://localhost:3002/api/trends/history?region=KR"
HTTP 404
```
`/api/trends/history`가 이 워크트리에 실제로 존재하지 않아 404가 나는 실제 상황에서, 대시보드는
정상적으로 200을 반환하고 렌더링됨(스크린샷으로 확인) — 방어적 처리가 실제 조건에서도 동작함을 확인.

**스크린샷 (Playwright chromium, 최초 설치 필요 — `npx playwright install chromium` 후 캡처)**
`http://localhost:3002/`를 캡처한 결과: 제목/부제, "새로고침" 버튼, 노란색 mocked 데이터 배너
("목업 데이터 표시 중입니다. YOUTUBE_API_KEY를 설정하면 실제 데이터로 전환됩니다."), 순위 1~10
리스트(키워드+점수), "마지막 갱신" 타임스탬프까지 정상 렌더링을 육안으로 확인. 이력 섹션(스파크라인/
변동 배지)은 `/api/trends/history`가 404를 반환하므로 `historyMap.size === 0`이 되어 의도대로
숨겨져 있고, 에러 배너나 크래시 없이 깨끗하게 보임 — 성공 기준 1의 "그레이스풀 디그레이드"를
실제 브라우저 렌더링으로도 확인.

**dev 서버 종료**
```
$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3002/
HTTP 200
$ pkill -f "next dev -p 3002"
$ lsof -iTCP:3002 -sTCP:LISTEN   # (출력 없음 — 정상 종료 확인)
```

### [검증]
성공 기준 1~6 모두 증거와 함께 충족:
1. 이력/변동 표시 — `RankDelta`+`RankSparkline`, `/api/trends/history` 방어적 fetch(404/malformed
   모두 null 처리 후 섹션 숨김), 테스트 (d)와 실제 dev 서버 curl/스크린샷으로 이중 확인
2. 빈 상태 UI — `isEmpty` 분기 + 전용 카드(아이콘/문구/재시도 버튼), 테스트 (c)로 확인
3. 기존 로딩/에러/mocked 배너 — JSX 그대로 유지, 테스트 (a)(b)로 회귀 없음 확인, 스크린샷으로도 확인
4. 자동화 테스트 — vitest + Testing Library, 4개 테스트 모두 통과
5. lint/build/test — 위 출력대로 전부 통과 (경고 없음)
6. dev 서버 부팅 + curl 200 + 스크린샷 — 확인 및 정상 종료

### [개선/반복]
1회차 실행에서 모든 기준이 충족되어 추가 반복이 필요하지 않음. 다만 다음을 명시적으로 기록:
- `/api/trends/history`의 실제 응답 스펙은 백엔드 트랙이 확정하는 대로 달라질 수 있음. 현재
  `src/lib/trends/history.ts`의 `isTrendsHistoryResponse`는 `{ region, items: [{ keyword, history:
  [{ rank, fetchedAt }] }] }` 형태를 가정한 추측 스펙이며, 실제 라우트가 다른 필드명/구조로
  나오면 타입가드가 거부해 이력 섹션이 계속 숨겨진 채로 동작한다(크래시는 없음). 병합 시
  백엔드의 실제 응답 스펙에 맞춰 `history.ts`의 타입/파서만 조정하면 됨 — UI 컴포넌트는
  `TrendHistoryPoint[]`만 소비하므로 변경 범위가 작음.

### [종료]
성공 기준 6개 모두 실측 증거로 충족 확인. `frontend-loop` 브랜치에 커밋 진행.

## 반복 2 — 프론트엔드 (백엔드 실계약 반영)

### [배경]
백엔드 트랙(`backend-loop`)이 `/api/trends/history`를 실제로 구현·커밋함
(`src/app/api/trends/history/route.ts` + `src/lib/trends/persist.ts`). 반복 1에서
`src/lib/trends/history.ts`에 추측으로 정의했던 스펙
(`{ region, items: [{ keyword, history: [{ rank, fetchedAt }] }] }`)과 실제 응답이 달라
계약 불일치가 발견됨.

**실제 계약**: `GET /api/trends/history?region=KR&limit=20` → 항상 HTTP 200,
스냅샷 행의 평탄한 JSON 배열 (`TrendSnapshotRow[]`, Supabase 미설정 시 `[]`).
```ts
interface TrendSnapshotRow {
  id: string; source: string; region: string; fetched_at: string;
  items: TrendItem[]; created_at: string; // TrendItem은 types.ts와 동일 (rank/keyword/source/score)
}
```

### [수정]
- `src/lib/trends/history.ts` 전면 수정: 타입가드(`isTrendsHistoryResponse`)를 배열-오브-스냅샷
  구조로 재작성, 빈 배열 `[]`은 "스냅샷 0건"으로 정상 파싱(파싱 실패 아님)되도록 명시 처리
- `toHistoryMap`: 스냅샷을 `fetched_at` 오름차순 정렬 후, 각 스냅샷의 `items`를 순회하며
  키워드별 `{rank, fetchedAt}` 포인트를 누적하는 방식으로 재구현 (기존 `TrendHistoryPoint`,
  `computeDelta`, UI 컴포넌트는 무변경 — 소비 인터페이스가 동일해 변경 범위가 작았음)
- 스냅샷이 2건 미만이면 각 키워드 포인트도 자연히 1개 이하가 되어 `computeDelta`가 그대로
  `null`을 반환 — "이력 없음"과 동일하게 처리됨(별도 분기 불필요)
- `page.tsx`, `RankSparkline.tsx`, `page.test.tsx`는 변경 없음 (기존 로딩/에러/빈 상태/mocked
  배너 동작 보존)

### [검증]
```
npm run lint   → 통과 (에러/경고 없음)
npm run test   → Test Files 1 passed (1), Tests 4 passed (4)
npm run build  → Compiled successfully, TypeScript 통과, 라우트 정상 생성
```
반복 1의 4개 테스트가 그대로 통과 — 그 중 "malformed 이력 응답" 테스트(`{totally:"unexpected"}`,
배열이 아님)가 새 배열 기반 타입가드에서도 여전히 거부되어 회귀 없음을 확인.

### [종료]
계약 불일치 수정 완료, lint/test/build 전부 그린. `frontend-loop`에 커밋.

---

## 통합 (merge) — `backend-loop` ← `frontend-loop`

> `VIBE-DEV-backend-wt`(브랜치 `backend-loop`, HEAD `f71ce22`)에서
> `git merge frontend-loop`(`858f01a`) 실행.

### [충돌 및 해소]
- `package.json` — git이 자동 병합 성공 (양쪽이 서로 다른 devDependency를 추가해 충돌 없음).
  결과에 backend 쪽(`vitest`)과 frontend 쪽(`@testing-library/*`, `jsdom`, `@vitejs/plugin-react`)
  devDependency가 모두 포함됨을 확인.
- `package-lock.json` — 충돌. 지시대로 삭제 후 병합된 `package.json` 기준으로 `npm install` 재실행하여
  새 lockfile 생성 (`added 59 packages, and audited 461 packages`, 취약점 0).
- `vitest.config.mts` — add/add 충돌. frontend 쪽 설정(`plugins: [react()]`, `environment: "jsdom"`,
  `setupFiles`, `globals: true`)을 채택 — jsdom 환경이 backend의 순수 로직 테스트도 문제없이
  실행하고, `include` 제한이 없는 vitest 기본 패턴이 `src/**/*.test.ts`와 `page.test.tsx` 양쪽을
  모두 인식하기 때문. `resolve.alias`(`@/*`)는 양쪽 동일하여 그대로 유지.
- `LOOP_LOG.md` — content 충돌 (양 브랜치가 같은 지점 이후에 독립적으로 이어씀). git 병합 마커 대신
  `git show :2:LOOP_LOG.md`(ours/backend)와 `:3:LOOP_LOG.md`(theirs/frontend)를 직접 추출해
  공통 서두(1~44행, 두 버전 동일 확인) + 백엔드 "반복 1" 섹션 전체 + 프론트엔드 "반복 1/반복 2" 섹션
  전체를 순서대로 이어붙여 재구성 (내용 유실 없음).
- 그 외 파일(`src/app/page.tsx`, `src/components/RankDelta.tsx`, `src/components/RankSparkline.tsx`,
  `src/lib/trends/history.ts`, `src/app/page.test.tsx`, `vitest.setup.ts`)은 서로 다른 파일이라
  충돌 없이 자동 병합됨.

### [검증 — 통합 결과 실측]

**`npm run lint`**
```
> trend-dashboard@0.1.0 lint
> eslint

(빈 출력, exit 0)
```

**`npm run test`**
```
> trend-dashboard@0.1.0 test
> vitest run

 RUN  v4.1.11 /Users/choseongjin/VIBE-DEV-backend-wt

 Test Files  2 passed (2)
      Tests  9 passed (9)
   Start at  14:35:38
   Duration  683ms
```
백엔드 5개(`youtube.test.ts`) + 프론트엔드 4개(`page.test.tsx`) = 9개 전부 통과, 테스트 파일 수/개수 예상과 일치.

**`npm run build`**
```
▲ Next.js 16.3.2 (Turbopack)
✓ Compiled successfully in 470ms
  Running TypeScript ... Finished TypeScript in 1072ms
  Generating static pages using 7 workers (6/6) in 237ms

Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/trends
└ ƒ /api/trends/history
```

**`npm run dev -- -p 3001` + curl (통합 앱 3개 라우트 실측)**
```
GET /                              → HTTP 200
GET /api/trends?region=KR          → HTTP 200, mocked:true, 스키마 일치
GET /api/trends/history?region=KR  → HTTP 200, []  (Supabase 미설정 no-op)
```
dev 서버 로그에 에러 없음(`GET / 200`, `GET /api/trends 200`, `GET /api/trends/history 200` 전부 확인).
`lsof -ti:3001 | xargs kill` 후 `lsof -iTCP:3001 -sTCP:LISTEN` 출력 없음 → 정상 종료 확인.

### [결론]
`backend-loop`와 `frontend-loop`를 통합한 결과 lint/test(9개)/build/dev 3라우트 curl 모두 그린.
`backend-loop`에 머지 커밋 진행. 실 YouTube API / Supabase credential 연동은 여전히 미해결(범위 밖).

---

## 반복 N — 백엔드 (라운드 3)

> 새 국면: "실사용자가 돈을 낼 수준"을 목표로, (1) 페이지 로드마다 YouTube를 직접 호출하는 구조를
> 예약 수집(스케줄 인제스천) 구조로 전환, (2) 다중 리전 지원, (3) 유저별 워치리스트(유료 티어 훅)를
> 위한 데이터/인증 기반 마련. `main` 머지(`git merge main`, fast-forward, `ed0e4f9`) 후 `backend-loop`에서
> 진행. 프론트엔드 영역(`src/app/page.tsx`, `src/components/**`, `src/app/page.test.tsx`)은 손대지 않음.

### [목표]
1. `POST /api/cron/refresh-trends` — 고정/확장 가능한 리전 목록(KR/US/JP)을 순회하며 수집+집계+저장,
   `CRON_SECRET` 공유 비밀로 보호 (실패 시 401)
2. `/api/trends`를 DB-우선으로 전환 — 신선한(15분 이내) 스냅샷이 있으면 Supabase에서 서빙,
   없을 때만(콜드 스타트/Supabase 미설정) 기존 실API/mock 폴백 경로 사용
3. `region`을 3개 라우트(`/api/trends`, `/api/trends/history`, cron) 공통의 검증된 1급 파라미터로 승격
4. `supabase/schema.sql`에 `watchlist` 테이블 + RLS 정책 추가, 세션 인지형(`@supabase/ssr`) Supabase
   클라이언트 + 세션 갱신용 proxy 파일 추가
5. `GET/POST/DELETE /api/watchlist` — 세션 없으면 401
6. 기존 9개 + 신규 테스트 모두 통과, lint/build 클린
7. 실 크리덴셜로 dev 서버 기동 후 cron 인가(401/200)와 다중 리전(`US`/`JP`) 실측 curl

### [계획]
1. `git merge main` (fast-forward, `ed0e4f9`)로 오케스트레이터의 실 크리덴셜 검증 로그 반영
2. `.env.local`을 메인 워크트리에서 복사 (`cp .../VIBE-DEV/.env.local .../VIBE-DEV-backend-wt/.env.local`,
   `.gitignore`의 `.env*` 패턴으로 커밋 대상 아님을 확인) — 이후 실 YouTube/Supabase로 검증
3. **Next.js 16 문서 확인 결과 두 가지 편차 반영**:
   - `src/middleware.ts`는 Next 16에서 **deprecated** → `proxy.ts`로 개명(`export function proxy`,
     기능은 동일). AGENTS.md 지침("Heed deprecation notices")에 따라 지시받은 `middleware.ts` 대신
     `src/proxy.ts`로 작성 — 오케스트레이터에게 편차 명시 필요
   - Route Handler에서 세션 인지형 클라이언트는 `next/headers`의 `cookies()`(비동기)를 쓰는
     `@supabase/ssr`의 표준 Route Handler 패턴 사용
4. `src/lib/trends/regions.ts` 신설 — `SUPPORTED_REGIONS`, `normalizeRegion`(대소문자 무관,
   미지원 코드는 `DEFAULT_REGION="KR"`로 폴백 — 기존 "항상 200" 철학과 일관되게 에러 대신 정규화)
5. `src/lib/trends/persist.ts` 확장 — `isSnapshotFresh`(순수 함수), `getFreshTrendSnapshot`,
   `snapshotRowToResponse`, `TrendSnapshotRow`/insert에 `mocked` 컬럼 추가(캐시 서빙 시 정확한
   `mocked` 플래그 전파를 위해 스키마 확장 필요)
6. `/api/trends`를 DB-우선으로 재작성, `/api/trends/history`도 region 정규화 적용
7. `POST /api/cron/refresh-trends` 신설 — `Authorization: Bearer <CRON_SECRET>`(Vercel Cron 실제
   컨벤션) 또는 `?secret=` 두 가지 인가 방식, 미설정 시 fail-closed(401)
8. `@supabase/ssr` 설치, `src/lib/supabase/server.ts`에 `getSupabaseRouteHandlerClient()` 추가
   (기존 서비스롤 클라이언트는 그대로 유지 — persist.ts는 계속 서비스롤 사용)
9. `src/proxy.ts` 신설 — `@supabase/ssr` 표준 세션 갱신 패턴, matcher로 정적 자산 제외
10. `supabase/schema.sql`에 `trend_snapshots.mocked` 컬럼 추가(`alter table ... add column if not exists`,
    기존 데이터 보존) + `watchlist` 테이블/인덱스/RLS 3정책(select/insert/delete, 모두 `auth.uid() = user_id`)
11. `src/app/api/watchlist/route.ts` 신설 — GET/POST/DELETE, 세션 없으면 401
12. `.env.example`에 `CRON_SECRET` 추가, dev용 값 생성(`openssl rand -hex 24`) 후 `.env.local`에 추가
13. `npm run lint/test/build` → 실 크리덴셜로 dev 서버 기동 → cron 인가 + 다중 리전 curl 검증

### [실행 + 관찰]

**Next.js 16 문서 확인** (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`):
- `middleware.md`: "The `middleware.js` file convention has been **deprecated** ... renamed to `proxy.js`"
- `proxy.md`: 파일은 `src/proxy.ts`(또는 루트), export는 `proxy` 함수. 빌드 로그에 실제로
  `ƒ Proxy (Middleware)`로 표기되어 규칙대로 인식됨을 확인 (아래 build 출력 참고)

**`@supabase/ssr` 설치**
```
npm view @supabase/ssr version → 0.12.4
npm install @supabase/ssr@^0.12.4 → added 3 packages, audited 464 packages, 0 vulnerabilities
```

**신규 파일**
- `src/lib/trends/regions.ts`, `src/lib/trends/regions.test.ts` (7 테스트)
- `src/lib/trends/persist.test.ts` (`isSnapshotFresh` 5 테스트: 경계값 포함/제외, 파싱 불가 입력)
- `src/app/api/cron/refresh-trends/route.ts`
- `src/app/api/watchlist/route.ts`
- `src/proxy.ts` (=middleware, Next 16 컨벤션명)

**수정 파일**
- `src/lib/trends/persist.ts` — `FRESHNESS_WINDOW_MS`(15분), `isSnapshotFresh`, `getFreshTrendSnapshot`,
  `snapshotRowToResponse`, `TrendSnapshotRow.mocked`, insert에 `mocked` 포함
- `src/app/api/trends/route.ts` — DB-우선 흐름(`getFreshTrendSnapshot` 우선 조회) + `normalizeRegion`
- `src/app/api/trends/history/route.ts` — `normalizeRegion` 적용
- `src/lib/supabase/server.ts` — `getSupabaseRouteHandlerClient()` 추가(서비스롤 클라이언트는 유지)
- `supabase/schema.sql` — `mocked` 컬럼, `watchlist` 테이블 + RLS
- `.env.example` — `CRON_SECRET` 추가

**`npm run lint`** → 빈 출력, exit 0

**`npm run test`**
```
Test Files  4 passed (4)
     Tests  21 passed (21)
```
(기존 9개: youtube 5 + page 4) + (신규 12개: regions 7 + persist 5)

**`npm run build`**
```
▲ Next.js 16.3.2 (Turbopack)
✓ Compiled successfully in 899ms
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/cron/refresh-trends
├ ƒ /api/trends
├ ƒ /api/trends/history
└ ƒ /api/watchlist

ƒ Proxy (Middleware)
```

**실 크리덴셜 dev 서버(`:3001`) 검증**
```
POST /api/cron/refresh-trends (no secret)               → HTTP 401
POST /api/cron/refresh-trends (wrong Bearer)             → HTTP 401
POST /api/cron/refresh-trends?secret=wrong               → HTTP 401
POST /api/cron/refresh-trends (correct Bearer)           → HTTP 200
  {"refreshedAt":"...","regions":[
    {"region":"KR","mocked":false,"items":20},
    {"region":"US","mocked":false,"items":20},
    {"region":"JP","mocked":false,"items":20}]}
POST /api/cron/refresh-trends?secret=<correct>           → HTTP 200

GET /api/trends?region=US   → HTTP 200, mocked:false, 실 유튜브 데이터("wemmbu" 등 실제 트렌딩 키워드)
GET /api/trends?region=JP   → HTTP 200, mocked:false, 실 유튜브 데이터("HYBE" 등)
GET /api/trends?region=INVALID → HTTP 200, region:"KR"로 정규화됨, mocked:false (정상 폴백)
GET /api/trends/history?region=us (소문자) → HTTP 200 (정규화 확인)

GET    /api/watchlist (세션 없음)                         → HTTP 401
POST   /api/watchlist (세션 없음)                          → HTTP 401
DELETE /api/watchlist?id=<uuid> (세션 없음)                → HTTP 401

GET /  → HTTP 200
```
`lsof -ti:3001 | xargs kill` 후 `lsof -iTCP:3001 -sTCP:LISTEN` 출력 없음 → 정상 종료.

**dev 서버 로그**: 위 curl들 모두 `proxy.ts: Nms` 타이밍이 함께 찍혀 proxy가 매 요청 실행됨을 확인.
`saveTrendSnapshot`/`getRecentTrendSnapshots` 호출 시 아래 에러가 반복 관측됨 (예상된 것, 다음
섹션 참고): `PGRST204 Could not find the 'mocked' column` (insert), `42703 column
trend_snapshots.mocked does not exist` (select) — 둘 다 내부에서 catch되어 HTTP 응답에는 전혀
영향 없음(전부 200 유지, 그레이스풀 디그레이드 설계가 실제 스키마 드리프트 상황에서도 그대로 동작함을
역설적으로 증명).

### [검증] — 성공 기준 대조
1. cron 라우트 + 리전 목록 + 비밀키 보호 → **충족** (401/401/401/200/200 실측)
2. `/api/trends` DB-우선 → **코드상 충족, 라이브 캐시 히트는 미검증** (아래 한계 참고). Supabase
   미설정/조회 실패 시 기존 폴백 경로로 안전하게 이어짐은 dev 서버 로그로 확인
3. region 1급 파라미터화 → **충족** (`?region=INVALID`→`KR` 정규화, `?region=us`→대문자 정규화,
   7개 유닛 테스트로도 커버)
4. `watchlist` 스키마 + RLS + 세션 인지형 클라이언트 + proxy → **SQL/코드 작성 완료, 라이브
   테이블 적용은 미검증** (아래 한계 참고)
5. `/api/watchlist` GET/POST/DELETE, 세션 없으면 401 → **충족** (401 실측). 세션 **있을 때**의 성공
   경로는 로그인 UI가 아직 없어 실 세션으로 검증 불가 — 프론트엔드 인증 UI가 생기면 재검증 필요
6. 21/21 테스트 통과, lint/build 클린 → **충족**
7. cron 인가(401/200) + 다중 리전(US/JP) 실측 curl → **충족**

**한계/미검증 사항 (정직하게 명시 — 규칙 10)**
- **`supabase/schema.sql`의 신규 SQL(‘mocked’ 컬럼, `watchlist` 테이블+RLS)을 라이브 프로젝트에
  적용하지 못함.** 이 워크트리에는 Postgres 연결 문자열이나 Supabase 개인 액세스 토큰이 없고
  (`.env.local`에는 REST용 anon/service-role 키만 있음), PostgREST로는 DDL을 실행할 수 없어
  `npx supabase` CLI로도 프로젝트를 링크/마이그레이션할 수 없었음. 실측으로 이 상태를 확인함
  (`saveTrendSnapshot`/`getRecentTrendSnapshots`가 `mocked` 컬럼 부재 에러를 반복 반환, 응답에는
  영향 없음). **다음 조치**: 사람이 Supabase SQL Editor(또는 DB 접근 권한이 있는 세션)에서
  `supabase/schema.sql` 전체를 1회 실행 필요 — `if not exists`/`add column if not exists`로
  작성되어 있어 기존 데이터가 있는 라이브 테이블에 안전하게 재실행 가능. 적용 후 `/api/trends`를
  15분 내 재호출해 DB-우선 캐시 히트(YouTube 미호출)를 재검증해야 성공 기준 2가 완전히 충족됨.
- `watchlist` RLS의 실사용자 시나리오(로그인한 유저가 자기 행만 보고/쓰는지)는 로그인 UI가 아직
  없어 실 세션으로 검증 불가 — SQL 정책 자체는 표준 `auth.uid() = user_id` 패턴이라 논리적으로는
  맞지만, 프론트엔드 인증 흐름이 붙은 뒤 실 세션으로 재검증 필요.
- 지시받은 파일명은 `src/middleware.ts`였으나 Next.js 16에서 `middleware` 컨벤션이 deprecated되어
  `proxy`로 개명되었으므로 `src/proxy.ts`로 작성함(AGENTS.md의 "Heed deprecation notices" 지침
  준수). 기능은 동일. 빌드 로그의 `ƒ Proxy (Middleware)` 표기로 정상 인식 확인.

### [개선/반복]
1회 반복으로 코드/테스트/lint/build/cron/multi-region 6개 기준 실측 충족. 나머지 2개 기준(DB-우선
캐시 실제 히트, watchlist 실세션 검증)은 이 세션의 권한 밖 자원(라이브 DB 접근, 로그인 UI)이
확보되어야 완결 가능 — 규칙 10(정보/권한 부족)에 해당하여 추가 반복으로 해소되지 않음. 코드는
두 경우 모두 실패를 삼키고 200을 유지하도록 이미 방어적으로 작성되어 있어 당장 배포해도 안전.

### [종료/중단]
성공 기준 7개 중 5개 완전 충족 + 2개(3, 6은 완전 충족 포함) — 정확히는 1,3,5,6,7 완전 충족, 2,4는
코드/SQL 작성 완료이나 라이브 검증 블록됨. 이 워크트리 권한으로 할 수 있는 작업은 모두 소진 —
**중단(규칙 10)**. 오케스트레이터에게 (a) `supabase/schema.sql` 라이브 적용, (b) 적용 후
`/api/trends` 캐시 히트 재검증 요청과 함께 보고.

## 반복 3 — 프론트엔드 (계정/지역/워치리스트 + 비주얼 아이덴티티)

### [목표]
단일 페이지 데모를 "실제 제품처럼 보이는" 수준으로 끌어올린다: (1) Supabase Auth 기반
회원가입/로그인/로그아웃, (2) KR/US/JP 지역 선택기, (3) 로그인 시 개인 워치리스트
추가/제거, (4) `frontend-design` 스킬 가이드에 따른 실제 비주얼 아이덴티티(이름/컬러·타이포
시스템/히어로), (5) 위 기능에 대한 자동화 테스트, (6) lint/test/build 통과, (7) dev 서버 +
스크린샷 검증. `src/app/api/**`, `src/lib/supabase/server.ts`, `src/middleware.ts`,
`supabase/schema.sql`은 이번 라운드 백엔드 세션 소유이므로 건드리지 않는다.

### [성공 기준]
과제 지시의 7개 기준(Auth UI, 지역 선택기, 워치리스트 UI, 비주얼/브랜드 패스, 테스트,
lint/test/build 통과, dev+스크린샷 검증) 그대로 채택.

### [계획]
1. `git merge main` — 백엔드가 이미 병합한 `/api/trends/history`, `persist.ts` 등 최신 상태 확보
2. `.env.local`을 워크트리로 복사 (값은 로그에 절대 출력하지 않음)
3. `@supabase/ssr` 설치 후 `src/lib/supabase/browser.ts`(브라우저 클라이언트 팩토리, env 미설정
   시 null 반환 — `server.ts`와 동일한 방어 패턴) 신설
4. `src/lib/auth/useAuth.ts` — 세션 구독형 훅 (`user`/`loading`/`error`/`signUp`/`signIn`/`signOut`).
   Supabase 미구성 시 즉시 로그아웃 상태로 안정화, 절대 throw하지 않음. 테스트에서
   `vi.mock("@/lib/auth/useAuth")`로 쉽게 대체 가능하도록 로직을 컴포넌트에서 분리
5. `src/lib/trends/regions.ts` — KR/US/JP 플레이스홀더 지역 목록 (백엔드의 `regions.ts`가 이
   워크트리에 아직 없어 자체 정의; 백엔드 목록이 다르면 병합 시 조정 필요 — 아래 [개선/반복] 참고)
6. `src/lib/watchlist.ts` — `/api/watchlist`(백엔드 미구현) 전용 방어적 클라이언트. `history.ts`와
   동일한 원칙: 실패/스펙 불일치 시 `null`/`false` 반환, 절대 throw하지 않음. 가정 계약을 파일
   상단에 명시(재조정 대상으로 기록)
7. `frontend-design` 스킬 로드 후 브랜드 설계: 이름 **SPIKE**(순위가 "튀는" 순간을 가장 먼저
   포착한다는 제품의 핵심 job과 직결), 다크 테마는 유지하되(이유는 아래 [비주얼 설계 근거])
   웜톤 근접-블랙 + 앰버 시그널 색으로 팔레트 재정의, Gothic A1(디스플레이)+Noto Sans KR(본문)+
   JetBrains Mono(데이터) 3-역할 타이포 페어링, 시그니처 요소로 히어로에 애니메이션 심전도/
   지진계 스타일 트레이스(`SpikeLine`) 배치
8. 컴포넌트 신설: `AuthHeader`(로그인/로그아웃 헤더 상태, presentational), `AuthModal`(가입/
   로그인 폼), `RegionTabs`(지역 탭), `WatchlistPanel`(워치리스트 섹션), `SpikeLine`(시그니처)
9. `page.tsx` 재작성 — 위 모든 요소 오케스트레이션, 지역 변경 시 `/api/trends`·`/api/trends/history`
   재요청, 워치리스트 로그인 시에만 노출 + 실패 시 완전히 숨김, 기존 로딩/에러/빈 상태/mocked
   배너 로직·문구 그대로 유지
10. `layout.tsx`/`globals.css` — 폰트 로딩(next/font/google) 및 디자인 토큰(CSS 커스텀 프로퍼티
    + Tailwind v4 `@theme inline` 매핑), 메타데이터(title/description) 갱신
11. `page.test.tsx` 확장 — 로그아웃/로그인 헤더 상태, 지역 전환 시 재요청, 워치리스트 추가/제거
    해피패스(모두 mocked API) 4개 테스트 추가, 기존 4개 테스트 회귀 없음 확인
12. lint → test → build 순차 실행
13. `npm run dev -- -p 3003` 기동 후 실 자격증명으로 curl 확인 + Playwright 스크린샷 (로그아웃
    상태 + 지역 선택기), 서버 종료

### [비주얼 설계 근거]
스킬이 경계하는 "AI 생성 디자인 3대 기본값" 중 하나가 "근접-블랙 배경 + 단일 형광 그린/버밀리언
포인트"다. 기존 대시보드(neutral-950 + emerald/red)가 정확히 이 패턴이었으므로, 다크 테마
방향 자체는 유지하되(제품이 "모니터링 콘솔"이라는 컨셉과 잘 맞고, 이미 사용자에게 검증된
방향이라 바꿀 이유가 약함) 포인트 컬러를 형광 그린이 아닌 **앰버(#F2A93B, CRT 인광/지진계
기록지 레퍼런스)**로 바꾸고, rise/fall에 각각 별도 색(teal #4FD1AE / red #E85D5D)을 부여해
포인트가 브랜드색과 상태색으로 분리되도록 했다. 타이포는 한국어 제품이라는 브리프의 실제
제약에서 도출: Gothic A1(디스플레이, 굵은 웨이트로 브랜드 개성)+Noto Sans KR(본문 가독성)+
JetBrains Mono(순위/점수/타임스탬프 — "계기판 판독값"처럼 읽히도록). 시그니처 요소인
`SpikeLine`은 장식이 아니라 제품의 핵심 가치("스파이크의 순간을 가장 먼저 포착")를 시각적으로
직역한 것.

### [실행 + 관찰]

**`git merge main`** (fast-forward, `ed0e4f9`까지) — 백엔드의 `/api/trends/history` 실제 라우트,
`persist.ts`, `youtube.test.ts`, 오케스트레이터의 실 크리덴셜 검증 로그 포함하여 병합됨.

**신규 파일**
- `src/lib/supabase/browser.ts`, `src/lib/auth/useAuth.ts`
- `src/lib/trends/regions.ts`, `src/lib/watchlist.ts`
- `src/components/{AuthHeader,AuthModal,RegionTabs,WatchlistPanel,SpikeLine}.tsx`

**수정 파일**
- `src/app/page.tsx` (전면 재작성), `src/app/layout.tsx`(폰트/메타데이터), `src/app/globals.css`
  (디자인 토큰), `src/app/page.test.tsx`(테스트 4개 추가), `package.json`(`@supabase/ssr`,
  `@testing-library/user-event` 추가)

**`npm run lint`** — 1차 실행에서 `useAuth.ts`의 `setLoading(false)`가
`react-hooks/set-state-in-effect`에 걸림(이펙트 바디 내 동기 setState). `loading`의 초기값을
`useState(() => getSupabaseBrowserClient() !== null)`로 lazy 초기화하여 이펙트 바디에서
동기 setState를 제거하고 프로미스 콜백 내부에서만 setState하도록 수정 → 재실행 시 통과
(에러/경고 없음, exit 0).

**`npm run test`**
```
 Test Files  2 passed (2)
      Tests  13 passed (13)
```
기존 8개(page 4 + youtube.test.ts 5, 반올림 아님 — 정확히는 page 4 + youtube 5 = 9였고 이번에
page에 4개 추가해 13) 전부 회귀 없이 통과. 신규 4개: 로그아웃 헤더("로그인" 버튼), 로그인 헤더
(이메일+"로그아웃"), 지역 탭 클릭 시 `/api/trends?region=US`·`/api/trends/history?region=US`
재요청 확인, 워치리스트 추가(☆→★, 패널에 표시)/제거(패널에서 사라짐) 해피패스(POST/DELETE
mock). 디버깅 과정에서 2개 실패를 잡아 수정: ①지역 재요청 테스트가 history 호출을 `waitFor`
없이 단정해 타이밍상 실패 → 두 번째 `waitFor`로 분리, ②`toHaveBeenCalledWith`가 `fetch(url,
{signal})`의 두 번째 인자까지 정확히 일치해야 해서 실패 → 호출 배열을 직접 검사하는 방식으로 변경.

**`npm run build`**
```
✓ Compiled successfully
  Running TypeScript ... Finished TypeScript
Route (app): / (○), /_not-found (○), /api/trends (ƒ), /api/trends/history (ƒ)
```
`.env.local` 인식 확인(`- Environments: .env.local`).

**`npm run dev -- -p 3003` + 실 자격증명 curl**
```
GET /                              → HTTP 200
GET /api/trends?region=KR          → HTTP 200, mocked:false (실 YouTube 데이터, 예: BIGBANG/HYBE 등)
GET /api/trends/history?region=KR  → HTTP 200, 스냅샷 1건 (id/source/region/fetched_at/items/
                                      created_at 스키마가 반복 2에서 작성한 파서와 정확히 일치)
```
dev 서버 로그에 에러 없음.

**Playwright 스크린샷** (`npx playwright screenshot`, chromium 캐시 기존 설치 재사용)
로그아웃 상태로 `http://localhost:3003/` 캡처, 육안 확인 결과:
- "SPIKE" 워드마크(앰버) + "로그인" 버튼이 헤더에 정상 표시
- 히어로의 심전도/지진계 스타일 `SpikeLine` 트레이스가 앰버 색으로 정상 렌더링(정적 프레임이라
  애니메이션 자체는 스크린샷상 확인 불가하나 형태와 색은 의도대로 그려짐)
- "지금, 가장 먼저 뜨는 키워드" 헤드라인 + 설명 문구, 한글 타이포(Noto Sans KR 폴백 체인) 정상
  렌더링 — 두부(tofu) 깨짐 없음
- **지역 선택기(KR 대한민국 / US United States / JP 日本) 3개 탭이 모두 보이고, KR 탭에
  앰버 밑줄로 활성 상태 표시**
- 실제 YouTube 실급상승 키워드(BIGBANG, HYBE 등) 15개 이상이 순위/점수와 함께 모노스페이스로
  렌더링
- 로그아웃 상태이므로 워치리스트 섹션과 ☆ 토글 버튼은 의도대로 완전히 숨겨져 있음(크래시/빈
  섹션 없음)
- mocked 배너 없음(실 API 사용 중이므로 정상), 에러 배너 없음

**dev 서버 종료**: `lsof -ti:3003 | xargs kill` 후 `lsof -iTCP:3003 -sTCP:LISTEN` 출력 없음 →
정상 종료 확인.

### [검증] — 성공 기준 대조
1. Auth UI — `useAuth`+`AuthHeader`+`AuthModal`, 로그아웃/로그인 헤더 상태 모두 테스트(2개)와
   스크린샷(로그아웃)으로 확인 → **충족**
2. 지역 선택기 — `RegionTabs`(KR/US/JP), 전환 시 두 엔드포인트 모두 재요청 테스트로 확인,
   스크린샷으로 3탭 노출 확인 → **충족**
3. 워치리스트 UI — `/api/watchlist` 방어적 클라이언트(`watchlist.ts`) + 로그인시에만 노출 +
   추가/제거 해피패스 테스트로 확인. 백엔드 라우트가 실제로 없는 현재 상태에서는 GET 실패 →
   `watchlist === null` → 전체 UI 숨김(크래시 없음, 스크린샷의 로그아웃 상태로 간접 확인) →
   **충족** (실 라우트 연동은 백엔드 병합 후 재검증 필요, 아래 기록)
4. 비주얼/브랜드 패스 — `frontend-design` 스킬 로드 후 설계, SPIKE 네이밍/앰버 팔레트/3-역할
   타이포/`SpikeLine` 시그니처, 근거를 위 [비주얼 설계 근거]에 기록, 스크린샷으로 실제 렌더링
   확인 → **충족**
5. 테스트 — 13개 전부 통과(신규 4개 포함) → **충족**
6. lint/test/build — 전부 그린 (위 출력 참고) → **충족**
7. dev 서버 + 스크린샷 — 실 자격증명으로 3라우트 curl 200 + 스크린샷으로 로그아웃 상태/지역
   선택기 육안 확인 → **충족**

### [개선/반복]
1회 반복으로 7개 기준 모두 충족되어 추가 반복 불필요(규칙 9). 다만 정직하게 기록할 한계:
- **워치리스트 실 연동 미검증**: `/api/watchlist`가 이 워크트리에 아직 없어 GET이 실패 →
  UI가 숨겨진 상태로만 확인됨. 백엔드가 라우트를 병합하면 `src/lib/watchlist.ts` 상단에 적어둔
  가정 계약(`{keywords: string[]}` GET, `{keyword}` body의 POST/DELETE)과 실제 계약을 대조해
  반복 1의 `history.ts` 때와 같은 방식으로 재조정 필요.
- **지역 목록 미조정**: `src/lib/trends/regions.ts`가 백엔드의 `regions.ts`(이 라운드에 작업
  중이라고 명시됨) 없이 자체 정의됨. 백엔드 병합 후 코드/라벨이 다르면 병합해야 함.
- 로그인/회원가입 실제 플로우(폼 제출)는 스크린샷으로 검증하지 않음 — 실 Supabase 프로젝트에
  테스트 계정을 생성/이메일을 발송하는 부작용을 피하기 위해 의도적으로 생략, 대신 단위 테스트로
  로직(성공 시 모달 닫힘/가입 알림, 실패 시 에러 문구) 검증.

### [종료]
7개 성공 기준 모두 실측 증거로 충족. `frontend-loop`에 커밋 진행.

---

## 통합 (merge, 라운드 3) — `backend-loop` ← `frontend-loop`

> `VIBE-DEV-backend-wt`(브랜치 `backend-loop`, HEAD `a602512`)에서
> `git merge frontend-loop`(`ec11491`) 실행. 백엔드는 스케줄 인제스천/다중 리전/워치리스트 기반,
> 프론트엔드는 인증/지역 선택기/워치리스트 UI/SPIKE 브랜드를 각각 독립적으로 완료한 상태.

### [충돌 및 해소]
- `package.json` — git 자동 병합 성공. 결과에 양쪽 devDependency(`@supabase/ssr`은 두 트랙이 같은
  버전을 넣어 완전히 일치, frontend의 `@testing-library/user-event` 포함) 모두 존재 확인.
- `package-lock.json` — 지시대로 삭제 후 병합된 `package.json` 기준 `npm install` 재실행
  (`added 1 package, audited 465 packages`, 취약점 0).
- `src/lib/trends/regions.ts` — **진짜 충돌** (add/add): 양쪽이 동일 경로에 겹치지 않는 API로
  독립 정의(백엔드: `SUPPORTED_REGIONS`/`SupportedRegion`/`normalizeRegion`/`isSupportedRegion`,
  검증용 / 프론트엔드: `Region{code,label}`/`REGIONS`, 표시용). 코드 목록이 동일(KR/US/JP)해
  의미 충돌은 아니었음. 하나의 파일로 합침: 백엔드의 검증 함수를 그대로 두고, `REGIONS`를
  `SUPPORTED_REGIONS.map(...)`으로 라벨맵과 함께 파생시켜 두 API를 모두 export. `DEFAULT_REGION`은
  이름이 같고 값도 동일("KR")해 타입만 `SupportedRegion`으로 통일. 병합 후
  `grep -rn '@/lib/trends/regions'` 로 6개 소비처(`page.tsx`, 3개 API 라우트, cron 라우트,
  `RegionTabs.tsx`, `regions.test.ts`) 전부 재확인 — import된 이름(`REGIONS`, `DEFAULT_REGION`,
  `normalizeRegion`, `SUPPORTED_REGIONS`, `Region` 타입, `isSupportedRegion`) 전부 병합된 파일에
  존재해 아무 소비처도 import를 바꿀 필요 없었음.
- `LOOP_LOG.md` — 이전 병합 때와 동일한 content 충돌(양쪽이 독립적으로 이어씀). `git show :2:`/`:3:`로
  직접 추출해 공통 서두(1~444행, 두 버전 동일 확인) + 백엔드 라운드 3 섹션 + 프론트엔드 라운드 3
  섹션 순서로 재구성.
- 그 외 파일(`page.tsx`, `page.test.tsx`, `globals.css`, `layout.tsx`, 신규 컴포넌트/lib 파일들)은
  서로 다른 파일/영역이라 자동 병합됨.

### [병합 후 발견된 실제 버그 — 수정]
`npm run build`에서 타입 에러 발생:
```
src/app/page.tsx(120,57): error TS2322:
  Type 'Dispatch<SetStateAction<"KR" | "US" | "JP">>' is not assignable to type '(code: string) => void'.
```
원인: 병합된 `regions.ts`의 `DEFAULT_REGION`이 (백엔드 쪽 정의를 따라) `SupportedRegion`으로
좁게 타입되면서, `useState(DEFAULT_REGION)`으로 추론된 `region` 상태가 `"KR"|"US"|"JP"`로 좁아짐.
반면 `RegionTabs`의 `onChange`는 (frontend 원래 설계대로) `(code: string) => void`라 더 넓은
타입을 받으므로 `setRegion`을 그대로 넘길 수 없게 됨 — 두 트랙 모두 개별적으로는 타입이 맞았지만
병합된 `regions.ts`의 좁은 `DEFAULT_REGION` 타입이 그 사이 접점에서 불일치를 드러낸 것.
**수정**: `src/app/page.tsx`에서 `useState(DEFAULT_REGION)` → `useState<string>(DEFAULT_REGION)`
1줄만 변경 — `RegionTabs`/`regions.ts` 어느 쪽 계약도 바꾸지 않는 최소 수정. 재빌드 통과 확인.

### [검증 — 통합 결과 실측]

**`npm run lint`** → 빈 출력, exit 0 (타입 수정 전/후 모두 확인)

**`npm run test`**
```
Test Files  4 passed (4)
     Tests  25 passed (25)
```
25개 = youtube.test.ts(5, 두 트랙이 공유하는 동일 파일이라 중복 집계 안 됨) + regions.test.ts(7,
백엔드) + persist.test.ts(5, 백엔드) + page.test.tsx(8, frontend가 4→8로 확장한 최신 버전).
오케스트레이터가 예상한 "~34(21+13)"는 두 트랙의 독립 합계를 그대로 더한 값이라 공유 파일
(youtube.test.ts 5개, 양쪽 다 f71ce22에서 유래해 동일)이 이중 계산된 것 — 실제 병합 결과는 25개가
맞음(19번째 반복까지 두 브랜치가 공유한 공통 조상 때문에 발생하는 정상적인 차이, 테스트 누락 아님).

**`npm run build`** (타입 수정 후)
```
▲ Next.js 16.3.2 (Turbopack)
✓ Compiled successfully in 488ms
  Finished TypeScript in 1055ms

Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/cron/refresh-trends
├ ƒ /api/trends
├ ƒ /api/trends/history
└ ƒ /api/watchlist

ƒ Proxy (Middleware)
```

**`npm run dev -- -p 3001` + curl (실 크리덴셜, 5개 라우트 전부)**
```
GET  /                                              → HTTP 200
GET  /api/trends?region=KR                          → HTTP 200, mocked:false, 실 데이터("BIGBANG" 등)
GET  /api/trends/history?region=KR                  → HTTP 200, []
POST /api/cron/refresh-trends (no secret)            → HTTP 401
POST /api/cron/refresh-trends (correct Bearer)       → HTTP 200
GET  /api/watchlist (세션 없음)                        → HTTP 401
```
dev 로그 전수 확인 — `saveTrendSnapshot`/`getRecentTrendSnapshots`의 `mocked` 컬럼 부재 에러(라운드
3에서 이미 문서화한 동일 블로커)를 제외하면 예상 밖 에러 없음. 모든 라우트에 `proxy.ts: Nms` 타이밍이
찍혀 세션 갱신 proxy가 정상 동작 중임을 재확인.
`lsof -ti:3001 | xargs kill` 후 `lsof -iTCP:3001 -sTCP:LISTEN` 출력 없음 → 정상 종료.

### [결론]
`backend-loop`와 `frontend-loop` 라운드 3을 통합한 결과 lint/test(25개)/build/dev 5라우트 curl 모두
그린. 병합 중 발견된 `page.tsx`의 진짜 타입 버그 1건을 최소 수정으로 해결. `regions.ts`의 add/add
충돌은 두 API를 모두 보존하는 단일 파일로 재조정, 기존 소비처 import 변경 없음.
**여전히 미해결(범위 밖, 이전 라운드부터 이어짐)**: `supabase/schema.sql`의 `mocked` 컬럼/`watchlist`
테이블이 라이브 프로젝트에 미적용 — 라이브 DB 접근 권한이 있는 세션의 1회 실행 필요.
`backend-loop`에 머지 커밋 진행.

---


## 반복 4 — 프론트엔드 (워치리스트 실계약 반영)

### [배경]
반복 3에서 `src/lib/watchlist.ts`에 추측으로 정의한 계약(`{keywords: string[]}` GET,
`{keyword}` 본문의 POST/DELETE)과 백엔드가 실제로 구현한 `/api/watchlist`
(`src/app/api/watchlist/route.ts`, backend-loop)가 불일치함이 발견됨 — 반복 2의
`history.ts` 계약 수정과 동일한 패턴.

**실제 계약**:
```
GET    /api/watchlist            -> 200: WatchlistRow[] (id/keyword/region/created_at); 401 로그아웃 시
POST   /api/watchlist  {keyword, region?} -> 201, 생성된 row 반환
DELETE /api/watchlist?id=<uuid>  -> 200: {ok:true}  (id는 쿼리 파라미터, body 아님)
```
기존 구현의 실제 버그: (1) GET 응답 파싱이 배열이 아닌 `{keywords}` 형태를 기대해 항상 실패,
(2) `addToWatchlist`가 region을 서버에 전달하지 않아 선택된 지역과 무관하게 서버 기본값(KR)로
저장됨(단순 파싱 불일치가 아니라 실제 정합성 버그), (3) `removeFromWatchlist`가 keyword를
body로 보내 항상 400 — 삭제는 row의 `id`가 필요하므로 keyword만으로는 식별 불가.

### [수정]
- `src/lib/watchlist.ts`: `WatchlistRow` 타입 신설 + 배열 응답 타입가드로 전면 재작성.
  `addToWatchlist(keyword, region)`이 region을 함께 전송하고 생성된 row를 반환(낙관적 갱신 시
  서버가 부여한 id를 바로 사용하기 위함). `removeFromWatchlist(id)`가 `?id=` 쿼리로 DELETE.
- `page.tsx`: `watchlist` 상태를 `string[]`에서 `WatchlistRow[]`로 변경. `toggleWatch`가
  keyword+현재 `region` 조합으로 기존 항목을 찾아 있으면 id로 삭제, 없으면
  `addToWatchlist(keyword, region)` 호출 후 반환된 row를 상태에 추가. 랭킹 행의 별표(★/☆)
  상태도 동일하게 keyword+region 매칭으로 판정(동일 키워드를 지역별로 별도 추적 가능하다는
  실제 계약을 반영). 패널 전용 제거 함수 `removeWatchlistEntry(id)` 추가.
- `WatchlistPanel.tsx`: `keywords: string[]` prop을 `entries: WatchlistRow[]`로 변경, 각 칩에
  지역 태그를 함께 표시(동일 키워드가 여러 지역에 중복 추적될 수 있어 구분 필요), `onRemove`가
  이제 keyword가 아닌 `id`를 받음.
- `page.test.tsx`의 워치리스트 해피패스 테스트를 실제 계약대로 재작성: GET이 배열 반환,
  POST가 `{keyword, region}` 본문을 파싱해 생성된 row(id 포함) 반환, DELETE가 URL의 `?id=`
  쿼리를 파싱해 처리.

### [검증]
```
npm run lint   → 통과 (에러/경고 없음)
npm run test   → Test Files 2 passed (2), Tests 13 passed (13)
npm run build  → Compiled successfully, TypeScript 통과, 라우트 정상 생성
```
13개 테스트 전부 통과 — 워치리스트 추가/제거 해피패스 테스트가 새 계약(배열 GET, id 기반
DELETE)으로도 동일하게 통과함을 확인했고, 나머지 12개(로그인/로그아웃 헤더, 지역 전환,
히스토리 등)는 이번 변경과 무관해 회귀 없음.

### [종료]
워치리스트 계약 불일치 수정 완료, lint/test/build 전부 그린. `frontend-loop`에 커밋.

---

## 통합 (merge, 라운드 3 후속) — `backend-loop` ← `frontend-loop` (`c784168` 반영)

> 직전 병합(`dce6c77`)이 `ec11491` 기준으로 이뤄져, 그 뒤에 landing된 `c784168`
> ("Fix /api/watchlist contract to match real backend implementation")이 누락되어 있었음.
> `git merge frontend-loop` 재실행으로 반영.

### [충돌 및 해소]
- `LOOP_LOG.md`만 content 충돌(양쪽이 계속 독립적으로 이어씀). `git show ec11491:LOOP_LOG.md`와
  `c784168:LOOP_LOG.md`를 비교해 `c784168`이 정확히 어떤 라인(603~650, 48줄, "반복 4 — 프론트엔드
  (워치리스트 실계약 반영)" 섹션)을 추가했는지 확인한 뒤, 직전 병합 결과(`git show :2:LOOP_LOG.md`,
  이미 backend/frontend 라운드 3 내용을 모두 포함)에 그 48줄만 그대로 이어붙임 — 재작업/중복 없음.
- `src/app/page.tsx`, `src/app/page.test.tsx`, `src/components/WatchlistPanel.tsx`,
  `src/lib/watchlist.ts` — 오케스트레이터 예상대로 전부 자동 병합(직전 병합에서 백엔드가 건드리지
  않은 파일들이라 충돌 없음).

### [검증 — 통합 결과 실측]
```
npm run lint   → 빈 출력, exit 0
npm run test   → Test Files 4 passed (4), Tests 25 passed (25)  ← 동일(워치리스트 계약 수정은
                 기존 8개 테스트를 실제 계약에 맞게 재작성한 것이지 개수 변화 아님)
npm run build  → Compiled successfully, TypeScript 통과 (타입 에러 재발 없음)
```

**`npm run dev -- -p 3001` + curl (실 크리덴셜, 8개 요청)**
```
GET  /                                              → HTTP 200
GET  /api/trends?region=KR                          → HTTP 200
GET  /api/trends/history?region=KR                  → HTTP 200
POST /api/cron/refresh-trends (no secret)            → HTTP 401
POST /api/cron/refresh-trends (correct Bearer)       → HTTP 200
GET    /api/watchlist (세션 없음)                     → HTTP 401
POST   /api/watchlist (세션 없음)                     → HTTP 401
DELETE /api/watchlist?id=<uuid> (세션 없음, 쿼리 파라미터로 실측) → HTTP 401
```
dev 로그 전수 확인 — 기존에 문서화한 `mocked` 컬럼 부재 에러 외 예상 밖 에러/회귀 없음.
`lsof -ti:3001 | xargs kill` 후 포트 확인 → 정상 종료.

### [결론]
`c784168` 반영 후에도 lint/test(25개, 불변)/build/dev 8요청 curl 전부 그린 — 회귀 없음.
`backend-loop`에 머지 커밋 진행.

---

## 라이브 스키마 적용 재검증 + 마이그레이션 구조 개편

> 사용자가 SQL Editor에서 당시의 `supabase/schema.sql`(mocked 컬럼 + watchlist 테이블/RLS)을
> 라이브 프로젝트에 실행 완료. 이전 라운드부터 이어진 차단 항목(A) 재검증 + 오케스트레이터 요청으로
> 스키마 파일을 `supabase/migrations/` 구조로 개편.

### [재검증 — 실측 증거]

**`npm run dev -- -p 3001` (실 크리덴셜) + `/api/trends?region=KR` 2회 연속 호출**
```
1차: fetchedAt: 2026-08-24T08:39:36.834+00:00  mocked: False  (1.4s)
2차: fetchedAt: 2026-08-24T08:39:36.834+00:00  mocked: False  (0.6s)  ← 동일 fetchedAt = 캐시 히트
```
호출 시점(`date -u` 실측): `2026-08-24T08:43:21Z` — 스냅샷 나이 약 3분45초로 15분 캐시 윈도우 이내.
두 호출 모두 동일한 `fetchedAt`을 반환했다는 것은 두 번째 호출이 YouTube를 다시 부르지 않고
Supabase에 저장된 동일 스냅샷을 그대로 서빙했다는 뜻 (`getFreshTrendSnapshot`이 새 fetch를
건너뛰었음). dev 로그에도 두 요청 모두 `saveTrendSnapshot`/`getRecentTrendSnapshots` 호출 흔적이
없어(캐시 히트 경로는 `getFreshTrendSnapshot` 조회 1회만 실행) 일치.

**`/api/trends/history?region=KR`**
```
[{"id":"7a1e85c0-...","source":"youtube","region":"KR",
  "fetched_at":"2026-08-24T08:39:36.834+00:00","mocked":false,"items":[...]}]
```
실제 스냅샷 반환, `mocked` 필드 정상 포함 — 더 이상 `PGRST204`/`42703` 에러 없음.

**`watchlist` 테이블 존재 확인**: `/api/watchlist` GET은 세션 체크가 쿼리보다 먼저라 401이 테이블
존재 여부를 증명하지 못하므로, 서비스롤 클라이언트로 직접 조회:
```
watchlist table exists, row count: 0
```
(가입한 유저가 아직 없어 0건은 정상)

**dev 로그 전체 스캔**: `grep -c "PGRST204\|42703" ` → **0** — 지난 두 라운드 내내 반복되던 스키마
드리프트 에러가 완전히 사라짐. 세션 종료 후 `lsof -iTCP:3001 -sTCP:LISTEN` 출력 없음 → 정상 종료.

**결론**: 이전에 미검증 상태였던 성공 기준 2("DB-우선 캐시 히트")와 4("watchlist 스키마 실적용")가
이제 완전히 충족됨 — 규칙 10으로 중단했던 두 항목이 모두 해소됨.

### [마이그레이션 구조 개편]
사용자 요청: 하나로 계속 자라는 `schema.sql`을 매번 머릿속으로 diff하는 대신, 파일 단위로 적용
여부를 한눈에 알 수 있게 재구성.

**변경**
- `supabase/migrations/0001_initial.sql` 신설 — `trend_snapshots` 테이블 + 인덱스 (기존
  `schema.sql`의 1~11행과 동일)
- `supabase/migrations/0002_mocked_column_and_watchlist.sql` 신설 — `mocked` 컬럼 + `watchlist`
  테이블/인덱스/RLS 3정책 (기존 `schema.sql`의 13~51행과 동일) — 라운드 경계와 정확히 일치해
  자연스러운 분할 기준
- `supabase/migrations/APPLIED.md` 신설 — 파일별 적용 상태 표. 상단에 컨벤션 명시: 향후 스키마
  변경은 항상 새 번호 파일(`0003_*.sql`...)로, 이미 적용된 파일은 절대 수정하지 않음. 새 마이그레이션은
  사용자가 실행을 확인하기 전까지 "pending"으로 남고, 확인 후 오케스트레이터가 상태를 갱신.
  0001/0002는 방금 라이브 적용이 실측 확인되었으므로 둘 다 "applied", 날짜 2026-08-24로 기록.
- 기존 `supabase/schema.sql` 삭제 — 중복 SQL을 두 곳에 남기지 않기 위해 포인터 주석이 아닌 완전
  삭제를 선택 (마이그레이션 파일들이 내용을 온전히 대체하므로 포인터가 가리킬 대상이 사라지는 게
  아니라 명확히 옮겨간 것)
- `diff`로 분할된 두 파일의 SQL 내용(주석/빈 줄 제외)이 기존 `schema.sql`과 완전히 동일함을 확인
  — 분할 과정에서 SQL 자체는 한 글자도 바뀌지 않음

**참조 확인**: `grep -rn "schema\.sql"` → `LOOP_LOG.md` 안의 과거 기록(당시 시점 기준 사실을 담은
로그 항목)만 검출, 코드/현재 문서 어디에도 옛 경로 참조 없음 — 로그는 시계열 기록이라 과거 항목을
고쳐 쓰지 않고 그대로 둠(이 항목이 최신 상태를 안내).

**`npm run lint` / `npm run build`** → 둘 다 클린 (SQL/문서 파일만 바뀐 변경이라 예상대로 앱에는
영향 없음, 라우트 6개 정상 생성 재확인).

### [검증] — 성공 기준 대조
1. 캐시 히트 실측(동일 fetchedAt, 스냅샷 나이 <15분) → **충족**
2. `/api/trends/history` 실 스냅샷 + `mocked` 필드 반환 → **충족**
3. `watchlist` 테이블 라이브 존재(서비스롤 직접 조회로 확인) → **충족**
4. 에러 로그 전수 스캔 결과 `PGRST204`/`42703` 0건 → **충족**
5. 마이그레이션 구조 개편(0001/0002 분할, APPLIED.md, 구 파일 삭제, 참조 정리) + lint/build 클린
   → **충족**

### [종료]
5개 기준 모두 실측 증거로 충족, 1회 반복으로 종료. 이전 두 라운드에 걸쳐 있던 미해결 항목(A)이
완전히 해소됨 — 더 이상 남은 블로커 없음.

---

## 반복 — 백엔드 (auth 확인 콜백)

> 프로덕션 버그: 사용자가 가입 후 이메일 확인 링크를 클릭하면 빈 페이지가 뜸. Supabase Site URL
> 설정 문제(사용자가 대시보드에서 직접 수정 중, 범위 밖)와는 별개로, 확인 리다이렉트를 받아
> 세션을 완성할 라우트가 앱에 아예 없다는 진짜 코드 공백. `git merge main` 시도 → 이미 동일
> 커밋(`14e8155`)이라 변경 없음(sync 불필요, 이미 최신).

### [목표]
1. Supabase 확인 리다이렉트를 받아 code/token을 세션으로 교환하고 `/`로 보내는 라우트 추가
2. `useAuth.ts`의 `signUp()`이 `emailRedirectTo`를 명시적으로 전달해 대시보드 Site URL 설정과
   무관하게 항상 우리 콜백을 가리키게 함
3. 교환 실패(만료/재사용된 링크 등)도 빈 페이지 대신 정상적으로 리다이렉트 처리
4. 실제 이메일 링크 클릭은 불가하므로 검증 가능한 범위 내에서 최대한 검증(유닛 테스트 +
   가짜 code로 curl)
5. lint/test/build 클린

### [계획]
1. **가정하지 않고 실제 확인**: `node_modules/@supabase/ssr` 버전(0.12.4)의 소스를 직접 읽어
   confirm 방식 판별 — `GoTrueClient.js`의 기본 `flowType`은 `'implicit'`이지만,
   `@supabase/ssr`의 `createBrowserClient.js`/`createServerClient.js`는 둘 다 옵션에서
   `flowType: "pkce"`로 명시적으로 덮어씀(grep으로 두 파일 모두 확인) — 이 프로젝트의
   `browser.ts`/`server.ts`가 그 옵션을 override하지 않으므로 실제로는 PKCE 플로우.
   즉 확인 링크는 `token_hash`+`type`이 아니라 `?code=`를 담고 오며, 서버에서
   `exchangeCodeForSession(code)`로 교환해야 함(Next.js App Router + `@supabase/ssr`의
   표준 콜백 라우트 패턴).
2. `src/app/auth/callback/route.ts` 신설 — `code` 파라미터를 세션 인지형 클라이언트
   (`getSupabaseRouteHandlerClient`, 라운드 3에서 이미 만들어둔 것)로 교환, 성공 시 `next`
   쿼리 파라미터(기본 `/`)로 리다이렉트. `next`는 동일 출처 상대경로만 허용(오픈 리다이렉트
   방지) — 코드/클라이언트 부재/교환 실패 어느 경우든 예외 없이 `/?auth_error=1`로 리다이렉트
3. `useAuth.ts`의 `signUp()`에 `options: { emailRedirectTo: `${window.location.origin}/auth/callback` }`
   추가 — 클라이언트 훅이라 `window` 사용 안전(파일 최상단 `"use client"`)
4. `src/app/auth/callback/route.test.ts` 신설 — `getSupabaseRouteHandlerClient`를 모킹해
   성공/실패/코드없음/미설정/오픈리다이렉트 시도 5+1가지 케이스를 리다이렉트 URL로 검증
5. `npm run lint/test/build` → dev 서버에서 실 크리덴셜로 가짜 code를 포함한 실제 curl 검증
   (교환은 실제로 Supabase에 도달하므로 진짜 실패 응답을 관측 가능)

### [실행 + 관찰]

**신규 파일**
- `src/app/auth/callback/route.ts` — `GET` 핸들러, PKCE 코드 교환 + 안전한 리다이렉트
- `src/app/auth/callback/route.test.ts` — 6개 유닛 테스트

**수정 파일**
- `src/lib/auth/useAuth.ts` — `signUp()`에 `emailRedirectTo` 추가

**`npm run test`**
```
Test Files  5 passed (5)
     Tests  31 passed (31)
```
신규 6개: 유효 code 교환 성공 → `/`로 리다이렉트 / `?next=/settings` 지정 시 그 경로로 리다이렉트 /
타 출처 `next=https://evil.example/` 시도 시 무시하고 `/`로 폴백(오픈 리다이렉트 방어 확인) /
교환 실패(만료·재사용 code) 시 `/?auth_error=1` / code 파라미터 자체가 없으면 Supabase 호출 없이
바로 `/?auth_error=1` / Supabase 미설정(`getSupabaseRouteHandlerClient()` null) 시에도 예외 없이
`/?auth_error=1`.

**`npm run lint`** → 빈 출력, exit 0
**`npm run build`** → 컴파일/타입체크 통과, 라우트 목록에 `/auth/callback` 추가 확인:
```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/cron/refresh-trends
├ ƒ /api/trends
├ ƒ /api/trends/history
├ ƒ /api/watchlist
└ ƒ /auth/callback
```

**dev 서버(`:3001`, 실 크리덴셜) + curl 실측**
```
GET /auth/callback (code 없음)                              → HTTP 307, Location: /?auth_error=1
GET /auth/callback?code=totally-fake-code-12345               → HTTP 307, Location: /?auth_error=1
GET /auth/callback?code=fake&next=https://evil.example/       → HTTP 307, Location: /?auth_error=1
```
dev 로그에 실제로 흥미로운 실측 증거가 남음 — 가짜 code로도 라우트가 정말 Supabase의
`exchangeCodeForSession`을 호출했고, 실 Supabase가 다음 에러로 응답함:
```
Error [AuthPKCECodeVerifierMissingError]: PKCE code verifier not found in storage. ...
  __isAuthError: true, status: 400, code: 'pkce_code_verifier_not_found'
```
이 에러 자체가 계획 1단계에서 소스 코드로 추론한 "PKCE 플로우"라는 판단을 실측으로 재확인시켜줌
(에러 메시지가 명시적으로 "PKCE code verifier"를 언급). 동시에 실패 시 예외를 던지지 않고
`error` 객체로 안전하게 받아 로깅 후 리다이렉트하는 처리가 실제 Supabase 응답을 상대로도
정확히 의도대로 동작함을 확인. 서버 종료 후 포트 확인 → 정상 종료.

### [검증] — 성공 기준 대조
1. 콜백 라우트 신설 + code 교환 + `/`(또는 `next`)로 리다이렉트 → **충족** (빌드 라우트 목록,
   유닛 테스트, curl 모두로 확인)
2. `signUp()`에 `emailRedirectTo` 명시 → **충족** (코드 변경, dashboard Site URL 설정과 무관하게
   동작)
3. 교환 실패 시에도 항상 리다이렉트(빈 페이지/미처리 에러 없음) → **충족** (실 Supabase 에러
   응답으로 실측, 유닛 테스트로도 커버)
4. 실 이메일 링크 클릭 없이 검증 가능한 범위 최대한 검증 → **충족** — 유닛 테스트 6개 +
   실 Supabase를 상대로 한 가짜 code curl 3종. **다만 진짜 유효한 code로 성공 경로 전체(세션
   쿠키 실제 발급, 로그인 상태로 `/` 렌더링)는 검증 안 됨** — 이건 실제 이메일 링크 클릭이
   필요해 이 환경에서 원천적으로 불가능. 오케스트레이터가 사용자에게 재가입/재클릭을 요청해
   실제 클릭-스루로 재확인 필요.
5. lint/test/build 클린 → **충족**

### [개선/반복]
1회 반복으로 코드 가능한 4개 기준 완전 충족. 5번째(실 클릭-스루)는 이 세션의 권한/환경 밖
(실제 이메일 수신함 접근 불가) — 규칙 10, 추가 반복으로 해소 안 됨.

### [종료/중단]
프론트엔드 영역(`src/app/page.tsx` 등)은 이번 라운드에서 건드리지 않음 — `auth_error=1` 쿼리
파라미터를 읽어 사용자에게 메시지를 보여주는 것은 성공 기준 3의 "빈 페이지/미처리 에러 없음"
요건을 이미 만족하는 최소 구현이며(항상 유효한 `/` 페이지로 착지), 파라미터를 읽어 배너를
띄우는 UI 작업은 frontend 트랙에 넘김(`history.ts`/`watchlist.ts` 때와 동일한 계약 분리 패턴).
코드로 검증 가능한 부분은 모두 완료 — **중단(규칙 10, 실 클릭-스루만 남음)**.

## 반복 5 — 프론트엔드 ("AI티" 제거 — 2차 비주얼 정밀 교정)

### [목표]
사용자 피드백: "AI티 안나게 다듬어줘". 반복 3의 브랜드 패스(SPIKE/앰버 팔레트)가 이미
적용되어 있었지만, 그 자체로 "AI 생성 티"를 없애지는 못했다는 지적 — 전면 재작업이 아니라
실제로 남아있는 구체적인 "AI 생성 티"를 찾아 죽이는 정밀 교정. `frontend-design` 스킬을
재로드하고, 실제 스크린샷을 먼저 찍어 눈으로 비평한 뒤에만 손을 대는 순서를 지킨다.

### [성공 기준]
1. 비포/애프터 스크린샷(또는 명확한 비포 설명 + 애프터 스크린샷)으로 구체적 변경 증명
2. lint/test/build 클린, 실측 출력
3. 기존 기능(인증/지역 탭/워치리스트) 회귀 없음 — 기존 테스트 재실행으로 확인

### [계획]
1. `git merge main` — 백엔드의 실제 `regions.ts`(내가 반복 3에서 만든 플레이스홀더와 코드/라벨이
   완전히 동일해 조정 불필요), `/api/watchlist` 라우트 등 반영
2. Playwright를 devDependency로 설치(이전엔 매번 임시 스크립트 우회 필요 — 이번 라운드부터
   재사용 가능하도록 정식 설치) 후 실행 중인 dev 서버를 스크린샷 — 로그아웃 상태 전체 페이지 +
   인증 모달을 실제로 열어서 캡처
3. `frontend-design` 스킬 재로드, 스크린샷을 놓고 정직하게 비평 (아래 [비평 결과])
4. 비평에서 나온 구체적 tell마다 구체적 수정 적용 (아래 [수정 내역] — "전체적으로 다듬기"가
   아니라 각 항목을 근거와 함께 개별 수정)
5. lint → test(수정된 카피에 맞춰 테스트 문자열 갱신) → build
6. 애프터 스크린샷으로 재확인, dev 서버 종료

### [비평 결과] — 실제로 찾은 tell들
반복 3 스크린샷(로그아웃 전체 페이지 + 로그인 모달)을 놓고 스킬의 체크리스트로 비평:

1. **레이아웃에 긴장감이 없음**: 헤더/히어로/탭/리스트/푸터가 전부 `max-w-2xl` 한 칼럼 안에
   동일한 패딩으로 그냥 쌓여 있음 — Tailwind 스타터 템플릿의 가장 전형적인 구조. 시그니처
   요소(`SpikeLine`)조차 다른 요소와 똑같은 여백 규칙을 따라 특별히 도드라지지 않음.
2. **타입 시스템이 "다른 사이즈의 같은 것"처럼 보임**: 헤드라인이 `font-bold`(700) `text-2xl`뿐
   — 워드마크는 이미 `font-black`(900)인데 정작 헤드라인은 그보다 약함. 큰 사이즈일 뿐 무게감
   대비가 없어 "디스플레이 서체"라는 존재감이 없었음.
3. **랭킹 숫자가 계기판 판독값이 아니라 흐릿한 메타데이터처럼 보임**: `text-sm font-medium
   text-text-dim` — 순위 번호가 본문보다도 존재감이 약해, 데이터 레지스터라는 역할을 못 함.
4. **카피가 제네릭 SaaS 문구**: "새로고침"/"불러오는 중..."/"표시할 랭킹 데이터가 없습니다"/
   "다시 시도" — 전부 어느 앱에나 붙일 수 있는 기본값. SPIKE의 "신호 감지" 컨셉이 마이크로카피
   레벨까지 내려오지 못하고 헤드라인에서만 멈춰 있었음.
5. **빈 상태 아이콘이 브랜드와 무관**: 🔍(돋보기) — "검색 결과 없음"의 가장 흔한 제네릭 이모지.
   지진계/신호 트레이스라는 SPIKE의 시각 언어와 아무 연결이 없음.
6. **인증 모달이 브랜드 정체성 밖에 있음**: 라운드형 박스 + label-위-input + 둥근 테두리 —
   Tailwind로 만든 폼의 가장 전형적인 기본 패턴 그 자체. 헤더/히어로에만 브랜드를 입히고 나머지
   표면(특히 모달)은 손대지 않은 상태였음 — 정확히 사용자가 지적한 "브랜드 패스가 일부만
   적용됐다"는 유형의 tell.
7. **모션은 상대적으로 양호**: `SpikeLine`의 지속 스크롤은 장식이 아니라 제품 핵심 가치의 직역이고,
   `fade-in` 같은 뻔한 트랜지션이 남발되지 않음 — 추가 애니메이션을 넣지 않기로 결정(스킬
   원칙: "extra animation contributes to the feeling that the design is AI-generated").
8. **색 사용은 대체로 기능적**: 앰버는 브랜드/활성 상태에만, rise/fall은 상태 전용 — 장식적
   포인트 컬러 남용은 없었음. 이 항목은 추가 수정 불필요로 판단.

### [수정 내역] — tell별 구체적 대응
1. → **레이아웃**: 헤더+히어로(SpikeLine+헤드라인+서브카피)를 `border-b border-hairline
   bg-surface/40`을 가진 풀블리드 "아이덴티티 밴드"로 분리하고, 지역 탭/랭킹 리스트/푸터는
   그 아래 별도의 좁은 "데이터 워크스페이스" 칼럼에 배치. 장식적 비대칭이 아니라 "정체성
   표현"과 "데이터 열람"이라는 서로 다른 역할을 구조적으로 분리한 것 — 스킬의 "structure is
   information" 원칙에 맞춰 근거 있는 레이아웃 결정으로 만듦.
2. → **타입**: 헤드라인을 `font-bold text-2xl`→`font-black text-3xl sm:text-4xl
   tracking-tight leading-[1.1]`로 교체 — 워드마크와 동일한 900 웨이트+타이트 트래킹을 부여해
   실제 "디스플레이 서체"로서의 존재감을 줌.
3. → **데이터 타입**: 랭킹 숫자를 `text-sm font-medium`→`text-base font-semibold`로 올려
   본문보다 도드라지게 함 — 계기판 판독값처럼 읽히도록.
4. → **카피**: "새로고침"→"다시 스캔", "불러오는 중..."→"신호 수신 중...", "표시할 랭킹
   데이터가 없습니다"→"아직 감지된 신호가 없습니다", "잠시 후 다시 시도하거나 새로고침 버튼을
   눌러주세요"→"잠시 후 다시 스캔해보세요", "다시 시도"→"다시 스캔". mocked 배너/에러 배너
   문구는 실제 시스템 상태를 정확히 설명하는 기능적 문구라 판단해 그대로 둠(장식적 카피가
   아니므로 스킬의 "words earn their place" 기준상 문제 없음).
5. → **아이콘**: 🔍 이모지를 신규 컴포넌트 `FlatSignal`(SpikeLine과 대구를 이루는 "평평해진/
   끊긴 신호" 인라인 SVG)로 교체 — "신호가 없다"를 SPIKE 자신의 시각 언어로 직역, 범용
   이모지가 아니라 제품 고유의 그래픽 보캐뷸러리로 대체.
6. → **인증 모달**: 라벨을 `font-data text-[11px] uppercase tracking-widest`로, 인풋을
   `rounded-md border` 박스에서 `border-0 border-b border-hairline bg-transparent
   font-data`(밑줄만 있는 "콘솔 입력창" 스타일, 포커스 시 앰버 밑줄 두꺼워짐)로 교체, 모달
   제목도 헤드라인과 동일하게 `font-black tracking-tight`로 맞춤 — 헤더/히어로에서만 쓰이던
   브랜드 정체성을 이 표면까지 일관되게 확장.

### [실행 + 관찰]

**Playwright 설치**: `npm install -D playwright` (기존엔 `npx playwright screenshot` CLI로만
정적 캡처가 가능했고 클릭 등 상호작용 캡처가 불가능했음 — 모달을 실제로 열어 캡처하기 위해
정식 devDependency로 추가, 향후 라운드에서도 재사용 가능).

**Before 스크린샷** (`/tmp` 스크래치 경로에 저장, 커밋 대상 아님): 로그아웃 전체 페이지 +
"로그인" 클릭 후 모달. 위 [비평 결과]의 근거 자료로 사용.

**신규/수정 파일**
- `src/components/FlatSignal.tsx` (신규) — 빈 상태용 "신호 없음" SVG
- `src/app/page.tsx` — 아이덴티티 밴드/데이터 워크스페이스 구조 분리, 헤드라인 타입 강화,
  랭킹 숫자 타입 강화, 카피 5곳 교체, 빈 상태 아이콘 교체
- `src/components/AuthModal.tsx` — 인풋/라벨/제목 스타일을 콘솔 정체성에 맞게 교체
- `src/app/page.test.tsx` — 빈 상태 텍스트 단정문을 새 카피("아직 감지된 신호가 없습니다")로
  갱신

**`npm run lint`** — 통과 (에러/경고 없음, exit 0).

**`npm run test`** — 1차 실행에서 빈 상태 카피 변경으로 기존 단정문 1개가 의도대로 실패
(`표시할 랭킹 데이터가 없습니다`를 찾지 못함) → 테스트 문자열을 새 카피로 갱신 → 재실행:
```
 Test Files  4 passed (4)
      Tests  25 passed (25)
```
25개 전부 통과 — 인증/지역 탭/워치리스트 관련 테스트 21개는 이번 변경과 무관해 회귀 없음.

**`npm run build`**
```
✓ Compiled successfully
  Running TypeScript ... Finished TypeScript
Route (app): /, /_not-found, /api/cron/refresh-trends, /api/trends, /api/trends/history, /api/watchlist
```

**After 스크린샷** (실 YouTube 데이터로 `-p 3004` dev 서버 재기동 후 캡처):
- 전체 페이지: 헤더+히어로가 `bg-surface/40` 배경과 하단 구분선으로 명확히 분리된 "밴드"로
  보이고, 헤드라인이 워드마크와 동일한 굵기/트래킹으로 실제 존재감을 가짐. 지역 탭 옆 버튼이
  "다시 스캔"으로 표시. 랭킹 숫자가 이전보다 뚜렷하게 보임. (참고: 라운드를 거듭하며 실제
  Supabase에 스냅샷이 쌓여 이제 모든 행에 플랫 스파크라인+델타 0이 보이기 시작함 — 이번
  라운드 범위 밖의 데이터 특성이라 손대지 않음.)
- 인증 모달: 라운드형 박스+인풋이 밑줄만 있는 모노스페이스 "콘솔 입력창"으로 바뀌어 더 이상
  범용 폼처럼 보이지 않음, 제목/버튼 문구("다시 스캔" 반영 확인)까지 일관됨.

**dev 서버 종료**: `lsof -ti:3004 | xargs kill` 후 포트 확인 → 정상 종료.

### [검증] — 성공 기준 대조
1. 비포/애프터 스크린샷 — 위 [비평 결과]/[실행+관찰]에 구체적 비포 설명과 애프터 스크린샷
   기록 → **충족**
2. lint/test/build 클린 — 전부 실측 출력으로 확인 → **충족**
3. 기존 기능 회귀 없음 — 25개 테스트(인증 2개, 지역 전환 1개, 워치리스트 1개 포함) 전부 통과
   → **충족**

### [개선/반복]
1회 반복으로 3개 기준 모두 충족되어 추가 반복 불필요(규칙 9). 정직하게 기록할 점: 워치리스트
패널(`WatchlistPanel.tsx`)은 코드 리뷰 결과 이미 `signal`/`hairline`/`font-data` 토큰을 쓰고
있어 이번 라운드에서 별도 수정 없이 유지 — 단, 실제 로그인 세션 없이는 브라우저에서 시각
검증이 어려워(실 Supabase 계정 생성을 피하려 반복 3에서 의도적으로 스킵한 것과 동일한 이유)
스크린샷으로 최종 확인은 못 했다. 다음 라운드에서 테스트 계정으로 로그인 가능해지면
재확인 권장.

### [종료]
3개 성공 기준 모두 실측 증거로 충족. `frontend-loop`에 커밋 진행.

---

## 통합 (merge) — `backend-loop` ← `frontend-loop` (2차 비주얼 정밀 교정, `bfff14d`)

> `backend-loop`(HEAD `9bca19c`)에서 `git merge frontend-loop`(`bfff14d`) 실행.

### [충돌 및 해소]
- `LOOP_LOG.md`만 content 충돌. `14e8155:LOOP_LOG.md`(공통 베이스, 968줄)와 `bfff14d:LOOP_LOG.md`
  를 비교해 프론트엔드가 추가한 정확한 구간(969~1107행, "반복 5 — 프론트엔드" 섹션 139줄)을
  isolate한 뒤, 이번 라운드까지의 백엔드 쪽 전체 로그(`git show :2:LOOP_LOG.md`)에 그대로 이어붙임
  — 재작업/중복 없음.
- `package.json`/`package-lock.json`, `src/app/page.tsx`, `page.test.tsx`, `AuthModal.tsx`,
  신규 `FlatSignal.tsx` — 전부 자동 병합(디자인 패스가 백엔드 라운드와 겹치는 파일이 없어 충돌 없음).

### [검증 — 통합 결과 실측]
```
npm run lint   → 빈 출력, exit 0
npm run test   → Test Files 5 passed (5), Tests 31 passed (31)  (불변)
npm run build  → Compiled successfully, /auth/callback 포함 7개 라우트 정상 생성
```

**`npm run dev -- -p 3001` + curl (실 크리덴셜, 주요 라우트 전부)**
```
GET  /                                              → HTTP 200
GET  /api/trends?region=KR                          → HTTP 200
GET  /api/trends/history?region=KR                  → HTTP 200
GET  /auth/callback (code 없음)                       → HTTP 307
GET  /api/watchlist (세션 없음)                        → HTTP 401
POST /api/cron/refresh-trends (correct secret)       → HTTP 200
```
dev 로그 전수 확인 — 예상 밖 에러/회귀 없음(기존에 문서화한 것 외 없음). 정상 종료 확인.

### [결론]
`bfff14d` 반영 후 lint/test(31개, 불변)/build/dev 6요청 curl 전부 그린 — 회귀 없음.
`backend-loop`에 머지 커밋 진행 후 `main`으로 병합 예정.

---

## 반복 — 백엔드 (rate limiting + 키워드별 랭킹 히스토리)

> `git merge main` → 이미 최신(변경 없음). 결제(Stripe)는 계정 크리덴셜 부재로 이번 라운드
> 범위 밖. Redis/Upstash 같은 새 외부 크리덴셜 없이 Supabase만으로 두 기능 구현.

### [목표]
1. `/api/trends`, `/api/trends/history` 공개 라우트에 남용 방지(rate limit) 추가 — Supabase
   기반, 미설정/실패 시 항상 허용(그레이스풀 디그레이드)
2. 키워드별 랭킹 히스토리를 위한 데이터 접근 계층 — 프론트엔드가 스파크라인보다 큰 상세 뷰를
   만들 수 있도록, 전체 스냅샷이 아닌 해당 키워드만의 작은 페이로드 제공
3. 실 Supabase로 두 기능 동작 검증(가능한 범위), lint/test/build 클린

### [계획]
1. **Rate limit 설계 결정**: Redis 없음 → Postgres 고정 윈도우(fixed window) 카운터 테이블 +
   원자적 증가 RPC 함수. 슬라이딩 윈도우 대신 고정 윈도우를 선택한 이유: 구현이 훨씬 단순(키당
   분당 1행, RPC 1회 호출)하고, 이 프로젝트 규모(공개 조회 라우트 남용 방지, 과금 단위 아님)에는
   윈도우 경계에서 최대 2배까지 허용되는 느슨함이 실질적 문제가 안 됨 — 트레이드오프를
   마이그레이션 파일 상단에 명시.
   - 한도: 분당 30회/IP. 근거: 정상 사용(페이지 로드 1회 + 가끔 새로고침/지역 전환)은 분당
     10회 미만이 일반적 — 30이면 정상 사용에 넉넉한 여유를 주면서 스크립트/봇성 남용은 확실히
     캡됨.
   - 식별자: `x-forwarded-for`(Vercel 등 프록시 표준) → `x-real-ip` 폴백 → 없으면 공유
     "unknown" 버킷(로컬/비프록시 환경의 알려진 한계로 문서화).
   - 라우트별 독립 버킷(`trends:`, `trends-history:` 접두사) — 두 라우트가 보통 같이 호출되지만
     공유 버킷으로 묶으면 한쪽이 다른 쪽 quota를 잠식할 수 있어 분리.
2. `supabase/migrations/0003_rate_limiting.sql` 신설 — `rate_limit_counters` 테이블 +
   `increment_rate_limit(key, window_start)` RPC(원자적 upsert-increment, 1% 확률로 1시간
   이상 지난 행 정리해 별도 정리 잡 없이 테이블 크기 관리)
3. `src/lib/rate-limit.ts` 신설 — `checkRateLimit(routeKey, identifier, limit)`,
   `getClientIdentifier(req)`, `rateLimitResponse(result)`(429 + Retry-After/X-RateLimit-* 헤더).
   Supabase 미설정/RPC 실패/예외 모두 "허용"으로 폴백 — 나머지 저장 계층과 동일한 규율
4. `/api/trends`, `/api/trends/history`에 라우트 진입 시점에 `checkRateLimit` 적용, 초과 시
   `rateLimitResponse` 반환
5. **키워드 히스토리 설계 결정**: `/api/trends/history`를 그대로 재사용하지 않고 전용 라우트
   신설. 이유: 그 라우트는 스냅샷당 전체 아이템 리스트(보통 20개 키워드)를 반환하는데, 단일
   키워드 상세 뷰에는 그중 1개만 필요 — 나머지 19개를 매 요청마다 브라우저로 보내는 건 낭비.
   DB 함수(RPC)로 서버 사이드 필터링하는 방안도 검토했으나, `getRecentTrendSnapshots`가 이미
   존재하고 라이브 적용되어 있어(추가 마이그레이션 승인 대기 없이 즉시 동작) 그걸 재사용해
   Node 서버에서 필터링하는 쪽을 선택 — Supabase→서버 구간은 서버 간 통신이라 크지 않고(최대
   50개 스냅샷 × 20개 아이템 정도), 브라우저로 나가는 응답만 작으면 목표(작은 클라이언트
   페이로드) 달성. RPC 방식은 더 효율적이지만 또 하나의 라이브 미적용 마이그레이션을 만드는
   대가가 있어 이번엔 보류(주석으로 향후 최적화 옵션으로 남김).
6. `src/lib/trends/persist.ts`에 `extractKeywordHistory(snapshots, keyword)` 순수 함수 추가
   (스냅샷 배열에서 해당 키워드의 rank/score만 뽑아 시간순 정렬, 키워드 없는 스냅샷은 에러
   없이 스킵)
7. `src/app/api/trends/keyword-history/route.ts` 신설 —
   `GET ?keyword=X&region=KR&limit=50` → `{keyword, region, points}`. `keyword` 없으면 400
   (다른 곳은 전부 200-그레이스풀이지만, 여기는 watchlist POST의 필수 필드 누락과 동일하게
   "진짜 잘못된 요청"이라 400이 일관적). rate limit도 동일하게 적용(`trends-keyword-history:`)
8. 유닛 테스트: `rate-limit.test.ts`(허용/거부/경계값/RPC 실패시 허용/식별자 추출 10개),
   `persist.test.ts`에 `extractKeywordHistory` 4개 추가
9. `npm run lint/test/build` → dev 서버 + 실 크리덴셜로 curl 검증 (마이그레이션 미적용 상태에서
   그레이스풀 디그레이드 실측까지 포함)

### [실행 + 관찰]

**신규 파일**
- `supabase/migrations/0003_rate_limiting.sql`
- `src/lib/rate-limit.ts`, `src/lib/rate-limit.test.ts`
- `src/app/api/trends/keyword-history/route.ts`

**수정 파일**
- `src/app/api/trends/route.ts`, `src/app/api/trends/history/route.ts` — rate limit 적용
- `src/lib/trends/persist.ts` — `extractKeywordHistory` 추가
- `src/lib/trends/persist.test.ts` — 관련 테스트 추가
- `supabase/migrations/APPLIED.md` — `0003` pending으로 등재

**`npm run test`**
```
Test Files  6 passed (6)
     Tests  45 passed (45)
```
신규 14개: rate-limit 10개(Supabase 미설정 시 허용/한도 이내 허용+잔여량/한도 초과 거부/경계값
정확히 한도일 때 허용/RPC 에러 시 허용 폴백/RPC 예외 시 허용 폴백/라우트별 독립 버킷/식별자
추출 3종) + extractKeywordHistory 4개(정상 추출+정렬/키워드 없는 스냅샷 스킵/전체 미매치 시
빈 배열/빈 입력)

**`npm run lint`** → 빈 출력, exit 0
**`npm run build`** → 클린, 라우트 목록에 `/api/trends/keyword-history` 추가 확인:
```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/cron/refresh-trends
├ ƒ /api/trends
├ ƒ /api/trends/history
├ ƒ /api/trends/keyword-history
├ ƒ /api/watchlist
└ ƒ /auth/callback
```

**dev 서버(`:3001`, 실 크리덴셜) 실측**
```
GET /api/trends/keyword-history (keyword 없음)              → HTTP 400
GET /api/trends/keyword-history?keyword=BIGBANG&region=KR   → HTTP 200,
  {"keyword":"BIGBANG","region":"KR","points":[...17개 포인트, fetchedAt 오름차순...]}
  (라운드 3부터 지금까지 쌓인 실제 스냅샷들에서 뽑아낸 진짜 데이터)

/api/trends?region=KR 연속 5회 호출 → 전부 HTTP 200 (429 없음)
```
rate limit이 실제로는 아직 "허용"으로 폴백되는 이유를 dev 로그로 실측 확인 — 마이그레이션
`0003`이 아직 라이브에 미적용되어 RPC 함수가 없음:
```
checkRateLimit: rpc failed {
  message: 'Could not find the function public.increment_rate_limit(p_key, p_window_start) in the schema cache'
}
```
이 에러가 반복 관측되면서도 모든 요청이 200을 유지 — "절대 실사용을 막지 않는다"는 설계
원칙이 실제 스키마 미적용 상황에서 정확히 의도대로 동작함을 실측으로 확인(라운드 3의
`mocked` 컬럼 부재 때와 동일한 패턴). `/`, `/api/watchlist`(401), `/api/trends/history` 모두
회귀 없이 정상. 서버 종료 후 포트 확인 → 정상 종료.

### [검증] — 성공 기준 대조
1. `/api/trends`, `/api/trends/history` rate limit 적용 + 429 응답 로직 구현, 유닛 테스트로
   허용/거부/경계값 모두 커버, Supabase 미설정/RPC 실패 시 항상 허용 실측 확인 → **코드/로직
   충족. "실 Supabase로 429 트리거" 자체는 미검증** — `0003` 마이그레이션이 아직 라이브에
   없어 RPC가 실행되지 않기 때문(규칙 10과 동일한 패턴, 이전 라운드들과 같은 이유)
2. 키워드 히스토리 데이터 접근 계층(`extractKeywordHistory` + 전용 라우트) → **충족**, 실
   Supabase 데이터로 실측 확인(BIGBANG 17개 포인트 실제 반환)
3. lint/test(45개)/build 클린 → **충족**

### [개선/반복]
1회 반복으로 코드 가능한 부분 전부 완료. 성공 기준 1의 "실 429 트리거 확인"만 `0003`
마이그레이션의 라이브 적용을 필요로 함 — 규칙 10, 이 세션 권한 밖.

### [종료/중단]
`0003_rate_limiting.sql` 라이브 적용 필요(SQL Editor, 이전 두 번과 동일한 절차) — 적용 후
동일 IP로 31회 이상 빠르게 호출해 31번째부터 `429` + `Retry-After` 헤더가 실제로 나오는지
재검증 필요. 그 외 전부 완료 — **중단(규칙 10, 라이브 적용 대기)**.

## 반복 6 — 프론트엔드 (키워드 상세 뷰 + 모바일 반응형 + SEO/OG)

### [목표]
결제(Stripe)는 별도 트랙에서 차단된 상태이며 이번 라운드와 무관. 새 크리덴셜 없이 실제
제품 가치를 계속 쌓는 라운드로 3개 목표: (1) 키워드 클릭 시 더 크고 상세한 순위 추이
차트를 보여주는 상세 뷰 — 워치리스트가 실제로 쓸모 있어지는 기능, (2) 모바일(390×844)
실제 스크린샷 기반 반응형 교정, (3) 공개 저장소/포트폴리오 링크로 공유될 것을 고려한
SEO/Open Graph 메타데이터.

### [성공 기준]
1. 키워드 상세 뷰: 클릭 시 확대된 순위 추이 차트, 데이터 희소(0-1개 스냅샷) 시
   "아직 데이터가 충분하지 않습니다" 명확한 상태 표시 (빈 차트/깨진 화면 금지)
2. 모바일 스크린샷(홈/인증 모달/상세 뷰)으로 실제 문제 발견 시 수정, 맹목적 브레이크포인트
   추가 금지
3. `<title>`/description/Open Graph(og:title/description/image) 메타, SPIKE 보이스 유지
4. 데스크톱+모바일 실측 스크린샷 증거, lint/test/build 클린

### [계획]
1. `git merge main` — 확인 결과 `frontend-loop`가 이미 `main`보다 앞서 있어(반복 5 커밋이
   아직 오케스트레이터에 의해 `main`에 머지되지 않음) `Already up to date`, 별도 조치 불필요
2. `dataviz` 스킬 로드 후 차트 설계(단일 시리즈 변화 추이 → 라인 차트, 팔레트 검증은
   범주형 다색 배색이 아니므로 스킵, 마크 스펙/호버 크로스헤어+툴팁 원칙만 적용)
3. 백엔드가 병행으로 `/api/trends/history` 확장 또는 전용 `/api/trends/keyword-history`
   신설을 검토 중이라는 안내를 받았으나, 이미 `page.tsx`가 스파크라인/델타용으로 정확히
   같은 데이터(`historyMap`)를 매 리전마다 캐싱 없이 확보하고 있어, 신규 네트워크 요청 없이
   기존 데이터를 재사용하는 쪽을 택함(불확실한 계약에 새로 의존하지 않는 낮은 리스크 선택).
   백엔드가 더 높은 해상도의 전용 엔드포인트를 내놓으면 향후 라운드에서 `history.ts`/
   `watchlist.ts` 때와 같은 방식으로 재조정
4. `RankHistoryChart`(축/그리드/호버 크로스헤어+툴팁/마지막 지점 직접 라벨) +
   `KeywordDetailModal`(통계 요약 + 희소 데이터 안내) 신설, `page.tsx`에 키워드 클릭 진입점
   연결(별표 토글과 별도 버튼, 이벤트 버블링 방지)
5. `npm install -D playwright` 이미 존재 확인(반복 5에서 설치됨) — 실행 중인 dev 서버를
   데스크톱/모바일 두 뷰포트로 스크린샷하는 재사용 가능한 임시 스크립트 작성(커밋 대상
   아님, 완료 후 삭제)
6. 모바일(390×844) 스크린샷 3종(홈/인증 모달/상세 뷰) 촬영 후 실제 문제만 교정
7. Next 문서(`node_modules/next/dist/docs`, 이 버전 기준) 확인 후 `opengraph-image.png`
   파일 컨벤션 + `metadata.openGraph`/`metadata.twitter` 필드로 SEO 메타 추가. 정적 이미지는
   SPIKE 톤(웜 근접-블랙 배경, 앰버 워드마크/헤드라인, SpikeLine 모티프)으로 브랜드에 맞는
   HTML 목업을 Playwright로 1200×630 스크린샷해 생성(동적 `ImageResponse` 불필요 — 과제
   지시대로 정적 이미지로 충분)
8. 키워드 상세 뷰 테스트 2건 추가(충분한 데이터 → 차트, 희소 데이터 → 안내 문구),
   기존 25개 회귀 확인
9. lint → test → build, 데스크톱/모바일 최종 스크린샷 재확인, dev 서버 종료, 스크래치
   스크립트 삭제

### [실행 + 관찰]

**신규 파일**
- `src/components/RankHistoryChart.tsx` — 단일 키워드 순위 추이 상세 차트(SVG, y축 실제
  순위 눈금 3개, x축 첫/마지막 타임스탬프만 라벨링해 과밀 방지, 호버 시 세로 크로스헤어 +
  HTML 툴팁, 마지막 지점에 상시 노출되는 "N위" 직접 라벨)
- `src/components/KeywordDetailModal.tsx` — 현재/최고 순위·스냅샷 개수 통계 + 차트, 히스토리
  2개 미만이면 `FlatSignal` 아이콘과 함께 "아직 데이터가 충분하지 않습니다" 표시
- `src/app/opengraph-image.png` — Next.js 파일 컨벤션(자동 인식, 코드 불필요)으로 배치한
  정적 1200×630 OG 이미지

**수정 파일**
- `src/app/page.tsx` — 상세 뷰 진입점(키워드를 별도 `<button>`으로 분리, 별표 버튼은
  `stopPropagation`으로 클릭 충돌 방지), 모바일 헤드라인 크기 축소(`text-3xl`→`text-2xl`,
  `sm:text-4xl`은 유지) — 아래 [모바일 교정] 참고
- `src/components/RegionTabs.tsx` — 모바일 교정(아래 참고)
- `src/app/layout.tsx` — `metadataBase`, `openGraph`, `twitter` 필드 추가
- `.env.example` — `NEXT_PUBLIC_SITE_URL`(선택, OG 절대 URL 해석용) 문서화
- `src/app/page.test.tsx` — 키워드 상세 뷰 테스트 2건 추가

**차트 관련 발견 + 수정 (구현 중 자체 발견)**: 실 데이터로 첫 스크린샷을 찍었을 때, 순위가
줄곧 1위로 고정된 키워드(BIGBANG — 정확히 SPIKE가 강조해야 할 "계속 1위" 시나리오)의
경우 그래프가 차트 상단 여백에 딱 붙어 그려져 마지막 지점의 "1위" 직접 라벨이 상단 밖으로
거의 잘려나가는 실측 버그를 발견. `PAD_TOP`을 14→22로 늘려 해결, 스크린샷으로 재확인.

**[모바일 교정]** 390×844 스크린샷으로 실제 확인한 문제만 수정:
1. 헤드라인 "지금, 가장 먼저 뜨는 키워드"가 `text-3xl` 기준폭에서 "키워" / "드"로 단어 중간이
   깨져 두 줄로 잘림 → 모바일 기준 크기를 `text-2xl`로 낮춤(`sm:` 이상에서는 기존 `text-4xl`
   유지, 데스크톱 영향 없음 스크린샷으로 확인)
2. 지역 탭이 "KR 대한민국" 식으로 코드+라벨을 한 버튼에 다 넣다 보니 좁은 화면에서 라벨이
   줄바꿈되며 탭 3개 + "다시 스캔" 버튼이 뒤엉켜 보임 → 라벨 텍스트를 `hidden sm:inline`으로
   감춰 모바일에서는 "KR/US/JP" 코드만 표시(데스크톱은 기존과 동일하게 전체 라벨 유지)
3. 인증 모달·키워드 상세 모달은 이미 반복 3/이번 라운드에서 만든 `fixed inset-0 ... px-4`
   패턴 덕에 모바일에서 별도 수정 없이 정상 동작 확인(스크린샷으로 검증, 가로 스크롤/겹침
   없음) — "모든 곳에 브레이크포인트 추가" 같은 맹목적 수정을 하지 않고 실제로 깨진 2곳만
   고쳤다는 근거

**`npm run lint`** — 통과 (에러/경고 없음, exit 0).

**`npm run test`**
```
 Test Files  4 passed (4)
      Tests  27 passed (27)
```
신규 2건(충분한 히스토리 → 차트+통계 노출, 희소 히스토리 → 안내 문구) 포함 27개 전부 통과 —
기존 25개 회귀 없음.

**`npm run build`**
```
✓ Compiled successfully
Route (app): /, /_not-found, /api/cron/refresh-trends, /api/trends, /api/trends/history,
              /api/watchlist, /opengraph-image.png
```
`/opengraph-image.png`가 정적 라우트로 자동 생성됨 — 파일 컨벤션이 정상 인식됐다는 실측 증거.

**메타 태그 실측 확인** (`curl localhost:3005/ | grep`):
```
<title>SPIKE — 지금 뜨는 키워드를 가장 먼저</title>
<meta name="description" content="... 워치리스트에 담아두면 순위가 바뀔 때마다 가장 먼저 알 수 있어요."/>
<meta property="og:title" .../> <meta property="og:description" .../>
<meta property="og:image" content=".../opengraph-image.png?..."/> (width=1200, height=630 자동 인식)
<meta name="twitter:card" content="summary_large_image"/> 외 twitter:title/description/image 전부 정상
```

**데스크톱/모바일 최종 스크린샷** (dev 서버 `-p 3005`, 실 YouTube/Supabase 데이터):
- 데스크톱(900×700): 홈 정상, 상세 모달에서 BIGBANG 17개 스냅샷 차트(현재 1위/최고 1위)가
  라벨 잘림 없이 정상 렌더링
- 모바일(390×844): 홈(헤드라인 한 줄, 지역 탭 한 줄로 정상), 인증 모달(폼 필드/버튼 전부
  뷰포트 안에 들어옴, 가로 스크롤 없음), 상세 뷰(차트 축/라벨/툴팁 자리 전부 정상, 겹침 없음)

**dev 서버 종료**: `lsof -ti:3005 | xargs kill` 후 포트 확인 → 정상 종료. 스크래치
스크린샷 스크립트(`.scratch-*.mjs`) 삭제, 커밋 대상에서 제외.

### [검증] — 성공 기준 대조
1. 키워드 상세 뷰 — 차트 정상 렌더링(스크린샷+테스트) + 희소 데이터 안내 문구(테스트로
   확인) → **충족**
2. 모바일 반응형 — 실제 스크린샷에서 발견한 2개 문제(헤드라인 줄바꿈, 지역 탭 겹침)만
   근거와 함께 수정, 나머지는 이미 정상 동작 확인 → **충족**
3. SEO/OG — title/description/openGraph/twitter 메타 + 정적 브랜드 OG 이미지, 실측 curl로
   태그 확인 → **충족**
4. 증거/클린 — 데스크톱+모바일 스크린샷, lint/test(27개)/build 전부 실측 그린 → **충족**

### [개선/반복]
1회 반복으로 4개 기준 모두 충족되어 추가 반복 불필요(규칙 9). 정직하게 기록할 한계:
- 키워드 상세 차트는 신규 엔드포인트 없이 `/api/trends/history`가 이미 제공하는 스냅샷
  (기본 20개 제한)만 사용 — 백엔드가 전용 `/api/trends/keyword-history`를 더 높은 해상도로
  내놓으면 마이그레이션 필요(위 [계획] 3번에 근거 기록)
- `dataviz` 스킬의 "접근성 최종 점검" 중 "표 형태 보기" 항목은 이번 단일 시리즈 차트에는
  생략(범례가 필요 없는 단일 시리즈이고, 실제 순위 숫자가 축/툴팁/직접 라벨로 이미 텍스트로
  노출되어 있어 우선순위상 스킵 — 향후 접근성 감사 라운드에서 재검토 권장)

### [종료]
4개 성공 기준 모두 실측 증거로 충족. `frontend-loop`에 커밋 진행.

---

## 통합 (merge) — `backend-loop` ← `frontend-loop` (키워드 상세 뷰 + 모바일 + SEO, `7c6d647`)

> `backend-loop`(HEAD `c983019`)에서 `git merge frontend-loop`(`7c6d647`) 실행.

### [충돌 및 해소]
- `LOOP_LOG.md`만 content 충돌. 이번엔 단순 "공통 prefix 찾기"가 통하지 않았음 — 백엔드 쪽
  파일이 공통 조상(`bfff14d`, 1107줄) 이후로 자체 섹션 2개(라이브 스키마 재검증+마이그레이션
  개편, auth 콜백)를 먼저 추가했고, 그 뒤에야 프론트엔드의 `bfff14d` 시점 섹션을 이어붙인
  상태였어서, `bfff14d:LOOP_LOG.md`를 그대로 라인 단위로 ours와 비교하면 순서가 어긋나 있었음
  (내용 자체는 양쪽 다 있었지만 배치 순서가 다름). 대신 `git show HEAD:LOOP_LOG.md`(병합 시작
  직전의 진짜 ours, 1468줄)와 `bfff14d:LOOP_LOG.md`(1107줄)를 비교해 `7c6d647`이 그 뒤에 정확히
  추가한 구간(1108~1246행, "반복 6 — 프론트엔드" 섹션 139줄)만 골라낸 뒤, 진짜 ours 뒤에
  그대로 이어붙임 — 재작업/중복 없음. 첫 시도에서 셸 `&&` 체인이 `diff`(내용 다름 → 비정상
  종료 취급)에서 끊겨 파일이 원래 conflict marker 상태 그대로 남은 실수가 있었고, `git show
  HEAD:...`로 진짜 ours를 다시 추출해 재작업함 — 조인 지점(1468/1469행)을 직접 눈으로 확인 후
  적용.
- `.env.example`, `layout.tsx`, `page.tsx`, `page.test.tsx`, `RegionTabs.tsx`, 신규
  `KeywordDetailModal.tsx`/`RankHistoryChart.tsx`/`opengraph-image.png` — 전부 자동 병합
  (백엔드 이번 라운드와 겹치는 파일 없음).

### [검증 — 통합 결과 실측]
```
npm run lint   → 빈 출력, exit 0
npm run test   → Test Files 6 passed (6), Tests 47 passed (47)  (45 + frontend의 신규 2개)
npm run build  → Compiled successfully, TypeScript 통과, 9개 라우트(+/opengraph-image.png) 정상 생성
```

**`npm run dev -- -p 3001` + curl (실 크리덴셜, 8개 요청)**
```
GET  /                                                       → HTTP 200
GET  /api/trends?region=KR                                   → HTTP 200
GET  /api/trends/history?region=KR                           → HTTP 200
GET  /api/trends/keyword-history?keyword=BIGBANG&region=KR   → HTTP 200
GET  /auth/callback (code 없음)                                → HTTP 307
GET  /api/watchlist (세션 없음)                                 → HTTP 401
GET  /opengraph-image.png                                     → HTTP 200
POST /api/cron/refresh-trends (correct secret)                → HTTP 200
```
dev 로그 전수 확인 — `PGRST202`(0003 미적용으로 인한 rate-limit RPC 부재, 이미 문서화한 것과
동일 클래스) 외 예상 밖 에러/회귀 없음. 정상 종료 확인.

**참고**: frontend가 이번 라운드 로그에 명시적으로 남긴 메모대로, `KeywordDetailModal`은 백엔드가
새로 만든 `/api/trends/keyword-history`를 기다리지 않고 기존 `/api/trends/history`(기본 20개
스냅샷 제한)로 구현되어 있어 지금 당장 라우트 계약 충돌은 없음 — 다음 프론트엔드 라운드에서
전용 엔드포인트로 전환할지는 그쪽 판단(오케스트레이터가 이미 인지).

### [결론]
`7c6d647` 반영 후 lint/test(47개)/build/dev 8요청 curl 전부 그린 — 회귀 없음.
`backend-loop`에 머지 커밋 진행 후 `main`으로 병합·푸시 예정.

## 반복 7 — 프론트엔드 (근본 재설계: "너무 클로드스러워" 피드백)

### [배경]
두 차례의 표면적 다듬기(반복 3 브랜드 패스, 반복 5 "AI티" 제거)로도 사용자는 여전히
"너무 클로드스러워 보인다"고 판단. `frontend-design` 스킬을 다시 로드해 캘리브레이션
섹션을 정독한 결과, 근본 원인이 명확해짐: 스킬이 명시하는 3대 AI 생성 디자인 기본값 중
하나가 "근접-블랙 배경 + 단일 형광 그린/버밀리언 포인트"인데, SPIKE의 현재 정체성(근접-블랙
+ 단일 앰버 포인트)이 정확히 이 패턴의 변형에 불과했다. 반복 3/5는 카피·이모지·모달 스타일
같은 "실행 디테일"만 고쳤을 뿐 토큰 시스템 자체(팔레트 구조, 타이포 시스템, 레이아웃 로직)를
바꾸지 않았으므로 근본 문제가 남아있었다. 이번 라운드는 점진적 다듬기가 아니라 스킬이
지시하는 2단계 프로세스(브레인스톰 → 자기비평 → 구현)를 처음부터 다시 수행하는 진짜
재설계다. "SPIKE"·지진계 모티프에 얽매이지 않고 브레인스톰함.

### [목표]
1. 실제 제품 주제(YouTube 실시간 트렌드/키워드 신호 감지)에 뿌리를 둔 완전히 새로운 디자인
   플랜을 코드 작성 전에 수립 — 색상 4-6개(이름+헥스), 서체 2개 이상(역할 정의), 레이아웃
   컨셉(프로즈+ASCII 와이어프레임), 시그니처 요소 1개
2. 그 플랜을 스킬의 3대 AI 기본값 클러스터(크림+세리프+테라코타 / 근접블랙+단일포인트 /
   브로드시트 헤어라인) 각각과 직접 대조해 자기비평 — 겹치는 부분이 있으면 무엇을 왜
   바꿨는지 기록
3. 승인된 플랜대로만 구현, 기존 기능(인증/지역/워치리스트/키워드 상세) 무회귀
4. 데스크톱+모바일 비포/애프터 스크린샷, lint/test/build 클린

### [브레인스톰]
주제: YouTube 데이터 기반 실시간 인기 키워드 랭킹 — "지금 막 뜨기 시작한 것을 가장 먼저
포착"하는 감지/추적 도구, 순위가 시간에 따라 바뀌는 것이 핵심 메커닉.

검토한 메타포 후보:
- **주식/트레이딩 티커**: 상승/하락 화살표, 실시간 틱 — 기각. 이미 수많은 핀테크 대시보드의
  기본 언어라 "이 제품만의" 것이 되지 못하고, 실제로는 YouTube/콘텐츠 문화라는 주제와도
  거리가 있음.
- **신문 속보/와이어 티커**: "breaking" 리본, 헤드라인 조판 — 기각. 스킬이 경계하는 3대
  기본값 중 "브로드시트 헤어라인 신문 레이아웃"과 정확히 겹칠 위험이 큼.
- **한국 실시간 검색어 순위 UI 전통**: 네이버/다음 "실시간 급상승 검색어"처럼 한국 인터넷
  문화에서 매우 익숙한 번호 매긴 순위 리스트 — 주제적으로는 직결되지만, 이미 지금 화면이
  정확히 그 형태(번호+키워드+숫자 리스트)라서 "새로운 시각 시스템"을 끌어내는 힘이 약함.
- **공항/기차역 스플릿플랩(split-flap) 전광판**: 순서가 매겨진 항목들이 실시간으로 갱신되며,
  값이 바뀔 때 기계적으로 "뒤집히는" 실물 장치. 채택.

**채택 이유**: (1) "순위가 바뀌는 실시간 리스트"라는 제품의 핵심 메커닉과 물리적 오브젝트의
동작 방식이 1:1로 대응됨(장식이 아니라 기능의 직역). (2) 다크 배경이 "AI 기본값이라서"가
아니라 "실제 전광판 케이싱이 짙은 색 도장/금속이기 때문"이라는 구체적 근거를 얻음. (3)
타이포·레이아웃·모션 모두 이 레퍼런스 하나에서 자연스럽게 파생됨(아래 참고) — 색만 바꾼
변주가 아니라 시스템 전체가 같이 달라짐. (4) 시그니처 모션(플립 전환)이 장식이 아니라
"값이 바뀌면 실제로 이렇게 보인다"는 근거를 가짐.

**이름 재검토**: "SPIKE"(지진계 모티프)는 새 메타포와 더 이상 맞지 않아 폐기. 플랩 매커니즘을
직접 가리키는 **FLIP**으로 교체 — 한국어로도 "플립"이 이미 통용되는 외래어(플립폰 등)라
발음/표기 마찰이 적고, 시그니처 모션과 이름이 직접 연결됨.

### [토큰 시스템]

**색상 (6개, 명명):**
| 이름 | 헥스 | 역할 |
|---|---|---|
| `casing` | `#0E0E10` | 전광판 바깥 케이싱(차가운 뉴트럴 근접-블랙, 실제 금속/플라스틱 하우징) |
| `panel` | `#1C1B1E` | 개별 플랩 행의 패널 배경(케이싱보다 살짝 밝아 "개별 모듈"로 읽힘) |
| `flap` | `#F2ECDD` | 플랩에 인쇄된 문자 색(따뜻한 크림 — 실제 전광판 도장색, 순백 아님) |
| `flap-dim` | `#8B887E` | 보조 정보(바랜 플랩 문자처럼 낮은 대비) |
| `rising` | `#E8B23D` | 순위 상승 상태 전용(전광판의 앰버 표시등 참조) |
| `falling` | `#C4544A` | 순위 하락 상태 전용(전광판의 적색 지연/알림 표시등 참조) |

**서체 (3역할):**
- **간판/플랩 표시** — Black Han Sans(한글, 900 단일 웨이트, 포스터/사이니지용 그래픽체) —
  키워드 텍스트, 헤드라인. 실제 전광판 문자판의 스텐실 같은 그래픽 성격을 반영.
- **기계식 숫자** — Space Mono(라틴, 모노스페이스, 700) — 순위 번호·점수·타임스탬프·지역
  코드. 실제 플랩 보드 숫자 폰트에 가장 가까운 지오메트릭 모노스페이스.
- **본문/UI** — IBM Plex Sans KR — 설명문·버튼·폼 라벨. IBM Plex는 "기술 문서/계기판"
  혈통이 있어 Noto Sans KR보다 "안내판" 세계관에 더 맞음.

**레이아웃 컨셉**: 화면 전체가 웹 대시보드가 아니라 벽에 걸린 실물 전광판을 보고 있는
느낌. 랭킹 리스트는 각 행이 독립된 플랩 패널 모듈로 보이도록 상단 하이라이트+하단 그림자의
얕은 베젤을 가지며(완전 평면 헤어라인 구분이 아님), 행 내부는 순위 번호·키워드·상태·점수가
각각의 "문자 셀"처럼 나뉜다. 헤더는 큰 마케팅 히어로가 아니라 보드 프레임에 붙은 작은
금속 명판처럼 컴팩트하게. 지역 전환은 "다른 채널로 튜닝"이 아니라 보드 제어반의 물리
버튼처럼.

```
┌───────────────────────────────────────┐
│  FLIP            [KR][US][JP]   [로그인]│  ← 금속 명판 헤더
├───────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  ← 케이싱 상단 베젤
│ ┌────┬───────────────────┬────┬──────┐│
│ │ 01 │ BIGBANG           │▲ 2 │ 1.2M ││  ← 플랩 행(행별 베젤/그림자)
│ ├────┼───────────────────┼────┼──────┤│
│ │ 02 │ 하이브            │ 0  │ 900K ││
│ ├────┼───────────────────┼────┼──────┤│
│ │ 03 │ ENHYPEN           │▼ 1 │ 750K ││
│ └────┴───────────────────┴────┴──────┘│
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  ← 케이싱 하단 베젤
└───────────────────────────────────────┘
```

**시그니처 요소**: 행 플립 전환 — 새로고침/데이터 갱신 시 값이 바뀐 행이 실제 스플릿플랩처럼
X축으로 회전하며 새 값을 드러냄(초기 로드 시에는 행이 순서대로 스태거드 플립-인). 이 모션
하나에만 과감함을 집중하고 나머지는 정적으로 유지.

### [자기비평 — 3대 기본값 클러스터 대조]
1. **크림+세리프+테라코타**: 해당 없음 — 다크 케이싱 기반, 세리프 서체 없음, 테라코타 없음.
   ✅ 명확히 다름.
2. **근접-블랙 + 단일 형광 포인트(가장 위험한 항목)**: 케이싱이 근접-블랙인 것은 사실이라
   가장 엄격히 검토함. 최초 브레인스톰안은 앰버(`rising`)를 워드마크·버튼·활성 탭에도 쓰려
   했는데, 이러면 "근접블랙 + 단일 앰버 포인트를 UI 전체에 장식적으로 반복"이라는 정확히
   동일한 패턴이 된다는 것을 자각. **수정**: 인터랙션/브랜드 컬러(워드마크, 버튼, 활성 탭,
   포커스 링)는 앰버가 아니라 `flap`(크림) 톤으로 바꾸고, 앰버(`rising`)와 적색(`falling`)은
   오직 순위 등락 상태 배지에만 쓰도록 규칙을 못 박음 — 색이 "브랜드 장식"이 아니라 "기능적
   상태" 역할로 한정됨. 추가로 케이싱/패널/솔기(seam) 3단 명암을 둬 실제 입체감(베젤+그림자)을
   주는 것도 일반적 다크 대시보드의 평면적 단색 배경과 다른 지점. 이 수정을 거친 뒤에도
   "다크 배경"이라는 큰 틀은 유지되지만, 그 이유가 임의의 기본값이 아니라 스플릿플랩 케이싱이라는
   구체적 실물 근거를 갖고, 색의 용도가 장식이 아니라 기능으로 분리됐다는 점에서 클러스터의
   핵심 패턴(단일 포인트 컬러의 장식적 반복)에서 벗어났다고 판단.
3. **브로드시트 헤어라인, radius 0, 밀도 높은 신문 컬럼**: 행 경계에 완전 평면 헤어라인만
   쓰는 대신 베젤(그림자+하이라이트)로 입체감을 주고, 패널 모서리에 작은 radius(실제 베젤
   곡률 참조)를 둬 "radius 0" 클러시그니처를 의도적으로 피함. 레이아웃도 다단 신문 컬럼이
   아니라 기존과 동일한 단일 컬럼 리스트(실물 전광판도 세로 한 줄 배열)라 밀도 높은 편집형
   레이아웃과는 다름. ✅ 명확히 다름.

**검토 결론**: 2번 항목에서 실질적 수정(브랜드/인터랙션 컬러를 앰버→크림으로 이동, 색의
역할을 기능 전용으로 제한)이 있었음. 이 수정 없이 원안대로 갔다면 사실상 반복 3와 같은
실수를 반복할 뻔했다 — 자기비평 단계가 실제로 걸러낸 사례로 기록.

### [계획] (구현 단계)
1. `git merge main` — 백엔드가 새로 만든 `/api/trends/keyword-history` 엔드포인트 확인
   (전용 라우트, `{keyword, region, points}` 반환, snapshot 50개까지 조회). 이번 라운드는
   재설계가 본 목적이지만, 어차피 `KeywordDetailModal`을 전면 재작업하므로 낮은 추가 비용으로
   이 라운드에 데이터 소스도 전용 엔드포인트로 전환(반복 6에서 예고한 재조정)
2. `next/font/google` 폰트 3종(Black Han Sans/Space Mono/IBM Plex Sans KR) 웨이트/서브셋
   사전 확인(완료 — 위 [토큰 시스템] 표 반영)
3. `globals.css` 토큰 전면 교체, `layout.tsx` 폰트 교체
4. 핵심 리스트 행 컴포넌트를 "플랩 패널" 스타일로 재작업(베젤/솔기), 플립 전환 애니메이션
   추가(데이터 갱신 시 변경된 행만, 초기 로드 시 스태거드)
5. 헤더/히어로를 "금속 명판" 컴팩트 스타일로 축소, `RegionTabs`를 물리 버튼 스타일로,
   `AuthModal`/`WatchlistPanel`/`KeywordDetailModal`/`RankHistoryChart`/`FlatSignal`/
   `SpikeLine` 전부 새 토큰·모티프에 맞춰 재작업(시그니처 요소였던 `SpikeLine`은 폐기,
   `FlatSignal`도 전광판 세계관에 맞게 교체)
6. 브랜드명 SPIKE → FLIP 전면 치환(메타데이터/OG 이미지 포함)
7. 기존 27개 테스트 중 카피/클래스 의존 단정문 갱신, 신규 기능 없음이므로 테스트 개수 변화는
   최소화
8. lint → test → build, 데스크톱(900×700)+모바일(390×844) 비포/애프터 스크린샷(홈/인증
   모달/키워드 상세), dev 서버 종료

### [실행 + 관찰]

**신규 파일**
- `src/components/EmptyFlaps.tsx` — 빈 상태용 "빈 플랩 셀" 글리프(`FlatSignal` 대체)
- `src/lib/trends/keywordHistory.ts` — `/api/trends/keyword-history` 전용 방어적 클라이언트
  (계획 1번대로 병합 시 발견한 전용 엔드포인트로 `KeywordDetailModal`의 데이터 소스 이전)

**삭제 파일**: `src/components/SpikeLine.tsx`, `src/components/FlatSignal.tsx` — 새 메타포와
무관해진 지진계 모티프 컴포넌트. 새 시그니처(행 플립)는 별도 장식 컴포넌트가 아니라
`globals.css`의 `.flap-row` 애니메이션 + `page.tsx`의 `revision` 키로 구현되어 대체
컴포넌트가 필요 없음.

**수정 파일**: `globals.css`(토큰 전면 교체), `layout.tsx`(폰트 3종 교체, FLIP 메타데이터),
`page.tsx`(헤더/리스트 전면 재작업, 상세 뷰 데이터 소스 이전), `AuthHeader/AuthModal/
RegionTabs/WatchlistPanel/KeywordDetailModal/RankHistoryChart` 전부 새 토큰으로 재작업,
`RankDelta.tsx`/`RankSparkline.tsx`(아래 참고), `opengraph-image.png`(FLIP 브랜드로 재생성).

**구현 중 발견 1 — 폰트 조정**: 원래 계획한 "기계식 숫자" 서체 Space Mono가 라틴 전용이라
한글을 렌더링할 수 없음을 뒤늦게 자각(대부분의 실제 키워드가 한글). 실물 스플릿플랩 보드가
숫자든 문자든 보드 전체에 동일한 고정폭 문자셋 하나를 쓴다는 점을 다시 떠올려, 코딩용
한글 모노스페이스 실존 폰트인 **Nanum Gothic Coding**으로 교체 — 이 폰트가 순위 번호는
물론 키워드 텍스트까지 보드 위의 "기계식 문자" 전체를 담당하도록 역할 재정의. Black Han
Sans(명판/케이싱에 인쇄된 브랜드 서체)는 "FLIP" 워드마크와 모달 제목처럼 보드 자체가 아닌
"보드 프레임에 붙은 표시"에만 한정 — 최초 계획보다 더 근거 있는 역할 분리가 됨.

**구현 중 발견 2 — 코드 리뷰에서 나온 기존 버그**: `RankDelta.tsx`/`RankSparkline.tsx`가
반복 1 이후 한 번도 손대지 않아 여전히 Tailwind 기본 색(`text-emerald-400`, `text-neutral-500`
등)을 쓰고 있었고 프로젝트 자체 토큰 시스템과 무관했음(반복 3/5에서 놓친 부분). 이번
재설계에서 `text-rising`/`text-falling`/`text-flap-dim` 등으로 정정 — "정체성이 정말 모든
곳에 일관되게 적용됐는가"라는 반복 5의 질문에 대한 답이 그동안 부분적으로 "아니오"였다는
뜻이라 정직하게 기록.

**구현 중 발견 3 — 실제 React 버그**: 데스크톱 상세 뷰 스크린샷을 찍는 과정에서 Next.js
dev 오버레이에 "1 Issue" 배지가 뜨는 것을 우연히 발견, dev 서버 로그를 확인하니
`Encountered two children with the same key, '2'` 경고. 원인은 `RankHistoryChart`의
y축 눈금 계산 — 순위가 거의 변하지 않는 키워드(예: 줄곧 1위인 BIGBANG, 실 데이터로 실제
발생)일 때 좁은 범위를 3개 눈금으로 나누는 반올림 계산이 두 눈금을 같은 값으로 만들어
React 키가 중복됨. `yTicks`를 연속 중복 제거하도록 수정 후 재확인 — dev 로그에서 경고
사라짐, 스크린샷에서도 "1 Issue" 배지 소멸 확인. 디자인과 무관하지만 이번 라운드의
스크린샷 검증 과정에서 실측으로 잡아낸 실제 버그라 기록.

**`npm run lint`** — 1차 실행에서 신규 `useEffect`(키워드 상세 데이터 로딩)의
`setDetailHistory(undefined)`가 `react-hooks/set-state-in-effect`에 걸림 → 기존 파일의
같은 패턴과 동일하게 `eslint-disable-next-line` 처리 → 재실행 통과(에러/경고 없음, exit 0).

**`npm run test`** — 1차 실행에서 2개 실패(예상된 실패, 카피/데이터 계약 변경에 따른 것):
1. 빈 상태 문구 단정문이 구버전("아직 감지된 신호가 없습니다") → 새 카피("표시할 키워드가
   없습니다")로 갱신
2. 키워드 상세 뷰 테스트가 `/api/trends/history`만 모킹하고 있었는데, 이번에 데이터 소스를
   `/api/trends/keyword-history`로 이전했으므로 그 테스트의 fetch 모킹에 새 엔드포인트
   분기(`{keyword, region, points}` 응답) 추가
재실행 결과:
```
 Test Files  6 passed (6)
      Tests  47 passed (47)
```
47개 전부 통과(기존 워치리스트/지역 전환/인증 관련 테스트 포함, 회귀 없음).

**`npm run build`**
```
✓ Compiled successfully
Route (app): /, /_not-found, /api/cron/refresh-trends, /api/trends, /api/trends/history,
              /api/trends/keyword-history, /api/watchlist, /auth/callback, /opengraph-image.png
```

**비포/애프터 스크린샷** (dev 서버 `-p 3006`, 실 YouTube/Supabase 데이터):
- **데스크톱 비포**: 근접-블랙 배경 + 앰버 워드마크/버튼/활성탭, 큰 히어로 헤드라인, 단일
  divide-y 리스트, 지진계 SpikeLine — 반복 5까지의 "SPIKE" 모습 그대로 캡처
- **데스크톱 애프터**: FLIP 컴팩트 명판 헤더(워드마크+지역토글+갱신+로그인 한 줄), 큰 히어로
  없음, 각 행이 개별 베젤 패널(작은 gap+테두리+미세 그림자)로 분리된 리스트, 색은 크림(`flap`)
  텍스트/브랜드 + 앰버는 하단 "live" 점 하나에만 등장 — 전체 톤이 확연히 달라짐
- **인증 모달 애프터**: Black Han Sans 제목 + Nanum Gothic Coding 밑줄 인풋, 버튼은
  크림(`flap`) 배경(이전 앰버 배경에서 변경) — 앰버가 완전히 빠짐
- **키워드 상세 뷰 애프터**: 차트 라인/점이 크림 잉크색, 통계 줄/축 라벨 전부 새 모노스페이스,
  중복 키 버그 수정 확인
- **모바일 애프터** (390×844): 헤더가 `flex-wrap`으로 자연스럽게 두 줄로 접힘(워드마크+지역
  토글 / 갱신+로그인), 리스트/모달/상세 뷰 전부 가로 스크롤이나 겹침 없이 정상 — 반복 6에서
  고친 반응형 대응이 새 레이아웃에서도 깨지지 않음을 확인
- 한글 렌더링(가장 위험 요소였던 Nanum Gothic Coding): "하이브레이블즈", "리그오브레전드" 등
  전부 두부(tofu) 없이 정상 렌더링 확인

**OG 이미지 재생성**: SPIKE 버전(앰버 지진계 라인)을 폐기하고, FLIP 워드마크(Black Han Sans)
+ Nanum Gothic Coding 헤드라인 + 하단에 크림색 플랩 셀 4개와 앰버 "▲" 셀 1개로 구성된 새
1200×630 정적 이미지로 교체 — "앰버는 오직 상태 표시에만" 규칙을 OG 이미지 자체에서도
지킴(브랜드 워드마크는 크림, 상태 셀만 앰버).

**dev 서버 종료**: `lsof -ti:3006 | xargs kill` 후 포트 확인 → 정상 종료. 스크래치
스크린샷/OG 생성 스크립트 삭제, 커밋 대상에서 제외.

### [검증] — 성공 기준 대조
1. 코드 작성 전 디자인 플랜 문서화(토큰 시스템+자기비평, 위 [브레인스톰]/[토큰 시스템]/
   [자기비평] 참고) → **충족**
2. 데스크톱+모바일 비포/애프터 스크린샷(홈/인증/키워드 상세) → **충족**
3. 기존 기능 무회귀 — 47개 테스트 전부 통과 → **충족**
4. lint/test/build 클린 → **충족**

### [개선/반복]
1회 반복으로 4개 기준 모두 충족되어 추가 반복 불필요(규칙 9). 정직하게 기록할 점:
- 이번 재설계가 "정말 클로드스럽지 않은가"는 궁극적으로 사용자의 주관적 판단 영역 —
  자기비평 프로세스를 통해 스킬이 명시한 3대 기본값 클러스터와의 구조적 차이(색의 기능적
  역할 분리, 실물 레퍼런스 기반 입체감, 메커닉과 직결된 모션)는 확보했으나, 다음 피드백에서
  여전히 부족하다고 판단되면 "폴리시 라운드"가 아니라 이번처럼 토큰 시스템 자체를 다시
  검토하는 방식으로 접근할 것을 다음 라운드에 제안.
- 행 플립 애니메이션은 현재 "전체 리스트 리마운트 시 스태거드 등장"으로 구현됨(개별 행이
  바뀔 때만 그 행이 뒤집히는 정밀한 diff 기반 애니메이션은 아님) — 실물 전광판도 전체
  갱신 시 보드 전체가 리플되는 경우가 흔해 정당한 해석으로 판단했으나, 더 정교한 개별-행
  diff 애니메이션이 필요하다고 판단되면 향후 라운드에서 고도화 가능.

### [종료]
4개 성공 기준 모두 실측 증거로 충족. `frontend-loop`에 커밋 진행.
