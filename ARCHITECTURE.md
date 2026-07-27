# StockAssistant(ksk) - 개발 아키텍처

> 이 문서는 AI가 비슷한 프로그램을 만들 때 참고할 수 있도록 작성된 아키텍처 가이드입니다.

---

## 1. 기술 스택

| 영역 | 기술 | 버전 |
|------|------|------|
| 프레임워크 | Electron | ^32.1.0 |
| 프론트엔드 | React + TypeScript | React 18, TS 5.5 |
| 빌드 도구 | Vite + vite-plugin-electron | Vite 5.4 |
| 차트 | Recharts | ^2.12.7 |
| DB | JSON 파일 (로컬) | - |
| 패키징 | electron-builder | ^25.0.5 |
| OS | Windows (NSIS 설치파일) | - |

---

## 2. 프로젝트 구조

```
stock-portfolio/
├── electron/                    # Electron 메인 프로세스
│   ├── main.ts                  # 앱 진입점, IPC 핸들러, 외부 API 호출
│   ├── preload.ts               # contextBridge (반드시 CJS 문법)
│   └── database.ts              # JSON 파일 기반 DB CRUD
├── src/                         # React 렌더러 프로세스
│   ├── App.tsx                  # 라우팅 + window.api 준비 대기
│   ├── main.tsx                 # React 진입점
│   ├── components/
│   │   └── Sidebar.tsx          # 사이드바 네비게이션
│   ├── pages/
│   │   ├── Dashboard.tsx        # 대시보드 (수익률, 차트)
│   │   ├── AccountHoldings.tsx  # 계좌 잔고 (시세 조회)
│   │   ├── TradeHistory.tsx     # 매매 내역
│   │   ├── TransferHistory.tsx  # 입출금 내역
│   │   ├── DividendHistory.tsx  # 배당금 내역
│   │   ├── DataInput.tsx        # 데이터 입력 (CSV, 카카오톡, 수동)
│   │   ├── Analysis.tsx         # 수익률 분석
│   │   ├── DaumSync.tsx         # 다음 금융 동기화
│   │   └── Settings.tsx         # 설정
│   ├── services/
│   │   ├── parser.ts            # 카카오톡 메시지 파서
│   │   └── csvService.ts        # 증권사 CSV 파서들
│   ├── types/
│   │   └── index.ts             # 전체 타입 + window.api 선언
│   └── styles/
│       ├── global.css
│       └── components.css
├── package.json
├── vite.config.ts
├── tsconfig.json
└── index.html
```

---

## 3. 아키텍처 패턴

### 3.1 Electron IPC 통신 구조

```
[React 렌더러] → window.api.xxx() → [preload.ts: ipcRenderer.invoke()]
                                          ↓
[main.ts: ipcMain.handle()] → [database.ts: CRUD] → [portfolio.json]
```

- 렌더러 → 메인: `ipcRenderer.invoke(channel, ...args)` (비동기)
- 메인 → 렌더러: `ipcMain.handle(channel, handler)` (Promise 반환)
- 모든 API는 `window.api` 단일 객체로 노출

### 3.2 preload.ts 핵심 규칙

```javascript
// ⚠️ 반드시 CJS 문법 사용 (ESM import 사용 금지!)
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  trades: {
    getAll: (filters) => ipcRenderer.invoke('trades:getAll', filters),
    add: (trade) => ipcRenderer.invoke('trades:add', trade),
    // ...
  },
  // 도메인별로 그룹핑
})
```

- Electron preload는 CJS만 지원 → ESM(`import`)으로 빌드하면 로드 실패
- vite.config.ts에서 preload 빌드 시 `format: 'cjs'`, `external: ['electron']` 설정 필수

### 3.3 window.api 준비 대기 (App.tsx)

```tsx
// preload 로딩 타이밍 이슈 대응
useEffect(() => {
  if (apiReady) return
  const check = setInterval(() => {
    if (window.api?.accounts) {
      setApiReady(true)
      clearInterval(check)
    }
  }, 100)  // 100ms 간격 체크, 최대 10초
  return () => clearInterval(check)
}, [apiReady])
```

---

## 4. 데이터 모델 (JSON DB)

### 4.1 DB 파일 위치
```
%APPDATA%/stock-portfolio/portfolio.json
```

