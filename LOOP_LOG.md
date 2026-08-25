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

---

## `0003_rate_limiting.sql` 라이브 적용 재검증

> 사용자가 SQL Editor에서 `0003_rate_limiting.sql`을 라이브 프로젝트에 실행 완료. 이전
> 라운드부터 이어진 미검증 항목("실 429 트리거") 재검증 — 0001/0002 때와 동일한 절차.

### [재검증 — 실측 증거]

**1차 시도(실패, 그대로 기록)**: `/api/trends`에 순차 35회 호출 → 전부 200, 429 없음.
서비스롤로 `rate_limit_counters` 테이블을 직접 조회해 원인 확인:
```
key: "trends:::1", window_start: "09:34:00", count: 7
key: "trends:::1", window_start: "09:35:00", count: 28
```
RPC 자체는 정상 동작(카운트가 정확히 누적됨) — 다만 순차 curl 호출이 실제 걸린 시간(호출당
왕복 지연) 때문에 분(윈도우) 경계를 넘어가며 7+28로 쪼개져 어느 쪽도 30을 넘지 못함. 이건
버그가 아니라 마이그레이션 파일에 이미 문서화해둔 고정 윈도우의 정확히 그 트레이드오프가
실제로 관측된 것.

**2차 시도(병렬 요청으로 윈도우 경계 문제 회피)**: 같은 1초 내에 도착하도록 40개 요청을
병렬로 발사:
```
$ date -u  → 09:35:47
(40개 병렬 curl)
결과: 429 × 38, 200 × 2
$ date -u  → 09:35:48
```
429 실측 성공. 응답 상세:
```
HTTP/1.1 429 Too Many Requests
retry-after: 6
x-ratelimit-limit: 30
x-ratelimit-remaining: 0
x-ratelimit-reset: 2026-08-24T09:36:00.000Z
content-type: application/json

{"error":"rate_limited","message":"Too many requests. Please slow down."}
```
`retry-after`(6초) 값이 실제 리셋 시각(09:36:00)까지 남은 시간과 정확히 일치.

**버킷 격리 검증(같은 윈도우 내에서 엄밀하게)**: 35회 재발사 후 `::1`이 429로 막힌 상태를
먼저 확인 → 그 직후 **같은 윈도우 안에서** `x-forwarded-for: 198.51.100.42`로 스푸핑한
요청은 200 → 그 직후 다시 `::1`(헤더 없음)은 여전히 429:
```
::1 (unmarked)                    -> HTTP 429
spoofed IP 198.51.100.42          -> HTTP 200   ← 다른 식별자는 독립적으로 허용됨
::1 (unmarked) again              -> HTTP 429   ← 원래 식별자는 여전히 차단 상태 유지
```
(참고: 처음엔 "다른 IP 테스트"와 "윈도우 롤오버"가 우연히 섞여 애매했던 1차 관측이 있었음 —
바로 이 2차 시도로 두 현상을 명확히 분리해 각각 독립적으로 재확인함.)

**윈도우 롤오버 검증**: 09:36:48에 확인 후 30초 대기(`sleep 30`) → 09:37:18(다음 윈도우
진입 후) 같은 `::1` 식별자로 재요청 → `HTTP 200` — 이전에 소진된 버킷이 새 윈도우에서
정상적으로 리셋됨.

**dev 로그 전체 스캔**: 이번 세션 동안 처리된 요청 117건(`grep -c "GET /api/trends"`) 중
`PGRST202`/`PGRST204`/`42703`/"rpc failed"/"Could not find the function" 매칭 **0건** —
RPC가 이제 라이브에 정상 존재함을 재확인. `/api/trends/history`도 독립 버킷으로 정상 동작
(`HTTP 200`) 확인. 서버 종료 후 포트 확인 → 정상 종료.

### [검증] — 남아있던 성공 기준 대조
1. `increment_rate_limit()` 라이브 존재 + 정상 작동 → **충족** (카운터 테이블 직접 조회로
   실측, RPC 에러 0건)
2. 실제로 429 트리거 → **충족** (병렬 40요청으로 429 38건 실측, 응답 바디/헤더 전부 정확)
3. 한도 초과 후 다른 식별자는 영향 없음 → **충족** (같은 윈도우 내 스푸핑 IP로 엄밀히 검증)
4. 윈도우 롤오버 후 재개 → **충족** (30초 대기 후 재요청 200 확인)

### [종료]
`0003_rate_limiting.sql` 라이브 적용 및 동작 완전히 검증됨. `supabase/migrations/APPLIED.md`에서
`0003`을 `applied`(2026-08-24)로 갱신. 이전 라운드부터 이어지던 마지막 미해결 항목 해소 —
현재 백엔드 트랙에 남은 블로커 없음.

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

---

## 통합 (merge) — `backend-loop` ← `frontend-loop` (FLIP 전면 재설계, `2ed0090`)

> `backend-loop`(HEAD `d71cc95`)에서 `git merge frontend-loop`(`2ed0090`) 실행. 이번엔
> 실제 배포(Vercel, `main` 푸시 시 자동 배포)로 이어지는 병합이라 평소보다 검증을 더 꼼꼼히
> 진행 — 오케스트레이터의 명시적 요청이기도 함.

### [충돌 및 해소]
- `LOOP_LOG.md`만 content 충돌. 이번엔 지난 라운드 같은 순서 어긋남 문제 없이, 공통 조상
  `b5a32a9`(1659줄)와 `ours`(`git show HEAD:...`)가 정확히 그 지점까지 동일함을 `diff`로
  먼저 확인한 뒤, `2ed0090`이 그 뒤에 추가한 구간(1660~1911행, "반복 7 — 프론트엔드" 252줄)만
  골라 이어붙임. 조인 지점을 직접 눈으로 확인 후 적용(지난 라운드의 실수를 반영해 이번엔
  임시 파일에 먼저 조립 → 마커 없음 확인 → 조인부 확인 → 실제 파일에 반영, 순서로 진행).
- 나머지는 전부 자동 병합: `page.tsx`, `page.test.tsx`, `layout.tsx`, `globals.css`,
  `opengraph-image.png`(신규 브랜드 이미지로 교체), `AuthHeader.tsx`/`AuthModal.tsx`/
  `RankDelta.tsx`/`RankHistoryChart.tsx`/`RankSparkline.tsx`/`RegionTabs.tsx`/
  `WatchlistPanel.tsx`/`KeywordDetailModal.tsx`(SPIKE→FLIP 스타일 갱신), `SpikeLine.tsx` 삭제
  + `EmptyFlaps.tsx` 신설(빈 상태 컴포넌트 개명), `src/lib/trends/keywordHistory.ts` 신설.
- **눈에 띄는 점**: `keywordHistory.ts`를 열어보니 프론트엔드가 이번 라운드 백엔드가 만든
  `GET /api/trends/keyword-history`를 실제로 채택했음(`fetchKeywordHistory` 함수가 정확히
  그 엔드포인트를 호출, 응답 스키마도 내가 정의한 `{keyword, region, points}`와 정확히
  일치) — 지난 라운드에 남겨둔 "향후 프론트엔드가 전용 엔드포인트로 전환할 수도 있다"는
  메모가 이번 라운드에 실현됨. 별도 계약 조정 불필요, 그대로 맞물림.

### [검증 — 통합 결과 실측, 평소보다 꼼꼼히]

```
npm run lint   → 빈 출력, exit 0
npm run test   → Test Files 6 passed (6), Tests 47 passed (47)  (전면 재설계인데도 테스트
                 개수 불변 — 프론트가 기존 테스트를 새 카피/마크업에 맞게 갱신했을 뿐 추가/삭제
                 없음, page.test.tsx 자체 diff로 확인 가능)
npm run build  → Compiled successfully, TypeScript 통과, 동일 9개 라우트(API 7개 + `/` +
                 `/opengraph-image.png`) 정상 생성, `ƒ Proxy (Middleware)` 정상
```

**`npm run dev -- -p 3001` + curl (실 크리덴셜)**

1) 홈페이지 렌더링 자체를 실측 검증(평소엔 API 라우트만 확인했지만 이번엔 전면 재설계라
   HTML도 직접 스캔):
```
GET / → HTTP 200, 84607 bytes
```
렌더된 HTML을 파이썬으로 파싱해 확인:
- "error"/"undefined is not"/"TypeError"/"ReferenceError" 등 실제 런타임 에러 패턴 → 매칭
  전부 Next.js 내장 에러 바운더리 보일러플레이트(`global-error.js`, `"error":"$undefined"`
  같은 placeholder)일 뿐, 실제 에러 스택트레이스 없음 → 정상
- "SPIKE" 문자열(대소문자 무관) → **0건** — 구 브랜드 완전히 제거됨
- "FLIP" 문자열 → `<title>`, OG/Twitter 메타, 워드마크 등 다수 확인 — 새 브랜드 정상 적용

2) API 라우트 8개 전부 실측:
```
GET  /api/trends?region=KR                                   → HTTP 200
GET  /api/trends/history?region=KR                           → HTTP 200
GET  /api/trends/keyword-history?keyword=BIGBANG&region=KR   → HTTP 200
GET  /auth/callback (code 없음)                                → HTTP 307
GET  /api/watchlist (세션 없음)                                 → HTTP 401
GET  /opengraph-image.png                                     → HTTP 200, `file` 명령으로
  실제 PNG(1200×630, 8-bit RGB) 확인
POST /api/cron/refresh-trends (secret 없음)                    → HTTP 401
POST /api/cron/refresh-trends (correct secret)                → HTTP 200
```

3) rate limiting이 병합 후에도 여전히 살아있는지 재확인(회귀 방지 차원): `/api/trends?region=US`
   35회 병렬 발사 → 200/429 혼재(윈도우 중간에 30 넘음) — 정상 동작 계속 확인.

4) **로그 전체 스캔**(이번 세션 전체 요청 대상, 평소보다 광범위하게): `error|warn|fail`
   패턴으로 검색 후 이미 알려진 클래스(`PGRST`, `rate_limited`, `checkRateLimit`, 401/429
   자체)를 제외하면 **0건**. 별도로 `GET |POST ` 라인 전부를 상태 코드로 재검사해 200/401/
   429/307 넷 중 하나가 아닌 로그 라인이 있는지 확인 → **0건**, 이번 세션에서 처리된 모든
   요청이 예상된 상태 코드로만 끝남. 서버 종료 후 포트 확인 → 정상 종료.

### [결론]
`2ed0090`(FLIP 전면 재설계) 반영 후 lint/test(47개, 불변)/build/dev 전 라우트 curl +
HTML 직접 스캔 + rate-limit 회귀 확인까지 전부 그린. 실제 배포로 이어지는 병합이라 평소보다
검증 범위를 넓혔음(HTML 파싱, 전체 로그 상태코드 재검사). `backend-loop`에 머지 커밋 후
`main`으로 병합·푸시 예정.

---

## 반복 — 백엔드 (다중 소스: Hacker News 추가)

> "인기 급상승 데이터"가 YouTube 전용이 아니라 진짜 다중 소스가 되어야 한다는 사용자 요청.
> 오케스트레이터가 대안 조사(네이버 실검은 서비스 종료, Google Trends는 공식 API 없음)를
> 마치고 Hacker News 공식 공개 API(무인증, 무료, 신규 크리덴셜 불필요)로 결정. `git merge main`
> → 이미 최신(변경 없음).

### [목표]
1. `TrendSource`에 `"hackernews"` 추가, `src/lib/trends/hackernews.ts`를 `youtube.ts`와
   같은 형태로 신설 — top stories 수집 → `TrendItem[]` 생성
2. 점수 정규화를 신중하게 해결 — YouTube 조회수와 HN 포인트는 스케일이 완전히 다름. raw
   magnitude로 이어붙여 정렬하면 한쪽이 항상 지배함. 공정한 블렌딩 방식(소스 내부 랭크
   퍼센타일 정규화) 채택 + 근거와 기각한 대안을 로그에 기록
3. 지역 모델과의 매핑을 의도적으로 결정(HN은 본질적으로 글로벌/영어권이라 "지역" 개념이 없음)
4. cron 수집, DB-우선 `/api/trends` 경로, `trend_snapshots` 영속화 모두 다중 소스 스냅샷을
   올바르게 처리 — 스냅샷의 `items`가 이제 블렌드를 담을 수 있고, 아이템별 `source`가 올바르게
   출처를 표시
5. 기존 테스트 갱신/확장, 전부 통과. lint/build 클린
6. 실 검증: `/api/trends`를 curl해 아이템에 `source: "youtube"`와 `source: "hackernews"`가
   진짜로 섞여 있음을 확인(한쪽만 있는 게 아니라)

### [계획]
1. **점수 정규화 설계 결정** — 기각한 대안: 두 소스를 그냥 이어붙이고 raw `score`로 정렬.
   YouTube 조회수(수십만~수백만)와 HN 포인트(수십~수천)는 단위 자체가 다른데, raw 정렬은
   YouTube가 항상 모든 슬롯을 차지하게 만듦 — 그날 HN에서 가장 좋은 글이라도 절대 노출되지
   않음. **채택한 방식**: 소스 내부 랭크 퍼센타일 정규화. 각 소스에서 이미 매겨진 순위 r(전체
   n개 중)을 `(n - r + 1) / n`으로 변환 — YouTube 1위와 HN 1위가 똑같이 1.0이 됨. 절대
   크기가 아니라 "자기 소스 내에서 얼마나 잘했는가"로 경쟁시킴. 동점(퍼센타일 완전히 같음)은
   안정 정렬로 입력 순서(youtube가 먼저 나열됨)가 이김 — 결정론적, 무작위 아님.
2. **지역 매핑 설계 결정** — HN은 지역 개념이 없는 단일 글로벌 피드. 특정 지역에만 노출하면
   자의적 결정이 됨(왜 US에만? 왜 KR엔 없어?). **채택**: 모든 지역에 동일한 HN 결과를
   동등하게 블렌드 — KR/US/JP가 정확히 같은 HN 아이템을 받되, YouTube 부분만 지역별로 다름.
   이건 "가짜 현지화"보다 정직한 선택이라 판단(실제로 지역화되지 않은 걸 지역화된 것처럼
   보이지 않게 함).
3. `TrendSource`에 `"hackernews"` 추가, `TrendsResponse.source: TrendSource`(단일) →
   `sources: TrendSource[]`(배열)로 변경 — 블렌드된 응답에 "단일 출처"라는 필드는 이제
   의미가 없고, 아이템별 `source`가 실제 귀속을 담당하므로 최상위 필드는 "이 응답에 블렌드된
   소스 목록" 메타데이터로 재정의. `grep`으로 프론트엔드가 `data.source`(최상위)를 직접
   읽는 곳이 있는지 먼저 확인 — 없음을 확인(있는 건 `history.ts`의 로우 레벨 `source: string`
   타입가드뿐인데 이건 여전히 `typeof === "string"`만 검사해 값 포맷 변경에 영향 안 받음).
4. `src/lib/trends/hackernews.ts` 신설 — `aggregateHackerNewsItems`(순수 함수,
   `youtube.ts`의 `aggregateTrendItems`와 동일한 패턴: 네트워크/env 의존 없음, fixture로
   테스트 가능) + `fetchHackerNewsItems()`(네트워크: `topstories.json` → 상위 30개
   `item/{id}.json` 병렬 조회 → 집계). HN은 무인증 무료 API라 YouTube처럼 "키 없으면 mock"
   분기가 없음 — 항상 실 fetch를 시도. 개별 스토리 조회 실패는 배치 전체를 실패시키지 않고
   그 스토리만 제외(부분 성능 저하), `topstories.json` 자체 실패나 전체 조회 실패 시에만 throw
5. `src/lib/trends/blend.ts` 신설 — `blendTrendItems(sourceLists, limit)` 순수 함수, 위
   1번의 퍼센타일 로직 구현
6. `src/lib/trends/ingest.ts` 신설 — `buildTrendsResponse(region)`: 두 소스를
   `Promise.all`로 병렬 fetch(각각 실패 시 자체적으로 mock으로 폴백, 절대 throw 안 함) →
   블렌드 → 최종 `TrendsResponse` 조립. `mocked`는 **OR**(소스 중 하나라도 mock이면 전체
   `mocked: true`) — 일부만 가짜인데 "진짜"라고 표시하는 것보다 정직한 신호가 우선이라 판단
7. `src/lib/trends/youtube.ts`: `fetchYoutubeTrends(region): TrendsResponse` →
   `fetchYoutubeItems(region): TrendItem[]`로 개명/축소 — 이제 응답 조립은 `ingest.ts`가
   전담하므로 소스별 fetcher는 아이템만 반환하면 됨. `aggregateTrendItems`(순수 함수)는 무변경
   — `youtube.test.ts`가 그것만 테스트해서 안전
8. `src/lib/trends/mock.ts`: `getMockTrends(region): TrendsResponse`(단일 응답 전체) →
   `getMockYoutubeItems()`/`getMockHackerNewsItems()`(소스별 순수 아이템 배열)로 분리
9. `src/lib/trends/persist.ts`: `source text not null` 컬럼을 스키마 변경 없이 재활용 —
   `serializeSources(sources)`가 콤마 조인 문자열로 저장(`"youtube,hackernews"`),
   `parseSources(value)`가 다시 배열로 파싱. 기존에 이미 저장된 단일 소스 행("youtube")도
   콤마 없이 그대로 스플릿하면 1개짜리 배열이 되어 무중단 하위호환 — **이번 라운드는 새
   마이그레이션이 전혀 필요 없음**(라이브 DB 승인 대기 없이 오늘 바로 배포 가능)
10. `/api/trends/route.ts`, cron route 둘 다 `buildTrendsResponse(region)` 호출로
    단순화 — 각 라우트에 중복돼 있던 mock-폴백/try-catch 로직이 `ingest.ts`로 집중되어
    라우트 코드 자체가 더 짧아짐(리팩터링이자 기능 추가)
11. 신규 유닛 테스트: `hackernews.test.ts`(5개), `blend.test.ts`(5개, 특히 "raw magnitude가
    이겨서는 안 된다"를 실측 스케일 차이로 직접 증명하는 테스트 포함), `ingest.test.ts`(5개,
    소스별 fetch/mock-폴백/OR-mocked 로직을 모킹으로 검증), `persist.test.ts`에 소스
    직렬화 왕복 테스트 4개 추가
12. `npm run lint/test/build` → dev 서버 + 실 크리덴셜로 cron 강제 갱신 후 `/api/trends`
    curl해 진짜 블렌드 확인, 지역별 HN 동일성/YouTube 지역별 차이 확인

### [실행 + 관찰]

**신규 파일**
- `src/lib/trends/hackernews.ts`, `hackernews.test.ts`
- `src/lib/trends/blend.ts`, `blend.test.ts`
- `src/lib/trends/ingest.ts`, `ingest.test.ts`

**수정 파일**
- `src/lib/trends/types.ts` — `TrendSource`에 `"hackernews"` 추가, `TrendsResponse.source`
  → `sources: TrendSource[]`
- `src/lib/trends/mock.ts` — 소스별 순수 아이템 생성 함수로 재작성
- `src/lib/trends/youtube.ts` — `fetchYoutubeTrends` → `fetchYoutubeItems`, 반환 타입
  `TrendsResponse` → `TrendItem[]`
- `src/lib/trends/persist.ts` — `serializeSources`/`parseSources` 추가(export, 순수 함수),
  insert/read 경로에 적용
- `src/app/api/trends/route.ts`, `src/app/api/cron/refresh-trends/route.ts` —
  `buildTrendsResponse` 사용으로 단순화

**예상치 못했던 빌드 실패 → 최소 수정**: `npm run build`가 `src/app/page.test.tsx(33,3)`에서
타입 에러로 실패 — 프론트엔드 테스트 픽스처가 옛 `TrendsResponse` 스키마(`source: "youtube"`
단일 필드)를 하드코딩하고 있었음. 이건 이번 라운드가 만든 계약 변경(`source`→`sources`)의
직접적 결과이고, `history.ts`/`watchlist.ts` 때처럼 "다음 프론트 라운드가 알아서 조정"하기엔
지금 이 워크트리 자체의 `npm run build`가 막혀 성공 기준 5("lint/build 클린")를 충족할 수
없었음. 프론트엔드 영역을 원칙적으로 건드리지 않는다는 관례와, 성공 기준을 실제로 충족해야
한다는 요구 사이에서, **1줄짜리 순수 기계적 수정**(`source: "youtube"` →
`sources: ["youtube"]`, `page.test.tsx:33`)이라 직접 고침 — 디자인/UX 판단이 필요한 변경이
아니라 타입 시그니처만 맞추는 것이었기 때문. 수정 후 `npm run build`/`npm run test` 재실행해
회귀 없음 확인. 오케스트레이터에게 명확히 보고 필요(아래 참고).

**`npm run lint`** → 빈 출력, exit 0

**`npm run test`**
```
Test Files  9 passed (9)
     Tests  66 passed (66)
```
47(기존) + 19(신규: hackernews 5 + blend 5 + ingest 5 + persist 소스 직렬화 4) = 66

**`npm run build`** → (픽스처 수정 후) 클린, 동일 9개 라우트 정상 생성

