import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Loader2, CheckCircle, ArrowLeft, KeyRound } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { toBytes, pad } from 'viem'
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../contract'
import { type EventData } from '../components/EventCard'

/**
 * Check-in flow:
 * The organiser stores keccak256(abi.encodePacked(preimage, attendeeAddress)) for each window.
 * The organiser distributes the raw preimage (a hex string like 0xabc123...).
 * The attendee submits the exact preimage bytes32.
 * The contract verifies: keccak256(preimage || msg.sender) == stored hash.
 *
 * For UX: accept a hex string (with or without 0x prefix), or a short alphanumeric code.
 * Encode as bytes32 by padding to 32 bytes.
 */
function encodePreimage(code: string): `0x${string}` {
  const trimmed = code.trim()
  // If it looks like a hex string (0x prefix or all hex chars, exactly 64 hex chars)
  const hexPrefixed = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`
  const hexBody = hexPrefixed.slice(2)
  if (/^[0-9a-fA-F]{1,64}$/.test(hexBody)) {
    // Pad to 32 bytes (left-pad with zeros to make it exactly 64 hex chars)
    const padded = hexBody.padStart(64, '0')
    return `0x${padded}`
  }
  // Otherwise treat as UTF-8 and pad to 32 bytes
  const encoded = toBytes(trimmed)
  if (encoded.length > 32) {
    throw new Error('Code is too long (max 32 characters)')
  }
  return pad(encoded, { size: 32 }) as unknown as `0x${string}`
}

export default function CheckInPage() {
  const { eventId } = useParams<{ eventId: string }>()
  const navigate = useNavigate()
  const { isConnected } = useAccount()

  const [code, setCode] = useState('')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [isPending, setIsPending] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const [encodeError, setEncodeError] = useState('')

  const id = BigInt(eventId ?? '0')

  const { data: evt } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getEvent',
    args: [id],
    query: { enabled: id > 0n },
  }) as { data: EventData | undefined }

  const { writeContractAsync } = useWriteContract()

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
    onReplaced: () => toast.error('Transaction replaced'),
  })

  async function handleCheckIn() {
    if (!code.trim()) { toast.error('Enter the venue code'); return }
    setEncodeError('')

    let preimage: `0x${string}`
    try {
      preimage = encodePreimage(code)
    } catch (e: unknown) {
      setEncodeError((e as Error).message)
      return
    }

    try {
      setIsPending(true)
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'checkIn',
        args: [id, preimage],
      })
      setTxHash(hash)
      toast.success('Check-in submitted!')
      setSucceeded(true)
    } catch (e: unknown) {
      setIsPending(false)
      const msg = (e as Error).message ?? ''
      if (msg.includes('InvalidCodeForAttendee')) {
        toast.error('Wrong code — check with the organiser')
      } else if (msg.includes('AlreadyCheckedIn')) {
        toast.error('You have already checked in')
      } else if (msg.includes('CheckInWindowClosed')) {
        toast.error('The check-in window is closed')
      } else {
        toast.error(msg.slice(0, 80) || 'Transaction failed')
      }
    }
  }

  if (!isConnected) {
    return (
      <div className="py-8 text-center space-y-4">
        <p className="font-semibold" style={{ color: 'var(--ink)' }}>
          Connect your wallet to check in
        </p>
        <ConnectKitButton />
      </div>
    )
  }

  if (succeeded) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35 }}
        className="py-12 flex flex-col items-center justify-center text-center space-y-5"
      >
        <div
          className="rounded-full flex items-center justify-center"
          style={{ width: 80, height: 80, background: '#f0fdf4', border: '2px solid #bbf7d0' }}
        >
          <CheckCircle size={40} style={{ color: 'var(--success)' }} />
        </div>
        <div>
          <h2 className="display font-bold text-2xl" style={{ color: 'var(--ink)' }}>
            You are checked in!
          </h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
            Claim your stake back from your events page.
          </p>
        </div>
        <Link
          to="/my/events"
          className="flex items-center justify-center gap-2 rounded-xl font-semibold text-sm w-full"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            textDecoration: 'none',
            minHeight: '48px',
            padding: '0 20px',
          }}
        >
          Go to My Events
        </Link>
      </motion.div>
    )
  }

  const isLoading = isPending || isConfirming

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="py-4 space-y-6"
    >
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 0 }}
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div>
        <h1 className="display font-bold text-2xl" style={{ color: 'var(--ink)' }}>
          Check In
        </h1>
        {evt && (
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            {evt.name}
          </p>
        )}
      </div>

      {/* Code input — big, finger-friendly */}
      <div
        className="rounded-2xl p-5 space-y-4"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <KeyRound size={18} style={{ color: 'var(--accent)' }} />
          <label
            htmlFor="code-input"
            className="font-semibold text-sm"
            style={{ color: 'var(--ink)' }}
          >
            Venue code
          </label>
        </div>
        <input
          id="code-input"
          type="text"
          value={code}
          onChange={e => { setCode(e.target.value); setEncodeError('') }}
          placeholder="Paste or type the code from the organiser"
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="w-full rounded-xl mono text-base"
          style={{
            padding: '14px 16px',
            minHeight: '52px',
            background: 'var(--surface-muted)',
            border: encodeError ? '1.5px solid var(--danger)' : '1px solid var(--border)',
            color: 'var(--ink)',
            outline: 'none',
            fontSize: '16px', // prevent iOS zoom
          }}
          onKeyDown={e => { if (e.key === 'Enter') { void handleCheckIn() } }}
        />
        {encodeError && (
          <p className="text-xs" style={{ color: 'var(--danger)' }}>{encodeError}</p>
        )}
        <p className="text-xs" style={{ color: 'var(--subtle)' }}>
          The organiser will display a code. Enter it exactly as shown — it is case-sensitive.
        </p>
      </div>

      <button
        onClick={() => { void handleCheckIn() }}
        disabled={isLoading || !code.trim()}
        className="w-full flex items-center justify-center gap-2 rounded-xl font-semibold text-base"
        style={{
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          minHeight: '56px',
          opacity: isLoading || !code.trim() ? 0.65 : 1,
          cursor: isLoading || !code.trim() ? 'not-allowed' : 'pointer',
          fontSize: '16px',
        }}
      >
        {isLoading && <Loader2 size={18} className="animate-spin" />}
        {isConfirming ? 'Confirming...' : isPending ? 'Submitting...' : 'Check In'}
      </button>
    </motion.div>
  )
}