### 4.2 스키마

```typescript
interface DbData {
  trades: Trade[]              // 매매 내역
  holdings: HoldingSnapshot[]  // 보유종목 스냅샷
  accounts: string[]           // 계좌 목록 (문자열 배열)
  monthly_summaries: MonthlySummary[]  // 월별 자산총액
  transfers: Transfer[]        // 입출금 내역
  dividends: Dividend[]        // 배당금 내역
  settings: Record<string, any>  // 설정 (키-값)
  parse_templates: any[]       // 파싱 템플릿
  // 자동 증가 ID
  nextTradeId: number
  nextHoldingId: number
  nextMonthlySummaryId: number
  nextTransferId: number
  nextDividendId: number
}
```

### 4.3 주요 엔티티

```typescript
// 매매 내역
interface Trade {
  id: number
  account: string           // 계좌명 (예: "[선근] 메인 (72480)")
  stock_name: string        // 종목명
  stock_code?: string       // 종목코드 (A005930, AAPL 등)
  trade_type: 'BUY' | 'SELL'
  quantity: number
  price: number
  total_amount: number      // quantity × price (자동 계산)
  fee: number
  tax: number
  trade_date: string        // ISO 날짜
  source: 'kakao' | 'manual' | 'csv'
  currency?: string         // 해외주식: 'USD' 등
  exchange_rate?: number    // 매매일 환율
  created_at: string
}

// 보유종목 스냅샷
interface HoldingSnapshot {
  id: number
  account_name: string
  stock_code: string
  stock_name: string
  category: string          // '주식', '해외주식'
  quantity: number
  avg_price: number         // 평균매수단가
  current_price: number     // 현재가 (시세 조회)
  purchase_amount: number   // 매수금액
  eval_amount: number       // 평가금액
  eval_pnl: number          // 평가손익
  return_rate: number       // 수익률 (%)
  updated_at: string
}

// 월별 자산총액
interface MonthlySummary {
  id: number
  account_name: string
  month: string             // "YYYY-MM" 또는 "YYYY/MM"
  start_asset: number       // 월초 자산
  end_asset: number         // 월말 자산
  buy_amount: number
  sell_amount: number
  fee: number
  eval_pnl: number
  realized_pnl: number
  total_pnl: number
}

// 입출금
interface Transfer {
  id: number
  account_name: string
  transfer_type: 'DEPOSIT' | 'WITHDRAW'
  amount: number
  balance_after: number
  description: string
  counterparty: string
  transfer_date: string
  created_at: string
}

// 배당금
interface Dividend {
  id: number
  account_name: string
  stock_code: string
  stock_name: string
  amount: number            // 세전
  tax: number
  net_amount: number        // 세후
  dividend_date: string
  source: 'kakao' | 'manual' | 'csv'
  currency?: string
  created_at: string
}
```

### 4.4 DB 설계 특징
- SQLite 대신 JSON 파일 사용 → 의존성 없음, 배포 간단
- 자동 증가 ID를 DB 파일 내에 저장 (`nextTradeId` 등)
- 모든 쓰기 작업 후 즉시 `fs.writeFileSync`로 저장
- 마이그레이션: `initDatabase()`에서 누락 필드 자동 추가

---

## 5. IPC 채널 목록

### 5.1 매매 (trades)
| 채널 | 설명 |
|------|------|
| `trades:getAll` | 필터 조건으로 매매 조회 |
| `trades:add` | 단건 추가 |
| `trades:addMany` | 다건 추가 |
| `trades:addWithHolding` | 추가 + 잔고 자동 갱신 |
| `trades:update` | 수정 (잔고 재계산 포함) |
| `trades:delete` | 삭제 (잔고 재계산 포함) |

### 5.2 잔고 (holdings)
| 채널 | 설명 |
|------|------|
| `holdings:get` | 계좌별 보유종목 조회 |
| `holdings:set` | 계좌 잔고 일괄 설정 |
| `holdings:refreshFromTrades` | 매매내역 기반 잔고 재계산 + 시세 조회 |
| `holdings:updatePrices` | 기존 잔고의 현재가만 업데이트 |
| `holdings:computeFromTrades` | 매매내역 기반 보유종목 계산 (저장 안 함) |

