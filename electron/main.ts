import { app, BrowserWindow, ipcMain, dialog, net, session } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import https from 'https'
import electronUpdater from 'electron-updater'
import log from 'electron-log/main'
const { autoUpdater } = electronUpdater
import {
  initDatabase, getAllTrades, addTrade, addManyTrades, updateTrade, deleteTrade,
  getSetting, setSetting, getAllTemplates, saveTemplate,
  getAccounts, getStocks, calculatePortfolio,
  getAllAccounts, addAccount, removeAccount,
  getHoldings, setHoldings, updateHoldingPrice, deleteHolding, getHoldingsSummary,
  getMonthlySummaries, setMonthlySummaries, deleteMonthlySummaries, upsertMonthlyAsset,
  computeHoldingsFromTrades, addTradeAndUpdateHolding,
  getTransfers, addManyTransfers, deleteTransfers, updateTransfer, deleteTransferById,
  getDividends, addManyDividends, deleteDividends, updateDividend, deleteDividendById,
  isDatabaseReady, restoreFromCsvFiles, getAllData,
  getDbPath, setDbPath
} from './database'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 로그 파일: %APPDATA%\StockAssistant(ksk)\logs\main.log
// 메인 프로세스의 console.log/error 를 파일로 함께 남깁니다.
// (렌더러 로깅용 log.initialize() 는 번들 환경에서 preload 경로가 깨지므로 사용하지 않습니다)
log.transports.file.level = 'info'
log.transports.console.level = 'info'
Object.assign(console, log.functions)

let mainWindow: BrowserWindow | null = null

// 환율 캐시 (하루 1회 업데이트)
let exchangeRateCache: { rate: number; fetchedAt: number } | null = null

async function fetchExchangeRate(): Promise<number> {
  const now = Date.now()
  // 캐시가 있고 6시간 이내면 재사용
  if (exchangeRateCache && (now - exchangeRateCache.fetchedAt) < 6 * 60 * 60 * 1000) {
    return exchangeRateCache.rate
  }

  try {
    const response = await net.fetch('https://open.er-api.com/v6/latest/USD')
    const data = await response.json()
    if (data.result === 'success' && data.rates?.KRW) {
      exchangeRateCache = { rate: data.rates.KRW, fetchedAt: now }
      return data.rates.KRW
    }
  } catch (err) {
    console.error('Failed to fetch exchange rate:', err)
  }

  // 실패 시 캐시가 있으면 캐시 반환, 없으면 기본값
  return exchangeRateCache?.rate ?? 1450
}

// 주식 시세 캐시 (종목코드 → { price, fetchedAt })
const priceCache: Map<string, { price: number; fetchedAt: number }> = new Map()

/**
 * 한국주식: 네이버 금융 API (polling.finance.naver.com)
 * 미국주식: Yahoo Finance API
 */
async function fetchStockPrice(stockCode: string, _stockName: string): Promise<number | null> {
  const now = Date.now()
  const cached = priceCache.get(stockCode)
  // 10분 캐시
  if (cached && (now - cached.fetchedAt) < 10 * 60 * 1000) {
    return cached.price
  }

  const isForeign = /^[A-Z]{1,5}(\.[A-Z])?$/.test(stockCode)

  try {
    if (!isForeign) {
      // 한국주식: 네이버 금융 API
      const numCode = stockCode.startsWith('A') ? stockCode.slice(1) : stockCode
      const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${numCode}`
      const response = await net.fetch(url)
      if (response.ok) {
        const data = await response.json() as any
        const priceRaw = data?.datas?.[0]?.closePriceRaw
        if (priceRaw) {
          const price = parseFloat(priceRaw)
          if (!isNaN(price) && price > 0) {
            priceCache.set(stockCode, { price, fetchedAt: now })
            return price
          }
        }
      }
    } else {
      // 미국주식: Yahoo Finance API
      // 클래스 주식은 Yahoo가 하이픈을 사용 (BRK.B -> BRK-B)
      const yahooCode = stockCode.replace(/\./g, '-')
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooCode}?interval=1d&range=1d`
      const response = await net.fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      })
      if (response.ok) {
        const data = await response.json() as any
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice
        if (price && price > 0) {
          priceCache.set(stockCode, { price, fetchedAt: now })
          return price
        }
      }
    }
  } catch (err) {
    console.error(`Failed to fetch price for ${stockCode}:`, err)
  }
  return null
}

/**
 * 매매내역 기반 보유종목을 계산하고, 시세를 조회하여 잔고를 자동 갱신합니다.
 */
