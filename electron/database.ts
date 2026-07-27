import path from 'path'
import fs from 'fs'
import { app } from 'electron'

interface Trade {
  id: number
  account: string
  stock_name: string
  trade_type: 'BUY' | 'SELL'
  quantity: number
  price: number
  total_amount: number
  fee: number
  tax: number
  trade_date: string
  source: string
  raw_message?: string
  created_at: string
}

interface HoldingSnapshot {
  id: number
  account_name: string
  stock_code: string
  stock_name: string
  category: string       // 현금, 유통 등
  quantity: number
  avg_price: number
  current_price: number
  purchase_amount: number
  eval_amount: number
  eval_pnl: number
  return_rate: number
  updated_at: string
}

interface MonthlySummary {
  id: number
  account_name: string
  month: string           // "2026/01" 형식
  start_asset: number     // 월초 자산총액
  end_asset: number       // 월말 자산총액
  buy_amount: number      // 매수
  sell_amount: number     // 매도
  fee: number             // 매매비용
  eval_pnl: number        // 기간 평가손익
  realized_pnl: number    // 실현손익
  total_pnl: number       // 총손익
}

interface Transfer {
  id: number
  account_name: string
  transfer_type: 'DEPOSIT' | 'WITHDRAW'  // 입금 / 출금
  amount: number
  balance_after: number   // 거래 후 예수금
  description: string     // 거래종류 (이체입금, 계좌대체출금 등)
  counterparty: string    // 상대기관/고객명
  transfer_date: string
  created_at: string
}

interface Dividend {
  id: number
  account_name: string
  stock_code: string
  stock_name: string
  amount: number          // 배정금액 (세전)
  tax: number
  net_amount: number      // 실수령액
  dividend_date: string
  source: string
  created_at: string
}

interface DbData {
  trades: Trade[]
  holdings: HoldingSnapshot[]
  accounts: string[]
  monthly_summaries: MonthlySummary[]
  transfers: Transfer[]
  dividends: Dividend[]
  settings: Record<string, any>
  parse_templates: any[]
  nextTradeId: number
  nextTemplateId: number
  nextHoldingId: number
  nextMonthlySummaryId: number
  nextTransferId: number
  nextDividendId: number
}

let data: DbData
let dbPath: string

function defaultData(): DbData {
  return {
    trades: [],
    holdings: [],
    accounts: [],
    monthly_summaries: [],
    transfers: [],
    dividends: [],
    settings: {
      buyFeeRate: 0.015,
      sellFeeRate: 0.015,
      taxRate: 0.23,
      theme: 'light'
    },
    parse_templates: [
      {
        id: 1,
        name: '미래에셋증권',
        pattern: '(매수|매도)\\s*체결[\\s\\S]*?종목[:\\s]*(.+?)[\\n\\r][\\s\\S]*?수량[:\\s]*(\\d+)[\\s\\S]*?단가[:\\s]*([\\d,]+)[\\s\\S]*?체결시간[:\\s]*([\\d\\-\\s:]+)',
        field_mapping: JSON.stringify({ tradeType: 1, stockName: 2, quantity: 3, price: 4, tradeDate: 5 }),
        is_active: true
      }
    ],
    nextTradeId: 1,
    nextTemplateId: 2,
    nextHoldingId: 1,
    nextMonthlySummaryId: 1,
    nextTransferId: 1,
    nextDividendId: 1
  }
}

/**
 * 자동 백업: 앱 시작 시 오늘 날짜 백업이 없으면 생성, 7일 이전 백업 삭제
 */
function autoBackup() {
  try {
    if (!fs.existsSync(dbPath)) return
    // 백업 디렉토리: DB 파일과 같은 폴더의 backups 하위
    const backupDir = path.join(path.dirname(dbPath), 'backups')
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })

    const today = new Date().toISOString().slice(0, 10)
    const todayBackup = path.join(backupDir, `portfolio.${today}.json`)

    // 오늘 백업이 없으면 생성
    if (!fs.existsSync(todayBackup)) {
      fs.copyFileSync(dbPath, todayBackup)
      console.log('[DB] Auto backup created:', todayBackup)
    }

    // 7일 이전 백업 삭제 (단, 최소 5개는 유지)
    const files = fs.readdirSync(backupDir).filter(f => f.startsWith('portfolio.') && f.endsWith('.json')).sort().reverse()
    if (files.length > 5) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 7)
      for (const file of files.slice(5)) {
        const dateMatch = file.match(/portfolio\.(\d{4}-\d{2}-\d{2})\.json/)
        if (dateMatch && new Date(dateMatch[1]) < cutoff) {
          fs.unlinkSync(path.join(backupDir, file))
          console.log('[DB] Old backup deleted:', file)
        }
      }
    }
  } catch (err) {
    console.error('[DB] Auto backup failed:', err)
  }
}

export function initDatabase() {
  // DB 경로: 설정 파일에서 커스텀 경로가 있으면 사용, 없으면 기본 경로
  const configPath = path.join(app.getPath('userData'), 'db-config.json')
  let customPath = ''
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (config.dbPath && fs.existsSync(path.dirname(config.dbPath))) {
        customPath = config.dbPath
      }
    }
  } catch {}

  dbPath = customPath || path.join(app.getPath('userData'), 'portfolio.json')
  console.log('[DB] Database path:', dbPath)

  // 자동 백업: 하루 1회, 최근 7일치 유지
  autoBackup()

  if (fs.existsSync(dbPath)) {
    try {
      const raw = fs.readFileSync(dbPath, 'utf-8')
      data = JSON.parse(raw)
      console.log('[DB] Loaded existing database:', {
        accounts: data.accounts?.length ?? 0,
        trades: data.trades?.length ?? 0,
        holdings: data.holdings?.length ?? 0,
        monthly: data.monthly_summaries?.length ?? 0,
        transfers: data.transfers?.length ?? 0,
        dividends: data.dividends?.length ?? 0
      })
      // 마이그레이션: 기존 데이터에 새 필드 추가
      if (!data.holdings) data.holdings = []
      if (!data.accounts) data.accounts = []
      if (!data.nextHoldingId) data.nextHoldingId = 1
      if (!data.monthly_summaries) data.monthly_summaries = []
      if (!data.nextMonthlySummaryId) data.nextMonthlySummaryId = 1
      if (!data.transfers) data.transfers = []
      if (!data.nextTransferId) data.nextTransferId = 1
      if (!data.dividends) data.dividends = []
      if (!data.nextDividendId) data.nextDividendId = 1
    } catch (err) {
      console.error('[DB] Failed to parse database file, using defaults:', err)
      data = defaultData()
    }
  } else {
    console.log('[DB] No existing database, creating new one')
    data = defaultData()
  }
  save()
}

