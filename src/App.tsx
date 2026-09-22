import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { PATIENT_CHANGED_EVENT, patientProfileComplete, readPatient } from './lib/patient'
import { readSession } from './lib/mockServer'
import type { Session } from './lib/types'
import { AskSara } from './pages/AskSara'
import { DiaryReport } from './pages/DiaryReport'
import { ExerciseLog } from './pages/ExerciseLog'
import { Home } from './pages/Home'
import { Move } from './pages/Move'
import { PatientOnboarding } from './pages/PatientOnboarding'
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
        className={`min-h-dvh w-full max-w-[430px] shadow-[0_0_60px_rgba(61,58,54,0.08)] ${
          location.pathname === '/ask'
            ? 'h-dvh overflow-hidden bg-sage-mist'
            : 'bg-cream'
        }`}
      >
        <Routes location={location}>
          <Route
            path="/r/:token"
            element={session ? <Navigate to="/" replace /> : <Redeem />}
          />
          <Route path="/move" element={<Move />} />
          <Route
            path="/ask"
            element={
              <NeedSession session={session}>
                <NeedProfile>
                  <AskSara />
                </NeedProfile>
              </NeedSession>
            }
          />
          <Route
            path="/diary"
            element={
              <NeedSession session={session}>
                <NeedProfile>
                  <DiaryReport />
                </NeedProfile>
              </NeedSession>
            }
          />
          <Route
            path="/exercise"
            element={
              <NeedSession session={session}>
                <NeedProfile>
                  <ExerciseLog />
                </NeedProfile>
              </NeedSession>
            }
          />
          <Route
            path="/"
            element={
              session ? (
                <NeedProfile>
                  <Home session={session} />
                </NeedProfile>
              ) : (
                <Welcome />
              )
            }
          />
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

function NeedProfile({ children }: { children: ReactNode }) {
  const [patient, setPatient] = useState(() => readPatient())

  useEffect(() => {
    const sync = () => setPatient(readPatient())
    window.addEventListener(PATIENT_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(PATIENT_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  if (!patientProfileComplete(patient)) return <PatientOnboarding />
  return children
}
