// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EventCheckInTestBase} from "./EventCheckIn.Base.t.sol";
import {EventCheckIn} from "../EventCheckIn.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract EventCheckInClaimTest is EventCheckInTestBase {

    // ── claimBack: self-paid attendee ─────────────────────────────────────────

    function test_ClaimBack_SelfPaid_GetsUSDCBack() public {
        _checkInAlice();
        _warpPastGrace();

        uint256 balBefore = usdc.balanceOf(alice);

        vm.expectEmit(true, true, false, true, address(checkin));
        emit EventCheckIn.Claimed(eventId, alice, STAKE);

        vm.prank(alice);
        checkin.claimBack(eventId);

        assertEq(usdc.balanceOf(alice), balBefore + STAKE);
        assertTrue(checkin.hasClaimed(eventId, alice));
    }

    function test_ClaimBack_SelfPaid_MintsNFT() public {
        _checkInAlice();
        _warpPastGrace();

        vm.prank(alice);
        checkin.claimBack(eventId);

        // Token 1 should be minted to alice
        assertEq(checkin.ownerOf(1), alice);
    }

    function test_ClaimBack_SelfPaid_IncrementsAttended() public {
        _checkInAlice();
        _warpPastGrace();

        vm.prank(alice);
        checkin.claimBack(eventId);

        assertEq(checkin.getUserRecord(alice).eventsAttended, 1);
    }

    function test_ClaimBack_SelfPaid_BanLiftCodePath_NeverSetByContract() public {
        // CONTRACT BUG DOCUMENTATION TEST:
        // The contract has ban-lift logic in claimBack (selfPaidAttendedSinceBan >= 1
        // sets bannedFromCover = false), but bannedFromCover is NEVER set to true
        // anywhere in the contract. withdrawForfeited does not ban covered no-shows.
        // This test documents the reachable state: after a covered no-show and
        // withdrawForfeited, bannedFromCover remains false.
        vm.prank(donor); checkin.donate(100e6);
        _createDefaultEvent();
        vm.warp(REG_START);
        vm.prank(alice); checkin.requestCover(eventId);
        // Alice is a covered no-show
        _warpPastGrace();
        vm.prank(organiser); checkin.withdrawForfeited(eventId);

        // bannedFromCover is never set — contract bug
        assertFalse(checkin.getUserRecord(alice).bannedFromCover);
        // hasOutstandingCover is also NOT cleared by withdrawForfeited — only by claimBack/reclaimStake
        assertTrue(checkin.getUserRecord(alice).hasOutstandingCover);
    }

    // ── claimBack: covered attendee ───────────────────────────────────────────

    function test_ClaimBack_Covered_StakeReturnsToPool() public {
        // Seed pool
        vm.prank(donor); checkin.donate(100e6);

        _createDefaultEvent();
        vm.warp(REG_START);

        // Alice gets cover
        vm.prank(alice);
        checkin.requestCover(eventId);

        uint256 poolBefore = checkin.sponsorPool();

        // Check in alice
        vm.warp(EVENT_DATE);
        vm.prank(alice);
        checkin.checkIn(eventId, alicePreimage);

        _warpPastGrace();

        vm.expectEmit(true, true, false, true, address(checkin));
        emit EventCheckIn.CoverRepaid(eventId, alice, STAKE);

        vm.prank(alice);
        checkin.claimBack(eventId);

        // Pool should have received STAKE back
        assertEq(checkin.sponsorPool(), poolBefore + STAKE);
        // Alice's USDC balance should be unchanged (she got no USDC back)
        // The claimed event emits amount=0
    }

    function test_ClaimBack_Covered_MintsNFT() public {
        vm.prank(donor); checkin.donate(100e6);
        _createDefaultEvent();
        vm.warp(REG_START);
        vm.prank(alice); checkin.requestCover(eventId);
        vm.warp(EVENT_DATE);
        vm.prank(alice); checkin.checkIn(eventId, alicePreimage);
        _warpPastGrace();
        vm.prank(alice); checkin.claimBack(eventId);

        assertEq(checkin.ownerOf(1), alice);
    }

    function test_ClaimBack_Covered_ClearsOutstandingCover() public {
        vm.prank(donor); checkin.donate(100e6);
        _createDefaultEvent();
        vm.warp(REG_START);
        vm.prank(alice); checkin.requestCover(eventId);
        assertTrue(checkin.getUserRecord(alice).hasOutstandingCover);

        vm.warp(EVENT_DATE);
        vm.prank(alice); checkin.checkIn(eventId, alicePreimage);
        _warpPastGrace();
        vm.prank(alice); checkin.claimBack(eventId);

        assertFalse(checkin.getUserRecord(alice).hasOutstandingCover);
        assertEq(checkin.getUserRecord(alice).timesRepaid, 1);
    }

    // ── claimBack: revert paths ───────────────────────────────────────────────

    function test_ClaimBack_RevertNotCheckedIn() public {
        _registerAlice();
        _warpPastGrace();
        vm.prank(alice);
        vm.expectRevert(EventCheckIn.NotCheckedIn.selector);
        checkin.claimBack(eventId);
    }

    function test_ClaimBack_RevertAlreadyClaimed() public {
        _checkInAlice();
        _warpPastGrace();
        vm.prank(alice); checkin.claimBack(eventId);

        vm.prank(alice);
        vm.expectRevert(EventCheckIn.AlreadyClaimed.selector);
        checkin.claimBack(eventId);
    }

    function test_ClaimBack_RevertNotRegistered() public {
        _createDefaultEvent();
        _warpPastGrace();
        vm.prank(bob);
        vm.expectRevert(EventCheckIn.AttendeeNotRegistered.selector);
        checkin.claimBack(eventId);
    }

    function test_ClaimBack_RevertBeforeRegistrationEnd() public {
        _checkInAlice();
        // Warp to just after event date but still before reg end? reg end < event date, 
        // so warp just to grace — the condition is block.timestamp <= registrationEnd
        // Since EVENT_DATE > REG_END, warping to EVENT_DATE passes that check.
        // But let's explicitly warp to just at REG_END to trigger the guard.
        vm.warp(REG_END);
        vm.prank(alice);
        vm.expectRevert(EventCheckIn.EventNotEnded.selector);
        checkin.claimBack(eventId);
    }

    // ── soulbound NFT: cannot transfer ───────────────────────────────────────

    function test_NFT_Soulbound_CannotTransfer() public {
        _checkInAlice();
        _warpPastGrace();
        vm.prank(alice); checkin.claimBack(eventId);

        vm.prank(alice);
        vm.expectRevert(EventCheckIn.Soulbound.selector);
        checkin.transferFrom(alice, bob, 1);
    }

    function test_NFT_Soulbound_CannotSafeTransfer() public {
        _checkInAlice();
        _warpPastGrace();
        vm.prank(alice); checkin.claimBack(eventId);

        vm.prank(alice);
        vm.expectRevert(EventCheckIn.Soulbound.selector);
        checkin.safeTransferFrom(alice, bob, 1);
    }

    // ── withdrawForfeited: 80/20 split ────────────────────────────────────────

    function test_WithdrawForfeited_8020Split() public {
        _registerAlice(); // alice pays but does NOT check in
        _warpPastGrace();

        uint256 poolBefore = checkin.sponsorPool();

        vm.expectEmit(true, true, false, true, address(checkin));
        // organiserShare = STAKE * 80 / 100 = 8e6; poolShare = STAKE * 20 / 100 = 2e6
        emit EventCheckIn.ForfeitWithdrawn(eventId, organiser, 8e6, 2e6);

        vm.prank(organiser);
        checkin.withdrawForfeited(eventId);

        assertEq(checkin.organiserCredits(organiser), 8e6);
        assertEq(checkin.sponsorPool(), poolBefore + 2e6);
    }

    function test_WithdrawForfeited_CoveredNoShowGoesToPool() public {
        // Seed pool and get alice covered
        vm.prank(donor); checkin.donate(100e6);
        _createDefaultEvent();
        vm.warp(REG_START);
        vm.prank(alice); checkin.requestCover(eventId);

        uint256 poolAfterCover = checkin.sponsorPool(); // pool was decremented

        // Alice doesn't check in
        _warpPastGrace();

        vm.prank(organiser);
        checkin.withdrawForfeited(eventId);

        // covered no-show stake (STAKE) returns to pool; no paid no-shows so no split
        assertEq(checkin.sponsorPool(), poolAfterCover + STAKE);
    }

    function test_WithdrawForfeited_RevertNotOrganiser() public {
        _registerAlice();
        _warpPastGrace();
        vm.prank(alice);
        vm.expectRevert(EventCheckIn.InvalidEvent.selector);
        checkin.withdrawForfeited(eventId);
    }

    function test_WithdrawForfeited_RevertBeforeGracePeriod() public {
        _registerAlice();
        vm.warp(EVENT_DATE + 1 days); // still inside grace
        vm.prank(organiser);
        vm.expectRevert(EventCheckIn.EventNotEnded.selector);
        checkin.withdrawForfeited(eventId);
    }

    function test_WithdrawForfeited_RevertAlreadyWithdrawn() public {
        _registerAlice();
        _warpPastGrace();
        vm.prank(organiser); checkin.withdrawForfeited(eventId);

        vm.prank(organiser);
        vm.expectRevert(EventCheckIn.AlreadyWithdrawn.selector);
        checkin.withdrawForfeited(eventId);
    }

    // ── withdrawOrganiserShare ────────────────────────────────────────────────

    function test_WithdrawOrganiserShare_HappyPath() public {
        _registerAlice();
        _warpPastGrace();
        vm.prank(organiser); checkin.withdrawForfeited(eventId);

        uint256 credit = checkin.organiserCredits(organiser); // 8e6
        uint256 balBefore = usdc.balanceOf(organiser);

        vm.expectEmit(true, false, false, true, address(checkin));
        emit EventCheckIn.OrganiserShareWithdrawn(organiser, credit);

        vm.prank(organiser);
        checkin.withdrawOrganiserShare();

        assertEq(usdc.balanceOf(organiser), balBefore + credit);
        assertEq(checkin.organiserCredits(organiser), 0);
    }

    function test_WithdrawOrganiserShare_RevertZeroBalance() public {
        vm.prank(organiser);
        vm.expectRevert(bytes("nothing to withdraw"));
        checkin.withdrawOrganiserShare();
    }

    // ── reclaimStake ─────────────────────────────────────────────────────────

    function test_ReclaimStake_SelfPaid_AvailableWhenBelow5Pct() public {
        // Register alice only (no one checks in — 0% check-in rate < 5%)
        _registerAlice();
        _warpPastRescue();

        uint256 balBefore = usdc.balanceOf(alice);

        vm.expectEmit(true, true, false, true, address(checkin));
        emit EventCheckIn.StakeRescued(eventId, alice, STAKE);

        vm.prank(alice);
        checkin.reclaimStake(eventId);

        assertEq(usdc.balanceOf(alice), balBefore + STAKE);
        assertTrue(checkin.hasClaimed(eventId, alice));
    }

    function test_ReclaimStake_RevertWhenAbove5PctCheckedIn() public {
        // Scenario: 20 registered, 1 checked in = 5% → threshold: 1*100 >= 5*20 → 100 >= 100 → true → rescue blocked
        // We create an event with 20 attendees; alice checks in; bob (not checked in) tries to reclaimStake.
        vm.warp(T0);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = aliceCodeHash;
        vm.prank(organiser);
        checkin.createEvent("Big", REG_START, REG_END, EVENT_DATE, STAKE, 25, hashes, 1 hours, 0);

        vm.warp(REG_START);
        // Register 20 attendees
        for (uint256 i = 0; i < 19; i++) {
            address att = makeAddr(string(abi.encode("big", i)));
            usdc.mint(att, STAKE);
            vm.prank(att); usdc.approve(address(checkin), STAKE);
            vm.prank(att); checkin.register(1);
        }
        vm.prank(alice); checkin.register(1); // 20th registrant

        // Alice checks in (1 of 20 = 5% exactly → threshold met)
        vm.warp(EVENT_DATE);
        vm.prank(alice); checkin.checkIn(1, alicePreimage);

        _warpPastRescue();

        // Bob is registered (one of the 19 above) — use the first one
        address firstAtt = makeAddr(string(abi.encode("big", uint256(0))));

        vm.prank(firstAtt);
        vm.expectRevert(EventCheckIn.RescueNotAvailable.selector);
        checkin.reclaimStake(1);
    }

    function test_ReclaimStake_RevertAlreadyCheckedIn() public {
        _checkInAlice();
        _warpPastRescue();
        vm.prank(alice);
        vm.expectRevert(EventCheckIn.AlreadyCheckedIn.selector);
        checkin.reclaimStake(eventId);
    }

    function test_ReclaimStake_RevertBeforeRescueWindow() public {
        _registerAlice();
        vm.warp(EVENT_DATE + 1 hours); // before 24h rescue window
        vm.prank(alice);
        vm.expectRevert(EventCheckIn.RescueNotAvailable.selector);
        checkin.reclaimStake(eventId);
    }

    function test_ReclaimStake_RevertNotRegistered() public {
        _createDefaultEvent();
        _warpPastRescue();
        vm.prank(bob);
        vm.expectRevert(EventCheckIn.AttendeeNotRegistered.selector);
        checkin.reclaimStake(eventId);
    }

    function test_ReclaimStake_Covered_ReturnsToPool() public {
        vm.prank(donor); checkin.donate(100e6);
        _createDefaultEvent();
        vm.warp(REG_START);
        vm.prank(alice); checkin.requestCover(eventId);

        uint256 poolBefore = checkin.sponsorPool();
        _warpPastRescue();

        vm.prank(alice);
        checkin.reclaimStake(eventId);

        // covered: stake returns to pool
        assertEq(checkin.sponsorPool(), poolBefore + STAKE);
        assertFalse(checkin.getUserRecord(alice).hasOutstandingCover);
    }

    // ── getUserRecord: correct after operations ───────────────────────────────

    function test_GetUserRecord_AfterRegistration() public {
        _registerAlice();
        EventCheckIn.UserRecord memory r = checkin.getUserRecord(alice);
        assertEq(r.eventsRegistered, 1);
        assertEq(r.eventsAttended, 0);
    }

    function test_GetUserRecord_AfterCheckIn() public {
        _checkInAlice();
        EventCheckIn.UserRecord memory r = checkin.getUserRecord(alice);
        assertEq(r.eventsRegistered, 1);
        assertEq(r.eventsAttended, 0); // eventsAttended incremented only in claimBack
    }

    function test_GetUserRecord_AfterClaim() public {
        _checkInAlice();
        _warpPastGrace();
        vm.prank(alice); checkin.claimBack(eventId);

        EventCheckIn.UserRecord memory r = checkin.getUserRecord(alice);
        assertEq(r.eventsRegistered, 1);
        assertEq(r.eventsAttended, 1);
    }

    function test_GetUserRecord_NewUser() public view {
        EventCheckIn.UserRecord memory r = checkin.getUserRecord(alice);
        assertEq(r.eventsRegistered, 0);
        assertEq(r.eventsAttended, 0);
        assertEq(r.timesCovered, 0);
        assertEq(r.timesRepaid, 0);
        assertFalse(r.hasOutstandingCover);
        assertFalse(r.bannedFromCover);
    }
}
