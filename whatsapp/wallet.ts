/**
 * Circle developer-controlled wallet management.
 *
 * Each user is identified by their E.164 phone number.
 * On first contact, we create a wallet for them and persist the mapping
 * in the session store. The wallet address is their onchain identity —
 * they never see or manage a private key.
 *
 * Signing for onchain writes (register, checkIn, claimBack) uses
 * Circle's SCP transaction API, which signs server-side with the
 * entity secret. The user just says "yes" in WhatsApp.
 */

import {
  initiateDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets'
import type { Config } from './config.js'
import type { Session } from './types.js'
import { getSession, saveSession } from './store.js'

export function buildWalletClient(config: Config) {
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: config.circle.apiKey,
    entitySecret: config.circle.entitySecret,
  })

  /**
   * Resolve or create a wallet for this phone number.
   * Returns the session (with walletAddress populated).
   */
  async function resolveWallet(phone: string): Promise<Session & { walletAddress: string; walletId: string }> {
    const session = getSession(phone)

    if (session.walletAddress && session.walletId) {
      return session as Session & { walletAddress: string; walletId: string }
    }

    // Create a new SCA wallet on Arc Testnet
    const res = await client.createWallets({
      accountType: 'SCA',
      blockchains: ['ARC-TESTNET'],
      count: 1,
      walletSetId: config.circle.walletSetId,
      metadata: [{ name: `wa:${phone}`, refId: phone }],
    })

    const wallet = res.data?.wallets?.[0]
    if (!wallet?.id || !wallet?.address) {
      throw new Error('Wallet creation returned no wallet.')
    }

    session.walletId = wallet.id
    session.walletAddress = wallet.address
    saveSession(session)

    return session as Session & { walletAddress: string; walletId: string }
  }

  /**
   * Read the USDC balance for a wallet address using Circle's wallet API.
   * Returns the balance as a human-readable string like "2.50".
   */
  async function getUsdcBalance(walletId: string): Promise<string> {
    const res = await client.getWalletTokenBalance({ id: walletId })
    const tokenBalances = res.data?.tokenBalances ?? []
    const usdc = tokenBalances.find(
      (t) => t.token?.symbol === 'USDC' || t.token?.name?.toLowerCase().includes('usdc'),
    )
    return usdc?.amount ?? '0'
  }

  /**
   * Send a contract transaction from a user's wallet via Circle SCP.
   * `callData` is the ABI-encoded calldata for the transaction.
   * Returns the Circle transaction ID (not the chain tx hash — use it to poll status).
   */
  async function sendContractTx(params: {
    walletId: string
    contractAddress: string
    callData: string
    feeLevel?: 'LOW' | 'MEDIUM' | 'HIGH'
  }): Promise<string> {
    const res = await client.createTransaction({
      walletId: params.walletId,
      contractAddress: params.contractAddress,
      callData: params.callData,
      blockchain: 'ARC-TESTNET',
      feeLevel: params.feeLevel ?? 'MEDIUM',
      idempotencyKey: `${params.walletId}-${params.callData.slice(0, 20)}-${Date.now()}`,
    })

    const txId = res.data?.transaction?.id
    if (!txId) throw new Error('Transaction submission returned no ID.')
    return txId
  }

  /**
   * Approve USDC spending by the EventStake contract.
   * Must be called before register().
   */
  async function approveUsdc(params: {
    walletId: string
    usdcAddress: string
    spender: string
    amountRaw: bigint
  }): Promise<string> {
    // ERC-20 approve(address spender, uint256 amount)
    const { encodeFunctionData } = await import('viem')
    const callData = encodeFunctionData({
      abi: [{
        type: 'function', name: 'approve',
        inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'nonpayable',
      }],
      functionName: 'approve',
      args: [spender as `0x${string}`, amountRaw],
    })
    return sendContractTx({
      walletId: params.walletId,
      contractAddress: params.usdcAddress,
      callData,
    })
  }

  /**
   * Poll a Circle transaction until it is COMPLETE or FAILED.
   * Times out after ~60 seconds.
   */
  async function waitForTx(txId: string): Promise<'COMPLETE' | 'FAILED'> {
    const start = Date.now()
    while (Date.now() - start < 60_000) {
      await new Promise((r) => setTimeout(r, 3000))
      const res = await client.getTransaction({ id: txId })
      const state = res.data?.transaction?.state
      if (state === 'COMPLETE') return 'COMPLETE'
      if (state === 'FAILED' || state === 'CANCELLED') return 'FAILED'
    }
    return 'FAILED'
  }

  return { resolveWallet, getUsdcBalance, sendContractTx, approveUsdc, waitForTx }
}

export type WalletClient = ReturnType<typeof buildWalletClient>
