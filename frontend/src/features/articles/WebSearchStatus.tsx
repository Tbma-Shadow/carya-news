import { useEffect, useState } from 'react'
import { fetchJson } from '../../api/client'

type SearchStatus = { lastRun: { importedAt: string; summary: string } | null }
export function WebSearchStatus() {
  const [status, setStatus] = useState<SearchStatus | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetchJson<SearchStatus>('/api/discovery/status', { signal: controller.signal }).then(setStatus).catch(() => {})
    return () => controller.abort()
  }, [])
  const lastTime = status?.lastRun && new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(status.lastRun.importedAt))
  return <p className="status-message">全网新闻搜索：每个工作日 09:00（北京时间）{lastTime ? ` · 最近完成 ${lastTime}` : ''}。下方搜索框筛选已收录新闻。</p>
}
