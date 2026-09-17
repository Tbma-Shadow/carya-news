import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchJson, ApiError } from '../api/client'
import { getWatchlists } from '../api/watchlists'
import { ScheduleInfo } from '../features/system/ScheduleInfo'
import type { WatchlistResponse } from '../types/watchlists'
import '../styles/daily-briefs.css'

interface WeeklyReport {
  id: number; watchlistName: string; weekStart: string; weekEnd: string
  candidateCount: number; itemCount: number; updatedAt: string
  summaryStatus: 'READY' | 'PENDING'; summaryError: string | null
  analysis: { headline: string; overview: string; events: { rank: number; title: string; summary: string; whyItMatters: string; supportingArticleIds: number[] }[] } | null
  items: { articleId: number; title: string; description: string | null; sourceName: string; url: string }[]
}
export function lastCompletedWeek(now = new Date()) {
  const d = new Date(new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10) + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7 - 7)
  return d.toISOString().slice(0, 10)
}
export function WeeklyBriefsPage() {
  const [watchlists, setWatchlists] = useState<WatchlistResponse[]>([])
  const [watchlistId, setWatchlistId] = useState('')
  const [date, setDate] = useState(lastCompletedWeek)
  const [report, setReport] = useState<WeeklyReport | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    getWatchlists(controller.signal).then(items => {
      if (controller.signal.aborted) return
      setWatchlists(items)
      setWatchlistId(String(items.find(w => w.enabled)?.id || ''))
      if (!items.some(w => w.enabled)) setStatus('ready')
    }).catch(() => { if (!controller.signal.aborted) { setStatus('error'); setError('关注主题加载失败，请重试。') } })
    return () => controller.abort()
  }, [reload])
  useEffect(() => {
    if (!watchlistId || !date) return
    const controller = new AbortController()
    setStatus('loading'); setReport(null); setError('')
    fetchJson<WeeklyReport>(`/api/weekly-briefs?watchlistId=${watchlistId}&date=${date}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setReport(value); setStatus('ready') } })
      .catch(e => { if (!controller.signal.aborted) { setStatus(e instanceof ApiError && e.status === 404 ? 'missing' : 'error') } })
    return () => controller.abort()
  }, [watchlistId, date, reload])
  async function generate() {
    if (generating) return
    setGenerating(true); setError('')
    try {
      const value = await fetchJson<WeeklyReport>('/api/weekly-briefs/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchlistId: Number(watchlistId), date }),
      })
      setReport(value); setStatus('ready')
    } catch { setError('周报生成失败，请稍后重试。已有周报会保留。') }
    finally { setGenerating(false) }
  }
  return <main className="page-shell"><section className="daily-brief-page">
    <header className="feed-page__heading"><h1>每周情报总结</h1><p>汇总上一周周一至周日的储能新闻，整理主要事件并保留来源。</p></header>
    <ScheduleInfo kind="weeklyBrief" />
    <div className="feed-toolbar daily-brief-selector">
      <label className="feed-toolbar__field"><span className="feed-toolbar__label">关注主题</span>
        <select value={watchlistId} disabled={generating} onChange={e => setWatchlistId(e.target.value)}>
          {watchlists.filter(w => w.enabled).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select></label>
      <label className="feed-toolbar__field"><span className="feed-toolbar__label">选择周内任一天</span>
        <input type="date" value={date} max={new Date(new Date(lastCompletedWeek()).getTime() + 6 * 86400000).toISOString().slice(0,10)} disabled={generating} onChange={e => setDate(e.target.value)} /></label>
    </div>
    {status === 'loading' && <p role="status">正在加载周报…</p>}
    {status === 'error' && <p role="alert">{error || '周报加载失败。'} <button className="button button--secondary" onClick={() => setReload(n => n+1)}>重试</button></p>}
    {!watchlistId && status === 'ready' && <p>请先<Link to="/watchlists">设置关注主题</Link>。</p>}
    {status === 'missing' && <p className="status-message">这周尚未生成周报，可根据已收录的新闻立即生成。</p>}
    {watchlistId && date && status !== 'loading' && <div className="daily-brief-actions">
      <button className="button button--primary" disabled={generating} onClick={generate}>{generating ? '正在生成周报…' : report ? '重新生成周报' : '生成周报'}</button>
      <span className="daily-brief-footnote">每周一 08:10 更新 · 北京时间</span>
    </div>}
    {error && status !== 'error' && <p role="alert">{error}</p>}
    {report && <div className="daily-brief-report">
      <dl className="daily-brief-metadata"><div><dt>统计周期</dt><dd>{report.weekStart} 至 {report.weekEnd}</dd></div><div><dt>匹配新闻</dt><dd>{report.candidateCount} 篇</dd></div><div><dt>入选新闻</dt><dd>{report.itemCount} 篇</dd></div></dl>
      {report.summaryStatus === 'PENDING' && <p className="status-message" role="status">新闻清单已保存。{report.summaryError || '总结暂未生成，请稍后重试。'}</p>}
      {!report.itemCount && <p className="status-message">这一周没有收录与当前关键词匹配的新闻。</p>}
      {report.analysis && <section aria-label="本周总结">
        <header className="daily-brief-analysis-heading"><h2>{report.analysis.headline}</h2><p className="daily-brief-overview">{report.analysis.overview}</p><p className="daily-brief-footnote">根据入选新闻的标题和摘要自动总结；涉及推断的内容已标注。</p></header>
        <ol className="daily-brief-events">{report.analysis.events.map(event => <li key={event.rank}><article className="daily-brief-event">
          <h3>{event.title}</h3><p className="daily-brief-event__summary">{event.summary}</p><p>{event.whyItMatters}</p>
          <div className="daily-brief-event__sources">来源：{event.supportingArticleIds.map(id => <Link key={id} to={`/articles/${id}`}>{report.items.find(a => a.articleId === id)?.sourceName} #{id}</Link>)}</div>
        </article></li>)}</ol>
      </section>}
      <section className="daily-brief-selected-articles"><h2>本周新闻</h2>
        <ol>{report.items.map(item => <li key={item.articleId}><article><h3><Link to={`/articles/${item.articleId}`}>{item.title}</Link></h3><p>{item.sourceName}</p>{item.description && <p>{item.description}</p>}</article></li>)}</ol>
      </section>
    </div>}
  </section></main>
}
