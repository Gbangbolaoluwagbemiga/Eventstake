# EventStake — skill reference

Use this file to understand and interact with EventStake without reading the source code. It covers what the system does, the rules it enforces, and every action available through the contract.

---

## What it does

EventStake is a stake-to-attend system for real-world events. An organiser creates an event and sets a USDC stake amount. Attendees register by transferring that stake to the contract. At the event, the organiser displays a rotating QR code; attendees scan it to check in, which proves they were present enough to enter that code window. After the event, checked-in attendees claim their stake back and receive a soulbound attendance NFT. Attendees who did not check in forfeit their stake: 80 % goes to the organiser, 20 % goes to a shared sponsor pool.

The sponsor pool also accepts donations and can cover the stake for attendees who cannot afford one, subject to a credit score computed entirely on-chain from each address's attendance and repayment history.

---

## Contract

- **Address:** `0x6934ca15d4c05d21cd54355b8fb1aeac5c164f75`
- **Chain:** Arc Testnet (chain ID 5042002)
- **RPC:** `https://rpc.testnet.arc.io`
- **Explorer:** https://explorer.testnet.arc.io/address/0x6934ca15d4c05d21cd54355b8fb1aeac5c164f75
- **Token:** USDC at `0x3600000000000000000000000000000000000000` (6 decimals)
- **NFT name:** "Event Attendance Proof" (symbol: EAP) — soulbound, non-transferable

---

## Rules the contract always enforces

- Stake amounts are in USDC with 6 decimals (e.g. 1 USDC = 1_000_000).
- Registration is only open between `registrationStart` and `registrationEnd` (Unix timestamps).
- Check-in is only valid between `date` and `date + 2 days`.
- The organiser cannot mark anyone present; only the attendee can check in, using a code the organiser distributed.
- Check-in codes rotate. The organiser supplies an array of `keccak256` hashes at creation time and a window duration in seconds. The active window is `(block.timestamp - date) / codeWindowDuration`, clamped to the last index. The hash stored is `keccak256(preimage)`, but the contract verifies `keccak256(abi.encodePacked(preimage, attendeeAddress))`, so each code only works for the specific attendee it was issued to and cannot be replayed from the mempool.
- If fewer than 5 % of registered attendees checked in and it is more than 24 hours after the event, every attendee (covered or not) can call `reclaimStake` to recover their full stake. This protects against an organiser who withholds codes; the organiser loses their 80 % share if they do.
- The organiser's 80 % share is not pushed automatically; it accumulates in `organiserCredits` and must be withdrawn explicitly via `withdrawOrganiserShare`. This protects against USDC blocklists.
- Cover is limited to 50 covered attendees per event (`MAX_COVERED_ATTENDEES`). A covered attendee who does not check in is banned from future cover until they attend one self-paid event.
- The sponsor pool has no withdrawal path. Funds enter it through forfeitures, donations, and covered-no-show repayments, and leave only through approved cover grants.
- The credit score is computed deterministically from four on-chain counters: attendance rate, cover repayment rate, ban flag, and outstanding cover flag. No external oracle or AI is involved. Anyone can recompute it from the public `getUserRecord` output using the formula in the contract.

---

## Read actions (no wallet or key needed)

All of these are `eth_call` reads against the contract address on Arc Testnet.

### List all events
**Function:** `getEvents() returns (Event[])`

Returns every event ever created as a struct array. Each struct contains:

| Field | Type | Meaning |
|---|---|---|
| `id` | uint256 | Event ID (starts at 1) |
| `name` | string | Human-readable name |
| `registrationStart` | uint256 | Unix timestamp when registration opens |
| `registrationEnd` | uint256 | Unix timestamp when registration closes |
| `date` | uint256 | Unix timestamp of the event (check-in window starts here) |
| `stakeAmount` | uint256 | USDC stake in 6-decimal units |
| `organiser` | address | Address that created the event |
| `maxAttendees` | uint256 | Hard cap on registrations |
| `registeredCount` | uint256 | Current number of registered attendees |
| `checkedInCount` | uint256 | Number who checked in so far |
| `codeWindowDuration` | uint256 | Seconds per rotating code window |
| `cancelled` | bool | Whether the event was cancelled |
| `forfeitWithdrawn` | bool | Whether the organiser has already claimed forfeits |

