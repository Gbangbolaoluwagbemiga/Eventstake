import { useAccount, useReadContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Shield, TrendingUp, AlertTriangle, CheckCircle, Info } from 'lucide-react'
import { motion } from 'framer-motion'
import ScoreRing from '../components/ScoreRing'
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../contract'
import { formatUsdc } from '@/onchain-money'

interface UserRecord {
  eventsRegistered: number
  eventsAttended: number
  timesCovered: number
  timesRepaid: number
  hasOutstandingCover: boolean
  bannedFromCover: boolean
  selfPaidAttendedSinceBan: number
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="rounded-xl p-3 flex flex-col items-center gap-1"
      style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
    >
      <span className="display font-bold text-lg" style={{ color: 'var(--ink)', lineHeight: 1 }}>
        {value}
      </span>
      <span className="text-xs text-center" style={{ color: 'var(--muted)', lineHeight: 1.2 }}>
        {label}
      </span>
    </div>
  )
}

export default function MyRecordPage() {
  const { address, isConnected } = useAccount()

  const { data: creditScore } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getCreditScore',
    args: [address!],
    query: { enabled: !!address },
  }) as { data: [bigint, string, string] | undefined }

  const { data: userRecord } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getUserRecord',
    args: [address!],
    query: { enabled: !!address },
  }) as { data: UserRecord | undefined }

  const { data: poolInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getSponsorPoolInfo',
    args: [0n],
  })

  if (!isConnected) {
    return (
      <div className="py-12 text-center space-y-4">
        <Shield size={40} style={{ color: 'var(--subtle)', margin: '0 auto' }} />
        <p className="font-semibold" style={{ color: 'var(--ink)' }}>Connect your wallet to view your record</p>
        <ConnectKitButton />
      </div>
    )
  }

  const score = creditScore ? Number(creditScore[0]) : 0
  const label = creditScore ? creditScore[1] : 'new'
  const explanation = creditScore ? creditScore[2] : 'Register for your first event to start building your record.'

  const rec = userRecord
  const isNew = !rec || rec.eventsRegistered === 0

  const poolBalance = poolInfo ? (poolInfo as [bigint, bigint])[0] : 0n

  // Cover improvement tips
  const tips: string[] = []
  if (rec) {
    if (rec.eventsAttended < rec.eventsRegistered) {
      tips.push('Check in to more events you register for.')
    }
    if (rec.timesCovered > rec.timesRepaid) {
      tips.push('Repay your covered stakes by attending covered events.')
    }
    if (rec.bannedFromCover) {
      tips.push('Attend one event you paid for to lift your cover ban.')
    }
  }
  if (tips.length === 0 && !isNew) {
    tips.push('Your record is in good shape. Keep attending.')
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="py-4 space-y-5"
    >
      <h1 className="display font-bold text-xl" style={{ color: 'var(--ink)' }}>
        My Record
      </h1>

      {/* Score ring card */}
      <div
        className="rounded-2xl p-6 flex flex-col items-center"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        {isNew ? (
          <div className="text-center space-y-3">
            <div
              className="rounded-full mx-auto flex items-center justify-center"
              style={{ width: 80, height: 80, background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
            >
              <Shield size={32} style={{ color: 'var(--subtle)' }} />
            </div>
            <div>
              <p className="font-semibold" style={{ color: 'var(--ink)' }}>No record yet</p>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                Register for your first event to start building your attendance record.
              </p>
            </div>
          </div>
        ) : (
          <>
            <ScoreRing score={score} label={label} size={140} />
            <p className="text-sm text-center mt-4 leading-relaxed" style={{ color: 'var(--muted)' }}>
              {explanation}
            </p>
          </>
        )}
      </div>

      {/* Stats row */}
      {rec && (
        <div className="grid grid-cols-2 gap-3">
          <StatChip label="Events Attended" value={rec.eventsAttended} />
          <StatChip label="Events Registered" value={rec.eventsRegistered} />
          <StatChip label="Times Covered" value={rec.timesCovered} />
          <StatChip label="Times Repaid" value={rec.timesRepaid} />
        </div>
      )}

      {/* Cover eligibility */}
      {rec && (
        <div
          className="rounded-xl p-4 space-y-2"
          style={{
            background: rec.bannedFromCover ? '#fff0f3' : rec.hasOutstandingCover ? '#fffbeb' : '#f0fdf4',
            border: `1px solid ${rec.bannedFromCover ? '#fecdd3' : rec.hasOutstandingCover ? '#fde68a' : '#bbf7d0'}`,
          }}
        >
          <div className="flex items-center gap-2">
            {rec.bannedFromCover ? (
              <AlertTriangle size={16} style={{ color: 'var(--danger)' }} />
            ) : rec.hasOutstandingCover ? (
              <Info size={16} style={{ color: '#c97800' }} />
            ) : (
              <CheckCircle size={16} style={{ color: 'var(--success)' }} />
            )}
            <p
              className="text-sm font-semibold"
              style={{
                color: rec.bannedFromCover ? 'var(--danger)' : rec.hasOutstandingCover ? '#92400e' : 'var(--success)',
              }}
            >
              {rec.bannedFromCover
                ? 'Cover eligibility paused'
                : rec.hasOutstandingCover
                ? 'Active covered registration'
                : 'Eligible for cover'}
            </p>
          </div>
          <p
            className="text-xs"
            style={{
              color: rec.bannedFromCover ? '#9f1239' : rec.hasOutstandingCover ? '#a16207' : 'var(--success)',
            }}
          >
            {rec.bannedFromCover
              ? 'Attend one paid event to restore eligibility.'
              : rec.hasOutstandingCover
              ? 'You have an active covered registration. Check in to that event first.'
              : `Pool can cover stakes up to ${formatUsdc(poolBalance)} USDC total.`}
          </p>
        </div>
      )}

      {/* Tips */}
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <TrendingUp size={16} style={{ color: 'var(--accent)' }} />
          <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
            How to raise your score
          </p>
        </div>
        {tips.map((tip, i) => (
          <div key={i} className="flex items-start gap-2">
            <div
              className="rounded-full flex-shrink-0 mt-0.5"
              style={{ width: 6, height: 6, background: 'var(--accent)', marginTop: 5 }}
            />
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{tip}</p>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
