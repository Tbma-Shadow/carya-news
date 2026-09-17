import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return

    setSubmitting(true)
    setError(null)

    try {
      await login(username, password)
      navigate('/', { replace: true })
    } catch (loginError: unknown) {
      setError(
        loginError instanceof ApiError && loginError.status === 401
          ? '用户名或密码错误'
          : '登录失败，请稍后重试',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-heading">
        <img className="login-logo" src="/carya-logo.svg" alt="Carya Energy 行能科技" />
        <p className="login-card__brand">CARYA NEWS · 行能资讯</p>
        <h1 id="login-heading">登录行能资讯</h1>
        <p className="login-intro">查看能源行业动态、关注关键词与每日简报。</p>

        <form className="login-form" onSubmit={submit}>
          <label htmlFor="username">用户名</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={submitting}
            required
          />

          <label htmlFor="password">密码</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            required
          />

          {error && (
            <p className="login-form__error" role="alert">
              {error}
            </p>
          )}

          <button className="button button--primary login-form__submit" type="submit" disabled={submitting}>
            {submitting ? '正在登录…' : '登录'}
          </button>
        </form>
      </section>
    </main>
  )
}
