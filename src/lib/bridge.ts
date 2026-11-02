/**
 * CCTP bridge utility for EventStake.
 * Bridges USDC from any supported chain to Arc Mainnet, then registers
 * the caller for an event in a single atomic flow.
 *
 * Uses App Kit (>=1.18.0) + adapter-viem-v2 (>=1.19.2).
 */
import { AppKit, type BridgeParams } from '@circle-fin/app-kit'
import {
  numberToHex,
  type Chain,
  type EIP1193Provider,
} from 'viem'
import {
  arc,
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
} from 'viem/chains'

// ── supported source chains ────────────────────────────────────────────────
export const BRIDGE_SOURCE_CHAINS = [
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
] as const satisfies readonly Chain[]

// All chains we register with wagmi (source + Arc destination)
export const ALL_SUPPORTED_CHAINS = [
  ...BRIDGE_SOURCE_CHAINS,
  arc,
] as const satisfies readonly Chain[]

// Map from numeric chain ID to the Bridge Kit chain identifier string
export const CHAIN_ID_TO_BRIDGE_NAME: Record<number, BridgeParams['from']['chain']> = {
  [mainnet.id]:   'Ethereum',
  [base.id]:      'Base',
  [arbitrum.id]:  'Arbitrum',
  [optimism.id]:  'Optimism',
  [polygon.id]:   'Polygon',
  [arc.id]:       'Arc',
}

export const ARC_CHAIN_ID = arc.id        // 5042
export const ARC_BRIDGE_NAME = 'Arc' as const

// ── withAddChainFallback ───────────────────────────────────────────────────
// Wraps an EIP-1193 provider so that if wallet_switchEthereumChain fails
// with error 4902 (chain unknown), it automatically adds the chain first.
const isUnrecognizedChain = (error: unknown) => {
  const e = error as { code?: number; data?: { originalError?: { code?: number } } }
  return e?.code === 4902 || e?.data?.originalError?.code === 4902
}

export function withAddChainFallback(
  provider: EIP1193Provider,
  chains: readonly Chain[],
): EIP1193Provider {
  const send = provider.request.bind(provider) as (
    args: { method: string; params?: unknown },
  ) => Promise<unknown>

  const request = (async (args: { method: string; params?: unknown }) => {
    try {
      return await send(args)
    } catch (error) {
      if (
        args.method !== 'wallet_switchEthereumChain' ||
        !isUnrecognizedChain(error)
      )
        throw error
      const [{ chainId }] = args.params as [{ chainId: string }]
      const chain = chains.find((c) => numberToHex(c.id) === chainId)
      if (!chain) throw error
      await send({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: numberToHex(chain.id),
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [...chain.rpcUrls.default.http],
            blockExplorerUrls: chain.blockExplorers
              ? [chain.blockExplorers.default.url]
              : undefined,
          },
        ],
      })
      return send(args)
    }
  }) as EIP1193Provider['request']

  return new Proxy(provider, {
    get(target, prop) {
      if (prop === 'request') return request
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

// ── App Kit singleton ──────────────────────────────────────────────────────
let _kit: AppKit | null = null
export function getAppKit(): AppKit {
  if (!_kit) _kit = new AppKit()
  return _kit
}

// ── BridgeStep type ────────────────────────────────────────────────────────
export type BridgeStep =
  | 'idle'
  | 'switching'
  | 'approving'
  | 'burning'
  | 'attesting'
  | 'minting'
  | 'done'
  | 'error'

export function bridgeStepLabel(step: BridgeStep): string {
  switch (step) {
    case 'idle':      return 'Ready'
    case 'switching': return 'Switching chain...'
    case 'approving': return 'Approving USDC...'
    case 'burning':   return 'Burning on source chain...'
    case 'attesting': return 'Waiting for Circle attestation...'
    case 'minting':   return 'Minting on Arc...'
    case 'done':      return 'Bridged'
    case 'error':     return 'Failed'
  }
}
