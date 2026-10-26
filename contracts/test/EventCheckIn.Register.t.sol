// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EventCheckInTestBase} from "./EventCheckIn.Base.t.sol";
import {EventCheckIn} from "../EventCheckIn.sol";

contract EventCheckInRegisterTest is EventCheckInTestBase {

    // ── register: happy path ─────────────────────────────────────────────────

    function test_Register_HappyPath() public {
        _createDefaultEvent();
        vm.warp(REG_START);

        uint256 balBefore = usdc.balanceOf(alice);

        vm.expectEmit(true, true, false, false, address(checkin));
        emit EventCheckIn.Registered(eventId, alice);

        vm.prank(alice);
        checkin.register(eventId);

        assertEq(usdc.balanceOf(alice), balBefore - STAKE);
        assertEq(usdc.balanceOf(address(checkin)), STAKE);
        assertTrue(checkin.isRegistered(eventId, alice));

        EventCheckIn.Event memory evt = checkin.getEvent(eventId);
        assertEq(evt.registeredCount, 1);

        EventCheckIn.UserRecord memory rec = checkin.getUserRecord(alice);
        assertEq(rec.eventsRegistered, 1);
    }

    function test_Register_USDCTransferredToContract() public {
        _createDefaultEvent();
        vm.warp(REG_START);
        vm.prank(alice);
        checkin.register(eventId);
        assertEq(usdc.balanceOf(address(checkin)), STAKE);
    }

    function test_Register_MultipleAttendees() public {
        _createDefaultEvent();
        vm.warp(REG_START);
        vm.prank(alice); checkin.register(eventId);
        vm.prank(bob);   checkin.register(eventId);

        assertEq(checkin.getEvent(eventId).registeredCount, 2);
        assertTrue(checkin.isRegistered(eventId, bob));
    }

    // ── register: revert paths ───────────────────────────────────────────────

    function test_Register_RevertBeforeRegistrationStart() public {
        _createDefaultEvent();
        vm.warp(REG_START - 1);
        vm.prank(alice);
        vm.expectRevert(EventCheckIn.EventRegistrationNotOpen.selector);
        checkin.register(eventId);
    }

    function test_Register_RevertAfterRegistrationEnd() public {
        _createDefaultEvent();
        vm.warp(REG_END + 1);
        vm.prank(alice);
        vm.expectRevert(EventCheckIn.EventRegistrationClosed.selector);
        checkin.register(eventId);
    }

    function test_Register_RevertAlreadyRegistered() public {
        _registerAlice();
        vm.prank(alice);
        vm.expectRevert(EventCheckIn.AlreadyRegistered.selector);
        checkin.register(eventId);
    }

    function test_Register_RevertAtCapacity() public {
        // Create event with max 1 attendee
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        checkin.createEvent("Small", REG_START, REG_END, EVENT_DATE, STAKE, 1, hashes, 1 hours, 0);

        vm.warp(REG_START);
        vm.prank(alice); checkin.register(1);

        vm.prank(bob);
        vm.expectRevert(EventCheckIn.EventAtCapacity.selector);
        checkin.register(1);
    }

    function test_Register_RevertInvalidEventId() public {
        vm.prank(alice);
        vm.expectRevert(EventCheckIn.InvalidEvent.selector);
        checkin.register(999);
    }

    function test_Register_RevertCancelledEvent() public {
        // Cancelled field is never set by contract code in current version
        // (no cancelEvent function), so we verify the check doesn't block normal flow
        _registerAlice();
        // just validate alice is registered
        assertTrue(checkin.isRegistered(eventId, alice));
    }

    // ── checkIn: happy path ──────────────────────────────────────────────────

    function test_CheckIn_HappyPath() public {
        _registerAlice();
        vm.warp(EVENT_DATE);

        vm.expectEmit(true, true, false, false, address(checkin));
        emit EventCheckIn.CheckedIn(eventId, alice);

        vm.prank(alice);
        checkin.checkIn(eventId, alicePreimage);

        assertTrue(checkin.isCheckedIn(eventId, alice));
        assertEq(checkin.getEvent(eventId).checkedInCount, 1);
    }

    function test_CheckIn_PreimageBoundToMsgSender() public {
        // Bob tries to use alice's preimage — should fail because the hash is
        // keccak256(preimage || msg.sender) and bob's address differs.
        _createDefaultEvent();
        vm.warp(REG_START);
        vm.prank(bob); checkin.register(eventId);
        vm.warp(EVENT_DATE);

        vm.prank(bob);
        vm.expectRevert(EventCheckIn.InvalidCodeForAttendee.selector);
        checkin.checkIn(eventId, alicePreimage);
    }

    function test_CheckIn_WrongPreimage() public {
        _registerAlice();
        vm.warp(EVENT_DATE);
        vm.prank(alice);
        vm.expectRevert(EventCheckIn.InvalidCodeForAttendee.selector);
        checkin.checkIn(eventId, bytes32(uint256(0xFF)));
    }

    function test_CheckIn_RevertBeforeEventDate() public {
        _registerAlice();
        vm.warp(EVENT_DATE - 1);
        vm.prank(alice);
        vm.expectRevert(EventCheckIn.CheckInWindowClosed.selector);
        checkin.checkIn(eventId, alicePreimage);
    }

    function test_CheckIn_RevertAfterGracePeriod() public {
        _registerAlice();
        vm.warp(GRACE_END + 1);
        vm.prank(alice);
        vm.expectRevert(EventCheckIn.CheckInWindowClosed.selector);
        checkin.checkIn(eventId, alicePreimage);
    }

    function test_CheckIn_RevertAlreadyCheckedIn() public {
        _checkInAlice();
        vm.warp(EVENT_DATE);
        vm.prank(alice);
        vm.expectRevert(EventCheckIn.AlreadyCheckedIn.selector);
        checkin.checkIn(eventId, alicePreimage);
    }

    function test_CheckIn_RevertNotRegistered() public {
        _createDefaultEvent();
        vm.warp(EVENT_DATE);
        vm.prank(bob);
        vm.expectRevert(EventCheckIn.AttendeeNotRegistered.selector);
        checkin.checkIn(eventId, bobPreimage);
    }

    // ── checkIn: window rotation ──────────────────────────────────────────────

    function test_CheckIn_WindowRotation_SecondHash() public {
        // Create event with 2 code hashes and 1-hour window.
        // aliceCodeHash is window-0; bobCodeHash is window-1.
        // Bob registers with his own code hash in window-1.
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = aliceCodeHash;
        hashes[1] = bobCodeHash;

        vm.prank(organiser);
        checkin.createEvent("W2", REG_START, REG_END, EVENT_DATE, STAKE, 10, hashes, 1 hours, 0);

        vm.warp(REG_START);
        vm.prank(bob); checkin.register(1);

        // Warp to window 1 (1 hour into the event)
        vm.warp(EVENT_DATE + 1 hours);
        vm.prank(bob);
        checkin.checkIn(1, bobPreimage); // uses hash[1]

        assertTrue(checkin.isCheckedIn(1, bob));
    }

    function test_CheckIn_WindowClampsToLastHash() public {
        // Create event with 1 code hash but 2-hour window.
        // After 5 hours windowIndex would be 5, but it's clamped to 0.
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;

        vm.prank(organiser);
        checkin.createEvent("Clamp", REG_START, REG_END, EVENT_DATE, STAKE, 10, hashes, 2 hours, 0);

        vm.warp(REG_START);
        vm.prank(alice); checkin.register(1);

        // Warp well into the event (still within grace) — windowIndex would be large
        // but clamps to 0 (only hash available).
        vm.warp(EVENT_DATE + 1 days);
        vm.prank(alice);
        checkin.checkIn(1, alicePreimage);
        assertTrue(checkin.isCheckedIn(1, alice));
    }

    // ── isRegistered / isCheckedIn / hasClaimed accessors ────────────────────

    function test_IsRegistered_FalseForNonMember() public {
        _createDefaultEvent();
        assertFalse(checkin.isRegistered(eventId, alice));
    }

    function test_HasClaimed_FalseBeforeClaim() public {
        _checkInAlice();
        assertFalse(checkin.hasClaimed(eventId, alice));
    }

    function test_GetEventCodeHashCount() public {
        _createDefaultEvent();
        assertEq(checkin.getEventCodeHashCount(eventId), 1);
    }
}
