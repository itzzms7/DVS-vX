import React, { useRef, useState } from 'react';
import { BaseLayout } from '../components/BaseLayout';
import {
  AuthUser,
  OfficialRecord,
  OfficialSubmissionResult,
  VoterRecord,
  VoterSubmissionResult,
  WIZARD_ELECTION_TYPE_CHOICES,
  WizardCandidate,
  WizardDetails,
} from '../types/dvs';

interface AdminScreenViewProps {
  user: AuthUser;
  activeAdminSection: 'create-elections' | 'voters' | 'officials';
  selectedElectionId?: number;
  registeredVoters: VoterRecord[];
  registeredOfficials: OfficialRecord[];
  onRegisterVotersBatch: (rawInput: string) => Promise<VoterSubmissionResult>;
  onRegisterOfficialsBatch: (rawInput: string) => Promise<OfficialSubmissionResult>;
  onDeleteOfficial: (officialId: number) => Promise<void>;
  onCreateElectionFromWizard: (payload: {
    details: WizardDetails;
    candidates: WizardCandidate[];
    includedVoterIds: string[];
  }) => Promise<{ electionId?: number; error?: string }>;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

function resolveDefaultSymbolForParty(party: string): string {
  const lower = party.toLowerCase();
  if (lower.includes('bjp') || lower.includes('bharatiya')) return '/static/symbols/bjp.png';
  if (lower.includes('samajwadi') || lower.includes('samajvadi')) {
    return '/static/symbols/samajvadi.png';
  }
  return '/static/symbols/congress.png';
}

export const AdminScreenView: React.FC<AdminScreenViewProps> = ({
  user,
  activeAdminSection,
  selectedElectionId,
  registeredVoters,
  registeredOfficials,
  onRegisterVotersBatch,
  onRegisterOfficialsBatch,
  onDeleteOfficial,
  onCreateElectionFromWizard,
  onNavigate,
  onLogout,
}) => {
  // 4-step Create Elections Wizard State
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [wizardError, setWizardError] = useState('');
  const [wizardSuccess, setWizardSuccess] = useState('');
  const [wizardDetails, setWizardDetails] = useState<WizardDetails>({
    title: '',
    description: '',
    election_type: 'ELECTION',
    election_type_label: 'Election',
    start_datetime_input: '',
    end_datetime_input: '',
  });
  const [wizardCandidates, setWizardCandidates] = useState<WizardCandidate[]>([]);
  const [candidateNameInput, setCandidateNameInput] = useState('');
  const [candidatePartyInput, setCandidatePartyInput] = useState('');
  const [candidateSymbolUrlInput, setCandidateSymbolUrlInput] = useState('');
  const [includedVoterIds, setIncludedVoterIds] = useState<string[]>([]);
  const [includedVotersTextarea, setIncludedVotersTextarea] = useState('');
  const [wizardVoterSubmissionResult, setWizardVoterSubmissionResult] =
    useState<VoterSubmissionResult | null>(null);

  // Voters Section State
  const [votersInputValue, setVotersInputValue] = useState('');
  const [voterSubmissionResult, setVoterSubmissionResult] =
    useState<VoterSubmissionResult | null>(null);

  // Officials Section State
  const [officialsInputValue, setOfficialsInputValue] = useState('');
  const [officialSubmissionResult, setOfficialSubmissionResult] =
    useState<OfficialSubmissionResult | null>(null);
  const [confirmingDeleteOfficialId, setConfirmingDeleteOfficialId] = useState<number | null>(null);

  const wizardIncludedVoters = registeredVoters.filter((v) =>
    includedVoterIds.includes(v.aadhar_number)
  );

  // Step 1 handler
  const handleStep1Submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setWizardError('');
    setWizardSuccess('');

    const title = wizardDetails.title.trim();
    const desc = wizardDetails.description.trim();
    const startRaw = wizardDetails.start_datetime_input.trim();
    const endRaw = wizardDetails.end_datetime_input.trim();

    if (!title) {
      setWizardError('Election name is required.');
      return;
    }
    if (!desc) {
      setWizardError('Election description is required.');
      return;
    }
    if (!startRaw || !endRaw) {
      setWizardError('Both voting start and end date/time are required.');
      return;
    }
    const startDate = new Date(startRaw);
    const endDate = new Date(endRaw);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setWizardError('Enter valid voting start and end dates.');
      return;
    }
    if (endDate <= startDate) {
      setWizardError('Voting end date and time must be after the start date and time.');
      return;
    }

