import { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { Dividend, Trade } from '../types'

export default function DividendHistory() {
  const [dividends, setDividends] = useState<Dividend[]>([])
  const [accounts, setAccounts] = useState<string[]>([])
  const [filterAccount, setFilterAccount] = useState('')
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'year' | 'lastYear' | 'month' | 'custom'>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [status, setStatus] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Partial<Dividend>>({})
  // 종목코드 → 종목명 매핑 (trades에서 가져옴)
  const [codeNameMap, setCodeNameMap] = useState<Record<string, string>>({})

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [accts, all, trades] = await Promise.all([
      window.api.accounts.getAll(),
      window.api.dividends.getAll(),
      window.api.trades.getAll({})
    ])
    setAccounts(accts)
    setDividends(all)
    // trades에서 종목코드 → 종목명 매핑 구축
    const map: Record<string, string> = {}
    for (const t of trades as Trade[]) {
      if (t.stock_code && t.stock_name) {
        const code = t.stock_code.replace(/^A/, '')
        if (!map[code]) map[code] = t.stock_name
      }
    }
    setCodeNameMap(map)
  }

  // 종목명 해석: stock_name이 숫자만이면 codeNameMap에서 찾기
  function resolveName(d: Dividend): string {
    const name = d.stock_name || ''
    // 이미 정상 종목명이면 그대로
    if (name && !/^\d+$/.test(name)) return name
    // 숫자만이면 종목코드로 간주하고 매핑
    const code = (d.stock_code || name).replace(/^A/, '')
    return codeNameMap[code] || name || code || '배당금'
  }

  // 기간 필터 적용
  function applyPeriod(period: 'all' | 'year' | 'lastYear' | 'month' | 'custom') {
    setFilterPeriod(period)
    const now = new Date()
    if (period === 'year') {
      setStartDate(`${now.getFullYear()}-01-01`)
      setEndDate('')
    } else if (period === 'lastYear') {
      setStartDate(`${now.getFullYear() - 1}-01-01`)
      setEndDate(`${now.getFullYear() - 1}-12-31`)
    } else if (period === 'month') {
      setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
      setEndDate('')
    } else if (period === 'all') {
      setStartDate('')
      setEndDate('')
    }
  }

  const filtered = useMemo(() => {
    let result = [...dividends]
    if (filterAccount) result = result.filter(d => d.account_name === filterAccount)
    if (startDate) result = result.filter(d => d.dividend_date >= startDate)
    if (endDate) result = result.filter(d => d.dividend_date <= endDate + 'Z')
    return result.sort((a, b) => b.dividend_date.localeCompare(a.dividend_date))
  }, [dividends, filterAccount, startDate, endDate])

  const stockSummary = useMemo(() => {
    const map = new Map<string, { name: string, count: number, totalGross: number, totalTax: number, totalNet: number }>()
    for (const d of filtered) {
      const name = resolveName(d)
      const prev = map.get(name) || { name, count: 0, totalGross: 0, totalTax: 0, totalNet: 0 }
      prev.count++
      prev.totalGross += d.amount
      prev.totalTax += d.tax
      prev.totalNet += d.net_amount
      map.set(name, prev)
    }
    return [...map.values()].sort((a, b) => b.totalNet - a.totalNet)
  }, [filtered, codeNameMap])

  const summary = useMemo(() => {
    let totalGross = 0, totalTax = 0, totalNet = 0
    for (const d of filtered) {
      totalGross += d.amount
      totalTax += d.tax
      totalNet += d.net_amount
    }
    return { totalGross, totalTax, totalNet, count: filtered.length }
  }, [filtered])

  async function handleDelete(id: number) {
    if (!confirm('이 배당 내역을 삭제하시겠습니까?')) return
    await window.api.dividends.deleteOne(id)
    setStatus('삭제 완료')
    await loadData()
  }

  function startEdit(d: Dividend) {
    setEditId(d.id)
    setEditForm({
      stock_code: d.stock_code, stock_name: d.stock_name,
      amount: d.amount, tax: d.tax, net_amount: d.net_amount,
      dividend_date: d.dividend_date.slice(0, 10)
    })
  }

  async function saveEdit() {
    if (editId === null) return
    await window.api.dividends.update(editId, editForm)
    setEditId(null); setEditForm({})
    setStatus('수정 완료')
    await loadData()
  }

  // 종목명이 숫자인 배당금을 일괄 수정
  async function fixStockNames() {
    let fixed = 0
    for (const d of dividends) {
      if (/^\d+$/.test(d.stock_name || '')) {
        const code = (d.stock_code || d.stock_name).replace(/^A/, '')
        const name = codeNameMap[code]
        if (name) {
          await window.api.dividends.update(d.id, { stock_name: name })
          fixed++
        }
      }
    }
    if (fixed > 0) {
      setStatus(`${fixed}건 종목명 자동 수정 완료`)
      await loadData()
    } else {
      setStatus('수정할 종목명이 없습니다')
    }
  }

  const hasNumericNames = dividends.some(d => /^\d+$/.test(d.stock_name || ''))

  // 3년간 배당금 추이 (월별)
  const dividendTrend = useMemo(() => {
    const now = new Date()
    const threeYearsAgo = `${now.getFullYear() - 3}-01-01`
    let target = dividends
    if (filterAccount) target = target.filter(d => d.account_name === filterAccount)
    target = target.filter(d => d.dividend_date >= threeYearsAgo)

    const monthly: Record<string, { month: string; gross: number; net: number }> = {}
    for (const d of target) {
      const m = d.dividend_date.slice(0, 7)
      if (!monthly[m]) monthly[m] = { month: m, gross: 0, net: 0 }
      monthly[m].gross += d.amount
      monthly[m].net += d.net_amount
    }
    return Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month))
  }, [dividends, filterAccount])

  // 연도별 배당금 요약
  const yearlyDividend = useMemo(() => {
    const now = new Date()
    const threeYearsAgo = now.getFullYear() - 3
    let target = dividends
    if (filterAccount) target = target.filter(d => d.account_name === filterAccount)

    const yearly: Record<string, { year: string; gross: number; tax: number; net: number; count: number }> = {}
    for (const d of target) {
      const y = d.dividend_date.slice(0, 4)
      if (parseInt(y) < threeYearsAgo) continue
      if (!yearly[y]) yearly[y] = { year: y, gross: 0, tax: 0, net: 0, count: 0 }
      yearly[y].gross += d.amount
      yearly[y].tax += d.tax
      yearly[y].net += d.net_amount
      yearly[y].count++
    }
    return Object.values(yearly).sort((a, b) => a.year.localeCompare(b.year))
  }, [dividends, filterAccount])

  return (
    <div>
      <div className="page-header">
        <div className="flex-between">
          <div>
            <h1 className="page-title">배당금 내역</h1>
            <p className="page-subtitle">계좌별 배당금 수령 내역을 조회하고 관리합니다</p>
          </div>
          {hasNumericNames && (
            <button className="btn btn-outline" onClick={fixStockNames}>
              🔧 종목명 자동 수정
            </button>
          )}
        </div>
      </div>

      {status && (
        <div style={{
          padding: '10px 16px', marginBottom: 16, borderRadius: 6,
          background: status.includes('실패') ? 'rgba(224,49,49,0.1)' : 'rgba(43,138,62,0.1)',
          color: status.includes('실패') ? 'var(--danger)' : 'var(--success)', fontSize: 14
        }}>{status}</div>
      )}

      {/* 필터 */}
      <div className="card mb-16">
        <div className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="form-group">
            <label className="form-label">계좌</label>
            <select className="form-select" value={filterAccount} onChange={e => setFilterAccount(e.target.value)}>
              <option value="">전체</option>
              {accounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">기간</label>
            <div className="btn-group">
              <button className={`btn btn-sm ${filterPeriod === 'month' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => applyPeriod('month')}>이번 달</button>
              <button className={`btn btn-sm ${filterPeriod === 'year' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => applyPeriod('year')}>올해</button>
              <button className={`btn btn-sm ${filterPeriod === 'lastYear' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => applyPeriod('lastYear')}>작년</button>
              <button className={`btn btn-sm ${filterPeriod === 'all' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => applyPeriod('all')}>전체</button>
              <button className={`btn btn-sm ${filterPeriod === 'custom' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setFilterPeriod('custom')}>직접 선택</button>
            </div>
          </div>
          {filterPeriod === 'custom' && (
            <>
              <div className="form-group">
                <label className="form-label">시작일</label>
                <input type="date" className="form-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">종료일</label>
                <input type="date" className="form-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>세전 배당금 ({summary.count}건)</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{summary.totalGross.toLocaleString()}원</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>세금</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--danger)' }}>-{summary.totalTax.toLocaleString()}원</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>실수령 배당금</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--success)' }}>{summary.totalNet.toLocaleString()}원</div>
        </div>
      </div>

      {/* 연도별 배당금 요약 */}
      {yearlyDividend.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(yearlyDividend.length, 4)}, 1fr)`, gap: 12, marginBottom: 16 }}>
          {yearlyDividend.map(y => (
            <div className="card" key={y.year} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>{y.year}년 ({y.count}건)</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--success)' }}>{y.net.toLocaleString()}원</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>세전 {y.gross.toLocaleString()} · 세금 {y.tax.toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* 3년간 배당금 추이 차트 */}
      {dividendTrend.length > 1 && (
        <div className="card mb-16">
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>배당금 추이 (최근 3년)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dividendTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={11} tickFormatter={v => `${(v / 10000).toFixed(0)}만`} />
              <Tooltip formatter={(v: number) => `${v.toLocaleString()}원`} />
              <Bar dataKey="net" fill="#2b8a3e" name="실수령" />
              <Bar dataKey="gross" fill="#a5d8ff" name="세전" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 종목별 배당 요약 */}
      {stockSummary.length > 0 && (
        <div className="card mb-16">
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>종목별 배당 요약</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>종목</th>
                  <th className="text-center">횟수</th>
                  <th className="text-right">세전 합계</th>
                  <th className="text-right">세금 합계</th>
                  <th className="text-right">실수령 합계</th>
                </tr>
              </thead>
              <tbody>
                {stockSummary.map(s => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td className="text-center">{s.count}회</td>
                    <td className="text-right">{s.totalGross.toLocaleString()}</td>
                    <td className="text-right">{s.totalTax.toLocaleString()}</td>
                    <td className="text-right" style={{ fontWeight: 600, color: 'var(--success)' }}>{s.totalNet.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 메인 테이블 */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">💰</div>
          <div className="empty-state-text">배당금 내역이 없습니다</div>
        </div>
      ) : (
        <div className="card">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            총 {filtered.length}건
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>일자</th>
                  <th>계좌</th>
                  <th>종목코드</th>
                  <th>종목명</th>
                  <th className="text-right">세전</th>
                  <th className="text-right">세금</th>
                  <th className="text-right">실수령</th>
                  <th className="text-center">출처</th>
                  <th className="text-center">관리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(d => (
                  <tr key={d.id}>
                    {editId === d.id ? (
                      <>
                        <td>
                          <input type="date" className="form-input" style={{ width: 130 }}
                            value={editForm.dividend_date || ''} onChange={e => setEditForm({ ...editForm, dividend_date: e.target.value })} />
                        </td>
                        <td>{d.account_name}</td>
                        <td>
                          <input className="form-input" style={{ width: 80 }}
                            value={editForm.stock_code || ''} onChange={e => setEditForm({ ...editForm, stock_code: e.target.value })} />
                        </td>
                        <td>
                          <input className="form-input" style={{ width: 120 }}
                            value={editForm.stock_name || ''} onChange={e => setEditForm({ ...editForm, stock_name: e.target.value })} />
                        </td>
                        <td className="text-right">
                          <input type="number" className="form-input" style={{ width: 100, textAlign: 'right' }}
                            value={editForm.amount || ''} onChange={e => setEditForm({ ...editForm, amount: parseInt(e.target.value) || 0 })} />
                        </td>
                        <td className="text-right">
                          <input type="number" className="form-input" style={{ width: 80, textAlign: 'right' }}
                            value={editForm.tax ?? ''} onChange={e => setEditForm({ ...editForm, tax: parseInt(e.target.value) || 0 })} />
                        </td>
                        <td className="text-right">
                          <input type="number" className="form-input" style={{ width: 100, textAlign: 'right' }}
                            value={editForm.net_amount || ''} onChange={e => setEditForm({ ...editForm, net_amount: parseInt(e.target.value) || 0 })} />
                        </td>
                        <td></td>
                        <td className="text-center">
                          <div className="btn-group" style={{ justifyContent: 'center' }}>
                            <button className="btn btn-success btn-sm" onClick={saveEdit}>저장</button>
                            <button className="btn btn-outline btn-sm" onClick={() => setEditId(null)}>취소</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{d.dividend_date.slice(0, 10)}</td>
                        <td>{d.account_name}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.stock_code}</td>
                        <td>{resolveName(d)}</td>
                        <td className="text-right">{d.amount.toLocaleString()}</td>
                        <td className="text-right" style={{ color: 'var(--danger)' }}>{d.tax > 0 ? `-${d.tax.toLocaleString()}` : '0'}</td>
                        <td className="text-right" style={{ fontWeight: 600, color: 'var(--success)' }}>{d.net_amount.toLocaleString()}원</td>
                        <td className="text-center" style={{ fontSize: 12 }}>{d.source === 'kakao' ? '📱' : d.source === 'csv' ? '📄' : '✏️'}</td>
                        <td className="text-center">
                          <div className="btn-group" style={{ justifyContent: 'center' }}>
                            <button className="btn btn-outline btn-sm" onClick={() => startEdit(d)}>수정</button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(d.id)}>삭제</button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
