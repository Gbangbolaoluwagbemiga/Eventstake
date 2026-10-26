// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EventCheckInTestBase} from "./EventCheckIn.Base.t.sol";
import {EventCheckIn} from "../EventCheckIn.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

contract EventCheckInDeployTest is EventCheckInTestBase {

    // ── constructor ──────────────────────────────────────────────────────────

    function test_Constructor_SetsUSDC() public view {
        assertEq(address(checkin.usdc()), address(usdc));
    }

    function test_Constructor_ZeroAddressReverts() public {
        vm.expectRevert(EventCheckIn.ZeroAddressUSDC.selector);
        new EventCheckIn(address(0));
    }

    function test_Constructor_ERC721Name() public view {
        assertEq(checkin.name(), "Event Attendance Proof");
        assertEq(checkin.symbol(), "EAP");
    }

    function test_Constructor_SponsorPoolIsZero() public view {
        assertEq(checkin.sponsorPool(), 0);
    }

    // ── createEvent: happy path ──────────────────────────────────────────────

    function test_CreateEvent_HappyPath() public {
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;

        vm.expectEmit(true, true, false, true, address(checkin));
        emit EventCheckIn.EventCreated(1, organiser, "E1", EVENT_DATE, STAKE, 5);

        vm.prank(organiser);
        checkin.createEvent("E1", REG_START, REG_END, EVENT_DATE, STAKE, 5, hashes, 1 hours, 0);

        EventCheckIn.Event memory evt = checkin.getEvent(1);
        assertEq(evt.id, 1);
        assertEq(evt.name, "E1");
        assertEq(evt.registrationStart, REG_START);
        assertEq(evt.registrationEnd, REG_END);
        assertEq(evt.date, EVENT_DATE);
        assertEq(evt.stakeAmount, STAKE);
        assertEq(evt.organiser, organiser);
        assertEq(evt.maxAttendees, 5);
        assertEq(evt.registeredCount, 0);
        assertEq(evt.checkedInCount, 0);
        assertFalse(evt.cancelled);
        assertFalse(evt.forfeitWithdrawn);
    }

    function test_CreateEvent_IncrementEventId() public {
        _createDefaultEvent();
        // Create a second event
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        checkin.createEvent("E2", REG_START, REG_END, EVENT_DATE, STAKE, 5, hashes, 1 hours, 0);
        EventCheckIn.Event memory e2 = checkin.getEvent(2);
        assertEq(e2.id, 2);
    }

    // ── createEvent: seeding sponsor pool ────────────────────────────────────

    function test_CreateEvent_SeedSponsorPool() public {
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        uint256 seed = 100e6;

        uint256 balBefore = usdc.balanceOf(organiser);

        vm.prank(organiser);
        checkin.createEvent("E1", REG_START, REG_END, EVENT_DATE, STAKE, 5, hashes, 1 hours, seed);

        assertEq(checkin.sponsorPool(), seed);
        assertEq(usdc.balanceOf(organiser), balBefore - seed);
        assertEq(usdc.balanceOf(address(checkin)), seed);
    }

    function test_CreateEvent_ZeroSeedSkipsTransfer() public {
        _createDefaultEvent();
        assertEq(checkin.sponsorPool(), 0);
    }

    // ── createEvent: revert paths ────────────────────────────────────────────

    function test_CreateEvent_RevertRegistrationStartInPast() public {
        vm.warp(T0 + 10 days);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        vm.expectRevert(EventCheckIn.EventDateNotFuture.selector);
        checkin.createEvent("E1", T0, REG_END, EVENT_DATE, STAKE, 5, hashes, 1 hours, 0);
    }

    function test_CreateEvent_RevertRegEndBeforeRegStart() public {
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        vm.expectRevert(EventCheckIn.EventDateNotFuture.selector);
        checkin.createEvent("E1", REG_START, REG_START, EVENT_DATE, STAKE, 5, hashes, 1 hours, 0);
    }

    function test_CreateEvent_RevertDateBeforeRegEnd() public {
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        vm.expectRevert(EventCheckIn.EventDateNotFuture.selector);
        checkin.createEvent("E1", REG_START, REG_END, REG_END, STAKE, 5, hashes, 1 hours, 0);
    }

    function test_CreateEvent_RevertZeroStake() public {
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        vm.expectRevert(EventCheckIn.StakeAmountZero.selector);
        checkin.createEvent("E1", REG_START, REG_END, EVENT_DATE, 0, 5, hashes, 1 hours, 0);
    }

    function test_CreateEvent_RevertZeroMaxAttendees() public {
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        vm.expectRevert(EventCheckIn.MaxAttendeesZero.selector);
        checkin.createEvent("E1", REG_START, REG_END, EVENT_DATE, STAKE, 0, hashes, 1 hours, 0);
    }

    function test_CreateEvent_RevertEmptyCodeHashes() public {
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](0);
        vm.prank(organiser);
        vm.expectRevert(EventCheckIn.CodeHashesEmpty.selector);
        checkin.createEvent("E1", REG_START, REG_END, EVENT_DATE, STAKE, 5, hashes, 1 hours, 0);
    }

    function test_CreateEvent_RevertZeroWindowDuration() public {
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        vm.expectRevert(EventCheckIn.WindowDurationZero.selector);
        checkin.createEvent("E1", REG_START, REG_END, EVENT_DATE, STAKE, 5, hashes, 0, 0);
    }

    function test_CreateEvent_RevertInvalidEventId() public {
        vm.expectRevert(EventCheckIn.InvalidEvent.selector);
        checkin.getEvent(0);
    }

    function test_CreateEvent_RevertGetEventNonExistent() public {
        vm.expectRevert(EventCheckIn.InvalidEvent.selector);
        checkin.getEvent(999);
    }

    // ── getEvents ────────────────────────────────────────────────────────────

    function test_GetEvents_ReturnsAllEvents() public {
        _createDefaultEvent();
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bobCodeHash;
        vm.prank(organiser);
        checkin.createEvent("E2", REG_START, REG_END, EVENT_DATE, STAKE, 3, hashes, 1 hours, 0);

        EventCheckIn.Event[] memory all = checkin.getEvents();
        assertEq(all.length, 2);
        assertEq(all[0].name, "Test Event");
        assertEq(all[1].name, "E2");
    }

    // ── donate ────────────────────────────────────────────────────────────────

    function test_Donate_PoolIncreasesAndUSDCTransfers() public {
        uint256 amount = 50e6;
        uint256 balBefore = usdc.balanceOf(donor);

        vm.expectEmit(true, false, false, true, address(checkin));
        emit EventCheckIn.Donated(donor, amount);

        vm.prank(donor);
        checkin.donate(amount);

        assertEq(checkin.sponsorPool(), amount);
        assertEq(usdc.balanceOf(donor), balBefore - amount);
        assertEq(usdc.balanceOf(address(checkin)), amount);
    }

    function test_Donate_RevertZeroAmount() public {
        vm.prank(donor);
        vm.expectRevert(EventCheckIn.StakeAmountZero.selector);
        checkin.donate(0);
    }

    // ── getSponsorPoolInfo ────────────────────────────────────────────────────

    function test_GetSponsorPoolInfo_ZeroBalance() public view {
        (uint256 bal, uint256 can) = checkin.getSponsorPoolInfo(STAKE);
        assertEq(bal, 0);
        assertEq(can, 0);
    }

    function test_GetSponsorPoolInfo_CorrectAfterDonate() public {
        vm.prank(donor);
        checkin.donate(100e6);

        (uint256 bal, uint256 can) = checkin.getSponsorPoolInfo(STAKE);
        assertEq(bal, 100e6);
        assertEq(can, 10); // 100e6 / 10e6 = 10
    }

    function test_GetSponsorPoolInfo_ZeroStakeReturnsZeroCanCover() public {
        vm.prank(donor);
        checkin.donate(100e6);
        (uint256 bal, uint256 can) = checkin.getSponsorPoolInfo(0);
        assertEq(bal, 100e6);
        assertEq(can, 0);
    }
}
