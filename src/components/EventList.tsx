import { useReadContract } from 'wagmi'
import { RefreshCw } from 'lucide-react'
import EventCard from './EventCard'
import { CONTRACT_ABI as ABI, CONTRACT_ADDRESS } from '../contract'
import type { EventData } from './EventCard'

const ARC_TESTNET_ID = 5042002

export default function EventList() {
  const { data: events, isLoading, error, refetch } = useReadContract({
    address: CONTRACT_ADDRESS || undefined,
    abi: ABI,
    functionName: 'getEvents',
    chainId: ARC_TESTNET_ID,
    query: {
      enabled: !!CONTRACT_ADDRESS,
      refetchInterval: 10_000,
    },
  })

  if (!CONTRACT_ADDRESS) {
    return (
      <div
        className="rounded-2xl p-6 text-center text-sm"
        style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
      >
        Contract not yet deployed — deploy EventCheckIn to Arc Testnet to see events.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map(i => (
          <div
            key={i}
            className="rounded-2xl p-5 h-40 animate-pulse"
            style={{ background: 'var(--surface-muted)' }}
          />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="rounded-2xl p-5 text-sm text-center"
        style={{ background: 'var(--surface-muted)', color: 'var(--danger)' }}
      >
        Could not load events. Check your network connection.
      </div>
    )
  }

  const eventList = (events as EventData[] | undefined) ?? []

  if (eventList.length === 0) {
    return (
      <div
        className="rounded-2xl p-8 text-center"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
          No events yet.
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
          Create the first event above.
        </p>
      </div>
    )
  }

  // Show newest first
  const sorted = [...eventList].sort((a, b) => Number(b.id) - Number(a.id))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="display text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)', letterSpacing: '0.07em' }}>
          {sorted.length} Event{sorted.length !== 1 ? 's' : ''}
        </h2>
        <button
          onClick={() => { void refetch() }}
          className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
          style={{ color: 'var(--subtle)' }}
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>
      {sorted.map(evt => (
        <EventCard key={String(evt.id)} event={evt} />
      ))}
    </div>
  )
}
