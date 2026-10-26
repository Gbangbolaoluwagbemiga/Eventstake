# EventCheckIn V2 — Design Document

**Status:** Draft  
**Target chain:** Arc Testnet (chain ID 5042002) → Arc Mainnet after testing  
**Language / toolchain:** Solidity ^0.8.20, Foundry, OpenZeppelin 5.1.x, Paris EVM  
**Milestone:** V2 feature extension — sponsor pool, rotating check-in codes, cover agent  

## Action Items (living)

_Empty — fill after review rounds._

---

## 1 · Goals / Non-Goals

**Goals**
- Replace organiser-controlled attendance with a venue code scheme that the organiser cannot manipulate.
- Route 20% of every forfeited stake to a sponsor pool; 80% to the organiser.
- Allow any registered attendee to reclaim their stake if an event effectively did not run (< 5% check-in rate, 24 h after end).
- Let covered attendees register for free when the sponsor pool can fund them, with five on-chain eligibility rules and a reason string on every decision.
- Track each address's full participation record on-chain.

**Non-Goals**
- No Aave or any external yield protocol. USDC sits in the contract.
- No chain switching. Arc Testnet only during testing; Arc Mainnet when ready.
- No governance or upgradeability. The contract is immutable.
- No per-event pool — the sponsor pool is global.

---

## 2 · Requirements

### Functional
- Organiser supplies an array of code hashes and a window duration at event creation.
- The active hash is determined by `(block.timestamp - eventDate) / windowDuration`, clamped to the array length.
- `checkIn(eventId, preimage)`: anyone with the correct preimage for the active window is checked in; the organiser cannot block or grant this.
- `withdrawForfeited(eventId)`: callable by organiser ≥ 24 h after event end; transfers 80% to organiser, 20% to `sponsorPool`. Covered no-shows are excluded from both shares (their slot was funded by the pool, not by themselves).
- `reclaimStake(eventId)`: callable by a registered, non-checked-in attendee ≥ 24 h after event end, **only when** `checkedInCount * 100 / registeredCount < 5`. Returns the full stake; does not flow to organiser or pool.
- `requestCover(eventId)`: on-chain cover agent checks five rules in order; emits `CoverGranted` or `CoverDenied` with a one-sentence reason string.
- `donate(uint256)`: anyone may add USDC to the sponsor pool at any time.
- `createEvent(... seedAmount)`: organiser optionally seeds the pool at creation.

### Security (testable assertions)
- No path allows any actor to withdraw from `sponsorPool` directly.
- Organiser cannot check in or block check-in for any attendee.
- `reclaimStake` reverts when `checkedInCount * 100 / registeredCount >= 5`.
- A covered attendee's `claimBack` returns stake to `sponsorPool`, not to the attendee.
- A covered no-show slot is never double-counted in the forfeiture calculation.
- `sponsorPool` never goes below zero; cover is never granted if `sponsorPool < stakeAmount`.
- Every function that moves USDC uses CEI ordering and `nonReentrant`.

---

## 3 · Terminology & Actors

| Term | Definition |
|---|---|
| Organiser | Creator of an event. Sets name, dates, stake, max attendees, code hashes, window duration, optional seed. Cannot touch attendance. |
| Attendee | Any address that registers for an event. Pays the stake or is covered. |
| Covered attendee | Registered via `requestCover`; stake funded by sponsor pool. |
| Venue code | A secret preimage the organiser displays at the event. Rotating on a fixed schedule baked in at creation. |
| Code window | A time slot during the event day. Each window has exactly one valid hash. |
| Sponsor pool | Global USDC balance inside the contract. Fed by forfeit share, organiser seeds, donations. Spent only on covers. |
| Forfeited stake | Stake from a paid registrant who never checked in and whose event had ≥ 5% attendance. |
| Reclaimed stake | Stake returned to the owner when attendance < 5% — not a forfeit, not shared. |
| UserRecord | Per-address struct: eventsRegistered, eventsAttended, timesCovered, timesRepaid, hasOutstandingCover, bannedFromCover, selfPaidAttendedSinceBan. |

**Trust levels**

| Actor | Trust | What they can do |
|---|---|---|
| Organiser | Semi-trusted | Creates event, posts code hashes, seeds pool, withdraws forfeit share |
| Attendee | Untrusted | Registers, checks in with code, claims stake/NFT, requests cover, reclaims if eligible |
| Anyone | Untrusted | Donates to pool |
| Contract | Trusted | Enforces all rules |

---

## 4 · Language / Runtime

