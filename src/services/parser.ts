import type { ParsedTrade, ParsedKakaoItem } from '../types'

/**
 * 카카오톡 알림 메시지를 파싱합니다.
 * 매매 체결, 배당금 입금, 입출금 알림을 모두 처리합니다.
 */
export function parseKakaoMessages(text: string, account: string = '기본계좌'): ParsedTrade[] {
  const results: ParsedTrade[] = []

  // [미래에셋증권] 패턴으로 개별 메시지 분리
  const blocks = text.split(/(?=\[미래에셋증권\])/).filter(m => m.trim())

  if (blocks.length === 0) {
    // 분리 안 되면 빈 줄 2개 이상으로 분리
    const fallback = text.split(/\n{2,}/).filter(m => m.trim())
    blocks.push(...fallback)
  }

  // 아무것도 없으면 전체를 하나로
  if (blocks.length === 0) blocks.push(text)

  for (const block of blocks) {
    const parsed = parseMiraeKakao(block.trim(), account)
    if (parsed) {
      results.push(parsed)
      continue
    }
    // 미래에셋 형식이 아니면 기존 범용 파서 시도
    const generic = parseGenericMessage(block.trim(), account)
    if (generic) results.push(generic)
  }

  return results
}

/**
 * 카카오톡 알림 통합 파서: 매매 + 배당 + 입출금
 */
export function parseKakaoAll(text: string, defaultAccount: string = '기본계좌'): ParsedKakaoItem[] {
  const results: ParsedKakaoItem[] = []

  // [미래에셋증권] 패턴으로 개별 메시지 분리
  let blocks = text.split(/(?=\[미래에셋증권\])/).filter(m => m.trim())

  if (blocks.length === 0) {
    const fallback = text.split(/\n{2,}/).filter(m => m.trim())
    blocks.push(...fallback)
  }
  if (blocks.length === 0) blocks.push(text)

  // 날짜/시간 컨텍스트 추적
  // 카카오톡 날짜 구분선: "2026년 3월 25일 화요일" 또는 "2026년 3월 26일 목요일"
  // 카카오톡 시간: "[오후 3:06]" 또는 "[오전 9:07]"
  let currentDate = new Date().toISOString().slice(0, 10) // 기본값: 오늘

  for (const block of blocks) {
    const trimmed = block.trim()

    // 날짜 구분선 감지: "2026년 3월 26일 목요일" (블록 내에 포함될 수 있음)
    const dateLine = trimmed.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*[월화수목금토일요]+/)
    if (dateLine) {
      const y = dateLine[1]
      const m = dateLine[2].padStart(2, '0')
      const d = dateLine[3].padStart(2, '0')
      const newDate = `${y}-${m}-${d}`

      // 날짜 구분선이 블록 시작에 있으면 이 블록부터 적용
      // 날짜 구분선이 블록 끝에 있으면 다음 블록부터 적용
      const datePos = trimmed.indexOf(dateLine[0])
      const hasContentBefore = /체결|매수|매도|입금|출금|배당|권리/.test(trimmed.slice(0, datePos))
      const hasContentAfter = /체결|매수|매도|입금|출금|배당|권리/.test(trimmed.slice(datePos + dateLine[0].length))

      if (hasContentBefore && !hasContentAfter) {
        // 날짜가 블록 끝에 있음 → 현재 블록은 이전 날짜 사용, 다음 블록부터 새 날짜
        // (currentDate는 업데이트하되, 이 블록의 contextDateTime은 이전 날짜)
        // → 아래에서 contextDateTime 만든 후에 currentDate 업데이트
      } else {
        // 날짜가 블록 시작에 있음 → 바로 적용
        currentDate = newDate
      }

      // 날짜 구분선만 있는 블록이면 스킵
      if (!hasContentBefore && !hasContentAfter) { currentDate = newDate; continue }
    }

    // 시간 추출: "[오후 3:06]" 또는 "[오전 9:07]"
    let timeStr = ''
    const timeMatch = trimmed.match(/\[(오전|오후)\s*(\d{1,2}):(\d{2})\]/)
    if (timeMatch) {
      let hour = parseInt(timeMatch[2])
      if (timeMatch[1] === '오후' && hour < 12) hour += 12
      if (timeMatch[1] === '오전' && hour === 12) hour = 0
      timeStr = `${String(hour).padStart(2, '0')}:${timeMatch[3]}`
    }

    const contextDateTime = timeStr ? `${currentDate} ${timeStr}` : currentDate

    // 날짜가 블록 끝에 있었으면 이제 업데이트
    if (dateLine) {
      const y = dateLine[1]
      const m = dateLine[2].padStart(2, '0')
      const d = dateLine[3].padStart(2, '0')
      currentDate = `${y}-${m}-${d}`
    }

    // 1. 배당금 입금 알림
    const dividend = parseDividendKakao(trimmed, defaultAccount)
    if (dividend) {
      dividend.date = contextDateTime
      results.push(dividend)
      continue
    }

    // 2. 입출금 알림
    const transfer = parseTransferKakao(trimmed, defaultAccount)
    if (transfer) {
      // 입출금은 자체 시간 추출이 있으므로, 날짜 부분만 보정
      if (transfer.date && !transfer.date.includes('-')) {
        transfer.date = contextDateTime
      } else if (transfer.date.startsWith(new Date().toISOString().slice(0, 10))) {
        // 오늘 날짜로 잘못 들어간 경우 보정
        const transferTime = transfer.date.split(' ')[1] || timeStr || ''
        transfer.date = transferTime ? `${currentDate} ${transferTime}` : currentDate
      }
      results.push(transfer)
      continue
    }

    // 3. 매매 체결 알림
    const trade = parseMiraeKakao(trimmed, defaultAccount, contextDateTime)
    if (trade) {
      results.push({
        type: 'trade',
        account: trade.account,
        date: trade.trade_date,
        isValid: trade.isValid,
        error: trade.error,
        _acctNum: (trade as any)._acctNum,
        trade: trade as ParsedTrade & { _stockCode?: string; _acctNum?: string; _currency?: string }
      })
      continue
    }

    // 4. 범용 파서
    const generic = parseGenericMessage(trimmed, defaultAccount)
    if (generic) {
      if (!generic.trade_date || generic.trade_date === new Date().toISOString().slice(0, 19).replace('T', ' ')) {
        generic.trade_date = contextDateTime
      }
      results.push({
        type: 'trade',
        account: generic.account,
        date: generic.trade_date,
        isValid: generic.isValid,
        error: generic.error,
        trade: generic as ParsedTrade & { _stockCode?: string; _acctNum?: string; _currency?: string }
      })
    }
  }

  return results
}

