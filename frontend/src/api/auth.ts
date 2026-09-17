import {
  apiFetch,
  clearCsrfToken,
  fetchJson,
  getOrCreateCsrfToken,
  requireSuccessful,
  type CsrfTokenResponse,
} from './client'

export interface CurrentUserResponse {
  authenticated: true
  username: string
}

export function getCsrfToken(): Promise<CsrfTokenResponse> {
  return getOrCreateCsrfToken()
}

export function getCurrentUser(): Promise<CurrentUserResponse> {
  return fetchJson<CurrentUserResponse>('/api/auth/me')
}

export async function login(
  password: string,
): Promise<CurrentUserResponse> {
  const body = new URLSearchParams({ password })
  const user = await fetchJson<CurrentUserResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  clearCsrfToken()
  await getOrCreateCsrfToken()
  return user
}

export async function logout(): Promise<void> {
  const response = await apiFetch('/api/auth/logout', { method: 'POST' })
  await requireSuccessful(response)
  clearCsrfToken()
}