- Solidity `^0.8.20` — checked arithmetic, custom errors, immutables.
- EVM target: Paris (`evm_version = "paris"` in `foundry.toml`). No Cancun opcodes.
- OpenZeppelin 5.1.0 pinned (`@openzeppelin/contracts` in `package.json`). No 5.2+ (uses `mcopy`).
- Foundry for build, test, deploy.

---

## 5 · Transaction & Execution Model

Execution is atomic. All state is committed or reverted in one transaction.

Re-entry surface: `register`, `checkIn`, `claimBack`, `withdrawForfeited`, `reclaimStake`, `requestCover`, `donate` all move USDC. All use `nonReentrant` and CEI (state written before any `safeTransfer`).

No external calls to untrusted contracts. USDC (`SafeERC20`) is the only external call.

---

## 6 · Chain Standards & Interfaces

- ERC-721 (attendance NFT, soulbound via `_update` override).
- ERC-20 (USDC via `IERC20` / `SafeERC20`).
- No cross-chain messaging.

---

## 7 · Architecture — Flow of Funds

```
Attendee pays stake
  → register()  ──────────────────────────────────────→ contract holds stakeAmount

Attendee checks in (venue code)
  → checkIn()   [no fund movement]

Attendee claims back (checked-in)
  → claimBack()
      if NOT covered: stakeAmount → attendee, NFT minted
      if covered:     stakeAmount → sponsorPool, NFT minted

Organiser withdraws forfeits (≥ 24 h after event, ≥ 5% attendance)
  → withdrawForfeited()
      80% of forfeited stakes → organiser
      20% of forfeited stakes → sponsorPool

Attendee reclaims (not checked-in, < 5% attendance, ≥ 24 h)
  → reclaimStake()
      stakeAmount → attendee  [no share to pool or organiser]

Cover granted
  → requestCover()
      sponsorPool -= stakeAmount
      attendee is registered (coveredRegistration=true)

Donation / seed
  → donate() / createEvent(seedAmount)
      USDC → sponsorPool
```

**Resting-state invariant:** `contract.usdcBalance >= sum of all stakeAmounts owed to registered, non-claimed attendees (excluding covered slots, whose liability sits in sponsorPool accounting)`.

**Per-step invariants:**

| Step | Invariant |
|---|---|
| After `register()` | `contract balance += stakeAmount` |
| After `checkIn()` | No balance change |
| After `claimBack()` (paid) | `contract balance -= stakeAmount` |
| After `claimBack()` (covered) | `sponsorPool += stakeAmount` |
| After `withdrawForfeited()` | `contract balance -= 80% * forfeits`; `sponsorPool += 20% * forfeits` |
| After `reclaimStake()` | `contract balance -= stakeAmount` |
| After `requestCover()` | `sponsorPool -= stakeAmount`; `contract balance += 0` (accounting only) |
| After `donate()` | `sponsorPool += amount`; `contract balance += amount` |

---

## 8 · Contract Design

### Storage

```solidity
struct Event {
    uint256 id;
    string name;
    uint256 registrationStart;
    uint256 registrationEnd;
    uint256 date;           // event start timestamp
    uint256 stakeAmount;
    address organiser;
    uint256 maxAttendees;
    uint256 registeredCount;
    uint256 checkedInCount;
    uint256 paidRegistrantCount;   // registered - coveredCount per event
    uint256 coveredCount;          // covered registrations for this event
    uint256 windowDuration;        // seconds per code window
    bytes32[] codeHashes;          // hashes for each window (index = window number)
    bool forfeitWithdrawn;
    bool cancelled;
}

struct UserRecord {
    uint32 eventsRegistered;
    uint32 eventsAttended;
    uint32 timesCovered;
    uint32 timesRepaid;
    bool   hasOutstandingCover;
    bool   bannedFromCover;
    uint32 selfPaidAttendedSinceBan;
}

IERC20 immutable usdc;
uint256 public sponsorPool;

mapping(uint256 => Event)                                     _events;
mapping(uint256 => mapping(address => bool))                  _registered;
mapping(uint256 => mapping(address => bool))                  _checkedIn;
mapping(uint256 => mapping(address => bool))                  _claimed;
mapping(uint256 => mapping(address => bool))                  _coveredRegistration;
mapping(uint256 => mapping(bytes32 => bool))                  _usedPreimage;  // replay protection
mapping(address => UserRecord)                                _userRecords;
mapping(uint256 => uint256)                                   _claimedCount;
mapping(uint256 => bool)                                      _reclaimEnabled;  // computed lazily
uint256 _nextEventId;
uint256 _nextTokenId;
mapping(uint256 => uint256) _tokenEventId;
```

