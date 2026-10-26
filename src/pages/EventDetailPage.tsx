import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Share2, Calendar, ArrowLeft, Loader2, CheckCircle, Shield } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../contract'
import { formatUsdc } from '@/onchain-money'
import { getUsdc } from '@/onchain-facts'
import { buildShareLink } from '../lib/share'
import { type EventData } from '../components/EventCard'

const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

function formatEventDate(ts: bigint) {
  return new Date(Number(ts) * 1000).toLocaleString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>{value}</span>
    </div>
  )
}

type Phase = 'idle' | 'approving' | 'registering' | 'requesting-cover' | 'done'

export default function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>()
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const chainId = useChainId()

  const [phase, setPhase] = useState<Phase>('idle')
  const [approveHash, setApproveHash] = useState<`0x${string}` | undefined>()
  const [registerHash, setRegisterHash] = useState<`0x${string}` | undefined>()
  const [coverHash, setCoverHash] = useState<`0x${string}` | undefined>()

  const id = BigInt(eventId ?? '0')
  const usdcAddress = getUsdc(chainId)?.address as `0x${string}` | undefined

  const { data: evt, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getEvent',
    args: [id],
    query: { enabled: id > 0n },
  }) as { data: EventData | undefined; refetch: () => void }

  const { data: isReg } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'isRegistered',
    args: [id, address!],
    query: { enabled: !!address && id > 0n },
  })

  const { data: isChecked } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'isCheckedIn',
    args: [id, address!],
    query: { enabled: !!address && id > 0n },
  })

  const { data: creditScore } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getCreditScore',
    args: [address!],
    query: { enabled: !!address },
  }) as { data: [bigint, string, string] | undefined }

  const { data: coverElig } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getCoverEligibility',
    args: [address!, id],
    query: { enabled: !!address && id > 0n },
  }) as { data: [boolean, string] | undefined }

  const { data: allowance } = useReadContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address!, CONTRACT_ADDRESS],
    query: { enabled: !!address && !!usdcAddress },
  })

  const { writeContractAsync } = useWriteContract()

  const { isLoading: waitingApprove, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash })
  const { isLoading: waitingRegister } = useWaitForTransactionReceipt({ hash: registerHash })
  const { isLoading: waitingCover } = useWaitForTransactionReceipt({ hash: coverHash })

  const [now] = useState(() => BigInt(Math.floor(Date.now() / 1000)))
  const isRegistrationOpen = evt && !evt.cancelled && now >= evt.registrationStart && now <= evt.registrationEnd
  const stakeAmount = evt?.stakeAmount ?? 0n
  const needsApprove = (allowance ?? 0n) < stakeAmount

  async function handleRegister() {
    if (!evt || !usdcAddress) return
    try {
      if (needsApprove) {
        setPhase('approving')
        const appHash = await writeContractAsync({
          address: usdcAddress,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [CONTRACT_ADDRESS, stakeAmount],
        })
        setApproveHash(appHash)
        // Wait for approve to confirm, then register
        // We rely on the transaction receipt hook flow
        toast.info('Approving USDC...')
      } else {
        await doRegister()
      }
    } catch (e: unknown) {
      setPhase('idle')
      toast.error((e as Error).message?.slice(0, 80) ?? 'Transaction failed')
    }
  }

  async function doRegister() {
    try {
      setPhase('registering')
      const regHash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'register',
        args: [id],
      })
      setRegisterHash(regHash)
      toast.success('Registration submitted!')
      refetch()
      setPhase('done')
    } catch (e: unknown) {
      setPhase('idle')
      toast.error((e as Error).message?.slice(0, 80) ?? 'Transaction failed')
    }
  }

  // When approve succeeds, proceed to register
  if (approveSuccess && phase === 'approving') {
    queueMicrotask(() => { void doRegister() })
  }

  async function handleCover() {
    if (!evt) return
    try {
      setPhase('requesting-cover')
      const h = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'requestCover',
        args: [id],
      })
      setCoverHash(h)
      toast.info('Cover request submitted...')
      refetch()
      setPhase('done')
    } catch (e: unknown) {
      setPhase('idle')
      toast.error((e as Error).message?.slice(0, 80) ?? 'Transaction failed')
    }
  }

  if (!evt) {
    return (
      <div className="py-4 space-y-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 rounded-xl" style={{ background: 'var(--surface-muted)' }} />
          ))}
        </div>
      </div>
    )
  }

  const organiserPct = evt.stakeAmount * 80n / 100n
  const poolPct = evt.stakeAmount - organiserPct

  const score = creditScore ? Number(creditScore[0]) : 0
  const scoreLabel = creditScore ? creditScore[1] : 'new'

  const isActive = phase === 'approving' || phase === 'registering' || phase === 'requesting-cover'
    || waitingApprove || waitingRegister || waitingCover

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="py-4 space-y-5"
    >
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 0 }}
      >
        <ArrowLeft size={16} /> Back
      </button>

      {/* Event header */}
      <div>
        <h1
          className="display font-bold leading-tight"
          style={{ fontSize: '24px', color: 'var(--ink)' }}
        >
          {evt.name}
        </h1>
        <p className="text-sm mt-1 flex items-center gap-2" style={{ color: 'var(--muted)' }}>
          <Calendar size={14} />
          {formatEventDate(evt.date)}
        </p>
      </div>

      {/* Info card */}
      <div
        className="rounded-2xl p-4"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <InfoRow label="Stake to register" value={`${formatUsdc(evt.stakeAmount)} USDC`} />
        <InfoRow label="If you miss it — organiser gets" value={`${formatUsdc(organiserPct)} USDC (80%)`} />
        <InfoRow label="If you miss it — pool gets" value={`${formatUsdc(poolPct)} USDC (20%)`} />
        <InfoRow label="Registered" value={`${String(evt.registeredCount)} / ${String(evt.maxAttendees)}`} />
        <div className="flex items-center justify-between py-2">
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Status</span>
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{
              color: evt.cancelled ? 'var(--danger)' : isRegistrationOpen ? 'var(--success)' : 'var(--subtle)',
              background: evt.cancelled ? '#fff0f3' : isRegistrationOpen ? '#f0fdf4' : 'var(--surface-muted)',
            }}
          >
            {evt.cancelled ? 'Cancelled' : isRegistrationOpen ? 'Registration open' : now < evt.registrationStart ? 'Upcoming' : 'Closed'}
          </span>
        </div>
      </div>

      {/* User state */}
      {isChecked && (
        <div
          className="rounded-xl p-4 flex items-center gap-3"
          style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}
        >
          <CheckCircle size={20} style={{ color: 'var(--success)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
            You have checked in to this event
          </p>
        </div>
      )}

      {isReg && !isChecked && (
        <div
          className="rounded-xl p-4 flex items-center gap-3"
          style={{ background: '#fffbeb', border: '1px solid #fde68a' }}
        >
          <Shield size={20} style={{ color: '#c97800' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#92400e' }}>
              You are registered
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#a16207' }}>
              Check in at the event to reclaim your stake
            </p>
          </div>
        </div>
      )}

      {/* Actions */}
      {!isConnected && (
        <div className="text-center py-4">
          <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
            Connect your wallet to register
          </p>
          <ConnectKitButton />
        </div>
      )}

      {isConnected && isRegistrationOpen && !isReg && !isChecked && (
        <div className="space-y-3">
          {/* Credit score chip */}
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Your score:</span>
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{
                color: scoreLabel === 'trusted' ? 'var(--success)' : scoreLabel === 'new' ? 'var(--subtle)' : 'var(--ink)',
                background: 'var(--surface-muted)',
              }}
            >
              {score} — {scoreLabel}
            </span>
          </div>

          <button
            onClick={() => { void handleRegister() }}
            disabled={isActive}
            className="w-full flex items-center justify-center gap-2 rounded-xl font-semibold text-sm"
            style={{
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              minHeight: '48px',
              opacity: isActive ? 0.65 : 1,
              cursor: isActive ? 'not-allowed' : 'pointer',
            }}
          >
            {isActive && <Loader2 size={16} className="animate-spin" />}
            {phase === 'approving' || waitingApprove
              ? 'Approving USDC...'
              : phase === 'registering' || waitingRegister
              ? 'Registering...'
              : `Register — ${formatUsdc(evt.stakeAmount)} USDC`}
          </button>

          {/* Cover button */}
          <button
            onClick={() => { void handleCover() }}
            disabled={isActive || !coverElig?.[0]}
            className="w-full flex items-center justify-center gap-2 rounded-xl font-semibold text-sm"
            style={{
              background: 'transparent',
              color: 'var(--accent)',
              border: '1.5px solid var(--border-strong)',
              minHeight: '48px',
              opacity: isActive || !coverElig?.[0] ? 0.5 : 1,
              cursor: isActive || !coverElig?.[0] ? 'not-allowed' : 'pointer',
            }}
          >
            {phase === 'requesting-cover' || waitingCover
              ? <><Loader2 size={16} className="animate-spin" /> Requesting cover...</>
              : 'Request Cover (no USDC needed)'}
          </button>

          {coverElig && !coverElig[0] && (
            <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>
              Cover unavailable: {coverElig[1]}
            </p>
          )}
        </div>
      )}

      {/* Check-in button (when event is in check-in window) */}
      {isReg && !isChecked && now >= evt.date && (
        <button
          onClick={() => navigate(`/checkin/${eventId}`)}
          className="w-full flex items-center justify-center gap-2 rounded-xl font-semibold text-sm"
          style={{
            background: 'var(--success)',
            color: '#fff',
            border: 'none',
            minHeight: '48px',
            cursor: 'pointer',
          }}
        >
          Check In Now
        </button>
      )}

      {/* Share */}
      <button
        onClick={() => {
          const link = buildShareLink(`/events/${eventId}`)
          void navigator.clipboard?.writeText(link).then(() => toast.success('Link copied!'))
        }}
        className="w-full flex items-center justify-center gap-2 rounded-xl font-semibold text-sm"
        style={{
          background: 'var(--surface-muted)',
          color: 'var(--ink)',
          border: '1px solid var(--border)',
          minHeight: '44px',
          cursor: 'pointer',
        }}
      >
        <Share2 size={15} />
        Share Event
      </button>
    </motion.div>
  )
}