export function isDatabaseReady(): boolean {
  return !!data
}

export function getDbPath(): string {
  return dbPath
}

export function setDbPath(newPath: string): { success: boolean; error?: string } {
  try {
    const dir = path.dirname(newPath)
    if (!fs.existsSync(dir)) return { success: false, error: '디렉토리가 존재하지 않습니다.' }

    // 기존 DB를 새 경로로 복사 (새 경로에 파일이 없으면)
    if (!fs.existsSync(newPath) && fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, newPath)
    }

    // 설정 파일에 경로 저장
    const configPath = path.join(app.getPath('userData'), 'db-config.json')
    fs.writeFileSync(configPath, JSON.stringify({ dbPath: newPath }, null, 2), 'utf-8')

    // 경로 변경 적용
    dbPath = newPath
    console.log('[DB] Path changed to:', dbPath)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

function save() {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8')
}

// === Trades ===
export function getAllTrades(filters?: {
  startDate?: string; endDate?: string; stockName?: string; tradeType?: string; account?: string
}): Trade[] {
  let result = [...data.trades]

  if (filters?.startDate) result = result.filter(t => t.trade_date.slice(0, 10) >= filters.startDate!)
  if (filters?.endDate) result = result.filter(t => t.trade_date.slice(0, 10) <= filters.endDate!)
  if (filters?.stockName) result = result.filter(t => t.stock_name.includes(filters.stockName!))
  if (filters?.tradeType) result = result.filter(t => t.trade_type === filters.tradeType)
  if (filters?.account) result = result.filter(t => t.account === filters.account)

  return result.sort((a, b) => b.trade_date.localeCompare(a.trade_date))
}

export function addTrade(trade: Omit<Trade, 'id' | 'total_amount' | 'created_at'>): number {
  const id = data.nextTradeId++
  data.trades.push({
    ...trade,
    id,
    total_amount: trade.quantity * trade.price,
    created_at: new Date().toISOString()
  })
  save()
  return id
}

export function addManyTrades(trades: Omit<Trade, 'id' | 'total_amount' | 'created_at'>[]): number {
  for (const t of trades) {
    addTrade(t)
  }
  return trades.length
}

/**
 * 매매 추가 후 해당 계좌+종목의 잔고를 자동 갱신합니다.
 * stock_code가 있으면 잔고에 반영합니다.
 */
export function addTradeAndUpdateHolding(
  trade: Omit<Trade, 'id' | 'total_amount' | 'created_at'>,
  stockCode?: string
): number {
  const id = addTrade(trade)

  // 잔고 자동 갱신: 해당 계좌의 해당 종목 찾기
  const existing = data.holdings.find(
    h => h.account_name === trade.account && h.stock_name === trade.stock_name
  )

  if (trade.trade_type === 'BUY') {
    if (existing) {
      // 기존 보유: 평균단가 재계산
      const totalCost = existing.quantity * existing.avg_price + trade.quantity * trade.price
      existing.quantity += trade.quantity
      existing.avg_price = existing.quantity > 0 ? totalCost / existing.quantity : 0
      existing.purchase_amount = existing.quantity * existing.avg_price
      existing.eval_amount = existing.quantity * existing.current_price
      existing.eval_pnl = existing.eval_amount - existing.purchase_amount
      existing.return_rate = existing.purchase_amount > 0 ? (existing.eval_pnl / existing.purchase_amount) * 100 : 0
      existing.updated_at = new Date().toISOString()
      if (stockCode && !existing.stock_code) existing.stock_code = stockCode
    } else {
      // 신규 종목: 잔고에 추가
      data.holdings.push({
        id: data.nextHoldingId++,
        account_name: trade.account,
        stock_code: stockCode || '',
        stock_name: trade.stock_name,
        category: /^[A-Z]{1,5}(\.[A-Z])?$/.test(stockCode || '') ? '해외주식' : '주식',
        quantity: trade.quantity,
        avg_price: trade.price,
        current_price: trade.price,
        purchase_amount: trade.quantity * trade.price,
        eval_amount: trade.quantity * trade.price,
        eval_pnl: 0,
        return_rate: 0,
        updated_at: new Date().toISOString()
      })
      // 계좌 목록에 없으면 추가
      if (!data.accounts.includes(trade.account)) {
        data.accounts.push(trade.account)
      }
    }
  } else if (trade.trade_type === 'SELL' && existing) {
    existing.quantity -= trade.quantity
    if (existing.quantity <= 0) {
      // 전량 매도: 잔고에서 제거
      data.holdings = data.holdings.filter(h => h.id !== existing.id)
    } else {
      // 일부 매도: 수량만 줄이고 평균단가 유지
      existing.purchase_amount = existing.quantity * existing.avg_price
      existing.eval_amount = existing.quantity * existing.current_price
      existing.eval_pnl = existing.eval_amount - existing.purchase_amount
      existing.return_rate = existing.purchase_amount > 0 ? (existing.eval_pnl / existing.purchase_amount) * 100 : 0
      existing.updated_at = new Date().toISOString()
    }
  }

  save()
  return id
}

export function updateTrade(id: number, updates: Partial<Trade>): boolean {
  const idx = data.trades.findIndex(t => t.id === id)
  if (idx === -1) return false

  const oldTrade = { ...data.trades[idx] }
  const t = data.trades[idx]
  Object.assign(t, updates)
  t.total_amount = t.quantity * t.price
  
  // 잔고 재계산: 변경 전/후 영향받는 계좌+종목 모두
  const affectedKeys = new Set<string>()
  affectedKeys.add(`${oldTrade.account}::${oldTrade.stock_name}`)
  affectedKeys.add(`${t.account}::${t.stock_name}`)

  for (const key of affectedKeys) {
    recalcHolding(key)
  }

  save()
  return true
}

/**
 * 특정 계좌+종목의 잔고를 전체 매매내역에서 재계산합니다.
 */
function recalcHolding(key: string) {
  const [account, stockName] = key.split('::')
  const trades = data.trades
    .filter(t => t.account === account && t.stock_name === stockName)
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date))

  let qty = 0, totalCost = 0
  for (const t of trades) {
    if (t.trade_type === 'BUY') {
      totalCost += t.quantity * t.price
      qty += t.quantity
    } else {
      const avgP = qty > 0 ? totalCost / qty : 0
      totalCost -= t.quantity * avgP
      qty -= t.quantity
      if (qty <= 0) { qty = 0; totalCost = 0 }
    }
  }

  const existing = data.holdings.find(
    h => h.account_name === account && h.stock_name === stockName
  )

  if (qty <= 0) {
    // 보유 없음 → 잔고에서 제거
    if (existing) {
      data.holdings = data.holdings.filter(h => h.id !== existing.id)
    }
  } else if (existing) {
    // 기존 잔고 업데이트
    existing.quantity = qty
    existing.avg_price = totalCost / qty
    existing.purchase_amount = qty * existing.avg_price
    existing.eval_amount = qty * existing.current_price
    existing.eval_pnl = existing.eval_amount - existing.purchase_amount
    existing.return_rate = existing.purchase_amount > 0 ? (existing.eval_pnl / existing.purchase_amount) * 100 : 0
    existing.updated_at = new Date().toISOString()
  } else {
    // 잔고에 없으면 새로 생성
    const avgPrice = totalCost / qty
    data.holdings.push({
      id: data.nextHoldingId++,
      account_name: account,
      stock_code: '',
      stock_name: stockName,
      category: '주식',
      quantity: qty,
      avg_price: avgPrice,
      current_price: avgPrice,
      purchase_amount: qty * avgPrice,
      eval_amount: qty * avgPrice,
      eval_pnl: 0,
      return_rate: 0,
      updated_at: new Date().toISOString()
    })
    if (!data.accounts.includes(account)) {
      data.accounts.push(account)
    }
  }
}

