import fs from 'fs'

const DB = 'G:\\내 드라이브\\개인\\stock-portfolio\\portfolio.json'
const db = JSON.parse(fs.readFileSync(DB, 'utf-8'))
const out = []
const log = s => out.push(s)

// 매매내역 기준 수량 계산 (이동평균법, database.ts 와 동일)
function computeFromTrades() {
  const trades = [...db.trades].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
  const acc = {}
  for (const t of trades) {
    const key = `${t.account}::${t.stock_name}`
    if (!acc[key]) acc[key] = { qty: 0, cost: 0, buys: 0, sells: 0, first: t.trade_date, last: t.trade_date }
    const h = acc[key]
    h.last = t.trade_date
    if (t.trade_type === 'BUY') { h.cost += t.quantity * t.price; h.qty += t.quantity; h.buys++ }
    else {
      const avg = h.qty > 0 ? h.cost / h.qty : 0
      h.cost -= t.quantity * avg; h.qty -= t.quantity; h.sells++
      if (h.qty <= 0) { h.qty = 0; h.cost = 0 }
    }
  }
  return acc
}

const computed = computeFromTrades()

// 잔고(증권사 스냅샷) vs 매매내역 계산 비교
log('==== 잔고 vs 매매내역 수량 불일치')
log('계좌 | 종목 | 잔고수량 | 매매계산 | 차이 | 잔고평단 | 매매평단')
const rows = []
for (const h of db.holdings) {
  const key = `${h.account_name}::${h.stock_name}`
  const c = computed[key]
  const cQty = c ? c.qty : 0
  const diff = h.quantity - cQty
  if (diff !== 0) {
    rows.push({
      acct: h.account_name, name: h.stock_name, code: h.stock_code,
      hQty: h.quantity, cQty, diff,
      hAvg: Math.round(h.avg_price), cAvg: c && c.qty > 0 ? Math.round(c.cost / c.qty) : 0,
      hasTrades: !!c
    })
  }
}
rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
for (const r of rows) {
  log(`${r.acct} | ${r.name} (${r.code}) | 잔고 ${r.hQty} | 매매 ${r.cQty} | 차이 ${r.diff > 0 ? '+' : ''}${r.diff} | 평단 ${r.hAvg} vs ${r.cAvg}${r.hasTrades ? '' : ' | 매매내역 없음'}`)
}
log(`\n>> 불일치 종목: ${rows.length}건 / 전체 잔고 ${db.holdings.length}건`)
log(`   잔고 > 매매 (이전 입고 의심): ${rows.filter(r => r.diff > 0).length}건`)
log(`   잔고 < 매매 (과다 계상): ${rows.filter(r => r.diff < 0).length}건`)

// 매매내역엔 있는데 잔고엔 없는 종목 (전량매도 되었어야 하는데 남아있는 경우)
log('\n==== 매매내역 계산상 수량이 남는데 잔고에 없는 종목')
let ghost = 0
for (const [key, c] of Object.entries(computed)) {
  if (c.qty <= 0) continue
  const [acct, name] = key.split('::')
  const h = db.holdings.find(x => x.account_name === acct && x.stock_name === name)
  if (!h) {
    ghost++
    log(`  ${acct} | ${name} | 매매계산 ${c.qty}주 (평단 ${Math.round(c.cost / c.qty)}) | 잔고 없음`)
  }
}
log(`  >> ${ghost}건`)

// 기존 '이전 보유분' 보정 흔적
log('\n==== source=manual 매매내역 (기존 보정분)')
const manual = db.trades.filter(t => t.source === 'manual')
log(`  총 ${manual.length}건`)
for (const t of manual.slice(0, 40)) {
  log(`  ${t.trade_date.slice(0, 10)} | ${t.account} | ${t.stock_name} | ${t.trade_type} ${t.quantity}@${t.price}`)
}

// source 분포
log('\n==== 매매내역 source 분포')
const bySrc = {}
for (const t of db.trades) bySrc[t.source || '(없음)'] = (bySrc[t.source || '(없음)'] || 0) + 1
for (const [k, v] of Object.entries(bySrc).sort((a, b) => b[1] - a[1])) log(`  ${k}: ${v}건`)

// 입출금 내역 중 대체 관련 (주식 이전 흔적)
log('\n==== 입출금 설명에 "대체" 포함된 내역')
const daeche = db.transfers.filter(t => /대체/.test(t.description || ''))
log(`  총 ${daeche.length}건`)
const byDesc = {}
for (const t of daeche) byDesc[t.description] = (byDesc[t.description] || 0) + 1
for (const [k, v] of Object.entries(byDesc)) log(`  "${k}": ${v}건`)

fs.writeFileSync('_tmp_gap_out.txt', out.join('\n'), 'utf-8')
console.log('done, mismatches:', rows.length)