    const labelEntry = WIZARD_ELECTION_TYPE_CHOICES.find(
      ([code]) => code === wizardDetails.election_type
    );
    setWizardDetails((prev) => ({
      ...prev,
      title,
      description: desc,
      election_type_label: labelEntry ? labelEntry[1] : 'Election',
    }));
    setWizardStep(2);
  };

  const handleCandidateFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setCandidateSymbolUrlInput('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCandidateSymbolUrlInput(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const addWizardCandidateRecord = (): boolean => {
    const name = candidateNameInput.trim();
    const party = candidatePartyInput.trim();
    if (!name) {
      setWizardError('Candidate name is required.');
      return false;
    }
    if (name.length > 150) {
      setWizardError('Candidate name cannot exceed 150 characters.');
      return false;
    }
    if (!party) {
      setWizardError('Party name is required.');
      return false;
    }
    if (party.length > 100) {
      setWizardError('Party name cannot exceed 100 characters.');
      return false;
    }
    const symbolUrl = candidateSymbolUrlInput || resolveDefaultSymbolForParty(party);
    setWizardCandidates((prev) => [
      ...prev,
      { name, party, symbol_image_url: symbolUrl },
    ]);
    setCandidateNameInput('');
    setCandidatePartyInput('');
    setCandidateSymbolUrlInput('');
    const fileInp = document.getElementById('wizard-candidate-symbol') as HTMLInputElement | null;
    if (fileInp) fileInp.value = '';
    setWizardSuccess(`Candidate '${name}' (${party}) added.`);
    return true;
  };

  const validateAndIncludeWizardVoters = (rawText: string): VoterSubmissionResult => {
    const lines = rawText.split(/\r?\n/);
    const updatedSet = new Set(includedVoterIds);
    let includedCount = 0;
    const rejectedRecords: VoterSubmissionResult['rejected_records'] = [];

    lines.forEach((rawLine, idx) => {
      const trimmed = rawLine.trim();
      if (!trimmed) return;
      const lineNumber = idx + 1;
      if (!/^\d{12}$/.test(trimmed)) {
        rejectedRecords.push({
          line_number: lineNumber,
          voter_id: trimmed,
          reason: 'Voter ID must be exactly 12 digits.',
        });
        return;
      }
      const existingVoter = registeredVoters.find((v) => v.aadhar_number === trimmed);
      if (!existingVoter) {
        rejectedRecords.push({
          line_number: lineNumber,
          voter_id: trimmed,
          reason: 'Voter ID is not registered in the voter database.',
        });
        return;
      }
      if (!updatedSet.has(trimmed)) {
        updatedSet.add(trimmed);
        includedCount += 1;
      }
    });

    setIncludedVoterIds(Array.from(updatedSet));
    const result: VoterSubmissionResult = {
      included_count: includedCount,
      rejected_count: rejectedRecords.length,
      rejected_records: rejectedRecords,
    };
    setWizardVoterSubmissionResult(result);
    if (rejectedRecords.length === 0) {
      setIncludedVotersTextarea('');
    }
    return result;
  };

  const isSubmittingVotersRef = useRef(false);
  const isSubmittingOfficialsRef = useRef(false);

  const handleVotersSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmittingVotersRef.current) return;
    if (!votersInputValue.trim()) {
      setVoterSubmissionResult({
        registered_count: 0,
        rejected_count: 1,
        rejected_records: [
          {
            line_number: 1,
            raw_line: '',
            reason: 'Enter at least one voter record in the format: VoterID (12 digits), Name, Phone.',
          },
        ],
      });
      return;
    }
    isSubmittingVotersRef.current = true;
    try {
      const res = await onRegisterVotersBatch(votersInputValue);
      setVoterSubmissionResult(res);
      if (res.rejected_count === 0) {
        setVotersInputValue('');
      }
    } finally {
      isSubmittingVotersRef.current = false;
    }
  };

  const handleOfficialsSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmittingOfficialsRef.current) return;
    if (!officialsInputValue.trim()) {
      setOfficialSubmissionResult({
        registered_count: 0,
        rejected_count: 1,
        rejected_records: [
          {
            line_number: 1,
            official_id: '',
            reason: 'Enter at least one official record in the format: OfficialID, Name, Password.',
          },
        ],
      });
      return;
    }
    isSubmittingOfficialsRef.current = true;
    try {
      const res = await onRegisterOfficialsBatch(officialsInputValue);
      setOfficialSubmissionResult(res);
      if (res.rejected_count === 0) {
        setOfficialsInputValue('');
      }
    } finally {
      isSubmittingOfficialsRef.current = false;
    }
  };

  return (
    <BaseLayout
      title="Election Administration Portal — DVS"
      isControlPortal
      activeAdminSection={activeAdminSection}
      user={user}
      onNavigate={onNavigate}
      onLogout={onLogout}
      hideFooter
    >
      <div
        id="control-portal-root"
        className="admin-portal-shell"
        data-election-id={selectedElectionId || ''}
        data-portal-role={user.portal_role}
        data-election-role={user.portal_role}
        data-can-manage-platform={user.is_superuser ? 'true' : 'false'}
        data-can-write-election="true"
        data-can-worker-assist="true"
        data-is-auditor="false"
        data-active-section={activeAdminSection}
      >
        {activeAdminSection === 'create-elections' && user.is_superuser && (
          <div className="container voters-admin-container">
            <div className="voters-admin-stack">
              <section
                className="card voters-admin-section"
                aria-labelledby="create-election-wizard-heading"
              >
                <div className="voters-section-header">
                  <h1 id="create-election-wizard-heading">Create Elections</h1>
                  <p className="voters-format-hint">
                    Complete all four steps to configure and launch a new election.
                  </p>
                </div>

                <ol className="wizard-stepper" aria-label="Create Election Steps">
                  <li
                    className={`wizard-step-item ${
                      wizardStep === 1 ? 'is-active' : wizardStep > 1 ? 'is-complete' : ''
                    }`}
                  >
                    <span className="wizard-step-num">1</span>
                    <span className="wizard-step-label">Election Details</span>
                  </li>
                  <li
                    className={`wizard-step-item ${
                      wizardStep === 2 ? 'is-active' : wizardStep > 2 ? 'is-complete' : ''
                    }`}
                  >
                    <span className="wizard-step-num">2</span>
                    <span className="wizard-step-label">Candidates</span>
                  </li>
                  <li
                    className={`wizard-step-item ${
                      wizardStep === 3 ? 'is-active' : wizardStep > 3 ? 'is-complete' : ''
                    }`}
                  >
                    <span className="wizard-step-num">3</span>
                    <span className="wizard-step-label">Include Voters</span>
                  </li>
                  <li className={`wizard-step-item ${wizardStep === 4 ? 'is-active' : ''}`}>
                    <span className="wizard-step-num">4</span>
                    <span className="wizard-step-label">Review &amp; Create</span>
                  </li>
                </ol>

                {wizardError && (
                  <div className="voters-submission-feedback is-error" role="alert">
                    <p className="voters-rejected-reason">{wizardError}</p>
                  </div>
                )}

                {wizardSuccess && (
                  <div className="voters-submission-feedback is-success" role="status">
                    <p className="voters-feedback-metric">
                      <strong>{wizardSuccess}</strong>
                    </p>
                  </div>
                )}

                {wizardStep === 1 && (
                  <form
                    method="post"
                    action="/control/?section=create-elections"
                    className="voters-add-form"
                    noValidate
                    onSubmit={handleStep1Submit}
                  >
                    <input type="hidden" name="section" value="create-elections" />
                    <input type="hidden" name="wizard_action" value="step1_next" />

                    <div className="form-group">
                      <label htmlFor="wizard-election-title">Election Name</label>
                      <input
                        type="text"
                        id="wizard-election-title"
                        name="election_title"
                        className="wizard-input"
                        maxLength={200}
                        value={wizardDetails.title}
                        onChange={(e) =>
                          setWizardDetails((prev) => ({ ...prev, title: e.target.value }))
                        }
                        placeholder="e.g., 2026 General Assembly Election"
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="wizard-election-description">Election Description</label>
                      <textarea
                        id="wizard-election-description"
                        name="election_description"
                        rows={3}
                        className="voters-textarea wizard-desc-textarea"
                        placeholder="Provide a concise description of the election purpose and scope."
                        value={wizardDetails.description}
                        onChange={(e) =>
                          setWizardDetails((prev) => ({ ...prev, description: e.target.value }))
                        }
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="wizard-election-type">Election Type</label>
                      <select
                        id="wizard-election-type"
                        name="election_type"
                        className="wizard-select"
                        value={wizardDetails.election_type}
                        onChange={(e) =>
                          setWizardDetails((prev) => ({
                            ...prev,
                            election_type: e.target.value as WizardDetails['election_type'],
                          }))
                        }
                        required
                      >
                        {WIZARD_ELECTION_TYPE_CHOICES.map(([code, label]) => (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="wizard-schedule-grid">
                      <div className="form-group">
                        <label htmlFor="wizard-start-datetime">Voting Start Date and Time</label>
                        <input
                          type="datetime-local"
                          id="wizard-start-datetime"
                          name="start_datetime"
                          className="wizard-input wizard-datetime"
                          value={wizardDetails.start_datetime_input}
                          onChange={(e) =>
                            setWizardDetails((prev) => ({
                              ...prev,
                              start_datetime_input: e.target.value,
                            }))
                          }
                          required
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="wizard-end-datetime">Voting End Date and Time</label>
                        <input
                          type="datetime-local"
                          id="wizard-end-datetime"
                          name="end_datetime"
                          className="wizard-input wizard-datetime"
                          value={wizardDetails.end_datetime_input}
                          onChange={(e) =>
                            setWizardDetails((prev) => ({
                              ...prev,
                              end_datetime_input: e.target.value,
                            }))
                          }
                          required
                        />
                      </div>
                    </div>

                    <div className="wizard-nav-actions">
                      <button type="submit" className="btn btn-primary">
                        Next: Candidates
                      </button>
                    </div>
                  </form>
                )}

                {wizardStep === 2 && (
                  <div className="wizard-step-stack">
                    <form
                      method="post"
                      action="/control/?section=create-elections"
                      encType="multipart/form-data"
                      className="voters-add-form"
                      noValidate
                      onSubmit={(e) => e.preventDefault()}
                    >
                      <input type="hidden" name="section" value="create-elections" />

                      <div className="wizard-candidate-fields">
                        <div className="form-group">
                          <label htmlFor="wizard-candidate-name">Candidate Name</label>
                          <input
                            type="text"
                            id="wizard-candidate-name"
                            name="candidate_name"
                            className="wizard-input"
                            maxLength={150}
                            value={candidateNameInput}
                            onChange={(e) => setCandidateNameInput(e.target.value)}
                            placeholder="e.g., Meera Nair"
                          />
                        </div>

                        <div className="form-group">
                          <label htmlFor="wizard-candidate-party">Party Name</label>
                          <input
                            type="text"
                            id="wizard-candidate-party"
                            name="candidate_party"
                            className="wizard-input"
                            maxLength={100}
                            value={candidatePartyInput}
                            onChange={(e) => setCandidatePartyInput(e.target.value)}
                            placeholder="e.g., Civic Progress Alliance"
                          />
                        </div>

                        <div className="form-group">
                          <label htmlFor="wizard-candidate-symbol">
                            Party Symbol Image Upload (PNG, JPG, WEBP)
                          </label>
                          <input
                            type="file"
                            id="wizard-candidate-symbol"
                            name="candidate_symbol_image"
                            className="wizard-file-input"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={handleCandidateFileChange}
                          />
                        </div>
                      </div>

                      <div className="voters-form-actions">
                        <button
                          type="button"
                          name="wizard_action"
                          value="add_candidate"
                          className="btn btn-secondary"
                          onClick={() => {
                            setWizardError('');
                            setWizardSuccess('');
                            addWizardCandidateRecord();
                          }}
                        >
                          Add Candidate
                        </button>
                      </div>

                      <div className="wizard-candidates-block">
                        <h2 className="wizard-sub-heading">
                          Added Candidates ({wizardCandidates.length})
                        </h2>
                        {wizardCandidates.length > 0 ? (
                          <div className="voters-table-wrapper">
                            <table className="voters-table">
                              <thead>
                                <tr>
                                  <th scope="col">#</th>
                                  <th scope="col">Candidate Name</th>
                                  <th scope="col">Party Name</th>
                                  <th scope="col">Party Symbol</th>
                                  <th scope="col">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {wizardCandidates.map((cand, idx) => (
                                  <tr key={idx}>
                                    <td className="voters-col-id">{idx + 1}</td>
                                    <td className="voters-col-name">{cand.name}</td>
                                    <td>{cand.party}</td>
                                    <td>
                                      <img
                                        src={cand.symbol_image_url}
                                        alt={`${cand.party} symbol`}
                                        className="wizard-symbol-thumb"
                                      />
                                    </td>
                                    <td className="officials-col-action">
                                      <button
                                        type="button"
                                        name="wizard_action"
                                        value="remove_candidate"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => {
                                          const removed = wizardCandidates[idx];
                                          setWizardCandidates((prev) =>
                                            prev.filter((_, i) => i !== idx)
                                          );
                                          setWizardError('');
                                          setWizardSuccess(
                                            `Removed candidate '${removed?.name || ''}'.`
                                          );
                                        }}
                                      >
                                        Remove
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="voters-empty-state">
                            No candidates added yet. Use the form above to add candidates.
                          </p>
                        )}
                      </div>

                      <div className="wizard-nav-actions wizard-nav-between">
                        <button
                          type="button"
                          name="wizard_action"
                          value="go_back"
                          className="btn btn-secondary"
                          onClick={() => {
                            setWizardError('');
                            setWizardSuccess('');
                            setWizardStep(1);
                          }}
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          name="wizard_action"
                          value="step2_next"
                          className="btn btn-primary"
                          onClick={() => {
                            setWizardError('');
                            setWizardSuccess('');
                            let currentCount = wizardCandidates.length;
                            if (candidateNameInput.trim() || candidatePartyInput.trim()) {
                              const ok = addWizardCandidateRecord();
                              if (!ok) return;
                              currentCount += 1;
                            }
                            if (currentCount === 0) {
                              setWizardError(
                                'Add at least one candidate with a party name and symbol image before proceeding.'
                              );
                              return;
                            }
                            setWizardStep(3);
                          }}
                        >
                          Next: Include Voters
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {wizardStep === 3 && (
                  <div className="wizard-step-stack">
                    {wizardVoterSubmissionResult && (
                      <div
                        className={`voters-submission-feedback ${
                          wizardVoterSubmissionResult.rejected_count > 0 &&
                          (wizardVoterSubmissionResult.included_count || 0) === 0
                            ? 'is-error'
                            : wizardVoterSubmissionResult.rejected_count > 0
                            ? 'is-partial'
                            : 'is-success'
                        }`}
                        role="status"
                        aria-live="polite"
                      >
                        <div className="voters-feedback-counts">
                          <p className="voters-feedback-metric">
                            <span className="voters-feedback-label">Included Voters:</span>{' '}
                            <strong className="voters-feedback-value">
                              {wizardVoterSubmissionResult.included_count || 0}
                            </strong>
                          </p>
                          <p className="voters-feedback-metric">
                            <span className="voters-feedback-label">Rejected Voter IDs:</span>{' '}
                            <strong className="voters-feedback-value">
                              {wizardVoterSubmissionResult.rejected_count}
                            </strong>
                          </p>
                        </div>

                        {wizardVoterSubmissionResult.rejected_records.length > 0 && (
                          <div className="voters-rejected-block">
                            <p className="voters-rejected-title">Rejected Voter IDs</p>
                            <ul className="voters-rejected-list">
                              {wizardVoterSubmissionResult.rejected_records.map((item, idx) => (
                                <li key={idx} className="voters-rejected-item">
                                  <span className="voters-rejected-line">
                                    Line {item.line_number}
                                    {item.voter_id ? ` (${item.voter_id})` : ''}:
                                  </span>{' '}
                                  <span className="voters-rejected-reason">{item.reason}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    <form
                      method="post"
                      action="/control/?section=create-elections"
                      className="voters-add-form"
                      noValidate
                      onSubmit={(e) => e.preventDefault()}
                    >
                      <input type="hidden" name="section" value="create-elections" />

                      <div className="form-group">
                        <label htmlFor="wizard-included-voters-textarea">
                          Include Registered Voters (12-Digit Voter IDs, One Per Line)
                        </label>
                        <textarea
                          id="wizard-included-voters-textarea"
                          name="included_voters_input"
                          rows={6}
                          className="voters-textarea"
                          placeholder={'100000000001\n100000000002\n100000000003'}
                          value={includedVotersTextarea}
                          onChange={(e) => setIncludedVotersTextarea(e.target.value)}
                        />
                      </div>

                      <div className="voters-form-actions">
                        <button
                          type="button"
                          name="wizard_action"
                          value="include_voters"
                          className="btn btn-secondary"
                          onClick={() => {
                            setWizardError('');
                            validateAndIncludeWizardVoters(includedVotersTextarea);
                          }}
                        >
                          Include Voters
                        </button>
                      </div>

                      <div className="wizard-candidates-block">
                        <h2 className="wizard-sub-heading">
                          Included Voters ({wizardIncludedVoters.length})
                        </h2>
                        {wizardIncludedVoters.length > 0 ? (
                          <div className="voters-table-wrapper">
                            <table className="voters-table">
                              <thead>
                                <tr>
                                  <th scope="col">Voter ID</th>
                                  <th scope="col">Name</th>
                                  <th scope="col">Phone</th>
                                </tr>
                              </thead>
                              <tbody>
                                {wizardIncludedVoters.map((voter) => (
                                  <tr key={voter.aadhar_number}>
                                    <td className="voters-col-id">{voter.aadhar_number}</td>
                                    <td className="voters-col-name">{voter.name}</td>
                                    <td className="voters-col-phone">
                                      {voter.phone ? voter.phone : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="voters-empty-state">
                            No voters have been included in this election yet.
                          </p>
                        )}
                      </div>

                      <div className="wizard-nav-actions wizard-nav-between">
                        <button
                          type="button"
                          name="wizard_action"
                          value="go_back"
                          className="btn btn-secondary"
                          onClick={() => {
                            setWizardError('');
                            setWizardStep(2);
                          }}
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          name="wizard_action"
                          value="step3_next"
                          className="btn btn-primary"
                          onClick={() => {
                            setWizardError('');
                            let totalIncluded = includedVoterIds.length;
                            if (includedVotersTextarea.trim()) {
                              const res = validateAndIncludeWizardVoters(includedVotersTextarea);
                              if (res.rejected_count > 0) return;
                              totalIncluded += res.included_count || 0;
                            }
                            if (totalIncluded === 0) {
                              setWizardError(
                                'Include at least one registered 12-digit voter before proceeding to review.'
                              );
                              return;
                            }
                            setWizardStep(4);
                          }}
                        >
                          Next: Review &amp; Create
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {wizardStep === 4 && (
                  <div className="wizard-step-stack">
                    <div className="wizard-review-block">
                      <h2 className="wizard-sub-heading">1. Election Details &amp; Schedule</h2>
                      <dl className="wizard-review-grid">
                        <div className="wizard-review-item">
                          <dt>Election Name</dt>
                          <dd>{wizardDetails.title}</dd>
                        </div>
                        <div className="wizard-review-item">
                          <dt>Election Type</dt>
                          <dd>{wizardDetails.election_type_label}</dd>
                        </div>
                        <div className="wizard-review-item wizard-review-item-full">
                          <dt>Description</dt>
                          <dd>{wizardDetails.description}</dd>
                        </div>
                        <div className="wizard-review-item">
                          <dt>Voting Starts</dt>
                          <dd className="mono-inline">{wizardDetails.start_datetime_input}</dd>
                        </div>
                        <div className="wizard-review-item">
                          <dt>Voting Ends</dt>
                          <dd className="mono-inline">{wizardDetails.end_datetime_input}</dd>
                        </div>
                      </dl>
                    </div>

                    <div className="wizard-review-block">
                      <h2 className="wizard-sub-heading">
                        2. Candidates ({wizardCandidates.length})
                      </h2>
                      <div className="voters-table-wrapper">
                        <table className="voters-table">
                          <thead>
                            <tr>
                              <th scope="col">#</th>
                              <th scope="col">Candidate Name</th>
                              <th scope="col">Party Name</th>
                              <th scope="col">Party Symbol</th>
                            </tr>
                          </thead>
                          <tbody>
                            {wizardCandidates.map((cand, idx) => (
                              <tr key={idx}>
                                <td className="voters-col-id">{idx + 1}</td>
                                <td className="voters-col-name">{cand.name}</td>
                                <td>{cand.party}</td>
                                <td>
                                  <img
                                    src={cand.symbol_image_url}
                                    alt={`${cand.party} symbol`}
                                    className="wizard-symbol-thumb"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="wizard-review-block">
                      <h2 className="wizard-sub-heading">
                        3. Included Voters ({wizardIncludedVoters.length})
                      </h2>
                      <div className="voters-table-wrapper">
                        <table className="voters-table">
                          <thead>
                            <tr>
                              <th scope="col">Voter ID</th>
                              <th scope="col">Name</th>
                              <th scope="col">Phone</th>
                            </tr>
                          </thead>
                          <tbody>
                            {wizardIncludedVoters.map((voter) => (
                              <tr key={voter.aadhar_number}>
                                <td className="voters-col-id">{voter.aadhar_number}</td>
                                <td className="voters-col-name">{voter.name}</td>
                                <td className="voters-col-phone">
                                  {voter.phone ? voter.phone : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <form
                      method="post"
                      action="/control/?section=create-elections"
                      className="voters-add-form"
                      noValidate
                      onSubmit={(e) => e.preventDefault()}
                    >
                      <input type="hidden" name="section" value="create-elections" />
                      <input type="hidden" name="target_step" value="3" />
                      <div className="wizard-nav-actions wizard-nav-between">
                        <button
                          type="button"
                          name="wizard_action"
                          value="go_back"
                          className="btn btn-secondary"
                          onClick={() => {
                            setWizardError('');
                            setWizardStep(3);
                          }}
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          name="wizard_action"
                          value="create_election"
                          className="btn btn-primary"
                          onClick={async () => {
                            const out = await onCreateElectionFromWizard({
                              details: wizardDetails,
                              candidates: wizardCandidates,
                              includedVoterIds,
                            });
                            if (out.error) {
                              setWizardError(out.error);
                            } else if (out.electionId) {
                              onNavigate(`/elections/${out.electionId}/`);
                            }
                          }}
                        >
                          Create Election
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {activeAdminSection === 'voters' && (
          <div className="container voters-admin-container">
            <div className="voters-admin-stack">
              <section
                className="card voters-admin-section"
                aria-labelledby="add-voters-heading"
              >
                <div className="voters-section-header">
                  <h1 id="add-voters-heading">Add Voters</h1>
                  <p className="voters-format-hint">
                    Enter one voter per line in the format:{' '}
                    <span className="mono-inline">VoterID (12 digits), Name, Phone</span>
                  </p>
                </div>

                {voterSubmissionResult && (
                  <div
                    className={`voters-submission-feedback ${
                      voterSubmissionResult.rejected_count > 0 &&
                      (voterSubmissionResult.registered_count || 0) === 0
                        ? 'is-error'
                        : voterSubmissionResult.rejected_count > 0
                        ? 'is-partial'
                        : 'is-success'
                    }`}
                    role="status"
                    aria-live="polite"
                  >
                    <div className="voters-feedback-counts">
                      <p className="voters-feedback-metric">
                        <span className="voters-feedback-label">Registered Voters:</span>{' '}
                        <strong className="voters-feedback-value">
                          {voterSubmissionResult.registered_count || 0}
                        </strong>
                      </p>
                      <p className="voters-feedback-metric">
                        <span className="voters-feedback-label">Rejected Records:</span>{' '}
                        <strong className="voters-feedback-value">
                          {voterSubmissionResult.rejected_count}
                        </strong>
                      </p>
                    </div>

                    {voterSubmissionResult.rejected_records.length > 0 && (
                      <div className="voters-rejected-block">
                        <p className="voters-rejected-title">Rejected Records</p>
                        <ul className="voters-rejected-list">
                          {voterSubmissionResult.rejected_records.map((item, idx) => (
                            <li key={idx} className="voters-rejected-item">
                              <span className="voters-rejected-line">
                                Line {item.line_number}
                                {item.raw_line ? ` (${item.raw_line})` : ''}:
                              </span>{' '}
                              <span className="voters-rejected-reason">{item.reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <form
                  method="post"
                  action="/control/?section=voters"
                  className="voters-add-form"
                  noValidate
                  onSubmit={handleVotersSubmit}
                >
                  <input type="hidden" name="section" value="voters" />
                  <div className="form-group">
                    <label htmlFor="voters-input-textarea">Voter Records</label>
                    <textarea
                      id="voters-input-textarea"
                      name="voters_input"
                      rows={6}
                      className="voters-textarea"
                      placeholder={
                        '100000000001, Rahul Kumar, 9876543210\n100000000002, Arjun Kumar, 9876543211\n100000000003, Sameer Khan, 9876543212'
                      }
                      value={votersInputValue}
                      onChange={(e) => setVotersInputValue(e.target.value)}
                      required
                    />
                  </div>
                  <div className="voters-form-actions">
                    <button type="submit" className="btn btn-primary">
                      Submit
                    </button>
                  </div>
                </form>
              </section>

              <section
                className="card voters-admin-section"
                aria-labelledby="registered-voters-heading"
              >
                <div className="voters-section-header">
                  <h2 id="registered-voters-heading">Registered Voters</h2>
                </div>

                {registeredVoters.length > 0 ? (
                  <div className="voters-table-wrapper">
                    <table className="voters-table">
                      <thead>
                        <tr>
                          <th scope="col">Voter ID</th>
                          <th scope="col">Name</th>
                          <th scope="col">Phone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registeredVoters.map((voter) => (
                          <tr key={voter.aadhar_number}>
                            <td className="voters-col-id">{voter.aadhar_number}</td>
                            <td className="voters-col-name">{voter.name}</td>
                            <td className="voters-col-phone">
                              {voter.phone ? voter.phone : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="voters-empty-state">
                    No registered voters found in the database.
                  </p>
                )}
              </section>
            </div>
          </div>
        )}

        {activeAdminSection === 'officials' && user.is_superuser && (
          <div className="container voters-admin-container">
            <div className="voters-admin-stack">
              <section
                className="card voters-admin-section"
                aria-labelledby="add-officials-heading"
              >
                <div className="voters-section-header">
                  <h1 id="add-officials-heading">Add Officials</h1>
                  <p className="voters-format-hint">
                    Enter one official per line in the format:{' '}
                    <span className="mono-inline">OfficialID, Name, Password</span>
                  </p>
                </div>

                {officialSubmissionResult && (
                  <div
                    className={`voters-submission-feedback ${
                      officialSubmissionResult.rejected_count > 0 &&
                      officialSubmissionResult.registered_count === 0
                        ? 'is-error'
                        : officialSubmissionResult.rejected_count > 0
                        ? 'is-partial'
                        : 'is-success'
                    }`}
                    role="status"
                    aria-live="polite"
                  >
                    <div className="voters-feedback-counts">
                      <p className="voters-feedback-metric">
                        <span className="voters-feedback-label">Registered Officials:</span>{' '}
                        <strong className="voters-feedback-value">
                          {officialSubmissionResult.registered_count}
                        </strong>
                      </p>
                      <p className="voters-feedback-metric">
                        <span className="voters-feedback-label">Rejected Records:</span>{' '}
                        <strong className="voters-feedback-value">
                          {officialSubmissionResult.rejected_count}
                        </strong>
                      </p>
                    </div>

                    {officialSubmissionResult.rejected_records.length > 0 && (
                      <div className="voters-rejected-block">
                        <p className="voters-rejected-title">Rejected Records</p>
                        <ul className="voters-rejected-list">
                          {officialSubmissionResult.rejected_records.map((item, idx) => (
                            <li key={idx} className="voters-rejected-item">
                              <span className="voters-rejected-line">
                                Line {item.line_number}
                                {item.official_id ? ` (${item.official_id})` : ''}:
                              </span>{' '}
                              <span className="voters-rejected-reason">{item.reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <form
                  method="post"
                  action="/control/?section=officials"
                  className="voters-add-form"
                  noValidate
                  onSubmit={handleOfficialsSubmit}
                >
                  <input type="hidden" name="section" value="officials" />
                  <div className="form-group">
                    <label htmlFor="officials-input-textarea">Official Records</label>
                    <textarea
                      id="officials-input-textarea"
                      name="officials_input"
                      rows={6}
                      className="voters-textarea"
                      placeholder={
                        'A12B3, Rahul Kumar, SecurePassword123\nB45C6, Arjun Kumar, SecurePassword456'
                      }
                      value={officialsInputValue}
                      onChange={(e) => setOfficialsInputValue(e.target.value)}
                      required
                    />
                  </div>
                  <div className="voters-form-actions">
                    <button type="submit" className="btn btn-primary">
                      Submit
                    </button>
                  </div>
                </form>
              </section>

              <section
                className="card voters-admin-section"
                aria-labelledby="registered-officials-heading"
              >
                <div className="voters-section-header">
                  <h2 id="registered-officials-heading">Registered Officials</h2>
                </div>

                {registeredOfficials.length > 0 ? (
                  <div className="voters-table-wrapper">
                    <table className="voters-table">
                      <thead>
                        <tr>
                          <th scope="col">Official ID</th>
                          <th scope="col">Name</th>
                          <th scope="col">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registeredOfficials.map((official) => {
                          const isConfirming = confirmingDeleteOfficialId === official.id;
                          return (
                            <tr key={official.id}>
                              <td className="voters-col-id">{official.official_id}</td>
                              <td className="voters-col-name">{official.name}</td>
                              <td className="officials-col-action">
                                <form
                                  method="post"
                                  action={`/control/officials/${official.id}/delete/`}
                                  className="official-delete-form"
                                  onSubmit={async (e) => {
                                    e.preventDefault();
                                    await onDeleteOfficial(official.id);
                                    setConfirmingDeleteOfficialId(null);
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm js-delete-official-trigger"
                                    hidden={isConfirming}
                                    onClick={() => setConfirmingDeleteOfficialId(official.id)}
                                  >
                                    Delete
                                  </button>
                                  <div className="official-delete-confirm" hidden={!isConfirming}>
                                    <button type="submit" className="btn btn-primary btn-sm">
                                      Confirm
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm js-delete-official-cancel"
                                      onClick={() => setConfirmingDeleteOfficialId(null)}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </form>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="voters-empty-state">
                    No registered election officials found in the database.
                  </p>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </BaseLayout>
  );
};