export function deleteTrade(id: number): boolean {
  const idx = data.trades.findIndex(t => t.id === id)
  if (idx === -1) return false

  const trade = data.trades[idx]
  data.trades.splice(idx, 1)

  // 잔고 재계산
  recalcHolding(`${trade.account}::${trade.stock_name}`)

  save()
  return true
}

// === Settings ===
export function getSetting(key: string): any {
  return data.settings[key] ?? null
}

export function setSetting(key: string, value: any) {
  data.settings[key] = value
  save()
}

// === Templates ===
export function getAllTemplates() {
  return data.parse_templates
}

export function saveTemplate(template: any) {
  if (template.id) {
    const idx = data.parse_templates.findIndex((t: any) => t.id === template.id)
    if (idx !== -1) data.parse_templates[idx] = template
  } else {
    template.id = data.nextTemplateId++
    data.parse_templates.push(template)
  }
  save()
}

// === Portfolio ===
export function getAccounts(): string[] {
  return [...new Set(data.trades.map(t => t.account))].sort()
}

export function getStocks(): string[] {
  return [...new Set(data.trades.map(t => t.stock_name))].sort()
}

export function calculatePortfolio() {
  const trades = [...data.trades].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
  const holdings: Record<string, { quantity: number; totalCost: number; avgPrice: number }> = {}
  let totalInvested = 0
  let totalRealizedPnl = 0
  let totalFees = 0
  let totalTax = 0

  for (const t of trades) {
    const key = `${t.account}::${t.stock_name}`
    if (!holdings[key]) holdings[key] = { quantity: 0, totalCost: 0, avgPrice: 0 }

    const h = holdings[key]
    if (t.trade_type === 'BUY') {
      h.totalCost += t.quantity * t.price
      h.quantity += t.quantity
      h.avgPrice = h.quantity > 0 ? h.totalCost / h.quantity : 0
      totalInvested += t.quantity * t.price
    } else {
      const costBasis = t.quantity * h.avgPrice
      totalRealizedPnl += (t.quantity * t.price) - costBasis
      h.totalCost -= costBasis
      h.quantity -= t.quantity
      if (h.quantity <= 0) { h.quantity = 0; h.totalCost = 0; h.avgPrice = 0 }
    }
    totalFees += t.fee || 0
    totalTax += t.tax || 0
  }

  const holdingsList = Object.entries(holdings)
    .filter(([, v]) => v.quantity > 0)
    .map(([key, v]) => {
      const [account, stockName] = key.split('::')
      return { account, stockName, quantity: v.quantity, avgPrice: Math.round(v.avgPrice), totalCost: Math.round(v.totalCost) }
    })

  return {
    holdings: holdingsList,
    totalInvested: Math.round(totalInvested),
    totalRealizedPnl: Math.round(totalRealizedPnl - totalFees - totalTax),
    totalFees: Math.round(totalFees),
    totalTax: Math.round(totalTax),
    returnRate: totalInvested > 0 ? ((totalRealizedPnl - totalFees - totalTax) / totalInvested * 100) : 0
  }
}

// === 전체 데이터 (백업용) ===
export function getAllData(): DbData {
  return data
}

export function restoreTrades(trades: any[]) {
  for (const t of trades) {
    addTrade(t)
  }
}

// === 계좌 관리 ===
export function getAllAccounts(): string[] {
  return data.accounts
}

export function addAccount(name: string): boolean {
  if (data.accounts.includes(name)) return false
  data.accounts.push(name)
  save()
  return true
}

export function removeAccount(name: string): boolean {
  const idx = data.accounts.indexOf(name)
  if (idx === -1) return false
  data.accounts.splice(idx, 1)
  // 해당 계좌의 잔고도 삭제
  data.holdings = data.holdings.filter(h => h.account_name !== name)
  save()
  return true
}

// === 잔고 스냅샷 ===
export function getHoldings(accountName?: string): HoldingSnapshot[] {
  if (accountName) {
    return data.holdings.filter(h => h.account_name === accountName)
  }
  return data.holdings
}