**dev 서버(`:3001`, 실 크리덴셜) 실측 — cron 강제 갱신 후 확인**
```
POST /api/cron/refresh-trends → 3개 지역 전부 mocked:false, sources:["youtube","hackernews"]
```
`/api/trends?region=KR` 실제 응답의 아이템 20개를 순위대로 나열:
```
rank 1  [youtube   ]  score=1097614   HYBE
rank 2  [hackernews]  score=999       How Europe is killing makers and micro-entrepreneurs
rank 3  [youtube   ]  score=1097614   HYBE LABELS
rank 4  [hackernews]  score=684       Xiaomi: New CPU matches Apple cores...
... (youtube/hackernews가 정확히 번갈아 나타남, rank 20까지) ...
```
YouTube 점수가 백만 단위, HN 점수가 수백 단위인데도 두 소스가 깨끗하게 인터리브됨 —
퍼센타일 블렌딩이 실 데이터로도 의도대로 동작함을 실측으로 증명(라운드 계획에서 세운
가설이 실제 프로덕션 데이터로 재현됨).

**지역 매핑 결정 실측 검증**: KR/US/JP 3개 지역의 HN 아이템 상위 3개를 비교 → **완전히
동일**("How Europe is killing makers...", "Xiaomi: New CPU...", "MS Paint and Photos..."
순서까지 동일). YouTube 아이템은 지역별로 다름(KR은 한국어 콘텐츠, US는 "GTA 6 Build
Leak" 등 영어권 콘텐츠) — 설계 의도(HN 글로벌 공유, YouTube 지역별)가 실제로 그렇게
동작함을 확인.

**`/api/trends/history?region=KR&limit=1`**: 저장된 로우의 `source` 컬럼이 실제로
`"youtube,hackernews"`(콤마 조인 문자열)로 저장되어 있음을 확인, `mocked:false`,
`items`의 소스 집합이 `{hackernews, youtube}` — 새 마이그레이션 없이 기존 컬럼 재활용이
실제로 동작함을 라이브 DB에서 확인.

**`/api/trends/keyword-history?keyword=HYBE&region=KR`**: 기존 라우트도 무변경으로 정상
동작(YouTube 키워드의 히스토리 포인트 정상 반환) — 다중 소스 도입이 기존 기능을 깨지
않음을 확인.

**기타 라우트 회귀 확인**: `/`(200), `/api/watchlist`(401), `/auth/callback`(307) 전부
정상. dev 로그에 이미 알려진 클래스(`PGRST`, `rate_limited`) 외 예상 밖 에러 없음. 서버
종료 후 포트 확인 → 정상 종료.

### [검증] — 성공 기준 대조
1. `TrendSource`에 `"hackernews"` 추가, `hackernews.ts`가 `youtube.ts`와 동일한 형태로
   신설 → **충족**
2. 점수 정규화(랭크 퍼센타일) + 근거/기각 대안 로그 기록 → **충족**, 실 데이터로 인터리브
   실측 확인
3. 지역 매핑 의도적 결정(HN 글로벌 공유) + 로그 기록 → **충족**, 3개 지역 HN 동일성 실측
   확인
4. cron/DB-우선/영속화 모두 다중 소스 스냅샷 정상 처리, 아이템별 `source` 정확한 귀속 →
   **충족**, 새 마이그레이션 불필요(기존 컬럼 재활용) 확인
5. 기존 테스트 갱신/확장 66개 전부 통과, lint/build 클린 → **충족**(프론트 픽스처 1줄
   수정 포함, 아래 참고에 명시)
6. 실 curl로 `source: "youtube"`/`"hackernews"` 진짜 혼재 확인 → **충족**, rank 1~20까지
   정확히 번갈아 나타남을 실측

### [개선/반복]
1회 반복으로 6개 성공 기준 모두 실측 충족. 추가 반복 불필요(규칙 9).

### [종료]
6개 성공 기준 전부 실측 증거로 충족, 새 마이그레이션 없이 오늘 바로 배포 가능한 상태.
**오케스트레이터에게 명시적으로 알릴 것**: 이번 라운드가 공유 타입 `TrendsResponse`의
최상위 `source` 필드를 `sources`(배열)로 바꾸는 하위호환 깨지는 변경을 포함 — 빌드를
그린으로 유지하기 위해 `page.test.tsx`의 픽스처 1줄을 직접 고쳤음(디자인 판단 아닌 기계적
타입 수정). 프론트엔드가 최상위 `data.source`를 직접 읽는 곳은 없음을 grep으로 사전
확인했으나, 프론트 트랙이 이 필드명 변경을 알고 있어야 향후 자체 작업에서 참고 가능.

## 반복 8 — 프론트엔드 (소스 중립 카피)

### [배경]
사용자가 제품을 "YouTube 대시보드"가 아니라 일반적인 "인기 급상승 데이터" 서비스로
포지셔닝하길 원함. 백엔드 트랙이 이번 라운드에 병행으로 두 번째 실 소스(Hacker News,
공식 공개 API, 신규 크리덴셜 불필요)를 추가하는 중이라 이 카피 변경은 조만간 문자 그대로
사실이 됨 — "선제적" 카피가 아니라 곧 정확해질 카피.

### [목표]
1. "YouTube"를 유일/정의적 소스처럼 명시하는 사용자向 카피를 전부 찾아 일반화(서브헤드라인,
   목업 데이터 배너, 메타 설명/OG 카피 등) — FLIP 보이스는 유지하되 곧 거짓이 될 독점적
   주장만 제거
2. `TrendItem`이 이미 `source` 필드를 갖고 있고 곧 `"youtube"` 외 실제 값이 들어올 예정이므로,
   랭킹 리스트에 항목별 소스 표기(은은한 배지, 장식 아님)를 추가하는 게 정직성/가치에
   도움되는지 판단 — 이번 라운드에 하거나 후속으로 미루거나는 재량, 다만 멀티소스 데이터가
   실제로 흐르기 시작하면 출처를 숨기거나 잘못 표기하지 않을 것
3. 카피 변경에 맞춰 기존 테스트 갱신, 전부 통과. lint/build 클린
4. 스크린샷으로 카피가 자연스럽게 읽히는지(제네릭한 AI 카피처럼 보이지 않는지) 확인

### [계획]
1. `git merge main` — 백엔드의 rate-limit 검증/APPLIED.md 갱신만 있어 충돌 없이 fast-forward
2. `grep -rn "YouTube\|유튜브\|youtube"`로 전체 소스 스캔 후, 사용자向 카피(프론트엔드)와
   백엔드 구현 세부사항(API 라우트/코드 주석/`youtube.ts`/`mock.ts`의 `source: "youtube"`
   데이터 값)을 구분 — 후자는 이번 라운드 범위 밖(카피가 아니고, `src/app/api/**`는 항상
   백엔드 영역)이라 손대지 않음
3. 실제로 고칠 곳 3곳 확정: `page.tsx` 서브헤드라인, `page.tsx` 목업 배너 문구(구체적 env
   var 이름 `YOUTUBE_API_KEY`까지 언급하고 있어 이것도 함께 제거 — 특정 크리덴셜 이름을
   사용자 화면에 노출하는 것 자체가 애초에 좋은 관행이 아니었음), `layout.tsx`의
   meta description — 전부 "YouTube " 접두어만 제거하는 최소 수술적 편집으로 처리(나머지
   문장은 이미 소스 중립적이었음)
4. `src/lib/trends/sourceLabel.ts` 신설 — `source` 값을 사람이 읽을 라벨로 변환(알려진
   값은 지정 라벨, 모르는 값은 title-case 폴백 — 백엔드가 실제로 어떤 문자열을 쓸지
   모르므로 방어적으로)
5. `page.tsx`에 `hasMultipleSources` 계산(현재 로드된 항목들의 `source` 집합 크기 > 1) 후
   그 조건에서만 행별로 작은 소스 배지 렌더링 — 오늘처럼 소스가 하나뿐일 때 20개 행 전부에
   "YouTube"를 반복 표시하는 잡음을 피하면서, 멀티소스가 실제로 섞이는 순간 자동으로 켜져
   과제 3번 기준("숨기거나 잘못 표기하지 않을 것")을 정확히 만족
6. OG 이미지(`opengraph-image.png`)에도 같은 태그라인이 박혀 있어 재생성 필요
7. 신규/변경 테스트, lint → test → build, 스크린샷 확인

### [실행 + 관찰]

**신규 파일**: `src/lib/trends/sourceLabel.ts` + `sourceLabel.test.ts`(알려진 값/하이픈·언더스코어
포함 미지 값 title-case 폴백 3케이스)

**수정 파일**:
- `src/app/page.tsx` — 서브헤드라인("YouTube 인기 급상승 신호를..." → "인기 급상승 신호를...").
  목업 배너("YOUTUBE_API_KEY를 설정하면..." → "실제 데이터가 연결되면 자동으로 전환됩니다").
  `hasMultipleSources` 계산 + 행별 소스 배지(조건부, `flap-dim` 톤의 작은 아웃라인 태그,
  키워드 버튼 바로 뒤에 배치해 브랜드 컬러(`flap`)나 상태 컬러(`rising`/`falling`)를 침범하지
  않도록 함 — 반복 7의 "색은 오직 기능적 역할에만" 규칙을 새 배지에도 그대로 적용)
- `src/app/layout.tsx` — meta description에서 "YouTube " 제거
- `src/app/opengraph-image.png` — 같은 태그라인 변경 반영해 1200×630 재생성(Black Han
  Sans/Nanum Gothic Coding/앰버 단일 상태 셀 등 반복 7의 브랜드 톤 그대로 유지, 문구만 교체)
- `src/app/page.test.tsx` — 신규 3개 테스트: (a) 렌더링된 페이지 어디에도 "YouTube"라는
  단어가 없음을 확인(카피 회귀 방지), (b) 단일 소스일 때 소스 배지가 전혀 안 보임(잡음 없음
  확인), (c) 혼합 소스(`youtube`+`hackernews` 목업)일 때 각 행에 올바른 라벨("YouTube",
  "Hackernews")이 뜸

**`npm run lint`** — 통과(에러/경고 없음, exit 0).

**`npm run test`**
```
 Test Files  7 passed (7)
      Tests  52 passed (52)
```
52개 전부 통과(기존 47개 + 신규 3개 카피/소스배지 테스트 + `sourceLabel.test.ts` 2개).
기존 테스트 중 이번 카피 변경으로 깨진 것은 없었음(어떤 기존 단정문도 "YouTube" 특정
문구에 의존하지 않았음).

**`npm run build`**
```
✓ Compiled successfully
Route (app): / 외 기존 8라우트 그대로, 신규 라우트 없음(카피/데이터 표시 변경뿐)
```

**스크린샷 확인** (dev 서버 `-p 3006`, 실 YouTube 데이터 — 아직 백엔드의 두 번째 소스가
병합 전이라 실측은 여전히 단일 소스): 헤더 아래 서브헤드라인이 "인기 급상승 신호를
실시간으로 감지하는 키워드 보드"로 자연스럽게 읽힘 — "YouTube"가 빠진 자리가 어색하거나
잘려 보이지 않고, 문장 자체가 원래도 플랫폼 이름 없이 완결된 구조였어서 편집이 매끄러움.
실 데이터가 단일 소스라 소스 배지는 화면에 보이지 않음(의도된 동작, `hasMultipleSources`
로직대로) — 혼합 소스 렌더링은 위 신규 테스트로 확인.

**dev 서버 종료**: `lsof -ti:3006 | xargs kill` 후 포트 확인 → 정상 종료.

### [검증] — 성공 기준 대조
1. YouTube 전용 카피 3곳(서브헤드라인/목업 배너/meta description) + OG 이미지 전부 일반화,
   FLIP 보이스 유지(스크린샷으로 자연스러움 확인) → **충족**
2. 항목별 소스 배지 추가, 단일 소스 시 숨김·멀티소스 시 자동 노출(테스트로 양쪽 확인) →
   **충족**("이번 라운드에 함" 선택)
3. 신규 테스트 포함 52개 전부 통과 → **충족**
4. lint/build 클린 + 스크린샷으로 카피 자연스러움 확인 → **충족**

### [개선/반복]
1회 반복으로 4개 기준 모두 충족되어 추가 반복 불필요(규칙 9). 정직하게 기록할 점: 실제
두 번째 소스(Hacker News)가 아직 `main`에 병합되지 않아 혼합 소스 배지의 실 데이터 검증은
목업 테스트로만 확인됨 — 백엔드 병합 후 실측 스크린샷으로 재확인 권장.

### [종료]
4개 성공 기준 모두 실측 증거로 충족. `frontend-loop`에 커밋 진행.

## 반복 9 — 프론트엔드 (라이트 테마 — 토큰 반전이 아니라 재설계)

### [배경]
사용자가 전체 UI를 라이트/화이트 느낌으로 바꾸길 원함. 오케스트레이터가 명시적으로 경고한
함정: 기존 다크 토큰을 기계적으로 반전(배경 근접-블랙→근접-화이트, 텍스트 크림→잉크)만
하면 스킬이 경계하는 3대 기본값 중 정확히 다른 하나 — "따뜻한 크림 배경(#F4F1EA 근접) +
하이컨트라스트 세리프 + 테라코타 포인트" — 로 착지할 위험이 있음. 반복 7(SPIKE→FLIP)과
동일한 무게로, 브레인스톰부터 다시 하라는 지시.

### [핵심 질문] FLIP의 스플릿플랩 콘셉트가 라이트 테마에서도 성립하는가?
정직하게 검토: **실물 공항/기차역 스플릿플랩 전광판(Solari board)은 물리적으로 거의 항상
어두운 케이싱이다** — 개별 플랩이 젖혀지는 슬롯 뒤로 어두운 배경이 있어야 플랩 글자가
또렷하게 도드라지기 때문(CRT 인광 디스플레이나 극장 전광판이 어두운 배경에 밝은 글자를
쓰는 것과 같은 물리적 이유). "밝은 케이싱의 스플릿플랩 전광판"은 사실상 존재하지 않는
물건을 지어내는 것이므로, 색만 뒤집으면 반복 7에서 확보한 "실물에 근거한 디자인"이라는
전제 자체가 깨진다.

**그러나** 스플릿플랩 메커니즘 자체가 다크에만 묶여있는 것은 아니다 — 같은 메커니즘 계열의
**소비자용 데스크톱 플립 시계/플립 캘린더**(1960~70년대 아이보리색 플라스틱 하우징에
흰 카드 위 검정 잉크 숫자가 찍힌 형태)는 실제로 흔히 밝은 색이다. 공항용 산업 규모
전광판과 달리, 이 데스크톱 오브젝트는 원래부터 크림/아이보리 플라스틱 + 흰 카드 + 검정
잉크라는 조합이 실물 표준이다. 즉, "같은 것을 반전"이 아니라 **스플릿플랩 계열 안에서
원래부터 밝은, 실존하는 다른 오브젝트(산업용 공항 보드 → 소비자용 플립 시계/캘린더)로
레퍼런스 자체를 교체**하는 것이 정직한 해법이라고 판단. "FLIP"이라는 이름과 뒤집기
모션(핵심 메커니즘)은 유지되지만, 물리적 근거가 되는 실물 오브젝트와 그에 따른 재질감
(플라스틱 하우징, 인쇄된 카드, 잉크 색)은 새로 브레인스톰함.

### [토큰 시스템]

**색상 (6개, 명명) — 실물 잉크/플라스틱 레퍼런스, 테라코타 클러스터와 명확히 구분**:
| 이름 | 헥스 | 역할 |
|---|---|---|
| `paper` | `#EFEAE0` | 페이지 배경 — 아이보리 플라스틱 하우징(따뜻하지만 #F4F1EA보다 채도 낮고 회색 쪽에 가까운 "오래된 플라스틱" 톤, "장인 종이" 느낌 배제) |
| `casing` | `#E1D9C8` | 카드/패널 배경 — 하우징보다 한 단계 어두운 톤으로 개별 모듈 구분 |
| `ink` | `#221F1A` | 본문/브랜드 텍스트 — 카드에 찍힌 잉크색(순검정 아님, 인쇄 잉크의 따뜻한 다크) |
| `ink-dim` | `#615A4F` | 보조 텍스트 |
| `rising` | `#2F6B4F` | 순위 상승 — 탁상 캘린더/장부에서 표시에 쓰는 짙은 초록 잉크(스탬프) 참조 |
| `falling` | `#A23B2E` | 순위 하락 — 플립 캘린더가 일요일/공휴일을 적자(赤字)로 인쇄하는 관행 참조, 테라코타(주황 계열, 예 #C97C5D)보다 명확히 붉고 어두운 크림슨 계열로 구분 |

**자기비평 1차 통과 후 조정**: 반복 7에서 정한 "브랜드/인터랙션 컬러 = 텍스트와 동색,
앰버/레드는 상태 전용" 규칙을 유지하되, 앰버는 라이트 크림 배경 위에서 명도差가 작아
대비가 부족해질 위험이 있어 폐기 — 초록/크림슨이라는 잉크 계열로 교체(위 이유는 아래
[자기비평]의 색상 대비 재검토에서 나온 결론이기도 함).

**서체**: Black Han Sans(워드마크/모달 제목 — 유지, 케이싱에 인쇄된 브랜드 표시라는 논리는
오브젝트 스케일과 무관하게 사이트 정체성으로도 성립), Nanum Gothic Coding(키워드/숫자 —
유지, 플립 카드에 찍히는 고정폭 문자셋이라는 논리가 그대로 적용됨), IBM Plex Sans KR(UI —
유지, 라이트에서도 중립적으로 잘 작동).

**레이아웃**: 카드 베젤 로직은 유지하되 새 재질에 맞게 톤 조정 — 라이트에서 그림자를
무겁게 쓰면 2010년대풍 뉴모피즘("soft UI") 클리셰에 빠지기 쉬우므로, 그림자는 최소화하고
얇은 `ink-dim` 헤어라인 테두리를 주된 구분 수단으로 삼음(진한 드롭섀도 대신 미세한
`rgba(0,0,0,0.06)` 수준의 그림자만).

**시그니처 요소**: 행 플립 애니메이션 그대로 유지(메커니즘 자체는 라이트/다크와 무관 —
새 팔레트로만 재도색).

### [자기비평 — 3대 기본값 클러스터 대조]
1. **크림+세리프+테라코타(가장 위험한 항목, 라운드 성격상 최우선 검토)**: `paper`가
   크림 계열인 것은 사실이므로 가장 엄밀히 봄. (a) 세리프 서체 없음 — Black Han
   Sans/Nanum Gothic Coding/IBM Plex Sans KR 전부 산세리프 계열, 그중 둘은 모노스페이스/
   그래픽 사이니지 서체라 "하이컨트라스트 세리프 디스플레이"라는 클러스터 시그니처와
   근본적으로 다른 인상. (b) 테라코타 없음 — `falling`을 짙은 크림슨(#A23B2E)으로 선택해
   전형적 테라코타(주황빛 도는 #C97C5D류)와 색상환에서 명확히 구분되도록 함. (c) `paper`
   헥스 자체도 #F4F1EA(레퍼런스)보다 채도를 낮추고 약간 더 회색에 가깝게 조정(#EFEAE0) —
   "아이보리 플라스틱 하우징"이라는 구체적 실물 근거가 있어 "따뜻한 미니멀 배경"이라는
   임의의 기본값과 다르다고 판단. **결론**: 배경이 밝고 따뜻한 톤이라는 큰 틀은 같지만,
   서체·포인트컬러·근거 스토리 세 축 모두에서 클러스터와 구조적으로 다름.
2. **근접-블랙+단일 포인트**: 해당 없음(밝은 배경으로 전환) — 반복 7에서 이미 확보한
   "포인트 컬러는 오직 상태 전용" 규칙은 이번에도 그대로 유지(rising/falling 외에는 브랜드
   색=본문 잉크색과 동일, 별도 장식 포인트 없음).
3. **브로드시트 헤어라인, radius 0, 밀도 높은 신문 컬럼**: 반복 7과 동일 근거로 계속 회피
   — 카드형 모듈 레이아웃(작은 radius, 개별 패널) 유지, 다단 신문 컬럼 아님. 다만 라이트
   테마에서 헤어라인을 주 구분 수단으로 쓰기로 한 결정(위 [레이아웃])이 자칫 "얇은 선+
   여백"이라는 브로드시트풍으로 읽힐 위험은 있어 유의 — 카드 radius와 패널 배경색 차이
   (`casing` vs `paper`)를 함께 써서 순수 헤어라인 신문 레이아웃과는 다르게 유지.

**접근성/대비 사전 검증(코드 작성 전, WCAG 상대휘도 공식으로 직접 계산)**:
```
ink(#221F1A) on paper(#EFEAE0)      13.70:1  (AAA 통과)
ink on casing(#E1D9C8)              11.70:1  (AAA 통과)
rising(#2F6B4F) on paper             5.25:1  (AA 통과)
falling(#A23B2E) on paper            5.47:1  (AA 통과)
ink-dim 최초안 #8C8478 on paper      3.08:1  (AA 미달 — 작은 텍스트엔 4.5:1 필요)
ink-dim 최초안 on casing             2.63:1  (AA 미달, 3:1도 미달)
```
`ink-dim`이 보조 텍스트(타임스탬프·라벨 등 대부분 10~12px 작은 텍스트)에 쓰이는데 최초
브레인스톰 값이 AA 기준(작은 텍스트 4.5:1)에 못 미침을 코드 작성 전에 발견 — 톤을 더
어둡게 조정해 `#615A4F`로 확정(paper 위 5.68:1, casing 위 4.85:1, 둘 다 AA 통과). 이
조정을 반영해 위 [토큰 시스템] 표를 갱신함.

### [계획] (구현 단계)
1. `git merge main` — `frontend-loop`가 이미 `main`보다 앞서 있어(반복 8 커밋이 아직
   오케스트레이터에 의해 병합되지 않음) `Already up to date`
2. `globals.css` 토큰 전면 교체: 이름 자체도 새 의미에 맞게 리네임(기존 `casing`(페이지
   배경 역할)→`paper`, 기존 `panel`(카드 배경 역할)→`casing`, `flap`/`flap-dim`→`ink`/
   `ink-dim` — 옛 다크 시절 이름을 새 값으로 덮어쓰면 코드상 "flap(=ink)" 같은 혼란스러운
   변수명이 남으므로, 문서화한 플랜과 실제 토큰명이 정확히 일치하도록 제대로 리네임)
3. 컴포넌트 전체(11개 파일)에서 옛 Tailwind 클래스(`bg-casing`/`text-flap`/`bg-panel`/
   `text-flap-dim` 등)를 새 이름으로 일괄 치환 — 순서에 주의해서 3단계로 진행(①
   `flap-dim`→`ink-dim` 먼저 처리해 접두사 충돌 방지, ② 남은 단독 `flap`→`ink`, ③
   `casing`→임시 플레이스홀더→`panel`→`casing`→플레이스홀더→`paper` 순으로 치환해
   "casing이 panel도 되고 paper도 되는" 순환 충돌 방지)
4. 라이트 테마에서 다크 시절 그림자 값(카드 `rgba(0,0,0,0.35)`, 모달
   `rgba(0,0,0,0.5)_blur:30px`)을 그대로 두면 무거운 드롭섀도로 2010년대풍 뉴모피즘
   ("soft UI") 클리셰에 빠질 위험 — `rgba(34,31,26,...)`(ink 계열, 순검정 아님)로 바꾸고
   불투명도/블러를 크게 낮춤(카드 0.35→0.08, 모달 0.5→0.15)
5. OG 이미지도 라이트 팔레트로 재생성(다크 OG 카드가 라이트 사이트와 공유될 때 불일치하게
   보이는 것을 방지 — 성공 기준에 명시되진 않았으나 일관성을 위해 포함)
6. lint → test → build, 데스크톱(900×700)+모바일(390×844) 스크린샷(홈/인증 모달/키워드
   상세), dev 서버 종료

### [실행 + 관찰]

**일괄 치환 중 발견한 부작용**: `panel`→`casing` 치환이 Tailwind 클래스뿐 아니라 일반
영어 단어로 쓰인 주석 산문("in one panel", "control panel")까지 잘못 건드려 "in one
casing", "control casing"처럼 말이 안 되는 문장이 됨 — 코드 리뷰로 발견해 각각 "in one
form", "control strip"으로 수동 수정. 정규식 기반 대량 치환의 흔한 함정이라 별도로 기록.
또한 `flap/NN` 형태(Tailwind 투명도 모디파이어, 예: `border-flap/40`)가 첫 정규식에서
빠져 5곳(`AuthHeader`/`AuthModal`/`RegionTabs`/`page.tsx`)에 `flap`이 남아있었음 — 추가
치환으로 정리. `EmptyFlaps.tsx`는 애초에 파일 목록에서 빠뜨려 별도로 수동 치환.

**신규 파일 없음** — 이번 라운드는 토큰/색상/그림자 재작업뿐, 컴포넌트 구조·기능 변경 없음.

**수정 파일**: `globals.css`(토큰 리네임+재정의), `layout.tsx`(body 클래스), `page.tsx`,
`AuthHeader/AuthModal/RegionTabs/WatchlistPanel/KeywordDetailModal/RankHistoryChart/
RankDelta/RankSparkline/EmptyFlaps.tsx`(전부 새 토큰 클래스로 치환 + 그림자 완화),
`opengraph-image.png`(라이트 팔레트로 재생성).

**`npm run lint`** — 통과(에러/경고 없음, exit 0) — 치환이 클래스명/CSS만 건드리고
로직은 안 건드려서 dark 시절과 동일하게 클린.

**`npm run test`**
```
 Test Files  7 passed (7)
      Tests  52 passed (52)
```
52개 전부 통과, 회귀 없음 — 색상 전용 변경이라 어떤 기존 단정문도 클래스명이나 색상에
의존하지 않아 테스트 자체는 수정 불필요했음(문자열/역할 기반 쿼리만 사용).

**`npm run build`**
```
✓ Compiled successfully
Route (app): 기존 8라우트 그대로, /opengraph-image.png 재생성 확인
```

**스크린샷 확인** (dev 서버 `-p 3006`, 실 데이터 — 백엔드의 두 번째 소스(Hacker News)가
이번 세션 사이 `main`에 실제로 병합되어 실측 데이터에 처음으로 등장):
- **데스크톱 홈**: 아이보리 배경 + 다크 잉크 텍스트로 라이트 테마 확인. 예상 밖의 좋은
  부수 확인 — 반복 8에서 만든 소스 배지가 이제 실 데이터로 "YOUTUBE"/"HACKERNEWS" 라벨을
  달고 실제로 표시됨(목업 테스트로만 검증했던 것을 실물로 재확인, 반복 8 로그의 "다음
  라운드에 재확인 권장" 항목이 이번에 자연히 해소됨)
- **인증 모달**: 밑줄 인풋/버튼 전부 라이트 톤으로 정상 대비, 배경 딤(`bg-black/70`)은
  테마 무관하게 유지해도 위화감 없음을 확인
- **키워드 상세 뷰**: 차트 라인/점/축 라벨 전부 `ink` 계열로 라이트 카드 위에서 뚜렷하게
  읽힘(28개 스냅샷 누적된 HYBE로 확인)
- **모바일**(390×844): 홈/상세 뷰 전부 가로 스크롤·겹침 없이 정상, 카드 사이 미세한
  그림자가 무겁지 않게 렌더링(뉴모피즘으로 안 빠짐 확인)

**dev 서버 종료**: `lsof -ti:3006 | xargs kill` 후 포트 확인 → 정상 종료.

### [검증] — 성공 기준 대조
1. 반복 7과 동일 무게의 브레인스톰+자기비평 문서화(코드 작성 전, 위 [핵심 질문]/
   [토큰 시스템]/[자기비평] 참고), 특히 크림+세리프+테라코타 클러스터를 최우선 검토 →
   **충족**
2. 6개 명명 색상 + 서체 페어링(유지 근거 포함) + 레이아웃 컨셉 + 시그니처 요소(유지 근거
   포함) + 3대 클러스터 전체 대조 → **충족**
3. rising/falling/에러/목업 배너 등 기능 색상을 라이트 배경에서 실측 대비비로 사전 검증(코드
   작성 전 계산으로 `ink-dim` 문제 발견·수정) → **충족**
4. 데스크톱+모바일 홈/인증/키워드 상세 스크린샷, 테스트 갱신(불필요했음, 52개 그대로 통과),
   lint/build 클린 → **충족**

### [개선/반복]
1회 반복으로 4개 기준 모두 충족되어 추가 반복 불필요(규칙 9). 정직하게 기록할 점: "FLIP"
이름과 뒤집기 모션은 유지했지만 물리적 근거를 공항 전광판에서 데스크톱 플립 시계/캘린더로
바꾼 결정은 이번 세션 내에서 검증할 방법이 없는 주관적 판단(사용자가 이 라운드도 "여전히
AI스럽다"고 느낀다면, 다음엔 이름 자체를 포함해 더 근본적인 재검토가 필요할 수 있음 —
반복 7의 개선/반복 항목에서도 동일하게 남겨둔 유보).

### [종료]
4개 성공 기준 모두 실측 증거로 충족. `frontend-loop`에 커밋 진행.

---

## 통합 (merge) — `backend-loop` ← `frontend-loop` (소스 중립 카피 + 라이트 테마, `4e446e9`)

> `backend-loop`(HEAD `9ece78c`)에서 `git merge frontend-loop`(`4e446e9`, 조상 커밋 2개:
> `c45f906` 소스 중립 카피/소스 뱃지, `4e446e9` 라이트 테마 2차) 실행. 오케스트레이터가
> "또 다른 라이브 배포"라고 명시해 FLIP 라운드와 동일한 수준으로 꼼꼼히 검증.

### [충돌 및 해소]
- `LOOP_LOG.md`만 content 충돌. 이번엔 공통 조상을 잘못 짚을 뻔함 — `2ed0090`(직전전 라운드
  베이스)로 먼저 diff했더니 1660행부터 어긋나 보였는데, 이는 frontend-loop가 실제로는 그보다
  최신인 `4f728de`(내가 FLIP 라운드에서 병합해 만든 커밋)를 조상으로 갖고 있어서였음 —
  `git log frontend-loop`로 실제 부모 체인을 먼저 확인해 올바른 공통 조상(`4f728de`, 2062줄)을
  찾아 재시도. `diff`로 `ours`(HEAD)의 처음 2062줄이 그 베이스와 정확히 일치함을 먼저 확인한
  뒤, `4e446e9`가 그 뒤에 추가한 구간(2063~2345행, "반복 8 — 프론트엔드" 283줄)만 골라
  이어붙임. 임시 파일에 조립 → 마커 없음 확인 → 조인부 확인 → 반영, 순서 유지.
- `page.test.tsx`는 자동 병합됨 — 내가 이전 라운드에 고친 `sources: ["youtube"]` 픽스처가
  그대로 유지된 채 frontend의 다른 변경들과 충돌 없이 합쳐짐.
- 신규 `src/lib/trends/sourceLabel.ts`(+ 테스트) — frontend가 만든 파일이지만 경로가
  `src/lib/trends/` 아래라 확인: `TrendItem.source` 문자열을 사람이 읽을 라벨로 변환하는
  순수 UI 헬퍼(`{youtube: "YouTube"}` 매핑 + 라벨 없는 소스는 자동 title-case 폴백). 코드
  충돌 없음. **사소한 관찰**(버그 아님, 보고만): `"hackernews"`가 아직 명시적 라벨 맵에
  없어 폴백이 "Hackernews"(한 단어)로 표시됨 — "Hacker News"(두 단어) 대신. frontend의
  폴백 설계가 정확히 이런 상황("새 백엔드 소스가 프론트 변경 없이도 그럭저럭 보이게")을
  위한 것이라 당장 깨진 건 아니고, 프론트가 원하면 라벨 맵에 한 줄만 추가하면 됨 —
  백엔드가 손댈 파일이 아니라 보고만 하고 넘어감.
- 그 외 컴포넌트 전부(`AuthHeader`/`AuthModal`/`EmptyFlaps`/`KeywordDetailModal`/
  `RankDelta`/`RankHistoryChart`/`RankSparkline`/`RegionTabs`/`WatchlistPanel`,
  `layout.tsx`, `globals.css`, `opengraph-image.png`) 자동 병합, 백엔드 이번 라운드
  변경과 겹치는 파일 없음.

### [검증 — 통합 결과 실측, FLIP 라운드와 동일 수준으로 꼼꼼히]

```
npm run lint   → 빈 출력, exit 0
npm run test   → Test Files 10 passed (10), Tests 71 passed (71)  (66 + frontend 신규
                 sourceLabel.test.ts 5개)
npm run build  → Compiled successfully, TypeScript 통과, 동일 9개 라우트 정상 생성
```

**`npm run dev -- -p 3001` + curl (실 크리덴셜)**

1) 홈페이지 HTML 실측 스캔: `HTTP 200`, 84537 bytes. 실제 런타임 에러 패턴(`TypeError`/
   `ReferenceError`/"Cannot read prop") **0건**. "YouTube 인기 급상승"류 소스 특정 카피
   **0건**(소스 중립 카피 반영 확인). "FLIP" 9회(브랜드 유지 확인). 참고: 이 페이지는
   클라이언트 컴포넌트라 초기 HTML엔 랭킹 아이템/소스 뱃지가 없음(클라이언트에서
   `fetch` 후 렌더) — 이건 이 앱이 처음부터 그래왔던 구조라 이번 병합과 무관, FLIP
   라운드 검증 때도 동일하게 관찰됐던 특성.
2) `/api/trends?region=KR` 재확인: `sources: ['youtube', 'hackernews']`,
   `mocked: False`, 아이템 소스 혼합 `{hackernews, youtube}` — 병합 후에도 다중 소스
   블렌드 정상 동작.
3) 나머지 7개 라우트 전부 실측: `/api/trends/history`(200), `/api/trends/keyword-history`
   (200), `/auth/callback`(307), `/api/watchlist`(401), `/opengraph-image.png`(200,
   `file`로 실제 PNG 1200×630 확인), cron 무비밀(401)/정상비밀(200).
4) rate limiting 회귀 확인: `/api/trends?region=JP` 35회 병렬 발사 → 200/429 혼재(정상).
5) **로그 전체 스캔**: `error|warn|fail` 패턴에서 이미 알려진 클래스 제외 **0건**. 모든
   `GET |POST ` 로그 라인이 200/401/429/307 넷 중 하나로만 끝났는지 재검사 → **0건 이탈**.
   서버 종료 후 포트 확인 → 정상 종료.

### [결론]
`4e446e9`(소스 중립 카피 + 라이트 테마 2차) 반영 후 lint/test(71개)/build/dev 8라우트
curl + HTML 스캔 + rate-limit 회귀 확인까지 전부 그린. `backend-loop`에 머지 커밋 후
`main`으로 병합·푸시 예정(프로덕션 빌드 스모크 테스트 포함, FLIP 라운드와 동일 절차).

## 반복 10 — 프론트엔드 (베이지/크림 계열 자체를 제거)

### [배경]
사용자 원문 피드백: "클로드로 만든 화면은 다 저 베이지색계열의 비슷한류로 나오는데 이게싫어"
— 반복 9의 자기비평(세리프 없음, 테라코타 없음)은 스킬이 명시한 "크림+세리프+테라코타"
조합 중 세리프/테라코타 두 축만 피했을 뿐, 사용자가 실제로 문제 삼는 것은 **베이지/크림/탄
색상 계열 자체**임이 이번에 명확해짐. 스킬의 클러스터 정의보다 더 좁고 구체적인 제약:
"조합이 아니라 그 톤 자체가 AI스럽게 읽힌다."

### [이번 라운드의 하드 제약]
따뜻한 크림/베이지/탄/오프화이트 배경 전면 금지 — 더 연하게/채도 낮게 조정하는 것도 해당
안 됨, 그 색 계열 자체를 배제. 순백, 쿨그레이/블루그레이, 또는 주제에 근거한 진짜
채도 있는 색 중 선택. **코드 작성 전에 스와치를 실제로 렌더링해 눈으로 확인**하라는
명시적 지시 — 헥스값만 계산하고 넘어갔던 반복 9의 방식과 다르게 진행.

### [브레인스톰]
FLIP의 물리적 근거(반복 9: 데스크톱 플립 시계/캘린더)는 유지 가능한가? 검토 결과 — 유지
가능. 플립 시계/캘린더는 아이보리 플라스틱 외에도 **흰색 또는 브러시드 알루미늄(금속)
케이싱** 버전이 실제로 흔하다(1960~70년대 데스크 타이머/플립 시계 다수가 금속 또는 흰
플라스틱). 즉 "같은 오브젝트 계열 안에서 다른 실존 재질을 선택"하면 되므로, 반복 7→9와
같은 방식으로 오브젝트 자체를 다시 바꿀 필요는 없다고 판단 — 재질만 플라스틱(아이보리)에서
**브러시드 메탈(쿨 블루그레이)**로 교체. 금속은 중성광 아래서 실제로 살짝 푸른 색조를
띠는 것이 물리적으로 자연스러워(플라스틱의 따뜻한 색조와 대비) 이 팔레트 선택의 근거가 됨.

### [토큰 시스템] — 이름은 반복 9와 동일(같은 역할), 값만 전면 교체
| 이름 | 이전(반복9, 베이지) | 신규(반복10, 쿨 블루그레이) | 역할 |
|---|---|---|---|
| `paper` | `#EFEAE0` | `#EDF1F4` | 페이지 배경 — 브러시드 메탈 하우징 |
| `casing` | `#E1D9C8` | `#D7DEE3` | 카드 배경 |
| `ink` | `#221F1A` | `#181B1E` | 본문/브랜드 텍스트(쿨 근접-블랙로 조정) |
| `ink-dim` | `#615A4F` | `#4C5962` | 보조 텍스트 |
| `rising` | `#2F6B4F` | `#1E7A54` | 상승 상태 |
| `falling` | `#A23B2E` | `#B23A34` | 하락 상태 |

**베이지 여부 자체 검사(이번 라운드 전용 체크리스트 항목)**: HSL로 직접 계산 —
`paper` hue=206°(파랑), sat=24%, light=94% / `casing` hue=205°, sat=18%, light=87%.
베이지/탄 계열은 보통 hue 30~50°(주황-노랑) 대역인데, 이 값들은 정반대 쪽인 200°대
(파랑) — 색상환에서 명확히 다른 계열. 자기비평 3대 클러스터와는 별개로, 사용자가 지목한
"그 톤 자체"를 수치로도 벗어났음을 확인.

### [접근성 사전 검증]
```
ink(#181B1E) on paper           15.23:1  (AAA)
ink on casing                   12.72:1  (AAA)
rising(#1E7A54) on paper         4.66:1  (AA)
falling(#B23A34) on paper        5.21:1  (AA)
ink-dim 1차값 #5C6570 on paper    5.21:1  (AA)
ink-dim 1차값 on casing           4.35:1  (AA 미달 — 작은 텍스트 4.5:1 기준)
```
`ink-dim`이 또 casing 위에서 아슬아슬하게 AA에 못 미쳐(반복 9와 같은 함정) `#4C5962`로
더 어둡게 조정 → paper 6.35:1 / casing 5.3:1, 둘 다 여유 있게 통과.

### [코드 작성 전 실측 스와치 확인 — 지시대로 먼저 눈으로 확인]
6개 신규 색상 + 비교용 반복 9의 구 `paper`(#EFEAE0)를 나란히 배치한 정적 HTML을
Playwright로 렌더링해 스크린샷으로 직접 눈으로 대조. 결과: 신규 `paper`/`casing`은
명확한 쿨그레이/블루그레이로 보이고, 바로 옆에 놓인 구버전 베이지와 나란히 비교하니
색조 차이가 눈으로도 뚜렷함(구버전은 확연히 따뜻한 탄색, 신규는 확연히 차가운 회색).
이 스와치 확인을 코드 작성 전에 마친 뒤에야 전체 앱에 적용 시작 — 지시된 순서(먼저 눈으로
확인, 그다음 전체 적용) 그대로 따름.

### [자기비평 — 3대 기본값 클러스터 + 베이지 체크]
1. 크림+세리프+테라코타: 배경 자체가 더 이상 크림/베이지가 아니므로 해당 없음(가장 확실히
   벗어남). 세리프/테라코타도 여전히 없음.
2. 근접-블랙+단일 포인트: 밝은 배경 유지, 포인트 컬러는 여전히 상태 전용(rising/falling)
   규칙 유지.
3. 브로드시트 헤어라인/radius 0: 카드형 모듈+미세 radius 유지, 반복 9와 동일 근거.
4. **베이지 자체 체크(이번 라운드 신규 항목)**: 위 HSL 수치 + 스와치 육안 확인으로 통과.
   순백이 아니라 쿨 블루그레이를 택한 이유는 "그냥 안 베이지이기만 하면 되는" 임의의
   선택이 아니라 브러시드 메탈이라는 구체적 재질 근거가 있기 때문 — 위 [브레인스톰] 참고.

### [계획] (구현 단계)
1. `git merge main` 완료(fast-forward, 백엔드의 Hacker News 블렌딩 반영 — `TrendsResponse`가
   `source`(단일) → `sources`(배열)로 바뀌었으나 `page.tsx`는 애초에 `data.source`를 참조한
   적이 없어(`data.mocked`/`items`/`fetchedAt`/`region`, 항목별 `item.source`만 사용) 영향 없음
   확인 후 진행
2. `globals.css`의 6개 토큰 값만 교체(반복 9와 달리 이번엔 이름 자체는 그대로 — 역할이
   안 바뀌었으므로 리네임 불필요, 값만 베이지→쿨 블루그레이)
3. 그림자 틴트(`rgba(34,31,26,...)`, 반복 9에서 "순검정 대신 ink 계열로"라며 넣은 값)도
   구 ink의 따뜻한 톤이라 신규 쿨 ink 톤(`rgba(24,27,30,...)`)으로 맞춰 조정 — 3개 파일
   (`page.tsx`/`AuthModal.tsx`/`KeywordDetailModal.tsx`)
4. OG 이미지도 새 팔레트로 재생성
5. lint → test → build, 데스크톱+모바일 스크린샷(홈/인증 모달/키워드 상세), dev 서버 종료

### [실행 + 관찰]

**신규/삭제 파일 없음** — 반복 9와 달리 이번엔 토큰 이름이 그대로라 컴포넌트 파일 자체는
건드릴 필요 없이 `globals.css` 값 교체 + 그림자 틴트 3곳만 수정.

**`npm run lint`** — 통과(에러/경고 없음).

**`npm run test`**
```
 Test Files  10 passed (10)
      Tests  71 passed (71)
```
71개 전부 통과(백엔드가 이번 세션에 추가한 blend/hackernews/ingest 테스트 39개 포함) —
색상 전용 변경이라 프론트엔드 자체 테스트 회귀도 없음.

**`npm run build`** — 클린, 라우트 구성 변화 없음.

**"먼저 눈으로 확인" 지시 이행**: 코드 전체 적용 전에 신규 6색 + 비교용 구버전 베이지를
나란히 렌더링한 스와치를 Playwright로 스크린샷 → 명확히 쿨그레이/블루그레이로 보임을
확인(위 [코드 작성 전 실측 스와치 확인] 참고). 전체 앱 적용 후에도 데스크톱 홈 화면을
다시 스크린샷해 "이게 베이지/탄으로 보이나?"를 재확인 — 명확히 아니라고 판단(예상 밖의
확인: 백엔드의 Hacker News 소스가 실 데이터에 완전히 섞여 들어와 반복 8의 소스 배지가
YOUTUBE/HACKERNEWS 라벨과 함께, 그리고 실제로 변화하는 순위 델타(▲/▼)까지 처음으로 제대로
보이는 화면을 확인함).

**데스크톱(900×700)/모바일(390×844) 스크린샷**: 홈/인증 모달/키워드 상세 전부 확인 —
카드 배경(`casing`)과 페이지 배경(`paper`) 모두 쿨그레이로 일관되게 렌더링, 텍스트 대비
또렷함, 상승/하락 배지 색(초록/빨강)이 새 배경에서도 선명하게 구분됨, 그림자가 무겁지
않음(뉴모피즘으로 안 빠짐 — 반복 9에서 이미 낮춘 불투명도를 유지, 색조만 조정).

**dev 서버 종료**: `lsof -ti:3006 | xargs kill` 후 포트 확인 → 정상 종료.

### [검증] — 성공 기준 대조
1. 브레인스톰+토큰 시스템+자기비평(3대 클러스터 + 베이지 전용 체크) 코드 작성 전 문서화 →
   **충족**
2. 하드 제약(크림/베이지/탄/오프화이트 전면 금지) 준수 — HSL 수치 + 스와치 육안 확인 이중
   검증 → **충족**
3. rising/falling/ink-dim 등 기능 색상 WCAG 대비 사전 계산(1차 `ink-dim` 값이 casing 위
   4.35:1로 미달인 것을 코드 작성 전에 잡아 `#4C5962`로 수정) → **충족**
4. 데스크톱+모바일 홈/인증/상세 스크린샷, "초반에 먼저 확인" 지시대로 전체 적용 전 스와치
   단계에서 먼저 육안 확인 → **충족**

### [개선/반복]
1회 반복으로 4개 기준 모두 충족되어 추가 반복 불필요(규칙 9). 반복 9의 [개선/반복]에서
남겼던 유보("여전히 AI스럽다고 느끼면 이름 자체를 재검토")는 이번엔 해당하지 않음 — 사용자
피드백이 이름/모션이 아니라 색상 계열을 구체적으로 지목했으므로 그 범위에 맞춰 대응함.
다만 "쿨 블루그레이가 그 자체로 또 다른 흔한 패턴(예: 제네릭 SaaS의 슬레이트 그레이 라이트
모드)으로 읽힐 가능성"은 이번 세션에서 검증할 수 없는 남은 리스크로 정직하게 기록.

### [종료]
4개 성공 기준 모두 실측 증거로 충족. `frontend-loop`에 커밋 진행.

## 반복 11 — 프론트엔드 (다크 FLIP로 원복)

### [배경]
사용자 최종 판정, 원문: "기존색상으로 가는게 낫겠다 너무별로다" — 라이트 테마 두 번의
시도(반복 9 베이지, 반복 10 쿨 블루그레이) 모두 실패로 판정됨. 지시: 두 라이트 시도 이전의
다크 FLIP 팔레트(커밋 `4f728de`)로 색상 값만 원복 — `git revert`는 금지(그 사이 커밋
범위에 백엔드의 Hacker News/blend/ingest 파일, 소스 배지 기능, 카피 일반화, 테스트 변경
등 색상과 무관한 실제 작업이 섞여 있어 통째로 되돌리면 그것들도 함께 파괴됨).

### [목표]
1. `globals.css` 토큰 + 컴포넌트 색상 클래스를 `4f728de` 시점 값으로 정확히 복원 —
   기억이 아니라 `git show 4f728de:<path>`로 직접 확인한 원본을 근거로 사용
2. 그 사이 라운드의 구조적/기능적 변경(소스 배지, 카피 일반화, `keyword-history` 이전,
   테스트)은 그대로 유지 — 색상이 아닌 단정문은 건드리지 않음
3. `4f728de`가 실제로 어떻게 보였는지와 대조해 눈으로 확인(단순히 "다크 테마이기만 하면
   된다"가 아니라 그 특정 모습과 일치하는지)
4. lint/test/build 클린

### [계획]
1. `git merge main` — 이미 `main`보다 앞서 있어 변경 없음
2. `git show 4f728de:src/app/globals.css` 및 9개 컴포넌트 파일을 직접 조회해 원본 다크
   값/클래스명을 소스오브트루스로 확보(기억으로 재구성하지 않음)
3. 9개 컴포넌트(`AuthHeader`/`AuthModal`/`RegionTabs`/`WatchlistPanel`/
   `KeywordDetailModal`/`RankHistoryChart`/`RankDelta`/`RankSparkline`/`EmptyFlaps`)를
   먼저 `git diff 4f728de HEAD -- <file>`로 대조해 **순수 색상 전용 차이**임을 확인한 뒤
   `git checkout 4f728de -- <file>`로 통째로 복원(가장 정확하고 실수 여지가 없는 방법 —
   구조적 변경이 섞여 있었다면 이 방법은 쓸 수 없었을 것)
4. `page.tsx`/`layout.tsx`는 구조적 변경(소스 배지, 카피)이 섞여 있어 통째 복원 불가 —
   역방향 토큰 치환(반복 9에서 썼던 sed 매핑의 정확한 역순: `ink-dim`→`flap-dim` 먼저,
   나머지 `ink`→`flap`, `paper`→임시값→`casing`→`panel`→임시값→`casing` 3단계)을 적용한
   뒤 `git diff 4f728de -- <file>`로 남은 차이가 의도한 구조적 변경뿐인지 확인
5. `globals.css`는 구조적 변경이 전혀 없어(`4f728de` 이후 값만 바뀜) `git checkout`으로
   통째 복원 → diff 없음(완전 일치) 확인
6. 그림자 rgba 값도 라이트용으로 튜닝된 것(`rgba(24,27,30,...)`)을 원래 다크값
   (`rgba(0,0,0,0.35)`/`0.5`)으로 되돌림 — sed로 안 잡힌 곳은 직접 확인 후 수정
7. OG 이미지 — `4f728de`의 이미지를 그대로 쓰면 카피가 구버전("YouTube 인기 급상승...")이라
   부적절 — 반복 8에서 이미 만들어둔 "다크 팔레트 + 신규(소스 중립) 카피" 조합의 스크래치
   HTML(`og-source-flip.html`)이 정확히 필요한 조합이라 재사용해 재생성
8. 테스트 파일에 라이트 테마 값/클래스를 직접 단정하는 곳이 있는지 검색 — 없음 확인(전부
   텍스트/역할 기반 쿼리)
9. lint → test → build, `4f728de`가 실제로 어떻게 보였는지와 대조하는 스크린샷(홈/인증
   모달/키워드 상세), dev 서버 종료

### [실행 + 관찰]

**컴포넌트 9개 순수 색상 diff 확인**: `git diff 4f728de HEAD -- <file>`로 전부 대조한 결과
모든 차이가 `flap`/`flap-dim`/`panel`/`casing` ↔ `ink`/`ink-dim`/`casing`/`paper` 토큰
치환과 그림자 rgba 값뿐임을 확인(구조 변경 0건) — 이 확인이 있었기에 안전하게 통째
`git checkout`으로 복원 가능했음. 만약 그중 하나라도 구조적 diff가 섞여 있었다면 이
방법은 쓸 수 없었을 것.

**`page.tsx` 역방향 토큰 치환**: sed 3단계 적용 후 그림자 값 1곳(행 카드)이 정규식에
안 걸려 남아있는 것을 발견해 수동으로 수정 — 이 문제를 잡기 위해 `git diff 4f728de --
src/app/page.tsx`를 최종적으로 재확인하는 절차가 실제로 유용했음(치환 결과를 눈으로만
보고 넘겼다면 놓쳤을 것). 최종 diff에서 남은 차이는 정확히 4개 — `sourceLabel` import,
`hasMultipleSources` 계산, 서브헤드라인/목업 배너 카피, 소스 배지 JSX 블록 — 전부 유지
대상으로 확인된 것들만 남음.

**`layout.tsx`**: `DESCRIPTION` 카피(소스 중립, 유지)와 `body` 클래스(`bg-paper text-ink`
→ `bg-casing text-flap`, 복원) 2곳만 diff.

**`globals.css`**: `git checkout 4f728de --`로 복원 후 diff 없음(완전 일치) — 구조 변경이
전혀 없던 파일이라 가장 단순한 케이스.

**테스트 파일 검색**: `bg-paper|text-ink|#EDF1F4|#D7DEE3|...|ink-dim` 등으로 전체
`*.test.tsx`/`*.test.ts`를 검색 → 0건. 어떤 테스트도 클래스명/헥스값을 직접 단정하지
않아 되돌릴 단정문이 없었음(전부 텍스트 콘텐츠/role 기반 쿼리라 색상 변경에 애초에
영향받지 않는 구조 — 반복 9/10에서도 테스트 수정이 불필요했던 것과 같은 이유).

**`npm run lint`** — 통과(에러/경고 없음).

**`npm run test`**
```
 Test Files  10 passed (10)
      Tests  71 passed (71)
```
71개 전부 통과, 회귀 없음.

**`npm run build`** — 클린, 라우트 구성 동일.

**OG 이미지**: 반복 8에서 만든 "다크 팔레트 + 카피 일반화 이후 문구" 조합의 스크래치
HTML(`og-source-flip.html`)을 그대로 재사용해 재렌더링 — `4f728de`의 이미지 파일을 직접
쓰지 않은 이유는 그 이미지에 구버전 "YouTube 인기 급상승..." 카피가 박혀 있어 반복 8의
카피 작업을 무효화하기 때문. 재렌더링 결과 다크 배경+워드마크+앰버 상태 셀+신규 카피
조합 확인.

**`4f728de`와의 실측 대조 스크린샷** (dev 서버 `-p 3006`, 실 데이터 — 이제 25~31개
스냅샷까지 누적되어 초기 라운드보다 델타/스파크라인이 더 뚜렷하게 나타남): 홈 화면 —
근접-블랙 배경, 크림 텍스트, 앰버 "▲4" 델타, YOUTUBE/HACKERNEWS 소스 배지(반복 8 기능,
유지 확인) 전부 정상. 인증 모달 — 앰버 로그인 버튼, 크림 밑줄 인풋. 키워드 상세 뷰 —
차트 라인/점 크림색, 축 라벨 정상. 전부 반복 7~8 시기의 실제 다크 FLIP 모습과 일치함을
육안으로 확인(단순 "다크 테마"가 아니라 그 특정 팔레트라는 것까지 확인).

**dev 서버 종료**: `lsof -ti:3006 | xargs kill` 후 포트 확인 → 정상 종료.

### [검증] — 성공 기준 대조
1. `globals.css`/컴포넌트 색상을 `4f728de` 실측값으로 정확히 복원(커밋 직접 조회 근거) →
   **충족**
2. 소스 배지/카피 일반화/`keyword-history` 이전 등 구조·기능 변경 전부 유지, 색상 아닌
   테스트 단정문 무변경 → **충족**
3. `4f728de`의 실제 모습과 스크린샷으로 대조 확인(막연한 "다크"가 아니라 그 팔레트) →
   **충족**
4. lint/test(71개)/build 클린 → **충족**

### [개선/반복]
1회 반복으로 4개 기준 모두 충족되어 추가 반복 불필요(규칙 9). 정직하게 기록할 점: 반복
9~10에서 시도한 라이트 테마 방향(자기비평·대비 계산·스와치 사전 확인 등 프로세스 자체는
견고했음)이 결국 사용자에게는 두 번 다 받아들여지지 않았다는 것은, 이 특정 사용자에게는
"과정의 엄밀함"과 "결과가 실제로 다르게 느껴지는가"가 별개 문제였다는 뜻으로 해석됨 —
향후 유사한 톤/팔레트 요청이 다시 오면, 이번 원복 사실 자체를 참고해 같은 계열(라이트
크림/그레이 전반)을 또 시도하기보다 근본적으로 다른 접근(예: 다크 유지 + 다른 축의 변화)을
먼저 제안하는 것이 나을 수 있음 — 다음 라운드 판단을 위한 메모로 남김.

### [종료]
4개 성공 기준 모두 실측 증거로 충족. `frontend-loop`에 커밋 진행.

---

## 통합 (merge) — `backend-loop` ← `frontend-loop` (다크 FLIP 원복, `775ba6c`)

> `backend-loop`(HEAD `94301a2`)에서 `git merge frontend-loop`(`775ba6c`) 실행. 이번엔
> `backend-loop`가 그 사이 새 커밋 없이 정확히 `94301a2`에 머물러 있었고 `frontend-loop`가
> 그 바로 위에 직접 이어져 있어, 충돌 없는 순수 fast-forward(`94301a2..775ba6c`)로 완료
> — LOOP_LOG.md 병합 조립 자체가 필요 없었음. 그래도 "또 다른 라이브 배포"라 검증은 동일
> 수준으로 꼼꼼히 진행.

### [검증 — 실측]
```
npm run lint   → 빈 출력, exit 0
npm run test   → Test Files 10 passed (10), Tests 71 passed (71) (불변, fast-forward라 당연)
npm run build  → Compiled successfully, 동일 9개 라우트 정상 생성
```

**`npm run dev -- -p 3001` + curl (실 크리덴셜, 8개 라우트 전부)**
```
GET  /                                                       → HTTP 200
GET  /api/trends?region=KR   → sources:['youtube','hackernews'], mocked:False,
                                아이템 소스 혼합 {hackernews, youtube} — 원복 후에도
                                다중 소스 블렌드 정상
GET  /api/trends/history?region=KR                           → HTTP 200
GET  /api/trends/keyword-history?keyword=HYBE&region=KR      → HTTP 200
GET  /auth/callback (code 없음)                                → HTTP 307
GET  /api/watchlist (세션 없음)                                 → HTTP 401
GET  /opengraph-image.png                                     → HTTP 200, `file`로 실제
                                                                  PNG(1200×630) 확인
POST /api/cron/refresh-trends (secret 없음/정상)                → HTTP 401 / 200
```
rate limiting 회귀 확인: `/api/trends?region=US` 35회 병렬 발사 → 200/429 혼재(정상).
로그 전체 스캔: 이미 알려진 클래스 제외 `error|warn|fail` **0건**, 모든 `GET |POST ` 로그
라인이 200/401/429/307 중 하나로만 끝남(이탈 0건). 서버 종료 후 포트 확인 → 정상 종료.

### [결론]
`775ba6c`(다크 FLIP 원복) 반영 후 lint/test(71개)/build/dev 8라우트 curl + rate-limit
회귀 확인까지 전부 그린 — 순수 fast-forward라 병합 충돌 자체는 없었지만 라이브 배포
전이라 검증은 생략하지 않음. `backend-loop`가 이미 `775ba6c`(fast-forward 결과)이므로
별도 머지 커밋 없이 `main`으로 fast-forward·푸시 진행.

---

## 반복 — 백엔드 (워치리스트 last-seen 랭크 추적)

> "관심 등록한 키워드가 크게 움직였다" 알림을 프론트가 매번 처음부터 재계산하지 않고
> 서버가 안정적으로 뒷받침하도록(기기/세션 간 유지) 워치리스트 아이템별 last-seen 랭크를
> 서버에 저장. `git merge main` → 이미 최신(변경 없음). **참고**: 이 라운드는 컨텍스트
> 한도로 세션이 한 번 끊겼다가 재개됨 — 끊긴 시점엔 sync 확인만 마친 상태였고 실제 코드는
> 전혀 작성되지 않았음을 재개 후 `git status`/`git log`로 먼저 확인한 뒤 처음부터 진행.

### [목표]
1. 새 마이그레이션(`0004_*.sql`)으로 `watchlist`에 `last_seen_rank`(nullable int),
   `last_seen_at`(nullable timestamptz) 추가, `APPLIED.md`에 pending으로 등재
2. `GET /api/watchlist` 응답에 아이템별 CURRENT 랭크(해당 keyword+region의 최신 스냅샷에서
   조회 — keyword-history의 기존 패턴 재사용)를 `last_seen_rank`와 나란히 포함
3. `last_seen_rank`를 갱신(확인)하는 방법 — 라우트 확장 방식은 자율 결정
4. 키워드가 현재 스냅샷에 아예 없으면 현재 랭크는 에러가 아니라 `null`
5. 새 로직에 대한 테스트, 기존 스위트와 함께 전부 통과. lint/build 클린
6. 0004 라이브 적용 시 실 검증, 미적용이면 표준 블로커로 명시

### [계획]
1. `getRecentTrendSnapshots`/`extractKeywordHistory`(keyword-history가 쓰는 기존 패턴)를
   재사용하되, "현재 랭크"는 전체 히스토리가 아니라 **최신 스냅샷 1개**만 필요하므로 새
   순수 함수 `findCurrentRank(snapshot, keyword): number | null`을 `persist.ts`에 추가
   (스냅샷 없음 또는 키워드 없음 둘 다 `null` — 실패가 아니라 정상적인 "현재 랭크 없음"
   상태로 취급)
2. `GET`이 워치리스트 아이템마다 개별로 스냅샷을 조회하면 같은 지역을 보는 아이템이 여러 개일
   때 중복 쿼리가 발생 — 워치리스트 행들의 **고유 지역 집합**에 대해서만 최신 스냅샷을
   1회씩 병렬 조회(`Promise.all`)한 뒤 각 행에 매칭하는 방식으로 N+1 쿼리 방지
3. **PATCH 라우트 확장 방식 결정**: `PATCH /api/watchlist { id }` — 클라이언트가 랭크 값을
   직접 보내는 게 아니라, 서버가 해당 아이템의 keyword+region으로 현재 랭크를 **직접
   재계산**해서 저장(클라이언트 값을 신뢰하지 않음 — 베이스라인이 실제로 백엔드가 아는 값과
   어긋날 수 없게 함). 키워드가 현재 랭킹에 없으면 `last_seen_rank`도 `null`로 저장 —
   이것도 유효한 베이스라인("마지막 확인 시점엔 순위 밖이었다")이지 실패가 아님
4. `supabase/migrations/0004_watchlist_last_seen_rank.sql` 작성 — `alter table ... add
   column if not exists` 2개, 둘 다 nullable(신규 아이템은 아직 확인 전이라 둘 다 null이
   자연스러운 초기 상태)
5. `src/app/api/watchlist/route.ts` 수정 — `GET`에 `current_rank` 계산 추가(위 2번 방식),
   `PATCH` 신설(위 3번 방식). `GET`은 읽기 전용으로 유지 — 목록을 보는 것만으로
   `last_seen_rank`가 조용히 갱신되면 안 됨(그러면 "확인" 액션의 의미가 없어짐), 명시적
   `PATCH` 호출만 갱신
6. `persist.test.ts`에 `findCurrentRank` 유닛 테스트 3개 추가(순수 함수라 Supabase 없이
   테스트 가능). 라우트 자체(`GET`/`POST`/`PATCH`/`DELETE`)는 기존 관례대로 별도
   `route.test.ts` 없이 curl 실측으로 검증(과거 라운드에서 `/api/watchlist`도 동일)
7. `npm run lint/test/build` → dev 서버로 401 경로 실측, 서비스롤로 마이그레이션 적용
   여부 확인, 실 스냅샷 데이터로 조회 로직 자체를 (인증 라우트 우회해서) 직접 검증

### [실행 + 관찰]

**신규 파일**: `supabase/migrations/0004_watchlist_last_seen_rank.sql`

**수정 파일**
- `src/lib/trends/persist.ts` — `findCurrentRank(snapshot, keyword)` 추가
- `src/lib/trends/persist.test.ts` — 관련 테스트 3개 추가
- `src/app/api/watchlist/route.ts` — `GET`에 지역별 배치 스냅샷 조회 + `current_rank` 계산,
  `PATCH` 신설
- `supabase/migrations/APPLIED.md` — `0004`를 pending으로 등재

**`npm run lint`** → 빈 출력, exit 0

**`npm run test`**
```
Test Files  10 passed (10)
     Tests  74 passed (74)
```
71(기존) + 3(`findCurrentRank`: 랭크 있음/키워드 없어 null/스냅샷 자체 없어 null)

**`npm run build`** → 클린, 동일 9개 라우트 정상 생성(라우트 목록 자체는 안 바뀜 — `/api/watchlist`가
메서드만 추가됐을 뿐 경로는 그대로)

**dev 서버(`:3001`, 실 크리덴셜) 실측**
```
GET/POST/PATCH/DELETE /api/watchlist (세션 없음) → 전부 HTTP 401
```
서비스롤 클라이언트로 직접 확인: `watchlist.last_seen_rank` 컬럼 조회 시
`42703 column watchlist.last_seen_rank does not exist` — **0004 미적용 확인**(예상된 상태,
표준 블로커 패턴).

**인증 라우트 우회 직접 검증**: `/api/watchlist`는 모든 메서드가 세션을 요구해 실 로그인
없이는(과거 라운드부터 이어진 동일한 한계 — 로그인 UI 없음) 라우트 자체를 통해서는 검증
불가. 대신 `findCurrentRank`가 실제로 하는 것과 동일한 조회를 서비스롤로 라이브
`trend_snapshots`에 대해 직접 실행:
```
최신 KR 스냅샷(fetched_at: 2026-08-25T04:12:02.85+00:00)에서
실제 키워드("알파드라이브원") 조회 → rank=1
존재하지 않는 키워드("definitely-not-a-real-keyword-xyz") 조회 → rank=null
```
유닛 테스트가 검증한 것과 동일한 로직이 실 프로덕션 데이터 형태에도 정확히 맞아떨어짐을
확인 — 라우트를 통한 end-to-end 검증은 아니지만, 로직과 실데이터 계약이 어긋나지 않음을
증명.

### [검증] — 성공 기준 대조
1. `0004_*.sql` 신설 + `APPLIED.md` pending 등재 → **충족**
2. `GET` 응답에 아이템별 `current_rank` 포함(지역별 배치 조회로 N+1 방지) → **코드 충족**,
   실 데이터 조회 로직 검증됨. 라우트 자체의 인증 경로는 실 세션 없어 미검증(표준 한계)
3. `PATCH /api/watchlist { id }` 신설, 서버가 직접 재계산해 저장(클라이언트 값 불신) →
   **코드 충족**, 동일 이유로 라우트 자체의 인증 경로 실측 불가
4. 키워드가 현재 스냅샷에 없으면 랭크는 `null`(에러 아님) → **충족**, 유닛 테스트 +
   실 데이터 조회 둘 다로 확인
5. `findCurrentRank` 유닛 테스트 3개 + 기존 74개 전부 통과, lint/build 클린 → **충족**
6. 0004 라이브 미적용 확인(서비스롤로 실측), 표준 블로커로 명시 → **충족**

### [개선/반복]
1회 반복으로 코드 가능한 부분 전부 완료. 성공 기준 2·3의 "라우트 자체의 인증된 성공
경로" 실측만 두 가지가 겹쳐서 막혀있음 — (a) `0004` 라이브 미적용, (b) 실 로그인 세션
부재(반복 3부터 반복마다 동일하게 언급된 한계, 프론트 인증 UI 붙으면 해소). 둘 다 이
세션 권한 밖 — 규칙 10.

### [종료/중단]
코드/테스트/마이그레이션 파일 전부 완료. 오케스트레이터에게 필요한 것: (a) `0004` SQL
Editor 적용, (b) 실 로그인 세션이 생기면(프론트 인증 UI 경유) `GET`/`PATCH`의 실제 인증
경로 재검증. **중단(규칙 10, 두 블로커 모두 이 세션 밖)**.

## 반복 12 — 프론트엔드 (공유 가능한 키워드 URL + 접근성 감사)

### [배경]
두 개 목표를 한 라운드로 진행. (1) `KeywordDetailModal`이 클라이언트 상태로만 열려
링크·북마크·공유가 불가능 — 딥링크 가능하게 만들 것. (2) 반복 8 로그에 남겨둔
"dataviz 표 뷰 폴백 생략" 메모에서 시작하되, 실제 정식 접근성 감사(키보드 내비게이션,
스크린리더 시맨틱, 색상 대비 실측, `prefers-reduced-motion`)를 처음으로 수행. 백엔드가
병행으로 워치리스트에 last-seen-rank 필드를 추가 중이나 이번 라운드와는 무관(향후 알림
기능용 컨텍스트).

### [목표]
1. `?keyword=X&region=KR` 형태로 키워드 상세를 딥링크 가능하게 — 열기/닫기 시 URL 갱신,
   브라우저 뒤로/앞으로 가기가 "시각적으로만"이 아니라 실제로 모달을 닫음/엶, 모달에
   "공유"(링크 복사/모바일 네이티브 공유시트) 기능, 존재하지 않는/만료된 키워드로 접근해도
   절대 깨지지 않는 방어적 처리
2. 키보드 내비게이션(탭 순서, 모달 포커스 트랩·복원, Escape), 스크린리더 시맨틱(차트의
   비시각적 대안), 실측 색상 대비, `prefers-reduced-motion` — 전부 실측 증거와 함께 점검
3. 두 목표 모두 실제 검증 증거(스크린샷, 실측 대비비, 실제 키보드 워크스루) + 테스트 통과
   + lint/build 클린

### [계획]
1. `git merge main` — 백엔드 검증 로그만 추가, 코드 충돌 없음(fast-forward)
2. Next.js 문서(`node_modules/next/dist/docs`)에서 `useSearchParams` 요구사항 확인 —
   프로덕션 정적 빌드에서 `Suspense` 경계 없이 쓰면 빌드 실패한다는 경고를 사전에 발견,
   `page.tsx`를 얇은 `<Suspense>` 래퍼로 분리하고 실제 로직은 `HomeClient.tsx`로 이동하는
   구조 결정
3. `HomeClient.tsx`: URL을 상세 모달의 단일 진실 소스로 삼음(`detailKeyword =
   searchParams.get("keyword")`, 별도 useState 없음) — 이렇게 해야 브라우저 뒤로가기가
   "진짜" 닫힘이 됨(URL이 바뀌면 컴포넌트가 그 값을 그대로 읽어 재렌더링하므로). 열기/닫기는
   `router.push`, 모달이 열린 채 지역 탭을 바꾸면 `router.replace`로 URL의 region만
   동기화(히스토리 스팸 방지)
4. 존재하지 않는 키워드 엣지 케이스는 이미 `KeywordDetailModal`의 희소-데이터 분기가
   처리 — 신규 코드 불필요, 실측 테스트로만 확인
5. 접근성: 실제 axe-core 스캔(Playwright에 주입) 먼저 돌려 진짜 문제를 찾은 뒤 고침(가정
   금지) → 모달 포커스 트랩/복원 공용 훅, 차트 스크린리더용 접근 가능 테이블, 대비 계산으로
   실패 발견 시 수정
6. lint → test → build, axe 스캔 재확인, 실제 키보드 워크스루, URL/뒤로가기 스크린샷,
   dev 서버 종료

### [실행 + 관찰]

**GOAL 1 — 구현**
- `src/app/page.tsx` → `<Suspense fallback={null}><HomeClient /></Suspense>` 래퍼로 축소
- `src/app/HomeClient.tsx`(신규) — 기존 `page.tsx` 로직 이전 + `useSearchParams`/
  `usePathname`/`useRouter`(`next/navigation`) 기반 URL 동기화. `openDetail`/`closeDetail`
  함수, region 초기값도 URL에서 읽음(`?region=` 유효성 검사 후 폴백)
- `KeywordDetailModal.tsx`에 "공유" 버튼 추가 — `navigator.share`(모바일 네이티브
  시트) 우선 시도, 실패/미지원 시 `navigator.clipboard.writeText`로 폴백, 클립보드조차
  안 되면(권한/비보안 컨텍스트) 조용히 무시 — 프로젝트 전반의 방어적 원칙과 동일(never
  crash on a best-effort affordance)

**GOAL 1 — 실측 검증** (dev 서버 `-p 3007`, Playwright 스크립트로 실제 브라우저 조작):
```
1. 초기 URL: http://localhost:3007/
2. "알파드라이브원" 클릭 후 URL: .../?keyword=...&region=KR
3. 브라우저 Back 후 — URL: http://localhost:3007/ | dialog present: false
4. 브라우저 Forward 후 — URL: .../?keyword=...&region=KR | dialog present: true
5. 새 탭에서 딥링크 직접 열기 → dialog present on direct load: true
6. 존재하지 않는 키워드(`완전히없는키워드XYZ`) 딥링크 → dialog 텍스트:
   "...완전히없는키워드XYZ\n공유\n✕\n\n아직 데이터가 충분하지 않습니다\n..."
```
**3번이 핵심 증거** — "시각적으로만" 닫히는 게 아니라 실제 브라우저 뒤로가기로 URL 자체가
`/`로 돌아가고 dialog가 DOM에서 완전히 사라짐을 확인. 공유 버튼도 클립보드 권한을 부여한
브라우저 컨텍스트에서 실측: 클릭 후 라벨이 "공유"→"복사됨"으로 바뀌고, 클립보드 실제
내용이 정확한 딥링크 URL(`.../?keyword=...&region=KR`)임을 `navigator.clipboard.readText()`로
직접 확인. 스크린샷 2장(딥링크 신규 오픈, 존재하지 않는 키워드)으로 시각 확인.

**GOAL 2 — axe-core 스캔 (실제 발견 → 수정 → 재확인)**
1차 스캔(홈/인증모달/키워드상세모달 3곳) 결과:
```
home: 3 violations — landmark-one-main, page-has-heading-one, region(83 nodes)
auth modal open: 1 violation — region(83 nodes)
keyword detail modal open: 1 violation — region(83 nodes)
```
가정하지 않고 실제 스캔으로 발견한 문제 → 수정: 헤더 `<div>`→`<header>`, 콘텐츠
`<div>`→`<main>`, 태그라인 `<p>`→`<h1>`(Tailwind preflight가 헤딩 기본 스타일을
리셋하므로 시각적으로 동일하게 유지됨). 수정 후 재스캔:
```
home: 0 violations
auth modal open: 0 violations
keyword detail modal open: 0 violations
```

**GOAL 2 — 색상 대비 실측** (WCAG 상대휘도 공식으로 직접 계산, 다크 FLIP 팔레트 전체):
```
flap on casing        16.36:1  (AAA)
flap on panel          14.55:1  (AAA)
flap-dim on casing      5.44:1  (AA)
flap-dim on panel       4.83:1  (AA)
rising on casing        9.98:1  (AAA)
rising on panel         8.87:1  (AAA)
falling on casing       4.33:1  (AA 미달 — 4.5:1 필요)  ← 실패 발견
falling on panel        3.85:1  (AA 미달)               ← 실패 발견
```
**`falling`(#c4544a)이 반복 7(FLIP 도입)부터 지금까지 두 배경 모두에서 WCAG AA 미달
상태였음을 이번 실측으로 처음 발견** — 에러 배너/워치리스트 삭제 아이콘 호버/RankDelta
하락 배지 전부가 대비 기준 미달로 렌더링되고 있었다는 뜻. `#e07569`로 교체(`casing` 위
6.35:1 / `panel` 위 5.65:1, 여유 있게 통과) — 색상환상 여전히 명확한 빨강이고 테라코타
쪽으로 치우치지 않도록 확인.

**GOAL 2 — 키보드 워크스루** (실제 Playwright 키보드 조작, 가정 아님):
```
Tab 1: tab "KR대한민국" → Tab 2: tab "US..." → Tab 3: tab "JP..." → Tab 4: 갱신 버튼
→ Tab 5: 로그인 버튼 → Tab 6~8: 랭킹 행 키워드 버튼들 (순서 정상, 예상 밖 점프 없음)

키보드로 상세 모달 열기(포커스된 행 버튼에서 Enter):
  열림 직후 활성 요소 → button "공유" (모달의 첫 포커스 가능 요소로 정상 이동)

포커스 트랩:
  Shift+Tab from "공유" → "닫기" (마지막 요소로 정상 wrap)
  이후 Tab 5회 → 공유/닫기/공유/닫기/공유 (트랩 내부에서만 순환 확인)

Escape:
  Dialog present after Escape: false
  포커스 복원: 정확히 모달을 열었던 그 행 버튼("알파드라이브원")으로 복귀 확인
```
`AuthModal`도 동일한 `useModalA11y` 훅을 공유 — axe 스캔(0 violations)과 `page.test.tsx`의
신규 유닛 테스트로 별도 확인(포커스가 모달 안으로 이동하고 `document.body`에 남아있지
않음), 전체 키보드 스크립트는 중복이라 생략.

**GOAL 2 — 스크린리더 시맨틱**: `RankHistoryChart`의 `<svg>`를 `role="img"` +
`aria-label`(모양만 알려주고 실제 수치는 전달 못 함)에서 `aria-hidden="true"`로 변경,
대신 `sr-only` 클래스의 실제 `<table>`(시간/순위 컬럼)을 추가해 스크린리더 사용자가 진짜
데이터 포인트에 접근 가능하도록 함 — 시각적 차트는 이제 장식으로 취급되고 텍스트
대안이 진짜 콘텐츠.

**GOAL 2 — `prefers-reduced-motion`**: Playwright의 `page.emulateMedia({reducedMotion:
"reduce"})`로 실측 — `.flap-row`/`.live-dot`의 computed `animationName`이 둘 다 `"none"`으로
확인(기존 반복 7의 미디어쿼리가 실제로 작동함을 처음으로 실측 검증). 호버 색상 전환
(`transition` 유틸리티)은 WCAG가 대상으로 하는 "동작/모션"이 아니라 단순 색상 보간이라
별도 처리 없이 유지하기로 판단(의식적 결정으로 기록).

**신규/변경 파일**: `src/app/page.tsx`(축소), `src/app/HomeClient.tsx`(신규),
`src/hooks/useModalA11y.ts`(신규), `src/components/AuthModal.tsx`/
`KeywordDetailModal.tsx`(훅 연결 + 공유 버튼), `src/components/RankHistoryChart.tsx`(sr-only
테이블), `src/app/globals.css`(`falling` 대비 수정), `src/app/page.test.tsx`(`Home`→
`HomeClient` 임포트 전환, `next/navigation` 반응형 목 신설, 딥링크/뒤로가기/접근성 신규
테스트 6개).

**`next/navigation` 테스트 목 관련 메모**: `useSearchParams`가 실제 앱 라우터 컨텍스트 없이
호출되면 즉시 에러가 나 첫 테스트 실행이 13개 전부 실패 — 단순 정적 목으로는 "열기/닫기가
URL을 실제로 반영하는지"를 검증할 수 없어서, `useSyncExternalStore` 기반의 반응형 목(공유
쿼리스트링 스토어를 라우터의 push/replace가 실제로 변경하고 구독 컴포넌트가 재렌더링)을
직접 구현 — 이 목 덕분에 "뒤로가기 시뮬레이션"(`setSearch("")`로 URL을 외부에서 바꿔 모달이
실제로 닫히는지)까지 jsdom에서 검증 가능해짐.

**`npm run lint`** — 1차 실행에서 `useModalA11y.ts`의 `onCloseRef.current = onClose;`가
렌더 중 ref 수정으로 `react-hooks/refs` 규칙에 걸림 → `useEffect(() => {
onCloseRef.current = onClose; })`(매 렌더 후 실행되는 빈 deps effect)로 이동 → 재실행 통과.

**`npm run test`**
```
 Test Files  10 passed (10)
      Tests  77 passed (77)
```
77개 전부 통과(기존 71개 + 신규 6개: 딥링크 온로드 오픈, 존재하지 않는 키워드 그레이스풀
처리, URL 열기/닫기 동기화, 뒤로가기 시뮬레이션으로 모달 닫힘, Escape+포커스 복원, 인증
모달 포커스 진입).

**`npm run build`** — 클린. `/`가 여전히 `○ (Static)`로 표시됨 — `Suspense` 경계가
`useSearchParams`를 올바르게 감싸 정적 프리렌더가 깨지지 않음을 빌드 결과로 확인(문서에서
경고한 실패 시나리오를 사전에 피함).

**dev 서버 종료**: `lsof -ti:3007 | xargs kill` 후 포트 확인 → 정상 종료. 스크래치
스크립트(axe/키보드/URL/공유/모션 검증용 5개) 전부 삭제, 커밋 대상 아님.

### [검증] — 성공 기준 대조
1. 딥링크 가능한 URL, 열기/닫기 동기화, 실제 뒤로/앞으로가기 동작, 공유 버튼(클립보드 실측
   확인), 존재하지 않는 키워드 그레이스풀 처리 → **충족**
2. 키보드 내비게이션(실제 워크스루)/스크린리더 시맨틱(sr-only 테이블)/실측 대비(버그 발견+
   수정)/`prefers-reduced-motion`(실측 확인) — 전부 구체적 실측 증거와 함께 → **충족**
3. 테스트 갱신·추가(77개 전부 통과), lint/build 클린 → **충족**

### [개선/반복]
1회 반복으로 3개 기준 모두 충족되어 추가 반복 불필요(규칙 9). 정직하게 기록할 점:
- `RegionTabs`의 화살표 키 로빙 tabindex(ARIA 저작 관행에서 권장하는 완전한 tablist
  패턴)는 구현하지 않음 — axe-core가 이를 위반으로 잡지 않고(자동 도구가 못 잡는 항목),
  Tab 키만으로도 각 탭에 도달 가능해 기능적으로 막혀 있지는 않음. 완벽한 ARIA 저작 관행
  준수까지는 이번 라운드 범위 밖으로 의식적으로 남겨둠.
- `falling` 대비 버그는 반복 7부터 존재했다는 것 자체가 "직접 계산하지 않으면 놓친다"는
  이번 라운드 지시의 정당성을 보여주는 사례 — 이전 라운드들에서 "다크 배경에 크림 텍스트니까
  대비가 괜찮을 것"이라는 가정만 했을 뿐 실제로 계산한 적이 없었음.

### [종료]
3개 성공 기준 모두 실측 증거로 충족. `frontend-loop`에 커밋 진행.

---

## 통합 (merge) — `backend-loop` ← `frontend-loop` (공유 가능한 키워드 URL + 접근성 감사, `ad6e133`)

> `backend-loop`(HEAD `e30e3ae`)에서 `git merge frontend-loop`(`ad6e133`) 실행.
> `git merge-base HEAD frontend-loop`로 실제 공통 조상(`5383fcf`)을 먼저 확인한 뒤 진행
> — 지난 라운드에 잘못 짚은 적이 있어 이번엔 처음부터 정확한 베이스로 시작.

### [충돌 및 해소]
- `LOOP_LOG.md`만 content 충돌. `diff`로 `ours`(HEAD)의 처음 2876줄이 `5383fcf`와 정확히
  일치함을 먼저 확인한 뒤, `ad6e133`가 그 뒤에 추가한 구간(2877~3062행, "반복 12 —
  프론트엔드" 186줄)만 골라 이어붙임. 임시 파일에 조립 → 마커 없음 확인 → 조인부 확인 →
  반영.
- `package.json`/`package-lock.json` — 충돌 없이 자동 병합, `axe-core`(접근성 감사용)
  devDependency 추가 확인. 병합 후 `npm install`로 `node_modules` 동기화.
- 신규 `src/app/HomeClient.tsx`(서버 컴포넌트 `page.tsx`에서 `useSearchParams`를 쓰는
  클라이언트 부분을 분리 — Next.js가 `useSearchParams`를 정적 렌더링 트리에서 쓸 때
  요구하는 패턴), `src/hooks/useModalA11y.ts`(포커스 트랩/ESC 처리 등 접근성 훅) —
  프론트 영역, 코드 충돌 없음.
- 그 외(`globals.css`/`page.test.tsx`/`page.tsx`/`AuthModal.tsx`/`KeywordDetailModal.tsx`/
  `RankHistoryChart.tsx`) 자동 병합, 백엔드 이번 라운드 변경과 겹치는 파일 없음.

### [검증 — 통합 결과 실측]

```
npm run lint   → 빈 출력, exit 0
npm run test   → Test Files 10 passed (10), Tests 80 passed (80)  (74 + frontend 신규 6개)
npm run build  → Compiled successfully, 동일 9개 라우트 정상 생성
```

**`npm run dev -- -p 3001` + curl (실 크리덴셜)**

1) 딥링크 URL 파라미터(`?keyword=BIGBANG&region=KR`) 서버 사이드 확인: `HTTP 200`,
   85458 bytes, 실제 런타임 에러 패턴 0건 — 클라이언트 컴포넌트라 모달이 서버 HTML에
   나타나진 않지만(FLIP/라이트테마 라운드 때와 동일한 구조적 특성), 최소한 이 쿼리
   파라미터가 서버 렌더링을 깨지 않음을 확인. 모달이 실제로 열리는지는 오케스트레이터가
   이미 실제 딥링크 테스트로 확인했다고 보고함(이 세션은 서버 사이드만 재확인).
2) `/api/trends?region=KR` 재확인: `sources: ['youtube', 'hackernews']`, `mocked: False`,
   아이템 소스 혼합 정상 — 병합 후에도 다중 소스 블렌드 무사.
3) 나머지 라우트 전부 실측: `/api/trends/history`(200), `/api/trends/keyword-history`(200),
   `/auth/callback`(307), `/api/watchlist` GET/PATCH(세션 없음, 둘 다 401 — 지난 라운드에
   신설한 `PATCH`도 이번 병합에서 회귀 없음 확인), `/opengraph-image.png`(200, `file`로
   PNG 확인), cron 무비밀(401)/정상비밀(200).
4) rate limiting 회귀 확인: `/api/trends?region=JP` 35회 병렬 발사 → 200/429 혼재(정상).
5) **로그 전체 스캔**: `error|warn|fail` 패턴에서 이미 알려진 클래스 제외 **0건**. 모든
   `GET |POST |PATCH ` 로그 라인이 200/401/429/307 넷 중 하나로만 끝났는지 재검사 →
   **0건 이탈**. 서버 종료 후 포트 확인 → 정상 종료.

