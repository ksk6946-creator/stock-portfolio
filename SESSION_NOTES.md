# 작업 내역 정리 (세션 인수인계)

> 다음 세션에서 이 문서를 읽고 이어서 작업합니다.

## 프로젝트 개요
- 미래에셋증권 주식 포트폴리오 관리 Electron 앱 (StockAssistant(ksk))
- 위치: `D:\MarkAny\DEV\StockDataCtl\stock-portfolio`
- 스택: Electron + React + TypeScript + Vite, JSON 파일 DB
- 계좌 데이터 CSV: `D:\MarkAny\DEV\StockDataCtl\계좌 데이터`

## 계좌 정보 (다음 금융 그룹 ID)
| 계좌 | 계좌번호 | 카카오 마스킹번호 | 다음 그룹ID |
|------|---------|------------------|------------|
| [선근] 메인 | 72480 | 784-06**-**48-0 | 4 |
| [선근] ISA | 18160 | 244-62**-**16-0 | 5 |
| [선근] 미국 | 40410 | 010-41**-**41-0 | - |
| [다인] 통합 | 39630 | 010-41**-**63-0 | - |
| [선근] IRP연금 | 46720 | - | - |
| [큰누나] 통합 | 48800 | - | - |
| [장모님] 통합 | 27980 | - | - |

---

## 이번 세션에서 완료한 작업

### 1. 카카오톡 파서 (parser.ts)
- 날짜/시간 컨텍스트 추적: `2026년 7월 21일 화요일` 날짜 구분선 + `[오후 3:06]` 시간 파싱
- **날짜 구분선 위치 처리**: 구분선이 블록 끝에 있으면(메시지 뒤) 다음 블록부터 적용, 시작에 있으면 현재 블록부터 적용
- 일부체결 무시 (전량체결만 반영)
- 서버자동주문 안내 / "주문이 전송" 무시
- 종목명 파싱 수정: `종목명 : ...(매매구분|주문수량|체결수량 앞까지)` — `명 : ` 잘못 매칭 버그 해결

### 2. 데이터 입력 (DataInput.tsx)
- 카카오 캡처 기간 선택: 1일/2일/1주/1개월/2개월/3개월/6개월/1년/2년/3년/전체 (기본 1주=7일)
  - `captureMonths` 변수지만 실제로는 **일 단위** (`setDate`)
- 계좌 자동 매칭: 마스킹 계좌번호 직접 매핑 테이블 (`acctNumMap`)
- 다음 금융 그룹 매핑: 메인→4, ISA→5 (`accountGroupMap`)
- 중복 체크 로직:
  - 기존이 kakao 소스면 → **같은 날짜만** 중복
  - 기존이 csv 소스면 → **±2일** 중복 (CSV는 결제일, 카카오는 체결일 기준이라 날짜 차이)

### 3. 대시보드 (Dashboard.tsx)
- 기본 선택 계좌: 메인 + ISA (`defaultAccountPatterns = ['메인', 'ISA']`)
- [합산] 메인+ISA 계좌 제거 (복잡도만 높이고 불필요)
- 순입출금 계산에서 융자/환전/예탁금이용료 등 제외 (`excludePatterns`)
- 월별 수익률 테이블 연도 헤더/정렬 수정 (2026년 1월이 2월 아래로)

### 4. 계좌 잔고 (AccountHoldings.tsx)
- 종목 테이블 정렬 기능 (헤더 클릭, 기본: 평가금액 내림차순)

### 5. DB 관리 (database.ts)
- 자동 백업: 앱 시작 시 하루 1회 `backups/portfolio.YYYY-MM-DD.json`, 최소 5개 유지 + 7일 이전 삭제
- **DB 경로 커스텀 지정**: `db-config.json`에 경로 저장, 클라우드 폴더 사용 가능
  - 현재 설정: `G:\내 드라이브\개인\stock-portfolio\portfolio.json` (Google Drive)
  - 백업도 같은 폴더의 `backups/`에 생성됨
- CSV 종목명 `(유통)` 접미사 제거