export function setHoldings(accountName: string, items: Omit<HoldingSnapshot, 'id' | 'account_name' | 'updated_at'>[]): number {
  // 해당 계좌의 기존 잔고 삭제 후 새로 등록
  data.holdings = data.holdings.filter(h => h.account_name !== accountName)
  const now = new Date().toISOString()
  for (const item of items) {
    data.holdings.push({
      ...item,
      id: data.nextHoldingId++,
      account_name: accountName,
      updated_at: now
    })
  }
  // 계좌 목록에 없으면 추가
  if (!data.accounts.includes(accountName)) {
    data.accounts.push(accountName)
  }
  save()
  return items.length
}

export function updateHoldingPrice(id: number, currentPrice: number): boolean {
  const h = data.holdings.find(h => h.id === id)
  if (!h) return false
  h.current_price = currentPrice
  h.eval_amount = h.quantity * currentPrice
  h.eval_pnl = h.eval_amount - h.purchase_amount
  h.return_rate = h.purchase_amount > 0 ? (h.eval_pnl / h.purchase_amount) * 100 : 0
  h.updated_at = new Date().toISOString()
  save()
  return true
}

export function deleteHolding(id: number): boolean {
  const idx = data.holdings.findIndex(h => h.id === id)
  if (idx === -1) return false
  data.holdings.splice(idx, 1)
  save()
  return true
}

export function getHoldingsSummary(exchangeRate: number = 1) {
  const isForeign = (code: string) => /^[A-Z]{1,5}(\.[A-Z])?$/.test(code)
  const byAccount: Record<string, { totalPurchase: number; totalEval: number; totalPnl: number; count: number }> = {}

  for (const acct of data.accounts) {
    byAccount[acct] = { totalPurchase: 0, totalEval: 0, totalPnl: 0, count: 0 }
  }

  for (const h of data.holdings) {
    if (!byAccount[h.account_name]) {
      byAccount[h.account_name] = { totalPurchase: 0, totalEval: 0, totalPnl: 0, count: 0 }
    }
    const multiplier = isForeign(h.stock_code) ? exchangeRate : 1
    byAccount[h.account_name].totalPurchase += Math.round(h.purchase_amount * multiplier)
    byAccount[h.account_name].totalEval += Math.round(h.eval_amount * multiplier)
    byAccount[h.account_name].totalPnl += Math.round(h.eval_pnl * multiplier)
    byAccount[h.account_name].count++
  }

  let grandTotalPurchase = 0
  let grandTotalEval = 0
  let grandTotalPnl = 0

  const accounts = Object.entries(byAccount).map(([name, s]) => {
    grandTotalPurchase += s.totalPurchase
    grandTotalEval += s.totalEval
    grandTotalPnl += s.totalPnl
    return {
      name,
      ...s,
      returnRate: s.totalPurchase > 0 ? (s.totalPnl / s.totalPurchase) * 100 : 0
    }
  })

  return {
    accounts,
    grandTotalPurchase,
    grandTotalEval,
    grandTotalPnl,
    grandReturnRate: grandTotalPurchase > 0 ? (grandTotalPnl / grandTotalPurchase) * 100 : 0
  }
}


// === 매매내역 기반 보유종목 계산 ===
export function computeHoldingsFromTrades(): {
  account: string; stock_name: string; stock_code: string;
  quantity: number; avgPrice: number; totalCost: number
}[] {
  const trades = [...data.trades].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
  const holdings: Record<string, { qty: number; totalCost: number; avgPrice: number }> = {}

  for (const t of trades) {
    const key = `${t.account}::${t.stock_name}`
    if (!holdings[key]) holdings[key] = { qty: 0, totalCost: 0, avgPrice: 0 }
    const h = holdings[key]

    if (t.trade_type === 'BUY') {
      h.totalCost += t.quantity * t.price
      h.qty += t.quantity
      h.avgPrice = h.qty > 0 ? h.totalCost / h.qty : 0
    } else {
      const costBasis = t.quantity * h.avgPrice
      h.totalCost -= costBasis
      h.qty -= t.quantity
      if (h.qty <= 0) { h.qty = 0; h.totalCost = 0; h.avgPrice = 0 }
    }
  }

  return Object.entries(holdings)
    .filter(([, v]) => v.qty > 0)
    .map(([key, v]) => {
      const [account, stock_name] = key.split('::')
      // 잔고에서 stock_code 찾기 (없으면 빈 문자열)
      const existing = data.holdings.find(h => h.account_name === account && h.stock_name === stock_name)
      return {
        account, stock_name,
        stock_code: existing?.stock_code || '',
        quantity: v.qty,
        avgPrice: v.avgPrice,
        totalCost: v.totalCost
      }
    })
}

// === 월별 요약 ===
export function getMonthlySummaries(accountName?: string): MonthlySummary[] {
  if (accountName) {
    return data.monthly_summaries.filter(m => m.account_name === accountName)
      .sort((a, b) => a.month.localeCompare(b.month))
  }
  return [...data.monthly_summaries].sort((a, b) => a.month.localeCompare(b.month))
}

export function setMonthlySummaries(
  accountName: string,
  items: Omit<MonthlySummary, 'id' | 'account_name'>[]
): number {
  // 해당 계좌의 기존 월별 요약 삭제 후 새로 등록
  data.monthly_summaries = data.monthly_summaries.filter(m => m.account_name !== accountName)
  for (const item of items) {
    data.monthly_summaries.push({
      ...item,
      id: data.nextMonthlySummaryId++,
      account_name: accountName
    })
  }
  if (!data.accounts.includes(accountName)) {
    data.accounts.push(accountName)
  }
  save()
  return items.length
}

export function deleteMonthlySummaries(accountName: string): boolean {
  const before = data.monthly_summaries.length
  data.monthly_summaries = data.monthly_summaries.filter(m => m.account_name !== accountName)
  save()
  return data.monthly_summaries.length < before
}

/**
 * 개별 월 자산총액 upsert (수동 입력용)
 * 해당 계좌+월이 이미 있으면 start_asset/end_asset만 업데이트, 없으면 새로 추가
 */
