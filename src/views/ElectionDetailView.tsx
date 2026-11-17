import React from 'react';
import { BaseLayout } from '../components/BaseLayout';
import { AuthUser, PublicElectionDetail } from '../types/dvs';

interface ElectionDetailViewProps {
  user: AuthUser | null;
  election: PublicElectionDetail | null;
  messages?: string[];
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

function formatDateTimeDisplay(iso: string | null): string {
  if (!iso) return 'Not set';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export const ElectionDetailView: React.FC<ElectionDetailViewProps> = ({
  user,
  election,
  messages = [],
  onNavigate,
  onLogout,
}) => {
  const pageTitle = election ? `${election.title} — DVS` : 'Election Not Found — DVS';

  return (
    <BaseLayout
      title={pageTitle}
      containerClass="election-detail-container"
      navElectionsActive
      user={user}
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {!election ? (
        <section className="state-panel" role="alert">
          <h1>Election Not Found</h1>
          <p>No election record exists for the requested election.</p>
          <div className="action-row">
            <a
              href="/elections/"
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/elections/');
              }}
            >
              Back to Elections
            </a>
          </div>
        </section>
      ) : (
        <div className="election-detail-stack">
          {messages.map((message, idx) => (
            <div
              key={idx}
              className="voters-submission-feedback is-success"
              role="status"
              aria-live="polite"
            >
              <p className="voters-feedback-metric">
                <strong>{message}</strong>
              </p>
            </div>
          ))}

          <section className="card election-detail-section" aria-labelledby="election-title-heading">
            <div className="election-identity-header">
              <h1 id="election-title-heading">{election.title}</h1>
              <strong className={`badge ${election.status_badge_class}`}>
                {election.status_label}
              </strong>
            </div>

            <p className="election-status-sentence">{election.status_sentence}</p>

            <dl className="election-dates-row">
              <div className="meta-item">
                <dt className="meta-term">Voting Start Date</dt>
                <dd className="meta-detail">
                  {election.start_datetime ? (
                    <time dateTime={election.start_datetime}>
                      {formatDateTimeDisplay(election.start_datetime)}
                    </time>
                  ) : (
                    'Not set'
                  )}
                </dd>
              </div>
              <div className="meta-item">
                <dt className="meta-term">Voting End Date</dt>
                <dd className="meta-detail">
                  {election.end_datetime ? (
                    <time dateTime={election.end_datetime}>
                      {formatDateTimeDisplay(election.end_datetime)}
                    </time>
                  ) : (
                    'Not set'
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className="card election-detail-section" aria-labelledby="turnout-heading">
            <div className="election-section-heading">
              <h2 id="turnout-heading">Participation Overview</h2>
            </div>

            <div className="participation-grid-2">
              <div className="kpi-box">
                <p className="kpi-label">Eligible Voters</p>
                <p className="kpi-value">{election.turnout.eligible_voters}</p>
              </div>
              <div className="kpi-box">
                <p className="kpi-label">Voter Participation</p>
                <p className="kpi-value">{election.turnout.participation_rate_percent}%</p>
              </div>
            </div>
          </section>

          <section className="card election-detail-section" aria-labelledby="roster-section-heading">
            <div className="election-section-heading">
              <h2 id="roster-section-heading">Candidate Roster</h2>
            </div>

            {election.candidate_roster.length > 0 ? (
              <div className="candidate-roster-list">
                {election.candidate_roster.map((cand) => (
                  <article key={cand.candidate_id} className="candidate-roster-row">
                    <img
                      src={cand.symbol_src}
                      alt={cand.symbol_alt}
                      className="candidate-emblem-sm"
                      width={40}
                      height={40}
                    />
                    <div className="candidate-roster-info">
                      <h3 className="candidate-title">{cand.name}</h3>
                      <p className="candidate-party">{cand.symbol}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="state-panel">
                <p>No candidates have been published for this election yet.</p>
              </div>
            )}
          </section>

          {election.status === 'CLOSED' || election.status === 'FINALIZED' ? (
            <section className="card election-detail-section" aria-labelledby="results-section-heading">
              <div className="election-section-heading">
                <h2 id="results-section-heading">Final Election Results</h2>
              </div>

              {election.official_winner && (
                <div className="election-winner-banner" role="status">
                  <p className="election-winner-label">Official Winner</p>
                  <p className="election-winner-name">
                    {election.official_winner.name} ({election.official_winner.symbol}) &mdash;{' '}
                    {election.official_winner.votes}{' '}
                    {election.official_winner.votes === 1 ? 'vote' : 'votes'} (
                    {election.official_winner.vote_share_percent}%)
                  </p>
                </div>
              )}

              {election.results.visible && election.result_rows.length > 0 ? (
                <div className="result-list">
                  {election.result_rows.map((row) => (
                    <article key={row.candidate_id} className="result-item">
                      <div className="result-item-header">
                        <h3 className="candidate-title">{row.name}</h3>
                        <p className="result-tally">
                          {row.votes} {row.votes === 1 ? 'vote' : 'votes'} ({row.vote_share_percent}%)
                        </p>
                      </div>
                      <progress className="meter-bar" value={row.vote_share_percent} max={100}>
                        {row.vote_share_percent}%
                      </progress>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="state-panel" role="status">
                  <p>Final election results are awaiting official publication.</p>
                </div>
              )}
            </section>
          ) : election.status !== 'ACTIVE' ? (
            <section className="card election-detail-section" aria-labelledby="voting-status-heading">
              <div className="election-section-heading">
                <h2 id="voting-status-heading">Voting Status</h2>
              </div>
              <p className="election-voting-message">Voting is not currently open for this election.</p>
            </section>
          ) : null}
        </div>
      )}
    </BaseLayout>
  );
};
