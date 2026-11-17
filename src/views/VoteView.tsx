import React, { useState, useEffect } from 'react';
import { BaseLayout } from '../components/BaseLayout';
import {
  AuthUser,
  CandidateRosterItem,
  PublicElectionDetail,
  VerifiedReceipt,
  VoterRecord,
} from '../types/dvs';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

interface VoteViewProps {
  user: AuthUser | null;
  election: PublicElectionDetail | null;
  publicElections: PublicElectionDetail[];
  sessionVoter: VoterRecord | null;
  voterIsEligible: boolean | null;
  voterHasVoted: boolean;
  verifiedReceipt: VerifiedReceipt | null;
  preselectedCandidateId?: number | null;
  data?: string;
  onSwitchElection: (electionId: number) => void;
  onAuthenticateVoter: (
    voterId: string,
    electionId: number
  ) => Promise<{
    success: boolean;
    has_voted?: boolean;
    voter_name?: string;
    voter_id_masked?: string;
    election_title?: string;
    error?: string;
  }>;
  onSubmitVote: (
    electionId: number,
    candidateId: number
  ) => Promise<{
    success: boolean;
    receipt_reference?: string;
    tx_hash?: string;
    block_number?: number;
    confirmed_at?: string;
    election_title?: string;
    error?: string;
  }>;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

const EXPECTED_CHAIN_ID = '0x7a69';
const EXPECTED_CHAIN_DECIMAL = 31337;

function maskAadhar(aadhar: string): string {
  const digits = aadhar.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `••••••••${digits.slice(-4)}`;
}

function formatScheduleDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export const VoteView: React.FC<VoteViewProps> = ({
  user,
  election,
  publicElections,
  sessionVoter,
  voterIsEligible,
  voterHasVoted,
  verifiedReceipt,
  preselectedCandidateId = null,
  data,
  onSwitchElection,
  onAuthenticateVoter,
  onSubmitVote,
  onNavigate,
  onLogout,
}) => {
  const votingPermitted = Boolean(election && election.status === 'ACTIVE');
  const candidates: CandidateRosterItem[] = votingPermitted && election ? election.candidate_roster : [];

  const [selectedElectionDropdown, setSelectedElectionDropdown] = useState<number>(
    election ? election.election_id : 0
  );
  const [voterIdInput, setVoterIdInput] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [voterAuthenticated, setVoterAuthenticated] = useState(Boolean(sessionVoter));
  const [authVoterName, setAuthVoterName] = useState(sessionVoter ? sessionVoter.name : '');
  const [authVoterMasked, setAuthVoterMasked] = useState(
    sessionVoter ? maskAadhar(sessionVoter.aadhar_number) : ''
  );
  const [voterAuthFeedback, setVoterAuthFeedback] = useState<{
    message: string;
    type: 'info' | 'success' | 'error';
  }>({ message: '', type: 'info' });

  const [walletConnected, setWalletConnected] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState('');
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletConnectVoterName, setWalletConnectVoterName] = useState('');
  const [walletConnectFeedback, setWalletConnectFeedback] = useState<{
    message: string;
    type: 'info' | 'success' | 'error';
  }>({ message: '', type: 'info' });
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [metamaskNotice, setMetamaskNotice] = useState<{
    message: string;
    type: 'info' | 'success' | 'error';
  }>({ message: 'Authenticate to continue.', type: 'info' });

  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(
    preselectedCandidateId
  );
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [submittingVote, setSubmittingVote] = useState(false);
  const [txProgressVisible, setTxProgressVisible] = useState(false);
  const [txStageTitle, setTxStageTitle] = useState('Preparing your ballot.');
  const [voteFeedback, setVoteFeedback] = useState<{
    message: string;
    type: 'info' | 'success' | 'error';
  }>({ message: '', type: 'info' });

  useEffect(() => {
    if (election) {
      setSelectedElectionDropdown(election.election_id);
    }
  }, [election]);

  useEffect(() => {
    setVoterAuthenticated(Boolean(sessionVoter));
    if (sessionVoter) {
      setAuthVoterName(sessionVoter.name);
      setAuthVoterMasked(maskAadhar(sessionVoter.aadhar_number));
    }
  }, [sessionVoter]);