### [결론]
`ad6e133`(공유 가능한 키워드 URL + 접근성 감사) 반영 후 lint/test(80개)/build/dev 전
라우트 curl + rate-limit 회귀 확인까지 전부 그린. `backend-loop`에 머지 커밋 후 `main`으로
병합·푸시 예정.

**여전히 진행 중인 백엔드 블로커(이번 병합과 무관, 표준 보고)**: `0004_watchlist_last_seen_rank.sql`
아직 라이브 미적용 — SQL Editor 적용 필요, 적용 전까지 `GET`/`PATCH /api/watchlist`의
`current_rank`/`last_seen_rank` 필드는 여전히 코드 레벨에서만 검증된 상태.

---

## `0004_watchlist_last_seen_rank.sql` 라이브 적용 재검증

> 사용자가 SQL Editor에서 대기 중이던 SQL 전체(0004 포함)를 실행 완료. 0001~0003 때와
> 동일한 절차로 재검증 — 컬럼 존재 확인 + 실 데이터로 GET/PATCH 로직 종단 검증.

### [재검증 — 실측 증거]

**컬럼 존재 확인**: 서비스롤 클라이언트로 `watchlist.select("last_seen_rank, last_seen_at")`
직접 조회 → 에러 없음(`42703` 재현 안 됨) — 컬럼 라이브 존재 확인.

