import { useState, useEffect, useMemo } from 'react'
import type { Trade } from '../types'

interface SyncItem {
  stockCode: string
  stockName: string
  trades: Trade[]
  status: 'pending' | 'syncing' | 'done' | 'error'
  message?: string
}

export default function DaumSync() {
  const [cookie, setCookie] = useState('')
  const [groupId, setGroupId] = useState('1')
  const [trades, setTrades] = useState<Trade[]>([])
  const [accounts, setAccounts] = useState<string[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [syncItems, setSyncItems] = useState<SyncItem[]>([])
  const [selectedStocks, setSelectedStocks] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [syncedTradeIds, setSyncedTradeIds] = useState<Set<number>>(new Set())
  const [cookieValid, setCookieValid] = useState<boolean | null>(null)
  const [manualCodes, setManualCodes] = useState<Record<string, string>>({})
  const [daumGroups, setDaumGroups] = useState<any[]>([])
  const [loggingIn, setLoggingIn] = useState(false)
  const [showManualCookie, setShowManualCookie] = useState(false)

  // 계좌 → 다음 금융 그룹 ID 매핑
  const accountGroupMap: Record<string, string> = {
    '72480': '4',   // [선근] 메인 → 그룹 4
    '18160': '5',   // [선근] ISA → 그룹 5
  }

  // 계좌명에서 괄호 안 숫자 추출하여 그룹 ID 반환
  function getGroupIdForAccount(accountName: string): string | null {
    const match = accountName.match(/\((\d+)\)/)
    if (match) {
      return accountGroupMap[match[1]] || null
    }
    return null
  }

  // 다음 금융에서 관리하는 계좌만 필터
  const syncableAccounts = accounts.filter(a => getGroupIdForAccount(a) !== null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [accts, savedCookie, savedGroupId, savedSyncedIds] = await Promise.all([
        window.api.accounts.getAll(),
        window.api.settings.get('daumCookie'),
        window.api.settings.get('daumGroupId'),
        window.api.settings.get('daumSyncedTradeIds')
      ])
      setAccounts(accts)
      if (savedCookie) setCookie(savedCookie)
      if (savedGroupId) setGroupId(savedGroupId)
      if (savedSyncedIds) setSyncedTradeIds(new Set(savedSyncedIds))

      // 저장된 세션 쿠키가 있으면 자동 복원 시도
      let activeCookie = savedCookie || ''
      if (!activeCookie) {
        const sessionResult = await window.api.daum.sessionCookie()
        if (sessionResult.success && sessionResult.cookie) {
          activeCookie = sessionResult.cookie
          setCookie(activeCookie)
          await window.api.settings.set('daumCookie', activeCookie)
        }
      }

      // 쿠키가 있으면 자동 유효성 체크
      if (activeCookie) {
        const gid = parseInt(savedGroupId || groupId) || 1
        const check = await window.api.daum.checkCookie(activeCookie, gid)
        if (check.ok) {
          setCookieValid(true)
          // 그룹 목록도 로드
          const groupResult = await window.api.daum.getGroups(activeCookie)
          if (groupResult.success && groupResult.groups.length > 0) {
            setDaumGroups(groupResult.groups)
          }
        } else {
          setCookieValid(false)
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoaded(true)
    }
  }

  async function handleLogin() {
    setLoggingIn(true)
    addLog('🔐 로그인 창을 여는 중...')
    try {
      const result = await window.api.daum.login()
      if (result.success && result.cookie) {
        setCookie(result.cookie)
        await window.api.settings.set('daumCookie', result.cookie)
        addLog('✅ 로그인 성공! 쿠키 자동 추출 완료')

        // 쿠키 유효성 체크 + 그룹 로드
        await verifyCookieAndLoadGroups(result.cookie)
      } else {
        addLog(`⚠️ 로그인 실패: ${result.error || '알 수 없는 오류'}`)
        setCookieValid(false)
      }
    } catch (err) {
      addLog(`❌ 로그인 오류: ${err}`)
    } finally {
      setLoggingIn(false)
    }
  }

  async function verifyCookieAndLoadGroups(cookieStr: string) {
    const gid = parseInt(groupId) || 1
    const check = await window.api.daum.checkCookie(cookieStr, gid)
    if (check.ok) {
      setCookieValid(true)
      addLog('✅ 인증 유효')
      await window.api.settings.set('daumGroupId', groupId)
      const groupResult = await window.api.daum.getGroups(cookieStr)
      if (groupResult.success && groupResult.groups.length > 0) {
        setDaumGroups(groupResult.groups)
        const names = groupResult.groups.map((g: any) => `${g.name || g.groupName || '그룹'}(${g.id || g.groupId})`).join(', ')
        addLog(`📂 그룹 목록: ${names}`)
        if (!groupId || groupId === '1') {
          const firstId = String(groupResult.groups[0]?.id || groupResult.groups[0]?.groupId || '1')
          setGroupId(firstId)
        }
      }
    } else {
      setCookieValid(false)
      addLog(`⚠️ 인증 실패 (HTTP ${check.status}). 다시 로그인해주세요.`)
    }
  }

  async function saveCookie() {
    const cleaned = cookie.replace(/[\r\n\t]/g, '').trim()
    setCookie(cleaned)
    await window.api.settings.set('daumCookie', cleaned)
    await window.api.settings.set('daumGroupId', groupId)
    addLog('쿠키 저장 중... 유효성 확인')
    await verifyCookieAndLoadGroups(cleaned)
  }

  async function loadTrades() {
    if (!selectedAccount) { addLog('계좌를 선택해주세요'); return }
    const filters: any = { account: selectedAccount }
    if (startDate) filters.startDate = startDate
    if (endDate) filters.endDate = endDate
    const allTrades = await window.api.trades.getAll(filters)
    setTrades(allTrades)

    // 잔고에서 현재 보유 종목만 기본 선택
    const holdings = await window.api.holdings.get(selectedAccount)
    const holdingNames = new Set(holdings.map(h => h.stock_name))
    const tradeNames = new Set(allTrades.map(t => t.stock_name))
    // 보유 종목 중 매매 내역이 있는 것만 선택
    const defaultSelected = [...tradeNames].filter(name => holdingNames.has(name))
    setSelectedStocks(new Set(defaultSelected))

    // 잔고에서 종목코드 미리 채우기
    const allHoldings = await window.api.holdings.get()
    const codes: Record<string, string> = { ...manualCodes }
    // 매매내역에 이미 있는 stock_code 우선 사용
    for (const t of allTrades) {
      if (t.stock_code && !codes[t.stock_name]) codes[t.stock_name] = t.stock_code
    }
    // 선택된(동기화할) 종목만 코드 검색 (없는 것만)
    for (const name of defaultSelected) {
      if (codes[name]) continue
      const h = allHoldings.find(h => h.stock_name === name)
      if (h?.stock_code) { codes[name] = h.stock_code; continue }
      const baseName = name.replace(/\(.*?\)$/, '').trim()
      if (baseName !== name) {
        const h2 = allHoldings.find(h => h.stock_name === baseName)
        if (h2?.stock_code) { codes[name] = h2.stock_code; continue }
      }
      // 네이버 검색 (선택된 종목만)
      const result = await window.api.daum.searchStockCode(baseName !== name ? baseName : name)
      if (result.success && result.code) { codes[name] = result.code }
    }
    setManualCodes(codes)

    const dateRange = startDate || endDate
      ? ` (${startDate || '~'} ~ ${endDate || '~'})`
      : ' (전체)'
    addLog(`${selectedAccount}${dateRange}: ${allTrades.length}건 매매내역 로드`)
  }

  // 종목별로 그룹핑
  const stockGroups = useMemo(() => {
    const groups: Record<string, Trade[]> = {}
    for (const t of trades) {
      if (!groups[t.stock_name]) groups[t.stock_name] = []
      groups[t.stock_name].push(t)
    }
    // 날짜순 정렬
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    }
    return groups
  }, [trades])

  function addLog(msg: string) {
    setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev])
  }

  // 종목코드 추출: manualCodes에서 가져옴 (로드 시 미리 채워짐)
  async function findStockCode(stockName: string): Promise<string> {
    return manualCodes[stockName] || ''
  }

  async function startSync() {
    if (!cookie) { addLog('먼저 로그인해주세요'); return }
    if (trades.length === 0) { addLog('매매내역을 먼저 로드해주세요'); return }

    // 동기화 전 쿠키 유효성 체크
    addLog('쿠키 유효성 확인 중...')
    let activeCookie = cookie
    const check = await window.api.daum.checkCookie(activeCookie, parseInt(groupId))
    if (!check.ok) {
      // 세션에서 쿠키 재추출 시도
      addLog('쿠키 만료됨. 세션에서 재추출 시도...')
      const sessionResult = await window.api.daum.sessionCookie()
      if (sessionResult.success && sessionResult.cookie) {
        const recheck = await window.api.daum.checkCookie(sessionResult.cookie, parseInt(groupId))
        if (recheck.ok) {
          activeCookie = sessionResult.cookie
          setCookie(activeCookie)
          await window.api.settings.set('daumCookie', activeCookie)
          addLog('✅ 세션 쿠키로 복원 성공')
        } else {
          setCookieValid(false)
          addLog('❌ 세션 쿠키도 만료됨. 다시 로그인해주세요.')
          return
        }
      } else {
        setCookieValid(false)
        addLog('❌ 쿠키가 만료되었습니다. 다시 로그인해주세요.')
        return
      }
    }
    setCookieValid(true)

    setSyncing(true)
    const items: SyncItem[] = Object.entries(stockGroups)
      .filter(([name]) => selectedStocks.has(name))
      .map(([name, trades]) => ({
        stockCode: '', stockName: name, trades, status: 'pending' as const
      }))
    setSyncItems(items)

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      items[i] = { ...item, status: 'syncing' }
      setSyncItems([...items])

      try {
        // 1. 종목코드 찾기
        const code = await findStockCode(item.stockName)
        if (!code) {
          items[i] = { ...item, status: 'error', message: '종목코드를 찾을 수 없음' }
          setSyncItems([...items])
          addLog(`❌ ${item.stockName}: 종목코드 없음`)
          continue
        }
        items[i].stockCode = code
        addLog(`🔍 ${item.stockName} → ${code}`)

        // 2. 종목 추가 (이미 있으면 itemId 반환)
        const addResult = await window.api.daum.addItem(activeCookie, parseInt(groupId), code)
        if (!addResult.success) {
          items[i] = { ...item, status: 'error', message: addResult.error || '종목 추가 실패' }
          setSyncItems([...items])
          addLog(`❌ ${item.stockName}: 종목 추가 실패 - ${addResult.error}${addResult.raw ? '\n   응답: ' + addResult.raw.slice(0, 200) : ''}`)
          continue
        }
        const itemId = addResult.itemId!
        addLog(`✅ ${item.stockName} 종목 추가 (itemId: ${itemId})`)

        // 3. 기존 매매 내역 조회 (중복 방지)
        const existingResult = await window.api.daum.getTrades(activeCookie, parseInt(groupId), itemId)
        const existingTrades = existingResult.success ? existingResult.trades : []
        // 첫 번째 매매의 필드 구조 로그 (디버깅용)
        if (existingTrades.length > 0) {
          const sample = existingTrades[0]
          addLog(`  📋 기존 매매 ${existingTrades.length}건 조회됨`)
          addLog(`  📋 샘플: type=${sample.tradeType}, date=${sample.tradeDate}, price=${sample.price}, qty=${sample.tradeQty}`)
        }
        const existingKeys = new Set(
          existingTrades.map((t: any) => {
            const type = t.tradeType || ''
            const price = Math.round(Number(t.price) || 0)
            const qty = Number(t.tradeQty) || 0
            const date = String(t.tradeDate || '').replace(/[-/]/g, '').slice(0, 8)
            return `${type}_${date}_${price}_${qty}`
          })
        )
        addLog(`  🔍 ${item.stockName}: 기존 ${existingTrades.length}건, 등록대상 ${item.trades.length}건`)

        // 4. 매매내역 등록
        let successCount = 0
        let skippedCount = 0
        const newSyncedIds = new Set(syncedTradeIds)
        for (const trade of item.trades) {
          // 이미 동기화된 매매는 스킵 (로컬 ID 기반)
          if (syncedTradeIds.has(trade.id)) {
            skippedCount++
            continue
          }
          // 다음 금융에 이미 같은 매매가 있으면 스킵 (날짜+타입+가격+수량)
          const tradeType = trade.trade_type === 'BUY' ? 'P' : 'S'
          const tradeDate = trade.trade_date.replace(/[-/]/g, '').slice(0, 8)
          const key = `${tradeType}_${tradeDate}_${Math.round(trade.price)}_${trade.quantity}`
          if (existingKeys.has(key)) {
            skippedCount++
            newSyncedIds.add(trade.id)
            continue
          }
          // 첫 건만 키 비교 로그
          if (successCount === 0 && skippedCount === 0) {
            addLog(`  🔑 등록키: ${key} | 기존키 예시: ${[...existingKeys].slice(0, 3).join(', ')}`)
          }
          const tradeResult = await window.api.daum.addTrade(activeCookie, parseInt(groupId), itemId, {
            tradeType: trade.trade_type === 'BUY' ? 'P' : 'S',
            price: trade.price,
            tradeQty: trade.quantity,
            tradeDate: trade.trade_date.replace(/[-/]/g, '').slice(0, 8),
            memo: ''
          })
          if (tradeResult.success) {
            successCount++
            newSyncedIds.add(trade.id)
          } else {
            addLog(`  ⚠️ ${trade.trade_date} ${trade.trade_type} ${trade.quantity}주 실패: ${tradeResult.error}`)
          }
          // 요청 간 딜레이 (서버 부하 방지)
          await new Promise(r => setTimeout(r, 300))
        }
        // 동기화된 ID 저장
        setSyncedTradeIds(newSyncedIds)
        await window.api.settings.set('daumSyncedTradeIds', [...newSyncedIds])

        const statusMsg = skippedCount > 0
          ? `${successCount}건 등록, ${skippedCount}건 스킵(기등록)`
          : `${successCount}/${item.trades.length}건 등록`
        items[i] = { ...item, stockCode: code, status: 'done', message: statusMsg }
        setSyncItems([...items])
        addLog(`✅ ${item.stockName}: ${statusMsg}`)

      } catch (err) {
        items[i] = { ...item, status: 'error', message: String(err) }
        setSyncItems([...items])
        addLog(`❌ ${item.stockName}: ${err}`)
      }

      // 종목 간 딜레이
      await new Promise(r => setTimeout(r, 500))
    }

    setSyncing(false)
    addLog('🏁 동기화 완료')
  }

  if (!loaded) {
    return <div className="empty-state"><div className="empty-state-icon">🔄</div><div className="empty-state-text">로딩 중...</div></div>
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">다음 금융 동기화</h1>
        <p className="page-subtitle">매매내역을 다음 금융 MY 포트폴리오에 자동 등록합니다</p>
      </div>

      {/* 인증 설정 */}
      <div className="card mb-16">
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>1. 인증</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <button className="btn btn-primary" onClick={handleLogin} disabled={loggingIn}>
            {loggingIn ? '⏳ 로그인 중...' : '🔐 카카오 로그인'}
          </button>
          {cookieValid === true && <span style={{ fontSize: 13, color: 'var(--success)' }}>✅ 인증 유효</span>}
          {cookieValid === false && <span style={{ fontSize: 13, color: 'var(--danger)' }}>❌ 인증 만료 — 다시 로그인해주세요</span>}
          {cookieValid === null && cookie && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>⏸️ 인증 상태 미확인</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
          버튼을 누르면 카카오 로그인 창이 열립니다. 로그인하면 자동으로 쿠키가 추출됩니다.
        </div>

        {/* 고급 설정 (그룹 ID + 수동 쿠키) */}
        <div style={{ marginTop: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--accent)', cursor: 'pointer' }}
            onClick={() => setShowManualCookie(!showManualCookie)}>
            {showManualCookie ? '▼' : '▶'} 수동 쿠키 입력 (고급)
          </span>
          {showManualCookie && (
            <div style={{ marginTop: 8 }}>
              <div className="form-group">
                <label className="form-label">다음 금융 그룹 (계좌)</label>
                {daumGroups.length > 0 ? (
                  <select className="form-select" value={groupId} onChange={e => setGroupId(e.target.value)} style={{ maxWidth: 250 }}>
                    {daumGroups.map((g: any) => {
                      const id = String(g.id || g.groupId)
                      const name = g.name || g.groupName || `그룹 ${id}`
                      return <option key={id} value={id}>{name} (ID: {id})</option>
                    })}
                  </select>
                ) : (
                  <input className="form-input" value={groupId} onChange={e => setGroupId(e.target.value)}
                    placeholder="그룹 ID (로그인 후 자동 로드)" style={{ maxWidth: 250 }} />
                )}
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                  메인(72480) → 그룹 4, ISA(18160) → 그룹 5 (계좌 선택 시 자동 설정됨)
                </div>
              </div>
              <div style={{ padding: '8px 12px', marginBottom: 8, borderRadius: 6, background: 'rgba(66,99,235,0.06)', fontSize: 12, lineHeight: 1.6 }}>
                로그인 방식이 안 될 경우: 크롬 F12 → Network 탭 → cookie 값 복사
              </div>
              <textarea className="form-textarea" value={cookie} onChange={e => setCookie(e.target.value)}
                placeholder="쿠키 문자열..." style={{ minHeight: 60, fontFamily: 'monospace', fontSize: 11 }} />
              <button className="btn btn-outline btn-sm" onClick={saveCookie} style={{ marginTop: 6 }}>💾 쿠키 저장</button>
            </div>
          )}
        </div>
      </div>

      {/* 종목 정리 */}
      {cookieValid && (
        <div className="card mb-16">
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>🧹 종목 정리</h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
            보유수량 0인 종목을 다음 금융에서 삭제합니다.
          </p>
          <button className="btn btn-outline" onClick={async () => {
            const groups = [{ id: 1, name: '메인' }, { id: 3, name: 'ISA' }]
            for (const g of groups) {
              addLog(`그룹 ${g.id} (${g.name}) 보유수량 0 종목 조회 중...`)
              const result = await window.api.daum.getEmptyItems(cookie, g.id)
              if (!result.success) { addLog(`  ❌ 조회 실패: ${result.error}`); continue }
              if (result.items.length === 0) { addLog(`  ✅ 보유수량 0인 종목 없음`); continue }

              addLog(`  ${result.items.length}건 발견`)

              // 1단계: 각 종목의 매매내역 먼저 삭제
              for (const item of result.items) {
                const addResult = await window.api.daum.addItem(cookie, g.id, item.symbolCode)
                if (!addResult.success || !addResult.itemId) continue
                const itemId = addResult.itemId

                const tradesResult = await window.api.daum.getTrades(cookie, g.id, itemId)
                if (tradesResult.success && tradesResult.trades.length > 0) {
                  addLog(`  ${item.name}: 매매 ${tradesResult.trades.length}건 삭제 중...`)
                  for (const t of tradesResult.trades) {
                    const tid = t.id || t.myStockTradeDetailId
                    if (tid) {
                      await window.api.daum.deleteTrade(cookie, g.id, itemId, tid)
                      await new Promise(r => setTimeout(r, 150))
                    }
                  }
                  addLog(`  ${item.name}: 매매 삭제 완료`)
                }
                await new Promise(r => setTimeout(r, 200))
              }

              // 2단계: 종목 삭제
              const codes = result.items.map(i => i.symbolCode).filter(Boolean)
              let deleted = 0
              for (let i = 0; i < codes.length; i += 5) {
                const batch = codes.slice(i, i + 5)
                const del = await window.api.daum.deleteItems(cookie, g.id, batch)
                if (del.success) {
                  deleted += batch.length
                } else {
                  addLog(`  ❌ 배치 실패 (${del.status}): ${batch.join(', ')}`)
                }
                await new Promise(r => setTimeout(r, 500))
              }
              addLog(`  ✅ ${g.name}: ${deleted}/${codes.length}개 삭제`)
            }
            addLog('🏁 종목 정리 완료')
          }}>
            🧹 보유수량 0 종목 정리
          </button>
        </div>
      )}

      {/* 계좌 선택 + 매매내역 로드 */}
      <div className="card mb-16">
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>2. 매매내역 선택</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">계좌</label>
            <select className="form-select" value={selectedAccount} onChange={e => {
              const acct = e.target.value
              setSelectedAccount(acct)
              const gid = getGroupIdForAccount(acct)
              if (gid) setGroupId(gid)
            }}>
              <option value="">-- 계좌 선택 --</option>
              {syncableAccounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">시작일</label>
            <input type="date" className="form-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">종료일</label>
            <input type="date" className="form-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
            <button className="btn btn-outline" onClick={loadTrades} disabled={!selectedAccount}>
              📋 매매내역 로드
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          {[
            { label: '오늘', fn: () => { const d = new Date().toISOString().slice(0,10); setStartDate(d); setEndDate(d) }},
            { label: '이번 주', fn: () => { const n = new Date(); const mon = new Date(n); mon.setDate(n.getDate() - n.getDay() + 1); setStartDate(mon.toISOString().slice(0,10)); setEndDate(n.toISOString().slice(0,10)) }},
            { label: '이번 달', fn: () => { const n = new Date(); setStartDate(`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`); setEndDate(n.toISOString().slice(0,10)) }},
            { label: '전체', fn: () => { setStartDate(''); setEndDate('') }},
          ].map(b => (
            <button key={b.label} className="btn btn-sm btn-outline" onClick={b.fn} style={{ fontSize: 11 }}>{b.label}</button>
          ))}
        </div>
        {trades.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
            {Object.keys(stockGroups).length}개 종목, 총 {trades.length}건
          </div>
        )}
      </div>

      {/* 종목별 미리보기 + 동기화 */}
      {Object.keys(stockGroups).length > 0 && (
        <div className="card mb-16">
          <div className="flex-between mb-8">
            <div>
              <h3 style={{ fontSize: 15, display: 'inline' }}>3. 동기화</h3>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
                {selectedStocks.size}/{Object.keys(stockGroups).length}개 종목 선택
              </span>
              <button className="btn btn-sm btn-outline" style={{ marginLeft: 8, fontSize: 11 }}
                onClick={() => setSelectedStocks(new Set(Object.keys(stockGroups)))}>전체 선택</button>
              <button className="btn btn-sm btn-outline" style={{ marginLeft: 4, fontSize: 11 }}
                onClick={() => setSelectedStocks(new Set())}>전체 해제</button>
            </div>
            <button className="btn btn-success" onClick={startSync} disabled={syncing || !cookie || selectedStocks.size === 0}>
              {syncing ? '⏳ 동기화 중...' : `🚀 ${selectedStocks.size}개 종목 동기화`}
            </button>
            <button className="btn btn-outline" style={{ marginLeft: 6 }} disabled={syncing || selectedStocks.size === 0}
              onClick={async () => {
                // 선택된 종목의 trade ID만 초기화
                const selectedTradeIds = trades
                  .filter(t => selectedStocks.has(t.stock_name))
                  .map(t => t.id)
                const newIds = new Set([...syncedTradeIds].filter(id => !selectedTradeIds.includes(id)))
                setSyncedTradeIds(newIds)
                await window.api.settings.set('daumSyncedTradeIds', [...newIds])
                addLog(`🗑️ ${selectedStocks.size}개 종목 동기화 기록 초기화 (${selectedTradeIds.length}건)`)
              }}>
              🗑️ 선택 종목 기록 초기화
            </button>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>종목명</th>
                  <th>종목코드</th>
                  <th className="text-center">매매건수</th>
                  <th className="text-center">매수</th>
                  <th className="text-center">매도</th>
                  <th className="text-center">기간</th>
                  <th className="text-center">상태</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stockGroups).map(([name, trades]) => {
                  const syncItem = syncItems.find(s => s.stockName === name)
                  const buys = trades.filter(t => t.trade_type === 'BUY').length
                  const sells = trades.filter(t => t.trade_type === 'SELL').length
                  const dates = trades.map(t => t.trade_date).sort()
                  return (
                    <tr key={name} style={{ opacity: selectedStocks.has(name) ? 1 : 0.4 }}>
                      <td>
                        <input type="checkbox" checked={selectedStocks.has(name)}
                          onChange={() => {
                            setSelectedStocks(prev => {
                              const next = new Set(prev)
                              if (next.has(name)) next.delete(name); else next.add(name)
                              return next
                            })
                          }} />
                      </td>
                      <td>{name}</td>
                      <td>
                        <input className="form-input" style={{ width: 90, fontSize: 11, padding: '2px 6px' }}
                          placeholder="A000000"
                          value={manualCodes[name] || ''}
                          onChange={e => setManualCodes(prev => ({ ...prev, [name]: e.target.value.trim() }))} />
                      </td>
                      <td className="text-center">{trades.length}</td>
                      <td className="text-center" style={{ color: 'var(--danger)' }}>{buys}</td>
                      <td className="text-center" style={{ color: 'var(--accent)' }}>{sells}</td>
                      <td className="text-center" style={{ fontSize: 12 }}>
                        {dates[0]?.slice(0, 10)} ~ {dates[dates.length - 1]?.slice(0, 10)}
                      </td>
                      <td className="text-center">
                        {!syncItem && '⏸️ 대기'}
                        {syncItem?.status === 'syncing' && '⏳ 진행중'}
                        {syncItem?.status === 'done' && `✅ ${syncItem.message}`}
                        {syncItem?.status === 'error' && `❌ ${syncItem.message}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 로그 */}
      {log.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>로그</h3>
          <div style={{ maxHeight: 300, overflow: 'auto', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8,
            background: 'var(--bg-secondary)', padding: 12, borderRadius: 6 }}>
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}
    </div>
  )
}
