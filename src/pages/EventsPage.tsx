import { useNavigate } from 'react-router-dom'
import { useAccount, useReadContract } from 'wagmi'
import { Plus, Calendar } from 'lucide-react'
import { motion } from 'framer-motion'
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../contract'
import EventCard, { type EventData } from '../components/EventCard'

function SkeletonCard() {
  return (
    <div
      className="rounded-2xl p-4 flex items-start gap-3 animate-pulse"
      style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', height: 88 }}
    >
      <div className="rounded-xl" style={{ width: 48, height: 48, background: 'var(--surface-muted)' }} />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-4 rounded" style={{ background: 'var(--surface-muted)', width: '60%' }} />
        <div className="h-3 rounded" style={{ background: 'var(--surface-muted)', width: '40%' }} />
        <div className="h-3 rounded" style={{ background: 'var(--surface-muted)', width: '30%' }} />
      </div>
    </div>
  )
}

export default function EventsPage() {
  const navigate = useNavigate()
  const { isConnected } = useAccount()

  const { data: rawEvents, isLoading } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getEvents',
    args: [],
  })

  const events = (rawEvents as EventData[] | undefined) ?? []
  const sorted = [...events].sort((a, b) => Number(a.date - b.date))

  return (
    <div className="py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="display font-bold text-xl" style={{ color: 'var(--ink)' }}>
          Events
        </h1>
        {isConnected && (
          <button
            onClick={() => navigate('/create')}
            className="flex items-center gap-1.5 rounded-xl font-semibold text-xs px-3"
            style={{
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              minHeight: '36px',
              cursor: 'pointer',
            }}
          >
            <Plus size={14} />
            Create
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : sorted.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl p-8 text-center"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <Calendar size={32} style={{ color: 'var(--subtle)', margin: '0 auto 12px' }} />
          <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
            No events yet
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            Be the first to create one
          </p>
          {isConnected && (
            <button
              onClick={() => navigate('/create')}
              className="mt-4 flex items-center gap-2 rounded-xl font-semibold text-sm mx-auto px-4"
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                minHeight: '44px',
                cursor: 'pointer',
              }}
            >
              <Plus size={15} />
              Create an Event
            </button>
          )}
        </motion.div>
      ) : (
        <motion.div
          className="space-y-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {sorted.map(evt => (
            <EventCard key={String(evt.id)} event={evt} />
          ))}
        </motion.div>
      )}
    </div>
  )
}