### Key write functions

| Function | Caller | State mutated | Events | Revert conditions |
|---|---|---|---|---|
| `createEvent(name, regStart, regEnd, date, stakeAmount, maxAttendees, windowDuration, codeHashes, seedAmount)` | Anyone | Writes Event struct; if seedAmount>0 transfers to sponsorPool | `EventCreated` | dates invalid; stakeAmount/max=0; codeHashes empty; windowDuration=0 |
| `register(eventId)` | Attendee | _registered, registeredCount, paidRegistrantCount, UserRecord.eventsRegistered | `Registered` | not in regWindow; already registered; at cap; cancelled |
| `checkIn(eventId, preimage)` | Attendee | _checkedIn, checkedInCount, _usedPreimage | `CheckedIn` | not registered; already checked in; outside checkIn window (date to date+windowDuration*len); wrong hash; preimage already used |
| `claimBack(eventId)` | Attendee | _claimed, claimedCount; UserRecord.eventsAttended/timesRepaid/hasOutstandingCover/bannedFromCover; sponsorPool if covered | `Claimed` or `CoverRepaid` | not checked in; already claimed |
| `withdrawForfeited(eventId)` | Organiser | forfeitWithdrawn; transfers USDC; sponsorPool | `ForfeitWithdrawn` | not organiser; < 24h after event end; already withdrawn; reclaimStake scenario (< 5%) |
| `reclaimStake(eventId)` | Attendee | _claimed; transfers USDC back | `StakeReclaimed` | checked in; already claimed; < 24h after event end; attendance ≥ 5%; not registered |
| `requestCover(eventId)` | Attendee | sponsorPool; _registered; _coveredRegistration; UserRecord; evt.coveredCount | `CoverGranted` / `CoverDenied` | event not in reg window; already registered; at cap |
| `donate(uint256)` | Anyone | sponsorPool | `Donated` | amount=0 |

### Rotating code mechanic

```
activeWindowIndex = min(
    (block.timestamp - eventDate) / windowDuration,
    codeHashes.length - 1
)
expectedHash = codeHashes[activeWindowIndex]
require(keccak256(abi.encodePacked(preimage)) == expectedHash)
require(!_usedPreimage[eventId][keccak256(abi.encodePacked(preimage))])  // replay guard
_usedPreimage[eventId][keccak256(abi.encodePacked(preimage))] = true
```

Check-in window: from `eventDate` to `eventDate + windowDuration * codeHashes.length`.

### Cover agent — 5 rules (checked in order)

```
Rule 1: sponsorPool >= stakeAmount
        → else "Sponsor pool does not have enough to cover this stake."

Rule 2: !record.hasOutstandingCover
        → else "You already have a covered stake outstanding — attend that event first."

Rule 3: !record.bannedFromCover
        → else "You forfeited a covered stake; attend one paid event to restore eligibility."

Rule 4: record.eventsRegistered == 0
        OR (record.eventsAttended * 100 / record.eventsRegistered >= 50)
        → else "Your attendance rate is below 50% — attend more events you have paid for."

Rule 5: record.timesCovered == 0
        OR record.timesRepaid == record.timesCovered
        → else "You have a previous covered stake that was not repaid."

Approval: "Cover approved: your record qualifies."
```

### Events (Solidity)

```
EventCreated(uint256 indexed eventId, address indexed organiser, ...)
Registered(uint256 indexed eventId, address indexed attendee)
CheckedIn(uint256 indexed eventId, address indexed attendee)
Claimed(uint256 indexed eventId, address indexed attendee, uint256 amount)
CoverRepaid(uint256 indexed eventId, address indexed attendee, uint256 amount)
ForfeitWithdrawn(uint256 indexed eventId, address indexed organiser, uint256 organiserShare, uint256 poolShare)
StakeReclaimed(uint256 indexed eventId, address indexed attendee, uint256 amount)
CoverGranted(uint256 indexed eventId, address indexed attendee, uint256 amount, string reason)
CoverDenied(uint256 indexed eventId, address indexed attendee, string reason)
Donated(address indexed donor, uint256 amount)
```

---

## 9 · Deployment & Initialization

Constructor: `constructor(address _usdc)`. No proxy. Immutable.

Arc Testnet USDC: `0x3600000000000000000000000000000000000000`.

---

## 10 · Upgradeability

None. The contract is immutable. Migration path: deploy a new contract; point the frontend at the new address. Old events remain readable on the old contract.

---