**실 유저 확인**: `client.auth.admin.listUsers()` → 실제 가입 유저 1명 존재
(`cho960229@gmail.com`) — 이전 라운드들에선 0명이었던 것과 달리 이번엔 실 유저가 있어
그 계정으로 종단 검증 가능. `/api/watchlist`는 모든 메서드가 세션을 요구해 이 세션에서
실 로그인 자체는 여전히 불가능하지만(프론트 인증 UI를 거쳐야 함), 서비스롤로 실 유저
ID를 사용해 `GET`/`PATCH`가 내부적으로 수행하는 것과 **완전히 동일한 SQL 시퀀스**를
직접 실행함으로써 라우트 로직 자체를 우회 없이 실데이터로 검증.

**시나리오 A — 실제로 랭킹에 있는 키워드**:
```
1. 워치리스트에 테스트 행 삽입 (user_id=실유저, keyword="HYBE", region="KR")
   → last_seen_rank: null, last_seen_at: null (신규 미확인 상태, 마이그레이션 의도대로)
2. GET 로직과 동일한 조회: 최신 KR 스냅샷에서 "HYBE" 검색 → current_rank = 1
   (실제로 그 시점 KR 랭킹 1위였던 진짜 데이터)
3. PATCH 로직과 동일한 갱신: last_seen_rank ← 1, last_seen_at ← now()
   → 결과: {"last_seen_rank":1,"last_seen_at":"2026-08-25T04:47:26.543+00:00"} 확인
```

