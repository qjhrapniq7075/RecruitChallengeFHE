// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract RecruitChallengeFHE is SepoliaConfig {
    struct CandidateStage {
        euint32 encryptedScore;
        euint32 encryptedWeight;
        uint256 timestamp;
    }

    struct CandidateProfile {
        CandidateStage onlineTest;
        CandidateStage projectWork;
        CandidateStage interview;
        euint32 encryptedTotalScore;
        bool isRevealed;
    }

    struct DecryptedResult {
        uint32 onlineTestScore;
        uint32 projectWorkScore;
        uint32 interviewScore;
        uint32 totalScore;
        bool isRevealed;
    }

    mapping(uint256 => CandidateProfile) public candidateProfiles;
    mapping(uint256 => DecryptedResult) public decryptedResults;
    mapping(address => bool) public recruiters;
    
    uint256 public candidateCount;
    address public admin;
    
    event CandidateRegistered(uint256 indexed candidateId);
    event StageCompleted(uint256 indexed candidateId, string stage);
    event FinalScoreCalculated(uint256 indexed candidateId);
    event ResultRevealed(uint256 indexed candidateId);

    constructor() {
        admin = msg.sender;
        recruiters[admin] = true;
    }

    modifier onlyRecruiter() {
        require(recruiters[msg.sender], "Not authorized recruiter");
        _;
    }

    function addRecruiter(address recruiter) public {
        require(msg.sender == admin, "Admin only");
        recruiters[recruiter] = true;
    }

    function registerCandidate() public returns (uint256) {
        candidateCount++;
        candidateProfiles[candidateCount] = CandidateProfile({
            onlineTest: CandidateStage(FHE.asEuint32(0), FHE.asEuint32(0), 0),
            projectWork: CandidateStage(FHE.asEuint32(0), FHE.asEuint32(0), 0),
            interview: CandidateStage(FHE.asEuint32(0), FHE.asEuint32(0), 0),
            encryptedTotalScore: FHE.asEuint32(0),
            isRevealed: false
        });
        
        emit CandidateRegistered(candidateCount);
        return candidateCount;
    }

    function submitOnlineTestScore(
        uint256 candidateId,
        euint32 score,
        euint32 weight
    ) public onlyRecruiter {
        candidateProfiles[candidateId].onlineTest = CandidateStage({
            encryptedScore: score,
            encryptedWeight: weight,
            timestamp: block.timestamp
        });
        emit StageCompleted(candidateId, "onlineTest");
    }

    function submitProjectWorkScore(
        uint256 candidateId,
        euint32 score,
        euint32 weight
    ) public onlyRecruiter {
        candidateProfiles[candidateId].projectWork = CandidateStage({
            encryptedScore: score,
            encryptedWeight: weight,
            timestamp: block.timestamp
        });
        emit StageCompleted(candidateId, "projectWork");
    }

    function submitInterviewScore(
        uint256 candidateId,
        euint32 score,
        euint32 weight
    ) public onlyRecruiter {
        candidateProfiles[candidateId].interview = CandidateStage({
            encryptedScore: score,
            encryptedWeight: weight,
            timestamp: block.timestamp
        });
        emit StageCompleted(candidateId, "interview");
    }

    function calculateFinalScore(uint256 candidateId) public onlyRecruiter {
        CandidateProfile storage profile = candidateProfiles[candidateId];
        
        euint32 weightedTest = FHE.mul(
            profile.onlineTest.encryptedScore,
            profile.onlineTest.encryptedWeight
        );
        
        euint32 weightedProject = FHE.mul(
            profile.projectWork.encryptedScore,
            profile.projectWork.encryptedWeight
        );
        
        euint32 weightedInterview = FHE.mul(
            profile.interview.encryptedScore,
            profile.interview.encryptedWeight
        );
        
        profile.encryptedTotalScore = FHE.add(
            FHE.add(weightedTest, weightedProject),
            weightedInterview
        );
        
        emit FinalScoreCalculated(candidateId);
    }

    function requestScoreDecryption(uint256 candidateId) public onlyRecruiter {
        require(!candidateProfiles[candidateId].isRevealed, "Already revealed");
        
        CandidateProfile storage profile = candidateProfiles[candidateId];
        bytes32[] memory ciphertexts = new bytes32[](4);
        
        ciphertexts[0] = FHE.toBytes32(profile.onlineTest.encryptedScore);
        ciphertexts[1] = FHE.toBytes32(profile.projectWork.encryptedScore);
        ciphertexts[2] = FHE.toBytes32(profile.interview.encryptedScore);
        ciphertexts[3] = FHE.toBytes32(profile.encryptedTotalScore);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptScores.selector);
    }

    function decryptScores(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public onlyRecruiter {
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        uint256 candidateId = candidateCount; // Simplified - would map requestId
        
        decryptedResults[candidateId] = DecryptedResult({
            onlineTestScore: results[0],
            projectWorkScore: results[1],
            interviewScore: results[2],
            totalScore: results[3],
            isRevealed: true
        });
        
        candidateProfiles[candidateId].isRevealed = true;
        emit ResultRevealed(candidateId);
    }

    function compareCandidates(
        uint256 candidateId1,
        uint256 candidateId2
    ) public view onlyRecruiter returns (ebool) {
        return FHE.gt(
            candidateProfiles[candidateId1].encryptedTotalScore,
            candidateProfiles[candidateId2].encryptedTotalScore
        );
    }

    function getCandidateCount() public view returns (uint256) {
        return candidateCount;
    }

    function getDecryptedResult(uint256 candidateId) public view returns (
        uint32 onlineTestScore,
        uint32 projectWorkScore,
        uint32 interviewScore,
        uint32 totalScore,
        bool isRevealed
    ) {
        DecryptedResult storage result = decryptedResults[candidateId];
        return (
            result.onlineTestScore,
            result.projectWorkScore,
            result.interviewScore,
            result.totalScore,
            result.isRevealed
        );
    }
}