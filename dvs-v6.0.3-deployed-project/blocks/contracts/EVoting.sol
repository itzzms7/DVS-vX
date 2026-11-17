// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title EVoting
/// @notice DVS local-election contract based on the original Itzms/DVS voting pattern.
/// @dev Candidate and vote totals are on-chain. Voter identity remains in DVS/PostgreSQL;
///      only its keccak256 hash is submitted to this contract.
contract EVoting {
    address public owner;

    struct Candidate {
        int256 id;
        string name;
        string symbol;
        uint256 voteCount;
        bool exists;
    }

    mapping(int256 => Candidate) public candidates;
    mapping(bytes32 => bool) public hasVoted;

    uint256 public totalVotes;
    uint256 public candidateCount;
    bool public candidatesLocked;
    bool public votingWindowLocked;
    bool public electionOpen;
    uint256 public votingStartTime;
    uint256 public votingEndTime;

    event CandidateAdded(int256 indexed candidateId, string name, string symbol);
    event CandidateRosterLocked(uint256 candidateCount);
    event VotingWindowConfigured(uint256 startsAt, uint256 endsAt);
    event ElectionOpened(uint256 startsAt, uint256 endsAt);
    event ElectionClosed(uint256 closedAt);
    event VoteCast(int256 indexed candidateId, bytes32 indexed voterHash, uint256 totalVotes);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only contract owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function addCandidate(int256 _id, string memory _name, string memory _symbol) public onlyOwner {
        require(!candidatesLocked, "Candidate roster is locked");
        require(_id > 0, "Invalid candidate ID");
        require(!candidates[_id].exists, "Candidate ID already exists");
        require(bytes(_name).length > 0, "Candidate name required");
        require(bytes(_symbol).length > 0, "Candidate symbol required");
        candidates[_id] = Candidate(_id, _name, _symbol, 0, true);
        candidateCount += 1;
        emit CandidateAdded(_id, _name, _symbol);
    }

    function setVotingWindow(uint64 _start, uint64 _end) external onlyOwner {
        require(!votingWindowLocked, "Voting window is locked");
        require(!electionOpen, "Election already open");
        require(_start > 0 && _end > _start, "Invalid voting window");
        votingStartTime = _start;
        votingEndTime = _end;
        emit VotingWindowConfigured(_start, _end);
    }

    function lockVotingWindow() external onlyOwner {
        require(!votingWindowLocked, "Voting window already locked");
        require(votingStartTime > 0 && votingEndTime > votingStartTime, "Configure voting window first");
        votingWindowLocked = true;
    }

    function lockCandidates() external onlyOwner {
        require(!candidatesLocked, "Candidate roster already locked");
        require(candidateCount > 0, "Add candidates first");
        candidatesLocked = true;
        emit CandidateRosterLocked(candidateCount);
    }

    function openElection() external onlyOwner {
        require(!electionOpen, "Election already open");
        require(candidatesLocked && votingWindowLocked, "Election setup incomplete");
        require(block.timestamp >= votingStartTime, "Election has not reached start time");
        require(block.timestamp < votingEndTime, "Election window has ended");
        electionOpen = true;
        emit ElectionOpened(votingStartTime, votingEndTime);
    }

    function closeElection() external onlyOwner {
        require(electionOpen, "Election is not open");
        electionOpen = false;
        emit ElectionClosed(block.timestamp);
    }

    function markVote(int256 _candidateId, bytes32 _voterHash) public {
        require(electionOpen, "Election is not open");
        require(block.timestamp >= votingStartTime && block.timestamp < votingEndTime, "Outside voting window");
        require(candidatesLocked && votingWindowLocked, "Election setup incomplete");
        require(candidates[_candidateId].exists, "Invalid candidate ID");
        require(_voterHash != bytes32(0), "Invalid voter hash");
        require(!hasVoted[_voterHash], "This user has already cast a vote");

        hasVoted[_voterHash] = true;
        candidates[_candidateId].voteCount += 1;
        totalVotes += 1;
        emit VoteCast(_candidateId, _voterHash, totalVotes);
    }

    function getCount(int256 _candidateId) public view returns (uint256) {
        require(candidates[_candidateId].exists, "Invalid candidate ID");
        return candidates[_candidateId].voteCount;
    }
}
