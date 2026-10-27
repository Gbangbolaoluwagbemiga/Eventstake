/**
 * On-chain reads and write-calldata builders for EventCheckIn.
 *
 * Reads use viem's publicClient (no key needed).
 * Writes produce ABI-encoded calldata that the wallet client submits
 * via Circle SCP — this module never holds a private key.
 */

import {
  createPublicClient,
  http,
  formatUnits,
  parseUnits,
  encodeFunctionData,
  type Address,
  type Chain,
} from 'viem'
import type { Config } from './config.js'

// ---------------------------------------------------------------------------
// ABI fragments
// ---------------------------------------------------------------------------

const EVENT_COMPONENTS = [
  { name: 'id', type: 'uint256' },
  { name: 'name', type: 'string' },
  { name: 'registrationStart', type: 'uint256' },
  { name: 'registrationEnd', type: 'uint256' },
  { name: 'date', type: 'uint256' },
  { name: 'stakeAmount', type: 'uint256' },
  { name: 'organiser', type: 'address' },
  { name: 'maxAttendees', type: 'uint256' },
  { name: 'registeredCount', type: 'uint256' },
  { name: 'checkedInCount', type: 'uint256' },
  { name: 'codeWindowDuration', type: 'uint256' },
  { name: 'cancelled', type: 'bool' },
  { name: 'forfeitWithdrawn', type: 'bool' },
] as const

