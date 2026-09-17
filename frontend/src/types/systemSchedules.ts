export interface ScheduleResponse {
  enabled: boolean
  cron: string
  zone: string
  dailyTime: string | null
  dayOfWeek?: 'MONDAY'
}

export interface SystemSchedulesResponse {
  newsDiscovery: ScheduleResponse
  dailyBrief: ScheduleResponse
  weeklyBrief?: ScheduleResponse
}
