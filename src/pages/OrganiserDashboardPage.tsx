import { useParams, useNavigate } from 'react-router-dom'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { ArrowLeft, DoorOpen, Users, Loader2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { useState } from 'react'
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../contract'
import { formatUsdc } from '@/onchain-money'
import { type EventData } from '../components/EventCard'


function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-1"
      style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
    >
      <span className="display font-bold text-xl" style={{ color: color ?? 'var(--ink)', lineHeight: 1 }}>
        {value}
      </span>
      <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
    </div>
  )
}

export default function OrganiserDashboardPage() {
  const { eventId } = useParams<{ eventId: string }>()
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const [withdrawHash, setWithdrawHash] = useState<`0x${string}` | undefined>()
  const [withdrawPending, setWithdrawPending] = useState(false)
  const [withdrawShareHash, setWithdrawShareHash] = useState<`0x${string}` | undefined>()
  const [withdrawSharePending, setWithdrawSharePending] = useState(false)

  const id = BigInt(eventId ?? '0')

  const { data: evt, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getEvent',
    args: [id],
    query: { enabled: id > 0n },
  }) as { data: EventData | undefined; refetch: () => void }

  const { data: organiserCredits } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'organiserCredits',
    args: [address!],
    query: { enabled: !!address },
  })

  const { writeContractAsync } = useWriteContract()

  const { isLoading: waitingWithdraw } = useWaitForTransactionReceipt({ hash: withdrawHash })
  const { isLoading: waitingShare } = useWaitForTransactionReceipt({ hash: withdrawShareHash })

  // Must be before any early returns (Rules of Hooks)
  const [now] = useState(() => BigInt(Math.floor(Date.now() / 1000)))

  async function handleWithdrawForfeited() {
    try {
      setWithdrawPending(true)
      const h = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'withdrawForfeited',
        args: [id],
      })
      setWithdrawHash(h)
      toast.success('Forfeit withdrawal submitted!')
      refetch()
    } catch (e: unknown) {
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
    } finally {
      setWithdrawPending(false)
    }
  }

  async function handleWithdrawShare() {
    try {
      setWithdrawSharePending(true)
      const h = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'withdrawOrganiserShare',
        args: [],
      })
      setWithdrawShareHash(h)
      toast.success('Share withdrawal submitted!')
      refetch()
    } catch (e: unknown) {
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
    } finally {
      setWithdrawSharePending(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="py-12 text-center space-y-4">
        <p className="font-semibold" style={{ color: 'var(--ink)' }}>Connect your wallet</p>
        <ConnectKitButton />
      </div>
    )
  }

  if (!evt) {
    return (
      <div className="py-4 space-y-3 animate-pulse">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 rounded-xl" style={{ background: 'var(--surface-muted)' }} />
        ))}
      </div>
    )
  }

  const eventEnded = now > evt.date + 2n * 86400n
  const isOrganiser = evt.organiser.toLowerCase() === address?.toLowerCase()

  const forfeitedCount = evt.registeredCount > evt.checkedInCount
    ? evt.registeredCount - evt.checkedInCount
    : 0n
  const forfeitedAmount = forfeitedCount * evt.stakeAmount
  const organiserShare = forfeitedAmount * 80n / 100n
  const poolShare = forfeitedAmount - organiserShare

  const credits = (organiserCredits ?? 0n)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="py-4 space-y-5"
    >
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 0 }}
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1 className="display font-bold text-lg" style={{ color: 'var(--ink)', lineHeight: 1.2 }}>
            {evt.name}
          </h1>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Organiser Dashboard</p>
        </div>
      </div>

      {!isOrganiser && (
        <div
          className="rounded-xl p-3"
          style={{ background: '#fffbeb', border: '1px solid #fde68a' }}
        >
          <p className="text-xs font-medium" style={{ color: '#92400e' }}>
            You are viewing this dashboard as a non-organiser.
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Registered" value={`${String(evt.registeredCount)} / ${String(evt.maxAttendees)}`} />
        <StatCard label="Checked In" value={String(evt.checkedInCount)} color="var(--success)" />
        <StatCard label="Forfeited" value={String(forfeitedCount)} color={forfeitedCount > 0n ? 'var(--danger)' : 'var(--muted)'} />
        <StatCard label="Pool received" value={`${formatUsdc(poolShare)} USDC`} />
      </div>

      {/* Door View */}
      <button
        onClick={() => navigate(`/organiser/${eventId}/door`)}
        className="w-full flex items-center justify-center gap-2 rounded-xl font-semibold text-sm"
        style={{
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          minHeight: '48px',
          cursor: 'pointer',
        }}
      >
        <DoorOpen size={16} />
        Open Door View
      </button>

      {/* Withdraw forfeited */}
      {isOrganiser && eventEnded && !evt.forfeitWithdrawn && (
        <button
          onClick={() => { void handleWithdrawForfeited() }}
          disabled={withdrawPending || waitingWithdraw}
          className="w-full flex items-center justify-center gap-2 rounded-xl font-semibold text-sm"
          style={{
            background: 'var(--surface-strong)',
            color: 'var(--accent)',
            border: '1.5px solid var(--border-strong)',
            minHeight: '48px',
            opacity: withdrawPending || waitingWithdraw ? 0.65 : 1,
            cursor: withdrawPending || waitingWithdraw ? 'not-allowed' : 'pointer',
          }}
        >
          {(withdrawPending || waitingWithdraw) && <Loader2 size={15} className="animate-spin" />}
          Distribute Forfeit ({formatUsdc(organiserShare)} USDC to you)
        </button>
      )}

      {/* Withdraw organiser share */}
      {isOrganiser && credits > 0n && (
        <button
          onClick={() => { void handleWithdrawShare() }}
          disabled={withdrawSharePending || waitingShare}
          className="w-full flex items-center justify-center gap-2 rounded-xl font-semibold text-sm"
          style={{
            background: 'var(--success)',
            color: '#fff',
            border: 'none',
            minHeight: '48px',
            opacity: withdrawSharePending || waitingShare ? 0.65 : 1,
            cursor: withdrawSharePending || waitingShare ? 'not-allowed' : 'pointer',
          }}
        >
          {(withdrawSharePending || waitingShare) && <Loader2 size={15} className="animate-spin" />}
          Withdraw {formatUsdc(credits)} USDC
        </button>
      )}

      {/* Registered attendees summary */}
      <div
        className="rounded-2xl p-4 space-y-3"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <Users size={16} style={{ color: 'var(--accent)' }} />
          <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Attendees</p>
        </div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {String(evt.registeredCount)} registered, {String(evt.checkedInCount)} checked in
        </p>
        <p className="text-xs" style={{ color: 'var(--subtle)' }}>
          Individual attendee list requires querying on-chain events. View the event page or use the door view for real-time check-in counts.
        </p>
      </div>
    </motion.div>
  )
}
