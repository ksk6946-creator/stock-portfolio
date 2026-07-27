// 미래에셋 HTS 입출금 내역 CSV에서 매매+입출금+배당 추출
// 형식: 2행 헤더 (행1: 거래일자,거래종류,...  행2: 거래번호,원거래번호,수량,단가,종목명,...)
import fs from 'fs'
import path from 'path'
import os from 'os'
import iconv from 'iconv-lite' // fallback: 직접 파싱

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'stock-portfolio', 'portfolio.json')
const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'))
const csvDir = path.join(process.cwd(), '..', '계좌 데이터')

function readCsvEucKr(filePath) {
  const buf = fs.readFileSync(filePath)
  // EUC-KR 디코딩: Buffer를 직접 처리
  try {
    const td = new TextDecoder('euc-kr')
    return td.decode(buf)
  } catch {
    return buf.toString('utf-8')
  }
}

function parseLine(line) {
  const r = []; let cur = ''; let inQ = false
  for (const ch of line) {
    if (ch === '"') inQ = !inQ
    else if (ch === ',' && !inQ) { r.push(cur.trim()); cur = '' }
    else cur += ch
  }
  r.push(cur.trim()); return r
}

function parseNum(s) { return parseFloat((s||'0').replace(/[^0-9.\-]/g, '')) || 0 }

