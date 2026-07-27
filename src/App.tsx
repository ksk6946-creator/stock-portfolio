import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import AccountHoldings from './pages/AccountHoldings'
import TradeHistory from './pages/TradeHistory'
import DataInput from './pages/DataInput'
import Analysis from './pages/Analysis'
import Settings from './pages/Settings'
import DaumSync from './pages/DaumSync'
import TransferHistory from './pages/TransferHistory'
import DividendHistory from './pages/DividendHistory'

type Page = 'dashboard' | 'holdings' | 'trades' | 'transfers' | 'dividends' | 'input' | 'analysis' | 'settings' | 'daum'

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const [apiReady, setApiReady] = useState(!!window.api?.accounts)

  // window.api가 준비될 때까지 대기 (preload 로딩 타이밍 이슈 대응)
  useEffect(() => {
    if (apiReady) return
    let attempts = 0
    const check = setInterval(() => {
      attempts++
      if (window.api?.accounts) {
        setApiReady(true)
        clearInterval(check)
        console.log('[App] window.api ready after', attempts * 100, 'ms')
      } else if (attempts > 100) { // 10초 초과
        clearInterval(check)
        console.error('[App] window.api not available after 10s')
      }
    }, 100)
    return () => clearInterval(check)
  }, [apiReady])

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard />
      case 'holdings': return <AccountHoldings />
      case 'trades': return <TradeHistory />
      case 'transfers': return <TransferHistory />
      case 'dividends': return <DividendHistory />
      case 'input': return <DataInput />
      case 'analysis': return <Analysis />
      case 'settings': return <Settings />
      case 'daum': return <DaumSync />
    }
  }

  if (!apiReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#666' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div>앱을 초기화하는 중...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  )
}