async function refreshHoldingsFromTrades(): Promise<{
  updated: number; failed: string[]; total: number
}> {
  const computed = computeHoldingsFromTrades()
  const rate = await fetchExchangeRate()
  const failed: string[] = []
  let updated = 0

  // 계좌별로 그룹핑
  const byAccount: Record<string, typeof computed> = {}
  for (const h of computed) {
    if (!byAccount[h.account]) byAccount[h.account] = []
    byAccount[h.account].push(h)
  }

  for (const [accountName, items] of Object.entries(byAccount)) {
    const holdingInputs = []

    for (const item of items) {
      let currentPrice = item.avgPrice // 기본값: 평균단가
      const isForeign = /^[A-Z]{1,5}(\.[A-Z])?$/.test(item.stock_code)

      if (item.stock_code) {
        const price = await fetchStockPrice(item.stock_code, item.stock_name)
        if (price !== null) {
          currentPrice = price
          updated++
        } else {
          failed.push(item.stock_name)
        }
      } else {
        failed.push(`${item.stock_name} (종목코드 없음)`)
      }

      const purchaseAmount = item.quantity * item.avgPrice
      const evalAmount = item.quantity * currentPrice
      const evalPnl = evalAmount - purchaseAmount

      holdingInputs.push({
        stock_code: item.stock_code,
        stock_name: item.stock_name,
        category: isForeign ? '해외주식' : '주식',
        quantity: item.quantity,
        avg_price: item.avgPrice,
        current_price: currentPrice,
        purchase_amount: purchaseAmount,
        eval_amount: evalAmount,
        eval_pnl: evalPnl,
        return_rate: purchaseAmount > 0 ? (evalPnl / purchaseAmount) * 100 : 0
      })
    }

    setHoldings(accountName, holdingInputs)
  }

  return { updated, failed, total: computed.length }
}

/**
 * 기존 잔고의 현재가만 업데이트합니다 (잔고 구조는 유지).
 */
async function updatePricesOnly(): Promise<{
  updated: number; failed: string[]; total: number
}> {
  const holdings = getHoldings()
  const failed: string[] = []
  let updated = 0

  for (const h of holdings) {
    if (!h.stock_code) {
      failed.push(`${h.stock_name} (종목코드 없음)`)
      continue
    }
    const price = await fetchStockPrice(h.stock_code, h.stock_name)
    if (price !== null) {
      updateHoldingPrice(h.id, price)
      updated++
    } else {
      failed.push(h.stock_name)
    }
  }

  return { updated, failed, total: holdings.length }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'StockAssistant(ksk)',
    show: false
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

let dbReady = false

// === 자동 업데이트 ===
type UpdateStatus =
  | { type: 'idle' }
  | { type: 'dev' }
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available'; version: string }
  | { type: 'progress'; percent: number; version: string }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

// 렌더러가 아직 준비되지 않았을 때 보낸 상태가 유실되지 않도록 마지막 상태를 보관
let lastUpdateStatus: UpdateStatus = { type: 'idle' }

function setUpdateStatus(status: UpdateStatus) {
  lastUpdateStatus = status
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', status)
  }
}

let updaterReady = false

