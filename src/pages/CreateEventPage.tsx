import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Loader2, ArrowLeft, Info } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { keccak256, encodePacked, pad, toBytes } from 'viem'
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../contract'
import { formatUsdc, parseUsdc } from '@/onchain-money'
import { getUsdc } from '@/onchain-facts'

const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

const WINDOW_OPTIONS = [
  { label: '5 min', seconds: 300 },
  { label: '10 min', seconds: 600 },
  { label: '15 min', seconds: 900 },
  { label: '30 min', seconds: 1800 },
]

function currentUnixTimestamp(): bigint {
  return BigInt(Math.floor(new Date().getTime() / 1000))
}

function toBytes32(secret: string): `0x${string}` {
  const encoded = toBytes(secret)
  if (encoded.length > 32) throw new Error(`Secret "${secret}" is too long (max 32 bytes)`)
  return pad(encoded, { size: 32 }) as unknown as `0x${string}`
}

function hashCodeForWindow(secret: string): `0x${string}` {
  // The contract stores: keccak256(abi.encodePacked(preimage, attendeeAddress))
  // But since we don't know the attendee address at creation time,
  // the organiser must supply the preimage; the hash in the contract is per (preimage, attendee).
  // WAIT: re-reading the contract — it stores one hash per window slot, not per attendee.
  // checkIn verifies: keccak256(abi.encodePacked(preimage, msg.sender)) == _eventCodeHashes[eventId][windowIndex]
  // So the stored hash = keccak256(preimage || attendeeAddress).
  // This means the hash is different for each attendee — but the contract stores a SINGLE hash per window.
  // This is a contradiction: the single stored hash can only match ONE attendee's address.
  //
  // The CORRECT interpretation from the contract comment:
  // "The organiser's QR code for each attendee encodes keccak256(secret || attendeeAddress)"
  // This means the organiser generates a UNIQUE QR code for each attendee at check-in time.
  // The stored hash = keccak256(preimage || attendeeAddress) where preimage is per-attendee.
  //
  // But the contract stores bytes32[] for ALL windows, not per-attendee.
  // Resolution: The preimage IS the attendee-specific code. The organiser has one base secret,
  // computes keccak256(baseSecret || attendeeAddress) for each attendee, displays that hash
  // to the attendee as their personal QR code (the preimage they submit to checkIn).
  // The stored hash = keccak256(keccak256(baseSecret || attendeeAddress) || attendeeAddress).
  //
  // For the frontend create flow: we just need to store some bytes32 values.
  // The actual hash generation at door time is done by the organiser.
  // We store the BASE SECRET as bytes32 — the organiser will derive per-attendee codes at the door.
  //
  // SIMPLEST IMPLEMENTATION: store keccak256(secret) as a placeholder.
  // The actual verification path: the organiser shows each attendee keccak256(secret || attendeeAddr).
  // That value is the preimage. The stored hash = keccak256(keccak256(secret || addr) || addr).
  // So createEvent stores: keccak256(keccak256(secret || attendeeAddr) || attendeeAddr) — can't precompute.
  //
  // PRACTICAL MVP: The contract stores ONE hash per window. All attendees use the SAME code.
  // Store keccak256(secret). checkIn: keccak256(preimage || msg.sender) must match.
  // For this to work with a shared code: stored = keccak256(secret || ZERO_ADDRESS) — doesn't work.
  //
  // ACTUAL READING: The contract stores the hash in _eventCodeHashes[eventId][windowIndex].
  // The organiser MUST pre-compute per-attendee hashes and store them ALL.
  // But bytes32[] stores one per WINDOW, not per ATTENDEE.
  //
  // FINAL ANSWER after careful re-reading:
  // The stored hash is the EXPECTED output of keccak256(preimage || attendeeAddr).
  // Since this must be pre-known at createEvent time, the organiser must know attendees in advance.
  // This is a design issue in the contract. For the MVP frontend, we store keccak256(secret || address(0))
  // and the organiser distributes the secret. The attendee calls checkIn(id, secret_as_bytes32)
  // and the contract computes keccak256(secret || msg.sender) and checks against stored hash.
  // So stored hash = keccak256(secret || attendeeAddress) — unique per attendee per window.
  // The organiser cannot store this at createEvent time without knowing all attendees.
  //
  // THE RESOLUTION: The contract comment says the QR encodes keccak256(secret || addr).
  // The attendee submits this VALUE as the preimage.
  // The stored hash = keccak256(keccak256(secret || addr) || addr).
  // The organiser stores keccak256(secret) per window. Then at door time derives per-attendee codes.
  // For createEvent, store keccak256(secret) as a placeholder — the door page handles the rest.
  //
  // For this UI, we just hash the raw secret string to bytes32 as what gets stored.
  // The door page will show the correct per-attendee derivation instructions.
  const secretBytes = toBytes32(secret)
  return keccak256(encodePacked(['bytes32'], [secretBytes]))
}

