// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

abstract contract FlowPayCore {
    uint16 public constant MAX_SAVINGS_RATE_BPS = 3_000;
    uint16 public constant SAVINGS_RATE_STEP_BPS = 500;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    address public employer;
    address public employee;
    uint256 public ratePerSecond;
    uint256 public totalDeposited;
    uint256 public totalVested;
    uint256 public salaryAccrued;
    uint256 public savingsAccrued;
    uint256 public salaryClaimed;
    uint256 public savingsClaimed;
    uint16 public savingsRateBps;
    uint256 public checkpointTime;
    bool public streamCreated;
    bool public paused;

    struct Snapshot {
        address employee;
        uint256 ratePerSecond;
        uint256 totalDeposited;
        uint256 totalVested;
        uint256 salaryAccrued;
        uint256 savingsAccrued;
        uint256 salaryClaimed;
        uint256 savingsClaimed;
        uint256 salaryClaimable;
        uint256 savingsClaimable;
        uint256 contractBalance;
        uint256 availableToVest;
        uint16 savingsRateBps;
        uint256 savingsRemainder;
        uint256 checkpointTime;
        bool streamCreated;
        bool paused;
        bool underfunded;
    }

    error Unauthorized();
    error StreamAlreadyCreated();
    error StreamNotCreated();
    error InvalidEmployee();
    error InvalidRate();
    error InvalidDeposit();
    error InvalidSavingsRate();
    error InvalidClaimAmount();
    error AlreadyPaused();
    error NotPaused();
    error TransferFailed();
    error ReentrantCall();
    error InvalidEmployer();

    event StreamCreated(address indexed employer, address indexed employee, uint256 ratePerSecond, uint256 amount, uint256 timestamp);
    event ToppedUp(address indexed employer, uint256 amount, uint256 totalDeposited, uint256 timestamp);
    event StreamPaused(address indexed employer, uint256 timestamp);
    event StreamResumed(address indexed employer, uint256 timestamp);
    event SavingsRateChanged(address indexed employee, uint16 oldRateBps, uint16 newRateBps, uint256 timestamp);
    event SalaryClaimed(address indexed employee, uint256 amount, uint256 timestamp);
    event SavingsClaimed(address indexed employee, uint256 amount, uint256 timestamp);

    uint256 private savingsRemainder;
    uint256 private entered = 1;

    constructor(address employer_) {
        if (employer_ == address(0)) revert InvalidEmployer();
        employer = employer_;
    }

    modifier onlyEmployer() {
        if (msg.sender != employer) revert Unauthorized();
        _;
    }

    modifier onlyEmployee() {
        if (msg.sender != employee || employee == address(0)) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (entered != 1) revert ReentrantCall();
        entered = 2;
        _;
        entered = 1;
    }

    function createStream(address employee_, uint256 ratePerSecond_) external payable onlyEmployer {
        _createStream(employee_, ratePerSecond_, msg.value);
    }

    function _createStream(address employee_, uint256 ratePerSecond_, uint256 amount_) internal {
        if (streamCreated) revert StreamAlreadyCreated();
        if (employee_ == address(0) || employee_ == employer) revert InvalidEmployee();
        if (ratePerSecond_ == 0) revert InvalidRate();
        if (amount_ == 0) revert InvalidDeposit();

        employee = employee_;
        ratePerSecond = ratePerSecond_;
        totalDeposited = amount_;
        savingsRateBps = 1_000;
        checkpointTime = block.timestamp;
        streamCreated = true;

        emit StreamCreated(employer, employee_, ratePerSecond_, amount_, block.timestamp);
    }

    function topUp() external payable onlyEmployer {
        _requireStream();
        if (msg.value == 0) revert InvalidDeposit();
        _checkpoint();
        totalDeposited += msg.value;
        emit ToppedUp(msg.sender, msg.value, totalDeposited, block.timestamp);
    }

    function pause() external onlyEmployer {
        _requireStream();
        if (paused) revert AlreadyPaused();
        _checkpoint();
        paused = true;
        checkpointTime = block.timestamp;
        emit StreamPaused(msg.sender, block.timestamp);
    }

    function resume() external onlyEmployer {
        _requireStream();
        if (!paused) revert NotPaused();
        paused = false;
        checkpointTime = block.timestamp;
        emit StreamResumed(msg.sender, block.timestamp);
    }

    function setSavingsRate(uint16 rateBps) external onlyEmployee {
        _requireStream();
        if (rateBps > MAX_SAVINGS_RATE_BPS || rateBps % SAVINGS_RATE_STEP_BPS != 0) revert InvalidSavingsRate();
        _checkpoint();
        uint16 oldRateBps = savingsRateBps;
        savingsRateBps = rateBps;
        emit SavingsRateChanged(msg.sender, oldRateBps, rateBps, block.timestamp);
    }

    function claimSalary(uint256 amount) external onlyEmployee nonReentrant { _claim(amount, false); }
    function claimSavings(uint256 amount) external onlyEmployee nonReentrant { _claim(amount, true); }

    function getSnapshot() external view returns (Snapshot memory snapshot) {
        (uint256 newlyVested, uint256 newlySaved, uint256 projectedRemainder) = _preview();
        uint256 projectedVested = totalVested + newlyVested;
        uint256 projectedSavings = savingsAccrued + newlySaved;
        uint256 projectedSalary = salaryAccrued + newlyVested - newlySaved;
        uint256 remainingToVest = totalDeposited - projectedVested;
        snapshot = Snapshot({
            employee: employee,
            ratePerSecond: ratePerSecond,
            totalDeposited: totalDeposited,
            totalVested: projectedVested,
            salaryAccrued: projectedSalary,
            savingsAccrued: projectedSavings,
            salaryClaimed: salaryClaimed,
            savingsClaimed: savingsClaimed,
            salaryClaimable: projectedSalary - salaryClaimed,
            savingsClaimable: projectedSavings - savingsClaimed,
            contractBalance: address(this).balance,
            availableToVest: remainingToVest,
            savingsRateBps: savingsRateBps,
            savingsRemainder: projectedRemainder,
            checkpointTime: checkpointTime,
            streamCreated: streamCreated,
            paused: paused,
            underfunded: streamCreated && remainingToVest == 0
        });
    }

    function _claim(uint256 amount, bool fromSavings) private {
        _requireStream();
        if (amount == 0) revert InvalidClaimAmount();
        _checkpoint();
        if (fromSavings) {
            if (amount > savingsAccrued - savingsClaimed) revert InvalidClaimAmount();
            savingsClaimed += amount;
        } else {
            if (amount > salaryAccrued - salaryClaimed) revert InvalidClaimAmount();
            salaryClaimed += amount;
        }
        (bool sent,) = payable(employee).call{value: amount}("");
        if (!sent) revert TransferFailed();
        if (fromSavings) emit SavingsClaimed(employee, amount, block.timestamp);
        else emit SalaryClaimed(employee, amount, block.timestamp);
    }

    function _checkpoint() private {
        if (paused) { checkpointTime = block.timestamp; return; }
        (uint256 newlyVested, uint256 newlySaved, uint256 newRemainder) = _preview();
        totalVested += newlyVested;
        savingsAccrued += newlySaved;
        salaryAccrued += newlyVested - newlySaved;
        savingsRemainder = newRemainder;
        checkpointTime = block.timestamp;
    }

    function _preview() private view returns (uint256 newlyVested, uint256 newlySaved, uint256 newRemainder) {
        newRemainder = savingsRemainder;
        if (!streamCreated || paused || block.timestamp <= checkpointTime || ratePerSecond == 0) return (0, 0, newRemainder);
        uint256 elapsed = block.timestamp - checkpointTime;
        uint256 remaining = totalDeposited - totalVested;
        if (remaining == 0) return (0, 0, newRemainder);
        uint256 maxSafeElapsed = remaining / ratePerSecond;
        newlyVested = elapsed > maxSafeElapsed ? remaining : elapsed * ratePerSecond;
        if (newlyVested > remaining) newlyVested = remaining;
        uint256 whole = (newlyVested / BPS_DENOMINATOR) * savingsRateBps;
        uint256 fraction = (newlyVested % BPS_DENOMINATOR) * savingsRateBps + savingsRemainder;
        newlySaved = whole + fraction / BPS_DENOMINATOR;
        newRemainder = fraction % BPS_DENOMINATOR;
    }

    function _requireStream() private view {
        if (!streamCreated) revert StreamNotCreated();
    }
}
