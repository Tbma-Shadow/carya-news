import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export function AppHeader() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)

    try {
      await logout()
      navigate('/login', { replace: true })
    } catch {
      // Keep the current session visible if the server did not confirm logout.
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <header className="app-header">
      <div className="app-header__content">
        <Link className="app-brand" to="/" aria-label="行能资讯首页">
          <img src="/carya-logo.svg" alt="Carya Energy 行能科技" />
          <span>行能资讯 <small>CARYA NEWS</small></span>
        </Link>
        <nav className="app-header__navigation" aria-label="主要导航">
          <NavLink to="/" end>
            新闻
          </NavLink>
          <NavLink to="/watchlists">关注关键词</NavLink>
          <NavLink to="/daily-briefs">每日简报</NavLink>
        </nav>
        <div className="app-header__account">
          <a className="tools-link" href="https://tools.caryaenergy.com">工具导览 ↗</a>
          <button
            className="app-header__logout"
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? '正在退出…' : '退出登录'}
          </button>
        </div>
      </div>
    </header>
  )
}
