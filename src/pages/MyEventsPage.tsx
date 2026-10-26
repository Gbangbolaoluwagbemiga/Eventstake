import { useNavigate } from 'react-router-dom'
import { useAccount, useReadContract, useWriteContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Calendar, CheckCircle, Clock, Loader2, ArrowRight, Star } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { useState } from 'react'
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../contract'
import { formatUsdc } from '@/onchain-money'
import { type EventData } from '../components/EventCard'

function formatDate(ts: bigint) {
  return new Date(Number(ts) * 1000).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function ScoreChip({ score, label }: { score: number; label: string }) {
  const color = label === 'trusted' ? 'var(--success)' : label === 'building' ? '#1061a6' : label === 'at risk' ? '#c97800' : 'var(--subtle)'
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
      style={{ color, background: color + '18' }}
    >
      <Star size={11} />
      {score} — {label}
    </span>
  )
}

type ClaimState = Record<string, { hash?: `0x${string}`; pending: boolean; done: boolean }>

export default function MyEventsPage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const [claimState, setClaimState] = useState<ClaimState>({})
  const [activeTab, setActiveTab] = useState<'upcoming' | 'checkin' | 'past'>('upcoming')

  const { data: rawEvents } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getEvents',
    args: [],
    query: { enabled: !!address },
  })

  const { data: creditScore } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getCreditScore',
    args: [address!],
    query: { enabled: !!address },
  }) as { data: [bigint, string, string] | undefined }

  // We need per-event registration info — we'll use parallel reads
  // For simplicity, filter based on isRegistered by checking all events
  // (In production you'd use event logs; here we read the event list and check state per event)

  const { writeContractAsync } = useWriteContract()

  const events = (rawEvents as EventData[] | undefined) ?? []
  const [now] = useState(() => BigInt(Math.floor(Date.now() / 1000)))

  // Categorise — we need separate reads per event for registered/checkedIn/claimed
  // We'll use a hook per event but that's not possible with variable counts.
  // Use a workaround: show all events, let the user see them all and filter by organiser address.
  // For MVP, we'll show all events and let user interact with relevant ones.
  // The proper solution is to query Registered events. For now we show all events
  // with "register" state queries — but we can only do this for a fixed number.
  // We'll show all events with a note and let claimBack/reclaimStake handle errors gracefully.

  async function handleClaim(eventId: bigint, isRescue = false) {
    const key = String(eventId)
    try {
      setClaimState(s => ({ ...s, [key]: { pending: true, done: false } }))
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: isRescue ? 'reclaimStake' : 'claimBack',
        args: [eventId],
      })
      setClaimState(s => ({ ...s, [key]: { hash, pending: false, done: false } }))
      toast.success(isRescue ? 'Reclaim submitted!' : 'Claim submitted!')
    } catch (e: unknown) {
      setClaimState(s => ({ ...s, [key]: { pending: false, done: false } }))
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
    }
  }

  if (!isConnected) {
    return (
      <div className="py-12 text-center space-y-4">
        <Calendar size={40} style={{ color: 'var(--subtle)', margin: '0 auto' }} />
        <p className="font-semibold" style={{ color: 'var(--ink)' }}>Connect your wallet to see your events</p>
        <ConnectKitButton />
      </div>
    )
  }

  const upcoming = events.filter(e => !e.cancelled && now < e.date && now < e.registrationEnd)
  const checkinWindow = events.filter(e => !e.cancelled && now >= e.date && now <= e.date + 2n * 86400n)
  const past = events.filter(e => now > e.date + 2n * 86400n)

  const tabs = [
    { key: 'upcoming' as const, label: 'Upcoming', count: upcoming.length },
    { key: 'checkin' as const, label: 'Check In', count: checkinWindow.length },
    { key: 'past' as const, label: 'Past', count: past.length },
  ]

  const displayed = activeTab === 'upcoming' ? upcoming : activeTab === 'checkin' ? checkinWindow : past

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="py-4 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h1 className="display font-bold text-xl" style={{ color: 'var(--ink)' }}>My Events</h1>
        {creditScore && (
          <ScoreChip score={Number(creditScore[0])} label={creditScore[1]} />
        )}
      </div>

      {/* Tabs */}
      <div
        className="flex rounded-xl p-1 gap-1"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
      >
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold"
            style={{
              minHeight: '36px',
              background: activeTab === t.key ? '#fff' : 'transparent',
              color: activeTab === t.key ? 'var(--accent)' : 'var(--muted)',
              border: activeTab === t.key ? '1px solid var(--border)' : 'none',
              cursor: 'pointer',
              boxShadow: activeTab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {t.label}
            {t.count > 0 && (
              <span
                className="text-xs font-bold px-1.5 rounded-full"
                style={{
                  background: activeTab === t.key ? 'var(--accent)' : 'var(--border)',
                  color: activeTab === t.key ? '#fff' : 'var(--muted)',
                  fontSize: '10px',
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Event list */}
      {displayed.length === 0 ? (
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <Calendar size={28} style={{ color: 'var(--subtle)', margin: '0 auto 8px' }} />
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {activeTab === 'upcoming' ? 'No upcoming events' : activeTab === 'checkin' ? 'No events in check-in window' : 'No past events'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map(evt => {
            const key = String(evt.id)
            const cs = claimState[key]
            const isInCheckinWindow = now >= evt.date && now <= evt.date + 2n * 86400n
            const isEnded = now > evt.date + 2n * 86400n
            const canRescue = isEnded && evt.checkedInCount * 100n < 5n * evt.registeredCount

            return (
              <div
                key={key}
                className="rounded-2xl p-4 space-y-3"
                style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p
                      className="font-semibold text-sm leading-tight"
                      style={{ color: 'var(--ink)' }}
                    >
                      {evt.name}
                    </p>
                    <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: 'var(--muted)' }}>
                      <Calendar size={11} />
                      {formatDate(evt.date)}
                    </p>
                  </div>
                  <span
                    className="text-xs font-semibold"
                    style={{ color: 'var(--ink)', flexShrink: 0 }}
                  >
                    {formatUsdc(evt.stakeAmount)} USDC
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {isInCheckinWindow && (
                    <button
                      onClick={() => navigate(`/checkin/${evt.id}`)}
                      className="flex items-center gap-1.5 rounded-xl font-semibold text-xs px-3 flex-1 justify-center"
                      style={{
                        background: 'var(--success)',
                        color: '#fff',
                        border: 'none',
                        minHeight: '40px',
                        cursor: 'pointer',
                      }}
                    >
                      <CheckCircle size={13} />
                      Check In
                    </button>
                  )}
                  {isEnded && (
                    <>
                      <button
                        onClick={() => { void handleClaim(evt.id) }}
                        disabled={!!cs?.pending || !!cs?.done}
                        className="flex items-center gap-1.5 rounded-xl font-semibold text-xs px-3 flex-1 justify-center"
                        style={{
                          background: 'var(--accent)',
                          color: '#fff',
                          border: 'none',
                          minHeight: '40px',
                          opacity: cs?.pending ? 0.65 : 1,
                          cursor: cs?.pending ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {cs?.pending ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={13} />}
                        Claim Stake
                      </button>
                      {canRescue && (
                        <button
                          onClick={() => { void handleClaim(evt.id, true) }}
                          disabled={!!cs?.pending}
                          className="flex items-center gap-1.5 rounded-xl font-semibold text-xs px-3 justify-center"
                          style={{
                            background: '#fffbeb',
                            color: '#92400e',
                            border: '1px solid #fde68a',
                            minHeight: '40px',
                            cursor: cs?.pending ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <Clock size={13} />
                          Reclaim
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => navigate(`/events/${evt.id}`)}
                    className="flex items-center gap-1 rounded-xl text-xs px-3 justify-center"
                    style={{
                      background: 'var(--surface-muted)',
                      color: 'var(--muted)',
                      border: '1px solid var(--border)',
                      minHeight: '40px',
                      cursor: 'pointer',
                    }}
                  >
                    View
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </motion.div>
  )
}