**시나리오 B — 현재 랭킹에 없는 키워드(순위 밖으로 이탈한 경우 시뮬레이션)**:
```
1. 워치리스트에 테스트 행 삽입(keyword="__verification_test_not_ranked__", region="KR")
2. GET 로직: 최신 스냅샷에 없는 키워드 → current_rank = null
3. PATCH 로직: last_seen_rank ← null, last_seen_at ← now()
   → 결과: {"last_seen_rank":null,"last_seen_at":"2026-08-25T04:47:26.543+00:00"} 확인
```
"순위 밖"이 에러가 아니라 유효한 `null` 베이스라인으로 정확히 저장됨을 실측 확인 —
유닛 테스트가 검증한 것과 동일한 동작이 실 스키마·실 유저 계정에서도 그대로 성립.

**정리**: 두 테스트 행을 즉시 삭제(`delete().in("id", [...])`), 삭제 후 `watchlist` 행
개수 재조회 → **0건** — 실 유저 계정에 테스트 흔적을 남기지 않음.

**라우트 자체 sanity 확인**: dev 서버에서 `GET`/`PATCH /api/watchlist`(세션 없음) →
둘 다 여전히 `HTTP 401`(회귀 없음), dev 로그에 예상 밖 에러 없음.

### [검증] — 남아있던 성공 기준 대조
1. `last_seen_rank`/`last_seen_at` 컬럼 라이브 존재 → **충족**
2. `GET`의 `current_rank` 계산이 실 스냅샷 데이터로 정확 → **충족**(실제 1위 키워드로
   `current_rank=1` 실측)
