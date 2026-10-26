// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {EventCheckIn} from "../EventCheckIn.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Shared base: actors, constants, helpers — no test functions here.
abstract contract EventCheckInTestBase is Test {
    // ── contract under test ──────────────────────────────────────────────────
    EventCheckIn internal checkin;
    MockERC20   internal usdc;

    // ── actors ───────────────────────────────────────────────────────────────
    address internal organiser = makeAddr("organiser");
    address internal alice     = makeAddr("alice");
    address internal bob       = makeAddr("bob");
    address internal carol     = makeAddr("carol");
    address internal donor     = makeAddr("donor");

    // ── stake / funding constants ────────────────────────────────────────────
    uint256 internal constant STAKE  = 10e6;  // 10 USDC (6 decimals)
    uint256 internal constant SUPPLY = 1_000_000e6;

    // ── relative time offsets (used by helpers) ───────────────────────────────
    uint256 internal T0;               // "now" at setUp time
    uint256 internal REG_START;
    uint256 internal REG_END;
    uint256 internal EVENT_DATE;
    uint256 internal GRACE_END;
    uint256 internal RESCUE_END;

    // ── code-hash helpers ────────────────────────────────────────────────────
    bytes32 internal alicePreimage;
    bytes32 internal aliceCodeHash;
    bytes32 internal bobPreimage;
    bytes32 internal bobCodeHash;
    bytes32[] internal codeHashes;   // one window hash per setUp

    // ── event id created in helpers ──────────────────────────────────────────
    uint256 internal eventId;

    // ─────────────────────────────────────────────────────────────────────────

    function setUp() public virtual {
        // Deploy mock USDC
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);

        // Deploy contract
        checkin = new EventCheckIn(address(usdc));

        // Fund actors
        usdc.mint(organiser, SUPPLY);
        usdc.mint(alice,     SUPPLY);
        usdc.mint(bob,       SUPPLY);
        usdc.mint(carol,     SUPPLY);
        usdc.mint(donor,     SUPPLY);

        // Set a stable "now"
        T0 = block.timestamp;

        // Default time window layout
        REG_START  = T0 + 1 days;
        REG_END    = T0 + 7 days;
        EVENT_DATE = T0 + 14 days;
        GRACE_END  = EVENT_DATE + 2 days;   // CHECKIN_GRACE_DAYS = 2
        RESCUE_END = EVENT_DATE + 24 hours; // RESCUE_HOURS = 24

        // Preimages for alice and bob bound to their addresses
        alicePreimage = bytes32(uint256(0xAA));
        aliceCodeHash = keccak256(abi.encodePacked(alicePreimage, alice));

        bobPreimage   = bytes32(uint256(0xBB));
        bobCodeHash   = keccak256(abi.encodePacked(bobPreimage, bob));

        // Default codeHashes array: two hashes (alice, bob) so there's room for
        // two windows.  Single-window tests use codeHashes[0].
        codeHashes = new bytes32[](2);
        codeHashes[0] = aliceCodeHash;
        codeHashes[1] = bobCodeHash;

        // Pre-approve from each actor
        vm.prank(organiser); usdc.approve(address(checkin), type(uint256).max);
        vm.prank(alice);     usdc.approve(address(checkin), type(uint256).max);
        vm.prank(bob);       usdc.approve(address(checkin), type(uint256).max);
        vm.prank(carol);     usdc.approve(address(checkin), type(uint256).max);
        vm.prank(donor);     usdc.approve(address(checkin), type(uint256).max);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// Create a default event and store its id in `eventId`.
    function _createDefaultEvent() internal returns (uint256 id) {
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;

        vm.prank(organiser);
        checkin.createEvent(
            "Test Event",
            REG_START,
            REG_END,
            EVENT_DATE,
            STAKE,
            10,           // maxAttendees
            hashes,
            1 hours,      // codeWindowDuration
            0             // seedAmount
        );
        id = 1;
        eventId = id;
    }

    /// Create event, warp to registration, register alice.
    function _registerAlice() internal {
        _createDefaultEvent();
        vm.warp(REG_START);
        vm.prank(alice);
        checkin.register(eventId);
    }

    /// Register alice then check her in at EVENT_DATE.
    function _checkInAlice() internal {
        _registerAlice();
        vm.warp(EVENT_DATE);
        vm.prank(alice);
        checkin.checkIn(eventId, alicePreimage);
    }

    /// Warp past grace period so claimBack / withdrawForfeited are available.
    function _warpPastGrace() internal {
        vm.warp(GRACE_END + 1);
    }

    /// Warp past rescue window (EVENT_DATE + 24h).
    function _warpPastRescue() internal {
        vm.warp(RESCUE_END + 1);
    }
}