/**
 * 배당금 입금 알림 파서
 * 형식: [미래에셋증권] 권리 입금 안내 + 계좌번호 + 종목코드 + 종목명 + 배정금액
 */
function parseDividendKakao(msg: string, defaultAccount: string): ParsedKakaoItem | null {
  if (!/권리\s*입금|배당금\s*입금|배당금입금|현금배당\s*입금|배당금외화입금/.test(msg)) return null

  // 계좌번호
  const acctMatch = msg.match(/(\d{3}-\d{2}\*{2}-\*{2}\d{2}-\d)/)
  const acctNum = acctMatch ? acctMatch[1] : ''

  // 해외 배당 여부
  const isForeign = /배당금외화입금|외국납부세액/.test(msg)

  let stockCode = ''
  let stockName = ''
  let amount = 0
  let tax = 0
  let netAmount = 0
  let currency = ''

  if (isForeign) {
    // 해외 배당: 종목번호/종목명이 별도 라인
    // - 종목번호 : VST
    const codeMatch = msg.match(/종목번호\s*[:：]\s*([A-Z]{1,5})/)
    if (codeMatch) stockCode = codeMatch[1]

    // - 종목명 : 비스트라 에너지
    const nameMatch = msg.match(/종목명\s*[:：]\s*(.+?)(?:\n|\r|$|-\s)/)
    if (nameMatch) stockName = nameMatch[1].trim()

    // - 배당금액 : USD 0.68 (세전) / USD 0.58 (세후)
    const amountMatch = msg.match(/배당금액\s*[:：]\s*([A-Z]{3})\s*([\d,.]+)\s*\(세전\)/)
    if (amountMatch) {
      currency = amountMatch[1]
      amount = parseFloat(amountMatch[2].replace(/,/g, ''))
    }

    // 세후 금액
    const netMatch = msg.match(/([A-Z]{3})\s*([\d,.]+)\s*\(세후\)/)
    if (netMatch) {
      netAmount = parseFloat(netMatch[2].replace(/,/g, ''))
    }

    // 외국납부세액
    const taxMatch = msg.match(/외국납부세액\s*[:：]\s*[A-Z]{3}\s*([\d,.]+)/)
    if (taxMatch) {
      tax = parseFloat(taxMatch[1].replace(/,/g, ''))
    }

    if (!netAmount && amount > 0 && tax > 0) netAmount = amount - tax
    if (!netAmount) netAmount = amount
  } else {
    // 국내 배당: "A088980 맥쿼리한국인프라투융자회사 보통주"
    const stockMatch = msg.match(/([A-Z]?\d{6})\s+(.+?)\s+(?:보통주|우선주|배당금)/)
    if (stockMatch) {
      stockCode = stockMatch[1].startsWith('A') ? stockMatch[1] : 'A' + stockMatch[1]
      stockName = stockMatch[2].trim()
    } else {
      const codeOnly = msg.match(/([A-Z]\d{6})\s+(.+?)(?:\s|배당|보통)/)
      if (codeOnly) {
        stockCode = codeOnly[1]
        stockName = codeOnly[2].trim()
      }
    }

    // 배정금액
    const amountMatch = msg.match(/배정금액\s*[:：]?\s*([\d,]+)\s*원/)
    amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, '')) : 0
    netAmount = amount
  }

  const isValid = !!(stockName && amount > 0)

  return {
    type: 'dividend',
    account: defaultAccount,
    date: new Date().toISOString().slice(0, 10),
    isValid,
    error: isValid ? undefined : '배당 정보를 파싱하지 못했습니다.',
    _acctNum: acctNum,
    dividend: {
      stockCode,
      stockName,
      amount,
      tax,
      netAmount,
      currency: currency || undefined
    }
  }
}

