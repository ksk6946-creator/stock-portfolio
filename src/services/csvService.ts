import type { Trade, TradeInput, MonthlySummaryInput, TransferInput, DividendInput } from '../types'

/**
 * 매매 내역을 CSV 문자열로 변환합니다.
 */
export function tradesToCsv(trades: Trade[]): string {
  const headers = ['일시', '계좌', '종목명', '매수/매도', '수량', '단가', '체결금액', '수수료', '세금', '입력출처']
  const rows = trades.map(t => [
    t.trade_date,
    t.account,
    t.stock_name,
    t.trade_type === 'BUY' ? '매수' : '매도',
    t.quantity,
    t.price,
    t.total_amount,
    t.fee,
    t.tax,
    t.source
  ])
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
}

/**
 * 포트폴리오 현황을 CSV 문자열로 변환합니다.
 */
export function holdingsToCsv(holdings: { account: string; stockName: string; quantity: number; avgPrice: number; totalCost: number }[]): string {
  const headers = ['계좌', '종목명', '보유수량', '평균매수단가', '총투자금액']
  const rows = holdings.map(h => [h.account, h.stockName, h.quantity, h.avgPrice, h.totalCost])
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
}

/**
 * CSV 문자열을 파싱하여 매매 내역으로 변환합니다.
 */
export function csvToTrades(csvContent: string, columnMapping: Record<string, number>): TradeInput[] {
  const lines = csvContent.trim().split('\n')
  if (lines.length < 2) return []

  const dataLines = lines.slice(1) // 헤더 제외
  const trades: TradeInput[] = []

  for (const line of dataLines) {
    const cols = parseCsvLine(line)
    if (cols.length === 0) continue

    try {
      const tradeTypeRaw = cols[columnMapping.tradeType] || ''
      const tradeType = /매수|buy/i.test(tradeTypeRaw) ? 'BUY' : 'SELL'

      trades.push({
        account: cols[columnMapping.account] || '기본계좌',
        stock_name: cols[columnMapping.stockName] || '',
        trade_type: tradeType,
        quantity: parseInt((cols[columnMapping.quantity] || '0').replace(/,/g, '')),
        price: parseFloat((cols[columnMapping.price] || '0').replace(/,/g, '')),
        fee: parseFloat((cols[columnMapping.fee] || '0').replace(/,/g, '')),
        tax: parseFloat((cols[columnMapping.tax] || '0').replace(/,/g, '')),
        trade_date: cols[columnMapping.tradeDate] || new Date().toISOString().slice(0, 10),
        source: 'csv'
      })
    } catch {
      // skip invalid rows
    }
  }

  return trades.filter(t => t.stock_name && t.quantity > 0)
}

/**
 * CSV 라인을 파싱합니다 (따옴표 처리 포함).
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

/**
 * CSV 파일의 헤더(첫 줄)를 파싱합니다.
 */
export function parseCsvHeaders(csvContent: string): string[] {
  const firstLine = csvContent.trim().split('\n')[0]
  return parseCsvLine(firstLine)
}

/**
 * 미래에셋증권 매매내역 CSV를 파싱합니다.
 * 형식: 일자 | 종목명 | 매수수량 | 매수평균단가 | 매수금액 | 매도수량 | 매도평균단가 | 매도금액 | 매매비용 | 손익금액 | 수익률
 * 한 행에 매수/매도가 같이 있고, 값이 있는 쪽이 실제 거래.
 */
export function parseMiraeAssetCsv(csvContent: string, accountName: string): TradeInput[] {
  const lines = csvContent.trim().split('\n')
  if (lines.length < 2) return []

  // 헤더 행 찾기 (일자, 종목명이 포함된 행)
  let headerIdx = 0
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (/일자/.test(lines[i]) && /종목명/.test(lines[i])) {
      headerIdx = i
      break
    }
  }

  // 2행 헤더인 경우 (수량/평균단가/매수금액 등이 두 번째 줄에 있을 수 있음)
  let dataStartIdx = headerIdx + 1
  if (dataStartIdx < lines.length && /수량|평균단가/.test(lines[dataStartIdx]) && !/^\d{4}/.test(lines[dataStartIdx])) {
    dataStartIdx++
  }

  const trades: TradeInput[] = []

  for (let i = dataStartIdx; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]).map(c => c.trim())
    if (cols.length < 9) continue

    const dateStr = cols[0]?.replace(/\//g, '-')
    if (!dateStr || !/^\d{4}/.test(dateStr)) continue

    const stockName = (cols[1] || '').replace(/\(유통\)$/, '').trim()
    if (!stockName) continue

    const buyQty = parseNum(cols[2])
    const buyPrice = parseNum(cols[3])
    const sellQty = parseNum(cols[5])
    const sellPrice = parseNum(cols[6])
    const fee = parseNum(cols[8])

    // 매수 거래
    if (buyQty > 0 && buyPrice > 0) {
      trades.push({
        account: accountName,
        stock_name: stockName,
        trade_type: 'BUY',
        quantity: buyQty,
        price: buyPrice,
        fee: fee,
        tax: 0,
        trade_date: dateStr,
        source: 'csv'
      })
    }

    // 매도 거래
    if (sellQty > 0 && sellPrice > 0) {
      trades.push({
        account: accountName,
        stock_name: stockName,
        trade_type: 'SELL',
        quantity: sellQty,
        price: sellPrice,
        fee: fee,
        tax: 0,
        trade_date: dateStr,
        source: 'csv'
      })
    }
  }

  return trades
}

