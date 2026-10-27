/**
 * Central config — all values read from process.env.
 * Never import this from frontend code (it references server env vars).
 *
 * Required env vars:
 *   CIRCLE_API_KEY            — Circle Standard Developer API Key
 *   CIRCLE_ENTITY_SECRET      — Circle entity secret for developer-controlled wallets
 *   CIRCLE_WALLET_SET_ID      — Circle wallet set ID (create one via the Circle dashboard)
 *   TWILIO_ACCOUNT_SID        — Twilio account SID
 *   TWILIO_AUTH_TOKEN         — Twilio auth token
 *   TWILIO_WHATSAPP_NUMBER    — Twilio WhatsApp sender, e.g. whatsapp:+14155238886
 *   LLM_API_KEY               — API key for the LLM provider (Anthropic by default)
 *
 * Optional:
 *   LLM_MODEL                 — Anthropic model name (default: claude-3-5-haiku-20241022)
 *   PORT                      — HTTP port (default: 3001)
 *   EVENTSTAKE_RPC_URL        — Override Arc Testnet RPC
 *   EVENTSTAKE_CONTRACT       — Override contract address
 */

function require(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable: ${name}`)
  return v
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

// arc-studio-allow-onchain-literal
const DEFAULT_RPC = 'https://rpc.testnet.arc.io'
// arc-studio-allow-onchain-literal
const DEFAULT_CONTRACT = '0x6934ca15d4c05d21cd54355b8fb1aeac5c164f75'
// arc-studio-allow-onchain-literal
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000'

export function loadConfig() {
  return {
    circle: {
      apiKey: require('CIRCLE_API_KEY'),
      entitySecret: require('CIRCLE_ENTITY_SECRET'),
      walletSetId: require('CIRCLE_WALLET_SET_ID'),
    },
    twilio: {
      accountSid: require('TWILIO_ACCOUNT_SID'),
      authToken: require('TWILIO_AUTH_TOKEN'),
      from: require('TWILIO_WHATSAPP_NUMBER'),
    },
    llm: {
      apiKey: require('LLM_API_KEY'),
      model: optional('LLM_MODEL', 'claude-3-5-haiku-20241022'),
    },
    chain: {
      rpcUrl: optional('EVENTSTAKE_RPC_URL', DEFAULT_RPC),
      contractAddress: optional('EVENTSTAKE_CONTRACT', DEFAULT_CONTRACT) as `0x${string}`,
      usdcAddress: USDC_ADDRESS as `0x${string}`,
      usdcDecimals: 6,
      chainId: 5042002,
    },
    port: Number(optional('PORT', '3001')),
  }
}

export type Config = ReturnType<typeof loadConfig>
