import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { readSession } from './lib/mockServer'
import type { Session } from './lib/types'
import { AskSara } from './pages/AskSara'
import { Home } from './pages/Home'
import { Move } from './pages/Move'
import { Redeem } from './pages/Redeem'
import { Welcome } from './pages/Welcome'

export default function App() {
  const location = useLocation()
  const [session, setSession] = useState<Session | null>(() => readSession())

  useEffect(() => {
    const sync = () => setSession(readSession())
    window.addEventListener('sara-session', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('sara-session', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return (
    <div className="flex min-h-dvh justify-center bg-[#E8E3DA]">
      <div
        className={`min-h-dvh w-full max-w-[430px] bg-cream shadow-[0_0_60px_rgba(61,58,54,0.08)] ${
          location.pathname === '/ask' ? 'h-dvh overflow-hidden' : ''
        }`}
      >
        <Routes location={location}>
          <Route path="/r/:token" element={<Redeem />} />
          <Route path="/move" element={<Move />} />
          <Route
            path="/ask"
            element={
              <NeedSession session={session}>
                <AskSara />
              </NeedSession>
            }
          />
          <Route path="/" element={session ? <Home session={session} /> : <Welcome />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  )
}

function NeedSession({
  session,
  children,
}: {
  session: Session | null
  children: ReactNode
}) {
  if (!session) return <Navigate to="/" replace />
  return children
}
