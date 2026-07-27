# StockAssistant(ksk) - 개발 현황

## 프로젝트 개요
미래에셋증권 매매 내역을 관리하는 Electron 데스크톱 앱.
카카오톡 알림 파싱, CSV 가져오기, 수동 입력, 다음 금융 동기화 등 지원.

### 기술 스택
- Electron + React + TypeScript + Vite
- JSON 파일 기반 로컬 DB (`portfolio.json`)
- Recharts (차트)
- 데이터 경로: `C:\Users\kimsu\AppData\Roaming\stock-portfolio\portfolio.json`

### 계좌 정보
- `[선근] 메인 (72480)` — 메인 계좌 (다음 금융 그룹 1)
- `[선근] ISA (18160)` — ISA 계좌 (다음 금융 그룹 3)
- `[선근] 미국 (40410)` — 미국주식 계좌 (다음 미관리)

### 빌드/배포
- `npm run dev` — 개발 모드
- `npm run electron:build` — 릴리즈 빌드 (release 폴더에 exe 생성)
- preload.ts는 반드시 CJS(`require`) 문법 사용 (ESM `import` 사용 금지)

---

## 완료된 기능

### 1. 기본 구조
- Electron + React + Vite 프로젝트 구성
- 사이드바 네비게이션 + 페이지 라우팅
- JSON 파일 기반 DB (portfolio.json)
- IPC 통신 (preload.ts → 단일 `window.api` 객체)
- window.api 준비 대기 로직 (100ms 간격 체크, 최대 10초)

### 2. 데이터 입력 (DataInput.tsx)
- 📱 카카오톡 알림 파싱 (계좌 자동 매칭)
  - 매매 체결 알림 (국내 + 해외주식)
  - 배당금 입금 알림 (국내/해외)
  - 입출금 알림
  - 통합 파서 `parseKakaoAll()`
  - 카카오톡 자동 캡처 (수동 모드: 3초 후 캡처)
  - 중복 체크 (연속 5건 중복 시 중단)
- 🏦 미래에셋 CSV 매매내역 가져오기 (국내)
- 🌍 해외주식 CSV 가져오기
- 📊 월별 요약 CSV 가져오기 + 수동 월말 자산총액 입력
- 💰 입출금 내역 CSV 가져오기 (배당금 자동 추출 포함)
- 📋 웹 테이블 붙여넣기 (컬럼 자동 매핑)
- ✏️ 수동 매매 입력
- 📤 CSV 내보내기 (매매/포트폴리오/입출금/배당)
- 🔄 다음 금융 자동 동기화 (카카오톡 매매 저장 시)

### 3. 매매 내역 (TradeHistory.tsx)
- 전체 매매 내역 테이블 (정렬, 필터, 검색)
- 날짜/종목/매수매도/계좌 필터
- 개별 수정/삭제

### 4. 입출금 내역 (TransferHistory.tsx)
- 입출금 내역 테이블
- 개별 수정/삭제

### 5. 배당금 내역 (DividendHistory.tsx)
- 배당금 내역 테이블
- 기간 필터: 이번달 → 올해 → 작년 → 전체

### 6. 계좌 잔고 (AccountHoldings.tsx)
- 계좌별 보유종목 현황
- 매매내역 기반 자동 계산 (computeHoldingsFromTrades)
- 실시간 시세 조회 (한국: 네이버, 미국: Yahoo Finance)
- 환율 API (6시간 캐시, 기본값 1450원)
- 해외주식 원화 환산 (달러 소수점 2자리, 원화 소수점 없음)
- 종목 상세 모달 (보유손익, 매매손익, 총손익 요약)

### 7. 대시보드 (Dashboard.tsx)
- 계좌 필터 (전체/개별 계좌)
- 4가지 수익률 카드: 전월대비 / 올해 YTD / 누적 / 현재 총자산
- 수익률 공식:
  - `수익금 = 현재총자산 - 기준일총자산 - 순입출금`
  - `수익률 = 수익금 / 기준일총자산 × 100`
  - 누적: `수익률 = 수익금 / (기준자산 + 순입출금) × 100` (총 투입 원금 대비)
- 연도별 수익률 테이블 (연간 누적은 복리 계산)
- 월별 수익률 바 차트
- 월별 수익률 상세 (접기/펼치기, 기본 접힘)
- 자산추이 LineChart
- 종목별 비중 PieChart
- 월 형식 통일: `normalizeMonth()` (YYYY-MM, YYYY/MM 모두 처리)
- start_asset=0인 월 건너뛰고 end_asset > 0인 가장 오래된 월부터 계산

### 8. 수익률 분석 (Analysis.tsx)
- 종목별/기간별 수익률 차트

### 9. 다음 금융 동기화 (DaumSync.tsx)
- 카카오 로그인 (BrowserWindow 팝업)
- 그룹(계좌) 관리 + 자동 매핑 (72480→그룹1, 18160→그룹3)
- 매매내역 선택 (계좌+날짜 필터, 빠른 선택)
- 종목별 동기화 (체크박스 선택, 종목코드 자동 탐색)
- 중복 체크 (같은 날짜+타입+가격+수량 스킵)
- 동기화 기록 초기화
- 카카오톡 매매 자동 동기화 (`daum:syncTrade` IPC)

### 10. 설정 (Settings.tsx)
- 수수료율, 세금 설정
- 테마 설정

---

## v1.0.0 릴리즈 (2026-03-09)
- 앱 이름: StockAssistant(ksk)
- CSV 관리 탭 → 데이터 입력 탭에 통합 (CsvManager.tsx 삭제)
- 사이드바에서 CSV 관리 메뉴 제거
- 데이터 입력에 CSV 내보내기 탭 추가
- electron-builder로 Windows exe 빌드 (release 폴더)

---

## 향후 계획
- [ ] DART 공시 알림 (보유 종목 공시 자동 조회)
  - DART Open API 인증키 발급 필요 (https://opendart.fss.or.kr)
  - `/list.json` API로 종목코드별 공시 검색
  - 설정에서 API 키 입력, 대시보드에 최근 공시 표시
- [ ] 미국주식 계좌 다음 금융 동기화
- [ ] 데이터 백업/복원 기능

---

## 파일 구조
```
stock-portfolio/
├── electron/
│   ├── main.ts          # Electron 메인 + IPC 핸들러 + 다음금융 API
│   ├── preload.ts       # contextBridge (CJS require 필수)
│   └── database.ts      # JSON DB CRUD
├── src/
│   ├── components/
│   │   └── Sidebar.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx      # 대시보드 (수익률, 차트)
│   │   ├── AccountHoldings.tsx # 계좌 잔고
│   │   ├── TradeHistory.tsx    # 매매 내역
│   │   ├── TransferHistory.tsx # 입출금 내역
│   │   ├── DividendHistory.tsx # 배당금 내역
│   │   ├── DataInput.tsx       # 데이터 입력 (CSV 포함)
│   │   ├── Analysis.tsx        # 수익률 분석
│   │   ├── DaumSync.tsx        # 다음 금융 동기화
│   │   └── Settings.tsx        # 설정
│   ├── services/
│   │   ├── parser.ts       # 카카오톡 파서
│   │   └── csvService.ts   # CSV 파서들
│   ├── types/
│   │   └── index.ts        # 타입 + window.api 선언
│   ├── styles/
│   │   ├── global.css
│   │   └── components.css
│   ├── App.tsx
│   └── main.tsx
├── package.json
├── vite.config.ts
└── tsconfig.json
```