3. `PATCH`가 서버 계산값으로 `last_seen_rank`/`last_seen_at`을 정확히 갱신 → **충족**
4. 순위 밖 키워드는 에러가 아니라 `null` 베이스라인 → **충족**(시나리오 B로 실측)

### [종료]
`0004` 라이브 적용 및 GET/PATCH 로직 완전히 검증됨(라우트 자체의 HTTP 호출은 여전히 실
로그인 세션이 있어야 가능하지만, 그 로직이 수행하는 실제 DB 연산은 실 유저 계정·실 스냅샷
데이터로 종단 검증 완료). `supabase/migrations/APPLIED.md`에서 `0004`를
`applied`(2026-08-25)로 갱신. 마이그레이션 관련 블로커 모두 해소 — 남은 것은 프론트
인증 UI를 통한 실 로그인 세션에서의 최종 확인뿐(이 세션 권한 밖, 계속 표준 한계로 보고).

## 반복 13 — 프론트엔드 (워치리스트 순위 변동 알림 루프 완성)

### [배경]
백엔드가 `GET /api/watchlist`에 `current_rank`/`last_seen_rank`/`last_seen_at`을,
`PATCH /api/watchlist {id}`(현재 순위를 새 베이스라인으로 승인)를 실 데이터로 라이브
검증까지 마쳐 출하함 — 데이터 배관은 완성됐지만 UI가 아직 아무것도 소비하지 않음. 이번
라운드가 그 소비 단.

### [목표]
1. `src/lib/watchlist.ts`를 실제 응답 형태(반복 6/8에서 했던 `history.ts`/`watchlist.ts`
   재조정과 동일한 규율)로 갱신, `PATCH` 클라이언트 신설
2. `current_rank`가 `last_seen_rank`와 의미 있게 다를 때 눈에 띄는 표시("3위 → 1위" 등,
   기존 행별 `RankDelta`—스냅샷 간 일별 변동—와는 다른 개념) — `last_seen_rank`가
   `null`(첫 확인, 베이스라인 없음)과 `current_rank`가 `null`(순위 이탈, "변화 없음"과
   조용히 동일시하면 안 되는 별개 상태) 각각 처리
3. 사용자가 실제로 그 키워드의 상세를 볼 때(`KeywordDetailModal`을 워치리스트 항목으로
   여는 것이 자연스러운 트리거) `PATCH`로 승인 — 승인 후 "변동" 표시가 페이지 새로고침
   없이 갱신/해제
4. 실 로그인 세션을 구동할 방법이 이 세션엔 없음(백엔드 트랙이 반복적으로 지적한 표준
   한계) — 검증 가능한 것만: null/non-null 조합 목업 테스트, 확인-온-뷰 플로우, 로그아웃
   상태 점검. 실 세션 대비 미검증 항목은 로그에 명시
5. lint/test/build 클린, 증거 첨부

### [계획]
1. `git merge main` — 백엔드의 `0004` 마이그레이션+`current_rank`/PATCH 로직만 추가,
   프론트 파일 충돌 없음(fast-forward)
2. `src/app/api/watchlist/route.ts` 직접 조회 — GET/POST/PATCH/DELETE 4개 핸들러의 실제
   응답 스키마를 코드에서 직접 확인(추측 금지, 반복 6 규율 반복): GET은 매 항목에
   `current_rank` 포함, POST는 `.select()`에 `current_rank`가 없어 **응답에서 그 필드
   자체가 없음**(단순히 `null`이 아니라 키 자체 부재), PATCH는 서버가 직접 계산한
   `current_rank`로 응답
3. `WatchlistRow`에 `last_seen_rank: number|null`, `last_seen_at: string|null`,
   `current_rank?: number|null`(POST 응답엔 부재 가능하니 optional) 추가, 타입가드도 이
   구분(부재 vs `null`)을 정확히 반영
4. 순수 함수 `describeRankChange(row)`를 신설해 5가지 상태를 명시적으로 구분: `unknown`
   (POST 직후처럼 `current_rank` 자체가 없음) / `dropped`(명확히 순위 밖, `current_rank
   === null`) / `new`(순위는 있으나 `last_seen_rank === null`이라 비교 불가) / `unchanged`
   / `moved`(from/to) — "부재"와 "확정된 null"을 같은 걸로 뭉뚱그리지 않도록 처음부터
   타입 레벨에서 분리
5. `WatchlistPanel`을 "보기"(칩 클릭 → 상세 열기)와 "제거"(별도 ✕ 버튼)로 분리 — 기존엔
   칩 전체가 제거 버튼이라 "보기" 동작을 넣을 자리가 없었음
6. `HomeClient.tsx`: 워치리스트 항목 전용 `viewWatchlistItem(keyword, itemRegion)` 신설
   (기존 `openDetail`은 클로저의 현재 `region` state를 쓰는데, 워치리스트 항목은 다른
   지역일 수 있어 그대로 쓰면 URL에 잘못된 지역이 잠깐 들어감 — 항목 자신의 region을
   직접 넘기고 `setRegion`도 같이 호출해 탭 하이라이트까지 맞춤), `detailKeyword`/`region`
   변경 시 워치리스트에서 매칭되는 항목을 찾아 `current_rank !== last_seen_rank`일
   때만 `PATCH` 호출하는 이펙트 신설(이미 같으면 스킵 — 불필요한 호출 방지 + 승인 후
   재실행되어도 가드에 걸려 무한루프 안 됨)
7. 신규 유닛 테스트(`describeRankChange` 5개 케이스) + `page.test.tsx`에 배지 렌더링/
   확인-온-뷰/로그아웃 상태 통합 테스트 추가
8. lint → test → build, 실 dev 서버로 로그아웃 상태만 스크린샷(로그인 상태는 검증 불가
   — [한계] 참고), dev 서버 종료

### [실행 + 관찰]

**`src/app/api/watchlist/route.ts` 실제 계약 확인**(추측 없이 코드 직접 조회): GET은
`select("id, keyword, region, created_at, last_seen_rank, last_seen_at")` 후 각 행에
`current_rank`(스냅샷 조회로 계산)를 붙여 반환. POST는 `.select()`에 `current_rank`가
빠져 있어 **생성 직후 응답엔 그 키 자체가 없음** — `null`이 아니라 정말 없음. 이 차이를
`describeRankChange`의 `unknown` 케이스로 명시적으로 분리(반복 8/9 등에서 이미 자리잡은
"부재와 null을 구분한다" 원칙 재적용).

**신규 파일**: `src/lib/watchlist.test.ts`(`describeRankChange` 5케이스 — new/dropped/
unchanged/moved-up/moved-down, `unknown` 포함).

**수정 파일**: `src/lib/watchlist.ts`(`WatchlistRow` 필드 확장, 타입가드 갱신,
`acknowledgeWatchlistItem` 신설, `describeRankChange` 신설), `src/components/
WatchlistPanel.tsx`(보기/제거 버튼 분리, `RankChangeBadge` 렌더링), `src/app/
HomeClient.tsx`(`viewWatchlistItem`, 확인-온-뷰 이펙트, `WatchlistPanel`에 `onView` 연결),
`src/app/page.test.tsx`(신규 4개 테스트: 로그아웃 시 워치리스트 UI 전무, 5가지 배지 조합,
확인-온-뷰로 배지가 새로고침 없이 갱신, 패널 자체 제거 버튼).

**구현 중 발견한 실제 버그 2건**(둘 다 스크린 리더 접근성과도 맞물림):
1. 워치리스트 패널의 새 ✕ 제거 버튼에 `aria-label="워치리스트에서 제거"`를 달았더니,
   랭킹 행의 별표 토글 버튼도 워치 중일 땐 정확히 같은 `aria-label`을 씀 — 두 버튼의
   접근 가능한 이름이 우연히 동일해져(같은 키워드가 패널과 랭킹 리스트 양쪽에 동시에
   존재할 때) 테스트에서 "다중 매치"로 발견. `${keyword} 워치리스트에서 제거`로 키워드를
   포함시켜 고유하게 만듦 — 항목이 여러 개일 때 스크린 리더 사용자에게도 더 명확한 이름이라
   부수적으로 접근성도 개선됨.
2. "보기" 버튼에 별도 `aria-label`을 안 주고 텍스트 콘텐츠(지역+키워드+배지)로만
   구분하려 했더니, 배지 텍스트("5위 → 1위")까지 접근 가능한 이름에 섞여 들어가 테스트
   쿼리가 불안정해짐 — `${keyword} 상세 보기`로 명시적 `aria-label`을 줘서 배지 유무와
   무관하게 안정적인 이름을 갖도록 정리.

**`npm run lint`** — 통과(에러/경고 없음).

**`npm run build`** — 1차 실행에서 `page.test.tsx`의 기존 POST 목업 픽스처가
`last_seen_rank`/`last_seen_at` 없이 `WatchlistRow`를 구성해 타입체크 실패(`error TS2739`)
→ 실제 POST 응답 형태(두 필드는 `null`로 존재, `current_rank`만 부재)에 맞게 픽스처
보정 → 재실행 통과.

**`npm run test`**
```
 Test Files  11 passed (11)
      Tests  89 passed (89)
```
89개 전부 통과(기존 77개 + `watchlist.test.ts` 5개 + `page.test.tsx` 신규 4개) — 2차
디버깅 라운드에서 잡은 것: (a) 이미 워치리스트에 있는 키워드로 시작하는 두 신규 테스트가
`findByText`로 "로딩 완료" 확인할 때 그 키워드가 패널과 랭킹 리스트 양쪽에 동시에 존재해
"다중 매치" 실패 → `findAllByText`로 교체, (b) 위에서 기록한 두 아이콘 버튼 이름 충돌.

**`npm run build`(최종)** — 클린, 라우트 구성 변화 없음(UI 전용 변경).

**로그아웃 상태 실측 스크린샷** (dev 서버 `-p 3008`, 실 데이터): "내 워치리스트" 텍스트
0개, `aria-label*="워치리스트"` 버튼 0개 — 워치리스트 UI가 정말 아무 흔적도 안 남기고
완전히 사라짐을 실측 확인(스크린샷 첨부, 랭킹 리스트 자체는 정상 표시).

**dev 서버 종료**: `lsof -ti:3008 | xargs kill` 후 포트 확인 → 정상 종료. 스크래치 스크립트
삭제, 커밋 대상 아님.

### [검증] — 성공 기준 대조
1. `watchlist.ts`가 실제 GET/POST/PATCH 응답 형태를 정확히 반영(POST의 `current_rank`
   부재까지) → **충족**
2. 5가지 조합(모름/이탈/신규/변화없음/이동) 모두 구분된 표시, null 두 종류(부재 vs 확정
   이탈)를 하나로 뭉개지 않음 → **충족**
3. 상세 보기 시 `PATCH` 자동 호출, 배지가 새로고침 없이 갱신(테스트로 확인) → **충족**
4. 목업 테스트로 null/non-null 조합 + 확인-온-뷰 플로우 + 로그아웃 상태(목업+실 브라우저
   이중 확인) → **충족**. 실 로그인 세션 대비 검증은 아래 [한계] 참고
5. lint/test(89개)/build 클린, 증거 첨부 → **충족**

### [한계] — 실 세션 대비 미검증 (지시대로 명시, 해결 시도 안 함)
- 실제 Supabase 인증 세션에서 워치리스트에 항목을 추가하고, 시간이 지나 순위가 실제로
  바뀐 뒤 상세를 열어 배지가 뜨는지/PATCH 후 사라지는지는 이 세션에서 구동 불가(백엔드
  트랙이 반복 지적한 것과 동일한 헤드리스 로그인 불가 한계). 백엔드가 라우트 로직 자체는
  실 DB로 종단 검증했으므로(바로 위 반복 항목 참고) API 계약은 신뢰할 수 있는 근거가
  있으나, 프론트 UI가 실 세션에서 그 응답을 정확히 소비하는지는 다음에 실 로그인이
  가능해지는 시점에 재확인 필요.

### [종료]
5개 성공 기준 모두(4번은 목업 범위 내에서) 실측 증거로 충족. `frontend-loop`에 커밋 진행.

---

## 통합 (merge) — `backend-loop` ← `frontend-loop` (워치리스트 알림 UI, `6fdb481`)

> `backend-loop`(HEAD `f3f2ba8`)에서 `git merge frontend-loop`(`6fdb481`) 실행.
> `frontend-loop`의 부모가 정확히 `f3f2ba8`라 순수 fast-forward, 충돌 없음.

### [확인 — 계약 일치]
`src/lib/watchlist.ts`를 열어 프론트가 내가 지난 라운드에 만든 `GET`/`PATCH` 응답 계약을
정확히 소비하는지 확인: `current_rank?: number | null`(POST 응답엔 없음을 정확히 문서화한
주석까지 있음 — POST의 `.select()`가 `current_rank`를 계산하지 않는다는 것까지 정확히
파악), `last_seen_rank`/`last_seen_at` nullable 처리, `describeRankChange`의 5-상태 분기
(`current_rank === undefined` → unknown/`null` → dropped/`last_seen_rank === null` → new/
같으면 unchanged/다르면 moved)가 내가 설계한 API 시맨틱과 정확히 맞아떨어짐 — 별도 조정
불필요.

### [검증 — 통합 결과 실측]
```
npm run lint   → 빈 출력, exit 0
npm run test   → Test Files 11 passed (11), Tests 89 passed (89) (오케스트레이터 보고와 일치)
npm run build  → Compiled successfully, 동일 9개 라우트 정상 생성
```

**`npm run dev -- -p 3001` + curl (실 크리덴셜)**
```
GET  /api/trends?region=KR   → sources:['youtube','hackernews'], mocked:False
GET/POST/PATCH/DELETE /api/watchlist (세션 없음) → 전부 HTTP 401(4개 메서드 전부 재확인 —
  이번 라운드부터 프론트가 실제로 PATCH를 호출하게 됐으므로 특히 중요)
GET  /api/trends/history?region=KR                           → HTTP 200
GET  /api/trends/keyword-history?keyword=HYBE&region=KR      → HTTP 200
GET  /auth/callback (code 없음)                                → HTTP 307
GET  /opengraph-image.png                                     → HTTP 200, `file`로 PNG 확인
```
rate limiting 회귀 확인: `/api/trends?region=US` 35회 병렬 발사 → 200/429 혼재(정상).
로그 전체 스캔: 이미 알려진 클래스 제외 `error|warn|fail` **0건**, 모든 로그 라인이
200/401/429/307 중 하나로만 끝남. 서버 종료 후 포트 확인 → 정상 종료.

### [결론]
`6fdb481`(워치리스트 알림 UI) 반영 후 lint/test(89개)/build/dev 8라우트 curl(워치리스트
4개 메서드 포함) + rate-limit 회귀 확인까지 전부 그린. 순수 fast-forward라 병합 충돌
자체는 없었지만 라이브 배포 전이라 검증은 생략하지 않음. `backend-loop`가 이미
`6fdb481`(fast-forward 결과)이므로 별도 머지 커밋 없이 `main`으로 fast-forward·푸시 진행.
마이그레이션 관련 블로커 없음 — 0001~0004 전부 라이브 적용/검증 완료 상태.

## 반복 14 — 프론트엔드 (키워드 검색/필터)

### [배경] 및 [목표]
현재 로드된 랭킹 리스트 안에서 특정 키워드를 빠르게 찾을 수 있게 — 신규 API 없이 클라이언트
사이드로만. (1) 검색/필터 입력(배치·상호작용 자유), 대소문자 무시, 한글/영문 모두 지원.
(2) "매치 없음" 빈 상태를 "데이터 자체가 없음" 빈 상태와 구분. (3) 필터링이 워치리스트
별표 토글/키워드 상세 모달/딥링크(`?keyword=X&region=KR`)를 깨지 않음 — 필터로 가려진
키워드라도 공유된 링크는 열려야 함. (4) 접근성(실제 라벨, 결과 수/매치 없음 상태 안내) —
반복 12에서 만든 기준 유지. (5) 테스트(매치/매치없음/지우기/한글+영문). (6) 필터된 상태
스크린샷.

### [계획]
1. `git merge main` — 커밋 없음(fast-forward, 로그만 추가)
2. 배치: 헤더는 반복 6에서 이미 모바일 줄바꿈 문제를 겪었던 자리라 컨트롤을 더 늘리지
   않고, `<main>` 최상단(배너들보다 위)에 전용 검색 행으로 배치 — `data && !isEmpty`일
   때만 노출(검색할 게 없으면 안 보여줌)
3. 상태: `filterQuery`는 URL과 동기화하지 않는 순수 클라이언트 상태로 유지 — 딥링크
   (`?keyword=`)가 필터와 절대 상호작용하지 않도록 애초에 설계로 분리(반복 12에서 만든
   `detailKeyword`는 별도 fetch로 열리므로 필터링된 리스트와 무관하게 항상 동작해야 함)
