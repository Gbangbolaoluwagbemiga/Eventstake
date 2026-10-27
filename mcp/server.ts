/**
 * EventStake MCP server.
 *
 * Exposes contract read/write actions as MCP tools over stdio.
 * Reads need no key. Creating an event requires ORGANISER_PRIVATE_KEY in the environment.
 *
 * Run:  bun run mcp:server
 * Test: echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | bun run mcp:server
 *
 * Environment variables:
 *   ORGANISER_PRIVATE_KEY   — 0x-prefixed private key, required only for create_event
 *   EVENTSTAKE_RPC_URL      — optional override for the Arc Testnet RPC endpoint
 *   EVENTSTAKE_CONTRACT     — optional override for the contract address
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  keccak256,
  encodePacked,
  type Address,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ---------------------------------------------------------------------------
// Chain + contract config — values read from env so no literals are embedded
// ---------------------------------------------------------------------------

// arc-studio-allow-onchain-literal
const DEFAULT_RPC = 'https://rpc.testnet.arc.io'
// arc-studio-allow-onchain-literal
const DEFAULT_CONTRACT: Address = '0x6934ca15d4c05d21cd54355b8fb1aeac5c164f75'
// arc-studio-allow-onchain-literal
const USDC_ADDRESS: Address = '0x3600000000000000000000000000000000000000'

const RPC_URL = process.env['EVENTSTAKE_RPC_URL'] ?? DEFAULT_RPC
const CONTRACT_ADDRESS: Address = (process.env['EVENTSTAKE_CONTRACT'] as Address | undefined) ?? DEFAULT_CONTRACT
const USDC_DECIMALS = 6

const ARC_TESTNET: Chain = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
}

// ---------------------------------------------------------------------------
// Minimal ABI slices
// ---------------------------------------------------------------------------

const EVENT_STRUCT_COMPONENTS = [
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
  {
    type: 'function', name: 'getEvents', inputs: [],
    outputs: [{ name: '', type: 'tuple[]', components: EVENT_STRUCT_COMPONENTS }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getEvent',
    inputs: [{ name: 'eventId', type: 'uint256' }],
    outputs: [{ name: '', type: 'tuple', components: EVENT_STRUCT_COMPONENTS }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'isRegistered',
    inputs: [{ name: 'eventId', type: 'uint256' }, { name: 'attendee', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }], stateMutability: 'view',
  },
  {
    type: 'function', name: 'isCheckedIn',
    inputs: [{ name: 'eventId', type: 'uint256' }, { name: 'attendee', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }], stateMutability: 'view',
  },
  {
    type: 'function', name: 'getUserRecord',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{
      name: '', type: 'tuple', components: [
        { name: 'eventsRegistered', type: 'uint32' },
        { name: 'eventsAttended', type: 'uint32' },
        { name: 'timesCovered', type: 'uint32' },
        { name: 'timesRepaid', type: 'uint32' },
        { name: 'hasOutstandingCover', type: 'bool' },
        { name: 'bannedFromCover', type: 'bool' },
        { name: 'selfPaidAttendedSinceBan', type: 'uint32' },
      ],
    }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getCreditScore',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'score', type: 'uint256' },
      { name: 'label', type: 'string' },
      { name: 'explanation', type: 'string' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getSponsorPoolInfo',
    inputs: [{ name: 'stakeAmount', type: 'uint256' }],
    outputs: [
      { name: 'balance', type: 'uint256' },
      { name: 'stakesCanCover', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const

const WRITE_ABI = [
  {
    type: 'function', name: 'createEvent',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'registrationStart', type: 'uint256' },
      { name: 'registrationEnd', type: 'uint256' },
      { name: 'date', type: 'uint256' },
      { name: 'stakeAmount', type: 'uint256' },
      { name: 'maxAttendees', type: 'uint256' },
      { name: 'codeHashes', type: 'bytes32[]' },
      { name: 'codeWindowDuration', type: 'uint256' },
      { name: 'seedAmount', type: 'uint256' },
    ],
    outputs: [], stateMutability: 'nonpayable',
  },
] as const

const ERC20_APPROVE_ABI = [
  {
    type: 'function', name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http() })

function getWalletClient() {
  const pk = process.env['ORGANISER_PRIVATE_KEY']
  if (!pk) throw new Error('ORGANISER_PRIVATE_KEY is not set.')
  const account = privateKeyToAccount(pk as `0x${string}`)
  return { client: createWalletClient({ chain: ARC_TESTNET, transport: http(), account }), account }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RawEvent = {
  id: bigint; name: string; registrationStart: bigint; registrationEnd: bigint;
  date: bigint; stakeAmount: bigint; organiser: string; maxAttendees: bigint;
  registeredCount: bigint; checkedInCount: bigint; codeWindowDuration: bigint;
  cancelled: boolean; forfeitWithdrawn: boolean;
}

function formatEvent(evt: RawEvent) {
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  let status: string
  if (evt.cancelled) { status = 'cancelled' }
  else if (nowSec < evt.registrationStart) { status = 'registration not open yet' }
  else if (nowSec <= evt.registrationEnd) { status = 'registration open' }
  else if (nowSec <= evt.date + BigInt(2 * 86400)) { status = 'in progress (check-in window)' }
  else { status = 'ended' }

  return {
    id: Number(evt.id),
    name: evt.name,
    status,
    registrationStart: new Date(Number(evt.registrationStart) * 1000).toISOString(),
    registrationEnd: new Date(Number(evt.registrationEnd) * 1000).toISOString(),
    eventDate: new Date(Number(evt.date) * 1000).toISOString(),
    stakeAmount_usdc: formatUnits(evt.stakeAmount, USDC_DECIMALS),
    organiser: evt.organiser,
    maxAttendees: Number(evt.maxAttendees),
    registeredCount: Number(evt.registeredCount),
    checkedInCount: Number(evt.checkedInCount),
    spotsLeft: Number(evt.maxAttendees) - Number(evt.registeredCount),
    codeWindowDuration_sec: Number(evt.codeWindowDuration),
    forfeitWithdrawn: evt.forfeitWithdrawn,
  }
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new McpServer({ name: 'eventstake', version: '1.0.0' })

// ---- list_events -----------------------------------------------------------

server.tool(
  'list_events',
  'List all EventStake events with status, stake amount, registered count, and spots left.',
  {},
  async () => {
    const events = await publicClient.readContract({
      address: CONTRACT_ADDRESS, abi: READ_ABI, functionName: 'getEvents',
    }) as RawEvent[]
    return { content: [{ type: 'text' as const, text: JSON.stringify(events.map(formatEvent), null, 2) }] }
  },
)

// ---- get_event -------------------------------------------------------------

server.tool(
  'get_event',
  'Get full details for one EventStake event by ID.',
  { eventId: z.number().int().positive().describe('Event ID (starts at 1).') },
  async ({ eventId }) => {
    const evt = await publicClient.readContract({
      address: CONTRACT_ADDRESS, abi: READ_ABI, functionName: 'getEvent',
      args: [BigInt(eventId)],
    }) as RawEvent
    return { content: [{ type: 'text' as const, text: JSON.stringify(formatEvent(evt), null, 2) }] }
  },
)

// ---- get_event_attendees ---------------------------------------------------

server.tool(
  'get_event_attendees',
  'Get registration and check-in status for a list of addresses at one event.',
  {
    eventId: z.number().int().positive().describe('Event ID.'),
    addresses: z.array(
      z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a 0x-prefixed EVM address.'),
    ).min(1).max(50).describe('Addresses to check (max 50).'),
  },
  async ({ eventId, addresses }) => {
    const results = await Promise.all(addresses.map(async (addr) => {
      const [registered, checkedIn] = await Promise.all([
        publicClient.readContract({
          address: CONTRACT_ADDRESS, abi: READ_ABI, functionName: 'isRegistered',
          args: [BigInt(eventId), addr as Address],
        }),
        publicClient.readContract({
          address: CONTRACT_ADDRESS, abi: READ_ABI, functionName: 'isCheckedIn',
          args: [BigInt(eventId), addr as Address],
        }),
      ])
      return { address: addr, registered: registered as boolean, checkedIn: checkedIn as boolean }
    }))
    return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] }
  },
)

// ---- get_user_record -------------------------------------------------------

server.tool(
  'get_user_record',
  "Get an address's on-chain attendance record and credit score.",
  { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe('Wallet address to look up.') },
  async ({ address }) => {
    type RawRecord = {
      eventsRegistered: number; eventsAttended: number; timesCovered: number;
      timesRepaid: number; hasOutstandingCover: boolean; bannedFromCover: boolean;
    }
    const [record, scoreResult] = await Promise.all([
      publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: READ_ABI, functionName: 'getUserRecord',
        args: [address as Address],
      }) as Promise<RawRecord>,
      publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: READ_ABI, functionName: 'getCreditScore',
        args: [address as Address],
      }) as Promise<[bigint, string, string]>,
    ])
    const [score, label, explanation] = scoreResult
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          address,
          record: {
            eventsRegistered: Number(record.eventsRegistered),
            eventsAttended: Number(record.eventsAttended),
            timesCovered: Number(record.timesCovered),
            timesRepaid: Number(record.timesRepaid),
            hasOutstandingCover: record.hasOutstandingCover,
            bannedFromCover: record.bannedFromCover,
          },
          creditScore: { score: Number(score), label, explanation },
        }, null, 2),
      }],
    }
  },
)

// ---- get_sponsor_pool ------------------------------------------------------

server.tool(
  'get_sponsor_pool',
  'Get the current sponsor pool balance and how many stakes of a given size it can cover.',
  {
    stakeAmount_usdc: z.number().nonnegative().describe(
      'Stake amount in USDC to check coverage for (e.g. 1.5). Pass 0 to get only the balance.',
    ),
  },
  async ({ stakeAmount_usdc }) => {
    const stakeRaw = parseUnits(String(stakeAmount_usdc), USDC_DECIMALS)
    const [balance, stakesCanCover] = await publicClient.readContract({
      address: CONTRACT_ADDRESS, abi: READ_ABI, functionName: 'getSponsorPoolInfo',
      args: [stakeRaw],
    }) as [bigint, bigint]
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          balance_usdc: formatUnits(balance, USDC_DECIMALS),
          stakesCanCover: Number(stakesCanCover),
          stakeChecked_usdc: formatUnits(stakeRaw, USDC_DECIMALS),
        }, null, 2),
      }],
    }
  },
)

// ---- hash_code_for_attendee ------------------------------------------------

server.tool(
  'hash_code_for_attendee',
  `Compute the codeHash to pass in codeHashes[] when creating an event for one (secret, attendeeAddress) pair.
The contract verifies: keccak256(abi.encodePacked(preimage, attendeeAddress)) == codeHashes[windowIndex]
where preimage = keccak256(secret). Use this tool to precompute hashes for known attendee addresses.
Attendees receive keccak256(secret) as their check-in preimage.`,
  {
    secret: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe('0x-prefixed 32-byte hex secret for this window.'),
    attendeeAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe('Attendee wallet address.'),
  },
  async ({ secret, attendeeAddress }) => {
    const preimage = keccak256(secret as `0x${string}`)
    const codeHash = keccak256(encodePacked(['bytes32', 'address'], [preimage, attendeeAddress as Address]))
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ secret, attendeeAddress, preimage, codeHash }, null, 2),
      }],
    }
  },
)

// ---- create_event ----------------------------------------------------------

server.tool(
  'create_event',
  `Create a new EventStake event on-chain. Requires ORGANISER_PRIVATE_KEY in the environment.
Pass codeHashes[i] = keccak256(abi.encodePacked(keccak256(secret_i), attendeeAddress)) for each
attendee and time window. Use the hash_code_for_attendee tool to compute these values.
Returns the transaction hash once the transaction is submitted.`,
  {
    name: z.string().min(1).describe('Event name.'),
    registrationStart: z.number().int().describe('Unix timestamp (seconds) when registration opens.'),
    registrationEnd: z.number().int().describe('Unix timestamp (seconds) when registration closes.'),
    date: z.number().int().describe('Unix timestamp (seconds) of the event day.'),
    stakeAmount_usdc: z.number().positive().describe('Stake amount in USDC, e.g. 2 for 2 USDC.'),
    maxAttendees: z.number().int().positive().describe('Hard cap on registered attendees.'),
    codeHashes: z.array(
      z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Each hash must be a 0x-prefixed 32-byte hex string.'),
    ).min(1).describe(
      'One pre-computed codeHash per time window. Compute with hash_code_for_attendee.',
    ),
    codeWindowDuration_sec: z.number().int().positive().describe('Duration of each window in seconds, e.g. 900 = 15 min.'),
    seedAmount_usdc: z.number().nonnegative().describe('USDC to seed the sponsor pool. Pass 0 to skip.'),
  },
  async ({
    name, registrationStart, registrationEnd, date,
    stakeAmount_usdc, maxAttendees, codeHashes, codeWindowDuration_sec, seedAmount_usdc,
  }) => {
    const { client, account } = getWalletClient()
    const stakeRaw = parseUnits(String(stakeAmount_usdc), USDC_DECIMALS)
    const seedRaw = parseUnits(String(seedAmount_usdc), USDC_DECIMALS)

    if (seedRaw > 0n) {
      const approveTx = await client.writeContract({
        address: USDC_ADDRESS, abi: ERC20_APPROVE_ABI, functionName: 'approve',
        args: [CONTRACT_ADDRESS, seedRaw], account, chain: ARC_TESTNET,
      })
      await publicClient.waitForTransactionReceipt({ hash: approveTx })
    }

    const txHash = await client.writeContract({
      address: CONTRACT_ADDRESS, abi: WRITE_ABI, functionName: 'createEvent',
      args: [
        name,
        BigInt(registrationStart), BigInt(registrationEnd), BigInt(date),
        stakeRaw, BigInt(maxAttendees),
        codeHashes as `0x${string}`[],
        BigInt(codeWindowDuration_sec), seedRaw,
      ],
      account, chain: ARC_TESTNET,
    })

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'submitted',
          txHash,
          explorer: `https://explorer.testnet.arc.io/tx/${txHash}`,
        }, null, 2),
      }],
    }
  },
)

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport()
await server.connect(transport)
