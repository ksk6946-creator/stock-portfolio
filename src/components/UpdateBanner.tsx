import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../types'

/**
 * 자동 업데이트 상태 알림 배너.
 * 다운로드가 끝나면 즉시 재시작할 수 있는 버튼을 띄웁니다.
 * 재시작하지 않아도 앱을 완전히 종료할 때 자동으로 설치됩니다.
 */
export default function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ type: 'idle' })
  const [dismissed, setDismissed] = useState(false)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    if (!window.api?.updater) return

    // 배너 마운트 전에 발생한 상태를 놓치지 않도록 현재 상태를 먼저 조회
    window.api.updater.getStatus().then(setStatus).catch(() => {})

    const unsubscribe = window.api.updater.onStatus((s) => {
      setStatus(s)
      setDismissed(false)
    })
    return unsubscribe
  }, [])

  if (dismissed) return null

  let tone: 'info' | 'ready' | 'error' = 'info'
  let message = ''
  let showRestart = false

  switch (status.type) {
    case 'available':
      message = `새 버전 v${status.version} 다운로드 중...`
      break
    case 'progress':
      message = `새 버전 다운로드 중... ${status.percent}%`
      break
    case 'downloaded':
      tone = 'ready'
      message = `새 버전 v${status.version} 준비됐습니다.`
      showRestart = true
      break
    case 'error':
      tone = 'error'
      message = `업데이트 확인 실패: ${status.message}`
      break
    default:
      // idle, dev, checking, not-available 은 표시하지 않음
      return null
  }

  const handleRestart = async () => {
    setRestarting(true)
    try {
      await window.api.updater.restart()
    } catch {
      setRestarting(false)
    }
  }

  return (
    <div className={`update-banner update-banner-${tone}`} role="status" aria-live="polite">
      <span className="update-banner-message">{message}</span>
      {showRestart && (
        <button
          type="button"
          className="update-banner-action"
          onClick={handleRestart}
          disabled={restarting}
        >
          {restarting ? '재시작 중...' : '지금 재시작'}
        </button>
      )}
      <button
        type="button"
        className="update-banner-close"
        onClick={() => setDismissed(true)}
        aria-label="알림 닫기"
      >
        ✕
      </button>
    </div>
  )
}
