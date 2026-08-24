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