### 6. 다음 금융 동기화 (DaumSync.tsx, main.ts)
- `addItem` 재작성: 목록 먼저 조회 → 기존 itemId 재사용 → 없으면 추가 후 재조회 (중복 종목 생성 방지)
- 다음 금융 종목코드는 `A` 접두사 제거해서 전송 (예: A0193T0 → 0193T0)
- 매매내역 로드 시 현재 보유 종목만 기본 선택
- 종목코드 검색은 선택된 종목만 수행
- 보유수량 0 종목 정리 버튼 (getEmptyItems, deleteItems, deleteTrade IPC)
- **주의**: 다음 금융 API는 매매 있는 종목의 개별 itemId 삭제(DELETE)가 406/400 에러. symbolCodes 배열 삭제만 동작

### 7. 시세 업데이트
- 앱 시작 5초 후 자동 시세 업데이트 (updatePricesOnly)
- ETF 종목코드 매핑 정리 (아래 참고)

### 8. 자동 업데이트 (electron-updater)
- GitHub 저장소: `ksk6946-creator/stock-portfolio` (public)
- git 계정: 이 PC는 회사계정(ksk6946)이 기본. 이 프로젝트만 개인계정(ksk6946-creator) 사용
  - user.name: ksk6946-creator, user.email: ksk6946@gmail.com
  - 토큰 파일: `D:\MarkAny\DEV\StockDataCtl\.gh-token.txt` (fine-grained, Contents R/W, stock-portfolio 한정)
- `package.json`: publish 설정 + `releaseType: "release"` (Draft 아닌 정식 릴리스)
- v1.0.0 릴리스 완료
- 앱 시작 시 자동 업데이트 확인 → 다운로드 → 재시작 시 설치

---

## 배포 워크플로우
1. 코드 수정
2. `package.json` version 올리기 (1.0.0 → 1.0.1)
3. `git add -A; git commit -m "..."; git push`
4. 토큰 환경변수 설정 후 릴리스:
   ```
   $env:GH_TOKEN = (Get-Content "D:\MarkAny\DEV\StockDataCtl\.gh-token.txt" -Raw).Trim()
   npm run electron:publish
   ```
5. 다른 PC는 앱 재시작 시 자동 업데이트

## 다른 PC 최초 설정
1. GitHub Releases에서 exe 다운로드 후 설치
2. 설정 → DB 저장 경로 → Google Drive 경로 지정 (드라이브 문자는 PC마다 다를 수 있음)
3. 앱 재시작

---

## ETF 종목코드 매핑 (다음 금융 기준, DB에는 A 접두사로 저장)
- A0193T0: KODEX SK하이닉스단일종목레버리지
- A0193W0: KODEX 삼성전자단일종목레버리지
- A0080Y0: SOL 조선TOP3플러스레버리지
- A0101N0: RISE AI전력인프라
- A449450: PLUS K방산
- A466920: SOL 조선TOP3플러스
- A487240: KODEX AI전력핵심설비
- A488080: TIGER 반도체TOP10레버리지
- A138540: TIGER 현대차그룹플러스
- A102970: KODEX 증권

---

---

## 2026-07-30 세션 추가 작업

### ETF 종목코드 파싱 버그 수정 (v1.0.1)
- 원인: 카카오 알림 종목명 파싱의 국내 종목코드 정규식이 `[A-Z]?\d{6}` (숫자 6자리)여서
  `A0193T0`, `A0193W0`, `A0080Y0` 처럼 **영문이 섞인 6자리 코드**를 분리하지 못함
- 결과: 종목명이 `KODEX SK하이닉스단일종목레버리지(A0193T0)` 형태로 저장되어 같은 종목이 별도 잔고로 쪼개짐
  - 종목코드가 비어 있어 시세 자동 갱신에서도 누락됨
- 수정: `A?[0-9][0-9A-Z]{5}` 로 변경 (`parseMiraeKakao`, `parseDividendKakao` 양쪽)

