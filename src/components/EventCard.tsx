import { useNavigate } from 'react-router-dom'
import { Calendar, Users, ChevronRight } from 'lucide-react'
import { formatUsdc } from '@/onchain-money'

export interface EventData {
  id: bigint
  name: string
  registrationStart: bigint
  registrationEnd: bigint
  date: bigint
  stakeAmount: bigint
  organiser: string
  maxAttendees: bigint
  registeredCount: bigint
  checkedInCount: bigint
  codeWindowDuration: bigint
  cancelled: boolean
  forfeitWithdrawn: boolean
}

function getEventStatus(evt: EventData): { label: string; color: string; bg: string } {
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (evt.cancelled) return { label: 'Cancelled', color: 'var(--danger)', bg: '#fff0f3' }
  if (now < evt.registrationStart) return { label: 'Upcoming', color: '#1061a6', bg: '#eff6ff' }
  if (now <= evt.registrationEnd) return { label: 'Open', color: 'var(--success)', bg: '#f0fdf4' }
  if (now <= evt.date) return { label: 'Registered', color: '#c97800', bg: '#fffbeb' }
  return { label: 'Ended', color: 'var(--subtle)', bg: 'var(--surface-muted)' }
}

function formatEventDate(ts: bigint): string {
  const d = new Date(Number(ts) * 1000)
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

interface EventCardProps {
  event: EventData
  showChevron?: boolean
}

export default function EventCard({ event, showChevron = true }: EventCardProps) {
  const navigate = useNavigate()
  const status = getEventStatus(event)
  const stakeDisplay = formatUsdc(event.stakeAmount)

  return (
    <button
      onClick={() => navigate(`/events/${event.id}`)}
      className="w-full text-left rounded-2xl p-4 flex items-start gap-3"
      style={{
        background: 'var(--surface-strong)',
        border: '1px solid var(--border)',
        cursor: 'pointer',
        transition: 'box-shadow 0.15s, border-color 0.15s',
        minHeight: '44px',
      }}
    >
      {/* Date chip */}
      <div
        className="flex-shrink-0 rounded-xl flex flex-col items-center justify-center"
        style={{
          width: 48,
          height: 48,
          background: 'var(--surface-muted)',
          border: '1px solid var(--border)',
        }}
      >
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)', lineHeight: 1 }}>
          {new Date(Number(event.date) * 1000).toLocaleDateString('en-GB', { month: 'short' })}
        </span>
        <span className="display text-lg font-bold leading-tight" style={{ color: 'var(--ink)' }}>
          {new Date(Number(event.date) * 1000).getDate()}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3
            className="font-semibold text-sm leading-tight truncate"
            style={{ color: 'var(--ink)' }}
          >
            {event.name}
          </h3>
          {showChevron && <ChevronRight size={16} style={{ color: 'var(--subtle)', flexShrink: 0 }} />}
        </div>

        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
            <Calendar size={12} />
            {formatEventDate(event.date)}
          </span>
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
            <Users size={12} />
            {String(event.registeredCount)}/{String(event.maxAttendees)}
          </span>
        </div>

        <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
          <span
            className="text-xs font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            {stakeDisplay} USDC stake
          </span>
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{
              color: status.color,
              background: status.bg,
            }}
          >
            {status.label}
          </span>
        </div>
      </div>
    </button>
  )
}

export { getEventStatus, formatEventDate }
