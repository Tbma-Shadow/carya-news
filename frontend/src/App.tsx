import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { AppHeader } from './components/AppHeader'
import { ArticleDetailPage } from './pages/ArticleDetailPage'
import { WeeklyBriefsPage } from './pages/WeeklyBriefsPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { WatchlistsPage } from './pages/WatchlistsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedApp />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/articles/:id" element={<ArticleDetailPage />} />
        <Route path="/watchlists" element={<WatchlistsPage />} />
        <Route path="/weekly-briefs" element={<WeeklyBriefsPage />} />
        <Route path="/daily-briefs" element={<Navigate to="/weekly-briefs" replace />} />
      </Route>
    </Routes>
  )
}

function ProtectedApp() {
  const { loading, authenticated } = useAuth()

  if (loading) return <AuthenticationLoading />
  if (!authenticated) return <Navigate to="/login" replace />

  return (
    <div className="app-shell">
      <AppHeader />
      <Outlet />
    </div>
  )
}

function LoginRoute() {
  const { loading, authenticated } = useAuth()

  if (loading) return <AuthenticationLoading />
  if (authenticated) return <Navigate to="/" replace />

  return <LoginPage />
}

function AuthenticationLoading() {
  return (
    <main className="auth-loading" aria-live="polite" aria-busy="true">
      正在确认登录状态…
    </main>
  )
}