function setupAutoUpdater() {
  if (updaterReady) return
  updaterReady = true

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    log.info('[UPDATE] 확인 중...')
    setUpdateStatus({ type: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    log.info('[UPDATE] 새 버전 발견:', info.version)
    setUpdateStatus({ type: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', (info) => {
    log.info('[UPDATE] 최신 버전입니다:', info.version)
    setUpdateStatus({ type: 'not-available', version: info.version })
  })
  autoUpdater.on('download-progress', (p) => {
    setUpdateStatus({ type: 'progress', percent: Math.round(p.percent), version: autoUpdater.currentVersion?.version ?? '' })
  })
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[UPDATE] 다운로드 완료:', info.version)
    setUpdateStatus({ type: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    log.error('[UPDATE] 오류:', err)
    setUpdateStatus({ type: 'error', message: String(err?.message || err) })
  })
}

app.whenReady().then(() => {
  try {
    initDatabase()
    dbReady = true
    console.log('[APP] Database initialized successfully')
  } catch (err) {
    console.error('[APP] Database init failed:', err)
    dbReady = false
  }
  registerIpcHandlers()
  createWindow()

  // 앱 시작 시 자동 업데이트 확인 (개발 모드 제외)
  if (!process.env.VITE_DEV_SERVER_URL) {
    setupAutoUpdater()
    autoUpdater.checkForUpdates().catch(err => {
      log.error('[UPDATE] 확인 실패:', err)
      setUpdateStatus({ type: 'error', message: String(err?.message || err) })
    })
  } else {
    setUpdateStatus({ type: 'dev' })
  }

  // 앱 시작 시 시세 자동 업데이트 (5초 후, 창이 뜬 뒤 실행)
  setTimeout(() => {
    if (dbReady) {
      console.log('[APP] Auto price update starting...')
      updatePricesOnly().then(r => {
        console.log(`[APP] Auto price update done: ${r.updated}/${r.total} (failed: ${r.failed.length})`)
        if (r.failed.length > 0) {
          console.warn('[APP] 시세 조회 실패 종목:', r.failed.join(', '))
        }
      }).catch(err => console.error('[APP] Auto price update error:', err))
    }
  }, 5000)
})

// 업데이트 다운로드 완료 후 재시작 IPC
ipcMain.handle('update:restart', () => {
  log.info('[UPDATE] 재시작 후 설치 요청')
  setImmediate(() => autoUpdater.quitAndInstall())
  return true
})

// 현재 업데이트 상태 조회 (렌더러 마운트 시점 동기화용)
ipcMain.handle('update:getStatus', () => lastUpdateStatus)

// 수동 업데이트 확인
ipcMain.handle('update:check', async () => {
  if (process.env.VITE_DEV_SERVER_URL) {
    return { success: false, error: '개발 모드에서는 업데이트를 확인할 수 없습니다.' }
  }
  try {
    setupAutoUpdater()
    const r = await autoUpdater.checkForUpdates()
    return { success: true, version: r?.updateInfo?.version }
  } catch (err: any) {
    log.error('[UPDATE] 수동 확인 실패:', err)
    return { success: false, error: String(err?.message || err) }
  }
})

// 앱 버전 / 로그 파일 경로
ipcMain.handle('app:getVersion', () => app.getVersion())
ipcMain.handle('app:getLogPath', () => log.transports.file.getFile().path)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * 다음 금융 로그인 창을 띄우고, 로그인 완료 후 쿠키를 자동 추출합니다.
 * 별도 세션(partition)을 사용하여 메인 앱과 격리합니다.
 */
let loginWindow: BrowserWindow | null = null

function openDaumLoginWindow(): Promise<{ success: boolean; cookie?: string; error?: string }> {
  return new Promise((resolve) => {
    // 기존 로그인 창이 있으면 포커스
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.focus()
      return resolve({ success: false, error: '로그인 창이 이미 열려있습니다.' })
    }

    // 다음 금융 전용 세션 (persist로 로그인 상태 유지)
    const daumSession = session.fromPartition('persist:daum-finance')

    loginWindow = new BrowserWindow({
      width: 520,
      height: 720,
      parent: mainWindow || undefined,
      modal: false,
      title: '다음 금융 로그인',
      webPreferences: {
        session: daumSession,
        contextIsolation: true,
        nodeIntegration: false
      },
      autoHideMenuBar: true
    })

    // 카카오 로그인 페이지로 이동
    loginWindow.loadURL('https://accounts.kakao.com/login/?continue=https://finance.daum.net/my')

    let resolved = false

    // 페이지 이동 감지: finance.daum.net/my에 도달하면 로그인 성공
    loginWindow.webContents.on('did-navigate', async (_event, url) => {
      if (resolved) return
      if (url.startsWith('https://finance.daum.net')) {
        // 로그인 성공 → 쿠키 추출
        try {
          const cookies = await daumSession.cookies.get({ domain: '.daum.net' })
          const kakaoCookies = await daumSession.cookies.get({ domain: '.kakao.com' })
          const allCookies = [...cookies, ...kakaoCookies]
          const cookieStr = allCookies.map(c => `${c.name}=${c.value}`).join('; ')

          resolved = true
          loginWindow?.close()
          resolve({ success: true, cookie: cookieStr })
        } catch (err) {
          resolved = true
          loginWindow?.close()
          resolve({ success: false, error: '쿠키 추출 실패: ' + String(err) })
        }
      }
    })

    // in-page 네비게이션도 감지 (SPA 리다이렉트)
    loginWindow.webContents.on('did-navigate-in-page', async (_event, url) => {
      if (resolved) return
      if (url.startsWith('https://finance.daum.net')) {
        try {
          const cookies = await daumSession.cookies.get({ domain: '.daum.net' })
          const kakaoCookies = await daumSession.cookies.get({ domain: '.kakao.com' })
          const allCookies = [...cookies, ...kakaoCookies]
          const cookieStr = allCookies.map(c => `${c.name}=${c.value}`).join('; ')

          resolved = true
          loginWindow?.close()
          resolve({ success: true, cookie: cookieStr })
        } catch (err) {
          resolved = true
          loginWindow?.close()
          resolve({ success: false, error: '쿠키 추출 실패: ' + String(err) })
        }
      }
    })

    // 창 닫힘 처리
    loginWindow.on('closed', () => {
      loginWindow = null
      if (!resolved) {
        resolved = true
        resolve({ success: false, error: '로그인 창이 닫혔습니다.' })
      }
    })
  })
}

/**
 * 저장된 세션에서 쿠키를 재추출합니다 (로그인 창 없이).
 */
async function extractDaumCookieFromSession(): Promise<{ success: boolean; cookie?: string }> {
  try {
    const daumSession = session.fromPartition('persist:daum-finance')
    const cookies = await daumSession.cookies.get({ domain: '.daum.net' })
    const kakaoCookies = await daumSession.cookies.get({ domain: '.kakao.com' })
    const allCookies = [...cookies, ...kakaoCookies]
    if (allCookies.length === 0) return { success: false }
    const cookieStr = allCookies.map(c => `${c.name}=${c.value}`).join('; ')
    return { success: true, cookie: cookieStr }
  } catch {
    return { success: false }
  }
}

/**
 * Node.js https 모듈로 다음 금융 API 호출 (Cookie 헤더 확실히 전달)
 */
function daumRequest(url: string, method: string, cookie: string, body?: string, referer?: string): Promise<{ ok: boolean; status: number; body: string }> {
  const urlObj = new URL(url)
  // 쿠키에서 비ASCII 문자, 줄바꿈, 탭 등 제거 (ERR_INVALID_CHAR 방지)
  const cleanCookie = cookie.replace(/[^\x20-\x7E]/g, '').replace(/^cookie:\s*/i, '').trim()
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'ko,ko-KR;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cookie': cleanCookie,
      'Referer': referer || 'https://finance.daum.net/my',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin'
    }
    // Content-Type은 body가 있을 때만 (GET에는 넣지 않음)
    if (body) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(Buffer.byteLength(body))
      headers['Origin'] = 'https://finance.daum.net'
    }

    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers
    }, (res: any) => {
      let data = ''
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: data })
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

