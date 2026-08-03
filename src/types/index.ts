export interface Trade {
  id: number
  account: string
  stock_name: string
  stock_code?: string
  trade_type: 'BUY' | 'SELL'
  quantity: number
  price: number
  total_amount: number
  fee: number
  tax: number
  trade_date: string
  source: 'kakao' | 'manual' | 'csv'
  currency?: string
  exchange_rate?: number
  raw_message?: string
  created_at: string
}

export interface TradeInput {
  account: string
  stock_name: string
  stock_code?: string
  trade_type: 'BUY' | 'SELL'
  quantity: number
  price: number
  fee: number
  tax: number
  trade_date: string
  source: 'kakao' | 'manual' | 'csv'
  currency?: string
  exchange_rate?: number
  raw_message?: string
}

export interface Holding {
  account: string
  stockName: string
  quantity: number
  avgPrice: number
  totalCost: number
}

export interface PortfolioSummary {
  holdings: Holding[]
  totalInvested: number
  totalRealizedPnl: number
  totalFees: number
  totalTax: number
  returnRate: number
}

export interface TradeFilters {
  startDate?: string
  endDate?: string
  stockName?: string
  tradeType?: string
  account?: string
}

export interface ParseTemplate {
  id?: number
  name: string
  pattern: string
  field_mapping: string
  is_active: boolean
}

export interface ParsedTrade {
  stock_name: string
  trade_type: 'BUY' | 'SELL'
  quantity: number
  price: number
  trade_date: string
  account: string
  isValid: boolean
  error?: string
}

export interface HoldingSnapshot {
  id: number
  account_name: string
  stock_code: string
  stock_name: string
  category: string
  quantity: number
  avg_price: number
  current_price: number
  purchase_amount: number
  eval_amount: number
  eval_pnl: number
  return_rate: number
  updated_at: string
}

export interface HoldingInput {
  stock_code: string
  stock_name: string
  category: string
  quantity: number
  avg_price: number
  current_price: number
  purchase_amount: number
  eval_amount: number
  eval_pnl: number
  return_rate: number
}

export interface AccountSummary {
  name: string
  totalPurchase: number
  totalEval: number
  totalPnl: number
  count: number
  returnRate: number
}

export interface HoldingsSummary {
  accounts: AccountSummary[]
  grandTotalPurchase: number
  grandTotalEval: number
  grandTotalPnl: number
  grandReturnRate: number
}

export interface MonthlySummary {
  id: number
  account_name: string
  month: string
  start_asset: number
  end_asset: number
  buy_amount: number
  sell_amount: number
  fee: number
  eval_pnl: number
  realized_pnl: number
  total_pnl: number
}

export interface MonthlySummaryInput {
  month: string
  start_asset: number
  end_asset: number
  buy_amount: number
  sell_amount: number
  fee: number
  eval_pnl: number
  realized_pnl: number
  total_pnl: number
}

