import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { X, Calendar, Users, DollarSign, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { CONTRACT_ABI as ABI, CONTRACT_ADDRESS } from '../contract'
import { getUsdc } from '@/onchain-facts'
import { parseAmount } from '@/onchain-money'

const ARC_TESTNET_ID = 5042002

interface Props {
  onClose: () => void
  onCreated: () => void
}

export default function CreateEventModal({ onClose, onCreated }: Props) {
  const { address } = useAccount()
  const [name, setName] = useState('')
  const [regStartStr, setRegStartStr] = useState('')
  const [regEndStr, setRegEndStr] = useState('')
  const [dateStr, setDateStr] = useState('')
  const [stakeInput, setStakeInput] = useState('')
  const [maxAttendees, setMaxAttendees] = useState('')

  const usdcFact = getUsdc(ARC_TESTNET_ID)

  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const handleCreate = () => {
    if (!address || !usdcFact) return
    if (!name.trim() || !regStartStr || !regEndStr || !dateStr || !stakeInput || !maxAttendees) {
      toast.error('Please fill in all fields.')
      return
    }

    const now = Math.floor(Date.now() / 1000)
    const regStartTs = Math.floor(new Date(regStartStr).getTime() / 1000)
    const regEndTs = Math.floor(new Date(regEndStr).getTime() / 1000)
    const dateTs = Math.floor(new Date(dateStr).getTime() / 1000)

    if (regStartTs < now) {
      toast.error('Registration start must be now or in the future.')
      return
    }
    if (regEndTs <= regStartTs) {
      toast.error('Registration end must be after registration start.')
      return
    }
    if (dateTs <= regEndTs) {
      toast.error('Event date must be after registration closes.')
      return
    }

    const parsedStake = parseAmount(ARC_TESTNET_ID, stakeInput)
    const maxAttendeesNum = parseInt(maxAttendees, 10)
    if (isNaN(maxAttendeesNum) || maxAttendeesNum < 1) {
      toast.error('Max attendees must be at least 1.')
      return
    }

    writeContract({
      address: CONTRACT_ADDRESS,
      abi: ABI,
      functionName: 'createEvent',
      args: [
        name.trim(),
        BigInt(regStartTs),
        BigInt(regEndTs),
        BigInt(dateTs),
        parsedStake.raw,
        BigInt(maxAttendeesNum),
        [] as `0x${string}`[],  // codeHashes — use CreateEventPage for real creation
        BigInt(900),             // codeWindowDuration — 15 min default
        BigInt(0),               // seedAmount
      ],
    })
  }

  useEffect(() => {
    if (isSuccess) {
      toast.success('Event created! It is now live.')
      onCreated()
      onClose()
    }
  }, [isSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!error) return
    const msg = (error as Error).message?.toLowerCase() || ''
    if (!msg.includes('user rejected')) {
      toast.error('Failed to create event. Please try again.')
    }
  }, [error])

  const isLoading = isPending || isConfirming

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <h2 className="display text-xl font-700" style={{ color: 'var(--ink)', fontWeight: 700 }}>
            Create Event
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{ color: 'var(--muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Event Name
            </label>
            <div className="relative">
              <Tag size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
              <input
                type="text"
                placeholder="Friday Workshop"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none transition-all"
                style={{
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink)',
                  fontFamily: 'DM Sans, sans-serif',
                }}
              />
            </div>
          </div>

          {/* Registration window */}
          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)', letterSpacing: '0.07em' }}>
              Registration Window
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-2)' }}>
                  Opens
                </label>
                <input
                  type="datetime-local"
                  value={regStartStr}
                  onChange={e => setRegStartStr(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-xs outline-none"
                  style={{
                    background: 'var(--surface-strong)',
                    border: '1px solid var(--border)',
                    color: 'var(--ink)',
                    fontFamily: 'DM Sans, sans-serif',
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-2)' }}>
                  Closes
                </label>
                <input
                  type="datetime-local"
                  value={regEndStr}
                  onChange={e => setRegEndStr(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-xs outline-none"
                  style={{
                    background: 'var(--surface-strong)',
                    border: '1px solid var(--border)',
                    color: 'var(--ink)',
                    fontFamily: 'DM Sans, sans-serif',
                  }}
                />
              </div>
            </div>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              No one can register outside this window.
            </p>
          </div>

          {/* Event date */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Event Date & Time
            </label>
            <div className="relative">
              <Calendar size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
              <input
                type="datetime-local"
                value={dateStr}
                onChange={e => setDateStr(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none"
                style={{
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink)',
                  fontFamily: 'DM Sans, sans-serif',
                }}
              />
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
              Must be after registration closes. Stake claims open after this date.
            </p>
          </div>

          {/* Stake */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Stake per Attendee (USDC)
            </label>
            <div className="relative">
              <DollarSign size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
              <input
                type="number"
                placeholder="5.00"
                min="0.000001"
                step="0.01"
                value={stakeInput}
                onChange={e => setStakeInput(e.target.value)}
                className="w-full pl-9 pr-16 py-2.5 rounded-xl text-sm outline-none tabular-nums"
                style={{
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink)',
                  fontFamily: 'DM Sans, sans-serif',
                }}
              />
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium"
                style={{ color: 'var(--muted)' }}
              >
                USDC
              </span>
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
              Attendees pay this to register. They get it back when they check in.
            </p>
          </div>

          {/* Max attendees */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Max Attendees
            </label>
            <div className="relative">
              <Users size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
              <input
                type="number"
                placeholder="50"
                min="1"
                step="1"
                value={maxAttendees}
                onChange={e => setMaxAttendees(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none tabular-nums"
                style={{
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink)',
                  fontFamily: 'DM Sans, sans-serif',
                }}
              />
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={isLoading || !address}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all mt-2"
            style={{
              background: isLoading ? 'var(--border-strong)' : 'var(--accent)',
              color: '#ffffff',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: !address ? 0.6 : 1,
            }}
          >
            {isPending
              ? 'Confirm in wallet...'
              : isConfirming
              ? 'Creating event...'
              : 'Create Event'}
          </button>

          {!address && (
            <p className="text-center text-xs" style={{ color: 'var(--subtle)' }}>
              Connect your wallet first.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