// 2행 페어 파싱: 홀수행(거래정보) + 짝수행(상세정보)
function parseHtsFile(content, accountName) {
  const lines = content.trim().split('\n').filter(l => l.trim())
  const trades = [], transfers = [], dividends = []

  // 헤더 2행 스킵
  let i = 0
  if (lines[0] && /거래일자/.test(lines[0])) i = 2

  while (i < lines.length - 1) {
    const row1 = parseLine(lines[i])
    const row2 = parseLine(lines[i + 1])
    i += 2

    const dateStr = (row1[0] || '').replace(/\//g, '-')
    if (!dateStr || !/^\d{4}/.test(dateStr)) continue
    const txType = row1[1] || ''
    const stockCode = row1[4] || ''
    const amount = parseNum(row1[5])
    const fee = parseNum(row1[7])

    const quantity = parseNum(row2[2])
    const price = parseNum(row2[3])
    const stockName = (row2[4] || '').replace(/\s*(보통주|우선주)\s*$/, '').replace(/주식회사\s*/, '').trim()
    const tax = parseNum(row2[7])
    const currency = row2[9] || ''
    const foreignAmount = parseNum(row2[10])

    // 국내 매수
    if (txType === '주식매수입고' && quantity > 0 && price > 0) {
      trades.push({ account: accountName, stock_name: stockName || stockCode, stock_code: stockCode, trade_type: 'BUY', quantity, price, fee, tax: 0, trade_date: dateStr, source: 'csv' })
    }
    // 국내 매도
    else if (txType === '주식매도출고' && quantity > 0 && price > 0) {
      trades.push({ account: accountName, stock_name: stockName || stockCode, stock_code: stockCode, trade_type: 'SELL', quantity, price, fee, tax, trade_date: dateStr, source: 'csv' })
    }
    // 해외 매수
    else if (txType === '해외주식매수입고' && foreignAmount > 0) {
      const qty = quantity || 1
      const prc = foreignAmount / qty
      trades.push({ account: accountName, stock_name: stockName || stockCode, stock_code: stockCode, trade_type: 'BUY', quantity: qty, price: prc, fee, tax: 0, trade_date: dateStr, source: 'csv', currency: currency || 'USD' })
    }
    // 해외 매도
    else if (txType === '해외주식매도출고' && foreignAmount > 0) {
      const qty = quantity || 1
      const prc = foreignAmount / qty
      trades.push({ account: accountName, stock_name: stockName || stockCode, stock_code: stockCode, trade_type: 'SELL', quantity: qty, price: prc, fee, tax, trade_date: dateStr, source: 'csv', currency: currency || 'USD' })
    }
    // 입출금
    else if (/이체입금|계좌대체입금/.test(txType) && amount > 0) {
      transfers.push({ transfer_type: 'DEPOSIT', amount, balance_after: parseNum(row1[6]), description: txType, counterparty: [row1[12]||'', row1[13]||''].filter(Boolean).join(' '), transfer_date: dateStr })
    }
    else if (/이체출금|계좌대체출금|이체.*송금/.test(txType) && amount > 0) {
      transfers.push({ transfer_type: 'WITHDRAW', amount, balance_after: parseNum(row1[6]), description: txType, counterparty: [row1[12]||'', row1[13]||''].filter(Boolean).join(' '), transfer_date: dateStr })
    }
    // 배당
    else if (/배당/.test(txType) && (amount > 0 || foreignAmount > 0)) {
      const divAmount = foreignAmount > 0 ? foreignAmount : amount
      dividends.push({ stock_code: stockCode, stock_name: stockName || stockCode, amount: divAmount, tax, net_amount: divAmount - tax, dividend_date: dateStr, source: 'csv', currency: currency || undefined })
    }
  }
  return { trades, transfers, dividends }
}

// CSV 파일 목록과 계좌 매핑
const csvFiles = [
  // 메인 계좌 (미국 포함)
  { file: '메인_1.csv', account: '[선근] 메인 (72480)' },
  { file: '메인_2.csv', account: '[선근] 메인 (72480)' },
  { file: '메인_3.csv', account: '[선근] 메인 (72480)' },
  { file: '메인_4.csv', account: '[선근] 메인 (72480)' },
  { file: '메인_5.csv', account: '[선근] 메인 (72480)' },
  { file: '메인_6.csv', account: '[선근] 메인 (72480)' },
  // ISA
  { file: 'ISA_1.csv', account: '[선근] ISA (18160)' },
  { file: 'ISA_2.csv', account: '[선근] ISA (18160)' },
  { file: 'ISA_3.csv', account: '[선근] ISA (18160)' },
  { file: 'ISA_4.csv', account: '[선근] ISA (18160)' },
  { file: 'ISA_5.csv', account: '[선근] ISA (18160)' },
  // 미국
  { file: '미국_1.csv', account: '[선근] 미국 (40410)' },
  { file: '미국_2.csv', account: '[선근] 미국 (40410)' },
  { file: '미국_3.csv', account: '[선근] 미국 (40410)' },
  { file: '미국_4.csv', account: '[선근] 미국 (40410)' },
  { file: '미국_5.csv', account: '[선근] 미국 (40410)' },
  // 다인
  { file: '다인_1.csv', account: '[다인] 통합 (39630)' },
  { file: '다인_2.csv', account: '[다인] 통합 (39630)' },
  { file: '다인_3.csv', account: '[다인] 통합 (39630)' },
  { file: '다인_4.csv', account: '[다인] 통합 (39630)' },
  { file: '다인_5.csv', account: '[다인] 통합 (39630)' },
  { file: '다인_6.csv', account: '[다인] 통합 (39630)' },
  // 기타
  { file: '큰누나_1.csv', account: '[큰누나] 통합 (48800)' },
  { file: '큰누나_2.csv', account: '[큰누나] 통합 (48800)' },
  { file: '장모님_1.csv', account: '[장모님] 통합 (27980)' },
  { file: 'IRP연금.csv', account: '[선근] IRP연금 (46720)' },
]

let totalTrades = 0, totalTransfers = 0, totalDividends = 0

for (const { file, account } of csvFiles) {
  const filePath = path.join(csvDir, file)
  if (!fs.existsSync(filePath)) { console.log(`⚠️ ${file} 없음`); continue }
  const content = readCsvEucKr(filePath)
  const { trades, transfers, dividends } = parseHtsFile(content, account)

  for (const t of trades) {
    data.trades.push({ ...t, id: data.nextTradeId++, total_amount: t.quantity * t.price, created_at: new Date().toISOString() })
  }
  for (const t of transfers) {
    data.transfers.push({ ...t, id: data.nextTransferId++, account_name: account, created_at: new Date().toISOString() })
  }
  for (const d2 of dividends) {
    data.dividends.push({ ...d2, id: data.nextDividendId++, account_name: account, created_at: new Date().toISOString() })
  }

  const parts = []
  if (trades.length) parts.push(`매매 ${trades.length}`)
  if (transfers.length) parts.push(`입출금 ${transfers.length}`)
  if (dividends.length) parts.push(`배당 ${dividends.length}`)
  console.log(`📄 ${file} (${account}): ${parts.join(', ')}`)
  totalTrades += trades.length; totalTransfers += transfers.length; totalDividends += dividends.length
}

console.log(`\n총: 매매 ${totalTrades}, 입출금 ${totalTransfers}, 배당 ${totalDividends}`)
fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8')
console.log('✅ DB 저장 완료')
