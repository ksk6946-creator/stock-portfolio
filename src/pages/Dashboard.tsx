import { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, ReferenceLine } from 'recharts'
import type { HoldingSnapshot, MonthlySummary, Transfer } from '../types'
import { formatKRW, formatPercent } from '../services/parser'

const COLORS = ['#4263eb', '#e03131', '#2b8a3e', '#f08c00', '#7048e8', '#0ca678', '#e8590c', '#1098ad', '#d6336c', '#495057']

export default function Dashboard() {
  const [accounts, setAccounts] = useState<string[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set())
  const [holdings, setHoldings] = useState<HoldingSnapshot[]>([])
  const [monthlySummaries, setMonthlySummaries] = useState<MonthlySummary[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [exchangeRate, setExchangeRate] = useState(1450)
  const [loaded, setLoaded] = useState(false)
  const [showMonthlyDetail, setShowMonthlyDetail] = useState(false)

  const defaultAccountPatterns = ['메인', 'ISA']

  useEffect(() => { loadData() }, [])

  const retryCountRef = { current: 0 }

  async function waitForApi(maxWait = 5000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < maxWait) {
      if (window.api?.accounts) return true
      await new Promise(r => setTimeout(r, 300))
    }
    return !!window.api?.accounts
  }

  async function loadData() {
    try {
      const apiReady = await waitForApi()
      if (!apiReady) {
        if (retryCountRef.current < 5) { retryCountRef.current++; setTimeout(() => loadData(), 2000); return }
        setLoaded(true); return
      }

      let accts: string[] = []
      let allHoldings: HoldingSnapshot[] = []
      let rate = 1450
      let monthly: MonthlySummary[] = []
      let xfers: Transfer[] = []

      try { accts = await window.api.accounts.getAll() } catch { accts = [] }
      try { allHoldings = await window.api.holdings.get() } catch { allHoldings = [] }
      try { rate = await window.api.exchange.getRate() } catch { rate = 1450 }
      try { monthly = await window.api.monthly.get() } catch { monthly = [] }
      try { xfers = await window.api.transfers.getAll() } catch { xfers = [] }

      if (accts.length === 0) {
        const fromHoldings = allHoldings.map(h => h.account_name)
        const fromMonthly = monthly.map(m => m.account_name)
        const fromTransfers = xfers.map(t => t.account_name)
        accts = [...new Set([...fromHoldings, ...fromMonthly, ...fromTransfers])].filter(Boolean)
      }

      if (accts.length === 0 && allHoldings.length === 0 && monthly.length === 0 && retryCountRef.current < 5) {
        retryCountRef.current++; setTimeout(() => loadData(), 2000); return
      }

      // 합산 계좌를 맨 앞으로
      const combinedIdx = accts.indexOf(COMBINED_ACCOUNT)
      if (combinedIdx > 0) {
        accts.splice(combinedIdx, 1)
        accts.unshift(COMBINED_ACCOUNT)
      }

      setAccounts(accts)
      setHoldings(allHoldings)
      setExchangeRate(rate)
      setMonthlySummaries(monthly)
      setTransfers(xfers)

      const defaults = accts.filter((a: string) => defaultAccountPatterns.some(p => a.includes(p)))
      setSelectedAccounts(new Set(defaults.length > 0 ? defaults : accts))
    } catch (err) {
      console.error('[Dashboard] Failed to load:', err)
    } finally {
      setLoaded(true)
    }
  }

  function isForeign(code: string) { return /^[A-Z]{1,5}(\.[A-Z])?$/.test(code) }
  function toKRW(h: HoldingSnapshot) { return isForeign(h.stock_code) ? h.eval_amount * exchangeRate : h.eval_amount }
  function purchaseKRW(h: HoldingSnapshot) { return isForeign(h.stock_code) ? h.purchase_amount * exchangeRate : h.purchase_amount }
  function pnlKRW(h: HoldingSnapshot) { return isForeign(h.stock_code) ? h.eval_pnl * exchangeRate : h.eval_pnl }

  function toggleAccount(name: string) {
    setSelectedAccounts(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }
  function selectAll() { setSelectedAccounts(new Set(accounts)) }
  function selectNone() { setSelectedAccounts(new Set()) }

  const COMBINED_ACCOUNT = '[합산] 메인+ISA'
  const MAIN_ACCOUNT = '[선근] 메인 (72480)'
  const ISA_ACCOUNT = '[선근] ISA (18160)'

  const filteredHoldings = useMemo(() => {
    return holdings.filter(h => selectedAccounts.has(h.account_name))
  }, [holdings, selectedAccounts])
  const filteredMonthly = useMemo(() => {
    const direct = monthlySummaries.filter(m => selectedAccounts.has(m.account_name))
    return direct.sort((a, b) => a.month.localeCompare(b.month))
  }, [monthlySummaries, selectedAccounts])
  const filteredTransfers = useMemo(() => {
    return transfers.filter(t => selectedAccounts.has(t.account_name))
  }, [transfers, selectedAccounts])

  // 월 형식 통일: "2025/12" 또는 "2025-12" → "2025/12"
  function normalizeMonth(m: string) { return m.replace(/-/g, '/') }
  // 진행 중인 달 판별.
  // 월별 요약(monthly_summaries)에는 아직 끝나지 않은 달도 CSV 임포트 시점 값으로 들어있어서,
  // 그 달의 end_asset 을 "월말 자산"으로 쓰면 과거 시점 값을 보게 된다.
  const currentMonthKey = `${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}`
  function isCurrentMonth(m: string) { return normalizeMonth(m) === currentMonthKey }
  // 월에서 연도/월 추출
  function splitMonth(m: string): [string, string] {
    const n = normalizeMonth(m)
    const sep = n.includes('/') ? '/' : '-'
    return n.split(sep) as [string, string]
  }

  const currentTotalAsset = useMemo(() => {
    let total = 0
    for (const h of filteredHoldings) total += toKRW(h)
    return total
  }, [filteredHoldings, exchangeRate])

  const holdingSummary = useMemo(() => {
    let totalPurchase = 0, totalEval = 0, totalPnl = 0
    for (const h of filteredHoldings) { totalPurchase += purchaseKRW(h); totalEval += toKRW(h); totalPnl += pnlKRW(h) }
    return { totalPurchase, totalEval, totalPnl, evalReturnRate: totalPurchase > 0 ? (totalPnl / totalPurchase) * 100 : 0, count: filteredHoldings.length }
  }, [filteredHoldings, exchangeRate])

  // 순입출금 계산 (기간 내) — 융자/환전 등 실제 자산 변동이 아닌 건 제외
  const excludePatterns = /융자|상환|외화매수원화|외화매도원화|외화예탁금세금|선환전|예탁금이용료|무상세금|무상단수주|종목합병단수주|예탁담보/
  function getNetTransfers(fromDate: string, toDate?: string): number {
    let net = 0
    for (const t of filteredTransfers) {
      const d = t.transfer_date.slice(0, 10)
      if (d < fromDate) continue
      if (toDate && d > toDate) continue
      if (excludePatterns.test(t.description)) continue
      net += t.transfer_type === 'DEPOSIT' ? t.amount : -t.amount
    }
    return net
  }

  // 월별 end_asset 합계 (형식 무관: "2025/12" 또는 "2025-12")
  function getMonthEndAsset(month: string): number {
    const norm = normalizeMonth(month)
    let total = 0
    for (const m of filteredMonthly) { if (normalizeMonth(m.month) === norm) total += m.end_asset }
    return total
  }
  function getMonthStartAsset(month: string): number {
    const norm = normalizeMonth(month)
    let total = 0
    for (const m of filteredMonthly) { if (normalizeMonth(m.month) === norm) total += m.start_asset }
    return total
  }

  // 기준이 되는 마지막 "완료된" 달. 진행 중인 달은 제외해야 전월 대비가 실제 전월 기준이 된다.
  const latestCompletedMonth = useMemo(() => {
    const completed = filteredMonthly.filter(m => !isCurrentMonth(m.month))
    return completed.length > 0 ? completed[completed.length - 1].month : null
  }, [filteredMonthly])

  // 전월 대비 수익률
  const prevMonthReturn = useMemo(() => {
    if (!latestCompletedMonth) return { profit: 0, rate: 0, baseAsset: 0 }
    const baseAsset = getMonthEndAsset(latestCompletedMonth)
    if (baseAsset <= 0) return { profit: 0, rate: 0, baseAsset: 0 }
    const [yStr, mStr] = splitMonth(latestCompletedMonth)
    const y = parseInt(yStr), m = parseInt(mStr)
    const nextMonth = m === 12 ? `${y + 1}/01` : `${y}/${String(m + 1).padStart(2, '0')}`
    const fromDate = `${nextMonth.replace('/', '-')}-01`
    const netTransfer = getNetTransfers(fromDate)
    const profit = currentTotalAsset - baseAsset - netTransfer
    return { profit, rate: baseAsset > 0 ? (profit / baseAsset) * 100 : 0, baseAsset }
  }, [latestCompletedMonth, filteredMonthly, filteredTransfers, currentTotalAsset])

  // 올해 수익률 — 작년 12월 end_asset 기준 (형식 무관)
  const ytdReturn = useMemo(() => {
    const thisYear = new Date().getFullYear()
    // "2025/12" 또는 "2025-12" 둘 다 시도
    let baseAsset = getMonthEndAsset(`${thisYear - 1}/12`)
    let fromDate = `${thisYear}-01-01`
    if (baseAsset <= 0) {
      // 올해 첫 월의 start_asset 사용
      const thisYearMonths = filteredMonthly
        .filter(m => normalizeMonth(m.month).startsWith(`${thisYear}/`))
        .sort((a, b) => a.month.localeCompare(b.month))
      if (thisYearMonths.length > 0) {
        baseAsset = getMonthStartAsset(thisYearMonths[0].month)
        const [y, m] = splitMonth(thisYearMonths[0].month)
        fromDate = `${y}-${m}-01`
      }
    }
    if (baseAsset <= 0) return { profit: 0, rate: 0, baseAsset: 0 }
    const netTransfer = getNetTransfers(fromDate)
    const profit = currentTotalAsset - baseAsset - netTransfer
    return { profit, rate: (profit / baseAsset) * 100, baseAsset }
  }, [filteredMonthly, filteredTransfers, currentTotalAsset])

  // ===== 월별 수익률 테이블 데이터 =====
  const monthlyReturnData = useMemo(() => {
    const months = [...new Set(filteredMonthly.map(m => normalizeMonth(m.month)))].sort()
    const rows: { month: string; startAsset: number; endAsset: number; netTransfer: number; profit: number; rate: number; cumRate: number }[] = []
    const yearCum: Record<string, number> = {}

    for (const month of months) {
      const startAsset = getMonthStartAsset(month)
      // 진행 중인 달은 현재 실제 자산 사용 (월말 확정값이 아직 없음)
      const endAsset = isCurrentMonth(month) && currentTotalAsset > 0
        ? currentTotalAsset
        : getMonthEndAsset(month)
      const [y, m] = splitMonth(month)
      const fromDate = `${y}-${m}-01`
      const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate()
      const toDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`
      const netTransfer = getNetTransfers(fromDate, toDate)
      const profit = endAsset - startAsset - netTransfer
      const rate = startAsset > 0 ? (profit / startAsset) * 100 : 0

      if (!yearCum[y]) yearCum[y] = 1
      yearCum[y] *= (1 + rate / 100)
      const cumRate = (yearCum[y] - 1) * 100

      rows.push({ month, startAsset, endAsset, netTransfer, profit, rate, cumRate })
    }
    return rows
  }, [filteredMonthly, filteredTransfers, currentTotalAsset])

  // 누적 수익률 — end_asset > 0인 가장 오래된 월 기준
  // 수익금 = 현재총자산 - 기준자산 - 순입출금
  // 수익률 = 수익금 / (기준자산 + 순입출금) × 100  (총 투입 원금 대비)
  const totalReturn = useMemo(() => {
    if (filteredMonthly.length === 0) return { profit: 0, rate: 0, baseAsset: 0 }
    const months = [...new Set(filteredMonthly.map(m => normalizeMonth(m.month)))].sort()
    let baseAsset = 0
    let baseMonth = ''
    for (const month of months) {
      const endA = getMonthEndAsset(month)
      const startA = getMonthStartAsset(month)
      if (endA > 0 || startA > 0) {
        baseAsset = startA > 0 ? startA : endA
        baseMonth = month
        break
      }
    }
    if (baseAsset <= 0 || !baseMonth) return { profit: 0, rate: 0, baseAsset: 0 }
    const [y, m] = splitMonth(baseMonth)
    const fromDate = `${y}-${m}-01`
    const netTransfer = getNetTransfers(fromDate)
    const profit = currentTotalAsset - baseAsset - netTransfer
    const totalInvested = baseAsset + netTransfer // 총 투입 원금
    const rate = totalInvested > 0 ? (profit / totalInvested) * 100 : 0
    return { profit, rate, baseAsset: totalInvested }
  }, [filteredMonthly, filteredTransfers, currentTotalAsset])

  // ===== 연도별 수익률 요약 =====
  const yearlyReturnData = useMemo(() => {
    const years = [...new Set(filteredMonthly.map(m => splitMonth(m.month)[0]))].sort()
    const rows: { year: string; startAsset: number; endAsset: number; netTransfer: number; profit: number; rate: number; investedCapital: number }[] = []

    // 이전 연도 endAsset 추적 (startAsset=0일 때 fallback)
    let prevYearEndAsset = 0

    for (const year of years) {
      const yearMonths = filteredMonthly
        .filter(m => splitMonth(m.month)[0] === year)
        .sort((a, b) => normalizeMonth(a.month).localeCompare(normalizeMonth(b.month)))
      if (yearMonths.length === 0) continue

      const firstMonth = yearMonths[0].month
      let startAsset = getMonthStartAsset(firstMonth)
      // startAsset=0이면 이전 연도 endAsset 사용
      if (startAsset <= 0 && prevYearEndAsset > 0) {
        startAsset = prevYearEndAsset
      }
      const lastMonth = yearMonths[yearMonths.length - 1].month
      // 진행 중인 연도는 월별 요약의 end_asset 이 CSV 임포트 당시 값(과거 시점)이므로
      // 현재 실제 자산을 사용한다. YTD 카드와 같은 기준이 되도록 맞춤
      const isCurrentYear = year === String(new Date().getFullYear())
      const endAsset = isCurrentYear && currentTotalAsset > 0
        ? currentTotalAsset
        : getMonthEndAsset(lastMonth)

      const fromDate = `${year}-01-01`
      const toDate = `${year}-12-31`
      const netTransfer = getNetTransfers(fromDate, toDate)

      const profit = endAsset - startAsset - netTransfer
      const rate = startAsset > 0 ? (profit / startAsset) * 100 : 0

      let totalDeposit = 0
      for (const t of filteredTransfers) {
        const d = t.transfer_date.slice(0, 4)
        if (d === year && t.transfer_type === 'DEPOSIT') totalDeposit += t.amount
      }

      rows.push({ year, startAsset, endAsset, netTransfer, profit, rate, investedCapital: totalDeposit })
      prevYearEndAsset = endAsset
    }
    return rows.reverse() // 최신 연도가 위로
  }, [filteredMonthly, filteredTransfers, currentTotalAsset])

  // 월별 수익률 차트 데이터 (최근 24개월)
  const monthlyChartData = useMemo(() => {
    return monthlyReturnData.slice(-24).map(r => ({
      month: r.month.slice(2), // "25/01" 형태
      rate: Math.round(r.rate * 100) / 100,
      cumRate: Math.round(r.cumRate * 100) / 100
    }))
  }, [monthlyReturnData])

  // 자산 추이 차트
  const assetChartData = useMemo(() => {
    const byMonth: Record<string, number> = {}
    for (const m of filteredMonthly) {
      if (!byMonth[m.month]) byMonth[m.month] = 0
      byMonth[m.month] += m.end_asset
    }
    // 진행 중인 달은 현재 실제 자산으로 대체
    for (const month of Object.keys(byMonth)) {
      if (isCurrentMonth(month) && currentTotalAsset > 0) byMonth[month] = currentTotalAsset
    }
    return Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([month, asset]) => ({ month, asset }))
  }, [filteredMonthly, currentTotalAsset])

  // 파이차트
  const pieData = useMemo(() =>
    filteredHoldings.filter(h => h.eval_amount > 0)
      .map(h => ({ name: h.stock_name, value: toKRW(h) }))
      .sort((a, b) => b.value - a.value),
    [filteredHoldings, exchangeRate])

  if (!loaded) {
    return <div className="empty-state"><div className="empty-state-icon">📊</div><div className="empty-state-text">데이터를 불러오는 중...</div></div>
  }

  return (
    <div>
      <div className="page-header">
        <div className="flex-between">
          <div>
            <h1 className="page-title">대시보드</h1>
            <p className="page-subtitle">포트폴리오 현황을 한눈에 확인하세요</p>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            💱 USD/KRW: {exchangeRate.toLocaleString(undefined, { maximumFractionDigits: 0 })}원
            <button className="btn btn-sm btn-outline" onClick={() => { setLoaded(false); retryCountRef.current = 0; loadData() }}
              style={{ marginLeft: 8, fontSize: 11 }}>🔄</button>
          </div>
        </div>
      </div>

      {/* 계좌 필터 */}
      <div className="card mb-16">
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
          계좌
          <span style={{ marginLeft: 8, cursor: 'pointer', color: 'var(--accent)' }} onClick={selectAll}>전체</span>
          <span style={{ marginLeft: 6, cursor: 'pointer', color: 'var(--accent)' }} onClick={selectNone}>해제</span>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {accounts.map(a => (
            <button key={a} className={`btn btn-sm ${selectedAccounts.has(a) ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => toggleAccount(a)} style={{ fontSize: 12 }}>{a}</button>
          ))}
        </div>
      </div>

      {selectedAccounts.size === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👆</div>
          <div className="empty-state-text">계좌를 선택해주세요</div>
        </div>
      ) : (
        <>
          {/* 수익률 카드 */}
          <div className="card-grid">
            <ReturnCard label="전월 대비" profit={prevMonthReturn.profit} rate={prevMonthReturn.rate} baseAsset={prevMonthReturn.baseAsset} />
            <ReturnCard label="올해 (YTD)" profit={ytdReturn.profit} rate={ytdReturn.rate} baseAsset={ytdReturn.baseAsset} />
            <ReturnCard label="누적" profit={totalReturn.profit} rate={totalReturn.rate} baseAsset={totalReturn.baseAsset} />
            <div className="card stat-card" style={{ textAlign: 'center' }}>
              <div className="stat-label">현재 총 평가자산</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{formatKRW(currentTotalAsset)}</div>
              <div style={{ fontSize: 12, color: holdingSummary.totalPnl >= 0 ? 'var(--danger)' : 'var(--accent)', marginTop: 4 }}>
                평가손익 {formatKRW(holdingSummary.totalPnl)} ({formatPercent(holdingSummary.evalReturnRate)})
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{holdingSummary.count}종목</div>
            </div>
          </div>

          {/* 연도별 수익률 */}
          {yearlyReturnData.length > 0 && (
            <div className="card mb-16">
              <h3 style={{ marginBottom: 12, fontSize: 15 }}>📅 연도별 수익률</h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>연도</th>
                      <th style={{ textAlign: 'right' }}>연초 자산</th>
                      <th style={{ textAlign: 'right' }}>연말 자산</th>
                      <th style={{ textAlign: 'right' }}>순입출금</th>
                      <th style={{ textAlign: 'right' }}>수익금</th>
                      <th style={{ textAlign: 'right' }}>수익률</th>
                      <th style={{ textAlign: 'right' }}>연간 입금</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearlyReturnData.map(r => (
                      <tr key={r.year}>
                        <td style={{ fontWeight: 600 }}>{r.year}년</td>
                        <td style={{ textAlign: 'right' }}>{formatKRW(r.startAsset)}</td>
                        <td style={{ textAlign: 'right' }}>{formatKRW(r.endAsset)}</td>
                        <td style={{ textAlign: 'right' }}>{formatKRW(r.netTransfer)}</td>
                        <td style={{ textAlign: 'right', color: r.profit >= 0 ? 'var(--danger)' : 'var(--accent)', fontWeight: 600 }}>
                          {formatKRW(r.profit)}
                        </td>
                        <td style={{ textAlign: 'right', color: r.rate >= 0 ? 'var(--danger)' : 'var(--accent)', fontWeight: 600 }}>
                          {formatPercent(r.rate)}
                        </td>
                        <td style={{ textAlign: 'right' }}>{formatKRW(r.investedCapital)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 월별 수익률 차트 */}
          {monthlyChartData.length > 0 && (
            <div className="card mb-16">
              <h3 style={{ marginBottom: 16, fontSize: 15 }}>📊 월별 수익률 추이</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={v => `${v}%`} />
                  <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                  <ReferenceLine y={0} stroke="#999" />
                  <Bar dataKey="rate" name="월간 수익률" fill="#4263eb"
                    label={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 월별 수익률 테이블 (접기/펼치기) */}
          {monthlyReturnData.length > 0 && (
            <div className="card mb-16">
              <h3 style={{ marginBottom: 0, fontSize: 15, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => setShowMonthlyDetail(!showMonthlyDetail)}>
                <span>📋 월별 수익률 상세</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>
                  {showMonthlyDetail ? '▲ 접기' : '▼ 펼치기'}
                </span>
              </h3>
              {showMonthlyDetail && (
                <div style={{ overflowX: 'auto', marginTop: 12 }}>
                  <table className="data-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>월</th>
                        <th style={{ textAlign: 'right' }}>월초 자산</th>
                        <th style={{ textAlign: 'right' }}>월말 자산</th>
                        <th style={{ textAlign: 'right' }}>입출금</th>
                        <th style={{ textAlign: 'right' }}>수익금</th>
                        <th style={{ textAlign: 'right' }}>월간 수익률</th>
                        <th style={{ textAlign: 'right' }}>연간 누적</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...monthlyReturnData].reverse().map((r, i, arr) => {
                        const [curYear, curMonth] = r.month.includes('/') ? r.month.split('/') : r.month.split('-')
                        const nextItem = i < arr.length - 1 ? arr[i + 1] : null
                        const prevYear = nextItem ? (nextItem.month.includes('/') ? nextItem.month.split('/')[0] : nextItem.month.split('-')[0]) : ''
                        const showYearHeader = curYear !== prevYear
                        return [
                          showYearHeader && (
                            <tr key={`year-${curYear}`} style={{ background: 'var(--bg-secondary)' }}>
                              <td colSpan={7} style={{ fontWeight: 700, fontSize: 13, padding: '8px 12px' }}>
                                {curYear}년
                              </td>
                            </tr>
                          ),
                          <tr key={r.month}>
                            <td style={{ fontWeight: 500 }}>{curMonth}월</td>
                            <td style={{ textAlign: 'right' }}>{formatKRW(r.startAsset)}</td>
                            <td style={{ textAlign: 'right' }}>{formatKRW(r.endAsset)}</td>
                            <td style={{ textAlign: 'right' }}>{r.netTransfer !== 0 ? formatKRW(r.netTransfer) : '-'}</td>
                            <td style={{ textAlign: 'right', color: r.profit >= 0 ? 'var(--danger)' : 'var(--accent)' }}>
                              {formatKRW(r.profit)}
                            </td>
                            <td style={{ textAlign: 'right', color: r.rate >= 0 ? 'var(--danger)' : 'var(--accent)', fontWeight: 600 }}>
                              {formatPercent(r.rate)}
                            </td>
                            <td style={{ textAlign: 'right', color: r.cumRate >= 0 ? 'var(--danger)' : 'var(--accent)', fontWeight: 600 }}>
                              {formatPercent(r.cumRate)}
                            </td>
                          </tr>
                        ]
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 차트 */}
          <div className="chart-row">
            <div className="card chart-container">
              <h3 style={{ marginBottom: 16, fontSize: 15 }}>월별 자산 추이</h3>
              {assetChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={assetChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={v => `${(v / 10000).toFixed(0)}만`} />
                    <Tooltip formatter={(v: number) => formatKRW(v)} />
                    <Line type="monotone" dataKey="asset" stroke="#4263eb" strokeWidth={2} name="자산총액" dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <div className="empty-state"><div className="empty-state-text">월별 자산 데이터 없음</div></div>}
            </div>
            <div className="card chart-container">
              <h3 style={{ marginBottom: 16, fontSize: 15 }}>종목별 비중</h3>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`} labelLine={false}>
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatKRW(v)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="empty-state"><div className="empty-state-text">보유 종목 없음</div></div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ReturnCard({ label, profit, rate, baseAsset }: { label: string; profit: number; rate: number; baseAsset: number }) {
  const hasData = baseAsset > 0
  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>
      {hasData ? (
        <>
          <div className={`stat-value ${profit >= 0 ? 'positive' : 'negative'}`}>{formatKRW(profit)}</div>
          <div style={{ fontSize: 13, color: rate >= 0 ? 'var(--danger)' : 'var(--accent)', marginTop: 2 }}>{formatPercent(rate)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>기준자산 {formatKRW(baseAsset)}</div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>데이터 없음</div>
      )}
    </div>
  )
}