4. `filteredItems = data.items.filter(keyword.toLowerCase().includes(query))` — 한글은
   대소문자 개념이 없어 `.toLowerCase()`가 자연스럽게 no-op, 영문만 실제로 영향받음(로케일
   엣지케이스 없는 안전한 패턴)
5. "매치 없음" 빈 상태는 기존 "데이터 없음" 빈 상태와 문구·트리거 조건 모두 다르게(검색어
   인용 + 지우기 버튼)
6. 키보드 단축키 `/`로 검색창 포커스(GitHub/Slack 관례) — 단, 이미 입력 중이거나(다른
   input/textarea) 모달이 열려있을 때(포커스 트랩을 깨뜨리므로)는 비활성화
7. `aria-live="polite"` 결과 수 안내, `<label htmlFor>` 명시적 연결
8. 신규 테스트(라벨/한글 필터/영문 필터/매치없음+지우기/인라인 ✕/필터 중 딥링크/필터 중
   워치리스트 토글), lint → test → build, axe 스캔(필터됨 상태 + 매치없음 상태 둘 다) +
   실제 브라우저로 `/` 단축키 확인 + 스크린샷, dev 서버 종료

### [실행 + 관찰]

**수정 파일**: `src/app/HomeClient.tsx`(검색 상태/필터링/단축키/UI), `src/app/page.test.tsx`
(신규 7개 테스트).

**구현 중 테스트로 발견한 실제 버그 2건** (검사가 아니라 실행 결과로 발견):
1. 인라인 ✕ 버튼(`aria-label="검색어 지우기"`)과 "매치 없음" 빈 상태의 텍스트 버튼(같은
   문구 "검색어 지우기")이 우연히 정확히 같은 접근 가능한 이름을 갖게 됨 — 테스트에서
   "다중 매치"로 발견. 빈 상태 버튼을 "전체 목록 보기"로 바꿔 해소 — 단순 충돌 회피가
   아니라 "검색어를 지운다"보다 "전체 목록으로 돌아간다"는 게 그 특정 문맥(매치가 0개인
   상태)에서 더 목적에 맞는 문구라 카피도 함께 개선됨.
2. 딥링크 테스트에서 애초에 잘못된 단정문 작성 — 필터링 후 "BIGBANG Concert Recap" 텍스트가
   "문서 어디에도 없어야 한다"고 검사했는데, 모달이 이미 열려 있어 그 키워드가 모달
   `<h2>` 제목에 정당하게 남아있는 게 당연했음(테스트 자체가 틀렸던 것, 코드는 맞았음) →
   랭킹 행의 키워드 **버튼**만 특정해서(role 쿼리) 사라졌는지 확인하도록 수정, 모달은
   여전히 열려있는지도 별도로 재확인.

**`npm run lint`** — 통과(에러/경고 없음).
**`npm run build`** — 클린, 라우트 구성 변화 없음(클라이언트 전용 기능).

**`npm run test`**
```
 Test Files  11 passed (11)
      Tests  96 passed (96)
```
96개 전부 통과(기존 89개 + 신규 7개: 라벨 존재, 한글 필터, 영문 필터, 매치없음+지우기,
인라인 ✕로 지우기, 필터 중에도 딥링크 정상 오픈, 필터 중에도 워치리스트 별표 토글 정상).

