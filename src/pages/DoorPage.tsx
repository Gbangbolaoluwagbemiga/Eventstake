import { useParams, useNavigate } from 'react-router-dom'
import { useReadContract } from 'wagmi'
import { ArrowLeft, RefreshCw, Clock } from 'lucide-react'
import { motion } from 'framer-motion'
import { useState, useEffect } from 'react'
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../contract'
import { type EventData } from '../components/EventCard'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function DoorPage() {
  const { eventId } = useParams<{ eventId: string }>()
  const navigate = useNavigate()
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  const id = BigInt(eventId ?? '0')

  const { data: evt, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getEvent',
    args: [id],
    query: { enabled: id > 0n, refetchInterval: 15000 },
  }) as { data: EventData | undefined; refetch: () => void }

  // Update time every second
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  const windowIndex = evt && evt.codeWindowDuration > 0n
    ? Number((BigInt(now) - evt.date) / evt.codeWindowDuration)
    : 0

  const windowSecondsElapsed = evt && evt.codeWindowDuration > 0n
    ? Number((BigInt(now) - evt.date) % evt.codeWindowDuration)
    : 0

  const windowSecondsLeft = evt && evt.codeWindowDuration > 0n
    ? Number(evt.codeWindowDuration) - windowSecondsElapsed
    : 0

  const isCheckInOpen = evt && BigInt(now) >= evt.date && BigInt(now) <= evt.date + 2n * 86400n

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'var(--accent)', color: '#fff' }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.15)' }}
      >
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm font-medium"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.8)' }}
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.6)' }}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Event name */}
      {evt && (
        <div className="px-5 pt-4">
          <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
            {evt.name}
          </p>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 text-center">
        {!evt ? (
          <div className="animate-pulse space-y-4">
            <div className="h-16 rounded-xl" style={{ background: 'rgba(255,255,255,0.15)', width: 200 }} />
          </div>
        ) : !isCheckInOpen ? (
          <div className="space-y-3">
            <Clock size={48} style={{ color: 'rgba(255,255,255,0.4)', margin: '0 auto' }} />
            <p className="text-lg font-semibold" style={{ color: 'rgba(255,255,255,0.8)' }}>
              {BigInt(now) < evt.date ? 'Event has not started yet' : 'Check-in window is closed'}
            </p>
          </div>
        ) : (
          <motion.div
            key={windowIndex}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="space-y-6 w-full"
          >
            {/* Window info */}
            <div className="flex items-center justify-center gap-2" style={{ color: 'rgba(255,255,255,0.7)' }}>
              <Clock size={14} />
              <span className="text-sm">
                Window {windowIndex + 1} — resets in {formatTime(windowSecondsLeft)}
              </span>
            </div>

            {/* Big display */}
            <div
              className="rounded-2xl p-6 mx-auto"
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                maxWidth: 360,
              }}
            >
              <p className="text-xs font-semibold mb-3" style={{ color: 'rgba(255,255,255,0.6)', letterSpacing: '0.08em' }}>
                CURRENT WINDOW
              </p>
              <p className="display font-bold text-4xl" style={{ letterSpacing: '-0.03em', wordBreak: 'break-all' }}>
                {windowIndex + 1}
              </p>
              <p className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.7)' }}>
                Show attendees their personal QR code generated from your venue secret for this window.
              </p>
            </div>

            {/* Instructions */}
            <div
              className="rounded-xl p-4 text-left"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              <p className="text-xs font-semibold mb-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
                HOW TO GENERATE ATTENDEE CODES
              </p>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.8)', lineHeight: 1.6 }}>
                For window {windowIndex + 1}: take your secret for this window and compute<br />
                <code className="mono text-xs" style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4 }}>
                  keccak256(secret || attendeeAddress)
                </code><br />
                Share that hex value with each attendee as their personal check-in code.
              </p>
            </div>

            {/* Live count */}
            <div className="flex items-center justify-center gap-6">
              <div className="text-center">
                <p className="display font-bold text-5xl">{String(evt.checkedInCount)}</p>
                <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>checked in</p>
              </div>
              <div className="text-center" style={{ color: 'rgba(255,255,255,0.4)' }}>
                <p className="display text-3xl">/</p>
              </div>
              <div className="text-center">
                <p className="display font-bold text-5xl">{String(evt.registeredCount)}</p>
                <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>registered</p>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