/**
 * 입출금 알림 파서
 * 형식: [미래에셋증권] 입금 + 계좌번호 + 입금액 + 잔액 + 상대방 + 시간
 * 또는: [미래에셋증권] 출금 + ...
 */
function parseTransferKakao(msg: string, defaultAccount: string): ParsedKakaoItem | null {
  // "입금" 또는 "출금" 키워드 확인 (단, "배당금입금"은 제외 — 배당 파서에서 처리)
  const isDeposit = /\]\s*입금/.test(msg)
  const isWithdraw = /\]\s*출금/.test(msg)
  if (!isDeposit && !isWithdraw) return null
  // 배당 알림은 제외
  if (/권리\s*입금|배당금/.test(msg)) return null

  const transferType = isDeposit ? 'DEPOSIT' : 'WITHDRAW'

  // 계좌번호 (다양한 형식: 784-06**-**48-0, 010-41**-**41-0)
  const acctMatch = msg.match(/(\d{3}-\d{2}\*{2}-\*{2}\d{2}-\d)/)
  const acctNum = acctMatch ? acctMatch[1] : ''

  // 입금액/출금액
  const amountMatch = msg.match(/(?:입금액|출금액)\s*[:：]?\s*([\d,]+)/)
  const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, '')) : 0

  // 잔액
  const balanceMatch = msg.match(/잔액\s*[:：]?\s*([\d,]+)/)
  const balanceAfter = balanceMatch ? parseInt(balanceMatch[1].replace(/,/g, '')) : 0

  // 상대방 + 시간: "김선근 토스뱅크 01:13"
  let counterparty = ''
  let time = ''
  // 잔액 뒤의 텍스트에서 추출
  const afterBalance = msg.split(/잔액\s*[:：]?\s*[\d,]+/)[1] || ''
  const cpMatch = afterBalance.match(/([가-힣]+\s+[가-힣A-Za-z]+)/)
  if (cpMatch) counterparty = cpMatch[1].trim()
  const timeMatch = afterBalance.match(/(\d{2}:\d{2})/)
  if (timeMatch) time = timeMatch[1]

  const today = new Date().toISOString().slice(0, 10)
  const date = time ? `${today} ${time}` : today

  const isValid = amount > 0

  return {
    type: 'transfer',
    account: defaultAccount,
    date,
    isValid,
    error: isValid ? undefined : '입출금 정보를 파싱하지 못했습니다.',
    _acctNum: acctNum,
    transfer: {
      transferType,
      amount,
      balanceAfter,
      counterparty,
      description: isDeposit ? '이체입금' : '이체출금'
    }
  }
}

