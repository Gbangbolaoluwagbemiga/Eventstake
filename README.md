# EventStake

Stake USDC to register for an event. Check in at the door and your stake returns instantly with an attendance NFT. Miss it and 80% goes to the organiser who catered for you, 20% to a pool that covers people who cannot afford a stake.

Built with [Arc Studio](https://studio.arc.io)

---

## Contract

- **Address:** `0x6934ca15d4c05d21cd54355b8fb1aeac5c164f75`
- **Chain:** Arc Testnet, chain ID 5042002
- **Explorer:** https://explorer.testnet.arc.io/address/0x6934ca15d4c05d21cd54355b8fb1aeac5c164f75
- **Token:** USDC at `0x3600000000000000000000000000000000000000` (6 decimals)

---

## Tech stack

- React 18, Vite, TypeScript, Tailwind CSS
- wagmi v2, viem v2, ConnectKit, react-router-dom v6
- Solidity 0.8.28 + Foundry (sources in `contracts/`, tests in `contracts/test/`)
- Chain: Arc Testnet (USDC is the native gas token)

---

## Run locally

### Prerequisites

- [bun](https://bun.sh) 1.x
- [Foundry](https://getfoundry.sh) (for contract work only)

### Install

```bash
bun install
```

### Environment variables

**Frontend (none required to browse):**

| Variable | Purpose |
|---|---|
| `EVENTSTAKE_RPC_URL` | Override Arc Testnet RPC — defaults to `https://rpc.testnet.arc.io` |
| `EVENTSTAKE_CONTRACT` | Override contract address — defaults to the deployed address above |

**MCP server** (`ORGANISER_PRIVATE_KEY` only, for `create_event`):

| Variable | Purpose |
|---|---|
| `ORGANISER_PRIVATE_KEY` | 0x-prefixed private key for the organiser wallet |

**WhatsApp agent** (all required to run `whatsapp:server`):

| Variable | Purpose |
|---|---|
| `CIRCLE_API_KEY` | Circle Standard Developer API Key |
| `CIRCLE_ENTITY_SECRET` | Circle entity secret for developer-controlled wallets |
| `CIRCLE_WALLET_SET_ID` | Circle wallet set ID (create one in the Circle Console) |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_WHATSAPP_NUMBER` | Twilio WhatsApp sender, e.g. `whatsapp:+14155238886` |
| `LLM_API_KEY` | Anthropic API key for intent parsing |
| `LLM_MODEL` | Anthropic model name — defaults to `claude-3-5-haiku-20241022` |
| `PORT` | HTTP port — defaults to `3001` |

Never commit `.env`. The `.gitignore` already excludes it, along with `.circle/`, `*recovery*`, `console.jsonl`, and `traces.jsonl`.

### Start the frontend

```bash
bun run dev
```

### Start the WhatsApp agent

```bash
bun run whatsapp:server
```

### Build

```bash
bun run build
```

### Lint and typecheck

```bash
bun run check
```

### Solidity unit tests (107 tests)

```bash
bun run contracts:test
```

---

## WhatsApp agent

Users send a WhatsApp message to your Twilio number. No app install, no wallet setup — they just text.

On first message, a Circle developer-controlled wallet is created for their phone number. They see their address and are told they control the funds. They never see a seed phrase.

The agent understands Nigerian English, pidgin, and typos via Claude. It maps messages like "abeg register me for the arc meetup", "i don reach", "wetin be my score", and "how much I get" to the right action.

Before any money moves, it repeats exactly what it is about to do and waits for YES. Anything else cancels.

Set up a Twilio WhatsApp sandbox (Twilio Console → Messaging → Try it out → Send a WhatsApp message), point the inbound webhook to `https://<your-host>/webhook/whatsapp` via HTTP POST. For production, point your approved Twilio WhatsApp sender to the same path.

---

## MCP server

An MCP server over stdio lets another agent or tool use EventStake without reading the code. See `SKILL.md` at the repository root for the full action reference.

```bash
bun run mcp:server
```

Tools exposed:

| Tool | Key needed |
|---|---|
| `list_events` | No |
| `get_event` | No |
| `get_event_attendees` | No |
| `get_user_record` | No |
| `get_sponsor_pool` | No |
| `hash_code_for_attendee` | No |
| `create_event` | Yes (`ORGANISER_PRIVATE_KEY`) |

To wire it into Claude Desktop or any MCP client, add this to your `mcpServers` config:

```json
{
  "eventstake": {
    "command": "bun",
    "args": ["run", "/path/to/repo/mcp/server.ts"],
    "env": {
      "ORGANISER_PRIVATE_KEY": "0x..."
    }
  }
}
```

---

## What this app deliberately does not do

**It cannot prove someone was physically in the room.** The check-in code proves the attendee held the right QR code during the active time window. It does not prove they were standing at the venue. Two design choices bound the exposure:

- Codes rotate. The organiser sets a window duration (for example 15 minutes) and supplies one code per window. A code shared before the event only works for the window it was valid in, and per-attendee binding (`keccak256(preimage || attendeeAddress)`) stops one person passing their code to another via the mempool.
- The headcount cap (`maxAttendees`) limits how many registrations an event can take, which limits the total forfeited stake an abusive scheme could extract.

**The organiser cannot mark anyone present.** There is no `markPresent` function. Only the attendee's own transaction counts. An organiser who withholds codes entirely triggers a rescue: if fewer than 5% of registrants check in after 24 hours, every attendee can reclaim their full stake and the organiser forfeits their 80% share.

**The credit score has no AI.** It is computed from four on-chain counters (attendance rate, cover repayment rate, ban flag, outstanding cover flag) using a fixed formula. Anyone can recompute it from the public `getUserRecord` output. Explanations are template strings filled with the same counters.

**The sponsor pool has no withdrawal path.** Funds enter through forfeitures, donations, and covered-no-show repayments, and leave only when the contract approves a cover grant. There is no admin key, no owner, and no upgrade proxy.
