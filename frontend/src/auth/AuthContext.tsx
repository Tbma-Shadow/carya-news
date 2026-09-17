import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  getCurrentUser,
  login as requestLogin,
  logout as requestLogout,
} from '../api/auth'
import { UNAUTHORIZED_EVENT } from '../api/client'

interface AuthContextValue {
  loading: boolean
  authenticated: boolean
  username: string | null
  login(password: string): Promise<void>
  logout(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [username, setUsername] = useState<string | null>(null)

  const clearAuthentication = useCallback(() => {
    setAuthenticated(false)
    setUsername(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true

    getCurrentUser()
      .then((user) => {
        if (!active) return
        setAuthenticated(true)
        setUsername(user.username)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        clearAuthentication()
      })

    return () => {
      active = false
    }
  }, [clearAuthentication])

  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, clearAuthentication)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, clearAuthentication)
  }, [clearAuthentication])

  const login = useCallback(async (password: string) => {
    const user = await requestLogin(password)
    setAuthenticated(true)
    setUsername(user.username)
    setLoading(false)
  }, [])

  const logout = useCallback(async () => {
    await requestLogout()
    clearAuthentication()
  }, [clearAuthentication])

  const value = useMemo(
    () => ({ loading, authenticated, username, login, logout }),
    [authenticated, loading, login, logout, username],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
