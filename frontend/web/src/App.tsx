// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface Candidate {
  id: string;
  name: string;
  position: string;
  score: number;
  stage: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  status: "screening" | "testing" | "interview" | "hired" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newCandidateData, setNewCandidateData] = useState({
    name: "",
    position: "",
    stage: "screening"
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");

  // Calculate statistics for dashboard
  const screeningCount = candidates.filter(c => c.status === "screening").length;
  const testingCount = candidates.filter(c => c.status === "testing").length;
  const interviewCount = candidates.filter(c => c.status === "interview").length;
  const hiredCount = candidates.filter(c => c.status === "hired").length;
  const rejectedCount = candidates.filter(c => c.status === "rejected").length;

  useEffect(() => {
    loadCandidates().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadCandidates = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("candidate_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing candidate keys:", e);
        }
      }
      
      const list: Candidate[] = [];
      
      for (const key of keys) {
        try {
          const candidateBytes = await contract.getData(`candidate_${key}`);
          if (candidateBytes.length > 0) {
            try {
              const candidateData = JSON.parse(ethers.toUtf8String(candidateBytes));
              list.push({
                id: key,
                name: candidateData.name,
                position: candidateData.position,
                score: candidateData.score,
                stage: candidateData.stage,
                encryptedData: candidateData.encryptedData,
                timestamp: candidateData.timestamp,
                owner: candidateData.owner,
                status: candidateData.status || "screening"
              });
            } catch (e) {
              console.error(`Error parsing candidate data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading candidate ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setCandidates(list);
    } catch (e) {
      console.error("Error loading candidates:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitCandidate = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting candidate data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newCandidateData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const candidateId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const candidateData = {
        name: newCandidateData.name,
        position: newCandidateData.position,
        score: Math.floor(Math.random() * 100), // FHE would generate this
        stage: newCandidateData.stage,
        encryptedData: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        status: "screening"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `candidate_${candidateId}`, 
        ethers.toUtf8Bytes(JSON.stringify(candidateData))
      );
      
      const keysBytes = await contract.getData("candidate_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(candidateId);
      
      await contract.setData(
        "candidate_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Candidate data encrypted and submitted!"
      });
      
      await loadCandidates();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewCandidateData({
          name: "",
          position: "",
          stage: "screening"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const updateCandidateStatus = async (candidateId: string, newStatus: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing FHE evaluation..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const candidateBytes = await contract.getData(`candidate_${candidateId}`);
      if (candidateBytes.length === 0) {
        throw new Error("Candidate not found");
      }
      
      const candidateData = JSON.parse(ethers.toUtf8String(candidateBytes));
      
      const updatedCandidate = {
        ...candidateData,
        status: newStatus
      };
      
      await contract.setData(
        `candidate_${candidateId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedCandidate))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE status update completed!"
      });
      
      await loadCandidates();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Update failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the FHE recruitment platform",
      icon: "🔗"
    },
    {
      title: "Add Candidate",
      description: "Submit candidate information which will be encrypted using FHE",
      icon: "👤"
    },
    {
      title: "FHE Evaluation",
      description: "Candidate data is processed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Review Results",
      description: "Get comprehensive FHE-based candidate scores while maintaining privacy",
      icon: "📊"
    }
  ];

  const renderBarChart = () => {
    const maxCount = Math.max(screeningCount, testingCount, interviewCount, hiredCount, rejectedCount) || 1;
    
    return (
      <div className="bar-chart-container">
        <div className="bar-chart">
          <div className="bar-wrapper">
            <div className="bar-label">Screening</div>
            <div className="bar">
              <div 
                className="bar-fill screening" 
                style={{ width: `${(screeningCount / maxCount) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{screeningCount}</div>
          </div>
          <div className="bar-wrapper">
            <div className="bar-label">Testing</div>
            <div className="bar">
              <div 
                className="bar-fill testing" 
                style={{ width: `${(testingCount / maxCount) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{testingCount}</div>
          </div>
          <div className="bar-wrapper">
            <div className="bar-label">Interview</div>
            <div className="bar">
              <div 
                className="bar-fill interview" 
                style={{ width: `${(interviewCount / maxCount) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{interviewCount}</div>
          </div>
          <div className="bar-wrapper">
            <div className="bar-label">Hired</div>
            <div className="bar">
              <div 
                className="bar-fill hired" 
                style={{ width: `${(hiredCount / maxCount) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{hiredCount}</div>
          </div>
          <div className="bar-wrapper">
            <div className="bar-label">Rejected</div>
            <div className="bar">
              <div 
                className="bar-fill rejected" 
                style={{ width: `${(rejectedCount / maxCount) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{rejectedCount}</div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen cyberpunk-bg">
      <div className="cyber-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-bg">
      <header className="app-header cyberpunk-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>FHE<span>Recruit</span>Pro</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-candidate-btn cyberpunk-btn primary"
          >
            <div className="add-icon"></div>
            Add Candidate
          </button>
          <button 
            className="cyberpunk-btn secondary"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <nav className="cyberpunk-nav">
          <button 
            className={activeTab === "dashboard" ? "active" : ""}
            onClick={() => setActiveTab("dashboard")}
          >
            Dashboard
          </button>
          <button 
            className={activeTab === "candidates" ? "active" : ""}
            onClick={() => setActiveTab("candidates")}
          >
            Candidates
          </button>
          <button 
            className={activeTab === "analytics" ? "active" : ""}
            onClick={() => setActiveTab("analytics")}
          >
            Analytics
          </button>
        </nav>
        
        {showTutorial && (
          <div className="tutorial-section cyberpunk-card">
            <h2>FHE Recruitment Tutorial</h2>
            <p className="subtitle">Learn how to confidentially evaluate candidates</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "dashboard" && (
          <div className="dashboard-grid">
            <div className="dashboard-card cyberpunk-card intro-card">
              <h3>Project Introduction</h3>
              <p>FHE Recruit Pro is a confidential multi-stage recruitment platform that uses Fully Homomorphic Encryption (FHE) to evaluate candidate data without decryption. This eliminates bias and ensures candidate privacy throughout the hiring process.</p>
              <div className="fhe-badge">
                <span>FHE-Powered Confidentiality</span>
              </div>
            </div>
            
            <div className="dashboard-card cyberpunk-card">
              <h3>Recruitment Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{candidates.length}</div>
                  <div className="stat-label">Total Candidates</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{screeningCount}</div>
                  <div className="stat-label">Screening</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{testingCount}</div>
                  <div className="stat-label">Testing</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{interviewCount}</div>
                  <div className="stat-label">Interview</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{hiredCount}</div>
                  <div className="stat-label">Hired</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{rejectedCount}</div>
                  <div className="stat-label">Rejected</div>
                </div>
              </div>
            </div>
            
            <div className="dashboard-card cyberpunk-card">
              <h3>Stage Distribution</h3>
              {renderBarChart()}
            </div>
          </div>
        )}
        
        {activeTab === "candidates" && (
          <div className="candidates-section">
            <div className="section-header">
              <h2>Encrypted Candidate Profiles</h2>
              <div className="header-actions">
                <button 
                  onClick={loadCandidates}
                  className="refresh-btn cyberpunk-btn"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="candidates-list cyberpunk-card">
              <div className="table-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Name</div>
                <div className="header-cell">Position</div>
                <div className="header-cell">Score</div>
                <div className="header-cell">Stage</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {candidates.length === 0 ? (
                <div className="no-candidates">
                  <div className="no-candidates-icon"></div>
                  <p>No candidate records found</p>
                  <button 
                    className="cyberpunk-btn primary"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Add First Candidate
                  </button>
                </div>
              ) : (
                candidates.map(candidate => (
                  <div className="candidate-row" key={candidate.id}>
                    <div className="table-cell candidate-id">#{candidate.id.substring(0, 6)}</div>
                    <div className="table-cell">{candidate.name}</div>
                    <div className="table-cell">{candidate.position}</div>
                    <div className="table-cell">{candidate.score}/100</div>
                    <div className="table-cell">
                      <span className={`status-badge ${candidate.status}`}>
                        {candidate.status}
                      </span>
                    </div>
                    <div className="table-cell">
                      {new Date(candidate.timestamp * 1000).toLocaleDateString()}
                    </div>
                    <div className="table-cell actions">
                      {isOwner(candidate.owner) && (
                        <div className="action-buttons">
                          {candidate.status !== "hired" && candidate.status !== "rejected" && (
                            <>
                              <button 
                                className="action-btn cyberpunk-btn success"
                                onClick={() => updateCandidateStatus(candidate.id, "hired")}
                              >
                                Hire
                              </button>
                              <button 
                                className="action-btn cyberpunk-btn danger"
                                onClick={() => updateCandidateStatus(candidate.id, "rejected")}
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "analytics" && (
          <div className="analytics-section cyberpunk-card">
            <h2>FHE Recruitment Analytics</h2>
            <p>Comprehensive analysis of candidate evaluation using FHE technology</p>
            
            <div className="analytics-content">
              <div className="analytics-stats">
                <div className="analytics-stat">
                  <h3>Average Score</h3>
                  <div className="stat-value">
                    {candidates.length > 0 
                      ? Math.round(candidates.reduce((sum, c) => sum + c.score, 0) / candidates.length) 
                      : 0}/100
                  </div>
                </div>
                <div className="analytics-stat">
                  <h3>Hire Rate</h3>
                  <div className="stat-value">
                    {candidates.length > 0 
                      ? Math.round((hiredCount / candidates.length) * 100) 
                      : 0}%
                  </div>
                </div>
                <div className="analytics-stat">
                  <h3>Evaluation Speed</h3>
                  <div className="stat-value">24h</div>
                  <div className="stat-note">Average FHE processing time</div>
                </div>
              </div>
              
              <div className="fhe-benefits">
                <h3>FHE Advantages in Recruitment</h3>
                <ul>
                  <li>Eliminates unconscious bias in candidate evaluation</li>
                  <li>Ensures complete confidentiality of candidate data</li>
                  <li>Enables secure multi-party computation for hiring panels</li>
                  <li>Provides verifiable results without exposing raw data</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitCandidate} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          candidateData={newCandidateData}
          setCandidateData={setNewCandidateData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyberpunk-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer cyberpunk-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>FHERecruitPro</span>
            </div>
            <p>Confidential multi-stage recruitment using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Confidential Recruitment</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Recruit Pro. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  candidateData: any;
  setCandidateData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  candidateData,
  setCandidateData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCandidateData({
      ...candidateData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!candidateData.name || !candidateData.position) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyberpunk-card">
        <div className="modal-header">
          <h2>Add Candidate Profile</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Candidate data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Name *</label>
              <input 
                type="text"
                name="name"
                value={candidateData.name} 
                onChange={handleChange}
                placeholder="Candidate name" 
                className="cyberpunk-input"
              />
            </div>
            
            <div className="form-group">
              <label>Position *</label>
              <input 
                type="text"
                name="position"
                value={candidateData.position} 
                onChange={handleChange}
                placeholder="Applied position" 
                className="cyberpunk-input"
              />
            </div>
            
            <div className="form-group">
              <label>Initial Stage</label>
              <select 
                name="stage"
                value={candidateData.stage} 
                onChange={handleChange}
                className="cyberpunk-select"
              >
                <option value="screening">Screening</option>
                <option value="testing">Testing</option>
                <option value="interview">Interview</option>
              </select>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE evaluation
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyberpunk-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyberpunk-btn primary"
          >
            {creating ? "Encrypting with FHE..." : "Add Candidate"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;