/**
 * 미래에셋증권 카카오톡 체결 알림 파서
 */
function parseMiraeKakao(msg: string, defaultAccount: string, contextDateTime?: string): ParsedTrade | null {
  // 체결 알림인지 확인
  if (!/체결|매수|매도/.test(msg)) return null

  // 일부체결은 무시 (전량체결이 최종 확정이므로)
  if (/일부체결/.test(msg)) return null

  // 서버자동주문 안내는 무시 (주문 전송 알림일 뿐, 체결이 아님)
  if (/서버자동주문|주문이\s*전송/.test(msg)) return null

  // 매매구분
  let tradeType: 'BUY' | 'SELL' | null = null
  const typeMatch = msg.match(/매매구분\s*[:：]\s*(매수|매도)/)
  if (typeMatch) {
    tradeType = typeMatch[1] === '매수' ? 'BUY' : 'SELL'
  } else if (/매수\s*체결/.test(msg)) {
    tradeType = 'BUY'
  } else if (/매도\s*체결/.test(msg)) {
    tradeType = 'SELL'
  }
  if (!tradeType) {
    if (/매수/.test(msg)) tradeType = 'BUY'
    else if (/매도/.test(msg)) tradeType = 'SELL'
  }
  if (!tradeType) return null

  // 종목명 + 종목코드 추출
  // 국내: "LS증권(A078020)" → stockCode = "A078020"
  // 해외: "아마존닷컴(AMZN)" → stockCode = "AMZN"
  let stockName = ''
  let stockCode = ''
  let currency = ''
  const stockMatch = msg.match(/종목명\s*[:：]\s*(.+?)(?:매매구분|주문수량|체결수량|\n|\r|$)/)
  if (stockMatch) {
    const raw = stockMatch[1].trim()
    // 해외주식: 종목명(TICKER) 형태
    const foreignMatch = raw.match(/^(.+?)\(([A-Z]{1,5})\)$/)
    // 국내주식: 종목명(A123456) 형태
    const domesticMatch = raw.match(/^(.+?)\(([A-Z]?\d{6})\)$/)
    if (domesticMatch) {
      stockName = domesticMatch[1].trim()
      stockCode = domesticMatch[2].startsWith('A') ? domesticMatch[2] : 'A' + domesticMatch[2]
    } else if (foreignMatch) {
      stockName = foreignMatch[1].trim()
      stockCode = foreignMatch[2]
    } else {
      stockName = raw
    }
  }

  // 거래소로 해외주식 여부 판별
  const exchangeMatch = msg.match(/거래소\s*[:：]\s*(.+?)(?:\n|\r|$)/)
  const isForeign = !!(exchangeMatch || /나스닥|NYSE|NASDAQ|뉴욕|AMEX|홍콩|상해|도쿄/.test(msg))

  // 체결수량 (주문수량보다 체결수량 우선)
  // 해외: "6 주" 형태도 처리
  const qtyMatch = msg.match(/체결수량\s*[:：]\s*([\d,]+)\s*주?/) ||
                   msg.match(/주문수량\s*[:：]\s*([\d,]+)\s*주?/) ||
                   msg.match(/수량\s*[:：]\s*([\d,]+)/)
  const quantity = qtyMatch ? parseInt(qtyMatch[1].replace(/,/g, '')) : 0

  // 체결단가 - 해외주식은 "USD 224.61" 형태
  let price = 0
  const foreignPriceMatch = msg.match(/체결단가\s*[:：]\s*([A-Z]{3})\s*([\d,.]+)/)
  const domesticPriceMatch = msg.match(/체결단가\s*[:：]\s*([\d,.]+)/) ||
                             msg.match(/단가\s*[:：]\s*([\d,.]+)/) ||
                             msg.match(/가격\s*[:：]\s*([\d,.]+)/)
  if (foreignPriceMatch) {
    currency = foreignPriceMatch[1]
    price = parseFloat(foreignPriceMatch[2].replace(/,/g, ''))
  } else if (domesticPriceMatch) {
    price = parseFloat(domesticPriceMatch[1].replace(/[,원]/g, ''))
  }

  // 통화 미설정 시 해외주식이면 USD 기본
  if (!currency && isForeign) currency = 'USD'

  // 계좌번호 (뒷자리로 매칭용)
  const acctMatch = msg.match(/계좌번호\s*[:：]\s*(.+?)(?:\n|\r|$)/)
  const acctNum = acctMatch ? acctMatch[1].trim() : ''

  // 체결일시
  const dateMatch = msg.match(/체결시간\s*[:：]\s*([\d\-\/\s:]+)/) ||
                    msg.match(/일시\s*[:：]\s*([\d\-\/\s:]+)/) ||
                    msg.match(/(\d{4}[-\/]\d{2}[-\/]\d{2}\s*\d{2}:\d{2}(?::\d{2})?)/)
  let tradeDate = dateMatch?.[1]?.trim() || contextDateTime || new Date().toISOString().slice(0, 19).replace('T', ' ')
  tradeDate = tradeDate.replace(/\//g, '-')

  const isValid = !!(stockName && quantity > 0 && price > 0)

  return {
    stock_name: stockName || '(파싱 실패)',
    trade_type: tradeType,
    quantity,
    price,
    trade_date: tradeDate,
    account: defaultAccount,
    isValid,
    error: isValid ? undefined : '일부 항목을 파싱하지 못했습니다.',
    _stockCode: stockCode,
    _acctNum: acctNum,
    _currency: currency || undefined,
  } as ParsedTrade & { _stockCode?: string; _acctNum?: string; _currency?: string }
}

/**
 * 범용 카카오톡 체결 알림 파서 (기존 로직)
 */
function parseGenericMessage(msg: string, account: string): ParsedTrade | null {
  try {
    let tradeType: 'BUY' | 'SELL' | null = null
    if (/매수/.test(msg)) tradeType = 'BUY'
    else if (/매도/.test(msg)) tradeType = 'SELL'
    if (!tradeType) return null

    const stockMatch = msg.match(/종목[:\s]*(.+?)[\n\r]/) ||
                        msg.match(/종목명[:\s]*(.+?)[\n\r]/)
    const stockName = stockMatch?.[1]?.trim()

    const qtyMatch = msg.match(/수량[:\s]*([\d,]+)/) || msg.match(/([\d,]+)\s*주/)
    const quantity = qtyMatch ? parseInt(qtyMatch[1].replace(/,/g, '')) : 0

    const priceMatch = msg.match(/단가[:\s]*([\d,]+)/) ||
                       msg.match(/가격[:\s]*([\d,]+)/) ||
                       msg.match(/체결가[:\s]*([\d,]+)/)
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0

    const dateMatch = msg.match(/체결시간[:\s]*([\d\-\/\s:]+)/) ||
                      msg.match(/일시[:\s]*([\d\-\/\s:]+)/) ||
                      msg.match(/(\d{4}[-\/]\d{2}[-\/]\d{2}\s*\d{2}:\d{2}(?::\d{2})?)/)
    let tradeDate = dateMatch?.[1]?.trim() || new Date().toISOString().slice(0, 19).replace('T', ' ')
    tradeDate = tradeDate.replace(/\//g, '-')

    const isValid = !!(stockName && quantity > 0 && price > 0)

    return {
      stock_name: stockName || '(파싱 실패)',
      trade_type: tradeType,
      quantity,
      price,
      trade_date: tradeDate,
      account,
      isValid,
      error: isValid ? undefined : '일부 항목을 파싱하지 못했습니다.'
    }
  } catch {
    return null
  }
}

/**
 * 금액을 한국 원화 형식으로 포맷합니다.
 */
export function formatKRW(amount: number): string {
  return new Intl.NumberFormat('ko-KR').format(Math.round(amount)) + '원'
}

/**
 * 수익률을 포맷합니다.
 */
export function formatPercent(rate: number): string {
  return (rate >= 0 ? '+' : '') + rate.toFixed(2) + '%'
}