function parseNum(s: string): number {
  if (!s) return 0
  return parseFloat(s.replace(/[^0-9.\-]/g, '')) || 0
}

/**
 * 미래에셋증권 월별 매매비용 CSV를 파싱합니다.
 * 형식: 월 | 월초 자산총액 | 월말 자산총액 | 매수 | 매도 | 매매비용 | 기간 평가손익 | 실현손익 | 총손익
 */
export function parseMiraeMonthlyCSV(csvContent: string): MonthlySummaryInput[] {
  const lines = csvContent.trim().split('\n')
  if (lines.length < 2) return []

  // 헤더 행 찾기
  let dataStartIdx = 0
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (/월/.test(lines[i]) && /자산/.test(lines[i])) {
      dataStartIdx = i + 1
      break
    }
  }
  if (dataStartIdx === 0) dataStartIdx = 1

  const results: MonthlySummaryInput[] = []

  for (let i = dataStartIdx; i < lines.length; i++) {
    const cols = parseCsvLineInternal(lines[i]).map(c => c.trim())
    if (cols.length < 8) continue

    const month = cols[0]
    if (!month || !/^\d{4}/.test(month)) continue

    results.push({
      month: month.replace(/\//g, '-'),
      start_asset: parseNum(cols[1]),
      end_asset: parseNum(cols[2]),
      buy_amount: parseNum(cols[3]),
      sell_amount: parseNum(cols[4]),
      fee: parseNum(cols[5]),
      eval_pnl: parseNum(cols[6]),
      realized_pnl: parseNum(cols[7]),
      total_pnl: cols[8] ? parseNum(cols[8]) : parseNum(cols[6]) + parseNum(cols[7])
    })
  }

  return results.sort((a, b) => a.month.localeCompare(b.month))
}

// 내부용 CSV 라인 파서 (기존 parseCsvLine과 동일하지만 export 안 된 것 대비)
function parseCsvLineInternal(line: string): string[] {
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


/**
 * 미래에셋증권 입출금 내역 CSV를 파싱합니다.
 * 컬럼: 거래일자, 거래종류, 종목번호, 거래금액, 예수금, 수수료, ...상대기관, 상대고객명, ...입출금액...
 * 
 * 입금: 이체입금, 계좌대체입금 → DEPOSIT
 * 출금: 계좌대체출금, 이체출금 → WITHDRAW
 * 제외: 공모주청약대금출금, 공모주청약환불금 등 공모주 관련
 */
export function parseMiraeTransferCSV(csvContent: string): TransferInput[] {
  const lines = csvContent.trim().split('\n')
  if (lines.length < 2) return []

  // 헤더 행 찾기
  let headerIdx = 0
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (/거래일자/.test(lines[i]) && /거래종류/.test(lines[i])) {
      headerIdx = i
      break
    }
  }

  const headers = parseCsvLineInternal(lines[headerIdx]).map(h => h.trim())
  const dateCol = headers.findIndex(h => /거래일자/.test(h))
  const typeCol = headers.findIndex(h => /거래종류/.test(h))
  const amountCol = headers.findIndex(h => /^입출금액$|^거래금액$/.test(h))
  const balanceCol = headers.findIndex(h => /예수금/.test(h))
  const orgCol = headers.findIndex(h => /상대기관/.test(h))
  const nameCol = headers.findIndex(h => /상대고객명/.test(h))

  // 거래금액 fallback
  const effectiveAmountCol = amountCol >= 0 ? amountCol : headers.findIndex(h => /거래금액/.test(h))

  const results: TransferInput[] = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseCsvLineInternal(lines[i]).map(c => c.trim())
    if (cols.length < 3) continue

    const dateStr = (cols[dateCol] || '').replace(/\//g, '-')
    if (!dateStr || !/^\d{4}/.test(dateStr)) continue

    const txType = cols[typeCol] || ''

    // 공모주 관련 제외
    if (/공모주/.test(txType)) continue

    let transferType: 'DEPOSIT' | 'WITHDRAW' | null = null
    if (/이체입금|계좌대체입금|예탁금이용료입금|융자금입금|입금/.test(txType) && !/출금|송금|상환/.test(txType)) {
      transferType = 'DEPOSIT'
    } else if (/계좌대체출금|이체출금|이체송금|융자.*상환.*출금|출금/.test(txType) && !/입금/.test(txType)) {
      transferType = 'WITHDRAW'
    }

    if (!transferType) continue

    const amount = parseNum(cols[effectiveAmountCol] || '0')
    if (amount <= 0) continue

    const balanceAfter = parseNum(cols[balanceCol] || '0')
    const org = orgCol >= 0 ? cols[orgCol] || '' : ''
    const name = nameCol >= 0 ? cols[nameCol] || '' : ''
    const counterparty = [org, name].filter(Boolean).join(' ')

    results.push({
      transfer_type: transferType,
      amount,
      balance_after: balanceAfter,
      description: txType,
      counterparty,
      transfer_date: dateStr
    })
  }

  return results.sort((a, b) => b.transfer_date.localeCompare(a.transfer_date))
}

