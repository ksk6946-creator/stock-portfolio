import { useState, useEffect, useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import type { HoldingSnapshot, HoldingInput, HoldingsSummary, Trade } from '../types'
import { formatKRW, formatPercent } from '../services/parser'

const COLORS = ['#4263eb', '#e03131', '#2b8a3e', '#f08c00', '#7048e8', '#0ca678', '#e8590c', '#1098ad', '#d6336c', '#495057']

export default function AccountHoldings() {
  const [accounts, setAccounts] = useState<string[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string>('all')
  const [holdings, setHoldings] = useState<HoldingSnapshot[]>([])
  const [summary, setSummary] = useState<HoldingsSummary | null>(null)
  const [status, setStatus] = useState('')

  // 잔고 입력
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importAccount, setImportAccount] = useState('')

  // 계좌 추가
  const [newAccountName, setNewAccountName] = useState('')

  // 환율
  const [exchangeRate, setExchangeRate] = useState<number>(1450)

  // 시세 업데이트 상태
  const [priceUpdating, setPriceUpdating] = useState(false)

  // 종목 상세 모달
  const [detailHolding, setDetailHolding] = useState<HoldingSnapshot | null>(null)

  // 종목 테이블 정렬
  const [sortKey, setSortKey] = useState<string>('eval_amount')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function handleSort(key: string) {
    if (sortKey === key) setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'stock_name' ? 'asc' : 'desc') }
  }

  const sortedHoldings = useMemo(() => {
    return [...holdings].sort((a, b) => {
      let va: any, vb: any
      switch (sortKey) {
        case 'stock_name': va = a.stock_name; vb = b.stock_name; break
        case 'quantity': va = a.quantity; vb = b.quantity; break
        case 'avg_price': va = a.avg_price; vb = b.avg_price; break
        case 'current_price': va = a.current_price; vb = b.current_price; break
        case 'purchase_amount': va = a.purchase_amount; vb = b.purchase_amount; break
        case 'eval_amount': va = a.eval_amount; vb = b.eval_amount; break
        case 'eval_pnl': va = a.eval_pnl; vb = b.eval_pnl; break
        case 'return_rate': va = a.return_rate; vb = b.return_rate; break
        default: va = a.eval_amount; vb = b.eval_amount
      }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [holdings, sortKey, sortDir])
  const [detailTrades, setDetailTrades] = useState<Trade[]>([])

  useEffect(() => { loadData() }, [])
  useEffect(() => { loadHoldings() }, [selectedAccount])

  async function loadData() {
    try {
      const [accts, sum, rate] = await Promise.all([
        window.api.accounts.getAll(),
        window.api.holdings.summary(),
        window.api.exchange.getRate()
      ])
      setAccounts(accts)
      setSummary(sum)
      setExchangeRate(rate)
    } catch (err) {
      console.error('Failed to load data:', err)
      setAccounts([])
    }
  }

  async function loadHoldings() {
    try {
      const data = selectedAccount === 'all'
        ? await window.api.holdings.get()
        : await window.api.holdings.get(selectedAccount)
      setHoldings(data)
    } catch (err) {
      console.error('Failed to load holdings:', err)
      setHoldings([])
    }
  }

  async function handleAddAccount() {
    if (!newAccountName.trim()) return
    const name = newAccountName.trim()
    try {
      await window.api.accounts.add(name)
      setNewAccountName('')
      await loadData()
      setStatus(`계좌 "${name}" 추가됨`)
    } catch (err) {
      console.error('Failed to add account:', err)
      setStatus('계좌 추가 실패: ' + String(err))
    }
  }

  async function handleRemoveAccount(name: string) {
    if (!confirm(`"${name}" 계좌와 해당 잔고를 모두 삭제하시겠습니까?`)) return
    await window.api.accounts.remove(name)
    if (selectedAccount === name) setSelectedAccount('all')
    await loadData()
    await loadHoldings()
    setStatus(`계좌 "${name}" 삭제됨`)
  }

  function parseTableText(text: string): HoldingInput[] {
    const lines = text.trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) return []

    const results: HoldingInput[] = []
    // 첫 줄이 헤더인지 확인
    const firstLine = lines[0]
    const startIdx = /유형|종목/.test(firstLine) ? 1 : 0

    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split('\t').map(c => c.trim())
      if (cols.length < 6) continue

      try {
        // 미래에셋 형식: 유형, 종목번호, 종목명, 구분, 보유량, 평균단가, 현재가, 매입금액, 평가금액, 평가손익, 수익률
        let stockCode = '', stockName = '', category = ''
        let quantity = 0, avgPrice = 0, currentPrice = 0
        let purchaseAmount = 0, evalAmount = 0, evalPnl = 0, returnRate = 0

        if (cols.length >= 11 && /주식|ETF|펀드|해외|ELS|채권/.test(cols[0])) {
          // 유형 포함 형식
          stockCode = cols[1]
          stockName = cols[2]
          category = cols[3]
          quantity = parseNum(cols[4])
          avgPrice = parseNum(cols[5])
          currentPrice = parseNum(cols[6])
          purchaseAmount = parseNum(cols[7])
          evalAmount = parseNum(cols[8])
          evalPnl = parseNum(cols[9])
          returnRate = parseFloat(cols[10].replace(/[^0-9.\-]/g, '')) || 0
        } else if (cols.length >= 8) {
          // 유형 없는 형식
          stockCode = cols[0]
          stockName = cols[1]
          category = cols[2] || '현금'
          quantity = parseNum(cols[3])
          avgPrice = parseNum(cols[4])
          currentPrice = parseNum(cols[5])
          purchaseAmount = parseNum(cols[6])
          evalAmount = parseNum(cols[7])
          evalPnl = cols[8] ? parseNum(cols[8]) : evalAmount - purchaseAmount
          returnRate = cols[9] ? parseFloat(cols[9].replace(/[^0-9.\-]/g, '')) || 0
            : (purchaseAmount > 0 ? (evalPnl / purchaseAmount) * 100 : 0)
        }

        if (stockName && quantity > 0) {
          results.push({
            stock_code: stockCode,
            stock_name: stockName,
            category,
            quantity,
            avg_price: avgPrice,
            current_price: currentPrice,
            purchase_amount: purchaseAmount || quantity * avgPrice,
            eval_amount: evalAmount || quantity * currentPrice,
            eval_pnl: evalPnl,
            return_rate: returnRate
          })
        }
      } catch { /* skip */ }
    }
    return results
  }

  function parseNum(s: string): number {
    return parseFloat(s.replace(/[^0-9.\-]/g, '')) || 0
  }

  async function handleImport() {
    if (!importAccount.trim() || !importText.trim()) {
      setStatus('계좌명과 데이터를 입력해주세요.')
      return
    }
    const items = parseTableText(importText)
    if (items.length === 0) {
      setStatus('파싱된 종목이 없습니다. 데이터 형식을 확인해주세요.')
      return
    }
    const count = await window.api.holdings.set(importAccount.trim(), items)
    setStatus(`${importAccount.trim()} 계좌에 ${count}개 종목 등록 완료!`)
    setShowImport(false)
    setImportText('')
    await loadData()
    await loadHoldings()
  }

  async function handleDeleteHolding(id: number) {
    await window.api.holdings.delete(id)
    await loadHoldings()
    await loadData()
  }

  // 시세 업데이트 (기존 잔고의 현재가만 갱신)
  async function handleUpdatePrices() {
    setPriceUpdating(true)
    setStatus('📈 시세 조회 중...')
    try {
      const result = await window.api.holdings.updatePrices()
      const msg = `시세 업데이트 완료: ${result.updated}/${result.total}종목 성공`
      const failMsg = result.failed.length > 0 ? ` (실패: ${result.failed.join(', ')})` : ''
      setStatus(msg + failMsg)
      await loadData()
      await loadHoldings()
    } catch (err) {
      setStatus('시세 업데이트 실패: ' + String(err))
    } finally {
      setPriceUpdating(false)
    }
  }

  // 해외주식 여부 판별 (종목코드가 A로 시작하지 않고 영문으로만 구성)
  function isForeign(stockCode: string): boolean {
    return /^[A-Z]{1,5}(\.[A-Z])?$/.test(stockCode)
  }

  // 종목 상세 모달 열기
  async function openStockDetail(h: HoldingSnapshot) {
    setDetailHolding(h)
    // 해당 계좌+종목의 전체 매매내역 로드
    const allTrades = await window.api.trades.getAll({ account: h.account_name, stockName: h.stock_name })
    setDetailTrades(allTrades.sort((a, b) => b.trade_date.localeCompare(a.trade_date)))
  }

  // 종목 상세: 매매 손익 계산 (평균단가 기반)
  const detailSummary = useMemo(() => {
    if (!detailHolding || detailTrades.length === 0) return null

    const sorted = [...detailTrades].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    let qty = 0, totalCost = 0, avgPrice = 0
    let totalSellQty = 0, totalSellAmount = 0, totalSellCostBasis = 0
    let totalBuyQty = 0, totalBuyAmount = 0
    let totalFee = 0, totalTax = 0

    for (const t of sorted) {
      if (t.trade_type === 'BUY') {
        totalCost = qty * avgPrice + t.quantity * t.price
        qty += t.quantity
        avgPrice = qty > 0 ? totalCost / qty : 0
        totalBuyQty += t.quantity
        totalBuyAmount += t.quantity * t.price
      } else {
        const costBasis = avgPrice * t.quantity
        totalSellQty += t.quantity
        totalSellAmount += t.quantity * t.price
        totalSellCostBasis += costBasis
        totalCost -= costBasis
        qty = Math.max(0, qty - t.quantity)
        if (qty <= 0) { qty = 0; totalCost = 0; avgPrice = 0 }
      }
      totalFee += t.fee || 0
      totalTax += t.tax || 0
    }

    const tradePnl = totalSellAmount - totalSellCostBasis - totalFee - totalTax
    const avgSellPrice = totalSellQty > 0 ? totalSellAmount / totalSellQty : 0
    const h = detailHolding
    const evalPnl = h.eval_pnl
    const totalPnl = evalPnl + tradePnl
    const totalPnlRate = (h.purchase_amount + totalSellCostBasis) > 0
      ? (totalPnl / (h.purchase_amount + totalSellCostBasis)) * 100 : 0

    return {
      // 보유 손익
      holdQty: h.quantity, avgBuyPrice: h.avg_price,
      purchaseAmount: h.purchase_amount, evalAmount: h.eval_amount,
      evalPnl, evalReturnRate: h.return_rate,
      // 매매 손익
      sellQty: totalSellQty, avgSellPrice,
      sellAmount: totalSellAmount, sellCostBasis: totalSellCostBasis,
      tradePnl,
      // 총 손익
      totalPnl, totalPnlRate,
      // 매매 통계
      totalBuyQty, totalBuyAmount, totalFee, totalTax,
      tradeCount: detailTrades.length
    }
  }, [detailHolding, detailTrades])

  // 원화 환산 금액
  function toKRW(h: HoldingSnapshot): number {
    return isForeign(h.stock_code) ? Math.round(h.eval_amount * exchangeRate) : h.eval_amount
  }

  function purchaseToKRW(h: HoldingSnapshot): number {
    return isForeign(h.stock_code) ? Math.round(h.purchase_amount * exchangeRate) : h.purchase_amount
  }

  function pnlToKRW(h: HoldingSnapshot): number {
    return isForeign(h.stock_code) ? Math.round(h.eval_pnl * exchangeRate) : h.eval_pnl
  }

  // 현재 보이는 잔고의 합계 (원화 환산)
  const totalPurchase = holdings.reduce((s, h) => s + purchaseToKRW(h), 0)
  const totalEval = holdings.reduce((s, h) => s + toKRW(h), 0)
  const totalPnl = holdings.reduce((s, h) => s + pnlToKRW(h), 0)
  const totalReturn = totalPurchase > 0 ? (totalPnl / totalPurchase) * 100 : 0

  const pieData = holdings.filter(h => h.eval_amount > 0)
    .map(h => ({ name: h.stock_name, value: toKRW(h) }))
    .sort((a, b) => b.value - a.value)

  return (
    <div>
      <div className="page-header">
        <div className="flex-between">
          <div>
            <h1 className="page-title">계좌 잔고</h1>
            <p className="page-subtitle">계좌별 보유 종목 현황을 관리합니다</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline" onClick={handleUpdatePrices} disabled={priceUpdating || holdings.length === 0}>
              {priceUpdating ? '⏳ 조회 중...' : '📈 시세 업데이트'}
            </button>
            <button className="btn btn-primary" onClick={() => setShowImport(true)}>📋 잔고 붙여넣기</button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
          💱 USD/KRW: {exchangeRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}원
        </div>
      </div>

      {status && (
        <div style={{
          padding: '10px 16px', marginBottom: 16, borderRadius: 6,
          background: status.includes('실패') || status.includes('없습니다') ? 'rgba(224,49,49,0.1)' : 'rgba(43,138,62,0.1)',
          color: status.includes('실패') || status.includes('없습니다') ? 'var(--danger)' : 'var(--success)', fontSize: 14
        }}>{status}</div>
      )}

      {/* 계좌 추가 */}
      <div className="card mb-16">
        <div className="flex-between">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="form-input" value={newAccountName} onChange={e => setNewAccountName(e.target.value)}
              placeholder="새 계좌명 (예: 미래에셋 ISA)" style={{ width: 250 }}
              onKeyDown={e => e.key === 'Enter' && handleAddAccount()} />
            <button className="btn btn-primary btn-sm" onClick={handleAddAccount}>+ 계좌 추가</button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            등록된 계좌: {accounts.length}개
          </div>
        </div>
      </div>

      {/* 전체 요약 카드 */}
      {summary && summary.accounts.length > 0 && (
        <div className="card-grid">
          <div className="card stat-card">
            <div className="stat-label">총 매입금액</div>
            <div className="stat-value">{formatKRW(summary.grandTotalPurchase)}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">총 평가금액</div>
            <div className="stat-value">{formatKRW(summary.grandTotalEval)}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">총 평가손익</div>
            <div className={`stat-value ${summary.grandTotalPnl >= 0 ? 'positive' : 'negative'}`}>
              {formatKRW(summary.grandTotalPnl)}
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">총 수익률</div>
            <div className={`stat-value ${summary.grandReturnRate >= 0 ? 'positive' : 'negative'}`}>
              {formatPercent(summary.grandReturnRate)}
            </div>
          </div>
        </div>
      )}

      {/* 계좌 탭 */}
      {accounts.length > 0 && (
        <div className="tabs">
          <div className={`tab ${selectedAccount === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedAccount('all')}>전체</div>
          {accounts.map(a => (
            <div key={a} className={`tab ${selectedAccount === a ? 'active' : ''}`}
              onClick={() => setSelectedAccount(a)}>
              {a}
            </div>
          ))}
        </div>
      )}

      {/* 계좌별 요약 (전체 탭일 때) */}
      {selectedAccount === 'all' && summary && summary.accounts.length > 0 && (
        <div className="card mb-16">
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>계좌별 요약</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>계좌</th>
                  <th className="text-right">종목수</th>
                  <th className="text-right">매입금액</th>
                  <th className="text-right">평가금액</th>
                  <th className="text-right">평가손익</th>
                  <th className="text-right">수익률</th>
                  <th className="text-center">관리</th>
                </tr>
              </thead>
              <tbody>
                {summary.accounts.map(a => (
                  <tr key={a.name}>
                    <td style={{ cursor: 'pointer', color: 'var(--accent)' }}
                      onClick={() => setSelectedAccount(a.name)}>{a.name}</td>
                    <td className="text-right">{a.count}</td>
                    <td className="text-right">{a.totalPurchase.toLocaleString()}</td>
                    <td className="text-right">{a.totalEval.toLocaleString()}</td>
                    <td className="text-right" style={{ color: a.totalPnl >= 0 ? 'var(--danger)' : 'var(--accent)' }}>
                      {a.totalPnl.toLocaleString()}</td>
                    <td className="text-right" style={{ color: a.returnRate >= 0 ? 'var(--danger)' : 'var(--accent)' }}>
                      {formatPercent(a.returnRate)}</td>
                    <td className="text-center">
                      <button className="btn btn-danger btn-sm" onClick={() => handleRemoveAccount(a.name)}>삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 종목 목록 + 파이차트 */}
      {holdings.length > 0 ? (
        <>
          <div className="chart-row">
            <div className="card">
              <h3 style={{ fontSize: 15, marginBottom: 4 }}>
                {selectedAccount === 'all' ? '전체' : selectedAccount} 현황
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                매입 {formatKRW(totalPurchase)} → 평가 {formatKRW(totalEval)} ({formatPercent(totalReturn)})
              </p>
              <div className="table-container" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      {selectedAccount === 'all' && <th>계좌</th>}
                      <th style={{ cursor: 'pointer' }} onClick={() => handleSort('stock_name')}>종목 {sortKey === 'stock_name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                      <th className="text-right" style={{ cursor: 'pointer' }} onClick={() => handleSort('quantity')}>보유량 {sortKey === 'quantity' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                      <th className="text-right" style={{ cursor: 'pointer' }} onClick={() => handleSort('avg_price')}>평균단가 {sortKey === 'avg_price' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                      <th className="text-right" style={{ cursor: 'pointer' }} onClick={() => handleSort('current_price')}>현재가 {sortKey === 'current_price' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                      <th className="text-right" style={{ cursor: 'pointer' }} onClick={() => handleSort('purchase_amount')}>매입금액 {sortKey === 'purchase_amount' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                      <th className="text-right" style={{ cursor: 'pointer' }} onClick={() => handleSort('eval_amount')}>평가금액 {sortKey === 'eval_amount' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                      <th className="text-right" style={{ cursor: 'pointer' }} onClick={() => handleSort('eval_pnl')}>평가손익 {sortKey === 'eval_pnl' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                      <th className="text-right" style={{ cursor: 'pointer' }} onClick={() => handleSort('return_rate')}>수익률 {sortKey === 'return_rate' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHoldings.map(h => (
                      <tr key={h.id}>
                        {selectedAccount === 'all' && <td>{h.account_name}</td>}
                        <td>
                          <div style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => openStockDetail(h)}>
                            {h.stock_name}{isForeign(h.stock_code) && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 4 }}>USD</span>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{h.stock_code}</div>
                        </td>
                        <td className="text-right">{h.quantity.toLocaleString()}</td>
                        <td className="text-right">
                          {isForeign(h.stock_code) ? `$${Math.round(h.avg_price).toLocaleString()}` : Math.round(h.avg_price).toLocaleString()}
                        </td>
                        <td className="text-right">
                          {isForeign(h.stock_code) ? `$${h.current_price.toLocaleString()}` : h.current_price.toLocaleString()}
                        </td>
                        <td className="text-right">
                          {isForeign(h.stock_code)
                            ? <><div>{formatKRW(purchaseToKRW(h))}</div><div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>${h.purchase_amount.toLocaleString()}</div></>
                            : h.purchase_amount.toLocaleString()}
                        </td>
                        <td className="text-right">
                          {isForeign(h.stock_code)
                            ? <><div>{formatKRW(toKRW(h))}</div><div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>${h.eval_amount.toLocaleString()}</div></>
                            : h.eval_amount.toLocaleString()}
                        </td>
                        <td className="text-right" style={{ color: h.eval_pnl >= 0 ? 'var(--danger)' : 'var(--accent)' }}>
                          {isForeign(h.stock_code)
                            ? <><div>{formatKRW(pnlToKRW(h))}</div><div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>${h.eval_pnl.toLocaleString()}</div></>
                            : h.eval_pnl.toLocaleString()}</td>
                        <td className="text-right" style={{ color: h.return_rate >= 0 ? 'var(--danger)' : 'var(--accent)', fontWeight: 600 }}>
                          {formatPercent(h.return_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card">
              <h3 style={{ fontSize: 15, marginBottom: 16 }}>종목별 비중</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={110}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`} labelLine={false}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatKRW(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : (
        accounts.length > 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💰</div>
            <div className="empty-state-text">잔고 데이터가 없습니다. "잔고 붙여넣기" 버튼으로 등록해주세요.</div>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">💰</div>
            <div className="empty-state-text">먼저 계좌를 추가해주세요.</div>
          </div>
        )
      )}

      {/* 잔고 붙여넣기 모달 */}
      {showImport && (
        <div className="modal-overlay" onClick={() => setShowImport(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ minWidth: 600 }}>
            <h2 className="modal-title">📋 잔고 붙여넣기</h2>
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 6, background: 'rgba(66,99,235,0.06)', fontSize: 13, lineHeight: 1.7 }}>
              증권사 웹에서 잔고 테이블을 마우스로 드래그 선택 → Ctrl+C → 아래에 Ctrl+V
            </div>
            <div className="form-group">
              <label className="form-label">계좌명 *</label>
              <select className="form-select" value={importAccount}
                onChange={e => setImportAccount(e.target.value)} style={{ maxWidth: 300 }}>
                <option value="">-- 계좌 선택 --</option>
                {accounts.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                계좌가 없으면 위에서 먼저 추가해주세요. 기존 잔고는 덮어씌워집니다.
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">잔고 테이블 데이터</label>
              <textarea className="form-textarea" value={importText} onChange={e => setImportText(e.target.value)}
                placeholder={`증권사 웹에서 복사한 잔고 테이블을 붙여넣으세요.\n\n예시:\n유형\t종목번호\t종목명\t구분\t보유량\t평균단가\t현재가\t매입금액\t평가금액\t평가손익\t수익률\n주식\tA005930\t삼성전자\t현금\t100\t71,500\t72,000\t7,150,000\t7,200,000\t50,000\t0.70`}
                style={{ minHeight: 250, fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setShowImport(false)}>취소</button>
              <button className="btn btn-success" onClick={handleImport}
                disabled={!importAccount || !importText.trim()}>
                💾 잔고 등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 종목 상세 모달 */}
      {detailHolding && (() => {
        const _foreign = isForeign(detailHolding.stock_code)
        // 달러: 소수점 2자리, 원화: 소수점 없음
        const fmtPrice = (v: number) => _foreign ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${Math.round(v).toLocaleString()}원`
        const fmtAmt = (v: number) => _foreign
          ? <><div>{formatKRW(Math.round(v * exchangeRate))}</div><div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></>
          : <>{Math.round(v).toLocaleString()}원</>
        return (
        <div className="modal-overlay" onClick={() => { setDetailHolding(null); setDetailTrades([]) }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ minWidth: 780, maxWidth: 920, maxHeight: '90vh', overflow: 'auto', position: 'relative' }}>
            {/* 닫기 버튼 상단 고정 */}
            <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', justifyContent: 'flex-end', marginBottom: -8 }}>
              <button onClick={() => { setDetailHolding(null); setDetailTrades([]) }}
                style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px 0', lineHeight: 1 }}>
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h2 className="modal-title" style={{ marginBottom: 4 }}>
                  {detailHolding.stock_name}
                  <span style={{ fontSize: 14, color: 'var(--text-secondary)', marginLeft: 8, fontWeight: 400 }}>
                    {detailHolding.stock_code}
                  </span>
                </h2>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {_foreign
                    ? <>${detailHolding.current_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: 13 }}>USD</span></>
                    : <>{detailHolding.current_price.toLocaleString()}원</>}
                </div>
              </div>
              {detailSummary && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>총 손익</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: detailSummary.totalPnl >= 0 ? 'var(--danger)' : 'var(--accent)' }}>
                    {_foreign
                      ? formatKRW(Math.round(detailSummary.totalPnl * exchangeRate))
                      : `${Math.round(detailSummary.totalPnl).toLocaleString()}원`}
                  </div>
                  {_foreign && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      ${detailSummary.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: detailSummary.totalPnlRate >= 0 ? 'var(--danger)' : 'var(--accent)' }}>
                    {formatPercent(detailSummary.totalPnlRate)}
                  </div>
                </div>
              )}
            </div>

            {detailSummary && (
              <>
                {/* 보유 손익 */}
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>보유 손익</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px 16px', fontSize: 13 }}>
                    <div><span style={{ color: 'var(--text-secondary)' }}>보유 수량</span><div style={{ fontWeight: 600 }}>{detailSummary.holdQty.toLocaleString()}주</div></div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>평균 매수가</span><div style={{ fontWeight: 600 }}>{fmtPrice(detailSummary.avgBuyPrice)}</div></div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>매수 금액</span><div style={{ fontWeight: 600 }}>{fmtAmt(detailSummary.purchaseAmount)}</div></div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>평가 금액</span><div style={{ fontWeight: 600 }}>{fmtAmt(detailSummary.evalAmount)}</div></div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>평가 손익</span><div style={{ fontWeight: 600, color: detailSummary.evalPnl >= 0 ? 'var(--danger)' : 'var(--accent)' }}>{fmtAmt(detailSummary.evalPnl)}</div></div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>평가 수익률</span><div style={{ fontWeight: 600, color: detailSummary.evalReturnRate >= 0 ? 'var(--danger)' : 'var(--accent)' }}>{formatPercent(detailSummary.evalReturnRate)}</div></div>
                  </div>
                </div>

                {/* 매매 손익 */}
                {detailSummary.sellQty > 0 && (
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>매매 손익</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px 16px', fontSize: 13 }}>
                      <div><span style={{ color: 'var(--text-secondary)' }}>매도 수량</span><div style={{ fontWeight: 600 }}>{detailSummary.sellQty.toLocaleString()}주</div></div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>평균 매도가</span><div style={{ fontWeight: 600 }}>{fmtPrice(detailSummary.avgSellPrice)}</div></div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>매도 금액</span><div style={{ fontWeight: 600 }}>{fmtAmt(detailSummary.sellAmount)}</div></div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>매수 금액</span><div style={{ fontWeight: 600 }}>{fmtAmt(detailSummary.sellCostBasis)}</div></div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>매매 손익</span><div style={{ fontWeight: 600, color: detailSummary.tradePnl >= 0 ? 'var(--danger)' : 'var(--accent)' }}>{fmtAmt(detailSummary.tradePnl)}</div></div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>수수료+세금</span><div style={{ fontWeight: 600 }}>{fmtAmt(detailSummary.totalFee + detailSummary.totalTax)}</div></div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* 상세 매매내역 */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                상세내역
                <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 8 }}>
                  매수 {detailTrades.filter(t => t.trade_type === 'BUY').length}회 · 매도 {detailTrades.filter(t => t.trade_type === 'SELL').length}회
                </span>
              </div>
              {detailTrades.length > 0 ? (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th className="text-center">구분</th>
                        <th>날짜</th>
                        <th className="text-right">매매가</th>
                        <th className="text-right">수량</th>
                        <th className="text-right">금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailTrades.map(t => (
                        <tr key={t.id}>
                          <td className="text-center">
                            <span className={`badge ${t.trade_type === 'BUY' ? 'badge-buy' : 'badge-sell'}`}>
                              {t.trade_type === 'BUY' ? '매수' : '매도'}
                            </span>
                          </td>
                          <td>{t.trade_date.slice(0, 10)}</td>
                          <td className="text-right">{fmtPrice(t.price)}</td>
                          <td className="text-right">{t.quantity.toLocaleString()}</td>
                          <td className="text-right">{fmtAmt(t.total_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: 16, textAlign: 'center' }}>
                  매매내역이 없습니다.
                </div>
              )}
            </div>


          </div>
        </div>
        )
      })()}
    </div>
  )
}
