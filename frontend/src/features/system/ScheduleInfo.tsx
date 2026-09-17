import { useEffect, useState } from 'react'
import { getSystemSchedules } from '../../api/systemSchedules'
import type { ScheduleResponse, SystemSchedulesResponse } from '../../types/systemSchedules'

type ScheduleKind = keyof SystemSchedulesResponse

export function ScheduleInfo({ kind }: { kind: ScheduleKind }) {
  const [schedules, setSchedules] = useState<SystemSchedulesResponse | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getSystemSchedules(controller.signal).then((response) => {
      if (!controller.signal.aborted) setSchedules(response)
    })
    return () => controller.abort()
  }, [])

  return <ScheduleText kind={kind} schedule={schedules?.[kind] ?? null} />
}

export function ScheduleText({ kind, schedule }: {
  kind: ScheduleKind
  schedule: ScheduleResponse | null
}) {
  if (!schedule) return null

  const label = kind === 'newsDiscovery' ? '自动更新' : '自动生成'
  const description = !schedule.enabled
    ? '未启用'
    : schedule.dailyTime !== null
      ? `${schedule.dayOfWeek === 'MONDAY' ? '每周一' : '每天'} ${schedule.dailyTime} · ${schedule.zone === 'Asia/Shanghai' ? '北京时间' : schedule.zone}`
      : `按计划（${schedule.cron}）· ${schedule.zone}`

  return <p className="schedule-info">{label}：{description}</p>
}
