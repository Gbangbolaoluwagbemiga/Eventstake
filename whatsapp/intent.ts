/**
 * LLM-powered intent parser.
 *
 * Sends the user's message, the list of open events, and the user's record
 * to Claude (or another Anthropic model). The model returns a structured
 * JSON intent — one of the shapes defined in types.ts.
 *
 * The system prompt is written to handle Nigerian English, Pidgin, typos,
 * and informal phrasing. It never invents an event ID or an amount.
 * If more than one event could match, it returns { action: "list_events" }
 * so the calling code can ask the user to pick.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Config } from './config.js'
import type { Intent } from './types.js'
import type { EventData } from './chain.js'

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the intent parser for EventStake, a USDC stake-to-attend event app used mainly by Nigerian university students and young professionals. Messages arrive via WhatsApp and are written in Nigerian English, Pidgin, or a mix of both. Typos and abbreviations are common.

Your job is to read one WhatsApp message and return a single JSON object representing the user's intent. Return ONLY the JSON object — no explanation, no markdown, no extra text.

Possible intents:

{ "action": "list_events" }
  — user wants to see open events, or said something general like "wetin dey", "show me events", "what events", "abeg show me"

{ "action": "show_event", "eventId": <number> }
  — user wants details about a specific event they named or referenced by number

{ "action": "register", "eventId": <number> }
  — user wants to register / join / sign up for a specific event
  — examples: "register me for event 3", "abeg put me for arc meetup", "i wan attend", "sign me up"
  — ONLY use this if exactly one event matches. If multiple events could match, return list_events instead.

{ "action": "checkin", "eventId": <number>, "preimage": "<the code they sent>" }
  — user is checking in at the door by submitting a code
  — examples: "i don reach", "the code is 0xabc...", "here is my code: abc123", "i reach, code: xyz"
  — the preimage is whatever they sent after "code" or similar. If no code is present, return list_events.

{ "action": "my_record" }
  — user wants their attendance history and credit score
  — examples: "wetin be my score", "show my record", "how many event i attend", "my history"

{ "action": "my_balance" }
  — user wants to know how much USDC they have
  — examples: "how much I get", "wetin be my balance", "check my money", "how much dey my wallet"

{ "action": "organiser_summary", "eventId": <number> }
  — user is an organiser asking about registrations or check-ins for their event
  — examples: "how many people register", "who don check in", "show me the numbers for event 2"
  — ONLY if a specific event can be identified

{ "action": "pool_balance" }
  — user wants to know the sponsor pool balance
  — examples: "how much dey pool", "sponsor pool balance", "pool money"

{ "action": "unknown" }
  — you cannot map the message to any intent with confidence
  — use this when the message is genuinely unclear, a greeting without a request, or something outside the above

Rules:
- Never invent an eventId. Only use IDs from the event list provided.
- If the user names an event ("arc meetup", "house lagos") and exactly one open event matches, use its ID.
- If two or more open events could match the name, return list_events.
- If the user wants to register but has not named any event, return list_events.
- For checkin, extract the preimage exactly as the user sent it. If it is not a hex string starting with 0x, wrap it as-is — the calling code will validate.
- Do not add fields that are not in the schema above.`

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function buildIntentParser(config: Config) {
  const client = new Anthropic({ apiKey: config.llm.apiKey })

  async function parseIntent(params: {
    message: string
    openEvents: EventData[]
    walletAddress: string
  }): Promise<Intent> {
    const eventsJson = JSON.stringify(
      params.openEvents.map((e) => ({
        id: e.id,
        name: e.name,
        date: e.eventDate.toDateString(),
        stake_usdc: e.stakeAmount_usdc,
        spotsLeft: e.spotsLeft,
      })),
    )

    const userContent = `Open events: ${eventsJson}

User wallet: ${params.walletAddress}

WhatsApp message: ${params.message}`

    const response = await client.messages.create({
      model: config.llm.model,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })

    const raw = response.content[0]
    if (raw.type !== 'text') return { action: 'unknown' }

    // Strip markdown fences if the model wrapped its output
    const text = raw.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    try {
      const parsed = JSON.parse(text) as Intent
      // Basic validation
      if (typeof parsed !== 'object' || parsed === null || typeof parsed.action !== 'string') {
        return { action: 'unknown' }
      }
      return parsed
    } catch {
      return { action: 'unknown' }
    }
  }

  return { parseIntent }
}

export type IntentParser = ReturnType<typeof buildIntentParser>
