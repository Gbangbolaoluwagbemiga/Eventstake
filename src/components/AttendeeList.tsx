import { useEffect, useState, useRef } from 'react'
import { usePublicClient, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { CheckCircle2, Circle } from 'lucide-react'
import { toast } from 'sonner'
import { CONTRACT_ABI as ABI, CONTRACT_ADDRESS } from '../contract'

const ARC_TESTNET_ID = 5042002

interface Props {
  eventId: bigint
  isEventLive: boolean
  onMarked: () => void
}

interface Attendee {
  address: `0x${string}`
  checkedIn: boolean
}

export default function AttendeeList({ eventId, isEventLive, onMarked }: Props) {
  const { address: connectedAddress } = useAccount()
  const publicClient = usePublicClient({ chainId: ARC_TESTNET_ID })
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const fetchedRef = useRef(false)
  const loading = !fetchedRef.current
  // Use ref so effects can read the latest value without setState deps
  const markingRef = useRef<`0x${string}` | null>(null)
  const [markingAddress, setMarkingAddress] = useState<`0x${string}` | null>(null)

  const { data: txHash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  // Fetch registered attendees from Registered event logs + check their status
  const fetchAttendees = async () => {
    if (!publicClient || !CONTRACT_ADDRESS) return
    try {
      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        event: {
          type: 'event',
          name: 'Registered',
          inputs: [
            { name: 'eventId', type: 'uint256', indexed: true },
            { name: 'attendee', type: 'address', indexed: true },
          ],
        },
        args: { eventId },
        fromBlock: 0n,
        toBlock: 'latest',
      })

      const unique = [...new Set(logs.map(l => l.args.attendee as `0x${string}`))]

      // Check check-in status for each
      const results = await Promise.all(
        unique.map(async (addr) => {
          const checkedIn = await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: ABI,
            functionName: 'isCheckedIn',
            args: [eventId, addr],
          })
          return { address: addr, checkedIn: Boolean(checkedIn) }
        })
      )
      setAttendees(results)
    } catch {
      setAttendees([])
    } finally {
      fetchedRef.current = true
    }
  }

  useEffect(() => {
    fetchedRef.current = false
    void fetchAttendees()
  }, [eventId, publicClient]) // eslint-disable-line react-hooks/exhaustive-deps

  // On success: toast (external system) + refetch (external system) + clear marking UI
  useEffect(() => {
    if (!isSuccess) return
    const addr = markingRef.current
    if (addr) {
      toast.success(`Marked ${addr.slice(0, 6)}…${addr.slice(-4)} as present.`)
    }
    markingRef.current = null
    const t = setTimeout(() => {
      setMarkingAddress(null)
      reset()
      onMarked()
      void fetchAttendees()
    }, 0)
    return () => clearTimeout(t)
  }, [isSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  // On error: toast (external system) + clear marking UI
  useEffect(() => {
    if (!error) return
    const addr = markingRef.current
    if (!addr) return
    const msg = (error as Error).message?.toLowerCase() || ''
    if (!msg.includes('user rejected')) toast.error('Failed to mark attendee. Try again.')
    markingRef.current = null
    const t = setTimeout(() => {
      setMarkingAddress(null)
      reset()
    }, 0)
    return () => clearTimeout(t)
  }, [error]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMark = (attendeeAddr: `0x${string}`) => {
    if (!CONTRACT_ADDRESS) return
    markingRef.current = attendeeAddr
    setMarkingAddress(attendeeAddr)
    // Note: markPresent removed in new contract — this component is deprecated
    console.warn('markPresent is not available in this contract version', eventId, attendeeAddr)
  }

  const isBusy = isPending || isConfirming

  if (loading) {
    return (
      <div className="text-xs py-3 text-center" style={{ color: 'var(--subtle)' }}>
        Loading attendees…
      </div>
    )
  }

  if (attendees.length === 0) {
    return (
      <div className="text-xs py-3 text-center" style={{ color: 'var(--subtle)' }}>
        No one has registered yet.
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {attendees.map((a) => {
        const isMe = connectedAddress?.toLowerCase() === a.address.toLowerCase()
        const isMarkingThis = markingAddress === a.address
        const shortAddr = `${a.address.slice(0, 6)}…${a.address.slice(-4)}`
        return (
          <div
            key={a.address}
            className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl"
            style={{ background: 'var(--surface-muted)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              {a.checkedIn
                ? <CheckCircle2 size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                : <Circle size={14} style={{ color: 'var(--subtle)', flexShrink: 0 }} />
              }
              <span className="mono text-xs truncate" style={{ color: a.checkedIn ? 'var(--success)' : 'var(--ink-2)' }}>
                {shortAddr}{isMe ? ' (you)' : ''}
              </span>
            </div>

            {isEventLive && !a.checkedIn && (
              <button
                onClick={() => handleMark(a.address)}
                disabled={isBusy}
                className="shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: isBusy && isMarkingThis ? 'var(--surface-muted)' : 'var(--success)',
                  color: isBusy && isMarkingThis ? 'var(--subtle)' : '#fff',
                  opacity: isBusy && !isMarkingThis ? 0.4 : 1,
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                  border: '1px solid rgba(26,128,71,0.3)',
                  minWidth: 60,
                }}
              >
                {isBusy && isMarkingThis
                  ? isPending ? '…' : 'Marking'
                  : 'Mark'}
              </button>
            )}

            {a.checkedIn && (
              <span className="text-xs shrink-0" style={{ color: 'var(--success)' }}>Present</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