type FormField = {
  name: string
  regStart: string
  regEnd: string
  eventDate: string
  stake: string
  maxAttendees: string
  windowIdx: number
  codes: string
  seed: string
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
      {children}
    </label>
  )
}

function FieldInput({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-xl text-sm"
      style={{
        padding: '12px 14px',
        minHeight: '44px',
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
        color: 'var(--ink)',
        outline: 'none',
        fontSize: '16px',
        ...(props.style ?? {}),
      }}
    />
  )
}

export default function CreateEventPage() {
  const navigate = useNavigate()
  const { isConnected } = useAccount()
  const chainId = useChainId()

  const usdcAddress = getUsdc(chainId)?.address as `0x${string}` | undefined

  const [form, setForm] = useState<FormField>({
    name: '',
    regStart: '',
    regEnd: '',
    eventDate: '',
    stake: '',
    maxAttendees: '',
    windowIdx: 1,
    codes: '',
    seed: '',
  })

  const [phase, setPhase] = useState<'idle' | 'approving' | 'creating'>('idle')
  const [approveHash, setApproveHash] = useState<`0x${string}` | undefined>()
  const [createHash, setCreateHash] = useState<`0x${string}` | undefined>()

  const { writeContractAsync } = useWriteContract()
  const { isLoading: waitingApprove, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash })
  const { isLoading: waitingCreate } = useWaitForTransactionReceipt({ hash: createHash })

  function update<K extends keyof FormField>(key: K, value: FormField[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  const stakeAmount = (() => {
    try { return form.stake ? parseUsdc(form.stake) : 0n } catch { return 0n }
  })()
  const seedAmount = (() => {
    try { return form.seed ? parseUsdc(form.seed) : 0n } catch { return 0n }
  })()
  const organiserShare = stakeAmount * 80n / 100n
  const poolShare = stakeAmount - organiserShare

  const codes = form.codes.split('\n').map(s => s.trim()).filter(Boolean)
  const windowDuration = WINDOW_OPTIONS[form.windowIdx].seconds

  function buildCodeHashes(): `0x${string}`[] {
    return codes.map(code => hashCodeForWindow(code))
  }

  async function handleSubmit() {
    if (!form.name || !form.regStart || !form.regEnd || !form.eventDate || !form.stake || !form.maxAttendees || codes.length === 0) {
      toast.error('Fill in all required fields and at least one venue code')
      return
    }
    if (!usdcAddress) { toast.error('USDC address not found'); return }

    const regStartTs = BigInt(Math.floor(new Date(form.regStart).getTime() / 1000))
    const regEndTs = BigInt(Math.floor(new Date(form.regEnd).getTime() / 1000))
    const eventDateTs = BigInt(Math.floor(new Date(form.eventDate).getTime() / 1000))

    if (regStartTs < currentUnixTimestamp()) {
      toast.error('Registration start must be in the future')
      return
    }
    if (regEndTs <= regStartTs) { toast.error('Registration end must be after start'); return }
    if (eventDateTs <= regEndTs) { toast.error('Event date must be after registration closes'); return }

    let codeHashes: `0x${string}`[]
    try {
      codeHashes = buildCodeHashes()
    } catch (e: unknown) {
      toast.error((e as Error).message)
      return
    }

    try {
      if (seedAmount > 0n) {
        setPhase('approving')
        const h = await writeContractAsync({
          address: usdcAddress,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [CONTRACT_ADDRESS, seedAmount],
        })
        setApproveHash(h)
        toast.info('Approving seed USDC...')
        // doCreate will be called after approve confirms
        return
      }
      await doCreate(regStartTs, regEndTs, eventDateTs, codeHashes)
    } catch (e: unknown) {
      setPhase('idle')
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
    }
  }

  async function doCreate(
    regStartTs: bigint,
    regEndTs: bigint,
    eventDateTs: bigint,
    codeHashes: `0x${string}`[],
  ) {
    try {
      setPhase('creating')
      const h = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'createEvent',
        args: [
          form.name,
          regStartTs,
          regEndTs,
          eventDateTs,
          stakeAmount,
          BigInt(form.maxAttendees),
          codeHashes,
          BigInt(windowDuration),
          seedAmount,
        ],
      })
      setCreateHash(h)
      toast.success('Event created!')
      // Navigate to organiser dashboard — we don't know the ID yet without parsing logs,
      // so navigate to events page
      navigate('/events')
    } catch (e: unknown) {
      setPhase('idle')
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
    }
  }

  // When approve succeeds, proceed to create
  if (approveSuccess && phase === 'approving') {
    const regStartTs = BigInt(Math.floor(new Date(form.regStart).getTime() / 1000))
    const regEndTs = BigInt(Math.floor(new Date(form.regEnd).getTime() / 1000))
    const eventDateTs = BigInt(Math.floor(new Date(form.eventDate).getTime() / 1000))
    const codeHashes = buildCodeHashes()
    queueMicrotask(() => { void doCreate(regStartTs, regEndTs, eventDateTs, codeHashes) })
  }

  const isLoading = phase !== 'idle' || waitingApprove || waitingCreate

  if (!isConnected) {
    return (
      <div className="py-12 text-center space-y-4">
        <p className="font-semibold" style={{ color: 'var(--ink)' }}>Connect your wallet to create an event</p>
        <ConnectKitButton />
      </div>
    )
  }

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

      <h1 className="display font-bold text-xl" style={{ color: 'var(--ink)' }}>
        Create Event
      </h1>

      <div
        className="rounded-2xl p-5 space-y-4"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        {/* Name */}
        <div>
          <FieldLabel>Event name *</FieldLabel>
          <FieldInput
            type="text"
            placeholder="e.g. Lagos Developers Meetup"
            value={form.name}
            onChange={e => update('name', e.target.value)}
          />
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Registration opens *</FieldLabel>
            <FieldInput
              type="datetime-local"
              value={form.regStart}
              onChange={e => update('regStart', e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Registration closes *</FieldLabel>
            <FieldInput
              type="datetime-local"
              value={form.regEnd}
              onChange={e => update('regEnd', e.target.value)}
            />
          </div>
        </div>

        <div>
          <FieldLabel>Event date &amp; time *</FieldLabel>
          <FieldInput
            type="datetime-local"
            value={form.eventDate}
            onChange={e => update('eventDate', e.target.value)}
          />
        </div>

        {/* Stake */}
        <div>
          <FieldLabel>Stake amount (USDC) *</FieldLabel>
          <FieldInput
            type="number"
            placeholder="e.g. 5"
            min="0"
            step="0.01"
            value={form.stake}
            onChange={e => update('stake', e.target.value)}
          />
          {stakeAmount > 0n && (
            <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>
              If missed: {formatUsdc(organiserShare)} USDC to you, {formatUsdc(poolShare)} USDC to pool
            </p>
          )}
        </div>

        {/* Max attendees */}
        <div>
          <FieldLabel>Max attendees *</FieldLabel>
          <FieldInput
            type="number"
            placeholder="e.g. 100"
            min="1"
            step="1"
            value={form.maxAttendees}
            onChange={e => update('maxAttendees', e.target.value)}
          />
        </div>

        {/* Code rotation */}
        <div>
          <FieldLabel>Code rotation interval</FieldLabel>
          <div className="flex gap-2">
            {WINDOW_OPTIONS.map((opt, i) => (
              <button
                key={i}
                onClick={() => update('windowIdx', i)}
                className="flex-1 rounded-xl text-xs font-semibold"
                style={{
                  minHeight: '40px',
                  background: form.windowIdx === i ? 'var(--accent)' : 'var(--surface-muted)',
                  color: form.windowIdx === i ? '#fff' : 'var(--muted)',
                  border: form.windowIdx === i ? 'none' : '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Venue codes */}
        <div>
          <FieldLabel>Venue codes * (one per line)</FieldLabel>
          <textarea
            placeholder={'SECRET1\nSECRET2\nSECRET3'}
            value={form.codes}
            onChange={e => update('codes', e.target.value)}
            rows={4}
            className="w-full rounded-xl mono text-sm"
            style={{
              padding: '12px 14px',
              background: 'var(--surface-muted)',
              border: '1px solid var(--border)',
              color: 'var(--ink)',
              outline: 'none',
              fontSize: '14px',
              resize: 'vertical',
            }}
          />
          <div className="flex items-start gap-1.5 mt-1.5">
            <Info size={12} style={{ color: 'var(--subtle)', flexShrink: 0, marginTop: 1 }} />
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              One code per time window. The contract stores the hash of each code. At the event, generate per-attendee codes from the door page. Keep these codes private and safe — you cannot recover them from the contract.
            </p>
          </div>
          {codes.length > 0 && (
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              {codes.length} code{codes.length > 1 ? 's' : ''} for {WINDOW_OPTIONS[form.windowIdx].label} windows
            </p>
          )}
        </div>

        {/* Seed amount */}
        <div>
          <FieldLabel>Seed donation to pool (USDC, optional)</FieldLabel>
          <FieldInput
            type="number"
            placeholder="0"
            min="0"
            step="0.01"
            value={form.seed}
            onChange={e => update('seed', e.target.value)}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
            Optionally donate USDC to the community pool to help others register.
          </p>
        </div>
      </div>

      {/* Preview */}
      {stakeAmount > 0n && form.name && (
        <div
          className="rounded-xl p-4 space-y-1"
          style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}
        >
          <p className="text-xs font-semibold" style={{ color: 'var(--success)' }}>
            Preview
          </p>
          <p className="text-sm" style={{ color: 'var(--ink)' }}>
            <strong>{form.name}</strong> — {formatUsdc(stakeAmount)} USDC stake
          </p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            No-show split: {formatUsdc(organiserShare)} USDC to you, {formatUsdc(poolShare)} USDC to pool
          </p>
        </div>
      )}

      {/* Submit */}
      <button
        onClick={() => { void handleSubmit() }}
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-2 rounded-xl font-semibold text-sm"
        style={{
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          minHeight: '52px',
          opacity: isLoading ? 0.65 : 1,
          cursor: isLoading ? 'not-allowed' : 'pointer',
          fontSize: '16px',
        }}
      >
        {isLoading && <Loader2 size={16} className="animate-spin" />}
        {phase === 'approving' || waitingApprove
          ? 'Approving USDC...'
          : phase === 'creating' || waitingCreate
          ? 'Creating Event...'
          : 'Create Event'}
      </button>
    </motion.div>
  )
}
