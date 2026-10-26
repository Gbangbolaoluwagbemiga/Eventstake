# EventStake

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** — what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

USDC stake-to-attend event check-in dApp on Arc Testnet. Key features:

- Organisers create events with a USDC stake, max attendees, rotating venue codes, and an optional sponsor pool seed.
- Attendees register by staking USDC; check in with a rotating venue code (anti-front-running: stored hash = `keccak256(preimage || attendeeAddr)`).
- No-shows forfeit: 80% to organiser credits, 20% to shared sponsor pool.
- On-chain cover agent: attendees can request stake cover backed by the sponsor pool; decisions use 5 eligibility rules + credit score gate (deny if score < 40 and eventsRegistered > 0).
- Credit score 0–100 with labels: trusted (≥80), building (≥60), at risk (≥40), low (<40); new users get label "new".
- Ban system: covered no-shows are banned from future cover; ban lifts after 1 self-paid attended event.
- Stake rescue (`reclaimStake`): available 24h post-event if fewer than 5% checked in.
- Organiser pull-payment via `organiserCredits` mapping + `withdrawOrganiserShare()`.
- Soulbound ERC-721 NFT minted on successful check-in.

## Contracts

- **EventCheckIn v3** (`contracts/EventCheckIn.sol`) — current, deployed on Arc Testnet
  - Address: `0x6934ca15d4c05d21cd54355b8fb1aeac5c164f75`
  - Explorer: https://explorer.testnet.arc.io/address/0x6934ca15d4c05d21cd54355b8fb1aeac5c164f75
  - Deploy tx: `0x745dcb50f1d939687bc65ff9b856754969dc5f7aead67240da893d2364612dd6`
  - Deployer wallet ID: `3c2464b2-8369-52e2-a782-800bbeca5396`
  - Constructor: `(address _usdc)` — USDC address: `0x3600000000000000000000000000000000000000`
  - ABI: defined inline in `src/contract.ts`

- **EventCheckIn v2** (deprecated): `0x6023bfc130b40a7cba4b32634ab77077e617d89c`
- **EventCheckIn v1** (deprecated): `0x286e1cc67358a074186eca25f4f229f950c431f2`

## Key Files

- `src/contract.ts` — `CONTRACT_ADDRESS` + inline ABI
- `src/lib/share.ts` — `getShareBase` / `buildShareLink`
- `src/App.tsx` — BrowserRouter with 11 routes
- `src/components/` — `NavBar`, `EventCard`, `ScoreRing`, `TransactionButton`, `AttendeeList`
- `src/pages/` — `LandingPage`, `EventsPage`, `EventDetailPage`, `CheckInPage`, `MyEventsPage`, `MyRecordPage`, `CreateEventPage`, `OrganiserDashboardPage`, `DoorPage`, `SponsorPoolPage`, `CoverLogPage`
- `contracts/EventCheckIn.sol` — v3 contract
- `contracts/EventCheckIn-v2-design.md` — design doc
- `contracts/test/` — 107 unit tests (all passing)

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS, `react-router-dom` v6
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Build: `forge build`, Test: `forge test`
- Chain: Arc Testnet (Chain ID: 5042002)
- Token: USDC (6 decimals, `0x3600000000000000000000000000000000000000`)
- Toasts: Sonner

## Deployed Frontend

- Netlify: https://zesty-treacle-50e32a.netlify.app

## Key Decisions

- No Aave / external yield — USDC sits in contract
- No `markPresent` — attendees check in with rotating venue codes only
- 80/20 forfeit split (organiser / sponsor pool), shown on every event card
- `MAX_COVERED_ATTENDEES = 50` per event
- Organiser withdraws via pull-payment to prevent Arc USDC blocklist risk

## To Run

```bash
bun install
bun run dev
```

## Environment Variables

- None required for local dev (public RPC via `src/onchain-facts.ts`)
- `CIRCLE_API_KEY` — in `.env` (Arc Studio provisioned, for Circle SDK usage)
- `CIRCLE_ENTITY_SECRET` — in `.env` (registered entity secret for developer-controlled wallets)
