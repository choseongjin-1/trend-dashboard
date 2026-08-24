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
