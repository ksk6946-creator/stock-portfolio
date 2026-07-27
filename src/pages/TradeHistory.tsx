import { useState, useEffect } from 'react'
import type { Trade, TradeFilters } from '../types'
import { formatKRW } from '../services/parser'

export default function TradeHistory() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [filters, setFilters] = useState<TradeFilters>({})
  const [accounts, setAccounts] = useState<string[]>([])
  const [stocks, setStocks] = useState<string[]>([])
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)

  useEffect(() => {
    loadTrades()
    loadFilterOptions()
  }, [])

  async function loadTrades() {
    const data = await window.api.trades.getAll(filters)
    setTrades(data)
  }

  async function loadFilterOptions() {
    const [accts, stks] = await Promise.all([
      window.api.portfolio.accounts(),
      window.api.portfolio.stocks()
    ])
    setAccounts(accts)
    setStocks(stks)
  }

  async function handleFilter() {
    await loadTrades()
  }

  async function handleDelete(id: number) {
    if (!confirm('이 매매 내역을 삭제하시겠습니까?')) return
    await window.api.trades.delete(id)
    await loadTrades()
  }

  function openEdit(trade: Trade) {
    setEditingTrade({ ...trade })
    setShowEditModal(true)
  }

  async function handleSaveEdit() {
    if (!editingTrade) return
    await window.api.trades.update(editingTrade.id, {
      account: editingTrade.account,
      stock_name: editingTrade.stock_name,
      trade_type: editingTrade.trade_type,
      quantity: editingTrade.quantity,
      price: editingTrade.price,
      fee: editingTrade.fee,
      tax: editingTrade.tax,
      trade_date: editingTrade.trade_date,
    })
    setShowEditModal(false)
    setEditingTrade(null)
    await loadTrades()
  }

  const totalAmount = trades.reduce((sum, t) => sum + t.total_amount, 0)

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">매매 내역</h1>
        <p className="page-subtitle">전체 거래 기록을 조회하고 관리합니다 (총 {trades.length}건)</p>
      </div>

      {/* 필터 */}
      <div className="filter-bar">
        <div className="form-group">
          <label className="form-label">시작일</label>
          <input type="date" className="form-input" value={filters.startDate || ''}
            onChange={e => setFilters(f => ({ ...f, startDate: e.target.value || undefined }))} />
        </div>
        <div className="form-group">
          <label className="form-label">종료일</label>
          <input type="date" className="form-input" value={filters.endDate || ''}
            onChange={e => setFilters(f => ({ ...f, endDate: e.target.value || undefined }))} />
        </div>
        <div className="form-group">
          <label className="form-label">종목</label>
          <select className="form-select" value={filters.stockName || ''}
            onChange={e => setFilters(f => ({ ...f, stockName: e.target.value || undefined }))}>
            <option value="">전체</option>
            {stocks.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">구분</label>
          <select className="form-select" value={filters.tradeType || ''}
            onChange={e => setFilters(f => ({ ...f, tradeType: e.target.value || undefined }))}>
            <option value="">전체</option>
            <option value="BUY">매수</option>
            <option value="SELL">매도</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">계좌</label>
          <select className="form-select" value={filters.account || ''}
            onChange={e => setFilters(f => ({ ...f, account: e.target.value || undefined }))}>
            <option value="">전체</option>
            {accounts.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={handleFilter}>조회</button>
      </div>

      {/* 테이블 */}
      {trades.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-text">매매 내역이 없습니다</div>
        </div>
      ) : (
        <div className="card">
          <div className="flex-between mb-16">
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              총 체결금액: {formatKRW(totalAmount)}
            </span>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>일시</th>
                  <th>계좌</th>
                  <th>종목</th>
                  <th className="text-center">구분</th>
                  <th className="text-right">수량</th>
                  <th className="text-right">단가</th>
                  <th className="text-right">체결금액</th>
                  <th className="text-right">수수료</th>
                  <th className="text-center">출처</th>
                  <th className="text-center">관리</th>
                </tr>
              </thead>
              <tbody>
                {trades.map(t => (
                  <tr key={t.id}>
                    <td>{t.trade_date}</td>
                    <td>{t.account}</td>
                    <td>{t.stock_name}</td>
                    <td className="text-center">
                      <span className={`badge ${t.trade_type === 'BUY' ? 'badge-buy' : 'badge-sell'}`}>
                        {t.trade_type === 'BUY' ? '매수' : '매도'}
                      </span>
                    </td>
                    <td className="text-right">{t.quantity.toLocaleString()}</td>
                    <td className="text-right">{t.price.toLocaleString()}</td>
                    <td className="text-right">{t.total_amount.toLocaleString()}</td>
                    <td className="text-right">{t.fee.toLocaleString()}</td>
                    <td className="text-center">{t.source}</td>
                    <td className="text-center">
                      <div className="btn-group" style={{ justifyContent: 'center' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(t)}>수정</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(t.id)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 수정 모달 */}
      {showEditModal && editingTrade && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">매매 내역 수정</h2>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">종목명</label>
                <input className="form-input" value={editingTrade.stock_name}
                  onChange={e => setEditingTrade({ ...editingTrade, stock_name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">구분</label>
                <select className="form-select" value={editingTrade.trade_type}
                  onChange={e => setEditingTrade({ ...editingTrade, trade_type: e.target.value as any })}>
                  <option value="BUY">매수</option>
                  <option value="SELL">매도</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">수량</label>
                <input type="number" className="form-input" value={editingTrade.quantity}
                  onChange={e => setEditingTrade({ ...editingTrade, quantity: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="form-group">
                <label className="form-label">단가</label>
                <input type="number" className="form-input" value={editingTrade.price}
                  onChange={e => setEditingTrade({ ...editingTrade, price: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">수수료</label>
                <input type="number" className="form-input" value={editingTrade.fee}
                  onChange={e => setEditingTrade({ ...editingTrade, fee: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="form-group">
                <label className="form-label">세금</label>
                <input type="number" className="form-input" value={editingTrade.tax}
                  onChange={e => setEditingTrade({ ...editingTrade, tax: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">계좌</label>
                <input className="form-input" value={editingTrade.account}
                  onChange={e => setEditingTrade({ ...editingTrade, account: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">체결일시</label>
                <input className="form-input" value={editingTrade.trade_date}
                  onChange={e => setEditingTrade({ ...editingTrade, trade_date: e.target.value })} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setShowEditModal(false)}>취소</button>
              <button className="btn btn-primary" onClick={handleSaveEdit}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