/**
 * 미래에셋증권 입출금 내역 CSV에서 배당금 관련 거래를 추출합니다.
 * 거래종류에 '배당' 또는 '분배금'이 포함된 행을 배당으로 인식합니다.
 */
export function parseMiraeDividendsFromTransferCSV(csvContent: string): DividendInput[] {
  const lines = csvContent.trim().split('\n')
  if (lines.length < 2) return []

  let headerIdx = 0
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (/거래일자/.test(lines[i]) && /거래종류/.test(lines[i])) {
      headerIdx = i
      break
    }
  }

  const headers = parseCsvLineInternal(lines[headerIdx]).map(h => h.trim())
  const dateCol = headers.findIndex(h => /거래일자/.test(h))
  const typeCol = headers.findIndex(h => /거래종류/.test(h))
  const codeCol = headers.findIndex(h => /종목번호|종목코드/.test(h))
  const amountCol = headers.findIndex(h => /^입출금액$|^거래금액$/.test(h))
  const effectiveAmountCol = amountCol >= 0 ? amountCol : headers.findIndex(h => /거래금액/.test(h))
  // 세금 관련 컬럼 (헤더에 있는 경우)
  const taxCol = headers.findIndex(h => /소득세|세금/.test(h))
  const localTaxCol = headers.findIndex(h => /주민세|지방소득세/.test(h))
  const stockNameCol = headers.findIndex(h => /종목명|상품명/.test(h))

  const results: DividendInput[] = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseCsvLineInternal(lines[i]).map(c => c.trim())
    if (cols.length < 3) continue

    const dateStr = (cols[dateCol] || '').replace(/\//g, '-')
    if (!dateStr || !/^\d{4}/.test(dateStr)) continue

    const txType = cols[typeCol] || ''
    if (!/배당|분배금/.test(txType)) continue

    const netAmount = parseNum(cols[effectiveAmountCol] || '0')
    if (netAmount <= 0) continue

    const stockCode = codeCol >= 0 ? (cols[codeCol] || '').trim() : ''

    // 헤더에 세금 컬럼이 있으면 사용
    let tax = 0
    if (taxCol >= 0) tax += parseNum(cols[taxCol] || '0')
    if (localTaxCol >= 0) tax += parseNum(cols[localTaxCol] || '0')

    // 종목명: 헤더에 종목명 컬럼이 있으면 사용
    let resolvedName = stockNameCol >= 0 ? (cols[stockNameCol] || '').trim() : ''

    // 미래에셋 CSV 2행 구조: 다음 행이 보조 행(날짜 없음)이면 종목명/세금 추출
    if (i + 1 < lines.length) {
      const nextCols = parseCsvLineInternal(lines[i + 1]).map(c => c.trim())
      const nextDate = (nextCols[dateCol] || '').trim()
      if (!nextDate || !/^\d{4}/.test(nextDate)) {
        // 보조 행에서 종목명 추출
        // 종목명 컬럼이 있으면 사용, 없으면 종목코드 옆 컬럼
        if (!resolvedName) {
          if (stockNameCol >= 0 && nextCols[stockNameCol]) {
            resolvedName = nextCols[stockNameCol].trim()
          } else if (codeCol >= 0) {
            // 종목코드 옆 컬럼에서 종목명 (보조 행에서 종목코드 위치에 종목명이 있는 경우도 있음)
            const candidate = nextCols[codeCol] || ''
            if (candidate && !/^\d+$/.test(candidate) && !/^[A-Z]\d+$/.test(candidate)) {
              resolvedName = candidate.trim()
            } else if (nextCols[codeCol + 1]) {
              resolvedName = nextCols[codeCol + 1].trim()
            }
          }
        }

        // 보조 행에서 세금 추출 (헤더에 세금 컬럼이 없는 경우)
        // 미래에셋 CSV 보조 행: 금액 컬럼 다음에 0, 세금(소득세+주민세) 패턴
        if (tax === 0) {
          // effectiveAmountCol 이후 컬럼들에서 숫자를 찾아 세금으로 사용
          // 보조 행 패턴: ..., 금액, 0, 세금, 0, ...
          if (taxCol >= 0) {
            tax += parseNum(nextCols[taxCol] || '0')
          }
          if (localTaxCol >= 0) {
            tax += parseNum(nextCols[localTaxCol] || '0')
          }
          // 헤더에 세금 컬럼이 없으면 보조 행에서 금액 다음+1 위치의 값을 세금으로 추정
          if (tax === 0 && effectiveAmountCol >= 0) {
            const taxCandidate = parseNum(nextCols[effectiveAmountCol + 2] || '0')
            if (taxCandidate > 0 && taxCandidate < netAmount) {
              tax = taxCandidate
            }
          }
        }
      }
    }

    // 종목코드에서 A 접두사 제거 (표시용)
    const cleanCode = stockCode.replace(/^A/, '')

    results.push({
      stock_code: cleanCode,
      stock_name: resolvedName || cleanCode || '배당금',
      amount: netAmount + tax,  // 세전 = 세후 + 세금
      tax,
      net_amount: netAmount,
      dividend_date: dateStr,
      source: 'csv'
    })
  }

  return results.sort((a, b) => b.dividend_date.localeCompare(a.dividend_date))
}



