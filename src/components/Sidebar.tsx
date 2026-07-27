import '../styles/components.css'

interface SidebarProps {
  currentPage: string
  onNavigate: (page: any) => void
}

const navItems = [
  { id: 'dashboard', icon: '📊', label: '대시보드' },
  { id: 'holdings', icon: '💰', label: '계좌 잔고' },
  { id: 'trades', icon: '📋', label: '매매 내역' },
  { id: 'transfers', icon: '🏦', label: '입출금 내역' },
  { id: 'dividends', icon: '💰', label: '배당금 내역' },
  { id: 'input', icon: '📥', label: '데이터 입력' },
  { id: 'analysis', icon: '📈', label: '수익률 분석' },
  { id: 'daum', icon: '🔄', label: '다음 금융 동기화' },
  { id: 'settings', icon: '⚙️', label: '설정' },
]

export default function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-title">📈 StockAssistant(ksk)</div>
      <ul className="sidebar-nav">
        {navItems.map(item => (
          <li
            key={item.id}
            className={`sidebar-item ${currentPage === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onNavigate(item.id)}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
