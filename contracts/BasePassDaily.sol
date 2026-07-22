// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BasePassDaily {
    struct Reward {
        string name;
        string metadataUri;
        uint256 pointCost;
        uint256 stock;
        bool active;
    }

    address public owner;
    bool public paused;

    uint256 public dailyPassPoints = 10;
    uint256 public streakBonusPoints = 2;
    uint256 public referralInviterPoints = 25;
    uint256 public referralInviteePoints = 15;
    uint256 public raffleEntryCost = 20;
    uint256 public raffleRound;
    address public lastRaffleWinner;

    mapping(address => uint256) public walletCheckInCount;
    mapping(address => uint256) public rewardPoints;
    mapping(address => uint256) public lastCheckInDay;
    mapping(address => uint256) public checkInStreak;
    mapping(address => address) public referralOf;
    mapping(uint256 => Reward) public rewards;
    mapping(address => uint256) public raffleEntries;
    mapping(uint256 => address[]) private rafflePlayers;

    uint256 public rewardCount;

    event DailyPassClaimed(
        address indexed user,
        address indexed referrer,
        uint256 day,
        uint256 pointsAwarded,
        uint256 streak
    );
    event RewardCreated(
        uint256 indexed rewardId,
        string name,
        string metadataUri,
        uint256 pointCost,
        uint256 stock,
        bool active
    );
    event RewardUpdated(
        uint256 indexed rewardId,
        string name,
        string metadataUri,
        uint256 pointCost,
        uint256 stock,
        bool active
    );
    event RewardRedeemed(address indexed user, uint256 indexed rewardId, uint256 pointCost);
    event RaffleEntered(address indexed user, uint256 indexed round, uint256 entries);
    event RaffleWinnerDrawn(uint256 indexed round, address indexed winner);
    event PointsParametersUpdated(
        uint256 dailyPassPoints,
        uint256 streakBonusPoints,
        uint256 referralInviterPoints,
        uint256 referralInviteePoints,
        uint256 raffleEntryCost
    );
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ContractPaused();
    error InvalidReward();
    error RewardInactive();
    error RewardOutOfStock();
    error InsufficientPoints();
    error NoRaffleEntries();
    error InvalidOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor() {
        owner = msg.sender;
        raffleRound = 1;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function claimDailyPass(address referrer) external whenNotPaused {
        uint256 today = block.timestamp / 1 days;

        uint256 pointsAwarded = dailyPassPoints;
        if (lastCheckInDay[msg.sender] + 1 == today) {
            checkInStreak[msg.sender] += 1;
        } else {
            checkInStreak[msg.sender] = 1;
        }

        if (checkInStreak[msg.sender] > 1) {
            pointsAwarded += streakBonusPoints;
        }

        bool firstCheckIn = walletCheckInCount[msg.sender] == 0;
        if (
            firstCheckIn &&
            referrer != address(0) &&
            referrer != msg.sender &&
            referralOf[msg.sender] == address(0)
        ) {
            referralOf[msg.sender] = referrer;
            rewardPoints[referrer] += referralInviterPoints;
            pointsAwarded += referralInviteePoints;
        }

        walletCheckInCount[msg.sender] += 1;
        rewardPoints[msg.sender] += pointsAwarded;
        lastCheckInDay[msg.sender] = today;

        emit DailyPassClaimed(msg.sender, referralOf[msg.sender], today, pointsAwarded, checkInStreak[msg.sender]);
    }

    function createReward(
        string calldata name,
        string calldata metadataUri,
        uint256 pointCost,
        uint256 stock,
        bool active
    ) external onlyOwner returns (uint256 rewardId) {
        rewardId = rewardCount;
        rewards[rewardId] = Reward(name, metadataUri, pointCost, stock, active);
        rewardCount += 1;
        emit RewardCreated(rewardId, name, metadataUri, pointCost, stock, active);
    }

    function updateReward(
        uint256 rewardId,
        string calldata name,
        string calldata metadataUri,
        uint256 pointCost,
        uint256 stock,
        bool active
    ) external onlyOwner {
        if (rewardId >= rewardCount) revert InvalidReward();
        rewards[rewardId] = Reward(name, metadataUri, pointCost, stock, active);
        emit RewardUpdated(rewardId, name, metadataUri, pointCost, stock, active);
    }

    function redeemReward(uint256 rewardId) external whenNotPaused {
        if (rewardId >= rewardCount) revert InvalidReward();
        Reward storage reward = rewards[rewardId];
        if (!reward.active) revert RewardInactive();
        if (reward.stock == 0) revert RewardOutOfStock();
        if (rewardPoints[msg.sender] < reward.pointCost) revert InsufficientPoints();

        rewardPoints[msg.sender] -= reward.pointCost;
        reward.stock -= 1;

        emit RewardRedeemed(msg.sender, rewardId, reward.pointCost);
    }

    function enterRaffle(uint256 entries) external whenNotPaused {
        if (entries == 0) revert NoRaffleEntries();
        uint256 totalCost = raffleEntryCost * entries;
        if (rewardPoints[msg.sender] < totalCost) revert InsufficientPoints();

        rewardPoints[msg.sender] -= totalCost;
        raffleEntries[msg.sender] += entries;

        for (uint256 i = 0; i < entries; i++) {
            rafflePlayers[raffleRound].push(msg.sender);
        }

        emit RaffleEntered(msg.sender, raffleRound, entries);
    }

    function drawRaffleWinner() external onlyOwner returns (address winner) {
        address[] storage players = rafflePlayers[raffleRound];
        if (players.length == 0) revert NoRaffleEntries();

        uint256 randomSeed = uint256(
            keccak256(abi.encodePacked(block.prevrandao, block.timestamp, blockhash(block.number - 1), players.length))
        );
        winner = players[randomSeed % players.length];
        lastRaffleWinner = winner;

        emit RaffleWinnerDrawn(raffleRound, winner);
        raffleRound += 1;
    }

    function setPointsParameters(
        uint256 newDailyPassPoints,
        uint256 newStreakBonusPoints,
        uint256 newReferralInviterPoints,
        uint256 newReferralInviteePoints,
        uint256 newRaffleEntryCost
    ) external onlyOwner {
        dailyPassPoints = newDailyPassPoints;
        streakBonusPoints = newStreakBonusPoints;
        referralInviterPoints = newReferralInviterPoints;
        referralInviteePoints = newReferralInviteePoints;
        raffleEntryCost = newRaffleEntryCost;

        emit PointsParametersUpdated(
            newDailyPassPoints,
            newStreakBonusPoints,
            newReferralInviterPoints,
            newReferralInviteePoints,
            newRaffleEntryCost
        );
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidOwner();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function getReward(uint256 rewardId) external view returns (Reward memory) {
        if (rewardId >= rewardCount) revert InvalidReward();
        return rewards[rewardId];
    }

    function getRafflePlayers(uint256 round) external view returns (address[] memory) {
        return rafflePlayers[round];
    }
}
