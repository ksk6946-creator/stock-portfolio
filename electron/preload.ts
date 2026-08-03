const { contextBridge, ipcRenderer } = require('electron')

// 모든 API를 하나의 객체로 합쳐서 한 번에 expose
contextBridge.exposeInMainWorld('api', {
  trades: {
    getAll: (filters?: any) => ipcRenderer.invoke('trades:getAll', filters),
    add: (trade: any) => ipcRenderer.invoke('trades:add', trade),
    addMany: (trades: any[]) => ipcRenderer.invoke('trades:addMany', trades),
    addWithHolding: (trade: any, stockCode?: string) => ipcRenderer.invoke('trades:addWithHolding', trade, stockCode),
    update: (id: number, trade: any) => ipcRenderer.invoke('trades:update', id, trade),
    delete: (id: number) => ipcRenderer.invoke('trades:delete', id),
  },
  portfolio: {
    summary: () => ipcRenderer.invoke('portfolio:summary'),
    accounts: () => ipcRenderer.invoke('portfolio:accounts'),
    stocks: () => ipcRenderer.invoke('portfolio:stocks'),
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
  },
  templates: {
    getAll: () => ipcRenderer.invoke('templates:getAll'),
    save: (template: any) => ipcRenderer.invoke('templates:save', template),
  },
  dialog: {
    saveFile: (options: any) => ipcRenderer.invoke('dialog:saveFile', options),
    openFile: (options: any) => ipcRenderer.invoke('dialog:openFile', options),
  },
  fs: {
    writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:writeFile', path, content),
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
  },
  accounts: {
    getAll: () => ipcRenderer.invoke('accounts:getAll'),
    add: (name: string) => ipcRenderer.invoke('accounts:add', name),
    remove: (name: string) => ipcRenderer.invoke('accounts:remove', name),
  },
  holdings: {
    get: (accountName?: string) => ipcRenderer.invoke('holdings:get', accountName),
    set: (accountName: string, items: any[]) => ipcRenderer.invoke('holdings:set', accountName, items),
    updatePrice: (id: number, price: number) => ipcRenderer.invoke('holdings:updatePrice', id, price),
    delete: (id: number) => ipcRenderer.invoke('holdings:delete', id),
    summary: () => ipcRenderer.invoke('holdings:summary'),
    refreshFromTrades: () => ipcRenderer.invoke('holdings:refreshFromTrades'),
    updatePrices: () => ipcRenderer.invoke('holdings:updatePrices'),
    computeFromTrades: () => ipcRenderer.invoke('holdings:computeFromTrades'),
  },
  exchange: {
    getRate: () => ipcRenderer.invoke('exchange:rate'),
  },
  monthly: {
    get: (accountName?: string) => ipcRenderer.invoke('monthly:get', accountName),
    set: (accountName: string, items: any[]) => ipcRenderer.invoke('monthly:set', accountName, items),
    delete: (accountName: string) => ipcRenderer.invoke('monthly:delete', accountName),
    upsert: (accountName: string, month: string, startAsset: number, endAsset: number) => ipcRenderer.invoke('monthly:upsert', accountName, month, startAsset, endAsset),
  },
  transfers: {
    getAll: (accountName?: string) => ipcRenderer.invoke('transfers:getAll', accountName),
    addMany: (accountName: string, items: any[]) => ipcRenderer.invoke('transfers:addMany', accountName, items),
    delete: (accountName: string) => ipcRenderer.invoke('transfers:delete', accountName),
    update: (id: number, updates: any) => ipcRenderer.invoke('transfers:update', id, updates),
    deleteOne: (id: number) => ipcRenderer.invoke('transfers:deleteOne', id),
  },
  dividends: {
    getAll: (accountName?: string) => ipcRenderer.invoke('dividends:getAll', accountName),
    addMany: (accountName: string, items: any[]) => ipcRenderer.invoke('dividends:addMany', accountName, items),
    delete: (accountName: string) => ipcRenderer.invoke('dividends:delete', accountName),
    update: (id: number, updates: any) => ipcRenderer.invoke('dividends:update', id, updates),
    deleteOne: (id: number) => ipcRenderer.invoke('dividends:deleteOne', id),
  },
  daum: {
    login: () => ipcRenderer.invoke('daum:login'),
    sessionCookie: () => ipcRenderer.invoke('daum:sessionCookie'),
    checkCookie: (cookie: string, groupId: number) =>
      ipcRenderer.invoke('daum:checkCookie', cookie, groupId),
    getGroups: (cookie: string) =>
      ipcRenderer.invoke('daum:getGroups', cookie),
    getTrades: (cookie: string, groupId: number, itemId: number) =>
      ipcRenderer.invoke('daum:getTrades', cookie, groupId, itemId),
    searchStockCode: (stockName: string) =>
      ipcRenderer.invoke('stock:searchCode', stockName),
    addItem: (cookie: string, groupId: number, stockCode: string) =>
      ipcRenderer.invoke('daum:addItem', cookie, groupId, stockCode),
    deleteItems: (cookie: string, groupId: number, symbolCodes: string[]) =>
      ipcRenderer.invoke('daum:deleteItems', cookie, groupId, symbolCodes),
    getEmptyItems: (cookie: string, groupId: number) =>
      ipcRenderer.invoke('daum:getEmptyItems', cookie, groupId),
    addTrade: (cookie: string, groupId: number, itemId: number, trade: any) =>
      ipcRenderer.invoke('daum:addTrade', cookie, groupId, itemId, trade),
    deleteTrade: (cookie: string, groupId: number, itemId: number, tradeId: number) =>
      ipcRenderer.invoke('daum:deleteTrade', cookie, groupId, itemId, tradeId),
    syncTrade: (trade: { stockCode: string; stockName: string; tradeType: 'BUY' | 'SELL'; price: number; quantity: number; tradeDate: string; groupId: number }) =>
      ipcRenderer.invoke('daum:syncTrade', trade),
  },
  kakao: {
    capture: (chatRoomName: string, mode?: string) => ipcRenderer.invoke('kakao:capture', chatRoomName, mode),
  },
  db: {
    ready: () => ipcRenderer.invoke('db:ready'),
    restore: (csvDir: string) => ipcRenderer.invoke('db:restore', csvDir),
    getAllData: () => ipcRenderer.invoke('db:getAllData'),
    getPath: () => ipcRenderer.invoke('db:getPath'),
    setPath: (newPath: string) => ipcRenderer.invoke('db:setPath', newPath),
  },
  reconcile: {
    get: () => ipcRenderer.invoke('reconcile:get'),
    apply: (targets: { account: string; stock_name: string }[]) => ipcRenderer.invoke('reconcile:apply', targets),
    clear: (account?: string) => ipcRenderer.invoke('reconcile:clear', account),
  },
  updater: {
    // 업데이트 상태 구독. 반환된 함수를 호출하면 구독 해제
    onStatus: (callback: (status: any) => void) => {
      const listener = (_e: unknown, status: any) => callback(status)
      ipcRenderer.on('update-status', listener)
      return () => ipcRenderer.removeListener('update-status', listener)
    },
    getStatus: () => ipcRenderer.invoke('update:getStatus'),
    check: () => ipcRenderer.invoke('update:check'),
    restart: () => ipcRenderer.invoke('update:restart'),
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getLogPath: () => ipcRenderer.invoke('app:getLogPath'),
  },
})
