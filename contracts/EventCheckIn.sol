// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract EventCheckIn is ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    uint256 public constant FORFEIT_SPONSOR_PCT = 20;
    uint256 public constant FORFEIT_ORGANISER_PCT = 80;
    uint256 public constant CHECKIN_GRACE_DAYS = 2;
    uint256 public constant RESCUE_HOURS = 24;
    uint256 public constant RESCUE_THRESHOLD_PCT = 5;
    uint256 public constant MAX_COVERED_ATTENDEES = 50;

    struct Event {
        uint256 id;
        string name;
        uint256 registrationStart;
        uint256 registrationEnd;
        uint256 date;
        uint256 stakeAmount;
        address organiser;
        uint256 maxAttendees;
        uint256 registeredCount;
        uint256 checkedInCount;
        uint256 codeWindowDuration;
        bool cancelled;
        bool forfeitWithdrawn;
    }

    struct UserRecord {
        uint32 eventsRegistered;
        uint32 eventsAttended;
        uint32 timesCovered;
        uint32 timesRepaid;
        bool hasOutstandingCover;
        bool bannedFromCover;
        uint32 selfPaidAttendedSinceBan;
    }

    IERC20 public immutable usdc;
    uint256 public sponsorPool;

    uint256 private _nextEventId = 1;
    uint256 private _nextTokenId = 1;

    mapping(uint256 => Event) private _events;
    mapping(uint256 => bytes32[]) private _eventCodeHashes;
    mapping(uint256 => mapping(address => bool)) private _registered;
    mapping(uint256 => mapping(address => bool)) private _checkedIn;
    mapping(uint256 => mapping(address => bool)) private _claimed;
    mapping(uint256 => mapping(address => bool)) private _coveredRegistration;
    mapping(uint256 => uint256) private _claimedCount;
    mapping(uint256 => bool) private _stakeRescued;
    mapping(address => UserRecord) private _records;
    mapping(uint256 => uint256) private _tokenEventId;

    mapping(uint256 => uint256) private _paidRegisteredCount;
    mapping(uint256 => uint256) private _paidClaimedCount;
    mapping(uint256 => uint256) private _coveredRegisteredCount;
    mapping(uint256 => uint256) private _coveredClaimedCount;
    mapping(uint256 => address[]) private _coveredAttendeesList;
    mapping(address => uint256) public organiserCredits;

    event EventCreated(
        uint256 indexed eventId,
        address indexed organiser,
        string name,
        uint256 date,
        uint256 stakeAmount,
        uint256 maxAttendees
    );
    event Registered(uint256 indexed eventId, address indexed attendee);
    event CheckedIn(uint256 indexed eventId, address indexed attendee);
    event Claimed(uint256 indexed eventId, address indexed attendee, uint256 amount);
    event ForfeitWithdrawn(
        uint256 indexed eventId,
        address indexed organiser,
        uint256 organiserAmount,
        uint256 poolAmount
    );
    event OrganiserShareWithdrawn(address indexed organiser, uint256 amount);
    event StakeRescued(uint256 indexed eventId, address indexed attendee, uint256 amount);
    event CoverGranted(uint256 indexed eventId, address indexed attendee, uint256 amount, string reason);
    event CoverDenied(uint256 indexed eventId, address indexed attendee, string reason);
    event CoverRepaid(uint256 indexed eventId, address indexed attendee, uint256 amount);
    event Donated(address indexed donor, uint256 amount);

    error ZeroAddressUSDC();
    error InvalidEvent();
    error EventDateNotFuture();
    error StakeAmountZero();
    error MaxAttendeesZero();
    error CodeHashesEmpty();
    error WindowDurationZero();
    error EventCancelled();
    error EventRegistrationNotOpen();
    error EventRegistrationClosed();
    error AlreadyRegistered();
    error EventAtCapacity();
    error AttendeeNotRegistered();
    error AlreadyCheckedIn();
    error CheckInWindowClosed();
    error InvalidCodeForAttendee();
    error NotCheckedIn();
    error AlreadyClaimed();
    error EventNotEnded();
    error AlreadyWithdrawn();
    error RescueNotAvailable();
    error AlreadyRescued();
    error CoverCapReached();
    error Soulbound();

    constructor(address _usdc) ERC721("Event Attendance Proof", "EAP") {
        if (_usdc == address(0)) revert ZeroAddressUSDC();
        usdc = IERC20(_usdc);
    }

    function createEvent(
        string calldata name,
        uint256 registrationStart,
        uint256 registrationEnd,
        uint256 date,
        uint256 stakeAmount,
        uint256 maxAttendees,
        bytes32[] calldata codeHashes,
        uint256 codeWindowDuration,
        uint256 seedAmount
    ) external nonReentrant {
        if (registrationStart < block.timestamp) revert EventDateNotFuture();
        if (registrationEnd <= registrationStart) revert EventDateNotFuture();
        if (date <= registrationEnd) revert EventDateNotFuture();
        if (stakeAmount == 0) revert StakeAmountZero();
        if (maxAttendees == 0) revert MaxAttendeesZero();
        if (codeHashes.length == 0) revert CodeHashesEmpty();
        if (codeWindowDuration == 0) revert WindowDurationZero();

        uint256 eventId = _nextEventId;
        _nextEventId = eventId + 1;

        _events[eventId] = Event({
            id: eventId,
            name: name,
            registrationStart: registrationStart,
            registrationEnd: registrationEnd,
            date: date,
            stakeAmount: stakeAmount,
            organiser: msg.sender,
            maxAttendees: maxAttendees,
            registeredCount: 0,
            checkedInCount: 0,
            codeWindowDuration: codeWindowDuration,
            cancelled: false,
            forfeitWithdrawn: false
        });

        _eventCodeHashes[eventId] = codeHashes;

        if (seedAmount > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), seedAmount);
            sponsorPool += seedAmount;
        }

        emit EventCreated(eventId, msg.sender, name, date, stakeAmount, maxAttendees);
    }

    function register(uint256 eventId) external nonReentrant {
        _requireEventExists(eventId);
        Event storage evt = _events[eventId];

        if (evt.cancelled) revert EventCancelled();
        if (block.timestamp < evt.registrationStart) revert EventRegistrationNotOpen();
        if (block.timestamp > evt.registrationEnd) revert EventRegistrationClosed();
        if (_registered[eventId][msg.sender]) revert AlreadyRegistered();
        if (evt.registeredCount >= evt.maxAttendees) revert EventAtCapacity();

        _registered[eventId][msg.sender] = true;
        evt.registeredCount += 1;
        _paidRegisteredCount[eventId] += 1;
        _records[msg.sender].eventsRegistered += 1;

        usdc.safeTransferFrom(msg.sender, address(this), evt.stakeAmount);

        emit Registered(eventId, msg.sender);
    }

    /// @notice The organiser's QR code for each attendee encodes keccak256(secret || attendeeAddress).
    /// This binds the code to the attendee, preventing mempool front-running.
    /// @dev If the organiser withholds codes for the entire event, checkedInCount stays 0,
    /// which is below the 5% rescue threshold. All attendees can then call reclaimStake()
    /// after the rescue window to recover their full stake. This means the organiser cannot
    /// profitably withhold codes - they would forfeit their 80% organiser share without gaining anything.
    function checkIn(uint256 eventId, bytes32 preimage) external {
        _requireEventExists(eventId);
        Event storage evt = _events[eventId];

        if (evt.cancelled) revert EventCancelled();
        if (!_registered[eventId][msg.sender]) revert AttendeeNotRegistered();
        if (_checkedIn[eventId][msg.sender]) revert AlreadyCheckedIn();
        if (block.timestamp < evt.date) revert CheckInWindowClosed();
        if (block.timestamp > evt.date + CHECKIN_GRACE_DAYS * 1 days) revert CheckInWindowClosed();

        uint256 windowIndex = (block.timestamp - evt.date) / evt.codeWindowDuration;
        uint256 codeHashCount = _eventCodeHashes[eventId].length;
        if (windowIndex >= codeHashCount) {
            windowIndex = codeHashCount - 1;
        }

        bytes32 expected = _eventCodeHashes[eventId][windowIndex];
        if (keccak256(abi.encodePacked(preimage, msg.sender)) != expected) revert InvalidCodeForAttendee();

        _checkedIn[eventId][msg.sender] = true;
        evt.checkedInCount += 1;

        emit CheckedIn(eventId, msg.sender);
    }

    function claimBack(uint256 eventId) external nonReentrant {
        _requireEventExists(eventId);
        Event storage evt = _events[eventId];

        if (!_registered[eventId][msg.sender]) revert AttendeeNotRegistered();
        if (!_checkedIn[eventId][msg.sender]) revert NotCheckedIn();
        if (_claimed[eventId][msg.sender]) revert AlreadyClaimed();
        if (block.timestamp <= evt.registrationEnd) revert EventNotEnded();

        _claimed[eventId][msg.sender] = true;
        _claimedCount[eventId] += 1;

        UserRecord storage record = _records[msg.sender];
        bool isCovered = _coveredRegistration[eventId][msg.sender];

        if (isCovered) {
            _coveredClaimedCount[eventId] += 1;
            sponsorPool += evt.stakeAmount;
            record.hasOutstandingCover = false;
            record.timesRepaid += 1;
            emit CoverRepaid(eventId, msg.sender, evt.stakeAmount);
        } else {
            _paidClaimedCount[eventId] += 1;
            usdc.safeTransfer(msg.sender, evt.stakeAmount);

            if (record.bannedFromCover) {
                record.selfPaidAttendedSinceBan += 1;
                if (record.selfPaidAttendedSinceBan >= 1) {
                    record.bannedFromCover = false;
                    record.selfPaidAttendedSinceBan = 0;
                }
            }
        }

        record.eventsAttended += 1;

        uint256 tokenId = _nextTokenId;
        _nextTokenId = tokenId + 1;
        _tokenEventId[tokenId] = eventId;
        _mint(msg.sender, tokenId);

        emit Claimed(eventId, msg.sender, isCovered ? 0 : evt.stakeAmount);
    }

    function withdrawForfeited(uint256 eventId) external nonReentrant {
        _requireEventExists(eventId);
        Event storage evt = _events[eventId];

        if (msg.sender != evt.organiser) revert InvalidEvent();
        if (block.timestamp <= evt.date + CHECKIN_GRACE_DAYS * 1 days) revert EventNotEnded();
        if (evt.forfeitWithdrawn) revert AlreadyWithdrawn();
        if (_stakeRescued[eventId]) revert AlreadyRescued();

        evt.forfeitWithdrawn = true;

        uint256 coveredNoShows = _coveredRegisteredCount[eventId] - _coveredClaimedCount[eventId];
        uint256 coveredNoShowAmount = coveredNoShows * evt.stakeAmount;
        sponsorPool += coveredNoShowAmount;

        address[] storage coveredAttendees = _coveredAttendeesList[eventId];
        uint256 coveredAttendeesLength = coveredAttendees.length;
        for (uint256 i = 0; i < coveredAttendeesLength; i++) {
            address attendee = coveredAttendees[i];
            if (!_checkedIn[eventId][attendee]) {
                UserRecord storage record = _records[attendee];
                record.hasOutstandingCover = false;
                record.bannedFromCover = true;
                record.selfPaidAttendedSinceBan = 0;
            }
        }

        uint256 forfeitedPaidCount = _paidRegisteredCount[eventId] - _paidClaimedCount[eventId];
        uint256 forfeitAmount = forfeitedPaidCount * evt.stakeAmount;

        uint256 organiserShare = (forfeitAmount * FORFEIT_ORGANISER_PCT) / 100;
        uint256 poolShare = forfeitAmount - organiserShare;

        if (organiserShare > 0) {
            organiserCredits[evt.organiser] += organiserShare;
        }
        if (poolShare > 0) {
            sponsorPool += poolShare;
        }

        emit ForfeitWithdrawn(eventId, evt.organiser, organiserShare, poolShare);
    }

    function withdrawOrganiserShare() external nonReentrant {
        uint256 amount = organiserCredits[msg.sender];
        require(amount > 0, "nothing to withdraw");

        organiserCredits[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);

        emit OrganiserShareWithdrawn(msg.sender, amount);
    }

    function reclaimStake(uint256 eventId) external nonReentrant {
        _requireEventExists(eventId);
        Event storage evt = _events[eventId];

        if (evt.cancelled) revert EventCancelled();
        if (!_registered[eventId][msg.sender]) revert AttendeeNotRegistered();
        if (_checkedIn[eventId][msg.sender]) revert AlreadyCheckedIn();
        if (_claimed[eventId][msg.sender]) revert AlreadyClaimed();
        if (block.timestamp <= evt.date + RESCUE_HOURS * 1 hours) revert RescueNotAvailable();
        if (evt.checkedInCount * 100 >= RESCUE_THRESHOLD_PCT * evt.registeredCount) revert RescueNotAvailable();
        if (evt.forfeitWithdrawn) revert AlreadyWithdrawn();

        _claimed[eventId][msg.sender] = true;
        _claimedCount[eventId] += 1;

        bool isCovered = _coveredRegistration[eventId][msg.sender];
        uint256 amountOut;

        if (isCovered) {
            _coveredClaimedCount[eventId] += 1;
            sponsorPool += evt.stakeAmount;
            _records[msg.sender].hasOutstandingCover = false;
            amountOut = 0;
        } else {
            _paidClaimedCount[eventId] += 1;
            amountOut = evt.stakeAmount;
            usdc.safeTransfer(msg.sender, amountOut);
        }

        emit StakeRescued(eventId, msg.sender, amountOut);
    }

    function requestCover(uint256 eventId) external {
        _requireEventExists(eventId);
        Event storage evt = _events[eventId];

        if (evt.cancelled) revert EventCancelled();
        if (block.timestamp < evt.registrationStart) revert EventRegistrationNotOpen();
        if (block.timestamp > evt.registrationEnd) revert EventRegistrationClosed();
        if (_registered[eventId][msg.sender]) revert AlreadyRegistered();
        if (evt.registeredCount >= evt.maxAttendees) revert EventAtCapacity();

        UserRecord storage r = _records[msg.sender];

        if (sponsorPool < evt.stakeAmount) {
            emit CoverDenied(eventId, msg.sender, "The sponsor pool does not have enough USDC to cover this stake right now.");
            return;
        }

        uint256 score = _computeCreditScore(msg.sender);
        if (score < 40 && r.eventsRegistered > 0) {
            emit CoverDenied(eventId, msg.sender, "Your credit score is too low to receive cover at this time.");
            return;
        }

        if (r.hasOutstandingCover) {
            emit CoverDenied(eventId, msg.sender, "You already have a covered stake - check in to that event first.");
            return;
        }

        if (r.bannedFromCover) {
            emit CoverDenied(
                eventId,
                msg.sender,
                "You forfeited a covered stake. Attend one event you paid for to restore eligibility."
            );
            return;
        }

        if (r.eventsRegistered != 0 && uint256(r.eventsAttended) * 100 < uint256(r.eventsRegistered) * 50) {
            emit CoverDenied(
                eventId,
                msg.sender,
                "Your attendance rate is below 50% - attend more of the events you sign up for."
            );
            return;
        }

        if (r.timesCovered != 0 && r.timesRepaid != r.timesCovered) {
            emit CoverDenied(eventId, msg.sender, "You have a previous covered stake that was not repaid.");
            return;
        }

        if (_coveredAttendeesList[eventId].length >= MAX_COVERED_ATTENDEES) revert CoverCapReached();

        string memory approvalReason = _buildCoverApprovalReason(r);

        sponsorPool -= evt.stakeAmount;
        _registered[eventId][msg.sender] = true;
        evt.registeredCount += 1;
        _coveredRegistration[eventId][msg.sender] = true;
        _coveredRegisteredCount[eventId] += 1;
        _coveredAttendeesList[eventId].push(msg.sender);

        r.hasOutstandingCover = true;
        r.timesCovered += 1;
        r.eventsRegistered += 1;

        emit CoverGranted(eventId, msg.sender, evt.stakeAmount, approvalReason);
    }

    function donate(uint256 amount) external nonReentrant {
        if (amount == 0) revert StakeAmountZero();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        sponsorPool += amount;
        emit Donated(msg.sender, amount);
    }

    function getEvents() external view returns (Event[] memory) {
        uint256 total = _nextEventId - 1;
        Event[] memory eventsList = new Event[](total);

        for (uint256 i = 1; i <= total; i++) {
            eventsList[i - 1] = _events[i];
        }

        return eventsList;
    }

    function getEvent(uint256 eventId) external view returns (Event memory) {
        _requireEventExists(eventId);
        return _events[eventId];
    }

    function getEventCodeHashCount(uint256 eventId) external view returns (uint256) {
        _requireEventExists(eventId);
        return _eventCodeHashes[eventId].length;
    }

    function isRegistered(uint256 eventId, address attendee) external view returns (bool) {
        _requireEventExists(eventId);
        return _registered[eventId][attendee];
    }

    function isCheckedIn(uint256 eventId, address attendee) external view returns (bool) {
        _requireEventExists(eventId);
        return _checkedIn[eventId][attendee];
    }

    function hasClaimed(uint256 eventId, address attendee) external view returns (bool) {
        _requireEventExists(eventId);
        return _claimed[eventId][attendee];
    }

    function isCoveredRegistration(uint256 eventId, address attendee) external view returns (bool) {
        _requireEventExists(eventId);
        return _coveredRegistration[eventId][attendee];
    }

    function claimedCount(uint256 eventId) external view returns (uint256) {
        _requireEventExists(eventId);
        return _claimedCount[eventId];
    }

    function getUserRecord(address user) external view returns (UserRecord memory) {
        return _records[user];
    }

    function getSponsorPoolInfo(uint256 stakeAmount) external view returns (uint256 balance, uint256 stakesCanCover) {
        balance = sponsorPool;
        stakesCanCover = stakeAmount == 0 ? 0 : sponsorPool / stakeAmount;
    }

    function getCoverEligibility(address user, uint256 eventId) external view returns (bool eligible, string memory reason) {
        _requireEventExists(eventId);
        Event storage evt = _events[eventId];

        if (evt.cancelled) {
            return (false, "Event is cancelled.");
        }
        if (block.timestamp < evt.registrationStart) {
            return (false, "Registration has not opened yet.");
        }
        if (block.timestamp > evt.registrationEnd) {
            return (false, "Registration is closed.");
        }
        if (_registered[eventId][user]) {
            return (false, "Already registered for this event.");
        }
        if (evt.registeredCount >= evt.maxAttendees) {
            return (false, "Event is at full capacity.");
        }

        UserRecord memory r = _records[user];

        if (sponsorPool < evt.stakeAmount) {
            return (false, "The sponsor pool does not have enough USDC to cover this stake right now.");
        }

        uint256 score = _computeCreditScore(user);
        if (score < 40 && r.eventsRegistered > 0) {
            return (false, "Your credit score is too low to receive cover at this time.");
        }

        if (r.hasOutstandingCover) {
            return (false, "You already have a covered stake - check in to that event first.");
        }

        if (r.bannedFromCover) {
            return (false, "You forfeited a covered stake. Attend one event you paid for to restore eligibility.");
        }

        if (r.eventsRegistered != 0 && uint256(r.eventsAttended) * 100 < uint256(r.eventsRegistered) * 50) {
            return (false, "Your attendance rate is below 50% - attend more of the events you sign up for.");
        }

        if (r.timesCovered != 0 && r.timesRepaid != r.timesCovered) {
            return (false, "You have a previous covered stake that was not repaid.");
        }

        return (true, _buildCoverApprovalReason(r));
    }

    function getCreditScore(address user) external view returns (uint256 score, string memory label, string memory explanation) {
        UserRecord memory r = _records[user];

        if (r.eventsRegistered == 0) {
            return (0, "new", "Not enough history yet - register for your first event.");
        }

        score = _computeCreditScore(user);
        uint256 attendanceRate = uint256(r.eventsAttended) * 100 / uint256(r.eventsRegistered);

        if (score >= 80) {
            label = "trusted";
        } else if (score >= 60) {
            label = "building";
        } else if (score >= 40) {
            label = "at risk";
        } else {
            label = "low";
        }

        if (attendanceRate >= 80 && r.timesRepaid > 0) {
            explanation = string.concat(
                "You have attended ",
                uint256(r.eventsAttended).toString(),
                " of ",
                uint256(r.eventsRegistered).toString(),
                " events and repaid ",
                uint256(r.timesRepaid).toString(),
                " covers."
            );
        } else if (attendanceRate >= 80 && r.timesCovered == 0) {
            explanation = string.concat(
                "You have a strong attendance record with ",
                uint256(r.eventsAttended).toString(),
                " of ",
                uint256(r.eventsRegistered).toString(),
                " events attended."
            );
        } else if (attendanceRate < 50) {
            explanation = string.concat(
                "Your attendance rate is low - you have attended ",
                uint256(r.eventsAttended).toString(),
                " of ",
                uint256(r.eventsRegistered).toString(),
                " events."
            );
        } else if (r.bannedFromCover) {
            explanation = "You forfeited a covered stake, which lowered your score.";
        } else {
            explanation = string.concat(
                "You have attended ",
                uint256(r.eventsAttended).toString(),
                " of ",
                uint256(r.eventsRegistered).toString(),
                " events."
            );
        }
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        uint256 eventId = _tokenEventId[tokenId];
        Event storage evt = _events[eventId];

        string memory json = string.concat(
            '{"name":"Attendance Proof #',
            tokenId.toString(),
            '","description":"Attendance proof for event #',
            eventId.toString(),
            " - ",
            evt.name,
            '","attributes":[{"trait_type":"Event ID","value":"',
            eventId.toString(),
            '"},{"trait_type":"Event Name","value":"',
            evt.name,
            '"}]}'
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) {
            revert Soulbound();
        }
        return super._update(to, tokenId, auth);
    }

    function _requireEventExists(uint256 eventId) internal view {
        if (eventId == 0 || eventId >= _nextEventId) revert InvalidEvent();
    }

    function _computeCreditScore(address user) internal view returns (uint256 score) {
        UserRecord memory r = _records[user];

        if (r.eventsRegistered == 0) {
            return 0;
        }

        uint256 attendanceRate = uint256(r.eventsAttended) * 100 / uint256(r.eventsRegistered);

        score = 50;
        score += (attendanceRate * 40) / 100;

        if (r.timesCovered > 0) {
            uint256 repayRate = uint256(r.timesRepaid) * 100 / uint256(r.timesCovered);
            score += (repayRate * 20) / 100;
        } else {
            score += 20;
        }

        if (r.bannedFromCover) {
            if (score >= 20) {
                score -= 20;
            } else {
                score = 0;
            }
        }

        if (r.hasOutstandingCover) {
            if (score >= 5) {
                score -= 5;
            } else {
                score = 0;
            }
        }

        if (score > 100) {
            score = 100;
        }
    }

    function _buildCoverApprovalReason(UserRecord memory r) internal pure returns (string memory) {
        if (r.eventsRegistered == 0) {
            return "Cover approved - welcome, your first event is on the pool.";
        }

        if (r.timesCovered == 0) {
            return string.concat(
                "Cover approved - you have attended ",
                uint256(r.eventsAttended).toString(),
                " of ",
                uint256(r.eventsRegistered).toString(),
                " events."
            );
        }

        return string.concat(
            "Cover approved - you have attended ",
            uint256(r.eventsAttended).toString(),
            " of ",
            uint256(r.eventsRegistered).toString(),
            " events and repaid ",
            uint256(r.timesRepaid).toString(),
            " covers."
        );
    }

    function _unusedCryptoAnchors(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(digest);
        return ECDSA.recover(ethHash, signature);
    }
}