### 5.3 월별 요약 (monthly)
| 채널 | 설명 |
|------|------|
| `monthly:get` | 월별 자산총액 조회 |
| `monthly:set` | CSV에서 일괄 등록 |
| `monthly:upsert` | 개별 월 수동 입력 |
| `monthly:delete` | 계좌별 전체 삭제 |

### 5.4 입출금 (transfers) / 배당 (dividends)
| 채널 | 설명 |
|------|------|
| `transfers:getAll` / `dividends:getAll` | 조회 |
| `transfers:addMany` / `dividends:addMany` | 다건 추가 |
| `transfers:update` / `dividends:update` | 개별 수정 |
| `transfers:deleteOne` / `dividends:deleteOne` | 개별 삭제 |
| `transfers:delete` / `dividends:delete` | 계좌별 전체 삭제 |

### 5.5 기타
| 채널 | 설명 |
|------|------|
| `accounts:getAll/add/remove` | 계좌 관리 |
| `settings:get/set` | 설정 키-값 저장 |
| `exchange:rate` | 환율 조회 (6시간 캐시) |
| `dialog:saveFile/openFile` | 파일 다이얼로그 |
| `fs:writeFile/readFile` | 파일 읽기/쓰기 |
| `db:ready` | DB 초기화 완료 여부 |

---

## 6. 외부 API 연동

### 6.1 시세 조회
| 대상 | API | 캐시 |
|------|-----|------|
| 한국주식 | `polling.finance.naver.com/api/realtime/domestic/stock/{code}` | 10분 |
| 미국주식 | `query1.finance.yahoo.com/v8/finance/chart/{ticker}` | 10분 |
| 환율 (USD/KRW) | `open.er-api.com/v6/latest/USD` | 6시간 |

### 6.2 다음 금융 동기화
- 카카오 로그인 → 쿠키 추출 (persist 세션)
- `finance.daum.net/api/my/groups` — 그룹(계좌) 관리
- `finance.daum.net/api/my/groups/{gid}/items` — 종목 추가/조회
- `finance.daum.net/api/my/groups/{gid}/items/{itemId}/trades/details` — 매매 등록/조회
- Node.js `https` 모듈로 직접 요청 (Cookie 헤더 전달)
- 요청 간 300ms, 종목 간 500ms 딜레이

### 6.3 종목코드 검색
1. 잔고(holdings)에서 매칭
2. 네이버 금융 HTML 검색 (`finance.naver.com/search/searchList.naver`)
3. 다음 금융 검색 API (fallback)

---

## 7. 프론트엔드 페이지 구조

### 7.1 라우팅 (App.tsx)
```tsx
type Page = 'dashboard' | 'holdings' | 'trades' | 'transfers' |
            'dividends' | 'input' | 'analysis' | 'settings' | 'daum'

// useState로 단순 페이지 전환 (React Router 미사용)
const [currentPage, setCurrentPage] = useState<Page>('dashboard')
```

### 7.2 페이지별 핵심 로직

#### Dashboard.tsx (대시보드)
- 월별 자산총액 + 입출금 데이터 기반 수익률 계산
- 수익률 공식:
  - `수익금 = 현재총자산 - 기준일총자산 - 순입출금`
  - `수익률 = 수익금 / 기준일총자산 × 100`
  - 누적: `수익률 = 수익금 / (기준자산 + 순입출금) × 100`
- 월 형식 통일: `normalizeMonth()` 함수 (YYYY-MM ↔ YYYY/MM)
- Recharts: BarChart (월별 수익률), LineChart (자산추이), PieChart (종목비중)

#### DataInput.tsx (데이터 입력)
- 8개 탭: 카카오톡 / 미래에셋CSV / 해외CSV / 월별요약 / 입출금 / 테이블붙여넣기 / 수동입력 / 내보내기
- 카카오톡 자동 캡처: PowerShell로 Ctrl+A → Ctrl+C 자동화 (3초 딜레이)
- 중복 체크: 연속 5건 중복 시 자동 중단
- CSV 파서들은 `csvService.ts`에 분리

#### AccountHoldings.tsx (계좌 잔고)
- 매매내역 기반 자동 계산 → 시세 조회 → 잔고 갱신
- 해외주식: 달러 소수점 2자리, 원화 환산 표시
- 종목 클릭 → 상세 모달 (보유손익, 매매손익, 총손익)

