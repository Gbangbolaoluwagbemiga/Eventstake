# EventStake

USDC stake-to-attend event check-in app on Arc Testnet. Attendees stake USDC to register; no-shows forfeit their stake (80% to the organiser, 20% to a shared sponsor pool). An onchain cover agent lets attendees request stake cover backed by the pool, with credit scoring and a ban system for covered no-shows.

Built with [Arc Studio](https://studio.arc.io)

## Tech Stack

- React 18, Vite, TypeScript, Tailwind CSS
- wagmi v2, viem v2, ConnectKit, react-router-dom v6
- Solidity 0.8.28 + Foundry (contracts in `contracts/`)
- Chain: Arc Testnet (chain ID 5042002)
- Token: USDC (6 decimals)

## Development

### Prerequisites

- Node 18+ and [bun](https://bun.sh)
- [Foundry](https://getfoundry.sh) (for contract work)

### Install

```bash
bun install
```

### Environment Variables

| Variable | Purpose |
|---|---|
| `CIRCLE_API_KEY` | Circle Standard Developer API Key (provisioned by Arc Studio; optional outside Arc Studio) |
| `CIRCLE_ENTITY_SECRET` | Circle entity secret for developer-controlled wallets (optional outside Arc Studio) |

### Run

```bash
bun run dev
```

### Build

```bash
bun run build
```

### Test

```bash
# Lint + typecheck
bun run check

# Solidity unit tests (107 tests)
forge test --root contracts
```

## Contract

`contracts/EventCheckIn.sol` — deployed at `0x6934ca15d4c05d21cd54355b8fb1aeac5c164f75` on Arc Testnet.

Explorer: https://explorer.testnet.arc.io/address/0x6934ca15d4c05d21cd54355b8fb1aeac5c164f75