export function upsertMonthlyAsset(accountName: string, month: string, startAsset: number, endAsset: number): boolean {
  const existing = data.monthly_summaries.find(m => m.account_name === accountName && m.month === month)
  if (existing) {
    existing.start_asset = startAsset
    existing.end_asset = endAsset
  } else {
    data.monthly_summaries.push({
      id: data.nextMonthlySummaryId++,
      account_name: accountName,
      month,
      start_asset: startAsset,
      end_asset: endAsset,
      buy_amount: 0, sell_amount: 0, fee: 0,
      eval_pnl: 0, realized_pnl: 0, total_pnl: 0
    })
    if (!data.accounts.includes(accountName)) {
      data.accounts.push(accountName)
    }
  }
  save()
  return true
}

// === 입출금 내역 ===
export function getTransfers(accountName?: string): Transfer[] {
  if (accountName) {
    return data.transfers.filter(t => t.account_name === accountName)
      .sort((a, b) => b.transfer_date.localeCompare(a.transfer_date))
  }
  return [...data.transfers].sort((a, b) => b.transfer_date.localeCompare(a.transfer_date))
}

export function addManyTransfers(accountName: string, items: Omit<Transfer, 'id' | 'account_name' | 'created_at'>[]): number {
  const now = new Date().toISOString()
  for (const item of items) {
    data.transfers.push({
      ...item,
      id: data.nextTransferId++,
      account_name: accountName,
      created_at: now
    })
  }
  if (!data.accounts.includes(accountName)) {
    data.accounts.push(accountName)
  }
  save()
  return items.length
}

export function deleteTransfers(accountName: string): boolean {
  const before = data.transfers.length
  data.transfers = data.transfers.filter(t => t.account_name !== accountName)
  save()
  return data.transfers.length < before
}

export function updateTransfer(id: number, updates: Partial<Transfer>): boolean {
  const t = data.transfers.find(t => t.id === id)
  if (!t) return false
  if (updates.transfer_type !== undefined) t.transfer_type = updates.transfer_type
  if (updates.amount !== undefined) t.amount = updates.amount
  if (updates.balance_after !== undefined) t.balance_after = updates.balance_after
  if (updates.description !== undefined) t.description = updates.description
  if (updates.counterparty !== undefined) t.counterparty = updates.counterparty
  if (updates.transfer_date !== undefined) t.transfer_date = updates.transfer_date
  save()
  return true
}

export function deleteTransferById(id: number): boolean {
  const before = data.transfers.length
  data.transfers = data.transfers.filter(t => t.id !== id)
  save()
  return data.transfers.length < before
}



// === 배당 내역 ===
export function getDividends(accountName?: string): Dividend[] {
  if (accountName) {
    return data.dividends.filter(d => d.account_name === accountName)
      .sort((a, b) => b.dividend_date.localeCompare(a.dividend_date))
  }
  return [...data.dividends].sort((a, b) => b.dividend_date.localeCompare(a.dividend_date))
}

export function addManyDividends(accountName: string, items: Omit<Dividend, 'id' | 'account_name' | 'created_at'>[]): number {
  const now = new Date().toISOString()
  for (const item of items) {
    data.dividends.push({
      ...item,
      id: data.nextDividendId++,
      account_name: accountName,
      created_at: now
    })
  }
  if (!data.accounts.includes(accountName)) {
    data.accounts.push(accountName)
  }
  save()
  return items.length
}

export function deleteDividends(accountName: string): boolean {
  const before = data.dividends.length
  data.dividends = data.dividends.filter(d => d.account_name !== accountName)
  save()
  return data.dividends.length < before
}

export function updateDividend(id: number, updates: Partial<Omit<Dividend, 'id' | 'created_at'>>): boolean {
  const idx = data.dividends.findIndex(d => d.id === id)
  if (idx < 0) return false
  data.dividends[idx] = { ...data.dividends[idx], ...updates }
  save()
  return true
}

export function deleteDividendById(id: number): boolean {
  const before = data.dividends.length
  data.dividends = data.dividends.filter(d => d.id !== id)
  save()
  return data.dividends.length < before
}

