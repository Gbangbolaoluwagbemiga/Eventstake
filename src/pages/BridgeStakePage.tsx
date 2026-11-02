/**
 * BridgeStakePage
 *
 * Lets a user on any CCTP-supported chain bridge USDC to Arc Mainnet
 * and register for an event in one flow.
 *
 * Route: /events/:eventId/bridge-stake
 * Only shown when the connected wallet is NOT on Arc (chain ID 5042).
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useReadContract,
} from 'wagmi'
import { formatUnits } from 'viem'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import type { EIP1193Provider } from 'viem'
import {
  BRIDGE_SOURCE_CHAINS,
  ALL_SUPPORTED_CHAINS,
  CHAIN_ID_TO_BRIDGE_NAME,
  ARC_BRIDGE_NAME,
  withAddChainFallback,
  getAppKit,
  type BridgeStep,
  bridgeStepLabel,
} from '@/lib/bridge'
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '@/contract'
import { ArrowRight, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

// ── helpers ────────────────────────────────────────────────────────────────
function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function chainName(chainId: number): string {
  return (
    ALL_SUPPORTED_CHAINS.find((c) => c.id === chainId)?.name ??
    `Chain ${chainId}`
  )
}

// ── component ──────────────────────────────────────────────────────────────
export default function BridgeStakePage() {
  const { eventId } = useParams<{ eventId: string }>()
  const navigate = useNavigate()
  const { address, isConnected, connector } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()

  const [step, setStep] = useState<BridgeStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [selectedSourceChainId, setSelectedSourceChainId] = useState<number>(
    BRIDGE_SOURCE_CHAINS[0].id,
  )
  const [confirmed, setConfirmed] = useState(false)

  // Read event data from contract
  const { data: eventData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getEvent',
    args: eventId !== undefined ? [BigInt(eventId)] : undefined,
    query: { enabled: eventId !== undefined },
  })

  const event = eventData as
    | {
        id: bigint
        name: string
        stakeAmount: bigint
        eventDate: bigint
        organiser: string
        closed: boolean
      }
    | undefined

  // If user is already on Arc, send them back to the event detail
  useEffect(() => {
    if (isConnected && chainId === 5042) {
      navigate(`/events/${eventId}`, { replace: true })
    }
  }, [isConnected, chainId, eventId, navigate])

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-warm-50 flex items-center justify-center px-4">
        <p className="text-navy-600 text-sm">Connect your wallet to continue.</p>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-warm-50 flex items-center justify-center px-4">
        <Loader2 className="w-6 h-6 animate-spin text-navy-400" />
      </div>
    )
  }

  const stakeUSDC = Number(formatUnits(event.stakeAmount, 6)).toFixed(2)
  const sourceName = chainName(selectedSourceChainId)
  const sourceBridgeName = CHAIN_ID_TO_BRIDGE_NAME[selectedSourceChainId]

  // ── bridge handler ──────────────────────────────────────────────────────
  const handleBridgeAndStake = async () => {
    if (!connector || !address) return
    setError(null)
    setTxHash(null)

    try {
      // 1. Switch wallet to selected source chain
      setStep('switching')
      if (chainId !== selectedSourceChainId) {
        await switchChainAsync({ chainId: selectedSourceChainId })
      }

      // 2. Build adapter from wallet provider
      const provider = (await connector.getProvider()) as EIP1193Provider
      const adapter = await createViemAdapterFromProvider({
        provider: withAddChainFallback(provider, ALL_SUPPORTED_CHAINS),
      })

      const kit = getAppKit()

      // 3. Bridge USDC to Arc — track steps via events
      kit.on('bridge.approve',           () => setStep('approving'))
      kit.on('bridge.burn',              () => setStep('burning'))
      kit.on('bridge.fetchAttestation',  () => setStep('attesting'))
      kit.on('bridge.mint',              () => setStep('minting'))

      const result = await kit.bridge({
        token: 'USDC',
        amount: stakeUSDC,
        from: {
          adapter,
          chain: sourceBridgeName,
        },
        to: {
          adapter,
          chain: ARC_BRIDGE_NAME,
        },
      })

      if (result.state !== 'success') {
        throw new Error(
          `Bridge ended in state: ${result.state}. Check the Steps tab.`,
        )
      }

      // Capture mint tx hash for the user
      const mintStep = result.steps?.find((s) => s.name === 'mint')
      if (mintStep && 'txHash' in mintStep) {
        setTxHash(mintStep.txHash as string)
      }

      setStep('done')

      // 4. Navigate back to event detail for the register+stake step
      //    (which now runs on Arc with the freshly bridged USDC)
      setTimeout(() => {
        navigate(`/events/${eventId}`)
      }, 2000)
    } catch (err) {
      setStep('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // ── render ──────────────────────────────────────────────────────────────
  const busy =
    step !== 'idle' && step !== 'done' && step !== 'error'

  return (
    <div className="min-h-screen bg-warm-50 pb-20">
      {/* header */}
      <div className="bg-navy-900 text-white px-4 pt-12 pb-6">
        <button
          onClick={() => navigate(`/events/${eventId}`)}
          className="text-sm text-white/60 mb-4 block"
        >
          Back to event
        </button>
        <h1 className="text-xl font-semibold">Bridge and Stake</h1>
        <p className="text-white/70 text-sm mt-1">{event.name}</p>
      </div>

      <div className="px-4 py-6 space-y-4 max-w-lg mx-auto">
        {/* explanation card */}
        <div className="bg-white rounded-xl p-4 border border-warm-200">
          <p className="text-sm text-navy-700 leading-relaxed">
            Your wallet is on{' '}
            <span className="font-medium">{chainName(chainId)}</span>. This app
            runs on Arc Mainnet. Your{' '}
            <span className="font-medium">{stakeUSDC} USDC</span> will be
            bridged to Arc via CCTP and your registration will be confirmed in
            the same flow.
          </p>
        </div>

        {/* source chain picker */}
        <div className="bg-white rounded-xl p-4 border border-warm-200 space-y-3">
          <p className="text-xs font-medium text-navy-500 uppercase tracking-wide">
            Bridge from
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {BRIDGE_SOURCE_CHAINS.map((chain) => (
              <button
                key={chain.id}
                onClick={() => setSelectedSourceChainId(chain.id)}
                disabled={busy}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  selectedSourceChainId === chain.id
                    ? 'bg-navy-900 text-white border-navy-900'
                    : 'bg-warm-50 text-navy-700 border-warm-200 hover:border-navy-400'
                }`}
              >
                {chain.name}
              </button>
            ))}
          </div>
        </div>

        {/* route summary */}
        <div className="bg-white rounded-xl p-4 border border-warm-200">
          <div className="flex items-center gap-3">
            <div className="text-center flex-1">
              <p className="text-xs text-navy-400">From</p>
              <p className="font-medium text-navy-900 text-sm">{sourceName}</p>
              {address && (
                <p className="text-xs text-navy-400 mt-0.5 font-mono">
                  {shortAddr(address)}
                </p>
              )}
            </div>
            <ArrowRight className="w-5 h-5 text-navy-400 shrink-0" />
            <div className="text-center flex-1">
              <p className="text-xs text-navy-400">To</p>
              <p className="font-medium text-navy-900 text-sm">Arc Mainnet</p>
              {address && (
                <p className="text-xs text-navy-400 mt-0.5 font-mono">
                  {shortAddr(address)}
                </p>
              )}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-warm-100 flex justify-between text-sm">
            <span className="text-navy-500">Amount</span>
            <span className="font-semibold text-navy-900">{stakeUSDC} USDC</span>
          </div>
          <p className="text-xs text-navy-400 mt-2">
            Powered by Circle CCTP. Typically completes in under 30 seconds.
          </p>
        </div>

        {/* confirmation checkbox */}
        {step === 'idle' && (
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 w-4 h-4 rounded accent-navy-900"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span className="text-sm text-navy-700 leading-relaxed">
              I understand {stakeUSDC} USDC will leave{' '}
              <span className="font-medium">{sourceName}</span>, bridge to Arc
              Mainnet, and be staked for the event. This is reversible only if
              fewer than 5% of attendees check in.
            </span>
          </label>
        )}

        {/* progress */}
        {step !== 'idle' && step !== 'error' && (
          <div className="bg-white rounded-xl p-4 border border-warm-200 space-y-3">
            {(
              [
                'switching',
                'approving',
                'burning',
                'attesting',
                'minting',
                'done',
              ] as BridgeStep[]
            ).map((s) => {
              const isDone =
                step === 'done' ||
                (
                  [
                    'switching',
                    'approving',
                    'burning',
                    'attesting',
                    'minting',
                  ] as BridgeStep[]
                ).indexOf(step) >
                  (
                    [
                      'switching',
                      'approving',
                      'burning',
                      'attesting',
                      'minting',
                    ] as BridgeStep[]
                  ).indexOf(s)
              const isCurrent = step === s
              return (
                <div key={s} className="flex items-center gap-3">
                  {isDone ? (
                    <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 animate-spin text-navy-600 shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-warm-300 shrink-0" />
                  )}
                  <span
                    className={`text-sm ${
                      isDone
                        ? 'text-navy-400 line-through'
                        : isCurrent
                          ? 'text-navy-900 font-medium'
                          : 'text-navy-300'
                    }`}
                  >
                    {bridgeStepLabel(s)}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* success */}
        {step === 'done' && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-900">
                Bridge complete
              </p>
              {txHash && (
                <a
                  href={`https://explorer.arc.io/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-green-700 underline mt-1 block"
                >
                  View on Arc Explorer
                </a>
              )}
              <p className="text-xs text-green-700 mt-1">
                Returning you to the event page to complete registration...
              </p>
            </div>
          </div>
        )}

        {/* error */}
        {step === 'error' && error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-900">Bridge failed</p>
              <p className="text-xs text-red-700 mt-1 break-words">{error}</p>
              <button
                onClick={() => { setStep('idle'); setError(null) }}
                className="mt-2 text-xs text-red-700 underline"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* CTA */}
        {(step === 'idle' || step === 'error') && (
          <button
            onClick={() => { void handleBridgeAndStake() }}
            disabled={!confirmed || busy}
            className="w-full bg-navy-900 text-white rounded-xl py-4 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed active:bg-navy-800 transition-colors"
          >
            Bridge {stakeUSDC} USDC and stake
          </button>
        )}
      </div>
    </div>
  )
}
