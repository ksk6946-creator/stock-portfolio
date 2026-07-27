import { useState, useEffect } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { Trade, PortfolioSummary } from '../types'
import { formatKRW, formatPercent } from '../services/parser'

type Period = 'daily' | 'monthly' | 'yearly'

export default function Analysis() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [summary, setSummary] = useState<PortfolioSummary | null>(null)
  const [period, setPeriod] = useState<Period>('monthly')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const [t, s] = await Promise.all([
      window.api.trades.getAll(),
      window.api.portfolio.summary()
    ])
    setTrades(t)
    setSummary(s)
  }

  function getPeriodData(): { label: string; pnl: number; invested: number; returnRate: number }[] {
    const sorted = [...trades].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    const buckets: Record<string, { invested: number; pnl: number }> = {}
    const holdings: Record<string, { qty: number; avgPrice: number }> = {}

    for (const t of sorted) {
      let label: string
      switch (period) {
        case 'daily': label = t.trade_date.slice(0, 10); break
        case 'monthly': label = t.trade_date.slice(0, 7); break
        case 'yearly': label = t.trade_date.slice(0, 4); break
      }

      if (!buckets[label]) buckets[label] = { invested: 0, pnl: 0 }
      if (!holdings[t.stock_name]) holdings[t.stock_name] = { qty: 0, avgPrice: 0 }

      const h = holdings[t.stock_name]
      if (t.trade_type === 'BUY') {
        const totalCost = h.qty * h.avgPrice + t.quantity * t.price
        h.qty += t.quantity
        h.avgPrice = h.qty > 0 ? totalCost / h.qty : 0
        buckets[label].invested += t.total_amount
      } else {
        const pnl = (t.price - h.avgPrice) * t.quantity - (t.fee || 0) - (t.tax || 0)
        buckets[label].pnl += pnl
        h.qty -= t.quantity
      }
    }

    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, data]) => ({
        label,
        pnl: Math.round(data.pnl),
        invested: Math.round(data.invested),
        returnRate: data.invested > 0 ? (data.pnl / data.invested) * 100 : 0
      }))
  }

  function getStockPnl(): { name: string; pnl: number; returnRate: number }[] {
    const holdings: Record<string, { qty: number; avgPrice: number; totalInvested: number; realizedPnl: number }> = {}

    const sorted = [...trades].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    for (const t of sorted) {
      if (!holdings[t.stock_name]) holdings[t.stock_name] = { qty: 0, avgPrice: 0, totalInvested: 0, realizedPnl: 0 }
      const h = holdings[t.stock_name]

      if (t.trade_type === 'BUY') {
        const totalCost = h.qty * h.avgPrice + t.quantity * t.price
        h.qty += t.quantity
        h.avgPrice = h.qty > 0 ? totalCost / h.qty : 0
        h.totalInvested += t.total_amount
      } else {
        h.realizedPnl += (t.price - h.avgPrice) * t.quantity - (t.fee || 0) - (t.tax || 0)
        h.qty -= t.quantity
      }
    }

    return Object.entries(holdings)
      .map(([name, h]) => ({
        name,
        pnl: Math.round(h.realizedPnl),
        returnRate: h.totalInvested > 0 ? (h.realizedPnl / h.totalInvested) * 100 : 0
      }))
      .sort((a, b) => b.pnl - a.pnl)
  }

  const periodData = getPeriodData()
  const stockPnl = getStockPnl()

  if (trades.length === 0) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">수익률 분석</h1>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">📈</div>
          <div className="empty-state-text">분석할 매매 내역이 없습니다</div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">수익률 분석</h1>
        <p className="page-subtitle">기간별, 종목별 수익률을 분석합니다</p>
      </div>

      {/* 요약 */}
      {summary && (
        <div className="card-grid">
          <div className="card stat-card">
            <div className="stat-label">총 투자금</div>
            <div className="stat-value">{formatKRW(summary.totalInvested)}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">실현 손익</div>
            <div className={`stat-value ${summary.totalRealizedPnl >= 0 ? 'positive' : 'negative'}`}>
              {formatKRW(summary.totalRealizedPnl)}
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">전체 수익률</div>
            <div className={`stat-value ${summary.returnRate >= 0 ? 'positive' : 'negative'}`}>
              {formatPercent(summary.returnRate)}
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">총 수수료 + 세금</div>
            <div className="stat-value">{formatKRW(summary.totalFees + summary.totalTax)}</div>
          </div>
        </div>
      )}

      {/* 기간 선택 */}
      <div className="card mb-16">
        <div className="flex-between">
          <h3 style={{ fontSize: 15 }}>기간별 수익률 추이</h3>
          <div className="btn-group">
            {(['daily', 'monthly', 'yearly'] as Period[]).map(p => (
              <button key={p} className={`btn btn-sm ${period === p ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setPeriod(p)}>
                {p === 'daily' ? '일별' : p === 'monthly' ? '월별' : '연도별'}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-16">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={periodData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={v => `${(v / 10000).toFixed(0)}만`} />
              <Tooltip formatter={(v: number) => formatKRW(v)} />
              <Legend />
              <Line type="monotone" dataKey="pnl" stroke="#4263eb" strokeWidth={2} name="실현손익" />
              <Line type="monotone" dataKey="invested" stroke="#adb5bd" strokeWidth={1} name="투자금" strokeDasharray="5 5" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 종목별 수익률 */}
      <div className="card mb-16">
        <h3 style={{ fontSize: 15, marginBottom: 16 }}>종목별 실현 손익</h3>
        <ResponsiveContainer width="100%" height={Math.max(200, stockPnl.length * 40)}>
          <BarChart data={stockPnl} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" fontSize={12} tickFormatter={v => `${(v / 10000).toFixed(0)}만`} />
            <YAxis type="category" dataKey="name" fontSize={12} width={80} />
            <Tooltip formatter={(v: number) => formatKRW(v)} />
            <Bar dataKey="pnl" name="실현손익" fill="#4263eb" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 상세 테이블 */}
      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 16 }}>종목별 상세 통계</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>종목</th>
                <th className="text-right">실현 손익</th>
                <th className="text-right">수익률</th>
              </tr>
            </thead>
            <tbody>
              {stockPnl.map(s => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td className="text-right" style={{ color: s.pnl >= 0 ? 'var(--danger)' : 'var(--accent)' }}>
                    {formatKRW(s.pnl)}
                  </td>
                  <td className="text-right" style={{ color: s.returnRate >= 0 ? 'var(--danger)' : 'var(--accent)' }}>
                    {formatPercent(s.returnRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
