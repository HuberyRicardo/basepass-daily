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
    mapping(address => uint256) public nonces;

    uint256 public rewardCount;

    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("ClaimDailyPass(address user,address referrer,uint256 nonce,uint256 deadline)");
    bytes32 public constant REDEEM_TYPEHASH =
        keccak256("RedeemReward(address user,uint256 rewardId,uint256 nonce,uint256 deadline)");
    bytes32 public constant RAFFLE_TYPEHASH =
        keccak256("EnterRaffle(address user,uint256 entries,uint256 nonce,uint256 deadline)");
    bytes32 private immutable domainSeparator;

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
    error AlreadyClaimedToday();
    error InvalidReward();
    error RewardInactive();
    error RewardOutOfStock();
    error InsufficientPoints();
    error NoRaffleEntries();
    error InvalidOwner();
    error SignatureExpired();
    error InvalidSignature();

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
        domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("BasePassDaily")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function claimDailyPass(address referrer) external whenNotPaused {
        _claimDailyPass(msg.sender, referrer);
    }

    function claimDailyPassFor(address user, address referrer, uint256 deadline, bytes calldata signature)
        external
        whenNotPaused
    {
        _verify(
            user,
            keccak256(abi.encode(CLAIM_TYPEHASH, user, referrer, nonces[user]++, deadline)),
            deadline,
            signature
        );
        _claimDailyPass(user, referrer);
    }

    function _claimDailyPass(address user, address referrer) private {
        uint256 today = block.timestamp / 1 days;
        if (lastCheckInDay[user] == today) revert AlreadyClaimedToday();

        uint256 pointsAwarded = dailyPassPoints;
        if (lastCheckInDay[user] + 1 == today) {
            checkInStreak[user] += 1;
        } else {
            checkInStreak[user] = 1;
        }

        if (checkInStreak[user] > 1) {
            pointsAwarded += streakBonusPoints;
        }

        bool firstCheckIn = walletCheckInCount[user] == 0;
        if (
            firstCheckIn &&
            referrer != address(0) &&
            referrer != user &&
            referralOf[user] == address(0)
        ) {
            referralOf[user] = referrer;
            rewardPoints[referrer] += referralInviterPoints;
            pointsAwarded += referralInviteePoints;
        }

        walletCheckInCount[user] += 1;
        rewardPoints[user] += pointsAwarded;
        lastCheckInDay[user] = today;

        emit DailyPassClaimed(user, referralOf[user], today, pointsAwarded, checkInStreak[user]);
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
        _redeemReward(msg.sender, rewardId);
    }

    function redeemRewardFor(address user, uint256 rewardId, uint256 deadline, bytes calldata signature)
        external
        whenNotPaused
    {
        _verify(
            user,
            keccak256(abi.encode(REDEEM_TYPEHASH, user, rewardId, nonces[user]++, deadline)),
            deadline,
            signature
        );
        _redeemReward(user, rewardId);
    }

    function _redeemReward(address user, uint256 rewardId) private {
        if (rewardId >= rewardCount) revert InvalidReward();
        Reward storage reward = rewards[rewardId];
        if (!reward.active) revert RewardInactive();
        if (reward.stock == 0) revert RewardOutOfStock();
        if (rewardPoints[user] < reward.pointCost) revert InsufficientPoints();

        rewardPoints[user] -= reward.pointCost;
        reward.stock -= 1;

        emit RewardRedeemed(user, rewardId, reward.pointCost);
    }

    function enterRaffle(uint256 entries) external whenNotPaused {
        _enterRaffle(msg.sender, entries);
    }

    function enterRaffleFor(address user, uint256 entries, uint256 deadline, bytes calldata signature)
        external
        whenNotPaused
    {
        _verify(
            user,
            keccak256(abi.encode(RAFFLE_TYPEHASH, user, entries, nonces[user]++, deadline)),
            deadline,
            signature
        );
        _enterRaffle(user, entries);
    }

    function _enterRaffle(address user, uint256 entries) private {
        if (entries == 0) revert NoRaffleEntries();
        uint256 totalCost = raffleEntryCost * entries;
        if (rewardPoints[user] < totalCost) revert InsufficientPoints();

        rewardPoints[user] -= totalCost;
        raffleEntries[user] += entries;

        for (uint256 i = 0; i < entries; i++) {
            rafflePlayers[raffleRound].push(user);
        }

        emit RaffleEntered(user, raffleRound, entries);
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

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return domainSeparator;
    }

    function _verify(address signer, bytes32 structHash, uint256 deadline, bytes calldata signature) private view {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        if (_recover(digest, signature) != signer) revert InvalidSignature();
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address recovered) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();

        recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert InvalidSignature();
    }
}