## 11 · Security Considerations

| Vulnerability | Applicable? | Mitigation |
|---|---|---|
| Reentrancy | Yes | `nonReentrant` + CEI on all USDC-moving functions |
| Access control | Yes | Organiser-only on `withdrawForfeited`. No organiser control over check-in. |
| Integer overflow/underflow | Solidity ≥0.8 checked | No `unchecked` blocks |
| Unchecked return values | Yes | `SafeERC20` for all USDC transfers |
| Preimage replay | Yes | `_usedPreimage[eventId][hash]` mapping; once used, the preimage is burned |
| Window hash collision | Low | Each window has a distinct hash chosen by the organiser; organiser is incentivised to choose unique preimages |
| Organiser withholds codes | Mitigated | `reclaimStake` available if attendance < 5% after 24 h — attendees cannot be trapped |
| < 5% gaming | Considered | 5% threshold: organiser would need to collude with ≥5% of registrants to fake check-ins and block reclaim; unlikely for typical community events |
| sponsorPool drain | No direct path | Only `requestCover` spends pool; five eligibility rules gate access |
| Double-count covered slot in forfeiture | Yes | `_coveredRegistration` mapping; `withdrawForfeited` only counts paid no-shows |
| Timestamp manipulation | Low | 24h / window-duration windows are large enough that ±15s validator manipulation is irrelevant |
| Denial of service | Yes | Pull-over-push for all USDC transfers; no loops over unbounded arrays in write paths |
| Approval persistence | Yes | No persistent approvals; callers approve before each `register`/`donate`/`createEvent` |
| Centralization | Low | No owner or admin role. Organiser power is scoped to their own event and cannot affect attendees' funds. |

---

## 12 · Trust Model & Threat Analysis

| Actor compromised | Max damage | Mitigation |
|---|---|---|
| Organiser key | Organiser claims their 80% forfeit share early or creates fake events. Cannot touch attendees' stakes or sponsor pool. | No organiser power over attendance or pool. `reclaimStake` protects attendees if event didn't run. |
| Attendee key | Registers for events, attempts to drain sponsor pool via repeated cover requests. | Five rules + ban system limit cover frequency. Pool cannot go negative. |
| Anyone with preimage | Checks in under a registered address — but they need the attendee's wallet to `claimBack`. | Check-in and claim are separate; `claimBack` requires `msg.sender == attendee`. |

---

## 13 · Emergency Response

No pause mechanism (immutable contract). If a critical bug is found: deploy a new contract, communicate migration publicly, leave old contract readable. The frontend points at the new address.

---

## 14 · Failure Scenarios

| Scenario | Outcome |
|---|---|
| Organiser never calls `withdrawForfeited` | Stakes remain in contract. Attendees who didn't check in lose their stake but it is not released until organiser acts. TODO: consider a public `withdrawForfeited` after a longer timeout (e.g. 30 days). |
| Organiser displays wrong codes | Attendance < 5% → `reclaimStake` available after 24 h. Attendees are not trapped. |
| Sponsor pool exhausted | `requestCover` reverts on Rule 1 with a clear message. No cover is granted. |
| Event cancelled | `cancelled` flag set by organiser; registration closes; existing registrants can `reclaimStake` immediately (override the 5% rule for cancelled events). |

---

## 15 · Priorities & Tradeoffs

| Decision | Tradeoff | Rationale |
|---|---|---|
| No Aave yield | Simpler, no external risk | USDC sits idle but refunds can never fail |
| 80/20 forfeit split | Organiser still benefits from no-shows but pool grows | Pure organiser share was an attack vector; pure pool was unfair to organisers who prepare and pay |
| Rotating codes instead of organiser mark-present | Organiser loses fine-grained control | Removes the single biggest trust issue: organiser could pocket stakes by refusing to mark real attendees |
| Global sponsor pool | Simpler accounting | Per-event pool would fragment liquidity; a student who attends many events benefits from the whole community's contributions |
| 5% threshold for reclaim | Prevents gaming | 0% threshold was the right signal that an event did not run at all |
| Immutable contract | No upgrade risk | Community events app; upgradeability adds admin key risk without clear benefit |

---

## 16 · Testing Strategy

- Unit tests (Foundry): happy path, all revert paths, event emissions, fuzz on stake amounts and registration counts.
- Invariant tests: `sponsorPool >= 0`, total USDC owed ≤ contract balance, no address double-claims.
- Fork test: not needed (no external protocol).
- Static analysis: Slither on production contracts.
- Gate: all tests pass, Slither High/Medium resolved before deploy.
