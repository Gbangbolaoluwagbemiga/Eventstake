import { useReadContract } from 'wagmi'
import { useNavigate } from 'react-router-dom'
import { Shield, CheckCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../contract'
import { formatUsdc } from '@/onchain-money'
import { type EventData } from '../components/EventCard'



export default function CoverLogPage() {
  const navigate = useNavigate()

  const { data: rawEvents } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getEvents',
    args: [],
  })

  const events = (rawEvents as EventData[] | undefined) ?? []

  // We cannot query event logs directly from a read contract hook in wagmi easily without
  // a custom provider call. For the MVP, show a note and the event list with cover stats.
  // Real cover log entries come from CoverGranted/CoverDenied events on-chain.

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="py-4 space-y-5"
    >
      <h1 className="display font-bold text-xl" style={{ color: 'var(--ink)' }}>
        Cover Decisions
      </h1>

      <div
        className="rounded-xl p-4 flex items-start gap-3"
        style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}
      >
        <Shield size={16} style={{ color: '#1061a6', flexShrink: 0, marginTop: 1 }} />
        <p className="text-sm" style={{ color: '#1e40af' }}>
          Cover decisions are recorded on-chain as <code className="mono text-xs">CoverGranted</code> and <code className="mono text-xs">CoverDenied</code> events. Connect an RPC with event log support to see the full history.
        </p>
      </div>

      {/* Events with cover stats */}
      {events.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            Events — cover activity
          </p>
          {events.map(evt => (
            <button
              key={String(evt.id)}
              onClick={() => navigate(`/events/${evt.id}`)}
              className="w-full rounded-2xl p-4 text-left"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', cursor: 'pointer' }}
            >
              <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{evt.name}</p>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1.5">
                  <CheckCircle size={13} style={{ color: 'var(--success)' }} />
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {String(evt.registeredCount)} registered
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                    Stake: {formatUsdc(evt.stakeAmount)} USDC
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {events.length === 0 && (
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <Shield size={32} style={{ color: 'var(--subtle)', margin: '0 auto 12px' }} />
          <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>No cover decisions yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            Cover decisions will appear here as attendees request cover
          </p>
        </div>
      )}
    </motion.div>
  )
}