export interface Transfer {
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

export interface TransferInput {
  transfer_type: 'DEPOSIT' | 'WITHDRAW'
  amount: number
  balance_after: number
  description: string
  counterparty: string
  transfer_date: string
}

export interface Dividend {
  id: number
  account_name: string
  stock_code: string
  stock_name: string
  amount: number          // 배정금액 (세전)
  tax: number             // 세금
  net_amount: number      // 실수령액 (세후)
  dividend_date: string
  source: 'kakao' | 'manual' | 'csv'
  currency?: string
  created_at: string
}

export interface DividendInput {
  stock_code: string
  stock_name: string
  amount: number
  tax: number
  net_amount: number
  dividend_date: string
  source: 'kakao' | 'manual' | 'csv'
  currency?: string
}

// 카카오톡 파싱 통합 결과 (매매 / 배당 / 입출금)
export type KakaoResultType = 'trade' | 'dividend' | 'transfer'

export interface ParsedKakaoItem {
  type: KakaoResultType
  // 공통
  account: string
  date: string
  isValid: boolean
  error?: string
  _acctNum?: string
  // 매매용
  trade?: ParsedTrade & { _stockCode?: string; _acctNum?: string; _currency?: string }
  // 배당용
  dividend?: {
    stockCode: string
    stockName: string
    amount: number       // 세전
    tax?: number         // 세금 (해외: 외국납부세액)
    netAmount?: number   // 세후
    currency?: string    // 통화 (해외: USD 등)
  }
  // 입출금용
  transfer?: {
    transferType: 'DEPOSIT' | 'WITHDRAW'
    amount: number
    balanceAfter: number
    counterparty: string
    description: string
  }
}

// 잔고 대조 결과
export interface ReconcileRow {
  account: string
  stock_name: string
  stock_code: string
  holdingQty: number
  tradeQty: number
  diff: number
  holdingAvg: number
  tradeAvg: number
  tradeCount: number
  hasAdjustment: boolean
  reason: string
}

// 자동 업데이트 상태
export type UpdateStatus =
  | { type: 'idle' }
  | { type: 'dev' }
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available'; version: string }
  | { type: 'progress'; percent: number; version: string }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

// Electron API 타입
declare global {
  interface Window {
    api: {
      trades: {
        getAll: (filters?: TradeFilters) => Promise<Trade[]>
        add: (trade: TradeInput) => Promise<number>
        addMany: (trades: TradeInput[]) => Promise<number>
        addWithHolding: (trade: TradeInput, stockCode?: string) => Promise<number>
        update: (id: number, trade: Partial<TradeInput>) => Promise<boolean>
        delete: (id: number) => Promise<boolean>
      }
      portfolio: {
        summary: () => Promise<PortfolioSummary>
        accounts: () => Promise<string[]>
        stocks: () => Promise<string[]>
      }
      settings: {
        get: (key: string) => Promise<any>
        set: (key: string, value: any) => Promise<boolean>
      }
      templates: {
        getAll: () => Promise<ParseTemplate[]>
        save: (template: ParseTemplate) => Promise<boolean>
      }
      dialog: {
        saveFile: (options: any) => Promise<string | undefined>
        openFile: (options: any) => Promise<string | null>
      }
      fs: {
        writeFile: (path: string, content: string) => Promise<boolean>
        readFile: (path: string) => Promise<string>
      }
      accounts: {
        getAll: () => Promise<string[]>
        add: (name: string) => Promise<boolean>
        remove: (name: string) => Promise<boolean>
      }
      holdings: {
        get: (accountName?: string) => Promise<HoldingSnapshot[]>
        set: (accountName: string, items: HoldingInput[]) => Promise<number>
        updatePrice: (id: number, price: number) => Promise<boolean>
        delete: (id: number) => Promise<boolean>
        summary: () => Promise<HoldingsSummary>
        refreshFromTrades: () => Promise<{ updated: number; failed: string[]; total: number }>
        updatePrices: () => Promise<{ updated: number; failed: string[]; total: number }>
        computeFromTrades: () => Promise<{ account: string; stock_name: string; stock_code: string; quantity: number; avgPrice: number; totalCost: number }[]>
      }
      exchange: {
        getRate: () => Promise<number>
      }
      monthly: {
        get: (accountName?: string) => Promise<MonthlySummary[]>
        set: (accountName: string, items: MonthlySummaryInput[]) => Promise<number>
        delete: (accountName: string) => Promise<boolean>
        upsert: (accountName: string, month: string, startAsset: number, endAsset: number) => Promise<boolean>
      }
      transfers: {
        getAll: (accountName?: string) => Promise<Transfer[]>
        addMany: (accountName: string, items: TransferInput[]) => Promise<number>
        delete: (accountName: string) => Promise<boolean>
        update: (id: number, updates: Partial<TransferInput>) => Promise<boolean>
        deleteOne: (id: number) => Promise<boolean>
      }
      dividends: {
        getAll: (accountName?: string) => Promise<Dividend[]>
        addMany: (accountName: string, items: DividendInput[]) => Promise<number>
        delete: (accountName: string) => Promise<boolean>
        update: (id: number, updates: Partial<DividendInput>) => Promise<boolean>
        deleteOne: (id: number) => Promise<boolean>
      }
      daum: {
        login: () => Promise<{ success: boolean; cookie?: string; error?: string }>
        sessionCookie: () => Promise<{ success: boolean; cookie?: string }>
        checkCookie: (cookie: string, groupId: number) => Promise<{ ok: boolean; status: number; error?: string }>
        getGroups: (cookie: string) => Promise<{ success: boolean; groups: any[]; error?: string }>
        getTrades: (cookie: string, groupId: number, itemId: number) => Promise<{ success: boolean; trades: any[]; error?: string }>
        searchStockCode: (stockName: string) => Promise<{ success: boolean; code?: string }>
        addItem: (cookie: string, groupId: number, stockCode: string) => Promise<{ success: boolean; itemId?: number; error?: string; raw?: string }>
        deleteItems: (cookie: string, groupId: number, symbolCodes: string[]) => Promise<{ success: boolean; status?: number; error?: string }>
        getEmptyItems: (cookie: string, groupId: number) => Promise<{ success: boolean; items: { name: string; symbolCode: string }[]; error?: string }>
        addTrade: (cookie: string, groupId: number, itemId: number, trade: { tradeType: string; price: number; tradeQty: number; tradeDate: string; memo: string }) => Promise<{ success: boolean; error?: string }>
        deleteTrade: (cookie: string, groupId: number, itemId: number, tradeId: number) => Promise<{ success: boolean; status?: number; error?: string }>
        syncTrade: (trade: { stockCode: string; stockName: string; tradeType: 'BUY' | 'SELL'; price: number; quantity: number; tradeDate: string; groupId: number }) => Promise<{ success: boolean; itemId?: number; error?: string }>
      }
      kakao: {
        capture: (chatRoomName: string, mode?: string) => Promise<{ success: boolean; text?: string; error?: string }>
      }
      db: {
        ready: () => Promise<boolean>
        restore: (csvDir: string) => Promise<{ success: boolean; logs: string[] }>
        getAllData: () => Promise<{ trades: number; holdings: number; monthly: number; transfers: number; dividends: number; accounts: number }>
        getPath: () => Promise<string>
        setPath: (newPath: string) => Promise<{ success: boolean; error?: string }>
      }
      reconcile: {
        get: () => Promise<ReconcileRow[]>
        apply: (targets: { account: string; stock_name: string }[]) => Promise<{ applied: number; logs: string[] }>
        clear: (account?: string) => Promise<number>
      }
      updater: {
        onStatus: (callback: (status: UpdateStatus) => void) => () => void
        getStatus: () => Promise<UpdateStatus>
        check: () => Promise<{ success: boolean; version?: string; error?: string }>
        restart: () => Promise<boolean>
      }
      app: {
        getVersion: () => Promise<string>
        getLogPath: () => Promise<string>
      }
    }
  }
}
