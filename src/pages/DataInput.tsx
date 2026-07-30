import { useState, useEffect } from 'react'
import type { ParsedTrade, TradeInput, MonthlySummaryInput, TransferInput, ParsedKakaoItem, Trade, DividendInput, MonthlySummary } from '../types'
import { parseKakaoMessages, parseKakaoAll } from '../services/parser'
import { parseMiraeAssetCsv, parseMiraeMonthlyCSV, parseMiraeTransferCSV, parseMiraeForeignCsv, parseMiraeDividendsFromTransferCSV, tradesToCsv, holdingsToCsv } from '../services/csvService'

export default function DataInput() {
  const [activeTab, setActiveTab] = useState<'mirae' | 'foreign' | 'monthly' | 'table' | 'kakao' | 'manual' | 'transfer' | 'export'>('kakao')
  const [kakaoText, setKakaoText] = useState('')
  const [account, setAccount] = useState('')
  const [parsedResults, setParsedResults] = useState<ParsedTrade[]>([])
  const [kakaoResults, setKakaoResults] = useState<ParsedKakaoItem[]>([])
  const [saveStatus, setSaveStatus] = useState<string>('')

  // 최근 입력 매매내역
  const [recentTrades, setRecentTrades] = useState<Trade[]>([])
  const [showRecent, setShowRecent] = useState(true)

  // 등록된 계좌 목록
  const [accountList, setAccountList] = useState<string[]>([])

  // 다음 금융 자동 동기화
  const [daumReady, setDaumReady] = useState(false)
  const [daumChecking, setDaumChecking] = useState(true)

  // 카카오톡 자동 캡처
  const [captureStatus, setCaptureStatus] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [chatRoomName, setChatRoomName] = useState('미래에셋')
  const [captureMonths, setCaptureMonths] = useState<number>(7) // 중복 체크 기간 (일 단위)

  // 계좌 → 다음 금융 그룹 ID 매핑
  const accountGroupMap: Record<string, number> = {
    '72480': 4,   // [선근] 메인 → 그룹 4
    '18160': 5,   // [선근] ISA → 그룹 5
  }

  function getDaumGroupId(accountName: string): number | null {
    const match = accountName.match(/\((\d+)\)/)
    if (match) return accountGroupMap[match[1]] || null
    return null
  }

  // 미래에셋 CSV 가져오기
  const [miraeAccount, setMiraeAccount] = useState('')
  const [miraePreview, setMiraePreview] = useState<TradeInput[]>([])
  const [miraeFileName, setMiraeFileName] = useState('')

  // 월별 요약 가져오기
  const [monthlyAccount, setMonthlyAccount] = useState('')
  const [monthlyPreview, setMonthlyPreview] = useState<MonthlySummaryInput[]>([])
  const [monthlyFileName, setMonthlyFileName] = useState('')

  // 수동 월별 자산총액 입력
  const [monthlyAssetList, setMonthlyAssetList] = useState<MonthlySummary[]>([])
  const [manualMonthlyAccount, setManualMonthlyAccount] = useState('')
  const [manualMonth, setManualMonth] = useState(() => {
    const now = new Date()
    now.setMonth(now.getMonth() - 1)
    return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [manualEndAsset, setManualEndAsset] = useState<number>(0)

  // 해외주식 CSV 가져오기
  const [foreignAccount, setForeignAccount] = useState('')
  const [foreignPreview, setForeignPreview] = useState<TradeInput[]>([])
  const [foreignFileName, setForeignFileName] = useState('')

  // 입출금 내역 가져오기
  const [transferAccount, setTransferAccount] = useState('')
  const [transferPreview, setTransferPreview] = useState<TransferInput[]>([])
  const [transferFileName, setTransferFileName] = useState('')
  const [dividendPreview, setDividendPreview] = useState<DividendInput[]>([])
  const [transferReplace, setTransferReplace] = useState(false)

  // 수동 입출금 입력
  const [manualTransfer, setManualTransfer] = useState<TransferInput & { account: string }>({
    account: '', transfer_type: 'DEPOSIT', amount: 0, balance_after: 0,
    description: '', counterparty: '', transfer_date: new Date().toISOString().slice(0, 10)
  })

  // 테이블 붙여넣기 상태
  const [tableText, setTableText] = useState('')
  const [tableHeaders, setTableHeaders] = useState<string[]>([])
  const [tableRows, setTableRows] = useState<string[][]>([])
  const [tableMapping, setTableMapping] = useState<Record<string, number>>({
    trade_date: -1, stock_name: -1, trade_type: -1, quantity: -1, price: -1, fee: -1, tax: -1
  })
  const [tableParsed, setTableParsed] = useState<TradeInput[]>([])
  const [tableAccount, setTableAccount] = useState('')

  // CSV 내보내기
  const [exportType, setExportType] = useState<'trades' | 'holdings' | 'transfers' | 'dividends'>('trades')

  // 수동 입력 폼
  const [manualForm, setManualForm] = useState<TradeInput>({
    account: '', stock_name: '', trade_type: 'BUY',
    quantity: 0, price: 0, fee: 0, tax: 0,
    trade_date: new Date().toISOString().slice(0, 16), source: 'manual'
  })

  useEffect(() => {
    window.api.accounts.getAll().then(setAccountList).catch(() => {})
    loadRecentTrades()
    // 다음 금융 세션 쿠키 자동 확인
    initDaumSession()
  }, [])

  async function loadRecentTrades() {
    try {
      const all = await window.api.trades.getAll({})
      // created_at 기준 최신 10건
      const sorted = all.sort((a: Trade, b: Trade) => b.id - a.id).slice(0, 10)
      setRecentTrades(sorted)
    } catch { /* ignore */ }
  }

  async function loadMonthlyAssets(acctName?: string) {
    try {
      const data = await window.api.monthly.get(acctName || undefined)
      const sorted = data.sort((a: MonthlySummary, b: MonthlySummary) => b.month.localeCompare(a.month))
      setMonthlyAssetList(sorted)
    } catch { setMonthlyAssetList([]) }
  }

  async function initDaumSession() {
    setDaumChecking(true)
    try {
      // 저장된 쿠키 확인
      const savedCookie = await window.api.settings.get('daumCookie')
      if (savedCookie) {
        const check = await window.api.daum.checkCookie(savedCookie, 1)
        if (check.ok) { setDaumReady(true); setDaumChecking(false); return }
      }
      // 세션에서 쿠키 추출 시도
      const sessionResult = await window.api.daum.sessionCookie()
      if (sessionResult.success && sessionResult.cookie) {
        await window.api.settings.set('daumCookie', sessionResult.cookie)
        const check = await window.api.daum.checkCookie(sessionResult.cookie, 1)
        if (check.ok) { setDaumReady(true); setDaumChecking(false); return }
      }
      // 쿠키 없거나 만료 — 로그인 필요
      setDaumReady(false)
    } catch {
      setDaumReady(false)
    } finally {
      setDaumChecking(false)
    }
  }

  async function handleDaumLogin() {
    setDaumChecking(true)
    try {
      const result = await window.api.daum.login()
      if (result.success && result.cookie) {
        await window.api.settings.set('daumCookie', result.cookie)
        setDaumReady(true)
      } else {
        setDaumReady(false)
      }
    } catch {
      setDaumReady(false)
    } finally {
      setDaumChecking(false)
    }
  }

  // === 카카오톡 자동 캡처 ===
  async function handleKakaoCapture(mode?: string) {
    setCapturing(true)
    setCaptureStatus(mode === 'manual' ? '3초 후 캡처합니다. 카카오톡 대화창을 클릭하세요...' : '카카오톡 대화창을 찾는 중...')
    try {
      const result = await window.api.kakao.capture(chatRoomName, mode)
      if (!result.success) {
        setCaptureStatus(`❌ ${result.error}`)
        return
      }
      setCaptureStatus('텍스트 캡처 완료. 파싱 중...')
      const text = result.text || ''

      // 기존 파서로 파싱
      const allResults = parseKakaoAll(text, account)
      // 계좌 자동 매칭
      for (const r of allResults) {
        const acctNum = r._acctNum || ''
        if (acctNum) {
          const matched = matchAccount(acctNum)
          if (matched) r.account = matched
        }
        if (!r.account) r.account = account || accountList[0] || '기본계좌'
      }

      if (allResults.length === 0) {
        setCaptureStatus('❌ 파싱된 내역이 없습니다.')
        return
      }

      // 전체 처리 + 중복 체크 (선택한 기간 내 기존 데이터만 비교)
      const reversed = [...allResults].reverse()

      // 기간 계산: captureDays 일 전부터 오늘까지
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - captureMonths)
      const cutoffStr = cutoffDate.toISOString().slice(0, 10)

      const existingTrades = (await window.api.trades.getAll({}))
        .filter((t: any) => t.trade_date.slice(0, 10) >= cutoffStr)
      const existingDividends = (await window.api.dividends.getAll())
        .filter((d: any) => d.dividend_date.slice(0, 10) >= cutoffStr)
      const existingTransfers = (await window.api.transfers.getAll())
        .filter((t: any) => t.transfer_date.slice(0, 10) >= cutoffStr)

      let newCount = 0, skipCount = 0, oldSkipCount = 0

      for (const item of reversed) {
        if (!item.isValid) continue

        // 선택한 기간 밖의 메시지는 건너뛰기
        const itemDate = item.date?.slice(0, 10) || ''
        if (itemDate && itemDate < cutoffStr) {
          oldSkipCount++
          continue
        }

        let isDuplicate = false

        if (item.type === 'trade' && item.trade) {
          const r = item.trade
          const rDate = new Date(r.trade_date.slice(0, 10)).getTime()
          isDuplicate = existingTrades.some((t: any) => {
            // 계좌가 다르면 별개 거래 (메인/ISA에 같은 종목을 같은 수량·단가로 매수하는 경우가 있음)
            if (t.account !== item.account) return false
            if (t.stock_name !== r.stock_name || t.trade_type !== r.trade_type || t.quantity !== r.quantity || t.price !== r.price) return false
            const tDate = new Date(t.trade_date.slice(0, 10)).getTime()
            const dayDiff = Math.abs(tDate - rDate) / 86400000
            // 같은 소스면 같은 날짜만 중복, 다른 소스(csv↔kakao)면 ±2일까지 중복
            if (t.source === 'kakao') return dayDiff === 0
            return dayDiff <= 2
          })
        } else if (item.type === 'dividend' && item.dividend) {
          const d = item.dividend
          const dDate = new Date(item.date.slice(0, 10)).getTime()
          isDuplicate = existingDividends.some((e: any) => {
            if (e.account_name !== item.account) return false
            if (!((e.stock_code === d.stockCode || e.stock_name === d.stockName) && e.amount === d.amount)) return false
            const eDate = new Date(e.dividend_date.slice(0, 10)).getTime()
            return Math.abs(eDate - dDate) <= 2 * 86400000
          })
        } else if (item.type === 'transfer' && item.transfer) {
          const t = item.transfer
          const tDate = new Date(item.date.slice(0, 10)).getTime()
          isDuplicate = existingTransfers.some((e: any) => {
            // 계좌가 다르면 별개 입출금 (같은 날 메인/ISA에 같은 금액을 입금하는 경우가 있음)
            if (e.account_name !== item.account) return false
            if (e.transfer_type !== t.transferType || e.amount !== t.amount) return false
            const eDate = new Date(e.transfer_date.slice(0, 10)).getTime()
            return Math.abs(eDate - tDate) <= 2 * 86400000
          })
        }

        if (isDuplicate) {
          skipCount++
          continue
        }

        // 저장
        if (item.type === 'trade' && item.trade) {
          const r = item.trade
          const trade = {
            account: item.account, stock_name: r.stock_name, trade_type: r.trade_type,
            quantity: r.quantity, price: r.price, fee: 0, tax: 0,
            trade_date: r.trade_date, source: 'kakao' as const,
            stock_code: r._stockCode || undefined,
            currency: r._currency || undefined
          }
          const stockCode = r._stockCode || ''
          await window.api.trades.addWithHolding(trade, stockCode)

          // 다음 금융 자동 동기화
          if (daumReady && stockCode && !r._currency) {
            const gid = getDaumGroupId(item.account)
            if (gid) {
              try {
                await window.api.daum.syncTrade({
                  stockCode, stockName: r.stock_name, tradeType: r.trade_type,
                  price: r.price, quantity: r.quantity, tradeDate: r.trade_date, groupId: gid
                })
              } catch { /* 무시 */ }
            }
          }
        } else if (item.type === 'dividend' && item.dividend) {
          const d = item.dividend
          await window.api.dividends.addMany(item.account, [{
            stock_code: d.stockCode, stock_name: d.stockName,
            amount: d.amount, tax: d.tax || 0, net_amount: d.netAmount || d.amount,
            dividend_date: item.date, source: 'kakao' as const, currency: d.currency || undefined
          }])
        } else if (item.type === 'transfer' && item.transfer) {
          const t = item.transfer
          await window.api.transfers.addMany(item.account, [{
            transfer_type: t.transferType, amount: t.amount, balance_after: t.balanceAfter,
            description: t.description, counterparty: t.counterparty, transfer_date: item.date
          }])
        }
        newCount++
      }

      const parts = []
      if (newCount > 0) parts.push(`새로 ${newCount}건 저장`)
      if (skipCount > 0) parts.push(`중복 ${skipCount}건 건너뜀`)
      if (oldSkipCount > 0) parts.push(`기간 외 ${oldSkipCount}건 제외`)
      setCaptureStatus(`✅ ${parts.join(', ')}`)
      if (newCount > 0) loadRecentTrades()
    } catch (err) {
      setCaptureStatus(`❌ 캡처 실패: ${String(err)}`)
    } finally {
      setCapturing(false)
    }
  }

  // === 미래에셋 CSV 가져오기 ===
  async function handleMiraeSelectFile() {
    if (!miraeAccount) { setSaveStatus('계좌를 먼저 선택해주세요.'); return }
    try {
      const filePath = await window.api.dialog.openFile({
        filters: [{ name: 'CSV Files', extensions: ['csv'] }]
      })
      if (!filePath) return
      const content = await window.api.fs.readFile(filePath)
      const fileName = filePath.split(/[/\\]/).pop() || ''
      setMiraeFileName(fileName)
      const trades = parseMiraeAssetCsv(content, miraeAccount)
      setMiraePreview(trades)
      if (trades.length === 0) {
        setSaveStatus('파싱된 매매 내역이 없습니다. CSV 형식을 확인해주세요.')
      } else {
        const buyCount = trades.filter(t => t.trade_type === 'BUY').length
        const sellCount = trades.filter(t => t.trade_type === 'SELL').length
        setSaveStatus(`${fileName}: 총 ${trades.length}건 (매수 ${buyCount}, 매도 ${sellCount}) 파싱 완료`)
      }
    } catch (err) { setSaveStatus('파일 읽기 실패: ' + String(err)) }
  }

  async function handleMiraeImport() {
    if (miraePreview.length === 0) return
    try {
      const count = await window.api.trades.addMany(miraePreview)
      setSaveStatus(`${count}건 가져오기 완료!`)
      setMiraePreview([]); setMiraeFileName('')
      loadRecentTrades()
    } catch (err) { setSaveStatus('가져오기 실패: ' + String(err)) }
  }

  // === 해외주식 CSV 가져오기 ===
  async function handleForeignSelectFile() {
    if (!foreignAccount) { setSaveStatus('계좌를 먼저 선택해주세요.'); return }
    try {
      const filePath = await window.api.dialog.openFile({
        filters: [{ name: 'CSV Files', extensions: ['csv'] }]
      })
      if (!filePath) return
      const content = await window.api.fs.readFile(filePath)
      const fileName = filePath.split(/[/\\]/).pop() || ''
      setForeignFileName(fileName)
      const trades = parseMiraeForeignCsv(content, foreignAccount)
      setForeignPreview(trades)
      if (trades.length === 0) {
        setSaveStatus('파싱된 매매 내역이 없습니다. CSV 형식을 확인해주세요.')
      } else {
        const buyCount = trades.filter(t => t.trade_type === 'BUY').length
        const sellCount = trades.filter(t => t.trade_type === 'SELL').length
        setSaveStatus(`${fileName}: 총 ${trades.length}건 (매수 ${buyCount}, 매도 ${sellCount}) 파싱 완료`)
      }
    } catch (err) { setSaveStatus('파일 읽기 실패: ' + String(err)) }
  }

  async function handleForeignImport() {
    if (foreignPreview.length === 0) return
    try {
      const count = await window.api.trades.addMany(foreignPreview)
      setSaveStatus(`${count}건 가져오기 완료!`)
      setForeignPreview([]); setForeignFileName('')
      loadRecentTrades()
    } catch (err) { setSaveStatus('가져오기 실패: ' + String(err)) }
  }

  // === 월별 요약 가져오기 ===
  async function handleMonthlySelectFile() {
    if (!monthlyAccount) { setSaveStatus('계좌를 먼저 선택해주세요.'); return }
    try {
      const filePath = await window.api.dialog.openFile({
        filters: [{ name: 'CSV Files', extensions: ['csv'] }]
      })
      if (!filePath) return
      const content = await window.api.fs.readFile(filePath)
      const fileName = filePath.split(/[/\\]/).pop() || ''
      setMonthlyFileName(fileName)
      const items = parseMiraeMonthlyCSV(content)
      setMonthlyPreview(items)
      if (items.length === 0) {
        setSaveStatus('파싱된 월별 데이터가 없습니다.')
      } else {
        setSaveStatus(`${fileName}: ${items.length}개월 데이터 파싱 완료`)
      }
    } catch (err) { setSaveStatus('파일 읽기 실패: ' + String(err)) }
  }

  async function handleMonthlyImport() {
    if (monthlyPreview.length === 0) return
    try {
      const count = await window.api.monthly.set(monthlyAccount, monthlyPreview)
      setSaveStatus(`${monthlyAccount} 계좌에 ${count}개월 데이터 등록 완료!`)
      setMonthlyPreview([]); setMonthlyFileName('')
    } catch (err) { setSaveStatus('가져오기 실패: ' + String(err)) }
  }

  // === 입출금 내역 가져오기 ===
  async function handleTransferSelectFile() {
    if (!transferAccount) { setSaveStatus('계좌를 먼저 선택해주세요.'); return }
    try {
      const filePath = await window.api.dialog.openFile({
        filters: [{ name: 'CSV Files', extensions: ['csv'] }]
      })
      if (!filePath) return
      const content = await window.api.fs.readFile(filePath)
      const fileName = filePath.split(/[/\\]/).pop() || ''
      setTransferFileName(fileName)
      const items = parseMiraeTransferCSV(content)
      const divItems = parseMiraeDividendsFromTransferCSV(content)
      setTransferPreview(items)
      setDividendPreview(divItems)
      const parts: string[] = []
      if (items.length > 0) {
        const deposits = items.filter(t => t.transfer_type === 'DEPOSIT')
        const withdraws = items.filter(t => t.transfer_type === 'WITHDRAW')
        const depTotal = deposits.reduce((s, t) => s + t.amount, 0)
        const wdTotal = withdraws.reduce((s, t) => s + t.amount, 0)
        parts.push(`입출금 ${items.length}건 (입금 ${deposits.length}건 ${depTotal.toLocaleString()}원, 출금 ${withdraws.length}건 ${wdTotal.toLocaleString()}원)`)
      }
      if (divItems.length > 0) {
        const divTotal = divItems.reduce((s, d) => s + d.net_amount, 0)
        parts.push(`배당금 ${divItems.length}건 (${divTotal.toLocaleString()}원)`)
      }
      setSaveStatus(parts.length > 0 ? `${fileName}: ${parts.join(', ')}` : '파싱된 내역이 없습니다. CSV 형식을 확인해주세요.')
    } catch (err) { setSaveStatus('파일 읽기 실패: ' + String(err)) }
  }

  async function handleTransferImport() {
    if (transferPreview.length === 0 && dividendPreview.length === 0) return
    try {
      const parts: string[] = []
      // 기존 데이터 삭제 후 재등록
      if (transferReplace) {
        await window.api.transfers.delete(transferAccount)
        await window.api.dividends.delete(transferAccount)
        parts.push('기존 삭제')
      }
      if (transferPreview.length > 0) {
        const count = await window.api.transfers.addMany(transferAccount, transferPreview)
        parts.push(`입출금 ${count}건`)
      }
      if (dividendPreview.length > 0) {
        const divCount = await window.api.dividends.addMany(transferAccount, dividendPreview)
        parts.push(`배당금 ${divCount}건`)
      }
      setSaveStatus(`${transferAccount} 계좌에 ${parts.join(', ')} 등록 완료!`)
      setTransferPreview([]); setDividendPreview([]); setTransferFileName('')
    } catch (err) { setSaveStatus('가져오기 실패: ' + String(err)) }
  }

  async function handleManualTransferSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!manualTransfer.account || manualTransfer.amount <= 0) {
      setSaveStatus('계좌와 금액을 입력해주세요.'); return
    }
    try {
      const { account, ...item } = manualTransfer
      await window.api.transfers.addMany(account, [item])
      setSaveStatus(`${account} 계좌에 ${manualTransfer.transfer_type === 'DEPOSIT' ? '입금' : '출금'} ${manualTransfer.amount.toLocaleString()}원 등록 완료!`)
      setManualTransfer({ ...manualTransfer, amount: 0, balance_after: 0, description: '', counterparty: '' })
    } catch (err) { setSaveStatus('등록 실패: ' + String(err)) }
  }

  // 계좌 선택 드롭다운
  function AccountSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
      <select className="form-select" value={value} onChange={e => onChange(e.target.value)} style={{ maxWidth: 350 }}>
        <option value="">-- 계좌 선택 --</option>
        {accountList.map(a => <option key={a} value={a}>{a}</option>)}
      </select>
    )
  }

  // === 테이블 붙여넣기 ===
  function handleTableParse() {
    if (!tableText.trim()) return
    const lines = tableText.trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) {
      setSaveStatus('최소 2줄 이상 필요합니다 (헤더 + 데이터)')
      return
    }

    // 탭 또는 여러 공백으로 구분
    const delimiter = lines[0].includes('\t') ? '\t' : /\s{2,}/
    const headers = lines[0].split(delimiter).map(h => h.trim()).filter(Boolean)
    const rows = lines.slice(1).map(l => l.split(delimiter).map(c => c.trim())).filter(r => r.length >= 2)

    setTableHeaders(headers)
    setTableRows(rows)

    // 자동 컬럼 매핑 시도
    const mapping: Record<string, number> = {
      trade_date: -1, stock_name: -1, trade_type: -1, quantity: -1, price: -1, fee: -1, tax: -1
    }
    headers.forEach((h, i) => {
      const lower = h.toLowerCase()
      if (/일자|일시|날짜|date|체결일|거래일/.test(lower)) mapping.trade_date = i
      else if (/종목명|종목|stock|name|상품명/.test(lower)) mapping.stock_name = i
      else if (/구분|매수|매도|type|거래구분|매매구분/.test(lower)) mapping.trade_type = i
      else if (/수량|quantity|체결수량|거래수량/.test(lower)) mapping.quantity = i
      else if (/단가|가격|price|체결가|체결단가/.test(lower)) mapping.price = i
      else if (/수수료|fee|commission/.test(lower)) mapping.fee = i
      else if (/세금|tax/.test(lower)) mapping.tax = i
    })
    setTableMapping(mapping)
    setSaveStatus(`${headers.length}개 컬럼, ${rows.length}건 감지됨. 컬럼 매핑을 확인해주세요.`)
  }

  function handleTableConvert() {
    const trades: TradeInput[] = []
    for (const row of tableRows) {
      try {
        const rawType = tableMapping.trade_type >= 0 ? row[tableMapping.trade_type] || '' : ''
        let tradeType: 'BUY' | 'SELL' = 'BUY'
        if (/매도|sell|출금/i.test(rawType)) tradeType = 'SELL'

        const rawQty = tableMapping.quantity >= 0 ? row[tableMapping.quantity] || '0' : '0'
        const rawPrice = tableMapping.price >= 0 ? row[tableMapping.price] || '0' : '0'
        const qty = parseInt(rawQty.replace(/[^0-9]/g, '')) || 0
        const price = parseFloat(rawPrice.replace(/[^0-9.]/g, '')) || 0

        if (qty <= 0 || price <= 0) continue

        const stockName = tableMapping.stock_name >= 0 ? row[tableMapping.stock_name] || '' : ''
        if (!stockName) continue

        const rawDate = tableMapping.trade_date >= 0 ? row[tableMapping.trade_date] || '' : ''
        const tradeDate = rawDate.replace(/\//g, '-') || new Date().toISOString().slice(0, 10)

        const rawFee = tableMapping.fee >= 0 ? row[tableMapping.fee] || '0' : '0'
        const rawTax = tableMapping.tax >= 0 ? row[tableMapping.tax] || '0' : '0'

        trades.push({
          account: tableAccount,
          stock_name: stockName.trim(),
          trade_type: tradeType,
          quantity: qty,
          price,
          fee: parseFloat(rawFee.replace(/[^0-9.]/g, '')) || 0,
          tax: parseFloat(rawTax.replace(/[^0-9.]/g, '')) || 0,
          trade_date: tradeDate,
          source: 'manual'
        })
      } catch { /* skip */ }
    }
    setTableParsed(trades)
    setSaveStatus(trades.length > 0 ? `${trades.length}건 변환 완료. 확인 후 저장해주세요.` : '변환된 내역이 없습니다. 컬럼 매핑을 확인해주세요.')
  }

  async function handleTableSave() {
    if (tableParsed.length === 0) return
    try {
      const count = await window.api.trades.addMany(tableParsed)
      setSaveStatus(`${count}건 저장 완료!`)
      setTableText(''); setTableHeaders([]); setTableRows([]); setTableParsed([])
      loadRecentTrades()
    } catch (err) {
      setSaveStatus('저장 실패: ' + String(err))
    }
  }

  // === 카카오톡 ===
  // 계좌번호에서 숫자만 추출
  function extractDigits(s: string): string {
    return s.replace(/[^0-9]/g, '')
  }

  // 카카오톡 마스킹 계좌번호 → 계좌명 직접 매핑
  // 카카오톡에서 오는 형식: "784-06**-**48-0", "244-62**-**16-0" 등
  const acctNumMap: Record<string, string> = {
    '784-06**-**48-0': '[선근] 메인 (72480)',
    '244-62**-**16-0': '[선근] ISA (18160)',
    '010-41**-**41-0': '[선근] 미국 (40410)',
    '010-41**-**63-0': '[다인] 통합 (39630)',
  }

  // 카카오톡 계좌번호로 등록된 계좌 자동 매칭
  function matchAccount(acctNum: string): string {
    if (!acctNum || accountList.length === 0) return account || ''

    // 1. 직접 매핑 테이블에서 찾기
    if (acctNumMap[acctNum]) {
      const mapped = acctNumMap[acctNum]
      if (accountList.includes(mapped)) return mapped
    }

    // 2. 계좌번호에서 보이는 숫자들 추출 (마스킹 제외)
    const visibleDigits = extractDigits(acctNum.replace(/\*/g, ''))
    // 등록된 계좌명에서 괄호 안 숫자와 매칭
    for (const name of accountList) {
      const match = name.match(/\((\d+)\)/)
      if (match) {
        const acctDigits = match[1]
        if (visibleDigits.includes(acctDigits) || acctDigits.includes(visibleDigits.slice(-4))) {
          return name
        }
      }
      const nameDigits = extractDigits(name)
      if (nameDigits && visibleDigits.length >= 3 && nameDigits.includes(visibleDigits.slice(-5))) {
        return name
      }
    }
    return account || accountList[0] || ''
  }

  function handleParse() {
    if (!kakaoText.trim()) return
    // 통합 파서: 매매 + 배당 + 입출금
    const allResults = parseKakaoAll(kakaoText, account)
    // 계좌 자동 매칭
    for (const r of allResults) {
      const acctNum = r._acctNum || ''
      if (acctNum) {
        const matched = matchAccount(acctNum)
        if (matched) r.account = matched
      }
      if (!r.account) r.account = account || accountList[0] || '기본계좌'
    }
    setKakaoResults(allResults)

    // 기존 parsedResults도 매매 건만 유지 (하위 호환)
    const tradeResults = allResults
      .filter(r => r.type === 'trade' && r.trade)
      .map(r => r.trade!)
    setParsedResults(tradeResults)

    const tradeCount = allResults.filter(r => r.type === 'trade').length
    const dividendCount = allResults.filter(r => r.type === 'dividend').length
    const transferCount = allResults.filter(r => r.type === 'transfer').length
    const parts = []
    if (tradeCount > 0) parts.push(`매매 ${tradeCount}건`)
    if (dividendCount > 0) parts.push(`배당 ${dividendCount}건`)
    if (transferCount > 0) parts.push(`입출금 ${transferCount}건`)
    setSaveStatus(parts.length > 0 ? `${parts.join(', ')} 파싱 완료` : '파싱된 내역이 없습니다.')
  }

  async function handleSaveParsed() {
    if (kakaoResults.length === 0) return
    try {
      let tradeCount = 0, dividendCount = 0, transferCount = 0, daumSyncCount = 0

      for (const item of kakaoResults) {
        if (!item.isValid) continue

        if (item.type === 'trade' && item.trade) {
          const r = item.trade
          const trade: TradeInput = {
            account: item.account, stock_name: r.stock_name, trade_type: r.trade_type,
            quantity: r.quantity, price: r.price, fee: 0, tax: 0,
            trade_date: r.trade_date, source: 'kakao',
            stock_code: r._stockCode || undefined,
            currency: r._currency || undefined,
            raw_message: kakaoText
          }
          const stockCode = r._stockCode || ''
          await window.api.trades.addWithHolding(trade, stockCode)
          tradeCount++

          // 다음 금융 자동 동기화 (메인/ISA 계좌 + 국내주식만)
          if (daumReady && stockCode && !r._currency) {
            const gid = getDaumGroupId(item.account)
            if (gid) {
              try {
                const syncResult = await window.api.daum.syncTrade({
                  stockCode, stockName: r.stock_name, tradeType: r.trade_type,
                  price: r.price, quantity: r.quantity, tradeDate: r.trade_date, groupId: gid
                })
                if (syncResult.success) {
                  daumSyncCount++
                }
              } catch { /* 동기화 실패해도 무시 */ }
            }
          }
        } else if (item.type === 'dividend' && item.dividend) {
          const d = item.dividend
          await window.api.dividends.addMany(item.account, [{
            stock_code: d.stockCode,
            stock_name: d.stockName,
            amount: d.amount,
            tax: d.tax || 0,
            net_amount: d.netAmount || d.amount,
            dividend_date: item.date,
            source: 'kakao',
            currency: d.currency || undefined
          }])
          dividendCount++
        } else if (item.type === 'transfer' && item.transfer) {
          const t = item.transfer
          await window.api.transfers.addMany(item.account, [{
            transfer_type: t.transferType,
            amount: t.amount,
            balance_after: t.balanceAfter,
            description: t.description,
            counterparty: t.counterparty,
            transfer_date: item.date
          }])
          transferCount++
        }
      }

      const parts = []
      if (tradeCount > 0) parts.push(`매매 ${tradeCount}건`)
      if (dividendCount > 0) parts.push(`배당 ${dividendCount}건`)
      if (transferCount > 0) parts.push(`입출금 ${transferCount}건`)
      if (daumSyncCount > 0) parts.push(`다음동기화 ${daumSyncCount}건`)
      setSaveStatus(`${parts.join(', ')} 저장 완료!`)
      setKakaoText(''); setParsedResults([]); setKakaoResults([])
      loadRecentTrades()
    } catch (err) { setSaveStatus('저장 실패: ' + String(err)) }
  }

  // === CSV 내보내기 ===
  async function handleExport() {
    try {
      let csvContent = ''
      let defaultName = ''
      if (exportType === 'trades') {
        const trades = await window.api.trades.getAll({})
        csvContent = tradesToCsv(trades)
        defaultName = `매매내역_${new Date().toISOString().slice(0, 10)}.csv`
      } else if (exportType === 'holdings') {
        const computed = await window.api.holdings.computeFromTrades()
        const mapped = computed.map((h: any) => ({ account: h.account, stockName: h.stock_name || h.stockName, quantity: h.quantity, avgPrice: h.avgPrice, totalCost: h.totalCost }))
        csvContent = holdingsToCsv(mapped)
        defaultName = `포트폴리오_${new Date().toISOString().slice(0, 10)}.csv`
      } else if (exportType === 'transfers') {
        const transfers = await window.api.transfers.getAll()
        const headers = ['일자', '계좌', '구분', '금액', '예수금', '설명', '상대']
        const rows = transfers.map((t: any) => [t.transfer_date, t.account_name, t.transfer_type === 'DEPOSIT' ? '입금' : '출금', t.amount, t.balance_after, t.description, t.counterparty])
        csvContent = [headers.join(','), ...rows.map((r: any[]) => r.join(','))].join('\n')
        defaultName = `입출금내역_${new Date().toISOString().slice(0, 10)}.csv`
      } else if (exportType === 'dividends') {
        const dividends = await window.api.dividends.getAll()
        const headers = ['일자', '계좌', '종목코드', '종목명', '세전', '세금', '세후', '출처']
        const rows = dividends.map((d: any) => [d.dividend_date, d.account_name, d.stock_code, d.stock_name, d.amount, d.tax, d.net_amount, d.source])
        csvContent = [headers.join(','), ...rows.map((r: any[]) => r.join(','))].join('\n')
        defaultName = `배당금내역_${new Date().toISOString().slice(0, 10)}.csv`
      }
      if (!csvContent) { setSaveStatus('내보낼 데이터가 없습니다.'); return }
      const filePath = await window.api.dialog.saveFile({ defaultPath: defaultName, filters: [{ name: 'CSV Files', extensions: ['csv'] }] })
      if (!filePath) return
      await window.api.fs.writeFile(filePath, '\uFEFF' + csvContent)
      setSaveStatus(`${defaultName} 내보내기 완료!`)
    } catch (err) { setSaveStatus('내보내기 실패: ' + String(err)) }
  }

  // === 수동 입력 ===
  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!manualForm.stock_name || manualForm.quantity <= 0) {
      setSaveStatus('종목명과 수량을 입력해주세요.'); return
    }
    try {
      await window.api.trades.add(manualForm)
      setSaveStatus('매매 내역이 추가되었습니다.')
      setManualForm({ ...manualForm, stock_name: '', quantity: 0, price: 0, fee: 0, tax: 0, trade_date: new Date().toISOString().slice(0, 16) })
      loadRecentTrades()
    } catch (err) { setSaveStatus('저장 실패: ' + String(err)) }
  }

  function updateParsedResult(index: number, field: string, value: any) {
    setParsedResults(prev => prev.map((r, i) => {
      if (i !== index) return r
      const updated = { ...r, [field]: value }
      updated.isValid = !!(updated.stock_name && updated.quantity > 0 && updated.price > 0)
      return updated
    }))
  }

  const fieldLabels: Record<string, string> = {
    trade_date: '체결일시', stock_name: '종목명', trade_type: '매수/매도',
    quantity: '수량', price: '단가', fee: '수수료', tax: '세금'
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">데이터 입력</h1>
        <p className="page-subtitle">증권사 웹에서 복사하거나, 카카오톡 알림, 수동 입력으로 매매 내역을 등록합니다</p>
      </div>

      <div className="tabs">
        <div className={`tab ${activeTab === 'kakao' ? 'active' : ''}`} onClick={() => { setActiveTab('kakao'); setSaveStatus('') }}>
          📱 카카오톡 알림
        </div>
        <div className={`tab ${activeTab === 'mirae' ? 'active' : ''}`} onClick={() => { setActiveTab('mirae'); setSaveStatus('') }}>
          🏦 미래에셋 CSV
        </div>
        <div className={`tab ${activeTab === 'foreign' ? 'active' : ''}`} onClick={() => { setActiveTab('foreign'); setSaveStatus('') }}>
          🌍 해외주식 CSV
        </div>
        <div className={`tab ${activeTab === 'monthly' ? 'active' : ''}`} onClick={() => { setActiveTab('monthly'); setSaveStatus('') }}>
          📊 월별 요약
        </div>
        <div className={`tab ${activeTab === 'transfer' ? 'active' : ''}`} onClick={() => { setActiveTab('transfer'); setSaveStatus('') }}>
          💰 입출금
        </div>
        <div className={`tab ${activeTab === 'table' ? 'active' : ''}`} onClick={() => { setActiveTab('table'); setSaveStatus('') }}>
          📋 웹 테이블 붙여넣기
        </div>
        <div className={`tab ${activeTab === 'manual' ? 'active' : ''}`} onClick={() => { setActiveTab('manual'); setSaveStatus('') }}>
          ✏️ 수동 입력
        </div>
        <div className={`tab ${activeTab === 'export' ? 'active' : ''}`} onClick={() => { setActiveTab('export'); setSaveStatus('') }}>
          📤 내보내기
        </div>
      </div>

      {saveStatus && (
        <div style={{
          padding: '10px 16px', marginBottom: 16, borderRadius: 6,
          background: saveStatus.includes('실패') ? 'rgba(224,49,49,0.1)' : 'rgba(43,138,62,0.1)',
          color: saveStatus.includes('실패') ? 'var(--danger)' : 'var(--success)', fontSize: 14
        }}>{saveStatus}</div>
      )}

      {/* ===== 미래에셋 CSV 탭 ===== */}
      {activeTab === 'mirae' && (
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>미래에셋증권 매매내역 CSV 가져오기</h3>
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 6, background: 'rgba(66,99,235,0.06)', fontSize: 13, lineHeight: 1.7 }}>
            미래에셋증권 → 주식 → 매매내역 → 기간 설정 후 조회 → CSV 다운로드<br />
            한 행에 매수/매도가 같이 있는 형식을 자동으로 파싱합니다.
          </div>
          <div className="form-group">
            <label className="form-label">계좌 선택 *</label>
            <AccountSelect value={miraeAccount} onChange={setMiraeAccount} />
            {accountList.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                계좌 잔고 페이지에서 먼저 계좌를 등록해주세요.
              </div>
            )}
          </div>
          <div className="btn-group mt-8">
            <button className="btn btn-outline" onClick={handleMiraeSelectFile} disabled={!miraeAccount}>
              📂 CSV 파일 선택
            </button>
            {miraeFileName && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{miraeFileName}</span>}
          </div>
          {miraePreview.length > 0 && (
            <div className="mt-16">
              <div className="flex-between mb-8">
                <h3 style={{ fontSize: 15 }}>미리보기 (상위 20건)</h3>
                <button className="btn btn-success" onClick={handleMiraeImport}>
                  💾 {miraePreview.length}건 가져오기
                </button>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr><th>일자</th><th>종목</th><th className="text-center">구분</th><th className="text-right">수량</th><th className="text-right">단가</th><th className="text-right">체결금액</th><th className="text-right">수수료</th></tr>
                  </thead>
                  <tbody>
                    {miraePreview.slice(0, 20).map((t, i) => (
                      <tr key={i}>
                        <td>{t.trade_date}</td><td>{t.stock_name}</td>
                        <td className="text-center"><span className={`badge ${t.trade_type === 'BUY' ? 'badge-buy' : 'badge-sell'}`}>{t.trade_type === 'BUY' ? '매수' : '매도'}</span></td>
                        <td className="text-right">{t.quantity.toLocaleString()}</td>
                        <td className="text-right">{t.price.toLocaleString()}</td>
                        <td className="text-right">{(t.quantity * t.price).toLocaleString()}</td>
                        <td className="text-right">{t.fee.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {miraePreview.length > 20 && (
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>... 외 {miraePreview.length - 20}건</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== 해외주식 CSV 탭 ===== */}
      {activeTab === 'foreign' && (
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>미래에셋증권 해외주식 매매내역 CSV 가져오기</h3>
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 6, background: 'rgba(66,99,235,0.06)', fontSize: 13, lineHeight: 1.7 }}>
            미래에셋증권 HTS → 해외주식 → 매매내역 → 기간 설정 후 조회 → CSV 다운로드<br />
            매매일, 종목번호, 종목명, 매수/매도 단가·수량, 수수료, 세금을 자동 파싱합니다.
          </div>
          <div className="form-group">
            <label className="form-label">계좌 선택 *</label>
            <AccountSelect value={foreignAccount} onChange={setForeignAccount} />
          </div>
          <div className="btn-group mt-8">
            <button className="btn btn-outline" onClick={handleForeignSelectFile} disabled={!foreignAccount}>
              📂 CSV 파일 선택
            </button>
            {foreignFileName && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{foreignFileName}</span>}
          </div>
          {foreignPreview.length > 0 && (
            <div className="mt-16">
              <div className="flex-between mb-8">
                <h3 style={{ fontSize: 15 }}>미리보기 (상위 20건)</h3>
                <button className="btn btn-success" onClick={handleForeignImport}>
                  💾 {foreignPreview.length}건 가져오기
                </button>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr><th>일자</th><th>통화</th><th>종목코드</th><th>종목</th><th className="text-center">구분</th><th className="text-right">수량</th><th className="text-right">단가</th><th className="text-right">금액</th><th className="text-right">환율</th><th className="text-right">수수료</th><th className="text-right">세금</th></tr>
                  </thead>
                  <tbody>
                    {foreignPreview.slice(0, 20).map((t, i) => (
                      <tr key={i}>
                        <td>{t.trade_date}</td>
                        <td>{t.currency || 'USD'}</td>
                        <td style={{ fontSize: 12 }}>{t.stock_code || '-'}</td>
                        <td>{t.stock_name}</td>
                        <td className="text-center"><span className={`badge ${t.trade_type === 'BUY' ? 'badge-buy' : 'badge-sell'}`}>{t.trade_type === 'BUY' ? '매수' : '매도'}</span></td>
                        <td className="text-right">{t.quantity.toLocaleString()}</td>
                        <td className="text-right">{t.price.toLocaleString()}</td>
                        <td className="text-right">{(t.quantity * t.price).toLocaleString()}</td>
                        <td className="text-right">{t.exchange_rate ? t.exchange_rate.toLocaleString() : '-'}</td>
                        <td className="text-right">{t.fee.toLocaleString()}</td>
                        <td className="text-right">{t.tax.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {foreignPreview.length > 20 && (
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>... 외 {foreignPreview.length - 20}건</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== 월별 요약 탭 ===== */}
      {activeTab === 'monthly' && (
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>미래에셋증권 월별 요약 CSV 가져오기</h3>
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 6, background: 'rgba(66,99,235,0.06)', fontSize: 13, lineHeight: 1.7 }}>
            미래에셋증권 HTS → 계좌 → 기간손익 → 월별 조회 → CSV 다운로드<br />
            월초자산, 월말자산, 매수/매도, 매매비용, 평가손익, 실현손익, 총손익 데이터를 가져옵니다.
          </div>
          <div className="form-group">
            <label className="form-label">계좌 선택 *</label>
            <AccountSelect value={monthlyAccount} onChange={setMonthlyAccount} />
            {accountList.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                계좌 잔고 페이지에서 먼저 계좌를 등록해주세요.
              </div>
            )}
          </div>
          <div className="btn-group mt-8">
            <button className="btn btn-outline" onClick={handleMonthlySelectFile} disabled={!monthlyAccount}>
              📂 CSV 파일 선택
            </button>
            {monthlyFileName && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{monthlyFileName}</span>}
          </div>
          {monthlyPreview.length > 0 && (
            <div className="mt-16">
              <div className="flex-between mb-8">
                <h3 style={{ fontSize: 15 }}>미리보기 ({monthlyPreview.length}개월)</h3>
                <button className="btn btn-success" onClick={handleMonthlyImport}>
                  💾 {monthlyPreview.length}개월 데이터 등록
                </button>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>월</th>
                      <th className="text-right">월초자산</th>
                      <th className="text-right">월말자산</th>
                      <th className="text-right">매수</th>
                      <th className="text-right">매도</th>
                      <th className="text-right">매매비용</th>
                      <th className="text-right">평가손익</th>
                      <th className="text-right">실현손익</th>
                      <th className="text-right">총손익</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyPreview.map((m, i) => (
                      <tr key={i}>
                        <td>{m.month}</td>
                        <td className="text-right">{m.start_asset.toLocaleString()}</td>
                        <td className="text-right">{m.end_asset.toLocaleString()}</td>
                        <td className="text-right">{m.buy_amount.toLocaleString()}</td>
                        <td className="text-right">{m.sell_amount.toLocaleString()}</td>
                        <td className="text-right">{m.fee.toLocaleString()}</td>
                        <td className="text-right" style={{ color: m.eval_pnl >= 0 ? 'var(--danger)' : 'var(--accent)' }}>
                          {m.eval_pnl.toLocaleString()}
                        </td>
                        <td className="text-right" style={{ color: m.realized_pnl >= 0 ? 'var(--danger)' : 'var(--accent)' }}>
                          {m.realized_pnl.toLocaleString()}
                        </td>
                        <td className="text-right" style={{ color: m.total_pnl >= 0 ? 'var(--danger)' : 'var(--accent)', fontWeight: 600 }}>
                          {m.total_pnl.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 수동 월별 자산총액 입력 */}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 24, paddingTop: 20 }}>
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>수동 월말 자산총액 입력</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              매월 마지막 거래일의 자산총액(주식평가액 + 예수금)을 직접 입력합니다. 수익률 계산의 기준이 됩니다.
            </p>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">계좌 *</label>
                <AccountSelect value={manualMonthlyAccount} onChange={v => { setManualMonthlyAccount(v); if (v) loadMonthlyAssets(v) }} />
              </div>
              <div className="form-group">
                <label className="form-label">월 (YYYY/MM) *</label>
                <input className="form-input" value={manualMonth}
                  onChange={e => setManualMonth(e.target.value)}
                  placeholder="2026/02" style={{ maxWidth: 150 }} />
              </div>
              <div className="form-group">
                <label className="form-label">월말 자산총액 *</label>
                <input type="number" className="form-input" value={manualEndAsset || ''}
                  onChange={e => setManualEndAsset(parseInt(e.target.value) || 0)}
                  placeholder="300,000,000" />
              </div>
            </div>
            <button className="btn btn-primary mt-8"
              disabled={!manualMonthlyAccount || !manualMonth || manualEndAsset <= 0}
              onClick={async () => {
                try {
                  await window.api.monthly.upsert(manualMonthlyAccount, manualMonth, 0, manualEndAsset)
                  setSaveStatus(`${manualMonthlyAccount} ${manualMonth} 월말 자산총액 ${manualEndAsset.toLocaleString()}원 등록 완료`)
                  setManualEndAsset(0)
                  loadMonthlyAssets(manualMonthlyAccount)
                } catch (err) { setSaveStatus('등록 실패: ' + String(err)) }
              }}>
              💾 자산총액 등록
            </button>
          </div>

          {/* 등록된 월별 자산총액 내역 */}
          {manualMonthlyAccount && monthlyAssetList.filter(m => m.account_name === manualMonthlyAccount).length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 24, paddingTop: 20 }}>
              <h3 style={{ fontSize: 15, marginBottom: 12 }}>
                📊 {manualMonthlyAccount} 월별 자산총액 ({monthlyAssetList.filter(m => m.account_name === manualMonthlyAccount).length}개월)
              </h3>
              <div className="table-container" style={{ fontSize: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>월</th>
                      <th className="text-right">월초 자산</th>
                      <th className="text-right">월말 자산</th>
                      <th className="text-right">증감</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyAssetList
                      .filter(m => m.account_name === manualMonthlyAccount)
                      .map(m => {
                        const diff = m.end_asset - m.start_asset
                        return (
                          <tr key={m.id}>
                            <td>{m.month}</td>
                            <td className="text-right">{m.start_asset.toLocaleString()}원</td>
                            <td className="text-right">{m.end_asset.toLocaleString()}원</td>
                            <td className="text-right" style={{ color: diff >= 0 ? 'var(--danger)' : 'var(--accent)' }}>
                              {diff >= 0 ? '+' : ''}{diff.toLocaleString()}원
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== 웹 테이블 붙여넣기 탭 ===== */}
      {activeTab === 'table' && (
        <div className="card">
          <div style={{ padding: '12px 16px', marginBottom: 16, borderRadius: 6, background: 'rgba(66,99,235,0.06)', fontSize: 13, lineHeight: 1.7 }}>
            💡 <span style={{ fontWeight: 600 }}>사용법:</span> 미래에셋 등 증권사 웹에서 거래내역 테이블을 마우스로 드래그 선택 → Ctrl+C 복사 → 아래 텍스트 영역에 Ctrl+V 붙여넣기
          </div>

          <div className="form-group">
            <label className="form-label">계좌 구분</label>
            <AccountSelect value={tableAccount} onChange={setTableAccount} />
          </div>

          <div className="form-group">
            <label className="form-label">테이블 데이터 붙여넣기</label>
            <textarea className="form-textarea" value={tableText} onChange={e => setTableText(e.target.value)}
              placeholder={`증권사 웹에서 거래내역 테이블을 복사해서 붙여넣으세요.\n\n예시 (탭으로 구분됨):\n체결일자\t종목명\t매매구분\t수량\t체결단가\t체결금액\n2024-01-15\t삼성전자\t매수\t10\t71,500\t715,000\n2024-01-16\t카카오\t매도\t5\t52,300\t261,500`}
              style={{ minHeight: 200, fontFamily: 'monospace', fontSize: 13 }} />
          </div>

          <button className="btn btn-primary" onClick={handleTableParse} disabled={!tableText.trim()}>
            🔍 테이블 분석하기
          </button>

          {/* 컬럼 매핑 */}
          {tableHeaders.length > 0 && (
            <div className="mt-16">
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>감지된 컬럼: {tableHeaders.join(' | ')}</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                각 필드에 맞는 컬럼을 선택해주세요. 자동 매핑된 결과를 확인하고 필요시 수정하세요.
              </p>
              <div className="form-row">
                {Object.entries(fieldLabels).map(([field, label]) => (
                  <div className="form-group" key={field}>
                    <label className="form-label">{label}</label>
                    <select className="form-select" value={tableMapping[field] ?? -1}
                      onChange={e => setTableMapping({ ...tableMapping, [field]: parseInt(e.target.value) })}>
                      <option value={-1}>(없음)</option>
                      {tableHeaders.map((h, i) => <option key={i} value={i}>{i}: {h}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <div className="btn-group mt-16">
                <button className="btn btn-primary" onClick={handleTableConvert}>🔄 변환하기</button>
              </div>

              {/* 원본 미리보기 */}
              {tableRows.length > 0 && tableParsed.length === 0 && (
                <div className="mt-16">
                  <h3 style={{ fontSize: 15, marginBottom: 8 }}>원본 데이터 미리보기 (상위 5건)</h3>
                  <div className="table-container">
                    <table>
                      <thead><tr>{tableHeaders.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                      <tbody>
                        {tableRows.slice(0, 5).map((row, ri) => (
                          <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 변환 결과 */}
          {tableParsed.length > 0 && (
            <div className="mt-16">
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>변환 결과 ({tableParsed.length}건)</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>일시</th><th>종목</th><th>구분</th>
                      <th className="text-right">수량</th><th className="text-right">단가</th>
                      <th className="text-right">체결금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableParsed.slice(0, 20).map((t, i) => (
                      <tr key={i}>
                        <td>{t.trade_date}</td>
                        <td>{t.stock_name}</td>
                        <td><span className={`badge ${t.trade_type === 'BUY' ? 'badge-buy' : 'badge-sell'}`}>
                          {t.trade_type === 'BUY' ? '매수' : '매도'}</span></td>
                        <td className="text-right">{t.quantity.toLocaleString()}</td>
                        <td className="text-right">{t.price.toLocaleString()}</td>
                        <td className="text-right">{(t.quantity * t.price).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {tableParsed.length > 20 && (
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
                  ... 외 {tableParsed.length - 20}건 더 있음
                </p>
              )}
              <button className="btn btn-success mt-16" onClick={handleTableSave}>
                💾 {tableParsed.length}건 저장하기
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===== 입출금 탭 ===== */}
      {activeTab === 'transfer' && (
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>미래에셋증권 입출금 내역 CSV 가져오기</h3>
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 6, background: 'rgba(66,99,235,0.06)', fontSize: 13, lineHeight: 1.7 }}>
            미래에셋증권 → 계좌 → 거래내역 → 기간 설정 후 조회 → CSV 다운로드<br />
            이체입금, 계좌대체입금 → 입금 / 계좌대체출금, 이체출금 → 출금으로 분류합니다.<br />
            공모주 관련 거래는 자동으로 제외됩니다.
          </div>
          <div className="form-group">
            <label className="form-label">계좌 선택 *</label>
            <AccountSelect value={transferAccount} onChange={setTransferAccount} />
          </div>
          <div className="btn-group mt-8">
            <button className="btn btn-outline" onClick={handleTransferSelectFile} disabled={!transferAccount}>
              📂 CSV 파일 선택
            </button>
            {transferFileName && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{transferFileName}</span>}
          </div>
          {(transferPreview.length > 0 || dividendPreview.length > 0) && (
            <div className="mt-16">
              <div className="flex-between mb-8">
                <h3 style={{ fontSize: 15 }}>미리보기 (입출금 {transferPreview.length}건, 배당 {dividendPreview.length}건)</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={transferReplace}
                      onChange={e => setTransferReplace(e.target.checked)} />
                    기존 데이터 삭제 후 재등록
                  </label>
                  <button className="btn btn-success" onClick={handleTransferImport}>
                    💾 전체 가져오기
                  </button>
                </div>
              </div>
              {transferPreview.length > 0 && (
              <div className="table-container" style={{ marginBottom: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>일자</th>
                      <th>구분</th>
                      <th>거래종류</th>
                      <th className="text-right">금액</th>
                      <th className="text-right">예수금</th>
                      <th>상대</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transferPreview.map((t, i) => (
                      <tr key={i}>
                        <td>{t.transfer_date}</td>
                        <td>
                          <span className={`badge ${t.transfer_type === 'DEPOSIT' ? 'badge-buy' : 'badge-sell'}`}>
                            {t.transfer_type === 'DEPOSIT' ? '입금' : '출금'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>{t.description}</td>
                        <td className="text-right">{t.amount.toLocaleString()}</td>
                        <td className="text-right">{t.balance_after.toLocaleString()}</td>
                        <td style={{ fontSize: 12 }}>{t.counterparty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
              {dividendPreview.length > 0 && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>💰 배당금 ({dividendPreview.length}건)</div>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>일자</th>
                        <th>종목코드</th>
                        <th>종목명</th>
                        <th className="text-right">세전</th>
                        <th className="text-right">세금</th>
                        <th className="text-right">세후(실수령)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dividendPreview.map((d, i) => (
                        <tr key={i}>
                          <td>{d.dividend_date}</td>
                          <td style={{ fontSize: 12 }}>{d.stock_code}</td>
                          <td>{d.stock_name}</td>
                          <td className="text-right">{d.amount.toLocaleString()}</td>
                          <td className="text-right">{d.tax.toLocaleString()}</td>
                          <td className="text-right" style={{ fontWeight: 600, color: 'var(--success)' }}>{d.net_amount.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </div>
          )}

          {/* 수동 입출금 입력 */}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 24, paddingTop: 20 }}>
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>수동 입출금 입력</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              융자, 계좌이체 등 CSV에 없는 입출금을 직접 입력합니다.
            </p>
            <form onSubmit={handleManualTransferSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">계좌 *</label>
                  <AccountSelect value={manualTransfer.account} onChange={v => setManualTransfer({ ...manualTransfer, account: v })} />
                </div>
                <div className="form-group">
                  <label className="form-label">구분 *</label>
                  <select className="form-select" value={manualTransfer.transfer_type}
                    onChange={e => setManualTransfer({ ...manualTransfer, transfer_type: e.target.value as any })}>
                    <option value="DEPOSIT">입금</option>
                    <option value="WITHDRAW">출금</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">금액 *</label>
                  <input type="number" className="form-input" value={manualTransfer.amount || ''}
                    onChange={e => setManualTransfer({ ...manualTransfer, amount: parseInt(e.target.value) || 0 })} min="1" required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">일자 *</label>
                  <input type="date" className="form-input" value={manualTransfer.transfer_date}
                    onChange={e => setManualTransfer({ ...manualTransfer, transfer_date: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">설명</label>
                  <input className="form-input" value={manualTransfer.description}
                    onChange={e => setManualTransfer({ ...manualTransfer, description: e.target.value })}
                    placeholder="예: 융자매수, 계좌이체" />
                </div>
                <div className="form-group">
                  <label className="form-label">상대</label>
                  <input className="form-input" value={manualTransfer.counterparty}
                    onChange={e => setManualTransfer({ ...manualTransfer, counterparty: e.target.value })}
                    placeholder="예: 미래에셋증권" />
                </div>
              </div>
              <button type="submit" className="btn btn-primary mt-8" disabled={!manualTransfer.account || manualTransfer.amount <= 0}>
                ➕ 입출금 등록
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ===== 카카오톡 탭 ===== */}
      {activeTab === 'kakao' && (
        <div className="card">
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 6, background: 'rgba(66,99,235,0.06)', fontSize: 13, lineHeight: 1.7 }}>
            PC 카카오톡에서 미래에셋증권 알림을 복사 → 아래에 붙여넣기<br />
            매매 체결, 배당금 입금, 입출금 알림을 모두 인식합니다. 여러 건을 한번에 붙여넣어도 됩니다.
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              {daumChecking && <span style={{ color: 'var(--text-secondary)' }}>⏳ 다음 금융 연동 확인 중...</span>}
              {!daumChecking && daumReady && <span style={{ color: 'var(--success)' }}>✅ 다음 금융 연동 활성 — 매매 저장 시 자동 동기화</span>}
              {!daumChecking && !daumReady && (
                <>
                  <span style={{ color: 'var(--text-secondary)' }}>⚠️ 다음 금융 미연동</span>
                  <button className="btn btn-sm btn-primary" onClick={handleDaumLogin} style={{ fontSize: 11, padding: '2px 10px' }}>
                    🔐 카카오 로그인
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 카카오톡 캡처 */}
          <div style={{ padding: '12px 14px', marginBottom: 16, borderRadius: 6, border: '1px dashed var(--border)', background: 'rgba(43,138,62,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>📋 카카오톡 캡처</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>PC 카카오톡에서 알림 메시지를 자동으로 가져옵니다</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select className="form-select" value={captureMonths}
                onChange={e => setCaptureMonths(parseInt(e.target.value))}
                style={{ width: 130, padding: '6px 8px', fontSize: 13 }}>
                <option value={1}>최근 1일</option>
                <option value={2}>최근 2일</option>
                <option value={7}>최근 1주</option>
                <option value={30}>최근 1개월</option>
                <option value={60}>최근 2개월</option>
                <option value={90}>최근 3개월</option>
                <option value={180}>최근 6개월</option>
                <option value={365}>최근 1년</option>
                <option value={730}>최근 2년</option>
                <option value={1095}>최근 3년</option>
                <option value={99999}>전체</option>
              </select>
              <button className="btn btn-success" onClick={() => handleKakaoCapture('manual')} disabled={capturing}
                style={{ fontSize: 13 }}>
                {capturing ? '⏳ 카카오톡을 클릭하세요...' : '📋 카카오톡 캡처'}
              </button>
            </div>
            {captureStatus && (
              <div style={{ marginTop: 8, fontSize: 13, color: captureStatus.includes('❌') ? 'var(--danger)' : 'var(--success)' }}>
                {captureStatus}
              </div>
            )}
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
              💡 버튼 클릭 → 3초 안에 카카오톡 대화창 클릭 → 자동으로 전체선택+복사+파싱. 선택한 기간 내 중복만 체크하고 새 내역을 저장합니다.
            </div>
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>또는 직접 붙여넣기:</div>
          <div className="form-group">
            <label className="form-label">카카오톡 알림 메시지</label>
            <textarea className="form-textarea" value={kakaoText} onChange={e => setKakaoText(e.target.value)}
              placeholder={`[미래에셋증권] 전량체결\n계좌번호 : 784-06**-**48-0\n종목명 : LS증권(A078020)\n매매구분 : 매도\n체결수량 : 2,000주\n체결단가 : 7,700원\n\n[미래에셋증권] 권리 입금 안내\n244-62**-**16-0\nA088980 맥쿼리한국인프라 배당금입금\n배정금액 : 123,880원(세전)\n\n[미래에셋증권] 입금\n입금액: 1,000,000\n잔액: 1,001,057`}
              style={{ minHeight: 200 }} />
          </div>
          <button className="btn btn-primary" onClick={handleParse} disabled={!kakaoText.trim()}>🔍 파싱하기</button>

          {kakaoResults.length > 0 && (
            <div className="mt-16">
              <h3 style={{ fontSize: 15, marginBottom: 12 }}>파싱 결과 미리보기</h3>

              {/* 매매 내역 */}
              {kakaoResults.filter(r => r.type === 'trade').length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
                    📈 매매 체결 ({kakaoResults.filter(r => r.type === 'trade').length}건)
                  </div>
                  <div className="table-container">
                    <table>
                      <thead><tr><th>상태</th><th>계좌</th><th>종목명</th><th>코드</th><th>구분</th><th className="text-right">수량</th><th className="text-right">단가</th><th>일시</th></tr></thead>
                      <tbody>
                        {kakaoResults.filter(r => r.type === 'trade').map((item, i) => {
                          const r = item.trade!
                          const idx = kakaoResults.indexOf(item)
                          return (
                            <tr key={i} style={{ background: item.isValid ? undefined : 'rgba(240,140,0,0.05)' }}>
                              <td>{item.isValid ? '✅' : '⚠️'}</td>
                              <td>
                                <select className="form-select" value={item.account} style={{ padding: '4px 8px', minWidth: 140 }}
                                  onChange={e => {
                                    setKakaoResults(prev => prev.map((p, pi) => pi === idx ? { ...p, account: e.target.value } : p))
                                  }}>
                                  <option value="">-- 선택 --</option>
                                  {accountList.map(a => <option key={a} value={a}>{a}</option>)}
                                </select>
                              </td>
                              <td>{r.stock_name}</td>
                              <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r._stockCode || '-'}</td>
                              <td><span className={`badge ${r.trade_type === 'BUY' ? 'badge-buy' : 'badge-sell'}`}>
                                {r.trade_type === 'BUY' ? '매수' : '매도'}</span></td>
                              <td className="text-right">{r.quantity.toLocaleString()}</td>
                              <td className="text-right">{r._currency ? `${r._currency} ` : ''}{r.price.toLocaleString()}</td>
                              <td style={{ fontSize: 12 }}>{r.trade_date}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 배당 내역 */}
              {kakaoResults.filter(r => r.type === 'dividend').length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
                    💰 배당금 ({kakaoResults.filter(r => r.type === 'dividend').length}건)
                  </div>
                  <div className="table-container">
                    <table>
                      <thead><tr><th>상태</th><th>계좌</th><th>종목명</th><th>종목코드</th><th className="text-right">배정금액 (세전)</th><th className="text-right">세금</th><th className="text-right">세후</th><th>일자</th></tr></thead>
                      <tbody>
                        {kakaoResults.filter(r => r.type === 'dividend').map((item, i) => {
                          const d = item.dividend!
                          const idx = kakaoResults.indexOf(item)
                          const cur = d.currency || ''
                          const unit = cur ? ` ${cur}` : '원'
                          return (
                            <tr key={i} style={{ background: item.isValid ? undefined : 'rgba(240,140,0,0.05)' }}>
                              <td>{item.isValid ? '✅' : '⚠️'}</td>
                              <td>
                                <select className="form-select" value={item.account} style={{ padding: '4px 8px', minWidth: 140 }}
                                  onChange={e => {
                                    setKakaoResults(prev => prev.map((p, pi) => pi === idx ? { ...p, account: e.target.value } : p))
                                  }}>
                                  <option value="">-- 선택 --</option>
                                  {accountList.map(a => <option key={a} value={a}>{a}</option>)}
                                </select>
                              </td>
                              <td>{d.stockName}</td>
                              <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.stockCode}</td>
                              <td className="text-right" style={{ color: 'var(--success)', fontWeight: 600 }}>{d.amount.toLocaleString()}{unit}</td>
                              <td className="text-right">{d.tax ? d.tax.toLocaleString() + unit : '-'}</td>
                              <td className="text-right" style={{ fontWeight: 600 }}>{d.netAmount ? d.netAmount.toLocaleString() + unit : '-'}</td>
                              <td style={{ fontSize: 12 }}>{item.date}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 입출금 내역 */}
              {kakaoResults.filter(r => r.type === 'transfer').length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
                    🏦 입출금 ({kakaoResults.filter(r => r.type === 'transfer').length}건)
                  </div>
                  <div className="table-container">
                    <table>
                      <thead><tr><th>상태</th><th>계좌</th><th>구분</th><th className="text-right">금액</th><th className="text-right">잔액</th><th>상대</th><th>일시</th></tr></thead>
                      <tbody>
                        {kakaoResults.filter(r => r.type === 'transfer').map((item, i) => {
                          const t = item.transfer!
                          const idx = kakaoResults.indexOf(item)
                          return (
                            <tr key={i} style={{ background: item.isValid ? undefined : 'rgba(240,140,0,0.05)' }}>
                              <td>{item.isValid ? '✅' : '⚠️'}</td>
                              <td>
                                <select className="form-select" value={item.account} style={{ padding: '4px 8px', minWidth: 140 }}
                                  onChange={e => {
                                    setKakaoResults(prev => prev.map((p, pi) => pi === idx ? { ...p, account: e.target.value } : p))
                                  }}>
                                  <option value="">-- 선택 --</option>
                                  {accountList.map(a => <option key={a} value={a}>{a}</option>)}
                                </select>
                              </td>
                              <td>
                                <span className={`badge ${t.transferType === 'DEPOSIT' ? 'badge-buy' : 'badge-sell'}`}>
                                  {t.transferType === 'DEPOSIT' ? '입금' : '출금'}
                                </span>
                              </td>
                              <td className="text-right">{t.amount.toLocaleString()}원</td>
                              <td className="text-right">{t.balanceAfter.toLocaleString()}원</td>
                              <td style={{ fontSize: 12 }}>{t.counterparty}</td>
                              <td style={{ fontSize: 12 }}>{item.date}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="mt-16">
                <button className="btn btn-success" onClick={handleSaveParsed}
                  disabled={kakaoResults.filter(r => r.isValid).length === 0}>
                  💾 {kakaoResults.filter(r => r.isValid).length}건 저장하기
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== 수동 입력 탭 ===== */}
      {activeTab === 'manual' && (
        <div className="card">
          <form onSubmit={handleManualSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">종목명 *</label>
                <input className="form-input" value={manualForm.stock_name}
                  onChange={e => setManualForm({ ...manualForm, stock_name: e.target.value })} placeholder="예: 삼성전자" required />
              </div>
              <div className="form-group">
                <label className="form-label">매수/매도 *</label>
                <select className="form-select" value={manualForm.trade_type}
                  onChange={e => setManualForm({ ...manualForm, trade_type: e.target.value as any })}>
                  <option value="BUY">매수</option><option value="SELL">매도</option></select>
              </div>
              <div className="form-group">
                <label className="form-label">계좌</label>
                <AccountSelect value={manualForm.account} onChange={v => setManualForm({ ...manualForm, account: v })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">수량 *</label>
                <input type="number" className="form-input" value={manualForm.quantity || ''}
                  onChange={e => setManualForm({ ...manualForm, quantity: parseInt(e.target.value) || 0 })} min="1" required />
              </div>
              <div className="form-group">
                <label className="form-label">단가 *</label>
                <input type="number" className="form-input" value={manualForm.price || ''}
                  onChange={e => setManualForm({ ...manualForm, price: parseFloat(e.target.value) || 0 })} min="1" required />
              </div>
              <div className="form-group">
                <label className="form-label">체결금액</label>
                <input className="form-input" value={(manualForm.quantity * manualForm.price).toLocaleString() + '원'} disabled />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">수수료</label>
                <input type="number" className="form-input" value={manualForm.fee || ''}
                  onChange={e => setManualForm({ ...manualForm, fee: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="form-group">
                <label className="form-label">세금</label>
                <input type="number" className="form-input" value={manualForm.tax || ''}
                  onChange={e => setManualForm({ ...manualForm, tax: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="form-group">
                <label className="form-label">체결일시 *</label>
                <input type="datetime-local" className="form-input" value={manualForm.trade_date}
                  onChange={e => setManualForm({ ...manualForm, trade_date: e.target.value })} required />
              </div>
            </div>
            <button type="submit" className="btn btn-primary mt-8">➕ 매매 내역 추가</button>
          </form>
        </div>
      )}

      {/* ===== 내보내기 탭 ===== */}
      {activeTab === 'export' && (
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>데이터 내보내기 (CSV)</h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
            등록된 데이터를 CSV 파일로 내보냅니다. UTF-8 BOM 형식으로 저장되어 엑셀에서 바로 열 수 있습니다.
          </p>
          <div className="form-group">
            <label className="form-label">내보내기 유형</label>
            <select className="form-select" value={exportType} onChange={e => setExportType(e.target.value as any)} style={{ maxWidth: 300 }}>
              <option value="trades">📋 매매 내역</option>
              <option value="holdings">💰 포트폴리오 현황</option>
              <option value="transfers">🏦 입출금 내역</option>
              <option value="dividends">💰 배당금 내역</option>
            </select>
          </div>
          <button className="btn btn-primary mt-8" onClick={handleExport}>
            📤 CSV 내보내기
          </button>
        </div>
      )}

      {/* 최근 입력 매매내역 (월별 요약 탭에서는 숨김) */}
      {activeTab !== 'monthly' && recentTrades.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}
              onClick={() => setShowRecent(!showRecent)}>
              {showRecent ? '▼' : '▶'} 최근 입력 내역 ({recentTrades.length}건)
            </span>
          </div>
          {showRecent && (
            <div className="table-container" style={{ fontSize: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>일자</th>
                    <th>계좌</th>
                    <th>종목</th>
                    <th className="text-center">구분</th>
                    <th className="text-right">수량</th>
                    <th className="text-right">단가</th>
                    <th className="text-right">금액</th>
                    <th>소스</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrades.map(t => (
                    <tr key={t.id} style={{ opacity: 0.85 }}>
                      <td>{t.trade_date.slice(0, 10)}</td>
                      <td style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.account}</td>
                      <td>{t.stock_name}</td>
                      <td className="text-center">
                        <span className={`badge ${t.trade_type === 'BUY' ? 'badge-buy' : 'badge-sell'}`}>
                          {t.trade_type === 'BUY' ? '매수' : '매도'}
                        </span>
                      </td>
                      <td className="text-right">{t.quantity.toLocaleString()}</td>
                      <td className="text-right">{t.currency ? `${t.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : t.price.toLocaleString()}</td>
                      <td className="text-right">{Math.round(t.total_amount).toLocaleString()}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{t.source === 'kakao' ? '📱' : t.source === 'csv' ? '📄' : '✏️'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
