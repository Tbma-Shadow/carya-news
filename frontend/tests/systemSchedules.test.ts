import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createServer } from 'vite'
import type { ScheduleResponse, SystemSchedulesResponse } from '../src/types/systemSchedules.ts'

const vite = await createServer({
  configFile: false,
  envDir: false,
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
})
after(() => vite.close())
const { ScheduleText } = await vite.ssrLoadModule('/src/features/system/ScheduleInfo.tsx')
const { getSystemSchedules } = await vite.ssrLoadModule('/src/api/systemSchedules.ts')
const { ArticleFeed } = await vite.ssrLoadModule('/src/features/articles/ArticleFeed.tsx')
const { WatchlistsPage } = await vite.ssrLoadModule('/src/pages/WatchlistsPage.tsx')
const { DailyBriefsPage } = await vite.ssrLoadModule('/src/pages/DailyBriefsPage.tsx')
const { WeeklyBriefsPage, lastCompletedWeek } = await vite.ssrLoadModule('/src/pages/WeeklyBriefsPage.tsx')

const schedules: SystemSchedulesResponse = {
  newsDiscovery: { enabled: true, cron: '0 25 7 * * *', zone: 'UTC', dailyTime: '07:25' },
  dailyBrief: { enabled: true, cron: '0 45 9 * * *', zone: 'Europe/Berlin', dailyTime: '09:45' },
}

function renderSchedule(kind: keyof SystemSchedulesResponse, schedule: ScheduleResponse | null) {
  return renderToStaticMarkup(createElement(ScheduleText, { kind, schedule }))
}

test('news discovery displays configured API time and uses the existing session-aware GET', async (t) => {
  const controller = new AbortController()
  const requests: unknown[] = []
  t.mock.method(globalThis, 'fetch', async (input: unknown, init: RequestInit) => {
    requests.push(input)
    assert.equal(init.credentials, 'same-origin')
    assert.equal(init.signal, controller.signal)
    assert.equal(init.method ?? 'GET', 'GET')
    assert.equal(init.body, undefined)
    return Response.json(schedules)
  })

  const response = await getSystemSchedules(controller.signal)

  assert.deepEqual(requests, ['/api/system/schedules'])
  assert.equal(renderSchedule('newsDiscovery', response.newsDiscovery),
    '<p class="schedule-info">自动更新：每天 07:25 · UTC</p>')
})

test('disabled discovery displays 未启用 instead of a scheduled time', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    ...schedules, newsDiscovery: { ...schedules.newsDiscovery, enabled: false },
  }))
  const response = await getSystemSchedules()

  assert.equal(renderSchedule('newsDiscovery', response.newsDiscovery),
    '<p class="schedule-info">自动更新：未启用</p>')
})

test('daily brief displays its configured generation time and zone from the API', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(schedules))
  const response = await getSystemSchedules()

  assert.equal(renderSchedule('dailyBrief', response.dailyBrief),
    '<p class="schedule-info">自动生成：每天 09:45 · Europe/Berlin</p>')
})

test('disabled daily brief displays 未启用', () => {
  assert.equal(renderSchedule('dailyBrief', { ...schedules.dailyBrief, enabled: false }),
    '<p class="schedule-info">自动生成：未启用</p>')
})

test('non-simple schedules show cron and zone without inventing a daily time', () => {
  const html = renderSchedule('newsDiscovery', {
    enabled: true, cron: '0 */15 * * * *', zone: 'UTC', dailyTime: null,
  })
  assert.equal(html, '<p class="schedule-info">自动更新：按计划（0 */15 * * * *）· UTC</p>')
  assert.doesNotMatch(html, /每天|null|08:00/)
})

test('API errors omit optional metadata and leave the three page shells renderable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'Unavailable' }, { status: 500 }))
  const response = await getSystemSchedules()

  assert.equal(response, null)
  assert.equal(renderSchedule('newsDiscovery', response), '')
  assert.equal(renderSchedule('dailyBrief', response), '')
  for (const [Page, expectedText] of [
    [ArticleFeed, '搜索'], [WatchlistsPage, '关注关键词'], [WeeklyBriefsPage, '每周情报总结'],
  ]) {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Page)))
    assert.ok(html.includes(expectedText))
    assert.doesNotMatch(html, /schedule-info|role="alert"/)
  }
})

test('network failures also resolve as unavailable optional metadata', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Network unavailable') })

  assert.equal(await getSystemSchedules(), null)
})
test('weekly schedule and default period use Shanghai Mondays', () => {
  assert.equal(renderSchedule('weeklyBrief',{enabled:true,cron:'10 0 * * MON',zone:'Asia/Shanghai',dailyTime:'08:10',dayOfWeek:'MONDAY'}),'<p class="schedule-info">自动生成：每周一 08:10 · 北京时间</p>')
  assert.equal(lastCompletedWeek(new Date('2026-09-20T16:00:00Z')),'2026-09-14')
  assert.equal(lastCompletedWeek(new Date('2026-09-20T15:59:59Z')),'2026-09-07')
})
