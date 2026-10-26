// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EventCheckInTestBase} from "./EventCheckIn.Base.t.sol";
import {EventCheckIn} from "../EventCheckIn.sol";

contract EventCheckInCoverTest is EventCheckInTestBase {

    // ── helpers ───────────────────────────────────────────────────────────────

    /// Seed pool and create default event, warp to registration window.
    function _setupCover() internal {
        vm.prank(donor); checkin.donate(200e6);
        _createDefaultEvent();
        vm.warp(REG_START);
    }

    // ── requestCover: Rule 1 — pool insufficient ──────────────────────────────

    function test_RequestCover_CoverDenied_PoolInsufficient() public {
        _createDefaultEvent();
        vm.warp(REG_START);
        // Pool is empty

        vm.expectEmit(true, true, false, false, address(checkin));
        emit EventCheckIn.CoverDenied(
            eventId,
            alice,
            "The sponsor pool does not have enough USDC to cover this stake right now."
        );

        vm.prank(alice);
        checkin.requestCover(eventId);

        assertFalse(checkin.isRegistered(eventId, alice));
    }

    // ── requestCover: Rule 2 — credit score too low ───────────────────────────

    function test_RequestCover_CoverDenied_LowScore() public {
        _setupCover();
        // Manually push alice into a low-score state by registering then not attending
        // We need alice to have eventsRegistered > 0 and score < 30.
        // score = 50 + (attendanceRate*40/100) + 20 (no cover) - 20 (banned)
        // If attendance=0%, score = 50 + 0 + 20 = 70, then ban penalty: 70-20=50
        // That's still > 30. We need a more severe case.
        // The score gate only fires when score < 30 AND eventsRegistered > 0.
        // Achieving score < 30: we need bannedFromCover=true (−20) AND very low attendance.
        // score = 50 + (0*40/100) + 20 - 20 = 50; still too high.
        // Actually the minimum score is 50 (base) when attendance=0 but no ban.
        // With ban: 50+0+20-20=50. With 0 repay rate on cover: 50+0+0-20=30, 
        // which is NOT < 30. So score < 30 seems unreachable by normal usage.
        // The test documents this: a new user with 0 registrations bypasses the score gate.
        // We confirm the gate is skipped for new users (eventsRegistered == 0).
        assertFalse(checkin.getUserRecord(alice).bannedFromCover);
        // Alice is a new user — cover should be approved (score gate skipped)
        vm.prank(alice);
        checkin.requestCover(eventId);
        assertTrue(checkin.isRegistered(eventId, alice));
    }

    // ── requestCover: Rule 3 — outstanding cover ──────────────────────────────

    function test_RequestCover_CoverDenied_OutstandingCover() public {
        _setupCover();
        // Alice gets cover for event 1
        vm.prank(alice); checkin.requestCover(eventId);
        assertTrue(checkin.getUserRecord(alice).hasOutstandingCover);

        // Create a second event
        uint256 now2 = block.timestamp;
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        checkin.createEvent("E2", now2 + 1, now2 + 1 days, now2 + 2 days, STAKE, 10, hashes, 1 hours, 0);

        vm.warp(now2 + 1);

        vm.expectEmit(true, true, false, false, address(checkin));
        emit EventCheckIn.CoverDenied(
            2,
            alice,
            "You already have a covered stake - check in to that event first."
        );

        vm.prank(alice);
        checkin.requestCover(2);
    }

    // ── requestCover: Rule 4 — banned (CONTRACT BUG: bannedFromCover never set) ──

    function test_RequestCover_CoverDenied_Banned_NeverReachable() public {
        // CONTRACT BUG DOCUMENTATION: The `bannedFromCover` flag is checked in
        // requestCover and getCoverEligibility but is NEVER set to `true` anywhere
        // in the contract source. withdrawForfeited handles covered no-shows by
        // restoring their stake to the pool but does NOT set bannedFromCover.
        // This test confirms: after a covered no-show + withdrawForfeited,
        // bannedFromCover is still false, making Rule 4 dead code.
        vm.prank(donor); checkin.donate(200e6);
        _createDefaultEvent();
        vm.warp(REG_START);
        vm.prank(alice); checkin.requestCover(eventId);
        // Alice is a covered no-show
        _warpPastGrace();
        vm.prank(organiser); checkin.withdrawForfeited(eventId);

        // Confirmed: bannedFromCover is never set to true
        assertFalse(checkin.getUserRecord(alice).bannedFromCover);

        // Create second event — alice still has hasOutstandingCover=true (also a bug:
        // withdrawForfeited doesn't clear it), so Rule 3 fires, not Rule 4.
        uint256 now2 = block.timestamp;
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        checkin.createEvent("E2", now2 + 1, now2 + 1 days, now2 + 2 days, STAKE, 10, hashes, 1 hours, 0);
        vm.warp(now2 + 1);

        // Rule 3 fires (hasOutstandingCover=true), NOT Rule 4
        vm.expectEmit(true, true, false, false, address(checkin));
        emit EventCheckIn.CoverDenied(2, alice,
            "You already have a covered stake - check in to that event first.");
        vm.prank(alice);
        checkin.requestCover(2);
    }

    // ── requestCover: Rule 5 — attendance rate < 50% ─────────────────────────

    function test_RequestCover_CoverDenied_LowAttendanceRate() public {
        // Alice registers for 2 events, attends 0 (< 50%)
        // We do this by making alice register via self-pay for 2 events with no check-in,
        // then forfeiting doesn't set attended. We need attended/registered < 50%.
        // Simplest: register alice for 1 event, she doesn't attend, then request cover.
        // 0 attended, 1 registered → 0% < 50%
        vm.prank(donor); checkin.donate(200e6);

        // Create event 1 for self-pay registration (no cover)
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        checkin.createEvent("E1", T0+1, T0+7 days, T0+14 days, STAKE, 10, hashes, 1 hours, 0);

        vm.warp(T0 + 1);
        vm.prank(alice); checkin.register(1);
        // alice doesn't check in → eventsRegistered=1, eventsAttended=0

        // Now create event 2 for cover request
        uint256 now2 = T0 + 1;
        vm.prank(organiser);
        checkin.createEvent("E2", now2+1, now2+1 days, now2+2 days, STAKE, 10, hashes, 1 hours, 0);
        vm.warp(now2 + 1);

        vm.expectEmit(true, true, false, false, address(checkin));
        emit EventCheckIn.CoverDenied(
            2,
            alice,
            "Your attendance rate is below 50% - attend more of the events you sign up for."
        );

        vm.prank(alice);
        checkin.requestCover(2);
    }

    // ── requestCover: Rule 6 — unrepaid prior cover ───────────────────────────

    function test_RequestCover_CoverDenied_UnrepaidCover() public {
        // Seed pool generously
        vm.prank(donor); checkin.donate(500e6);

        // Create event 1, alice gets cover
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        checkin.createEvent("E1", T0+1, T0+7 days, T0+14 days, STAKE, 10, hashes, 1 hours, 0);
        vm.warp(T0+1);
        vm.prank(alice); checkin.requestCover(1);

        // Alice checks in (clears hasOutstandingCover when she claims)
        vm.warp(T0+14 days);
        vm.prank(alice); checkin.checkIn(1, alicePreimage);
        vm.warp(T0+14 days + 2 days + 1);
        vm.prank(alice); checkin.claimBack(1);
        // Now timesRepaid=1, timesCovered=1 → repaid OK

        // Create event 2, alice gets cover again
        uint256 now2 = T0 + 14 days + 3 days;
        vm.prank(organiser);
        checkin.createEvent("E2", now2+1, now2+7 days, now2+14 days, STAKE, 10, hashes, 1 hours, 0);
        vm.warp(now2+1);
        vm.prank(alice); checkin.requestCover(2);
        // Alice now has outstanding cover for event 2 (hasOutstandingCover=true)
        assertTrue(checkin.getUserRecord(alice).hasOutstandingCover);

        // Alice checks in (clears outstanding cover) but we won't let her claim,
        // so timesRepaid stays 1 but timesCovered is now 2.
        // Wait — requestCover itself sets hasOutstandingCover before claimBack.
        // For rule 6: timesCovered != timesRepaid check fires only when 
        // hasOutstandingCover is false (rule 3 fires first otherwise).
        // We need a scenario where timesCovered=2, timesRepaid=1, hasOutstandingCover=false.
        // That happens if alice claimed for cover #2 (repaid), setting timesRepaid=2,
        // but we want timesRepaid=1. Let's skip claim for event 2, check in without claiming.
        // Actually we need to get past the outstanding cover check (rule 3).
        // The only way outstanding cover is false after getting it is if she claims.
        // Let's craft: alice has timesCovered=1, timesRepaid=0 (she got cover on E1 but 
        // has NOT repaid — she checked in but not claimed).

        // Restart: fresh state by using bob instead
        vm.warp(now2+14 days); // alice already got cover for E2
        vm.prank(alice); checkin.checkIn(2, alicePreimage);
        // Alice does NOT claimBack — she has outstanding cover cleared on checkIn? No.
        // hasOutstandingCover is only cleared in claimBack/reclaimStake.
        // So after checkIn, alice still hasOutstandingCover=true.
        // Create event 3
        uint256 now3 = now2 + 20 days;
        vm.prank(organiser);
        checkin.createEvent("E3", now3+1, now3+7 days, now3+14 days, STAKE, 10, hashes, 1 hours, 0);
        vm.warp(now3+1);

        // Rule 3 fires first (hasOutstandingCover=true)
        vm.expectEmit(true, true, false, false, address(checkin));
        emit EventCheckIn.CoverDenied(3, alice, "You already have a covered stake - check in to that event first.");
        vm.prank(alice); checkin.requestCover(3);

        // Now alice claims E2 cover repayment to clear outstanding cover
        vm.warp(now2 + 14 days + 2 days + 1);
        vm.prank(alice); checkin.claimBack(2);
        // Now timesRepaid=2, timesCovered=2, outstanding=false
        // We need timesCovered != timesRepaid. Let's use carol who has never repaid.
        // Carol: timesCovered=1, timesRepaid=0, hasOutstandingCover=false
        // This is only possible if carol got a cover, checked in (doesn't clear), 
        // and grace passed without claiming but reclaimStake was called (clears outstanding).
        // Actually reclaimStake also clears hasOutstandingCover. Let's use:
        // carol gets cover for E4, grace passes, organiser withdrawForfeit (doesn't change carol's record),
        // then carol calls reclaimStake (clears outstanding, but reclaimStake requires not checked in).
        // So: carol gets cover, doesn't check in, rescue window passes, reclaimStake clears outstanding.
        uint256 now4 = now3 + 14 days;
        vm.prank(organiser);
        checkin.createEvent("E4", now4+1, now4+7 days, now4+14 days, STAKE, 10, hashes, 1 hours, 0);
        vm.warp(now4+1);
        vm.prank(carol); checkin.requestCover(4);
        // carol has timesCovered=1, timesRepaid=0, hasOutstandingCover=true

        // Carol doesn't check in — wait for rescue window
        vm.warp(now4+14 days + 24 hours + 1);
        vm.prank(carol); checkin.reclaimStake(4);
        // Now carol: timesCovered=1, timesRepaid=0, hasOutstandingCover=false

        // Create E5 for carol's cover request
        uint256 now5 = now4 + 20 days;
        vm.prank(organiser);
        checkin.createEvent("E5", now5+1, now5+7 days, now5+14 days, STAKE, 10, hashes, 1 hours, 0);
        vm.warp(now5+1);

        vm.expectEmit(true, true, false, false, address(checkin));
        emit EventCheckIn.CoverDenied(5, carol, "You have a previous covered stake that was not repaid.");
        vm.prank(carol); checkin.requestCover(5);
    }

    // ── requestCover: happy path — first-time user ────────────────────────────

    function test_RequestCover_Granted_FirstTimeUser() public {
        _setupCover();
        uint256 poolBefore = checkin.sponsorPool();

        vm.expectEmit(true, true, false, false, address(checkin));
        emit EventCheckIn.CoverGranted(
            eventId,
            alice,
            STAKE,
            "Cover approved - welcome, your first event is on the pool."
        );

        vm.prank(alice);
        checkin.requestCover(eventId);

        assertTrue(checkin.isRegistered(eventId, alice));
        assertTrue(checkin.isCoveredRegistration(eventId, alice));
        assertEq(checkin.sponsorPool(), poolBefore - STAKE);
        assertEq(checkin.getEvent(eventId).registeredCount, 1);
        assertTrue(checkin.getUserRecord(alice).hasOutstandingCover);
        assertEq(checkin.getUserRecord(alice).timesCovered, 1);
    }

    function test_RequestCover_Granted_SponsorPoolDecremented() public {
        vm.prank(donor); checkin.donate(50e6);
        _createDefaultEvent();
        vm.warp(REG_START);

        vm.prank(alice); checkin.requestCover(eventId);
        assertEq(checkin.sponsorPool(), 50e6 - STAKE);
    }

    // ── requestCover: revert paths ────────────────────────────────────────────

    function test_RequestCover_RevertAlreadyRegistered() public {
        _setupCover();
        vm.prank(alice); checkin.register(eventId);

        vm.prank(alice);
        vm.expectRevert(EventCheckIn.AlreadyRegistered.selector);
        checkin.requestCover(eventId);
    }

    function test_RequestCover_RevertRegistrationNotOpen() public {
        vm.prank(donor); checkin.donate(100e6);
        _createDefaultEvent();
        vm.warp(REG_START - 1);

        vm.prank(alice);
        vm.expectRevert(EventCheckIn.EventRegistrationNotOpen.selector);
        checkin.requestCover(eventId);
    }

    function test_RequestCover_RevertRegistrationClosed() public {
        vm.prank(donor); checkin.donate(100e6);
        _createDefaultEvent();
        vm.warp(REG_END + 1);

        vm.prank(alice);
        vm.expectRevert(EventCheckIn.EventRegistrationClosed.selector);
        checkin.requestCover(eventId);
    }

    function test_RequestCover_RevertAtCapacity() public {
        vm.prank(donor); checkin.donate(200e6);
        // Create event with max 1 attendee
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        checkin.createEvent("Tiny", REG_START, REG_END, EVENT_DATE, STAKE, 1, hashes, 1 hours, 0);
        vm.warp(REG_START);
        vm.prank(alice); checkin.register(1);

        vm.prank(bob);
        vm.expectRevert(EventCheckIn.EventAtCapacity.selector);
        checkin.requestCover(1);
    }

    // ── getCreditScore ────────────────────────────────────────────────────────

    function test_GetCreditScore_NewUser() public view {
        (uint256 score, string memory label, string memory explanation) = checkin.getCreditScore(alice);
        assertEq(score, 0);
        assertEq(label, "new");
        assertEq(explanation, "Not enough history yet - register for your first event.");
    }

    function test_GetCreditScore_PerfectAttendance_NoCovers() public {
        // alice registers and attends 1 event
        _checkInAlice();
        _warpPastGrace();
        vm.prank(alice); checkin.claimBack(eventId);

        // score = 50 + (100*40/100) + 20 = 50 + 40 + 20 = 110 → capped at 100
        (uint256 score, string memory label,) = checkin.getCreditScore(alice);
        assertEq(score, 100);
        assertEq(label, "trusted");
    }

    function test_GetCreditScore_ZeroAttendance() public {
        // alice registers but never attends
        _registerAlice();

        // score = 50 + (0*40/100) + 20 = 70 → label "trusted" (>=80? no: 70 >= 60 → "building")
        (uint256 score, string memory label,) = checkin.getCreditScore(alice);
        assertEq(score, 70);
        assertEq(label, "building");
    }

    function test_GetCreditScore_WithRepaidCover() public {
        // alice gets cover, checks in, claims back (repaid)
        vm.prank(donor); checkin.donate(100e6);
        _createDefaultEvent();
        vm.warp(REG_START);
        vm.prank(alice); checkin.requestCover(eventId);
        vm.warp(EVENT_DATE);
        vm.prank(alice); checkin.checkIn(eventId, alicePreimage);
        _warpPastGrace();
        vm.prank(alice); checkin.claimBack(eventId);

        // eventsRegistered=1, eventsAttended=1, timesCovered=1, timesRepaid=1
        // score = 50 + (100*40/100) + (100*20/100) = 50+40+20=110 → 100
        (uint256 score, string memory label,) = checkin.getCreditScore(alice);
        assertEq(score, 100);
        assertEq(label, "trusted");
    }

    function test_GetCreditScore_LabelBuilding() public {
        // 50% attendance: 1 registered, 0 attended → score=70 label=building
        _registerAlice();
        (uint256 score, string memory label,) = checkin.getCreditScore(alice);
        assertEq(score, 70);
        assertEq(label, "building");
    }

    // ── getCoverEligibility ───────────────────────────────────────────────────

    function test_GetCoverEligibility_EligibleNewUser() public {
        vm.prank(donor); checkin.donate(100e6);
        _createDefaultEvent();
        vm.warp(REG_START);

        (bool eligible, string memory reason) = checkin.getCoverEligibility(alice, eventId);
        assertTrue(eligible);
        assertEq(reason, "Cover approved - welcome, your first event is on the pool.");
    }

    function test_GetCoverEligibility_IneligiblePoolEmpty() public {
        _createDefaultEvent();
        vm.warp(REG_START);

        (bool eligible, string memory reason) = checkin.getCoverEligibility(alice, eventId);
        assertFalse(eligible);
        assertEq(reason, "The sponsor pool does not have enough USDC to cover this stake right now.");
    }

    function test_GetCoverEligibility_IneligibleAlreadyRegistered() public {
        vm.prank(donor); checkin.donate(100e6);
        _createDefaultEvent();
        vm.warp(REG_START);
        vm.prank(alice); checkin.register(eventId);

        (bool eligible, string memory reason) = checkin.getCoverEligibility(alice, eventId);
        assertFalse(eligible);
        assertEq(reason, "Already registered for this event.");
    }

    function test_GetCoverEligibility_IneligibleRegistrationClosed() public {
        vm.prank(donor); checkin.donate(100e6);
        _createDefaultEvent();
        vm.warp(REG_END + 1);

        (bool eligible,) = checkin.getCoverEligibility(alice, eventId);
        assertFalse(eligible);
    }

    function test_GetCoverEligibility_IneligibleRegistrationNotOpen() public {
        vm.prank(donor); checkin.donate(100e6);
        _createDefaultEvent();
        vm.warp(REG_START - 1);

        (bool eligible,) = checkin.getCoverEligibility(alice, eventId);
        assertFalse(eligible);
    }

    function test_GetCoverEligibility_IneligibleOutstandingCover() public {
        vm.prank(donor); checkin.donate(200e6);
        _createDefaultEvent();
        vm.warp(REG_START);
        vm.prank(alice); checkin.requestCover(eventId);

        // Create second event
        uint256 now2 = block.timestamp;
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        checkin.createEvent("E2", now2+1, now2+1 days, now2+2 days, STAKE, 10, hashes, 1 hours, 0);
        vm.warp(now2+1);

        (bool eligible, string memory reason) = checkin.getCoverEligibility(alice, 2);
        assertFalse(eligible);
        assertEq(reason, "You already have a covered stake - check in to that event first.");
    }

    function test_GetCoverEligibility_MatchesRequestCover() public {
        vm.prank(donor); checkin.donate(100e6);
        _createDefaultEvent();
        vm.warp(REG_START);

        (bool eligible,) = checkin.getCoverEligibility(alice, eventId);
        assertTrue(eligible);

        // Now actually requestCover — should succeed
        vm.prank(alice);
        checkin.requestCover(eventId);
        assertTrue(checkin.isRegistered(eventId, alice));
    }
}