To filter to open events: keep only those where `cancelled = false`, `registeredCount < maxAttendees`, and `block.timestamp` is between `registrationStart` and `registrationEnd`.

### Read a single event
**Function:** `getEvent(uint256 eventId) returns (Event)`

Same struct as above, for one event by ID.

### Check registration and check-in status for an address
**Function:** `isRegistered(uint256 eventId, address attendee) returns (bool)`
**Function:** `isCheckedIn(uint256 eventId, address attendee) returns (bool)`
**Function:** `hasClaimed(uint256 eventId, address attendee) returns (bool)`
**Function:** `isCoveredRegistration(uint256 eventId, address attendee) returns (bool)`

Use these to read the full status of one attendee at one event.

### Read an address's record and credit score

**Function:** `getUserRecord(address user) returns (UserRecord)`

Returns the raw counters:

| Field | Type | Meaning |
|---|---|---|
| `eventsRegistered` | uint32 | Total events registered (including covered) |
| `eventsAttended` | uint32 | Total events checked in and claimed |
| `timesCovered` | uint32 | How many times the pool covered this address |
| `timesRepaid` | uint32 | How many covered stakes were repaid by attending |
| `hasOutstandingCover` | bool | True if currently registered via cover for an event that has not ended |
| `bannedFromCover` | bool | True if forfeited a covered stake (lifted after one self-paid attend) |
| `selfPaidAttendedSinceBan` | uint32 | Counter used to lift the ban |

**Function:** `getCreditScore(address user) returns (uint256 score, string label, string explanation)`

Returns a score from 0 to 100, a label (`new` / `trusted` / `building` / `at risk` / `low`), and a plain-language explanation string. The score is computed as:

```
base = 50
+ (attendanceRate * 40) / 100       // 0–40 points
+ (repayRate * 20) / 100            // 0–20 points (20 if never covered)
- 20 if bannedFromCover             // penalty
- 5  if hasOutstandingCover         // minor penalty
clamped to [0, 100]
```

A new address with no history returns score 0, label `new`, and the explanation "Not enough history yet".

**Function:** `getCoverEligibility(address user, uint256 eventId) returns (bool eligible, string reason)`

Returns whether the pool would cover this address for this event right now, and the reason if not. This is a pure read — it does not grant cover.

### Read the sponsor pool balance
**Function:** `getSponsorPoolInfo(uint256 stakeAmount) returns (uint256 balance, uint256 stakesCanCover)`

Returns the current pool balance in USDC (6 decimals) and how many stakes of `stakeAmount` it could cover. Pass 0 for `stakeAmount` to get just the balance (`stakesCanCover` will be 0).

**Function:** `sponsorPool() returns (uint256)`

Returns the raw pool balance directly.

---

## Write actions (require a connected wallet)

### Create an event
**Function:** `createEvent(string name, uint256 registrationStart, uint256 registrationEnd, uint256 date, uint256 stakeAmount, uint256 maxAttendees, bytes32[] codeHashes, uint256 codeWindowDuration, uint256 seedAmount)`

The caller becomes the organiser. Before calling, approve the contract to spend `seedAmount` USDC if seeding the pool (pass 0 to skip).

**codeHashes** is the array of rotating check-in code hashes. For each window `i`, the organiser computes:
```
secret_i = random 32-byte value
hash_i = keccak256(abi.encodePacked(keccak256(secret_i), attendeeAddress))
```
At check-in time, the organiser gives each attendee `keccak256(secret_i)` as their preimage. The contract then verifies `keccak256(abi.encodePacked(preimage, msg.sender)) == hash_i`.