### DB 정리 (1회성)
- 백업: `backups/portfolio.before-dedup.2026-07-30T09-05-04.json`
- 중복 매매내역 8건 삭제
  - 레버리지 4건: 07-20 SK 8@13200, 07-28 SK 10@10500, 07-20 삼성 9@11900, 07-28 삼성 10@9900
    (파서 수정 전/후 캡처가 겹쳐 이름이 달라 중복 체크를 통과함)
  - 2024-01-18 CSV 4건: 씨제이제일제당, 현대모비스, 현대미포조선, 케이씨씨
    (CSV 두 파일의 기간이 겹쳐 동일 배치가 두 번 임포트됨, created_at 14ms 차이)
- 종목명 정규화 14건, 쪼개진 잔고 2건 병합 → trades 2155→2147, holdings 69→67
- **주의**: 잔고(holdings)는 종목 CSV 스냅샷 기준이고 매매내역과 독립적임.
  예) 현대모비스는 매매내역 계산 1주 vs 잔고 6주로 원래 다름.
  따라서 전체 `recalcHolding` 호출은 금지. 종목별로 근거를 확인한 뒤 개별 처리해야 함.

### 자동 업데이트 UI + 로깅 (v1.0.2)
- `electron-log` 5.4.4 추가 (정확한 버전 고정, dependencies)
  - 로그 파일: `%APPDATA%\StockAssistant(ksk)\logs\main.log`
  - 메인 프로세스 `console.*` 를 파일로 리다이렉트, `autoUpdater.logger` 연결
  - `log.initialize()` 는 **호출하지 않음** — 번들 환경에서 렌더러 preload 경로가 깨짐
- 기존에 죽어 있던 코드 연결: main.ts가 `update-status` 를 보내는데 받는 쪽이 없었음
  - 이벤트 핸들러를 `checkForUpdates()` **이전에** 등록 (기존엔 이후라 레이스)
  - `lastUpdateStatus` 보관 + `update:getStatus` IPC → 렌더러 마운트 전 상태 유실 방지
  - 추가 이벤트: checking / not-available / download-progress / error
- 새 IPC: `update:check`, `update:getStatus`, `app:getVersion`, `app:getLogPath`
- preload에 `updater`, `app` 네임스페이스 노출 (`onStatus` 는 구독 해제 함수 반환)
- `UpdateBanner.tsx`: 우하단 토스트. 다운로드 중 진행률 → 완료 시 "지금 재시작" 버튼
- 설정 화면에 "앱 버전 및 업데이트" 섹션 (현재 버전, 수동 확인, 로그 경로)

---

## 알려진 이슈 / TODO
- [ ] 일부 최신 ETF는 네이버 시세 API에서 조회 안 됨 (RISE AI전력인프라 등) — 종목 파일의 현재가로 대체 중
- [ ] 다음 금융 빈 종목(보유0, 매매0)이 웹/API로 삭제 안 됨 — 그룹 삭제 후 재생성으로만 정리 가능
- [ ] 카카오 캡처 시 CSV(결제일)와 카카오(체결일) 날짜 차이로 인한 중복 처리는 ±2일 규칙으로 완화했으나 완벽하지 않음
- [ ] 모바일 조회 기능 (미착수) — GitHub Pages + Google Drive JSON 방식 논의됨
- [ ] 자동 업데이트 실제 동작 테스트
  - v1.0.0 → v1.0.1 → v1.0.2 릴리스 완료
  - 업데이트 배너는 v1.0.2부터 들어갔으므로, 배너 확인은 v1.0.3 릴리스 때 가능
  - 검증 방법: 앱 실행 → 완전 종료 → 재실행 시 설정 화면의 버전 확인, 또는 로그 파일 확인
- [ ] `package.json` 에 description / author 누락 (electron-builder 경고)
- [ ] 앱 아이콘 미설정 (`public/icon.png` 없어서 기본 Electron 아이콘 사용 중)

## 데이터 현황 (세션 종료 시점)
- HTS 입출금 내역 CSV(2행 헤더 형식)에서 전체 재구축 완료
- 각 계좌 잔고는 종목 파일(`계좌 데이터/종목/*.csv`) 기준으로 등록
- 잔량 음수 종목은 "이전 보유분" 가상 매수로 보정 (source: manual)
- 월별 수익률은 `계좌 데이터/수익률/*.csv` (일별→월별 집계)로 등록