const READ_ABI = [
  { type: 'function', name: 'getEvents', inputs: [], outputs: [{ name: '', type: 'tuple[]', components: EVENT_COMPONENTS }], stateMutability: 'view' },
  { type: 'function', name: 'getEvent', inputs: [{ name: 'eventId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: EVENT_COMPONENTS }], stateMutability: 'view' },
  { type: 'function', name: 'isRegistered', inputs: [{ name: 'eventId', type: 'uint256' }, { name: 'attendee', type: 'address' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'isCheckedIn', inputs: [{ name: 'eventId', type: 'uint256' }, { name: 'attendee', type: 'address' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'getUserRecord', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'eventsRegistered', type: 'uint32' }, { name: 'eventsAttended', type: 'uint32' }, { name: 'timesCovered', type: 'uint32' }, { name: 'timesRepaid', type: 'uint32' }, { name: 'hasOutstandingCover', type: 'bool' }, { name: 'bannedFromCover', type: 'bool' }, { name: 'selfPaidAttendedSinceBan', type: 'uint32' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getCreditScore', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: 'score', type: 'uint256' }, { name: 'label', type: 'string' }, { name: 'explanation', type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'getCoverEligibility', inputs: [{ name: 'user', type: 'address' }, { name: 'eventId', type: 'uint256' }], outputs: [{ name: 'eligible', type: 'bool' }, { name: 'reason', type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'getSponsorPoolInfo', inputs: [{ name: 'stakeAmount', type: 'uint256' }], outputs: [{ name: 'balance', type: 'uint256' }, { name: 'stakesCanCover', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'organiserCredits', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
] as const

const WRITE_ABI = [
  { type: 'function', name: 'register', inputs: [{ name: 'eventId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'checkIn', inputs: [{ name: 'eventId', type: 'uint256' }, { name: 'preimage', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'claimBack', inputs: [{ name: 'eventId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'requestCover', inputs: [{ name: 'eventId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'withdrawForfeited', inputs: [{ name: 'eventId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventData = {
  id: number
  name: string
  status: 'registration_open' | 'registration_not_open' | 'in_progress' | 'ended' | 'cancelled'
  registrationStart: Date
  registrationEnd: Date
  eventDate: Date
  stakeAmount_usdc: string
  stakeAmountRaw: bigint
  organiser: string
  maxAttendees: number
  registeredCount: number
  checkedInCount: number
  spotsLeft: number
  forfeitWithdrawn: boolean
}

export type UserRecord = {
  eventsRegistered: number
  eventsAttended: number
  timesCovered: number
  timesRepaid: number
  hasOutstandingCover: boolean
  bannedFromCover: boolean
}

export type CreditScore = {
  score: number
  label: string
  explanation: string
}

// ---------------------------------------------------------------------------
// Chain client builder
// ---------------------------------------------------------------------------

export function buildChainClient(config: Config) {
  const chain: Chain = {
    id: config.chain.chainId,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [config.chain.rpcUrl] } },
  }

  const publicClient = createPublicClient({ chain, transport: http(config.chain.rpcUrl) })
  const contract = config.chain.contractAddress

  // ---------- helpers -------------------------------------------------------

  function parseEvent(raw: Record<string, unknown>): EventData {
    const nowSec = BigInt(Math.floor(Date.now() / 1000))
    const regStart = raw['registrationStart'] as bigint
    const regEnd = raw['registrationEnd'] as bigint
    const date = raw['date'] as bigint
    const cancelled = raw['cancelled'] as boolean

    let status: EventData['status']
    if (cancelled) status = 'cancelled'
    else if (nowSec < regStart) status = 'registration_not_open'
    else if (nowSec <= regEnd) status = 'registration_open'
    else if (nowSec <= date + BigInt(2 * 86400)) status = 'in_progress'
    else status = 'ended'

    const stakeAmountRaw = raw['stakeAmount'] as bigint
    return {
      id: Number(raw['id'] as bigint),
      name: raw['name'] as string,
      status,
      registrationStart: new Date(Number(regStart) * 1000),
      registrationEnd: new Date(Number(regEnd) * 1000),
      eventDate: new Date(Number(date) * 1000),
      stakeAmount_usdc: formatUnits(stakeAmountRaw, config.chain.usdcDecimals),
      stakeAmountRaw,
      organiser: raw['organiser'] as string,
      maxAttendees: Number(raw['maxAttendees'] as bigint),
      registeredCount: Number(raw['registeredCount'] as bigint),
      checkedInCount: Number(raw['checkedInCount'] as bigint),
      spotsLeft: Number(raw['maxAttendees'] as bigint) - Number(raw['registeredCount'] as bigint),
      forfeitWithdrawn: raw['forfeitWithdrawn'] as boolean,
    }
  }

  // ---------- reads ---------------------------------------------------------

  async function getOpenEvents(): Promise<EventData[]> {
    const raw = await publicClient.readContract({
      address: contract, abi: READ_ABI, functionName: 'getEvents',
    }) as Record<string, unknown>[]
    return raw.map(parseEvent).filter((e) => e.status === 'registration_open')
  }

  async function getAllEvents(): Promise<EventData[]> {
    const raw = await publicClient.readContract({
      address: contract, abi: READ_ABI, functionName: 'getEvents',
    }) as Record<string, unknown>[]
    return raw.map(parseEvent)
  }

  async function getEvent(eventId: number): Promise<EventData> {
    const raw = await publicClient.readContract({
      address: contract, abi: READ_ABI, functionName: 'getEvent',
      args: [BigInt(eventId)],
    }) as Record<string, unknown>
    return parseEvent(raw)
  }

  async function getUserRecord(address: Address): Promise<UserRecord> {
    const raw = await publicClient.readContract({
      address: contract, abi: READ_ABI, functionName: 'getUserRecord',
      args: [address],
    }) as Record<string, unknown>
    return {
      eventsRegistered: Number(raw['eventsRegistered']),
      eventsAttended: Number(raw['eventsAttended']),
      timesCovered: Number(raw['timesCovered']),
      timesRepaid: Number(raw['timesRepaid']),
      hasOutstandingCover: raw['hasOutstandingCover'] as boolean,
      bannedFromCover: raw['bannedFromCover'] as boolean,
    }
  }

  async function getCreditScore(address: Address): Promise<CreditScore> {
    const [score, label, explanation] = await publicClient.readContract({
      address: contract, abi: READ_ABI, functionName: 'getCreditScore',
      args: [address],
    }) as [bigint, string, string]
    return { score: Number(score), label, explanation }
  }

  async function getCoverEligibility(address: Address, eventId: number): Promise<{ eligible: boolean; reason: string }> {
    const [eligible, reason] = await publicClient.readContract({
      address: contract, abi: READ_ABI, functionName: 'getCoverEligibility',
      args: [address, BigInt(eventId)],
    }) as [boolean, string]
    return { eligible, reason }
  }

  async function getSponsorPool(stakeAmountRaw?: bigint): Promise<{ balance_usdc: string; stakesCanCover: number }> {
    const [balance, stakesCanCover] = await publicClient.readContract({
      address: contract, abi: READ_ABI, functionName: 'getSponsorPoolInfo',
      args: [stakeAmountRaw ?? 0n],
    }) as [bigint, bigint]
    return {
      balance_usdc: formatUnits(balance, config.chain.usdcDecimals),
      stakesCanCover: Number(stakesCanCover),
    }
  }

  async function isRegistered(eventId: number, address: Address): Promise<boolean> {
    return publicClient.readContract({
      address: contract, abi: READ_ABI, functionName: 'isRegistered',
      args: [BigInt(eventId), address],
    }) as Promise<boolean>
  }

  async function isCheckedIn(eventId: number, address: Address): Promise<boolean> {
    return publicClient.readContract({
      address: contract, abi: READ_ABI, functionName: 'isCheckedIn',
      args: [BigInt(eventId), address],
    }) as Promise<boolean>
  }

  // ---------- write calldata builders (no signing here) --------------------

  function calldataRegister(eventId: number): string {
    return encodeFunctionData({ abi: WRITE_ABI, functionName: 'register', args: [BigInt(eventId)] })
  }

  function calldataCheckIn(eventId: number, preimage: `0x${string}`): string {
    return encodeFunctionData({ abi: WRITE_ABI, functionName: 'checkIn', args: [BigInt(eventId), preimage] })
  }

  function calldataClaimBack(eventId: number): string {
    return encodeFunctionData({ abi: WRITE_ABI, functionName: 'claimBack', args: [BigInt(eventId)] })
  }

  function calldataRequestCover(eventId: number): string {
    return encodeFunctionData({ abi: WRITE_ABI, functionName: 'requestCover', args: [BigInt(eventId)] })
  }

  function calldataWithdrawForfeited(eventId: number): string {
    return encodeFunctionData({ abi: WRITE_ABI, functionName: 'withdrawForfeited', args: [BigInt(eventId)] })
  }

  function parseUsdcAmount(usdc: string): bigint {
    return parseUnits(usdc, config.chain.usdcDecimals)
  }

  return {
    getOpenEvents, getAllEvents, getEvent, getUserRecord, getCreditScore,
    getCoverEligibility, getSponsorPool, isRegistered, isCheckedIn,
    calldataRegister, calldataCheckIn, calldataClaimBack,
    calldataRequestCover, calldataWithdrawForfeited, parseUsdcAmount,
  }
}

export type ChainClient = ReturnType<typeof buildChainClient>