---

## 8. CSV 파서 구조 (csvService.ts)

| 함수 | 용도 |
|------|------|
| `parseMiraeAssetCsv()` | 미래에셋 국내 매매내역 |
| `parseMiraeForeignCsv()` | 미래에셋 해외주식 매매내역 |
| `parseMiraeTransferCSV()` | 미래에셋 입출금 내역 |
| `parseMiraeDividendsFromTransferCSV()` | 입출금 CSV에서 배당금 추출 |
| `parseMiraeMonthlyCSV()` | 미래에셋 월별 요약 |
| `tradesToCsv()` / `holdingsToCsv()` | 내보내기 |
| `csvToTrades()` | 일반 CSV → 매매내역 (컬럼 매핑) |

파서 공통 패턴:
- 헤더 행 자동 탐색 (상위 5줄에서 키워드 매칭)
- 2행 헤더 스킵 처리
- 탭/콤마 구분자 자동 감지
- 따옴표 처리 포함

---

## 9. 빌드 설정

### 9.1 vite.config.ts 핵심
```typescript
electron([
  {
    entry: 'electron/main.ts',      // 메인 프로세스
    vite: { build: { outDir: 'dist-electron' } }
  },
  {
    entry: 'electron/preload.ts',   // preload (CJS 필수!)
    vite: {
      build: {
        outDir: 'dist-electron',
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'preload.js' }
        }
      }
    }
  }
])
```

### 9.2 electron-builder 설정 (package.json)
```json
{
  "build": {
    "appId": "com.stock-portfolio.app",
    "productName": "StockAssistant(ksk)",
    "directories": { "output": "release" },
    "win": {
      "target": "nsis",
      "signAndEditExecutable": false
    },
    "forceCodeSigning": false,
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    },
    "files": ["dist/**/*", "dist-electron/**/*"]
  }
}
```

### 9.3 빌드 명령
```bash
npm run dev              # 개발 모드 (Vite + Electron 동시 실행)
npm run build            # 프론트엔드만 빌드
npm run electron:build   # vite build + electron-builder (exe 생성)
```

---

## 10. 주의사항 / 트러블슈팅

### preload ESM 문제
- preload.ts에서 `import` 사용 시 Electron이 로드 거부
- 반드시 `const { contextBridge, ipcRenderer } = require('electron')` 사용
- vite.config.ts에서 `format: 'cjs'` 설정

### window.api undefined
- preload 로딩 타이밍 이슈 → App.tsx에서 100ms 간격 폴링으로 대기
- 최대 10초 대기 후 에러 표시

### electron-builder symlink 에러 (Windows)
- winCodeSign 압축 해제 시 symlink 권한 부족
- 해결: `"signAndEditExecutable": false`, `"forceCodeSigning": false`
- 또는 관리자 권한 터미널에서 빌드

### 월 형식 혼재
- DB에 `YYYY-MM`과 `YYYY/MM`이 혼재할 수 있음
- `normalizeMonth()` 함수로 통일 처리 필수

### 해외주식 금액 표시
- 달러: 소수점 2자리 (`toFixed(2)`)
- 원화: 소수점 없음 (`Math.round()`)
- 종목코드 판별: `/^[A-Z]{1,5}(\.[A-Z])?$/` (영문 대문자 1~5자)

---

## 11. 이 프로젝트를 참고하여 새로 만들 때

1. `npm create vite@latest my-app -- --template react-ts`
2. `npm install electron electron-builder vite-plugin-electron vite-plugin-electron-renderer recharts`
3. `electron/` 폴더에 main.ts, preload.ts(CJS!), database.ts 생성
4. vite.config.ts에 electron 플러그인 설정 (preload는 CJS 빌드)
5. `src/types/index.ts`에 `window.api` 타입 선언 (`declare global`)
6. preload.ts에서 `contextBridge.exposeInMainWorld('api', {...})` 한 번에 노출
7. App.tsx에서 `window.api` 준비 대기 로직 추가
8. 페이지별 컴포넌트 작성 (useState로 라우팅)
9. package.json에 electron-builder 설정 추가
10. `npm run dev`로 개발, `npm run electron:build`로 배포