In practice: generate one secret per time window, compute the hash for each registered attendee, and encode the preimage in a QR code shown only to that attendee.

**codeWindowDuration** is in seconds. For example, 900 = 15-minute windows.

Requires: USDC approval for `seedAmount` if non-zero.

### Register for an event
**Function:** `register(uint256 eventId)`

Transfers `stakeAmount` USDC from the caller to the contract. Requires prior USDC approval.

### Request cover (register without paying)
**Function:** `requestCover(uint256 eventId)`

Asks the sponsor pool to cover the stake. The pool transfers internally. No USDC approval needed. The contract checks all eligibility rules and emits `CoverGranted` or `CoverDenied`. A denied call does not revert — check the emitted event for the reason.

### Check in at the door
**Function:** `checkIn(uint256 eventId, bytes32 preimage)`

The attendee submits the preimage the organiser gave them. The contract verifies `keccak256(abi.encodePacked(preimage, msg.sender))` matches the active window's stored hash.

### Claim stake back after checking in
**Function:** `claimBack(uint256 eventId)`

Available once the event's `registrationEnd` has passed. Transfers the stake back (or repays the pool if covered) and mints a soulbound NFT.

### Reclaim stake when the organiser withheld codes
**Function:** `reclaimStake(uint256 eventId)`

Available more than 24 hours after the event if fewer than 5 % of registrants checked in. Returns the full stake to each attendee who calls it. Does not mint an NFT.

### Withdraw organiser share
**Function:** `withdrawOrganiserShare()`

Transfers the caller's accumulated organiser credits to their wallet. Call after `withdrawForfeited` has been called for one or more events.

### Withdraw forfeited stakes (organiser only)
**Function:** `withdrawForfeited(uint256 eventId)`

Can only be called by the event organiser, more than 2 days after the event. Splits no-show stakes 80/20 into `organiserCredits` and `sponsorPool`. Also sets ban flags on covered no-shows.

### Donate to the sponsor pool
**Function:** `donate(uint256 amount)`

Adds USDC to the pool. Requires prior USDC approval.

---

## Events emitted

| Event | When |
|---|---|
| `EventCreated(eventId, organiser, name, date, stakeAmount, maxAttendees)` | New event created |
| `Registered(eventId, attendee)` | Attendee registered (paid or covered) |
| `CheckedIn(eventId, attendee)` | Attendee checked in |
| `Claimed(eventId, attendee, amount)` | Stake claimed back after check-in |
| `ForfeitWithdrawn(eventId, organiser, organiserAmount, poolAmount)` | Organiser withdrew forfeits |
| `OrganiserShareWithdrawn(organiser, amount)` | Organiser pulled their credits |
| `StakeRescued(eventId, attendee, amount)` | Stake reclaimed under the <5% rule |
| `CoverGranted(eventId, attendee, amount, reason)` | Pool covered a registration |
| `CoverDenied(eventId, attendee, reason)` | Cover request rejected (not a revert) |
| `CoverRepaid(eventId, attendee, amount)` | Covered attendee checked in and repaid pool |
| `Donated(donor, amount)` | Donation added to pool |

---

## What this system deliberately cannot do

- **Prove physical presence.** The check-in code proves the attendee held that QR code at that moment. It does not prove they were in the room. The rotating window and per-attendee binding (code = `keccak256(preimage || address)`) make it expensive to share codes in advance, and the headcount cap (`maxAttendees`) limits the blast radius of any abuse.
- **Force check-in.** The organiser cannot mark anyone present. Only the attendee's own transaction counts.
- **Guarantee the pool covers everyone.** Cover is first-come, first-served up to 50 per event, and only when the pool has enough USDC.
- **Reverse transactions.** All actions are onchain and final once confirmed.