  const ensureNetwork = async () => {
    if (!window.ethereum) {
      throw new Error('MetaMask is not available in this browser.');
    }
    const chainId = (await window.ethereum.request({ method: 'eth_chainId' })) as string;
    if (chainId.toLowerCase() === EXPECTED_CHAIN_ID) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: EXPECTED_CHAIN_ID }],
      });
    } catch (error: unknown) {
      const errObj = error as { code?: number };
      if (errObj && errObj.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: EXPECTED_CHAIN_ID,
              chainName: 'DVS Hardhat Local',
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['http://127.0.0.1:8545'],
            },
          ],
        });
      } else {
        throw error;
      }
    }
    const confirmedChainId = (await window.ethereum.request({ method: 'eth_chainId' })) as string;
    if (confirmedChainId.toLowerCase() !== EXPECTED_CHAIN_ID) {
      throw new Error('Switch MetaMask to DVS Hardhat Local (Chain ID 31337).');
    }
  };

  const handleConnectWallet = async () => {
    setConnectingWallet(true);
    setWalletConnectFeedback({ message: '', type: 'info' });
    try {
      if (!window.ethereum) {
        throw new Error('Install or enable MetaMask to connect your wallet.');
      }
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];
      if (!accounts || !accounts.length) {
        throw new Error('No wallet account was selected.');
      }
      await ensureNetwork();
      setConnectedAddress(accounts[0]);
      setWalletConnected(true);
      setMetamaskNotice({
        message: 'Wallet connected. You may now select a candidate.',
        type: 'success',
      });
      setWalletModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Wallet connection failed.';
      setWalletConnectFeedback({ message: msg, type: 'error' });
    } finally {
      setConnectingWallet(false);
    }
  };

  const handleAuthenticateClick = async () => {
    const cleanId = voterIdInput.trim();
    if (!/^\d{12}$/.test(cleanId)) {
      setVoterAuthFeedback({
        message: 'Enter a valid 12-digit Voter ID.',
        type: 'error',
      });
      const inp = document.getElementById('input-aadhar');
      if (inp) inp.focus();
      return;
    }
    if (!election) return;

    setCheckingAuth(true);
    try {
      const result = await onAuthenticateVoter(cleanId, election.election_id);
      if (!result.success) {
        throw new Error(result.error || 'Authentication failed.');
      }
      setVoterAuthenticated(true);
      if (result.voter_name) setAuthVoterName(result.voter_name);
      if (result.voter_id_masked) setAuthVoterMasked(result.voter_id_masked);
      setVoterAuthFeedback({
        message: result.has_voted ? 'Your ballot is already recorded.' : 'Eligibility confirmed.',
        type: 'success',
      });
      if (!result.has_voted) {
        setWalletConnectVoterName(`Eligibility confirmed for ${result.voter_name || 'voter'}.`);
        setWalletModalOpen(true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not authenticate voter.';
      setVoterAuthFeedback({ message: msg, type: 'error' });
    } finally {
      setCheckingAuth(false);
    }
  };

  const selectedCandidate = candidates.find((c) => c.candidate_id === selectedCandidateId) || null;

  const handleOpenReviewModal = () => {
    if (!selectedCandidate) {
      setVoteFeedback({
        message: 'Select a candidate before continuing.',
        type: 'error',
      });
      return;
    }
    setReviewModalOpen(true);
  };

  const handleConfirmSubmitVote = async () => {
    if (submittingVote || !election) return;
    if (!voterAuthenticated) {
      setVoteFeedback({
        message: 'Authenticate before submitting your ballot.',
        type: 'error',
      });
      return;
    }
    if (!walletConnected) {
      setWalletConnectVoterName('Eligibility confirmed for your voter account.');
      setWalletModalOpen(true);
      return;
    }
    if (!selectedCandidate) {
      setVoteFeedback({
        message: 'Select a candidate before submitting.',
        type: 'error',
      });
      return;
    }

    setSubmittingVote(true);
    setReviewModalOpen(false);
    setTxProgressVisible(true);
    setTxStageTitle('Submitting your ballot. Please do not close this page.');

    try {
      const res = await onSubmitVote(election.election_id, selectedCandidate.candidate_id);
      if (!res.success) {
        throw new Error(res.error || 'Vote submission failed.');
      }
      setVoteFeedback({
        message: `Vote recorded. Transaction confirmed in block ${res.block_number}.`,
        type: 'success',
      });
      setTxStageTitle('Vote confirmed');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Vote submission failed.';
      setVoteFeedback({ message: msg, type: 'error' });
    } finally {
      setSubmittingVote(false);
    }
  };

  const pageTitle = election
    ? `${election.title} — Voter Ballot`
    : 'Voter Ballot — DVS Civic Elections';

  const voterEligibilityLabel = voterHasVoted
    ? 'Ballot Recorded'
    : sessionVoter && voterIsEligible
    ? 'Eligible Voter'
    : sessionVoter && voterIsEligible === false
    ? 'Not Enrolled in Election'
    : 'Verify Identity to Check';

  const ballotVisible = walletConnected && voterAuthenticated;

  return (
    <BaseLayout
      title={pageTitle}
      user={user}
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      <div
        className="voter-journey-shell"
        id="voter-portal-root"
        data-election-id={election ? election.election_id : 0}
        data-election-title={election ? election.title : 'Official Civic Election'}
        data-election-status={election ? election.status : 'UNAVAILABLE'}
        data-voting-open={votingPermitted ? 'true' : 'false'}
        data-has-voted={voterHasVoted ? 'true' : 'false'}
        data-session-authenticated={voterAuthenticated ? 'true' : 'false'}
        data-preselected-candidate={selectedCandidate ? selectedCandidate.candidate_id : ''}
      >
        {data && (
          <div className="feedback-panel feedback-info is-visible" role="status">
            {data}
          </div>
        )}

        {election ? (
          <section
            className="spotlight-banner voter-entry-card"
            id="voter-election-entry"
            aria-labelledby="election-entry-heading"
          >
            <div className="spotlight-header">
              <div className="wallet-info">
                {votingPermitted ? (
                  <strong className="status-badge status-active">{election.status_label}</strong>
                ) : election.status === 'CLOSED' || election.status === 'FINALIZED' ? (
                  <strong className="status-badge status-closed">{election.status_label}</strong>
                ) : (
                  <strong className="status-badge status-pending">{election.status_label}</strong>
                )}

                <div id="voter-eligibility-badge">
                  {voterHasVoted ? (
                    <strong className="status-badge status-authenticated">Ballot Recorded</strong>
                  ) : sessionVoter && voterIsEligible ? (
                    <strong className="status-badge status-active">Eligible</strong>
                  ) : sessionVoter && voterIsEligible === false ? (
                    <strong className="status-badge status-rejected">Not Eligible</strong>
                  ) : (
                    <strong className="status-badge status-pending">{voterEligibilityLabel}</strong>
                  )}
                </div>
              </div>

              {publicElections.length > 1 && (
                <form
                  method="get"
                  action="/Vote.html"
                  className="admin-selector-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onSwitchElection(selectedElectionDropdown);
                  }}
                >
                  <label htmlFor="voter-election-select" className="sr-only">
                    Switch Election
                  </label>
                  <select
                    id="voter-election-select"
                    name="election_id"
                    className="admin-selector-select"
                    value={selectedElectionDropdown}
                    onChange={(e) => setSelectedElectionDropdown(Number(e.target.value))}
                  >
                    {publicElections.map((item) => (
                      <option key={item.election_id} value={item.election_id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn-secondary btn-sm">
                    Switch
                  </button>
                </form>
              )}
            </div>

            <h1 id="election-entry-heading" className="voter-entry-title">
              {election.title}
            </h1>
            {election.description && <p className="voter-entry-desc">{election.description}</p>}

            {(election.start_datetime || election.end_datetime) && (
              <dl className="voter-entry-schedule">
                {election.start_datetime && (
                  <div className="meta-item">
                    <dt className="meta-term">Opens</dt>
                    <dd className="meta-detail tabular-nums">
                      {formatScheduleDate(election.start_datetime)}
                    </dd>
                  </div>
                )}
                {election.end_datetime && (
                  <div className="meta-item">
                    <dt className="meta-term">Closes</dt>
                    <dd className="meta-detail tabular-nums">
                      {formatScheduleDate(election.end_datetime)}
                    </dd>
                  </div>
                )}
              </dl>
            )}

            <div className="voter-entry-actions">
              {voterHasVoted ? (
                <a href="#ballot-receipt-panel" className="btn-primary btn-inline">
                  View Receipt
                </a>
              ) : votingPermitted ? (
                <span className="text-muted">Authenticate below to continue to the ballot.</span>
              ) : (
                <a
                  href={`/ViewCount?election_id=${election.election_id}`}
                  className="btn-secondary btn-inline"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate(`/elections/${election.election_id}/`);
                  }}
                >
                  View Results
                </a>
              )}
            </div>
          </section>
        ) : (
          <section className="state-panel">
            <h2>No Active Election</h2>
            <p>No elections are currently open for voting.</p>
            <a
              href="/elections/"
              className="btn-primary btn-inline"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/elections/');
              }}
            >
              Browse Elections
            </a>
          </section>
        )}

        <section
          className={`card voter-receipt-card ${!verifiedReceipt ? 'is-hidden' : ''}`}
          id="ballot-receipt-panel"
          aria-labelledby="receipt-heading"
        >
          <div className="election-card-top">
            <strong className="status-badge status-authenticated">Vote Confirmed</strong>
            <small className="tabular-nums" id="receipt-timestamp-display">
              {verifiedReceipt && verifiedReceipt.confirmed_at
                ? formatScheduleDate(verifiedReceipt.confirmed_at)
                : ''}
            </small>
          </div>
          <h2 id="receipt-heading">Vote successfully recorded.</h2>

          <dl className="voter-receipt-summary">
            <div className="meta-item">
              <dt className="meta-term">Election</dt>
              <dd className="meta-detail" id="receipt-election-title">
                {election ? election.title : ''}
              </dd>
            </div>
            <div className="meta-item">
              <dt className="meta-term">Confirmation Reference</dt>
              <dd className="meta-detail">
                <code id="receipt-reference-code">
                  {verifiedReceipt ? verifiedReceipt.receipt_reference : ''}
                </code>
              </dd>
            </div>
          </dl>
        </section>

        <div className="election-grid" id="voter-verification-grid">
          <article
            className="card voter-step-card"
            id="step-identity-card"
            aria-labelledby="step-identity-heading"
          >
            <div className="election-card-top">
              <h2 id="step-identity-heading" className="voter-card-heading">
                Voter Authentication
              </h2>
              <strong
                id="voter-auth-status"
                className={`status-badge ${
                  voterAuthenticated ? 'status-authenticated' : 'status-disconnected'
                }`}
              >
                {voterAuthenticated ? 'Authenticated' : 'Required'}
              </strong>
            </div>
            <p className="voter-card-instruction" id="voter-session-summary">
              {voterAuthenticated
                ? `Signed in as ${authVoterName} (${authVoterMasked}).`
                : 'Enter your 12-digit Voter ID to check your eligibility for this election.'}
            </p>
            <div className="form-group">
              <label htmlFor="input-aadhar">12-Digit Voter ID</label>
              <input
                type="tel"
                id="input-aadhar"
                name="voter_id"
                pattern="[0-9]{12}"
                maxLength={12}
                className="inp tabular-nums"
                placeholder="12-digit Voter ID"
                autoComplete="off"
                inputMode="numeric"
                value={voterIdInput}
                onChange={(e) => setVoterIdInput(e.target.value)}
                required
              />
            </div>
            <div className="wallet-actions">
              <button
                type="button"
                id="btn-voter-authenticate"
                className="btn-primary btn-wallet"
                disabled={checkingAuth}
                onClick={handleAuthenticateClick}
              >
                {checkingAuth ? 'Checking…' : 'Authenticate'}
              </button>
            </div>
            <p
              id="voter-auth-feedback"
              className={`feedback-panel${voterAuthFeedback.message ? ' is-visible' : ''}${
                voterAuthFeedback.type ? ` feedback-${voterAuthFeedback.type}` : ''
              }`}
              role="status"
              aria-live="polite"
            >
              {voterAuthFeedback.message}
            </p>
          </article>

          <article
            className="card voter-step-card"
            id="step-wallet-card"
            aria-labelledby="step-wallet-heading"
          >
            <div className="election-card-top">
              <h2 id="step-wallet-heading" className="voter-card-heading">
                Wallet
              </h2>
              <strong
                id="wallet-status-badge"
                className={`status-badge ${
                  walletConnected ? 'status-authenticated' : 'status-disconnected'
                }`}
              >
                {walletConnected ? 'Connected' : 'Not Connected'}
              </strong>
            </div>
            <div className="wallet-bar">
              <div className="wallet-info">
                <code id="wallet-address-display">
                  {connectedAddress || 'No wallet connected'}
                </code>
                <small id="wallet-network-badge" className="network-badge">
                  {walletConnected ? `DVS Hardhat · ${EXPECTED_CHAIN_DECIMAL}` : ''}
                </small>
              </div>
            </div>
            <p
              id="metamask-notice"
              className={`feedback-panel feedback-${metamaskNotice.type}${
                metamaskNotice.message ? ' is-visible' : ''
              }`}
              role="status"
              aria-live="polite"
            >
              {metamaskNotice.message}
            </p>
          </article>
        </div>

        <div
          className={`modal-backdrop${walletModalOpen ? ' is-open' : ''}`}
          id="modal-wallet-connect"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-wallet-connect-title"
          aria-hidden={walletModalOpen ? 'false' : 'true'}
        >
          <div className="modal-dialog">
            <div className="modal-header">
              <h2 id="modal-wallet-connect-title">Connect Your Wallet</h2>
            </div>
            <div className="modal-body">
              <p id="wallet-connect-voter-name" className="voter-card-instruction">
                {walletConnectVoterName || 'Voter eligibility confirmed.'}
              </p>
              <p className="voter-card-instruction">
                Connect MetaMask to continue to the ballot.
              </p>
              <p
                id="wallet-connect-feedback"
                className={`feedback-panel${walletConnectFeedback.message ? ' is-visible' : ''}${
                  walletConnectFeedback.type ? ` feedback-${walletConnectFeedback.type}` : ''
                }`}
                role="status"
                aria-live="polite"
              >
                {walletConnectFeedback.message}
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary btn-inline"
                id="btn-cancel-wallet-connect"
                onClick={() => setWalletModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary btn-inline"
                id="btn-modal-connect-wallet"
                disabled={connectingWallet}
                onClick={handleConnectWallet}
              >
                Connect Wallet
              </button>
            </div>
          </div>
        </div>

        {election && (
          <section
            className={`card voter-ballot-card ${!ballotVisible ? 'is-hidden' : ''}`}
            id="step-candidate-section"
            aria-labelledby="candidate-section-heading"
          >
            <div className="section-header">
              <h2 id="candidate-section-heading" className="voter-card-heading">
                Select Candidate
              </h2>
              {selectedCandidate ? (
                <strong
                  className="status-badge status-active"
                  id="selected-candidate-indicator"
                >
                  #{selectedCandidate.candidate_id} {selectedCandidate.name}
                </strong>
              ) : (
                <strong
                  className="status-badge status-pending"
                  id="selected-candidate-indicator"
                >
                  None Selected
                </strong>
              )}
            </div>

            <form
              id="vote-form"
              name="f1"
              method="post"
              action="#"
              onSubmit={(e) => e.preventDefault()}
            >
              <input
                type="hidden"
                id="input-election-id"
                name="election_id"
                value={election.election_id}
              />
              <input
                type="hidden"
                id="input-candidate-id"
                name="t1"
                value={selectedCandidate ? selectedCandidate.candidate_id : ''}
                required
              />

              {votingPermitted && candidates.length > 0 ? (
                <div
                  className="ballot-candidate-grid"
                  role="radiogroup"
                  aria-labelledby="candidate-section-heading"
                >
                  {candidates.map((candidate) => {
                    const isSelected = selectedCandidateId === candidate.candidate_id;
                    return (
                      <article
                        key={candidate.candidate_id}
                        className={`ballot-candidate-card ${isSelected ? 'is-selected' : ''}`}
                        data-candidate-card={candidate.candidate_id}
                        data-candidate-id={candidate.candidate_id}
                        data-candidate-name={candidate.name}
                        data-candidate-party={candidate.symbol}
                        tabIndex={0}
                        role="radio"
                        aria-checked={isSelected ? 'true' : 'false'}
                        onClick={() => {
                          setSelectedCandidateId(candidate.candidate_id);
                          setVoteFeedback({ message: '', type: 'info' });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedCandidateId(candidate.candidate_id);
                            setVoteFeedback({ message: '', type: 'info' });
                          }
                        }}
                      >
                        <div className="ballot-card-top">
                          <strong className="status-badge status-disconnected tabular-nums">
                            #{candidate.candidate_id}
                          </strong>
                          <strong
                            className={`status-badge ${
                              isSelected ? 'status-authenticated' : 'status-disconnected'
                            }`}
                            data-candidate-badge
                          >
                            {isSelected ? 'Selected on Ballot' : 'Select'}
                          </strong>
                        </div>

                        <div className="ballot-card-main">
                          <img
                            src={candidate.symbol_src}
                            alt={candidate.symbol_alt}
                            className="candidate-emblem"
                          />
                          <div className="candidate-details">
                            <h3 className="candidate-title">{candidate.name}</h3>
                            <p className="ballot-cand-symbol">{candidate.symbol}</p>
                          </div>
                        </div>

                        {candidate.description && (
                          <p className="ballot-cand-desc">{candidate.description}</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : !votingPermitted ? (
                <div className="state-panel">
                  <h3>Ballot Submission Is Not Currently Open</h3>
                  <p>This election is {election.status_label.toLowerCase()}.</p>
                </div>
              ) : (
                <div className="state-panel">
                  <h3>No Candidates Listed</h3>
                </div>
              )}

              <div
                className={`feedback-panel${txProgressVisible ? ' is-visible' : ''}`}
                id="ballot-tx-progress-panel"
                role="status"
                aria-live="polite"
              >
                <strong id="ballot-tx-stage-title">{txStageTitle}</strong>
              </div>

              <p
                id="vote-feedback"
                className={`feedback-panel${voteFeedback.message ? ' is-visible' : ''}${
                  voteFeedback.type ? ` feedback-${voteFeedback.type}` : ''
                }`}
                role="status"
              >
                {voteFeedback.message}
              </p>

              <div className="ballot-action-bar">
                <strong id="ballot-selection-summary" className="voter-selection-label">
                  {voterHasVoted
                    ? `Vote recorded for ${election.title}.`
                    : selectedCandidate
                    ? `Selected: #${selectedCandidate.candidate_id} ${selectedCandidate.name} (${selectedCandidate.symbol})`
                    : 'Select a candidate to continue.'}
                </strong>
                <div className="wallet-actions">
                  {voterHasVoted ? (
                    <a href="#ballot-receipt-panel" className="btn-secondary btn-inline">
                      View Receipt
                    </a>
                  ) : votingPermitted && candidates.length > 0 ? (
                    <button
                      type="button"
                      id="btn-review-ballot"
                      className="btn-primary btn-inline"
                      disabled={submittingVote}
                      onClick={handleOpenReviewModal}
                    >
                      Review Vote
                    </button>
                  ) : (
                    <button type="button" className="btn-primary btn-inline" disabled>
                      Voting Closed
                    </button>
                  )}
                </div>
              </div>
            </form>
          </section>
        )}
      </div>

      <div
        className={`modal-backdrop${reviewModalOpen ? ' is-open' : ''}`}
        id="modal-ballot-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-ballot-review-title"
      >
        <div className="modal-dialog">
          <div className="modal-header">
            <h2 id="modal-ballot-review-title">Confirm Your Vote</h2>
          </div>
          <div className="modal-body">
            <div className="candidate-card ballot-review-preview">
              <div className="candidate-details">
                <small className="meta-term" id="review-modal-election">
                  {election ? election.title : ''}
                </small>
                <h3 className="candidate-title" id="review-modal-candidate-name">
                  {selectedCandidate ? selectedCandidate.name : 'No Candidate Selected'}
                </h3>
                <p className="ballot-cand-symbol" id="review-modal-candidate-party">
                  {selectedCandidate ? selectedCandidate.symbol : '—'}
                </p>
              </div>
              <strong
                className="status-badge status-active tabular-nums"
                id="review-modal-candidate-id"
              >
                #{selectedCandidate ? selectedCandidate.candidate_id : '—'}
              </strong>
            </div>

            <p className="feedback-panel feedback-warning is-visible">
              This vote is final and cannot be changed once submitted.
            </p>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn-secondary btn-inline"
              id="btn-cancel-ballot-review"
              onClick={() => setReviewModalOpen(false)}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-primary btn-inline"
              id="btn-confirm-submit-vote"
              disabled={submittingVote}
              onClick={handleConfirmSubmitVote}
            >
              {submittingVote ? 'Submitting…' : 'Submit Vote'}
            </button>
          </div>
        </div>
      </div>
    </BaseLayout>
  );
};
