import { useNavigate } from 'react-router-dom'
import { useAccount, useReadContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { ArrowRight, Shield, Zap, Users, Droplets } from 'lucide-react'
import { motion } from 'framer-motion'
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../contract'
import { formatUsdc } from '@/onchain-money'

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.07, duration: 0.35, ease: 'easeOut' },
  }),
}

export default function LandingPage() {
  const navigate = useNavigate()
  const { isConnected } = useAccount()

  const { data: poolInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getSponsorPoolInfo',
    args: [0n],
  })

  const poolBalance = poolInfo ? (poolInfo as [bigint, bigint])[0] : 0n

  const steps = [
    {
      icon: Shield,
      title: 'Stake to register',
      desc: 'Lock USDC to reserve your spot. Your funds stay in the contract — no one can touch them.',
    },
    {
      icon: Zap,
      title: 'Check in at the event',
      desc: 'Enter the venue code. Your stake is returned in full the moment you check in.',
    },
    {
      icon: Users,
      title: 'Miss it? The pool wins',
      desc: '80% of your stake goes to the organiser. 20% flows to the community pool that covers future attendees.',
    },
  ]

  return (
    <div className="py-4 space-y-6">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="rounded-2xl p-6"
        style={{ background: 'var(--accent)' }}
      >
        <h1
          className="display font-bold leading-tight text-white"
          style={{ fontSize: '28px', letterSpacing: '-0.03em' }}
        >
          Show up.
          <br />
          Get your stake back.
        </h1>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
          Register with USDC, check in at the door, reclaim your stake. Attendance becomes a financial commitment — and a record worth building.
        </p>
        <button
          onClick={() => navigate('/events')}
          className="mt-5 flex items-center gap-2 rounded-xl font-semibold text-sm"
          style={{
            background: '#fff',
            color: 'var(--accent)',
            padding: '12px 20px',
            minHeight: '44px',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Browse Events
          <ArrowRight size={16} />
        </button>
      </motion.div>

      {/* Steps */}
      <div className="space-y-3">
        <h2 className="display font-semibold text-base" style={{ color: 'var(--ink)' }}>
          How it works
        </h2>
        {steps.map((step, i) => (
          <motion.div
            key={i}
            custom={i}
            initial="hidden"
            animate="show"
            variants={fadeUp}
            className="rounded-xl p-4 flex gap-3 items-start"
            style={{
              background: 'var(--surface-strong)',
              border: '1px solid var(--border)',
            }}
          >
            <div
              className="flex-shrink-0 rounded-lg flex items-center justify-center"
              style={{
                width: 36,
                height: 36,
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
              }}
            >
              <step.icon size={16} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
                {step.title}
              </p>
              <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
                {step.desc}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* My Record shortcut — wallet connected */}
      {isConnected && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => navigate('/my/record')}
          className="w-full rounded-xl p-4 flex items-center justify-between"
          style={{
            background: 'var(--surface-strong)',
            border: '1.5px solid var(--border-strong)',
            cursor: 'pointer',
          }}
        >
          <div className="flex items-center gap-3">
            <Shield size={20} style={{ color: 'var(--accent)' }} />
            <div className="text-left">
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                My Attendance Record
              </p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                View your credit score and history
              </p>
            </div>
          </div>
          <ArrowRight size={16} style={{ color: 'var(--subtle)' }} />
        </motion.button>
      )}

      {/* Pool balance */}
      <div
        className="rounded-xl p-4 flex items-center gap-3"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
      >
        <Droplets size={18} style={{ color: 'var(--accent)' }} />
        <div>
          <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
            Community Pool
          </p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {formatUsdc(poolBalance)} USDC available to cover attendee stakes
          </p>
        </div>
      </div>

      {/* Connect prompt */}
      {!isConnected && (
        <div
          className="rounded-xl p-4 text-center"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--ink)' }}>
            Connect your wallet to register, check in, and build your record
          </p>
          <ConnectKitButton />
        </div>
      )}

      {/* Pool footnote */}
      <p className="text-xs text-center" style={{ color: 'var(--subtle)', paddingBottom: 4 }}>
        The pool covers stakes for eligible attendees who cannot afford to register.{' '}
        <button
          onClick={() => navigate('/pool')}
          className="underline"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 'inherit' }}
        >
          Learn more
        </button>
      </p>
    </div>
  )
}