/**
 * 다음 금융 그룹에서 종목의 itemId를 찾고, 없으면 추가한 뒤 다시 조회합니다.
 *
 * 주의사항:
 * - 다음 금융 API는 A 접두사가 없는 종목코드를 사용합니다 (A0193T0 -> 0193T0)
 * - 먼저 목록을 조회해 기존 itemId를 재사용해야 합니다. 바로 POST 하면 중복 종목이 생깁니다
 * - 응답 형태가 배열 / {data:[]} / 인덱스 객체 로 제각각이라 모두 대응해야 합니다
 *
 * 수동 동기화(daum:addItem)와 카카오 자동 동기화(daum:syncTrade)가 같은 로직을 쓰도록
 * 공용 헬퍼로 분리했습니다. 예전에는 각자 구현이라 자동 동기화 쪽에만 A 접두사 처리가 빠져 있었습니다.
 */
async function daumFindOrAddItem(
  cookie: string, groupId: number, stockCode: string
): Promise<{ success: boolean; itemId?: number; error?: string }> {
  const listUrl = `https://finance.daum.net/api/my/groups/${groupId}/items?includeQuote=true`
  const referer = 'https://finance.daum.net/my'
  // 다음 금융은 A 없는 코드를 사용
  const daumCode = stockCode.replace(/^A/, '')

  const parseItems = (body: string): any[] => {
    try {
      const parsed = JSON.parse(body)
      if (Array.isArray(parsed)) return parsed
      if (Array.isArray(parsed.data)) return parsed.data
      if (Array.isArray(parsed.items)) return parsed.items
      return Object.values(parsed).filter((v: any) => v && typeof v === 'object' && (v.myStockItemId || v.id))
    } catch { return [] }
  }

  // 접두사 유무와 무관하게 비교
  const findItemId = (items: any[]): number | null => {
    const found = items.find((it: any) => {
      const c = String(it?.symbolCode || it?.code || '')
      return c.replace(/^A/, '') === daumCode
    })
    return found ? (found.myStockItemId || found.id || found.itemId || null) : null
  }

  try {
    // 1. 기존 목록에서 찾기
    const listResult = await daumRequest(listUrl, 'GET', cookie, undefined, referer)
    if (listResult.ok) {
      const existingId = findItemId(parseItems(listResult.body))
      if (existingId) return { success: true, itemId: existingId }
    }

    // 2. 없으면 추가
    const addResult = await daumRequest(listUrl, 'POST', cookie, JSON.stringify({ symbolCodes: [daumCode] }), referer)
    if (!addResult.ok) {
      return { success: false, error: `종목 추가 실패 (HTTP ${addResult.status}): ${addResult.body.slice(0, 150)}` }
    }

    // 3. 추가 후 재조회
    await new Promise(r => setTimeout(r, 300))
    const afterResult = await daumRequest(listUrl, 'GET', cookie, undefined, referer)
    if (afterResult.ok) {
      const newId = findItemId(parseItems(afterResult.body))
      if (newId) return { success: true, itemId: newId }
    }

    return { success: false, error: `${stockCode}(${daumCode}) itemId 찾기 실패` }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

function registerIpcHandlers() {
  // DB 상태 체크 핸들러
  ipcMain.handle('db:ready', () => {
    const ready = isDatabaseReady()
    console.log('[IPC] db:ready check:', ready)
    return ready
  })
  ipcMain.handle('db:getPath', () => getDbPath())
  ipcMain.handle('db:setPath', (_e, newPath: string) => setDbPath(newPath))

  ipcMain.handle('trades:getAll', (_e, filters) => getAllTrades(filters))
  ipcMain.handle('trades:add', (_e, trade) => addTrade(trade))
  ipcMain.handle('trades:addMany', (_e, trades) => addManyTrades(trades))
  ipcMain.handle('trades:addWithHolding', (_e, trade, stockCode) => addTradeAndUpdateHolding(trade, stockCode))
  ipcMain.handle('trades:update', (_e, id, trade) => updateTrade(id, trade))
  ipcMain.handle('trades:delete', (_e, id) => deleteTrade(id))

  ipcMain.handle('settings:get', (_e, key) => getSetting(key))
  ipcMain.handle('settings:set', (_e, key, value) => { setSetting(key, value); return true })

  ipcMain.handle('templates:getAll', () => getAllTemplates())
  ipcMain.handle('templates:save', (_e, template) => { saveTemplate(template); return true })

  ipcMain.handle('portfolio:summary', () => calculatePortfolio())
  ipcMain.handle('portfolio:accounts', () => getAccounts())
  ipcMain.handle('portfolio:stocks', () => getStocks())

  // === 계좌 잔고 ===
  ipcMain.handle('accounts:getAll', () => {
    const accts = getAllAccounts()
    console.log('[IPC] accounts:getAll returned:', accts.length, 'accounts', accts)
    return accts
  })
  ipcMain.handle('accounts:add', (_e, name) => addAccount(name))
  ipcMain.handle('accounts:remove', (_e, name) => removeAccount(name))
  ipcMain.handle('holdings:get', (_e, accountName?) => getHoldings(accountName))
  ipcMain.handle('holdings:set', (_e, accountName, items) => setHoldings(accountName, items))
  ipcMain.handle('holdings:updatePrice', (_e, id, price) => updateHoldingPrice(id, price))
  ipcMain.handle('holdings:delete', (_e, id) => deleteHolding(id))
  ipcMain.handle('holdings:summary', async () => {
    const rate = await fetchExchangeRate()
    return getHoldingsSummary(rate)
  })
  ipcMain.handle('exchange:rate', () => fetchExchangeRate())

  // === 시세 업데이트 ===
  ipcMain.handle('holdings:refreshFromTrades', () => refreshHoldingsFromTrades())
  ipcMain.handle('holdings:updatePrices', () => updatePricesOnly())
  ipcMain.handle('holdings:computeFromTrades', () => computeHoldingsFromTrades())

  // === 월별 요약 ===
  ipcMain.handle('monthly:get', (_e, accountName?) => getMonthlySummaries(accountName))
  ipcMain.handle('monthly:set', (_e, accountName, items) => setMonthlySummaries(accountName, items))
  ipcMain.handle('monthly:delete', (_e, accountName) => deleteMonthlySummaries(accountName))
  ipcMain.handle('monthly:upsert', (_e, accountName, month, startAsset, endAsset) => upsertMonthlyAsset(accountName, month, startAsset, endAsset))

  // === 입출금 내역 ===
  ipcMain.handle('transfers:getAll', (_e, accountName?) => getTransfers(accountName))
  ipcMain.handle('transfers:addMany', (_e, accountName, items) => addManyTransfers(accountName, items))
  ipcMain.handle('transfers:delete', (_e, accountName) => deleteTransfers(accountName))
  ipcMain.handle('transfers:update', (_e, id, updates) => updateTransfer(id, updates))
  ipcMain.handle('transfers:deleteOne', (_e, id) => deleteTransferById(id))

  // === 배당 내역 ===
  ipcMain.handle('dividends:getAll', (_e, accountName?) => getDividends(accountName))
  ipcMain.handle('dividends:addMany', (_e, accountName, items) => addManyDividends(accountName, items))
  ipcMain.handle('dividends:delete', (_e, accountName) => deleteDividends(accountName))
  ipcMain.handle('dividends:update', (_e, id, updates) => updateDividend(id, updates))
  ipcMain.handle('dividends:deleteOne', (_e, id) => deleteDividendById(id))

  // === 다음 금융 동기화 ===
  ipcMain.handle('daum:login', () => openDaumLoginWindow())
  ipcMain.handle('daum:sessionCookie', () => extractDaumCookieFromSession())

  ipcMain.handle('stock:searchCode', async (_e, stockName: string) => {
    try {
      // 네이버 종목 자동완성 API (JSON)
      // 영문이 섞인 ETF/ETN 코드도 조회됨 (예: KODEX SK하이닉스단일종목레버리지 -> 0193T0)
      // 이전에 쓰던 finance.naver.com/search/searchList.naver 는 404, 다음 검색은 JS 렌더링으로 코드 추출 불가
      const url = `https://ac.stock.naver.com/ac?q=${encodeURIComponent(stockName)}&target=stock`
      const response = await net.fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      })
      if (response.ok) {
        const data = await response.json() as any
        const items: any[] = Array.isArray(data?.items) ? data.items : []
        const domestic = items.filter(i => i?.nationCode === 'KOR' && i?.code)
        // 종목명이 정확히 일치하는 것을 우선 선택 (동명이인/유사명 오매칭 방지)
        const pick = domestic.find(i => i.name === stockName) || domestic[0]
        if (pick?.code) {
          const code = String(pick.code)
          if (pick.name !== stockName) {
            console.log(`[STOCK] "${stockName}" -> "${pick.name}" (A${code}) 근사 매칭`)
          }
          return { success: true, code: code.startsWith('A') ? code : 'A' + code }
        }
      }

      console.warn(`[STOCK] 종목코드 검색 실패: ${stockName}`)
      return { success: false }
    } catch (err) {
      console.error(`[STOCK] 종목코드 검색 오류 (${stockName}):`, err)
      return { success: false }
    }
  })

  ipcMain.handle('daum:checkCookie', async (_e, cookie: string, groupId: number) => {
    try {
      const url = `https://finance.daum.net/api/my/groups/${groupId}/items?includeQuote=true`
      const result = await daumRequest(url, 'GET', cookie, undefined, 'https://finance.daum.net/my')
      return { ok: result.ok, status: result.status }
    } catch (err) {
      return { ok: false, status: 0, error: String(err) }
    }
  })

  ipcMain.handle('daum:getGroups', async (_e, cookie: string) => {
    try {
      const url = 'https://finance.daum.net/api/my/groups'
      const result = await daumRequest(url, 'GET', cookie, undefined, 'https://finance.daum.net/my')
      if (!result.ok) return { success: false, error: `HTTP ${result.status}`, groups: [] }
      const data = JSON.parse(result.body)
      const groups = Array.isArray(data) ? data : (data?.groups || data?.data || [])
      return { success: true, groups }
    } catch (err) {
      return { success: false, error: String(err), groups: [] }
    }
  })

  ipcMain.handle('daum:getTrades', async (_e, cookie: string, groupId: number, itemId: number) => {
    try {
      const allTrades: any[] = []
      let page = 1
      const perPage = 100
      while (true) {
        const url = `https://finance.daum.net/api/my/groups/${groupId}/items/${itemId}/trades/details?groupId=${groupId}&itemId=${itemId}&page=${page}&perPage=${perPage}&pagination=true`
        const referer = `https://finance.daum.net/my/detail?groupId=${groupId}&itemId=${itemId}`
        const result = await daumRequest(url, 'GET', cookie, undefined, referer)
        if (!result.ok) {
          return { success: false, error: `HTTP ${result.status}`, trades: allTrades }
        }
        const data = JSON.parse(result.body)
        const trades = data?.data || data?.trades || data?.details || (Array.isArray(data) ? data : [])
        if (!Array.isArray(trades) || trades.length === 0) break
        allTrades.push(...trades)
        // 마지막 페이지면 종료
        const totalPages = data?.totalPages || data?.pageCount || Math.ceil((data?.totalCount || 0) / perPage)
        if (page >= totalPages || trades.length < perPage) break
        page++
        await new Promise(r => setTimeout(r, 200))
      }
      return { success: true, trades: allTrades }
    } catch (err) {
      return { success: false, error: String(err), trades: [] }
    }
  })

  // 다음 금융 종목 삭제 (symbolCodes 배열) — net.fetch 사용
  ipcMain.handle('daum:deleteItems', async (_e, cookie: string, groupId: number, symbolCodes: string[]) => {
    try {
      // persist 세션에서 최신 쿠키 가져오기
      let activeCookie = cookie
      try {
        const daumSession = session.fromPartition('persist:daum-finance')
        const cookies = await daumSession.cookies.get({ domain: '.daum.net' })
        const kakaoCookies = await daumSession.cookies.get({ domain: '.kakao.com' })
        const allCookies = [...cookies, ...kakaoCookies]
        if (allCookies.length > 0) {
          activeCookie = allCookies.map(c => `${c.name}=${c.value}`).join('; ')
        }
      } catch {}

      const url = `https://finance.daum.net/api/my/groups/${groupId}/items`
      const body = JSON.stringify({ symbolCodes })
      const response = await net.fetch(url, {
        method: 'DELETE',
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/json',
          'Cookie': activeCookie.replace(/[^\x20-\x7E]/g, ''),
          'Referer': 'https://finance.daum.net/my',
          'Origin': 'https://finance.daum.net',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body
      })
      return { success: response.ok, status: response.status, error: response.ok ? undefined : await response.text().then(t => t.slice(0, 200)) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 다음 금융 보유수량 0인 종목 조회
  ipcMain.handle('daum:getEmptyItems', async (_e, cookie: string, groupId: number) => {
    try {
      const url = `https://finance.daum.net/api/my/groups/${groupId}/items?includeQuote=true`
      const result = await daumRequest(url, 'GET', cookie, undefined, 'https://finance.daum.net/my')
      if (!result.ok) return { success: false, error: `HTTP ${result.status}`, items: [] }
      const data = JSON.parse(result.body)
      const items = data.data || data.items || data || []
      const empty = items.filter((it: any) => (it.holdingVolume || 0) === 0)
      return { success: true, items: empty.map((it: any) => ({ name: it.name, symbolCode: it.symbolCode })) }
    } catch (err) {
      return { success: false, error: String(err), items: [] }
    }
  })

  ipcMain.handle('daum:addItem', (_e, cookie: string, groupId: number, stockCode: string) =>
    daumFindOrAddItem(cookie, groupId, stockCode))

  ipcMain.handle('daum:addTrade', async (_e, cookie: string, groupId: number, itemId: number, trade: {
    tradeType: string; price: number; tradeQty: number; tradeDate: string; memo: string
  }) => {
    try {
      const url = `https://finance.daum.net/api/my/groups/${groupId}/items/${itemId}/trades/details/`
      const body = JSON.stringify({
        tradeType: trade.tradeType,
        price: trade.price,
        tradeQty: trade.tradeQty,
        tradeDate: trade.tradeDate,
        tradeTime: '',
        memo: trade.memo || ''
      })
      const referer = `https://finance.daum.net/my/detail?groupId=${groupId}&itemId=${itemId}`
      const result = await daumRequest(url, 'POST', cookie, body, referer)
      if (!result.ok) {
        return { success: false, error: `HTTP ${result.status}: ${result.body.slice(0, 200)}` }
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 다음 금융 매매 내역 삭제
  ipcMain.handle('daum:deleteTrade', async (_e, cookie: string, groupId: number, itemId: number, tradeId: number) => {
    try {
      const url = `https://finance.daum.net/api/my/groups/${groupId}/items/${itemId}/trades/details/${tradeId}`
      const referer = `https://finance.daum.net/my/detail?groupId=${groupId}&itemId=${itemId}`
      const result = await daumRequest(url, 'DELETE', cookie, undefined, referer)
      return { success: result.ok, status: result.status }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 카카오톡 매매 등록 시 다음 금융 자동 동기화 (쿠키 확인 → 종목 추가 → 매매 등록)
  ipcMain.handle('daum:syncTrade', async (_e, trade: {
    stockCode: string; stockName: string; tradeType: 'BUY' | 'SELL';
    price: number; quantity: number; tradeDate: string; groupId: number
  }) => {
    try {
      // 1. 쿠키 확인 (저장된 쿠키 → 세션 쿠키 순서)
      const db = await import('./database')
      let cookie = db.getSetting('daumCookie') || ''

      if (!cookie) {
        // 세션에서 추출 시도
        const ses = session.fromPartition('persist:daum-finance')
        const cookies = await ses.cookies.get({})
        const daumCookies = cookies.filter(c => c.domain && (c.domain.includes('.daum.net') || c.domain.includes('.kakao.com')))
        if (daumCookies.length > 0) {
          cookie = daumCookies.map(c => `${c.name}=${c.value}`).join('; ')
        }
      }

      if (!cookie) {
        return { success: false, error: 'no_cookie' }
      }

      // 2. 쿠키 유효성 체크
      const checkUrl = `https://finance.daum.net/api/my/groups/${trade.groupId}/items?includeQuote=true`
      const checkResult = await daumRequest(checkUrl, 'GET', cookie)
      if (!checkResult.ok) {
        // 세션에서 재추출 시도
        const ses = session.fromPartition('persist:daum-finance')
        const cookies = await ses.cookies.get({})
        const daumCookies = cookies.filter(c => c.domain && (c.domain.includes('.daum.net') || c.domain.includes('.kakao.com')))
        if (daumCookies.length > 0) {
          cookie = daumCookies.map(c => `${c.name}=${c.value}`).join('; ')
          db.setSetting('daumCookie', cookie)
          const recheck = await daumRequest(checkUrl, 'GET', cookie)
          if (!recheck.ok) {
            return { success: false, error: 'cookie_expired' }
          }
        } else {
          return { success: false, error: 'cookie_expired' }
        }
      }

      // 3. 종목 찾기 (없으면 추가) — 수동 동기화와 동일한 공용 헬퍼 사용
      const itemResult = await daumFindOrAddItem(cookie, trade.groupId, trade.stockCode)
      if (!itemResult.success || !itemResult.itemId) {
        console.warn(`[DAUM] 동기화 실패 (${trade.stockName} ${trade.stockCode}): ${itemResult.error}`)
        return { success: false, error: itemResult.error || '종목 itemId를 찾을 수 없음' }
      }
      const itemId = itemResult.itemId

      // 4. 매매 등록
      const tradeUrl = `https://finance.daum.net/api/my/groups/${trade.groupId}/items/${itemId}/trades/details/`
      const tradeBody = JSON.stringify({
        tradeType: trade.tradeType === 'BUY' ? 'P' : 'S',
        price: trade.price,
        tradeQty: trade.quantity,
        tradeDate: trade.tradeDate.replace(/[-/]/g, '').slice(0, 8),
        tradeTime: '',
        memo: ''
      })
      const tradeReferer = `https://finance.daum.net/my/detail?groupId=${trade.groupId}&itemId=${itemId}`
      const tradeResult = await daumRequest(tradeUrl, 'POST', cookie, tradeBody, tradeReferer)
      if (!tradeResult.ok) {
        console.warn(`[DAUM] 매매 등록 실패 (${trade.stockName} ${trade.tradeType} ${trade.quantity}@${trade.price}): HTTP ${tradeResult.status} ${tradeResult.body.slice(0, 150)}`)
        return { success: false, error: `매매 등록 실패 (HTTP ${tradeResult.status})` }
      }

      console.log(`[DAUM] 동기화 완료: ${trade.stockName} ${trade.tradeType} ${trade.quantity}주 @${trade.price} (itemId=${itemId})`)
      return { success: true, itemId }
    } catch (err) {
      console.error(`[DAUM] 동기화 오류 (${trade.stockName}):`, err)
      return { success: false, error: String(err) }
    }
  })

  // === 카카오톡 캡처 (PC 카카오톡 대화창에서 텍스트 자동 복사) ===
  // mode: 'auto' = 창 찾기 시도, 'manual' = 현재 포커스된 창에서 바로 복사
  ipcMain.handle('kakao:capture', async (_e, chatRoomName: string, mode?: string) => {
    const { execSync } = await import('child_process')
    const { clipboard } = await import('electron')
    const fs = await import('fs')
    const os = await import('os')

    try {
      // 클립보드 초기화
      clipboard.writeText('')

      if (mode === 'manual') {
        // 수동 모드: 사용자가 이미 카카오톡 대화창에 포커스를 맞춘 상태
        // 3초 대기 후 Ctrl+A → Ctrl+C 실행
        const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class KC {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const byte VK_CONTROL = 0x11;
  public const byte VK_A = 0x41;
  public const byte VK_C = 0x43;
  public const byte VK_ESCAPE = 0x1B;
  public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@
Start-Sleep -Milliseconds 3000
[KC]::keybd_event([KC]::VK_CONTROL, 0, 0, [UIntPtr]::Zero)
[KC]::keybd_event([KC]::VK_A, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[KC]::keybd_event([KC]::VK_A, 0, [KC]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
[KC]::keybd_event([KC]::VK_CONTROL, 0, [KC]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 300
[KC]::keybd_event([KC]::VK_CONTROL, 0, 0, [UIntPtr]::Zero)
[KC]::keybd_event([KC]::VK_C, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[KC]::keybd_event([KC]::VK_C, 0, [KC]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
[KC]::keybd_event([KC]::VK_CONTROL, 0, [KC]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 500
[KC]::keybd_event([KC]::VK_ESCAPE, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[KC]::keybd_event([KC]::VK_ESCAPE, 0, [KC]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
Write-Output "OK"
`
        const tmpFile = path.join(os.tmpdir(), 'kakao_capture.ps1')
        fs.writeFileSync(tmpFile, psScript, 'utf-8')
        execSync(
          `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
          { encoding: 'utf-8', timeout: 20000, windowsHide: true }
        )
        try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
      } else {
        // 자동 모드: 카카오톡 프로세스의 모든 창을 탐색 (EnumWindows + EnumChildWindows + GetWindowThreadProcessId)
        const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Collections.Generic;
using System.Diagnostics;
public class KC {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public const byte VK_CONTROL = 0x11;
  public const byte VK_A = 0x41;
  public const byte VK_C = 0x43;
  public const byte VK_ESCAPE = 0x1B;
  public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@

$targetTitle = '${chatRoomName.replace(/'/g, "''")}'
$found = [IntPtr]::Zero
$allTitles = @()

# 카카오톡 프로세스 PID 수집
$kakaoProcs = Get-Process -Name KakaoTalk -ErrorAction SilentlyContinue
if (-not $kakaoProcs) {
  Write-Output "ERROR:KakaoTalk not running"
  exit
}
$pids = @($kakaoProcs | ForEach-Object { $_.Id })

# 모든 최상위 창을 순회하며 카카오톡 PID 소속 + 제목 매칭
[KC]::EnumWindows({
  param($hWnd, $lParam)
  $pid = [uint32]0
  [KC]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null
  if ($pids -contains $pid) {
    $len = [KC]::GetWindowTextLength($hWnd)
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [KC]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
      $title = $sb.ToString()
      $allTitles += $title
      if ($title -and $title.Contains($targetTitle)) {
        $script:found = $hWnd
      }
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

if ($found -eq [IntPtr]::Zero) {
  $titleList = ($allTitles | Where-Object { $_ }) -join '|'
  Write-Output "ERROR:Window not found|$titleList"
  exit
}

[KC]::ShowWindow($found, 9) | Out-Null
Start-Sleep -Milliseconds 200
[KC]::SetForegroundWindow($found) | Out-Null
Start-Sleep -Milliseconds 800

[KC]::keybd_event([KC]::VK_CONTROL, 0, 0, [UIntPtr]::Zero)
[KC]::keybd_event([KC]::VK_A, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[KC]::keybd_event([KC]::VK_A, 0, [KC]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
[KC]::keybd_event([KC]::VK_CONTROL, 0, [KC]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 500
[KC]::keybd_event([KC]::VK_CONTROL, 0, 0, [UIntPtr]::Zero)
[KC]::keybd_event([KC]::VK_C, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[KC]::keybd_event([KC]::VK_C, 0, [KC]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
[KC]::keybd_event([KC]::VK_CONTROL, 0, [KC]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 500
[KC]::keybd_event([KC]::VK_ESCAPE, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[KC]::keybd_event([KC]::VK_ESCAPE, 0, [KC]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)

Write-Output "OK"
`
        const tmpFile = path.join(os.tmpdir(), 'kakao_capture.ps1')
        fs.writeFileSync(tmpFile, psScript, 'utf-8')

        const result = execSync(
          `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
          { encoding: 'utf-8', timeout: 20000, windowsHide: true }
        ).trim()

        try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }

        if (result.startsWith('ERROR:')) {
          const parts = result.replace('ERROR:', '').split('|')
          const errType = parts[0]
          const titles = parts[1] || ''
          if (errType === 'KakaoTalk not running') {
            return { success: false, error: 'PC 카카오톡이 실행되어 있지 않습니다.' }
          }
          if (errType === 'Window not found') {
            const hint = titles ? `\n감지된 창: ${titles}` : ''
            return { success: false, error: `"${chatRoomName}" 대화창을 찾을 수 없습니다.${hint}\n💡 수동 모드를 사용해보세요: 카카오톡 대화창을 클릭한 후 "수동 캡처" 버튼을 누르세요.` }
          }
          return { success: false, error: parts.join('|') }
        }
      }

      // 잠시 대기 후 클립보드 읽기
      await new Promise(r => setTimeout(r, 300))
      const text = clipboard.readText()
      if (!text || text.trim().length === 0) {
        return { success: false, error: '클립보드에서 텍스트를 읽을 수 없습니다. 카카오톡 대화방이 활성화된 상태인지 확인해주세요.' }
      }

      // 우리 앱으로 포커스 복귀
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus()
      }

      return { success: true, text }
    } catch (err: any) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus()
      }
      return { success: false, error: `캡처 실패: ${err.message || String(err)}` }
    }
  })

  // === DB 복구 ===
  ipcMain.handle('db:restore', async (_e, csvDir: string) => {
    try {
      const logs = await restoreFromCsvFiles(csvDir)
      return { success: true, logs }
    } catch (err) {
      return { success: false, logs: [`복구 실패: ${String(err)}`] }
    }
  })

  ipcMain.handle('db:getAllData', () => {
    const d = getAllData()
    return {
      trades: d.trades.length,
      holdings: d.holdings.length,
      monthly: d.monthly_summaries.length,
      transfers: d.transfers.length,
      dividends: d.dividends.length,
      accounts: d.accounts.length
    }
  })

  ipcMain.handle('dialog:saveFile', async (_e, options) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: options.defaultPath,
      filters: options.filters || [{ name: 'CSV Files', extensions: ['csv'] }]
    })
    return result.filePath
  })

  ipcMain.handle('dialog:openFile', async (_e, options) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: options.filters || [{ name: 'CSV Files', extensions: ['csv'] }]
    })
    return result.filePaths[0] || null
  })

  ipcMain.handle('fs:writeFile', async (_e, filePath: string, content: string) => {
    const fs = await import('fs/promises')
    await fs.writeFile(filePath, '\uFEFF' + content, 'utf-8')
    return true
  })

  ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
    const fs = await import('fs/promises')
    const content = await fs.readFile(filePath, 'utf-8')
    return content.replace(/^\uFEFF/, '')
  })
}