/**
 * 미래에셋증권 해외주식 매매내역 CSV를 파싱합니다.
 * 형식: 매매일 | 통화 | 종목번호 | 종목명 | 매매 | 결제 | 매매율(환율) | 매수단가 | 매수수량 | 매수금액 | 결제환율 | 매도단가 | 매도수량 | 매도금액 | 원화매도금액 | 원화매수금액 | 수수료 | 세금 | ...
 * 한 행에 매수/매도가 같이 있고, 값이 있는 쪽이 실제 거래.
 */
export function parseMiraeForeignCsv(csvContent: string, accountName: string): TradeInput[] {
  const lines = csvContent.trim().split('\n')
  if (lines.length < 2) return []

  // 헤더 행 찾기 - 다양한 패턴 시도
  let headerIdx = -1
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i]
    if (/매매일|거래일|체결일/.test(line) && /종목/.test(line)) {
      headerIdx = i
      break
    }
  }

  // 헤더를 못 찾으면 첫 줄이 데이터인지 확인 (날짜로 시작)
  const firstDataLine = parseCsvLineForExport(lines[0])
  const isFirstLineData = /^\d{4}[-\/]?\d{2}[-\/]?\d{2}/.test(firstDataLine[0]?.trim() || '')

  let headers: string[] = []
  let dataStartIdx = 0

  if (headerIdx >= 0) {
    headers = parseCsvLineForExport(lines[headerIdx]).map(h => h.trim())
    dataStartIdx = headerIdx + 1
    // 2행 헤더 스킵 (서브헤더가 있는 경우)
    if (dataStartIdx < lines.length) {
      const nextLine = parseCsvLineForExport(lines[dataStartIdx])
      const firstCell = nextLine[0]?.trim() || ''
      if (!/^\d{4}/.test(firstCell) && firstCell !== '') {
        dataStartIdx++
      }
    }
  } else if (isFirstLineData) {
    // 헤더 없이 바로 데이터 시작
    dataStartIdx = 0
  } else {
    // 첫 줄을 헤더로 간주
    headers = parseCsvLineForExport(lines[0]).map(h => h.trim())
    dataStartIdx = 1
  }

  // 컬럼 인덱스 찾기 (헤더 기반)
  let dateCol = headers.findIndex(h => /매매일|거래일|체결일|일자/.test(h))
  let currencyCol = headers.findIndex(h => /통화/.test(h))
  let codeCol = headers.findIndex(h => /종목번호|종목코드/.test(h))
  let nameCol = headers.findIndex(h => /종목명/.test(h))
  let buyPriceCol = headers.findIndex(h => /매수\s*단가|매수가/.test(h))
  let buyQtyCol = headers.findIndex(h => /매수\s*수량/.test(h))
  let sellPriceCol = headers.findIndex(h => /매도\s*단가|매도가/.test(h))
  let sellQtyCol = headers.findIndex(h => /매도\s*수량/.test(h))
  let feeCol = headers.findIndex(h => /수수료/.test(h))
  let taxCol = headers.findIndex(h => /^세금$/.test(h))
  let rateCol = headers.findIndex(h => /매매일환율|매매율|매매\s*환율/.test(h))

  // 헤더 매칭 실패 시 고정 인덱스 fallback
  // 매매일(0) | 통화(1) | 종목번호(2) | 종목명(3) | 잔고수량(4) | 매입평균환율(5) | 매매일환율(6) | 매수수량(7) | 매수단가(8) | 매수금액(9) | 원화매수금액(10) | 매도수량(11) | 매도단가(12) | 매도금액(13) | 원화매도금액(14) | 수수료(15) | 세금(16) | ...
  if (dateCol < 0) dateCol = 0
  if (currencyCol < 0) currencyCol = 1
  if (codeCol < 0) codeCol = 2
  if (nameCol < 0) nameCol = 3
  if (rateCol < 0) rateCol = 6
  if (buyQtyCol < 0) buyQtyCol = 7
  if (buyPriceCol < 0) buyPriceCol = 8
  if (sellQtyCol < 0) sellQtyCol = 11
  if (sellPriceCol < 0) sellPriceCol = 12
  if (feeCol < 0) feeCol = 15
  if (taxCol < 0) taxCol = 16

  const trades: TradeInput[] = []

  for (let i = dataStartIdx; i < lines.length; i++) {
    const cols = parseCsvLineForExport(lines[i]).map(c => c.trim())
    if (cols.length < 5) continue

    const rawDate = (cols[dateCol] || '').trim()
    // 날짜 형식: 2025-03-11, 2025/03/11, 20250311 등
    let dateStr = rawDate.replace(/\//g, '-')
    if (/^\d{8}$/.test(dateStr)) {
      dateStr = dateStr.slice(0, 4) + '-' + dateStr.slice(4, 6) + '-' + dateStr.slice(6, 8)
    }
    if (!dateStr || !/^\d{4}/.test(dateStr)) continue

    const stockCode = cols[codeCol] || ''
    const stockName = cols[nameCol] || ''
    if (!stockName && !stockCode) continue

    const currency = cols[currencyCol] || 'USD'
    const fee = parseNum(cols[feeCol] || '0')
    const tax = parseNum(cols[taxCol] || '0')
    const exchangeRate = parseNum(cols[rateCol] || '0')

    const buyQty = parseNum(cols[buyQtyCol] || '0')
    const buyPrice = parseNum(cols[buyPriceCol] || '0')
    const sellQty = parseNum(cols[sellQtyCol] || '0')
    const sellPrice = parseNum(cols[sellPriceCol] || '0')

    const displayName = stockName || stockCode

    // 매수
    if (buyQty > 0 && buyPrice > 0) {
      trades.push({
        account: accountName,
        stock_name: displayName,
        stock_code: stockCode,
        trade_type: 'BUY',
        quantity: buyQty,
        price: buyPrice,
        fee,
        tax: 0,
        trade_date: dateStr,
        source: 'csv',
        currency,
        exchange_rate: exchangeRate || undefined
      })
    }

    // 매도
    if (sellQty > 0 && sellPrice > 0) {
      trades.push({
        account: accountName,
        stock_name: displayName,
        stock_code: stockCode,
        trade_type: 'SELL',
        quantity: sellQty,
        price: sellPrice,
        fee,
        tax,
        trade_date: dateStr,
        source: 'csv',
        currency,
        exchange_rate: exchangeRate || undefined
      })
    }
  }

  return trades
}

// CSV 라인 파서 (export용 - 탭/콤마 모두 지원)
function parseCsvLineForExport(line: string): string[] {
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
