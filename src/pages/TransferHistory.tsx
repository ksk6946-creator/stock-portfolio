import { useState, useEffect, useMemo } from 'react'
import type { Transfer } from '../types'

export default function TransferHistory() {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [accounts, setAccounts] = useState<string[]>([])
  const [filterAccount, setFilterAccount] = useState('')
  const [filterType, setFilterType] = useState<'' | 'DEPOSIT' | 'WITHDRAW'>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [searchText, setSearchText] = useState('')
  const [periodPreset, setPeriodPreset] = useState<string>('all')
  const [status, setStatus] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Partial<Transfer>>({})

  // 수동 입력 폼
  const [showAdd, setShowAdd] = useState(false)
  const [addAccount, setAddAccount] = useState('')
  const [addForm, setAddForm] = useState({
    transfer_type: 'DEPOSIT' as 'DEPOSIT' | 'WITHDRAW',
    amount: 0, balance_after: 0, description: '', counterparty: '',
    transfer_date: new Date().toISOString().slice(0, 10)
  })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [accts, all] = await Promise.all([
      window.api.accounts.getAll(),
      window.api.transfers.getAll()
    ])
    setAccounts(accts)
    setTransfers(all)
  }

  function applyPeriodPreset(preset: string) {
    setPeriodPreset(preset)
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')

    switch (preset) {
      case 'today':
        setStartDate(today); setEndDate(today); break
      case 'month':
        setStartDate(`${year}-${month}-01`); setEndDate(today); break
      case 'ytd':
        setStartDate(`${year}-01-01`); setEndDate(today); break
      case '1y': {
        const d = new Date(now); d.setFullYear(d.getFullYear() - 1)
        setStartDate(d.toISOString().slice(0, 10)); setEndDate(today); break
      }
      case 'all':
      default:
        setStartDate(''); setEndDate(''); break
    }
  }

  const filtered = useMemo(() => {
    let result = [...transfers]
    if (filterAccount) result = result.filter(t => t.account_name === filterAccount)
    if (filterType) result = result.filter(t => t.transfer_type === filterType)
    if (startDate) result = result.filter(t => t.transfer_date >= startDate)
    if (endDate) result = result.filter(t => t.transfer_date <= endDate + 'Z')
    if (searchText) {
      const q = searchText.toLowerCase()
      result = result.filter(t =>
        t.description.toLowerCase().includes(q) ||
        t.counterparty.toLowerCase().includes(q) ||
        t.account_name.toLowerCase().includes(q) ||
        t.amount.toString().includes(q)
      )
    }
    return result.sort((a, b) => b.transfer_date.localeCompare(a.transfer_date))
  }, [transfers, filterAccount, filterType, startDate, endDate, searchText])

  const summary = useMemo(() => {
    let deposits = 0, withdraws = 0, depositCount = 0, withdrawCount = 0
    for (const t of filtered) {
      if (t.transfer_type === 'DEPOSIT') { deposits += t.amount; depositCount++ }
      else { withdraws += t.amount; withdrawCount++ }
    }
    return { deposits, withdraws, depositCount, withdrawCount, net: deposits - withdraws }
  }, [filtered])

  async function handleDelete(id: number) {
    if (!confirm('이 입출금 내역을 삭제하시겠습니까?')) return
    await window.api.transfers.deleteOne(id)
    setStatus('삭제 완료')
    await loadData()
  }

  function startEdit(t: Transfer) {
    setEditId(t.id)
    setEditForm({
      transfer_type: t.transfer_type, amount: t.amount, balance_after: t.balance_after,
      description: t.description, counterparty: t.counterparty, transfer_date: t.transfer_date.slice(0, 10)
    })
  }

  async function saveEdit() {
    if (editId === null) return
    await window.api.transfers.update(editId, editForm)
    setEditId(null); setEditForm({})
    setStatus('수정 완료')
    await loadData()
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addAccount || addForm.amount <= 0) { setStatus('계좌와 금액을 입력해주세요.'); return }
    await window.api.transfers.addMany(addAccount, [addForm])
    setStatus(`${addAccount} ${addForm.transfer_type === 'DEPOSIT' ? '입금' : '출금'} ${addForm.amount.toLocaleString()}원 등록 완료`)
    setAddForm({ ...addForm, amount: 0, balance_after: 0, description: '', counterparty: '' })
    await loadData()
  }

  return (
    <div>
      <div className="page-header">
        <div className="flex-between">
          <div>
            <h1 className="page-title">입출금 내역</h1>
            <p className="page-subtitle">계좌별 입출금 내역을 조회하고 관리합니다</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? '✕ 닫기' : '➕ 수동 입력'}
          </button>
        </div>
      </div>

      {status && (
        <div style={{
          padding: '10px 16px', marginBottom: 16, borderRadius: 6,
          background: status.includes('실패') ? 'rgba(224,49,49,0.1)' : 'rgba(43,138,62,0.1)',
          color: status.includes('실패') ? 'var(--danger)' : 'var(--success)', fontSize: 14
        }}>{status}</div>
      )}

      {/* 수동 입력 폼 */}
      {showAdd && (
        <div className="card mb-16">
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>수동 입출금 입력</h3>
          <form onSubmit={handleAdd}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">계좌 *</label>
                <select className="form-select" value={addAccount} onChange={e => setAddAccount(e.target.value)}>
                  <option value="">-- 계좌 선택 --</option>
                  {accounts.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">구분 *</label>
                <select className="form-select" value={addForm.transfer_type}
                  onChange={e => setAddForm({ ...addForm, transfer_type: e.target.value as any })}>
                  <option value="DEPOSIT">입금</option>
                  <option value="WITHDRAW">출금</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">금액 *</label>
                <input type="number" className="form-input" value={addForm.amount || ''}
                  onChange={e => setAddForm({ ...addForm, amount: parseInt(e.target.value) || 0 })} min="1" required />
              </div>
              <div className="form-group">
                <label className="form-label">일자 *</label>
                <input type="date" className="form-input" value={addForm.transfer_date}
                  onChange={e => setAddForm({ ...addForm, transfer_date: e.target.value })} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">설명</label>
                <input className="form-input" value={addForm.description}
                  onChange={e => setAddForm({ ...addForm, description: e.target.value })}
                  placeholder="예: 이체입금, 융자매수" />
              </div>
              <div className="form-group">
                <label className="form-label">상대</label>
                <input className="form-input" value={addForm.counterparty}
                  onChange={e => setAddForm({ ...addForm, counterparty: e.target.value })}
                  placeholder="예: 토스뱅크" />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button type="submit" className="btn btn-success" disabled={!addAccount || addForm.amount <= 0}>
                  💾 등록
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* 필터 */}
      <div className="card mb-16">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>기간</span>
          {[
            { key: 'today', label: '오늘' },
            { key: 'month', label: '이번 달' },
            { key: 'ytd', label: '올해' },
            { key: '1y', label: '최근 1년' },
            { key: 'all', label: '전체' },
          ].map(p => (
            <button key={p.key}
              className={`btn btn-sm ${periodPreset === p.key ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => applyPeriodPreset(p.key)}>{p.label}</button>
          ))}
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">계좌</label>
            <select className="form-select" value={filterAccount} onChange={e => setFilterAccount(e.target.value)}>
              <option value="">전체</option>
              {accounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">구분</label>
            <select className="form-select" value={filterType} onChange={e => setFilterType(e.target.value as any)}>
              <option value="">전체</option>
              <option value="DEPOSIT">입금</option>
              <option value="WITHDRAW">출금</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">시작일</label>
            <input type="date" className="form-input" value={startDate}
              onChange={e => { setStartDate(e.target.value); setPeriodPreset('custom') }} />
          </div>
          <div className="form-group">
            <label className="form-label">종료일</label>
            <input type="date" className="form-input" value={endDate}
              onChange={e => { setEndDate(e.target.value); setPeriodPreset('custom') }} />
          </div>
          <div className="form-group">
            <label className="form-label">검색</label>
            <input className="form-input" value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="설명, 상대, 금액..." />
          </div>
        </div>
      </div>


      {/* 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>입금 ({summary.depositCount}건)</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--danger)' }}>+{summary.deposits.toLocaleString()}원</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>출금 ({summary.withdrawCount}건)</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--primary)' }}>-{summary.withdraws.toLocaleString()}원</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>순입출금</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: summary.net >= 0 ? 'var(--danger)' : 'var(--primary)' }}>
            {summary.net >= 0 ? '+' : ''}{summary.net.toLocaleString()}원
          </div>
        </div>
      </div>

      {/* 메인 테이블 */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏦</div>
          <div className="empty-state-text">입출금 내역이 없습니다</div>
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
                  <th className="text-center">구분</th>
                  <th className="text-right">금액</th>
                  <th>설명</th>
                  <th>상대</th>
                  <th className="text-center">관리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id}>
                    {editId === t.id ? (
                      <>
                        <td>
                          <input type="date" className="form-input" style={{ width: 130 }}
                            value={editForm.transfer_date || ''} onChange={e => setEditForm({ ...editForm, transfer_date: e.target.value })} />
                        </td>
                        <td>{t.account_name}</td>
                        <td className="text-center">
                          <select className="form-select" style={{ width: 80 }} value={editForm.transfer_type || ''}
                            onChange={e => setEditForm({ ...editForm, transfer_type: e.target.value as any })}>
                            <option value="DEPOSIT">입금</option>
                            <option value="WITHDRAW">출금</option>
                          </select>
                        </td>
                        <td className="text-right">
                          <input type="number" className="form-input" style={{ width: 120, textAlign: 'right' }}
                            value={editForm.amount || ''} onChange={e => setEditForm({ ...editForm, amount: parseInt(e.target.value) || 0 })} />
                        </td>
                        <td>
                          <input className="form-input" style={{ width: 120 }}
                            value={editForm.description || ''} onChange={e => setEditForm({ ...editForm, description: e.target.value })} />
                        </td>
                        <td>
                          <input className="form-input" style={{ width: 100 }}
                            value={editForm.counterparty || ''} onChange={e => setEditForm({ ...editForm, counterparty: e.target.value })} />
                        </td>
                        <td className="text-center">
                          <div className="btn-group" style={{ justifyContent: 'center' }}>
                            <button className="btn btn-success btn-sm" onClick={saveEdit}>저장</button>
                            <button className="btn btn-outline btn-sm" onClick={() => setEditId(null)}>취소</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{t.transfer_date.slice(0, 10)}</td>
                        <td>{t.account_name}</td>
                        <td className="text-center">
                          <span className={`badge ${t.transfer_type === 'DEPOSIT' ? 'badge-buy' : 'badge-sell'}`}>
                            {t.transfer_type === 'DEPOSIT' ? '입금' : '출금'}
                          </span>
                        </td>
                        <td className="text-right" style={{ color: t.transfer_type === 'DEPOSIT' ? 'var(--danger)' : 'var(--primary)' }}>
                          {t.transfer_type === 'DEPOSIT' ? '+' : '-'}{t.amount.toLocaleString()}원
                        </td>
                        <td>{t.description}</td>
                        <td>{t.counterparty}</td>
                        <td className="text-center">
                          <div className="btn-group" style={{ justifyContent: 'center' }}>
                            <button className="btn btn-outline btn-sm" onClick={() => startEdit(t)}>수정</button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(t.id)}>삭제</button>
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
