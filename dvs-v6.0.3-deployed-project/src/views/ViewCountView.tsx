import React, { useState } from 'react';
import { BaseLayout } from '../components/BaseLayout';
import { AuthUser } from '../types/dvs';

interface ViewCountViewProps {
  user: AuthUser | null;
  tallyResultHtml?: string;
  onInspectCandidate: (candidateId: string) => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

export const ViewCountView: React.FC<ViewCountViewProps> = ({
  user,
  tallyResultHtml,
  onInspectCandidate,
  onNavigate,
  onLogout,
}) => {
  const [candidateIdInput, setCandidateIdInput] = useState('');
  const [candidateIdError, setCandidateIdError] = useState('');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCandidateIdError('');
    if (!candidateIdInput.trim()) {
      setCandidateIdError('Please enter a valid candidate ID.');
      const inp = document.getElementById('input-view-candidate-id');
      if (inp) inp.focus();
      return;
    }
    onInspectCandidate(candidateIdInput.trim());
  };

  const hero = (
    <section className="hero">
      <h1>Tally Inspector</h1>
      <p>Inspect verified vote counts for a registered candidate.</p>
    </section>
  );

  return (
    <BaseLayout
      title="Tally Inspector — DVS Civic Elections"
      containerClass="page-container-narrow"
      user={user}
      onNavigate={onNavigate}
      onLogout={onLogout}
      hero={hero}
    >
      <div className="card">
        {tallyResultHtml && (
          <div
            className="dynamic-data"
            role="status"
            dangerouslySetInnerHTML={{ __html: tallyResultHtml }}
          />
        )}

        <div className="form-container">
          <h2 className="form-title">Candidate Tally</h2>

          <form
            name="f1"
            method="post"
            action="/ViewCountAction"
            data-validate="view-count"
            noValidate
            onSubmit={handleSubmit}
          >
            <div className="form-group">
              <label htmlFor="input-view-candidate-id">Candidate ID</label>
              <input
                type="text"
                id="input-view-candidate-id"
                name="t1"
                className={`inp tabular-nums${candidateIdError ? ' inp-invalid' : ''}`}
                aria-invalid={candidateIdError ? 'true' : undefined}
                placeholder="Enter candidate number (e.g. 1)"
                value={candidateIdInput}
                onChange={(e) => setCandidateIdInput(e.target.value)}
                required
              />
              <p
                id="error-candidate-id"
                className={`field-error${candidateIdError ? ' is-visible' : ''}`}
                role="alert"
              >
                {candidateIdError}
              </p>
            </div>

            <div className="form-group">
              <button type="submit" className="btn btn-primary">
                View Tally
              </button>
            </div>
          </form>
        </div>
      </div>
    </BaseLayout>
  );
};
