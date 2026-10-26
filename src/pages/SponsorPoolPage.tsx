import { useState } from 'react'
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Droplets, Loader2, Info, Heart } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
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

function HowRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{value}</span>
    </div>
  )
}

export default function SponsorPoolPage() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const usdcAddress = getUsdc(chainId)?.address as `0x${string}` | undefined

  const [donateAmt, setDonateAmt] = useState('')
  const [donateHash, setDonateHash] = useState<`0x${string}` | undefined>()
  const [approveHash, setApproveHash] = useState<`0x${string}` | undefined>()
  const [phase, setPhase] = useState<'idle' | 'approving' | 'donating'>('idle')

  const SAMPLE_STAKE = parseUsdc('5')

  const { data: poolInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getSponsorPoolInfo',
    args: [SAMPLE_STAKE],
    query: { refetchInterval: 30000 },
  })

  const { writeContractAsync } = useWriteContract()

  const { isLoading: waitingApprove, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash })
  const { isLoading: waitingDonate } = useWaitForTransactionReceipt({ hash: donateHash })

  const balance = poolInfo ? (poolInfo as [bigint, bigint])[0] : 0n
  const stakesCanCover = poolInfo ? (poolInfo as [bigint, bigint])[1] : 0n

  async function handleDonate() {
    if (!donateAmt || !usdcAddress) { toast.error('Enter an amount'); return }
    let amount: bigint
    try { amount = parseUsdc(donateAmt) } catch { toast.error('Invalid amount'); return }
    if (amount <= 0n) { toast.error('Amount must be greater than 0'); return }

    try {
      setPhase('approving')
      const h = await writeContractAsync({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACT_ADDRESS, amount],
      })
      setApproveHash(h)
      toast.info('Approving USDC...')
    } catch (e: unknown) {
      setPhase('idle')
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
    }
  }

  async function doDonate() {
    let amount: bigint
    try { amount = parseUsdc(donateAmt) } catch { return }
    try {
      setPhase('donating')
      const h = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'donate',
        args: [amount],
      })
      setDonateHash(h)
      toast.success('Donation submitted!')
      setDonateAmt('')
      setPhase('idle')
    } catch (e: unknown) {
      setPhase('idle')
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
    }
  }

  // When approve succeeds, proceed to donate
  if (approveSuccess && phase === 'approving') {
    queueMicrotask(() => { void doDonate() })
  }

  const isLoading = phase !== 'idle' || waitingApprove || waitingDonate

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="py-4 space-y-5"
    >
      <h1 className="display font-bold text-xl" style={{ color: 'var(--ink)' }}>
        Community Pool
      </h1>

      {/* Balance card */}
      <div
        className="rounded-2xl p-6 text-center"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        <Droplets size={28} style={{ margin: '0 auto 12px', color: 'rgba(255,255,255,0.8)' }} />
        <p
          className="display font-bold"
          style={{ fontSize: '40px', lineHeight: 1, letterSpacing: '-0.03em' }}
        >
          {formatUsdc(balance)}
        </p>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.7)' }}>
          USDC available
        </p>
        {balance > 0n && (
          <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.8)' }}>
            Can cover {String(stakesCanCover)} stakes of 5 USDC each
          </p>
        )}
      </div>

      {/* How it's funded */}
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <Info size={15} style={{ color: 'var(--accent)' }} />
          <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>How the pool is funded</p>
        </div>
        <HowRow label="Forfeited stakes (no-shows)" value="20% of each forfeited stake" />
        <HowRow label="Event creator seeds" value="Optional donation at event creation" />
        <HowRow label="Community donations" value="Anyone can donate USDC below" />
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            The pool automatically covers stakes for eligible attendees who request cover and have a good attendance record.
          </p>
        </div>
      </div>

      {/* Donate */}
      {isConnected ? (
        <div
          className="rounded-2xl p-5 space-y-4"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <Heart size={15} style={{ color: 'var(--danger)' }} />
            <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Donate to the pool</p>
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Amount in USDC"
              value={donateAmt}
              onChange={e => setDonateAmt(e.target.value)}
              min="0"
              step="0.01"
              className="flex-1 rounded-xl text-sm"
              style={{
                padding: '12px 14px',
                minHeight: '44px',
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
                outline: 'none',
                fontSize: '16px',
              }}
            />
            <button
              onClick={() => { void handleDonate() }}
              disabled={isLoading || !donateAmt}
              className="flex items-center justify-center gap-2 rounded-xl font-semibold text-sm px-4"
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                minHeight: '44px',
                opacity: isLoading || !donateAmt ? 0.65 : 1,
                cursor: isLoading || !donateAmt ? 'not-allowed' : 'pointer',
              }}
            >
              {isLoading && <Loader2 size={14} className="animate-spin" />}
              {phase === 'approving' || waitingApprove ? 'Approving...' : phase === 'donating' || waitingDonate ? 'Donating...' : 'Donate'}
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            Donations are one-way — funds go directly into the pool and cannot be withdrawn.
          </p>
        </div>
      ) : (
        <div className="text-center py-4 space-y-3">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Connect your wallet to donate</p>
          <ConnectKitButton />
        </div>
      )}
    </motion.div>
  )
}
