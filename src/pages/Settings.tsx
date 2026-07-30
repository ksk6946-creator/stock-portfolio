import { useState, useEffect } from 'react'

export default function Settings() {
  const [buyFeeRate, setBuyFeeRate] = useState(0.015)
  const [sellFeeRate, setSellFeeRate] = useState(0.015)
  const [taxRate, setTaxRate] = useState(0.23)
  const [theme, setTheme] = useState('light')
  const [status, setStatus] = useState('')
  const [restoreLogs, setRestoreLogs] = useState<string[]>([])
  const [dbPathDisplay, setDbPathDisplay] = useState('')
  const [dbStatus, setDbStatus] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [logPath, setLogPath] = useState('')
  const [updateMsg, setUpdateMsg] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    loadSettings()
    window.api.app?.getVersion().then(setAppVersion).catch(() => {})
    window.api.app?.getLogPath().then(setLogPath).catch(() => {})
  }, [])

  async function handleCheckUpdate() {
    setChecking(true)
    setUpdateMsg('업데이트 확인 중...')
    try {
      const r = await window.api.updater.check()
      if (!r.success) {
        setUpdateMsg(`확인 실패: ${r.error}`)
      } else if (r.version && r.version !== appVersion) {
        setUpdateMsg(`새 버전 v${r.version} 발견. 백그라운드에서 다운로드합니다.`)
      } else {
        setUpdateMsg('최신 버전을 사용 중입니다.')
      }
    } catch (err) {
      setUpdateMsg('확인 실패: ' + String(err))
    } finally {
      setChecking(false)
    }
  }

  async function loadSettings() {
    try {
      const [bf, sf, tr, th] = await Promise.all([
        window.api.settings.get('buyFeeRate'),
        window.api.settings.get('sellFeeRate'),
        window.api.settings.get('taxRate'),
        window.api.settings.get('theme')
      ])
      if (bf !== null) setBuyFeeRate(bf)
      if (sf !== null) setSellFeeRate(sf)
      if (tr !== null) setTaxRate(tr)
      if (th !== null) setTheme(th)
      applyTheme(th || 'light')

      // DB 경로 로드
      const p = await window.api.db.getPath()
      setDbPathDisplay(p)
    } catch (err) {
      console.error('Failed to load settings:', err)
    }
  }

  function applyTheme(t: string) {
    document.documentElement.setAttribute('data-theme', t)
  }

  async function handleSave() {
    try {
      await Promise.all([
        window.api.settings.set('buyFeeRate', buyFeeRate),
        window.api.settings.set('sellFeeRate', sellFeeRate),
        window.api.settings.set('taxRate', taxRate),
        window.api.settings.set('theme', theme),
      ])
      applyTheme(theme)
      setStatus('설정이 저장되었습니다.')
    } catch (err) {
      setStatus('저장 실패: ' + String(err))
    }
  }

  async function handleBackup() {
    try {
      const trades = await window.api.trades.getAll()
      const data = JSON.stringify({ trades, exportDate: new Date().toISOString() }, null, 2)
      const filePath = await window.api.dialog.saveFile({
        defaultPath: `portfolio_backup_${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      })
      if (!filePath) return
      await window.api.fs.writeFile(filePath, data)
      setStatus('백업 완료: ' + filePath)
    } catch (err) {
      setStatus('백업 실패: ' + String(err))
    }
  }

  async function handleRestore() {
    try {
      const filePath = await window.api.dialog.openFile({
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      })
      if (!filePath) return

      const content = await window.api.fs.readFile(filePath)
      const data = JSON.parse(content)

      if (!data.trades || !Array.isArray(data.trades)) {
        setStatus('유효하지 않은 백업 파일입니다.')
        return
      }

      if (!confirm(`${data.trades.length}건의 매매 내역을 복원하시겠습니까?\n기존 데이터에 추가됩니다.`)) return

      await window.api.trades.addMany(data.trades)
      setStatus(`${data.trades.length}건 복원 완료!`)
    } catch (err) {
      setStatus('복원 실패: ' + String(err))
    }
  }

  async function handleCsvRestore() {
    const csvDir = 'D:\\MarkAny\\DEV\\StockDataCtl\\계좌 데이터'
    if (!confirm(`CSV 디렉토리에서 데이터를 복구합니다.\n경로: ${csvDir}\n\n기존 데이터에 추가됩니다. 계속하시겠습니까?`)) return
    setRestoreLogs(['복구 시작...'])
    try {
      const result = await window.api.db.restore(csvDir)
      setRestoreLogs(result.logs || ['완료'])
      if (result.success) {
        setStatus('CSV 복구 완료!')
      } else {
        setStatus('CSV 복구 실패')
      }
    } catch (err) {
      setRestoreLogs(prev => [...prev, `오류: ${String(err)}`])
      setStatus('CSV 복구 실패: ' + String(err))
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">설정</h1>
        <p className="page-subtitle">수수료, 세금, 테마 등을 설정합니다</p>
      </div>

      {status && (
        <div style={{
          padding: '10px 16px', marginBottom: 16, borderRadius: 6,
          background: status.includes('실패') ? 'rgba(224,49,49,0.1)' : 'rgba(43,138,62,0.1)',
          color: status.includes('실패') ? 'var(--danger)' : 'var(--success)',
          fontSize: 14
        }}>
          {status}
        </div>
      )}

      {/* 수수료/세금 설정 */}
      <div className="card mb-16">
        <h3 style={{ fontSize: 15, marginBottom: 16 }}>수수료 및 세금</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">매수 수수료율 (%)</label>
            <input type="number" className="form-input" value={buyFeeRate} step="0.001"
              onChange={e => setBuyFeeRate(parseFloat(e.target.value) || 0)} />
          </div>
          <div className="form-group">
            <label className="form-label">매도 수수료율 (%)</label>
            <input type="number" className="form-input" value={sellFeeRate} step="0.001"
              onChange={e => setSellFeeRate(parseFloat(e.target.value) || 0)} />
          </div>
          <div className="form-group">
            <label className="form-label">세금율 (%)</label>
            <input type="number" className="form-input" value={taxRate} step="0.01"
              onChange={e => setTaxRate(parseFloat(e.target.value) || 0)} />
          </div>
        </div>
      </div>

      {/* 테마 */}
      <div className="card mb-16">
        <h3 style={{ fontSize: 15, marginBottom: 16 }}>화면 테마</h3>
        <div className="btn-group">
          <button className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => { setTheme('light'); applyTheme('light') }}>
            ☀️ 라이트
          </button>
          <button className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => { setTheme('dark'); applyTheme('dark') }}>
            🌙 다크
          </button>
        </div>
      </div>

      <button className="btn btn-primary mb-16" onClick={handleSave}>💾 설정 저장</button>

      {/* 백업/복원 */}
      <div className="card mb-16">
        <h3 style={{ fontSize: 15, marginBottom: 16 }}>데이터 백업 / 복원</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          전체 매매 내역을 JSON 파일로 백업하거나 복원합니다.
        </p>
        <div className="btn-group">
          <button className="btn btn-outline" onClick={handleBackup}>📦 백업 내보내기</button>
          <button className="btn btn-outline" onClick={handleRestore}>📂 백업 복원</button>
        </div>
      </div>

      {/* DB 저장 경로 */}
      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 16 }}>DB 저장 경로</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          DB 파일을 Google Drive, OneDrive 등 클라우드 동기화 폴더에 두면 여러 PC에서 사용할 수 있습니다.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input className="form-input" value={dbPathDisplay} readOnly style={{ flex: 1, fontSize: 12, fontFamily: 'monospace' }} />
          <button className="btn btn-outline" onClick={async () => {
            const newPath = await window.api.dialog.saveFile({ defaultPath: dbPathDisplay, filters: [{ name: 'JSON', extensions: ['json'] }] })
            if (newPath) {
              const result = await window.api.db.setPath(newPath)
              if (result.success) { setDbPathDisplay(newPath); setDbStatus('✅ 경로 변경 완료. 앱을 재시작해주세요.') }
              else setDbStatus(`❌ ${result.error}`)
            }
          }}>📂 변경</button>
        </div>
        {dbStatus && <div style={{ fontSize: 12, color: dbStatus.includes('❌') ? 'var(--danger)' : 'var(--success)' }}>{dbStatus}</div>}
      </div>

      {/* 앱 버전 / 업데이트 */}
      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 16 }}>앱 버전 및 업데이트</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          현재 버전 <strong style={{ color: 'var(--text-primary)' }}>v{appVersion || '...'}</strong><br />
          새 버전은 앱 시작 시 자동으로 확인하고 내려받습니다. 다운로드가 끝나면 재시작 안내가 표시되며,
          재시작하지 않아도 앱을 완전히 종료할 때 설치됩니다.
        </p>
        <button className="btn btn-outline" onClick={handleCheckUpdate} disabled={checking} style={{ marginBottom: 8 }}>
          🔄 {checking ? '확인 중...' : '업데이트 확인'}
        </button>
        {updateMsg && (
          <div style={{ fontSize: 12, marginTop: 4, color: updateMsg.includes('실패') ? 'var(--danger)' : 'var(--text-secondary)' }}>
            {updateMsg}
          </div>
        )}
        {logPath && (
          <div style={{ fontSize: 11, marginTop: 12, color: 'var(--text-secondary)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            로그 파일: {logPath}
          </div>
        )}
      </div>

      {/* CSV 일괄 복구 */}
      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 16 }}>CSV 일괄 복구</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          CSV 파일 디렉토리에서 매매/입출금/월별/배당 데이터를 일괄 복구합니다.<br/>
          기존 데이터에 추가됩니다. DB가 비어있을 때 사용하세요.
        </p>
        <button className="btn btn-outline" onClick={handleCsvRestore} style={{ marginBottom: 8 }}>
          🔄 CSV 일괄 복구 실행
        </button>
        {restoreLogs.length > 0 && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', maxHeight: 200, overflow: 'auto' }}>
            {restoreLogs.map((log, i) => <div key={i}>{log}</div>)}
          </div>
        )}
      </div>
    </div>
  )
}