// === 데이터 복구 (CSV 파일에서) ===
export async function restoreFromCsvFiles(csvDir: string): Promise<string[]> {
  const logs: string[] = []
  
  function parseCsvLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQuotes = !inQuotes }
      else if ((ch === ',' || ch === '\t') && !inQuotes) { result.push(current.trim()); current = '' }
      else { current += ch }
    }
    result.push(current.trim())
    return result
  }

  function parseNum(s: string): number {
    if (!s) return 0
    return parseFloat(s.replace(/[^0-9.\-]/g, '')) || 0
  }

  function readCsv(filename: string): string {
    const p = path.join(csvDir, filename)
    if (!fs.existsSync(p)) return ''
    return fs.readFileSync(p, 'utf-8')
  }

  // 1. 계좌 등록
  const accountNames: Record<string, string> = {
    'main': '[선근] 메인 (72480)',
    'isa': '[선근] ISA (18160)',
    'us': '[선근] 미국 (40410)',
    'irp': '[선근] IRP연금 (46720)',
    'sister': '[큰누나] 통합 (48800)',
    'dain': '[다인] 통합 (39630)',
    'mother': '[장모님] 통합 (27980)',
    'combined': '[합산] 메인+ISA'
  }
  for (const name of Object.values(accountNames)) {
    if (!data.accounts.includes(name)) {
      data.accounts.push(name)
    }
  }
  save()
  logs.push(`[복구] 계좌 ${data.accounts.length}개 등록`)

  // 2. 국내 매매내역 CSV 파싱 (미래에셋 형식)
  function parseMiraeTrades(content: string, accountName: string): number {
    const lines = content.trim().split('\n')
    if (lines.length < 3) return 0
    let count = 0
    for (let i = 2; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i])
      if (cols.length < 9) continue
      const dateStr = cols[0]?.replace(/\//g, '-')
      if (!dateStr || !/^\d{4}/.test(dateStr)) continue
      const stockName = (cols[1] || '').replace(/\(유통\)$/, '').trim()
      if (!stockName) continue
      const buyQty = parseNum(cols[2]), buyPrice = parseNum(cols[3])
      const sellQty = parseNum(cols[5]), sellPrice = parseNum(cols[6])
      const fee = parseNum(cols[8])
      if (buyQty > 0 && buyPrice > 0) {
        addTrade({ account: accountName, stock_name: stockName, trade_type: 'BUY', quantity: buyQty, price: buyPrice, fee, tax: 0, trade_date: dateStr, source: 'csv' })
        count++
      }
      if (sellQty > 0 && sellPrice > 0) {
        addTrade({ account: accountName, stock_name: stockName, trade_type: 'SELL', quantity: sellQty, price: sellPrice, fee, tax: 0, trade_date: dateStr, source: 'csv' })
        count++
      }
    }
    return count
  }

  // 3. 해외 매매내역 CSV 파싱
  function parseForeignTrades(content: string, accountName: string): number {
    const lines = content.trim().split('\n')
    if (lines.length < 2) return 0
    let count = 0
    const dataStart = lines[0].includes('매매일') ? 1 : 0
    for (let i = dataStart; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i])
      if (cols.length < 10) continue
      let dateStr = (cols[0] || '').replace(/\//g, '-')
      if (!/^\d{4}/.test(dateStr)) continue
      const currency = cols[1] || 'USD'
      const stockCode = cols[2] || ''
      const stockName = cols[3] || stockCode
      const buyQty = parseNum(cols[7]), buyPrice = parseNum(cols[8])
      const sellQty = parseNum(cols[11]), sellPrice = parseNum(cols[12])
      const fee = parseNum(cols[15]), tax = parseNum(cols[16])
      const exchangeRate = parseNum(cols[6])
      if (buyQty > 0 && buyPrice > 0) {
        addTrade({ account: accountName, stock_name: stockName, stock_code: stockCode, trade_type: 'BUY', quantity: buyQty, price: buyPrice, fee, tax: 0, trade_date: dateStr, source: 'csv', currency, exchange_rate: exchangeRate || undefined } as any)
        count++
      }
      if (sellQty > 0 && sellPrice > 0) {
        addTrade({ account: accountName, stock_name: stockName, stock_code: stockCode, trade_type: 'SELL', quantity: sellQty, price: sellPrice, fee, tax, trade_date: dateStr, source: 'csv', currency, exchange_rate: exchangeRate || undefined } as any)
        count++
      }
    }
    return count
  }

  // 4. 입출금 CSV 파싱 (미래에셋 형식 - 2행 헤더)
  function parseTransfers(content: string, accountName: string): number {
    const lines = content.trim().split('\n')
    if (lines.length < 3) return 0
    let headerIdx = 0
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      if (/거래일자/.test(lines[i]) && /거래종류/.test(lines[i])) { headerIdx = i; break }
    }
    const headers = parseCsvLine(lines[headerIdx])
    const dateCol = headers.findIndex(h => /거래일자/.test(h))
    const typeCol = headers.findIndex(h => /거래종류/.test(h))
    const amountCol = headers.findIndex(h => /^입출금액$|^거래금액$/.test(h))
    const balanceCol = headers.findIndex(h => /예수금/.test(h))
    const orgCol = headers.findIndex(h => /상대기관/.test(h))
    const nameCol = headers.findIndex(h => /상대고객명/.test(h))
    const effectiveAmountCol = amountCol >= 0 ? amountCol : headers.findIndex(h => /거래금액/.test(h))
    
    // 2행 헤더 스킵
    let dataStart = headerIdx + 1
    if (dataStart < lines.length && !/^\d{4}/.test(parseCsvLine(lines[dataStart])[0] || '')) dataStart++
    
    let count = 0
    const transferItems: any[] = []
    const dividendItems: any[] = []
    
    for (let i = dataStart; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i])
      if (cols.length < 3) continue
      const dateStr = (cols[dateCol] || '').replace(/\//g, '-')
      if (!dateStr || !/^\d{4}/.test(dateStr)) continue
      const txType = cols[typeCol] || ''
      
      // 배당금
      if (/배당|분배금/.test(txType)) {
        const netAmount = parseNum(cols[effectiveAmountCol] || '0')
        if (netAmount > 0) {
          const codeCol = headers.findIndex(h => /종목번호|종목코드/.test(h))
          const stockCode = codeCol >= 0 ? (cols[codeCol] || '').replace(/^A/, '') : ''
          dividendItems.push({
            stock_code: stockCode, stock_name: stockCode || '배당금',
            amount: netAmount, tax: 0, net_amount: netAmount,
            dividend_date: dateStr, source: 'csv' as const
          })
        }
        continue
      }
      
      if (/공모주/.test(txType)) continue
      let transferType: 'DEPOSIT' | 'WITHDRAW' | null = null
      if (/이체입금|계좌대체입금|입금/.test(txType) && !/출금/.test(txType)) transferType = 'DEPOSIT'
      else if (/계좌대체출금|이체출금|이체송금|출금/.test(txType) && !/입금/.test(txType)) transferType = 'WITHDRAW'
      if (!transferType) continue
      const amount = parseNum(cols[effectiveAmountCol] || '0')
      if (amount <= 0) continue
      const balanceAfter = parseNum(cols[balanceCol] || '0')
      const org = orgCol >= 0 ? cols[orgCol] || '' : ''
      const name = nameCol >= 0 ? cols[nameCol] || '' : ''
      transferItems.push({
        transfer_type: transferType, amount, balance_after: balanceAfter,
        description: txType, counterparty: [org, name].filter(Boolean).join(' '), transfer_date: dateStr
      })
    }
    
    if (transferItems.length > 0) {
      addManyTransfers(accountName, transferItems)
      count += transferItems.length
    }
    if (dividendItems.length > 0) {
      addManyDividends(accountName, dividendItems)
      count += dividendItems.length
    }
    return count
  }

  // 5. 월별 요약 CSV 파싱
  function parseMonthly(content: string, accountName: string): number {
    const lines = content.trim().split('\n')
    if (lines.length < 2) return 0
    let dataStart = 0
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      if (/월/.test(lines[i]) && /자산/.test(lines[i])) { dataStart = i + 1; break }
    }
    if (dataStart === 0) dataStart = 1
    const items: any[] = []
    for (let i = dataStart; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i])
      if (cols.length < 8) continue
      const month = cols[0]
      if (!month || !/^\d{4}/.test(month)) continue
      items.push({
        month: month.replace(/\//g, '-'),
        start_asset: parseNum(cols[1]), end_asset: parseNum(cols[2]),
        buy_amount: parseNum(cols[3]), sell_amount: parseNum(cols[4]),
        fee: parseNum(cols[5]), eval_pnl: parseNum(cols[6]),
        realized_pnl: parseNum(cols[7]),
        total_pnl: cols[8] ? parseNum(cols[8]) : parseNum(cols[6]) + parseNum(cols[7])
      })
    }
    if (items.length > 0) setMonthlySummaries(accountName, items)
    return items.length
  }

  // 6. 엑셀 CSV에서 합산 계좌 월별 데이터 생성
  function parseCombinedDaily(content: string): number {
    const lines = content.trim().split('\n').filter(l => l.trim())
    const dailyData: { date: string; asset: number; transfer: number }[] = []
    for (let i = 1; i < lines.length; i++) {
      // CSV with quoted fields
      const fields: string[] = []
      let current = '', inQ = false
      for (let j = 0; j < lines[i].length; j++) {
        const c = lines[i][j]
        if (c === '"') inQ = !inQ
        else if (c === ',' && !inQ) { fields.push(current.trim()); current = '' }
        else current += c
      }
      fields.push(current.trim())
      const date = (fields[0] || '').replace(/"/g, '').trim()
      if (!/^\d{4}-/.test(date)) continue
      const asset = parseNum(fields[1])
      const transfer = fields.length >= 5 ? parseNum(fields[4]) : 0
      dailyData.push({ date, asset, transfer })
    }
    
    // 월별 집계
    const monthMap: Record<string, { firstDate: string; firstAsset: number; lastDate: string; lastAsset: number; transfers: number }> = {}
    for (const d of dailyData) {
      const ym = d.date.substring(0, 7)
      if (!monthMap[ym]) monthMap[ym] = { firstDate: '9999', firstAsset: 0, lastDate: '0000', lastAsset: 0, transfers: 0 }
      const m = monthMap[ym]
      if (d.date < m.firstDate) { m.firstDate = d.date; m.firstAsset = d.asset }
      if (d.date > m.lastDate) { m.lastDate = d.date; m.lastAsset = d.asset }
      m.transfers += d.transfer
    }
    
    // 이전 월 end → 다음 월 start
    const months = Object.keys(monthMap).sort()
    let prevEnd = 0
    const items: any[] = []
    const transferItems: any[] = []
    
    for (const ym of months) {
      const m = monthMap[ym]
      const startAsset = prevEnd > 0 ? prevEnd : m.firstAsset
      items.push({
        month: ym, start_asset: startAsset, end_asset: m.lastAsset,
        buy_amount: 0, sell_amount: 0, fee: 0, eval_pnl: 0, realized_pnl: 0, total_pnl: 0
      })
      prevEnd = m.lastAsset
    }
    
    // 입출금도 등록
    for (const d of dailyData) {
      if (d.transfer !== 0) {
        transferItems.push({
          transfer_type: d.transfer > 0 ? 'DEPOSIT' as const : 'WITHDRAW' as const,
          amount: Math.abs(d.transfer), balance_after: 0,
          description: 'CSV import', counterparty: '', transfer_date: d.date
        })
      }
    }
    
    if (items.length > 0) setMonthlySummaries(accountNames.combined, items)
    if (transferItems.length > 0) addManyTransfers(accountNames.combined, transferItems)
    
    return items.length
  }

  // === 실행 ===
  try {
    // 잔고 (holdings)
    function parseHoldings(content: string, accountName: string): number {
      const lines = content.trim().split('\n')
      if (lines.length < 2) return 0
      // 헤더: 유형,종목번호,종목명,구분,보유량,평균단가,현재가,매입금액,평가금액,평가손익,수익률
      const items: any[] = []
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i])
        if (cols.length < 10) continue
        const type = cols[0]
        if (type === '통화') continue // 현금(USD 등) 스킵
        const stockCode = (cols[1] || '').replace(/^A/, '')
        const stockName = cols[2] || ''
        if (!stockName) continue
        const quantity = parseNum(cols[4])
        if (quantity <= 0) continue
        const avgPrice = parseNum(cols[5])
        const currentPrice = parseNum(cols[6])
        const purchaseAmount = parseNum(cols[7])
        const evalAmount = parseNum(cols[8])
        const evalPnl = parseNum(cols[9])
        const returnRate = parseNum(cols[10])
        const category = /해외/.test(type) ? '해외주식' : '주식'
        items.push({
          stock_code: stockCode, stock_name: stockName, category,
          quantity, avg_price: avgPrice, current_price: currentPrice,
          purchase_amount: purchaseAmount, eval_amount: evalAmount,
          eval_pnl: evalPnl, return_rate: returnRate
        })
      }
      if (items.length > 0) setHoldings(accountName, items)
      return items.length
    }

    // 잔고 복구
    let c = readCsv('메인 계좌 잔고.csv')
    if (c) { const n = parseHoldings(c, accountNames.main); logs.push(`[복구] 메인 잔고: ${n}종목`) }
    c = readCsv('isa 계좌 잔고.csv')
    if (c) { const n = parseHoldings(c, accountNames.isa); logs.push(`[복구] ISA 잔고: ${n}종목`) }
    c = readCsv('미국 계좌 잔고.csv')
    if (c) { const n = parseHoldings(c, accountNames.us); logs.push(`[복구] 미국 잔고: ${n}종목`) }
    c = readCsv('다인 계좌 잔고.csv')
    if (c) { const n = parseHoldings(c, accountNames.dain); logs.push(`[복구] 다인 잔고: ${n}종목`) }

    // 국내 매매
    c = readCsv('메인 계좌 매매내역.csv')
    if (c) { const n = parseMiraeTrades(c, accountNames.main); logs.push(`[복구] 메인 매매내역: ${n}건`) }
    c = readCsv('메인 매매2.csv')
    if (c) { const n = parseMiraeTrades(c, accountNames.main); logs.push(`[복구] 메인 매매2: ${n}건`) }
    c = readCsv('isa 매매 내역.csv')
    if (c) { const n = parseMiraeTrades(c, accountNames.isa); logs.push(`[복구] ISA 매매: ${n}건`) }
    c = readCsv('isa 매매 2.csv')
    if (c) { const n = parseMiraeTrades(c, accountNames.isa); logs.push(`[복구] ISA 매매2: ${n}건`) }
    c = readCsv('irp 매매.csv')
    if (c) { const n = parseMiraeTrades(c, accountNames.irp); logs.push(`[복구] IRP 매매: ${n}건`) }
    c = readCsv('큰누나 매매.csv')
    if (c) { const n = parseMiraeTrades(c, accountNames.sister); logs.push(`[복구] 큰누나 매매: ${n}건`) }
    c = readCsv('다인 매매 내역.csv')
    if (c) { const n = parseMiraeTrades(c, accountNames.dain); logs.push(`[복구] 다인 매매: ${n}건`) }

    // 해외 매매
    c = readCsv('미국 매매내역.csv')
    if (c) { const n = parseForeignTrades(c, accountNames.us); logs.push(`[복구] 미국 매매: ${n}건`) }
    c = readCsv('다인 미국 매매내역.csv')
    if (c) { const n = parseForeignTrades(c, accountNames.dain); logs.push(`[복구] 다인 미국 매매: ${n}건`) }

    // 입출금
    c = readCsv('메인 입출금 내역.csv')
    if (c) { const n = parseTransfers(c, accountNames.main); logs.push(`[복구] 메인 입출금: ${n}건`) }
    c = readCsv('ISA 이체 내역.csv')
    if (c) { const n = parseTransfers(c, accountNames.isa); logs.push(`[복구] ISA 입출금: ${n}건`) }
    c = readCsv('미국 입출금 내역.csv')
    if (c) { const n = parseTransfers(c, accountNames.us); logs.push(`[복구] 미국 입출금: ${n}건`) }
    c = readCsv('다인 입출금.csv')
    if (c) { const n = parseTransfers(c, accountNames.dain); logs.push(`[복구] 다인 입출금: ${n}건`) }

    // 월별 요약
    c = readCsv('메인 계좌 월별 수익률.csv')
    if (c) { const n = parseMonthly(c, accountNames.main); logs.push(`[복구] 메인 월별: ${n}개월`) }
    c = readCsv('isa 월별 수익률 .csv')
    if (c) { const n = parseMonthly(c, accountNames.isa); logs.push(`[복구] ISA 월별: ${n}개월`) }

    // 합산 계좌 (엑셀 CSV) — 2025-05까지의 월별 자산/입출금만
    c = readCsv('[기존 정리] 계좌 상세 데이터.csv')
    if (c) { const n = parseCombinedDaily(c); logs.push(`[복구] 합산 월별: ${n}개월`) }

    // 합산 계좌 보충: 2025-06부터 메인+ISA 월별 합산
    const combinedMonthly = data.monthly_summaries.filter(m => m.account_name === accountNames.combined)
    const mainMonthly = data.monthly_summaries.filter(m => m.account_name === accountNames.main)
    const isaMonthly = data.monthly_summaries.filter(m => m.account_name === accountNames.isa)
    const combinedMonths = new Set(combinedMonthly.map(m => m.month.replace(/-/g, '/')))
    
    // 메인+ISA에 있지만 합산에 없는 월 (2025/06 이후만)
    const allSourceMonths = new Set([
      ...mainMonthly.map(m => m.month.replace(/-/g, '/')),
      ...isaMonthly.map(m => m.month.replace(/-/g, '/'))
    ])
    const missingMonths = [...allSourceMonths].filter(m => !combinedMonths.has(m) && m >= '2025/06').sort()
    
    if (missingMonths.length > 0) {
      const supplementItems: any[] = []
      
      for (const month of missingMonths) {
        const mainM = mainMonthly.find(m => m.month.replace(/-/g, '/') === month)
        const isaM = isaMonthly.find(m => m.month.replace(/-/g, '/') === month)
        if (!mainM && !isaM) continue
        supplementItems.push({
          month: month.replace(/\//g, '-'),
          start_asset: (mainM?.start_asset || 0) + (isaM?.start_asset || 0),
          end_asset: (mainM?.end_asset || 0) + (isaM?.end_asset || 0),
          buy_amount: (mainM?.buy_amount || 0) + (isaM?.buy_amount || 0),
          sell_amount: (mainM?.sell_amount || 0) + (isaM?.sell_amount || 0),
          fee: (mainM?.fee || 0) + (isaM?.fee || 0),
          eval_pnl: (mainM?.eval_pnl || 0) + (isaM?.eval_pnl || 0),
          realized_pnl: (mainM?.realized_pnl || 0) + (isaM?.realized_pnl || 0),
          total_pnl: (mainM?.total_pnl || 0) + (isaM?.total_pnl || 0)
        })
      }
      
      if (supplementItems.length > 0) {
        const existingItems = combinedMonthly.map(m => ({
          month: m.month, start_asset: m.start_asset, end_asset: m.end_asset,
          buy_amount: m.buy_amount, sell_amount: m.sell_amount, fee: m.fee,
          eval_pnl: m.eval_pnl, realized_pnl: m.realized_pnl, total_pnl: m.total_pnl
        }))
        setMonthlySummaries(accountNames.combined, [...existingItems, ...supplementItems])
        logs.push(`[복구] 합산 보충 월별: ${supplementItems.length}개월 (${missingMonths[0]}~${missingMonths[missingMonths.length - 1]})`)
      }
      
      // 2025-06 이후 메인+ISA 월별 합산만 보충 (입출금은 넣지 않음 — 합산은 대시보드 수익률 계산용)
    }

    logs.push(`[복구 완료] trades: ${data.trades.length}, holdings: ${data.holdings.length}, transfers: ${data.transfers.length}, dividends: ${data.dividends.length}, monthly: ${data.monthly_summaries.length}`)
  } catch (err) {
    logs.push(`[복구 오류] ${String(err)}`)
  }
  
  return logs
}