**실 브라우저 검증** (dev 서버 `-p 3009`, 실 데이터 — 이 시점 KR 1위/3위가 각각
"알파드라이브원"/"알디원"이라 "알"로 실측 필터):
```
"/" 입력 후 활성 요소 id: keyword-filter (기대값과 일치)
"알" 입력 → 결과 수: 2개 결과 (실측: 1위/3위 두 항목, 원래 순위 번호 유지된 채 필터링)
axe violations (필터된 상태): 0
axe violations (매치없음 상태): 0
```
스크린샷 2장(필터됨/매치없음)으로 시각 확인 — 매치없음 상태가 "데이터 자체 없음" 상태와
문구·아이콘 배치는 같은 `EmptyFlaps` 계열을 쓰되 텍스트("‘완전히없는검색어XYZ123’에 대한
결과가 없습니다" + "전체 목록 보기")로 명확히 구분됨을 확인.

**dev 서버 종료**: `lsof -ti:3009 | xargs kill` 후 포트 확인 → 정상 종료. 스크래치 스크립트
삭제, 커밋 대상 아님.

### [검증] — 성공 기준 대조
1. 검색 입력(대소문자 무시, 한글+영문) → **충족**(실측 스크린샷+테스트)
2. 매치없음 빈 상태가 데이터없음 상태와 구분됨(문구/트리거 조건 다름) → **충족**
3. 워치리스트 별표/키워드 상세 모달/딥링크 전부 필터와 무관하게 정상 동작(딥링크는 애초에
   구조적으로 분리돼 있었고, 별표 토글도 필터된 리스트에 남은 항목 기준으로 정상 동작함을
   테스트로 확인) → **충족**
4. 실제 라벨(`htmlFor`), `aria-live` 결과 수 안내, axe 스캔 0 violations(양쪽 상태 모두) →
   **충족**
5. 매치/매치없음/지우기(양쪽 버튼)/한글/영문 테스트 전부 통과, 기존 스위트 무회귀 →
   **충족**
6. 필터된 상태 스크린샷 첨부 → **충족**

### [개선/반복]
1회 반복으로 6개 기준 모두 충족되어 추가 반복 불필요(규칙 9). 정직하게 기록할 점: 검색은
현재 로드된 리스트(최대 20개 항목)에서만 동작 — 전체 히스토리나 워치리스트까지 검색하는
기능은 이번 요청 범위 밖(명시적으로 "the currently loaded ranking list"라고 한정됨)이라
스코프 안에 두지 않음.

### [종료]
6개 성공 기준 모두 실측 증거로 충족. `frontend-loop`에 커밋 진행.

---

## 통합 (merge) — `backend-loop` ← `frontend-loop` (키워드 검색, `984e38e`)

> `backend-loop`(HEAD `65a272c`)에서 `git merge frontend-loop`(`984e38e`) 실행.
> `frontend-loop`의 부모가 정확히 `65a272c`라 순수 fast-forward, 충돌 없음. 변경 파일이
> `HomeClient.tsx`/`page.test.tsx`뿐 — 클라이언트 사이드 필터링(이미 불러온 최대 20개
> 항목 내 검색)이라 백엔드 계약/라우트와 접점 없음.

### [검증 — 통합 결과 실측]
```
npm run lint   → 빈 출력, exit 0
npm run test   → Test Files 11 passed (11), Tests 96 passed (96) (오케스트레이터 보고와 일치)
npm run build  → Compiled successfully, 동일 9개 라우트 정상 생성
```

**`npm run dev -- -p 3001` + curl (실 크리덴셜, 전 라우트)**
```
GET  /                                                       → HTTP 200, 실제 에러 패턴 0건
GET  /api/trends?region=KR   → sources:['youtube','hackernews'], mocked:False
GET  /api/trends/history?region=KR                           → HTTP 200
GET  /api/trends/keyword-history?keyword=HYBE&region=KR      → HTTP 200
GET  /auth/callback (code 없음)                                → HTTP 307
GET/PATCH /api/watchlist (세션 없음)                            → 둘 다 HTTP 401
GET  /opengraph-image.png                                     → HTTP 200, `file`로 PNG 확인
POST /api/cron/refresh-trends (secret 없음/정상)                → HTTP 401 / 200
```
rate limiting 회귀 확인: `/api/trends?region=JP` 35회 병렬 발사 → 200/429 혼재(정상).
로그 전체 스캔: 이미 알려진 클래스 제외 `error|warn|fail` **0건**, 모든 로그 라인이
200/401/429/307 중 하나로만 끝남(이탈 0건). 서버 종료 후 포트 확인 → 정상 종료.

### [결론]
`984e38e`(키워드 검색) 반영 후 lint/test(96개)/build/dev 전 라우트 curl + rate-limit
회귀 확인까지 전부 그린 — 순수 fast-forward, 백엔드 영역과 무관한 변경이었지만 라이브
배포 전이라 검증은 생략하지 않음. `backend-loop`가 이미 `984e38e`(fast-forward
결과)이므로 별도 머지 커밋 없이 `main`으로 fast-forward·푸시 진행. 마이그레이션 관련
블로커 없음(0001~0004 전부 라이브 적용/검증 완료).

---

## 반복 — 백엔드 (프로덕션급 보안 헤더)

> 사이트가 이제 실제로 라이브·공개 상태인데 보안 헤더가 전혀 없는 상태 — 이번 라운드에서
> 해소. `git merge main` → 이미 최신(변경 없음). **참고**: 세션이 도중에 컨텍스트 한도로
> 한 번 끊겼다 재개됨 — 끊긴 시점엔 Next 16 공식 CSP 문서(`node_modules/next/dist/docs/...`)를
> 읽던 중이었고 코드는 전혀 작성되지 않은 상태였음, 재개 후 `git status`/`git log`로
> 확인한 뒤 그 지점부터 이어서 진행.

### [목표]
1. `next.config.ts`의 `headers()` 또는 `src/proxy.ts` 중 적절한 레이어에 보안 헤더 구성 —
   `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`(또는 동등한 CSP
   `frame-ancestors`), `Referrer-Policy: strict-origin-when-cross-origin`, 앱이 실제로
   필요로 하는 것에 맞춘 진짜 `Content-Security-Policy`(만능 와일드카드 금지), 프로덕션용
   `Strict-Transport-Security`
2. 아무것도 깨뜨리지 않기 — Supabase 인증, OG 이미지 라우트, 일반 페이지 렌더링 전부
   새 CSP 아래서 정상 동작해야 함. 실제로 테스트("동작할 것"이 아니라)
3. 실측 curl로 페이지/API 응답 둘 다에 헤더가 존재함을 확인, 새 CSP 아래서
   auth callback/워치리스트/트렌드까지 앱이 종단으로 정상 동작함을 확인. 실제 dev 서버
   구동 중 브라우저 콘솔에서 CSP 위반이 없는지 확인(정책이 이론적으로 맞다고 믿지 말 것)
4. lint/build 클린, 근거 첨부

### [계획]
1. **레이어 결정**: Next 16 공식 CSP 가이드(`node_modules/next/dist/docs/01-app/02-guides/
   content-security-policy.md`)를 먼저 읽음 — nonce 기반 CSP는 모든 페이지를 동적 렌더링으로
   강제 전환해야 함(정적 최적화 상실, 현재 `/`와 `/opengraph-image.png`가 정적으로 생성되고
   있음)을 확인. 이 앱은 nonce가 필요할 만큼 엄격한 인라인 스크립트 요구사항이 없어(Next
   자체가 내보내는 것 외 커스텀 인라인 스크립트 없음), 문서가 권장하는 "Without Nonces"
   경로(`next.config.ts`의 `headers()`에 정적 CSP)를 채택 — 정적 최적화 유지, `proxy.ts`는
   건드리지 않음(세션 갱신이라는 기존 역할과 무관한 관심사를 섞지 않기 위해).
2. **앱이 실제로 필요로 하는 외부 출처 조사**(추측 대신 코드로 확인):
   - 브라우저가 직접 통신하는 서드파티는 Supabase 하나뿐(`src/lib/supabase/browser.ts`의
     `createBrowserClient`가 REST/인증 엔드포인트에 직접 요청) — `grep`으로 클라이언트
     코드에 `fetch("http...")` 같은 절대 URL 호출이 전혀 없음을 확인(YouTube/HN은 전부
     서버 사이드 `src/lib/trends/*.ts`에서만 호출되므로 브라우저 CSP와 무관)
   - realtime/websocket 사용 여부 확인 — `.channel(`/`postgres_changes` 등 grep 결과 0건,
     `wss://` 허용 불필요
   - 폰트는 `next/font/google`로 빌드 타임에 자체 호스팅됨(`/_next/static`에서 서빙) —
     `fonts.googleapis.com` 등 외부 폰트 CDN 허용 불필요
   - `<img>`/`next/image`/`thumbnailUrl` 렌더링 여부 확인 — 코드베이스 전체에 0건, OG
     이미지는 정적 PNG 파일(`opengraph-image.png`)이라 런타임 이미지 생성도 없음 —
     `img-src`는 `'self' data:`만으로 충분(`blob:` 불필요, 실제 사용처 없음)
3. `connect-src`의 Supabase 출처는 하드코딩하지 않고 `NEXT_PUBLIC_SUPABASE_URL`에서
   `new URL(...).origin`으로 동적 계산 — 프로젝트를 다른 Supabase 인스턴스로 바꿔도 코드
   변경 불필요
4. `X-Frame-Options: DENY`와 CSP `frame-ancestors 'none'` 둘 다 설정(과제가 "OR"로
   허용했지만 비용이 거의 없어 구형 브라우저 호환까지 확보하는 쪽을 선택)
5. HSTS는 `NODE_ENV === "production"`일 때만 추가 — 로컬 dev(http)에 HSTS를 보내는 건
   의미가 없을뿐더러(브라우저가 http에서는 무시하지만 애초에 보낼 이유가 없음) 틀린
   신호. 값은 `max-age=63072000; includeSubDomains; preload`(2년, HSTS preload list
   등재 요건을 충족하는 표준값)
6. `'unsafe-eval'`은 dev에서만(React의 서버 에러 스택 재구성에 필요, 문서에 명시된 사실),
   `upgrade-insecure-requests`는 prod에서만
7. `npm run lint/build` → dev 서버 기동 → curl로 페이지/API 헤더 실측 확인 → **Playwright로
   실제 헤드리스 브라우저 구동**(이 워크트리에 이미 devDependency로 설치돼 있음, 이전
   프론트 라운드의 접근성 감사 때 설치됨) — 페이지 로드, 지역 탭 전환, 인증 모달 열고 실제
   로그인 시도(Supabase 브라우저 클라이언트가 실제로 `connect-src` 대상에 fetch하도록),
   키워드 상세 클릭, `/auth/callback` 이동까지 실제 브라우저 세션으로 수행하며
   `securitypolicyviolation` DOM 이벤트와 콘솔 에러를 전부 수집 → 0건이어야 통과
8. 프로덕션 빌드(`npm run build && npm run start`)로 HSTS 헤더 존재 + `'unsafe-eval'` 부재
   확인, 동일한 Playwright 워크스루를 프로덕션 빌드에도 한 번 더 실행(라이브 배포로 이어지는
   변경이라 dev만으로 끝내지 않음)

### [실행 + 관찰]

**Next 16 CSP 문서 확인**: `content-security-policy.md`의 "Without Nonces" 섹션이 정확히
이 앱에 맞는 패턴 — nonce 없이 `next.config.ts`의 `headers()`에서 정적 CSP 문자열을
반환하는 방식. `unsafe-inline`을 쓰더라도 모든 다른 디렉티브가 `'self'`로 좁혀져 있으면
"만능 와일드카드"와는 다르다는 것을 문서 자체가 이 경로의 정당한 트레이드오프로 제시함.

**신규 설정 파일**: `next.config.ts` 전면 작성 — `buildCsp()`(dev/prod 분기 포함),
`supabaseOrigin()`(env var에서 동적 추출), `securityHeaders` 배열(5개 헤더, HSTS는
prod에서만 배열에 추가), `headers()` async 함수가 `source: '/(.*)'`로 전체 라우트에 적용.

**`npm run lint`** → 빈 출력, exit 0

**`npm run build`** → 클린. 라우트 목록에서 `/`, `/opengraph-image.png`가 여전히
`○`(정적)로 유지됨을 확인 — nonce 없는 경로 선택이 실제로 정적 최적화를 보존함을
빌드 출력으로 실측.

**`npm run test`** → 96개 전부 통과(설정 파일만 바뀐 변경이라 예상대로 회귀 없음).

**dev 서버(`:3001`) curl 헤더 실측**:
```
=== / ===
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';
  connect-src 'self' https://<실제 프로젝트 ref>.supabase.co; object-src 'none';
  base-uri 'self'; form-action 'self'; frame-ancestors 'none'

=== /api/trends ===
(동일한 5개 헤더 전부 존재 — API 응답에도 적용됨을 확인)
```
`connect-src`가 실제 `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`에서 정확히 파생된 실제
프로젝트 origin임을 확인(하드코딩 아님, 동적 계산 실증).

**Playwright 실 브라우저 워크스루(dev, `:3001`)**: 헤드리스 크로미움으로 ①`/` 로드 →
②지역 탭 US 클릭 → ③로그인 버튼 클릭 후 실제 이메일/비밀번호 입력 + 제출(Supabase
브라우저 클라이언트가 실제로 `connect-src`의 Supabase origin에 fetch를 시도하도록 강제) →
④랭킹 아이템 클릭(키워드 상세) → ⑤`/auth/callback` 직접 이동, 전 과정에서
`securitypolicyviolation` DOM 이벤트 리스너 + `console` 에러 수집:
```
CSP violations (securitypolicyviolation events): []
Console errors: []
PASS: zero CSP violations across the full walkthrough
```
dev 서버 로그에도 이 워크스루로 인한 예상 밖 에러 없음(실패한 로그인 시도로 인한
`GET /?auth_error=1 200` 리다이렉트 로그만 있음 — 의도된 정상 동작, 존재하지 않는
이메일/틀린 비밀번호로 로그인 시도했으니 실패하는 게 맞음).

**기능 회귀 확인(새 헤더 아래서)**: `/api/trends`(다중 소스 블렌드 정상),
`/api/trends/history`(200), `/api/trends/keyword-history`(200), `/auth/callback`(307),
`/api/watchlist` GET(401), `/opengraph-image.png`(200, `file`로 PNG 확인), cron
정상비밀(200) — 전부 정상. rate limiting도 35회 병렬 발사로 재확인(200/429 혼재, 정상).

**프로덕션 빌드(`npm run build && npm run start -p 3002`) 재검증**:
```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload   ← prod에서만 등장, 실측 확인
Content-Security-Policy: ...script-src 'self' 'unsafe-inline';...upgrade-insecure-requests
  ← 'unsafe-eval' 없음(dev 전용이었던 게 실제로 빠짐), upgrade-insecure-requests 추가됨
```
동일한 Playwright 워크스루를 프로덕션 빌드에도 재실행 → 동일하게
`CSP violations: []`, `Console errors: []`. 프로덕션 로그 스캔에서도 예상 밖 에러 0건.
두 서버 모두 정상 종료 확인(포트 재확인).

### [검증] — 성공 기준 대조
1. `next.config.ts`의 `headers()`에 5개 헤더(CSP 포함, 실제 필요 출처로 좁힘) 구성 →
   **충족**
2. Supabase 인증/OG 이미지/일반 렌더링 전부 새 CSP에서 정상 동작 → **충족**(Playwright
   실 브라우저로 로그인 시도까지 실제로 수행해 확인, 추측 아님)
3. curl로 페이지+API 헤더 존재 실측, 새 CSP 아래 종단 기능 확인, 브라우저 콘솔 CSP 위반
   0건 실측 → **충족**(dev + prod 두 빌드 모두)
4. lint/build 클린 → **충족**

### [개선/반복]
1회 반복으로 4개 기준 모두 실측 충족. 추가 반복 불필요(규칙 9). 정직하게 기록할 점:
`script-src`/`style-src`에 `'unsafe-inline'`을 그대로 둠(nonce 미사용) — 완벽히 엄격한
CSP는 아니지만, 다른 모든 디렉티브를 `'self'`로 좁히고 `connect-src`도 실제로 필요한
Supabase origin 하나로만 제한해 "와일드카드로 방어를 무력화"하지는 않았다는 것이 이번
요청의 실제 기준. 향후 XSS 방어를 한 단계 더 강화하려면 nonce 기반 CSP + 관련 페이지의
동적 렌더링 전환을 별도 라운드로 고려 가능(정적 최적화 트레이드오프가 있어 이번 라운드
범위 밖으로 의도적으로 둠).

### [종료]
4개 성공 기준 모두 실측 증거로 충족 — curl 헤더 확인뿐 아니라 실제 헤드리스 브라우저로
로그인 시도까지 수행해 CSP 위반 0건을 dev/prod 양쪽에서 확인. 마이그레이션/DB 변경
없음(순수 설정 변경), 블로커 없음.

## 반복 15 — 프론트엔드 (SEO 크롤링 + 정적 요금제 페이지)

### [배경] 및 [목표]
사이트가 공개된 상태라 두 가지가 필요: (1) SEO 크롤링 — Next.js 파일 컨벤션으로
`sitemap.ts`/`robots.ts`(정적 파일 없이), 홈 페이지 최소 포함(지역 변형은 선택), `/api/*`
`/auth/*`는 크롤링 차단. (2) 정적 `/pricing` 페이지 — 지금 제품에는 무료/프리미엄 가치를
설명하는 곳이 어디에도 없음(Stripe 연동 자체는 별도로 계정 이슈로 막혀있어, 이번 건 순수
정보성 페이지). 무료 티어(오늘의 랭킹, 기본 검색) + 프리미엄 티어(실제로 만들어진 것 대비
차별화될 만한 것 — 판단은 자유, CSV 내보내기처럼 아직 없지만 "예정"으로 명시하는 건 허용) +
정직한 CTA(가짜 "구매하기" 버튼 금지, "곧 출시"/대기자 명단 식). FLIP 고유의 보이스/디자인
시스템 유지 — 템플릿처럼 보이기 가장 쉬운 페이지 유형이라 다른 화면과 같은 수준의 디자인
주의 요구됨.

### [계획]
1. `git merge main` — fast-forward, 코드 충돌 없음(로그만 추가된 상태)
2. 기존 컨벤션 확인: `layout.tsx`의 `NEXT_PUBLIC_SITE_URL` 폴백 패턴 재사용,
   `src/lib/trends/regions.ts`의 `REGIONS`(KR/US/JP) 재사용
3. `sitemap.ts`: 홈("/") + 지역별 쿼리 변형(`/?region=KR|US|JP`, 지역마다 실제로 다른
   랭킹 콘텐츠를 서빙하므로 별도 엔트리로 정당화) + `/pricing`. 갱신 주기는 실제 cron
   갱신 빈도에 맞춰 홈/지역은 `hourly`, 요금제는 `monthly`
4. `robots.ts`: `allow: "/"`, `disallow: ["/api/", "/auth/"]`, sitemap 링크 포함
5. `/pricing`: 클라이언트 상태·`useSearchParams` 불필요 → 순수 서버 컴포넌트로, Suspense
   불필요. 디자인: 제네릭 SaaS 가격표(체크 아이콘 원형 배지, "Most Popular" 리본 등) 대신
   기존 화면의 시각 언어 재사용 — "확정된" 무료 티어는 랭킹 행과 같은 solid panel/border,
   "아직 실재하지 않는" 프리미엄 티어는 기존 빈 상태(EmptyFlaps)와 같은 dashed border로
   표현. `rising`/`falling`은 순위 델타 전용이라는 기존 색상 규칙(globals.css 주석) 유지 —
   장식용으로 쓰지 않음
6. 프리미엄 CTA: 실제 `<button disabled>` — 클릭하면 아무 일도 안 일어나는 가짜 링크나
   조용히 실패하는 액션이 아니라, 애초에 상호작용 불가능한 상태임을 명시적으로 보여줌 +
   보조 텍스트로 "출시되면 이 페이지에서 안내"
7. 홈 헤더에 `/pricing` 링크 추가(발견 가능하도록 — 페이지가 고아 상태로 남지 않게)
8. 신규 테스트(`pricing/page.test.tsx`), lint → test → build, dev 서버로 curl(sitemap.xml/
   robots.txt/pricing 상태 코드·헤더) + Playwright 스크린샷(데스크톱/모바일) + axe 스캔 +
   포커스 순서 확인, 스크래치 스크립트 정리 후 dev 서버 종료

### [실행 + 관찰]

**신규 파일**: `src/app/sitemap.ts`, `src/app/robots.ts`, `src/app/pricing/page.tsx`,
`src/app/pricing/page.test.tsx`.
**수정 파일**: `src/app/HomeClient.tsx`(헤더에 "요금제" 링크 1개 추가, `next/link` import).

**빌드 결과** — `/pricing`·`/robots.txt`·`/sitemap.xml` 전부 정적(`○`)으로 생성됨(빌드
타임에 완전히 결정 가능한 콘텐츠라 별도 런타임 비용 없음).

**`npm run lint`** — 통과. **`npm run build`** — 클린.

**`npm run test`**
```
 Test Files  12 passed (12)
      Tests  102 passed (102)
```
102개 전부 통과(기존 96개 + 신규 6개: h1/h2 헤딩 존재, 무료 티어 기능 노출, 프리미엄
티어 기능 노출, 무료 CTA가 실제 "/" 링크인지, 프리미엄 CTA가 진짜 `disabled` 버튼(가짜
링크 아님)인지 + 보조 안내 문구, 헤더 워드마크가 "/"로 연결되는지).

**실 브라우저 검증** (dev 서버 `-p 3009`):
```
GET /sitemap.xml → 200, content-type: application/xml
  <url> 5개: "/", "/?region=KR|US|JP"(각 hourly, 0.8), "/pricing"(monthly, 0.5)
GET /robots.txt  → 200, content-type: text/plain
  User-Agent: *
  Allow: /
  Disallow: /api/
  Disallow: /auth/
  Sitemap: http://localhost:3000/sitemap.xml
GET /pricing → 200
```

**구현 중 axe 스캔으로 발견한 실제 버그 1건** (검사가 아니라 스캔 결과로 발견): 프리미엄
카드를 "덜 확정된" 느낌으로 흐리게 하려고 `text-flap-dim/70`, `/60` 같은 투명도를 낮춘
변형을 새로 만들어 썼는데, `--casing`(#0e0e10) 배경 위에서 실제 대비가 2.67~3.22:1로
WCAG AA 기준(4.5:1) 미달 — axe가 `color-contrast` 위반 2건으로 정확히 잡아냄. 기존
화면 전역에서 이미 검증된 불투명 `text-flap-dim`(투명도 없음)으로 전부 교체해 해결 —
"아직 없다"는 느낌은 border-dashed와 아이콘(✓ vs ·) 차이만으로 충분히 전달되므로 텍스트
자체의 대비를 낮추는 방식은 애초에 불필요한 리스크였음.

```
axe violations (수정 전): 1건 (color-contrast, 노드 2개)
axe violations (수정 후): 0건
헤딩 순서: H1 "요금제" → H2 "무료" → H2 "프리미엄" (정상 계층)
포커스 순서: FLIP 워드마크 → "무료로 시작하기"(프리미엄의 disabled 버튼은 건너뜀 — 확인:
  disabled 버튼에 강제 focus() 시도해도 activeElement로 잡히지 않음, 즉 진짜 비활성)
```
데스크톱(900×700)·모바일(390×844) 스크린샷 확인 — 모바일에서 카드가 `sm:flex-row` →
세로 스택으로 정상 전환, `scrollWidth > clientWidth` 확인 결과 가로 오버플로우 없음.

**dev 서버 종료**: `lsof -ti:3009 | xargs kill` 후 포트 확인 → 정상 종료. 스크래치
스크립트(`.scratch-pricing*.mjs`) 전부 삭제, 커밋 대상 아님.

### [검증] — 성공 기준 대조
1. sitemap.xml/robots.txt 정상 렌더(curl + 내용 확인) → **충족**
2. 요금제 페이지가 디자인 시스템에 부합(스크린샷, 데스크톱+모바일) → **충족** — 기존 빈
   상태/카드 스타일 재사용, 장식적 rising/falling 색상 사용 안 함
3. 접근성(기존 a11y 패턴 재사용 — 헤딩 구조, 포커스 순서) → **충족**(axe 0 violations,
   헤딩 계층 정상, disabled 버튼이 탭 순서에서 정확히 제외됨) — 스캔 중 실제 대비 버그
   1건 발견/수정
4. 신규 라우트 테스트 → **충족**(6개 신규, 102개 전체 통과)
5. lint/build 클린 → **충족**

### [개선/반복]
1회 반복으로 모든 기준 충족, 추가 반복 불필요(규칙 9). 정직하게 기록할 점: 프리미엄
기능 목록("CSV 내보내기", "히스토리 전체 보관" 등)은 실제로 구현되지 않은, 페이지 카피
상으로만 존재하는 항목들 — 요청에 명시적으로 허용된 범위("stated-but-not-yet-built perk
is fine")이며, CTA가 정직하게 disabled 상태이므로 실제로 결제/제공을 약속하지 않음.
결제 연동(Stripe) 자체는 이번 라운드 범위 밖.

### [종료]
5개 성공 기준 모두 실측 증거로 충족. `frontend-loop`에 커밋 진행.

## 반복 16 — 프론트엔드 (SITE_URL 폴백 체인 강화)

### [배경] 및 [목표]
오케스트레이터가 실제 프로덕션에서 발견: Vercel 환경변수에 `NEXT_PUBLIC_SITE_URL`이
설정된 적이 없어 `layout.tsx`의 OG/Twitter 메타데이터와 반복 15에서 만든 `sitemap.ts`가
프로덕션에서도 조용히 `http://localhost:3000`으로 폴백 중이었음(실제 프로덕션 사이트를
curl해서 `og:url`/`og:image`가 localhost로 나오는 것까지 확인됨) — OG 메타데이터가
나간 시점부터 모든 공유 링크 미리보기가 깨져 있었고, 이번 sitemap도 그대로 배포됐다면
검색엔진에 localhost URL을 제출했을 것. 사용자가 Vercel에 값을 직접 설정하는 건
별도로 진행 중이지만, 이 클래스의 버그가 조용히 재발하지 않도록 폴백 체인 자체를
견고하게 만드는 게 이번 라운드의 목표: `NEXT_PUBLIC_SITE_URL`(명시적 override) →
`VERCEL_PROJECT_PRODUCTION_URL`(Vercel이 별도 설정 없이 자동 제공하는, preview마다
바뀌지 않는 안정적 프로덕션 도메인) → `http://localhost:3000`(로컬 전용 최후 수단).

### [계획]
1. `git merge main` — 이번엔 이미 최신(원격 main이 아직 반복 15를 병합하지 않은
   상태였음, 코드 충돌 없음)
2. 중복 확인: `SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"`
   패턴이 `layout.tsx`/`sitemap.ts`/`robots.ts` 세 곳에 그대로 복붙되어 있었음(반복 15
   때 내가 직접 그렇게 만듦) → `src/lib/siteUrl.ts`에 `getSiteUrl()` 공유 헬퍼로 추출
3. 폴백 순서 구현: explicit `NEXT_PUBLIC_SITE_URL` → `VERCEL_PROJECT_PRODUCTION_URL`을
   `https://`로 프리픽스 → `http://localhost:3000`. 세 곳 전부 헬퍼 재사용으로 교체
4. 순수 함수라 테스트로 직접 커버 가능 — `siteUrl.test.ts`: override 우선순위, Vercel
   변수만 있을 때, 둘 다 없을 때(로컬 빌드의 실제 케이스), 빈 문자열은 "설정 안 됨"으로
   취급(falsy 체크)하는지
5. 로컬 `.env.local`에 이 두 변수가 원래 없다는 것부터 확인 → 즉 평소 `npm run build`가
   이미 진짜 "둘 다 없는" 폴백 경로를 타고 있었다는 뜻이라 이 자체가 회귀 테스트 역할
6. `next build`가 Vercel 전용 env var 없이도 깨지지 않는지 확인(원래도 옵셔널 체이닝이라
   문제 없어야 하지만 실측), 추가로 dev 서버를 세 가지 env 조합(없음 / Vercel 변수만 /
   둘 다)으로 각각 띄워 sitemap.xml + robots.txt + 홈페이지 `og:url` 메타 태그까지 실제
   curl로 확인
7. lint → test → build

### [실행 + 관찰]

**신규 파일**: `src/lib/siteUrl.ts`(공유 헬퍼), `src/lib/siteUrl.test.ts`(4개 테스트).
**수정 파일**: `src/app/layout.tsx`, `src/app/sitemap.ts`, `src/app/robots.ts` — 각자
갖고 있던 `SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"`를
전부 `getSiteUrl()` 호출로 교체.

**`npm run lint`** — 통과. **`npm run build`**(로컬, 두 env var 모두 미설정) — 클린,
9개 라우트 동일하게 생성.

**`npm run test`**
```
 Test Files  13 passed (13)
      Tests  106 passed (106)
```
106개 전부 통과(기존 102개 + 신규 4개: override 우선순위, Vercel 변수 단독 폴백,
로컬(둘 다 없음) 폴백, 빈 문자열은 미설정으로 취급).

**실 브라우저/curl 검증** (dev 서버 `-p 3009`, 세 가지 env 조합 각각 별도 기동):
```
[env 없음 — 로컬 개발의 실제 상태]
GET /sitemap.xml → <loc>http://localhost:3000</loc> ...
GET /robots.txt  → Sitemap: http://localhost:3000/sitemap.xml

[VERCEL_PROJECT_PRODUCTION_URL=trend-dashboard-swart.vercel.app, override 없음]
GET /sitemap.xml → <loc>https://trend-dashboard-swart.vercel.app</loc> ...
GET /robots.txt  → Sitemap: https://trend-dashboard-swart.vercel.app/sitemap.xml
GET /            → <meta property="og:url" content="https://trend-dashboard-swart.vercel.app"/>

[NEXT_PUBLIC_SITE_URL=https://custom-override.example.com 도 함께 설정 — override가 이겨야 함]
GET /sitemap.xml → <loc>https://custom-override.example.com</loc>
GET /            → <meta property="og:url" content="https://custom-override.example.com"/>
```
세 경로 모두 기대한 대로 정확히 동작 확인. dev 서버 매번 종료 후 포트 확인.

### [검증] — 성공 기준 대조
1. `layout.tsx`/`sitemap.ts` 폴백 체인을 `NEXT_PUBLIC_SITE_URL` → `VERCEL_PROJECT_
   PRODUCTION_URL`(https:// 프리픽스) → localhost 순으로 교체, 공유 헬퍼로 동기화
   → **충족**(`robots.ts`도 같은 헬퍼로 통일 — 요청엔 없었지만 세 번째 복붙 지점이라
   같이 고치지 않으면 다음에 또 따로 썩을 자리)
2. `NEXT_PUBLIC_SITE_URL` 로컬에서 unset 후 폴백 확인 → **충족**(애초에 로컬 기본
   상태가 이미 그 케이스였고, 추가로 명시적 env 조합 3가지 전부 curl로 실측)
3. `next build`가 이 Vercel 전용 변수들 없이도 깨지지 않음 → **충족**(로컬 빌드가
   기본적으로 이미 그 조건이라 매 라운드 검증되는 셈)
4. lint/test 클린 → **충족**, 근거 함께 첨부

### [개선/반복]
1회 반복으로 모든 기준 충족, 추가 반복 불필요(규칙 9). 이번 건은 내가 반복 15에서 만든
버그를 오케스트레이터가 프로덕션에서 잡아낸 케이스 — 로컬/테스트 환경에는 애초에
`NEXT_PUBLIC_SITE_URL`이 없었으니 세 파일 모두 항상 localhost로 조용히 통과했고, lint/
test/build 어느 것도 이 문제를 드러내지 못했음. 재발 방지책은 코드(폴백 체인 강화)로
다뤘지만, "환경변수 미설정이 프로덕션에서만 드러나는 종류의 문제"는 이 루프의 로컬
검증 절차가 구조적으로 못 잡는 범주라는 점은 기록으로 남김.

### [종료]
4개 성공 기준 모두 실측 증거로 충족. `frontend-loop`에 커밋 진행.

---

## 통합 (merge) — `backend-loop` ← `frontend-loop` (SEO 크롤링 + 요금제 페이지 + siteUrl 폴백 수정, `7c88086`)

> `backend-loop`(HEAD `964ac92`)에서 `git merge frontend-loop`(`7c88086`, 조상 커밋 2개:
> `1e517d6` SEO/요금제, `7c88086` siteUrl 폴백 강화) 실행. `git merge-base`로 실제 공통
> 조상(`869b0a6`) 확인 후 진행 — 이번엔 내 쪽(`backend-loop`)이 병합 지점 이후 보안 헤더
> 커밋을 추가로 쌓아둔 상태라 순수 fast-forward는 아니었음.

### [충돌 및 해소]
- `LOOP_LOG.md`만 content 충돌. `diff`로 `ours`(HEAD)의 처음 3599줄이 `869b0a6`과 정확히
  일치함을 먼저 확인한 뒤, `7c88086`이 그 뒤에 추가한 구간(3600~3798행, "반복 15 —
  프론트엔드" 199줄)만 골라 이어붙임. 임시 파일에 조립 → 마커 없음 확인 → 조인부 확인 →
  반영.
- `src/lib/siteUrl.ts`(신규) 확인: 오케스트레이터가 보고한 대로 실제 프로덕션 버그 수정 —
  `NEXT_PUBLIC_SITE_URL`이 Vercel에 설정된 적이 없어 OG 메타데이터가 계속 localhost를
  가리키고 있었음. 폴백 체인: 명시적 `NEXT_PUBLIC_SITE_URL` → `VERCEL_PROJECT_PRODUCTION_URL`
  (Vercel이 프리뷰별로 안 바뀌는 안정적 프로덕션 도메인을 자동 제공하는 플랫폼 env var,
  수동 설정 불필요) → 로컬 전용 최종 폴백 `localhost:3000`. `layout.tsx`가 이 함수로
  갈아끼워짐, `sitemap.ts`/`robots.ts` 신규 파일도 동일 함수 사용 — 세 곳이 각자
  하드코딩하던 걸 한 곳으로 통합.
- 그 외(`HomeClient.tsx`, `pricing/page.tsx`+테스트, `robots.ts`, `sitemap.ts`,
  `siteUrl.test.ts`) 전부 자동 병합, 백엔드 이번 라운드(보안 헤더) 변경과 겹치는 파일 없음
  — `next.config.ts`는 frontend가 건드리지 않음.

### [검증 — 통합 결과 실측]

```
npm run lint   → 빈 출력, exit 0
npm run test   → Test Files 13 passed (13), Tests 106 passed (106) (오케스트레이터 보고와 일치)
npm run build  → Compiled successfully, 신규 3개 정적 라우트(`/pricing`, `/robots.txt`,
                 `/sitemap.xml`) 추가되어 총 12개 라우트, `/`와 `/opengraph-image.png`
                 여전히 정적(`○`) — 보안 헤더 라운드의 no-nonce 선택이 이번 병합 이후에도
                 정적 최적화를 유지함을 재확인
```

**오케스트레이터가 명시적으로 요청한 재검증 — "OG/sitemap URL이 더 이상 localhost가
아닌지"**: 이건 실제로는 Vercel 프로덕션 환경 변수(`VERCEL_PROJECT_PRODUCTION_URL`)에
의존하는 사실이라, 이 세션에서 실제 라이브 Vercel 배포의 값을 직접 관측할 수는 없음
(그 값은 Vercel 인프라가 빌드 시점에 주입). 대신 그 폴백 로직 자체가 실제로 작동하는지
직접 시뮬레이션으로 검증:
- 로컬 dev(env var 없음): `sitemap.xml`/`robots.txt`/`og:url` 전부 정확히
  `http://localhost:3000`(의도된 로컬 최종 폴백) — 정상.
- `VERCEL_PROJECT_PRODUCTION_URL=trend-dashboard-example.vercel.app`로 dev 서버 재기동:
  `sitemap.xml`의 `<loc>`, `og:url` 둘 다 정확히 `https://trend-dashboard-example.vercel.app`로
  전환됨 — 폴백 체인이 실제로 동작.
  - **단, `og:image`만 dev 모드에서 여전히 `http://localhost:3001/...`로 남아있는 걸
    발견** — 처음엔 버그로 의심했으나, 같은 env var로 **프로덕션 빌드**(`npm run build
    && npm run start`)를 해보니 `og:image`도 정확히
    `https://trend-dashboard-example.vercel.app/opengraph-image.png?...`로 올바르게
    나옴 — 즉 이건 `next dev`(Turbopack 개발 서버)가 파일 컨벤션 OG 이미지 라우트를
    편의상 실제 요청 호스트 기준으로 보여주는 dev 전용 특성이지, 프로덕션 버그가
    아니었음. "이론적으로 맞을 것"이라 믿지 않고 dev/prod 둘 다 실측한 덕에 이 오탐을
    바로 걸러낼 수 있었음.
- 시뮬레이션 완료 후 env var 없이 정상 재빌드해 이후 검증은 전부 실제 배포와 동일한
  조건(로컬 최종 폴백)으로 진행.

**`npm run dev -- -p 3001` + curl (실 크리덴셜, 전 라우트 + 신규 라우트)**
```
GET  /api/trends?region=KR   → sources:['youtube','hackernews'], mocked:False
GET  /api/trends/history, /api/trends/keyword-history, /auth/callback, /api/watchlist(401),
     /opengraph-image.png(PNG 확인), cron(200) — 전부 정상
GET  /pricing      → HTTP 200
GET  /robots.txt   → HTTP 200
GET  /sitemap.xml  → HTTP 200
```
보안 헤더 5개 전부 여전히 존재(`X-Content-Type-Options`/`X-Frame-Options`/
`Referrer-Policy`/CSP/조건부 HSTS) — 이번 병합으로 회귀 없음.

**Playwright 실 브라우저 재검증(dev + prod 둘 다)**: 지난 라운드와 동일한 워크스루(홈 로드
→ 지역 전환 → 로그인 시도 → 키워드 상세 → auth callback)에 더해 **신규 `/pricing`
페이지도 별도로 방문**해 `securitypolicyviolation`/콘솔 에러 수집:
```
CSP violations: []
Console errors: []
```
(dev, prod 둘 다 동일 결과). rate limiting 재확인(35회 병렬, 200/429 혼재). 로그 전체
스캔: 이미 알려진 클래스 제외 예상 밖 에러 0건(dev 로그의 `GET /?auth_error=1 200`은
Playwright 워크스루의 의도된 실패 로그인 시도 결과). 두 서버 모두 정상 종료 확인.

### [결론]
`7c88086` 반영 후 lint/test(106개)/build/dev+prod 전 라우트 curl + Playwright 실 브라우저
재검증(신규 `/pricing` 포함) + rate-limit 회귀 확인까지 전부 그린. `og:image`의 dev 전용
호스트 표시가 프로덕션 버그가 아님을 dev/prod 대조로 직접 확인. `backend-loop`에 머지
커밋 후 `main`으로 병합·푸시 예정. 마이그레이션 관련 블로커 없음(0001~0004 전부 라이브
적용/검증 완료).
