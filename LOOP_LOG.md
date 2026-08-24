# 루프 엔지니어링 로그

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
