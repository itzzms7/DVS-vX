import React from 'react';
import { BaseLayout } from '../components/BaseLayout';
import { AuthUser } from '../types/dvs';

interface HomeViewProps {
  user: AuthUser | null;
  data?: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  user,
  data,
  onNavigate,
  onLogout,
}) => {
  const hero = (
    <section className="hero landing-hero" aria-labelledby="landing-hero-title">
      <div className="landing-hero-inner">
        <p className="landing-kicker">DVS</p>
        <h1 id="landing-hero-title">Decentralised E-Voting System</h1>
        <p className="landing-subtitle">Voting, Made Smarter.</p>
        <p className="landing-lead">
          A digital platform for institutional elections, designed to make voting simple, accessible and transparent.
        </p>
        <div className="landing-hero-actions">
          <a
            href="/elections/"
            className="btn btn-secondary landing-explore-btn"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/elections/');
            }}
          >
            Explore the Platform
          </a>
        </div>
      </div>
    </section>
  );

  return (
    <BaseLayout
      title="DVS — Decentralised E-Voting System"
      containerClass="landing-page-container"
      user={user}
      onNavigate={onNavigate}
      onLogout={onLogout}
      hero={hero}
    >
      {data && (
        <div className="feedback-panel feedback-info is-visible" role="status">
          {data}
        </div>
      )}

      <div className="landing-sections">
        <section className="landing-section" aria-labelledby="landing-capabilities-heading">
          <header className="landing-section-header">
            <h2 id="landing-capabilities-heading">One Platform. Multiple Possibilities.</h2>
          </header>

          <div className="landing-capabilities-grid">
            <article className="landing-capability-item">
              <h3>Elections</h3>
              <p>Structured candidate ballots with verified voter rosters and auditable tally records.</p>
            </article>

            <article className="landing-capability-item">
              <h3>Polls</h3>
              <p>Quick preference checks for gathering structured institutional feedback.</p>
            </article>

            <article className="landing-capability-item">
              <h3>Referendums</h3>
              <p>Direct policy and resolution ballots for member-wide ratification.</p>
            </article>

            <article className="landing-capability-item">
              <h3>Corporate and organisational voting</h3>
              <p>Formal governance elections for boards, committees and institutional bodies.</p>
            </article>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="landing-audience-heading">
          <header className="landing-section-header">
            <h2 id="landing-audience-heading">Built for Every Scale.</h2>
          </header>

          <ul className="landing-audience-strip" aria-label="Target institutions and communities">
            <li className="landing-audience-item">
              <h3>Businesses</h3>
              <p>Board &amp; stakeholder governance</p>
            </li>
            <li className="landing-audience-item">
              <h3>Educational Institutions</h3>
              <p>Student councils &amp; academic senates</p>
            </li>
            <li className="landing-audience-item">
              <h3>Organisations</h3>
              <p>Societies, unions &amp; associations</p>
            </li>
            <li className="landing-audience-item">
              <h3>Communities</h3>
              <p>Civic groups &amp; member collectives</p>
            </li>
          </ul>
        </section>

        <section className="landing-section landing-trust-section" aria-labelledby="landing-trust-heading">
          <header className="landing-section-header">
            <h2 id="landing-trust-heading">Decisions You Can Trust.</h2>
          </header>

          <ul className="landing-trust-pillars" aria-label="Core trust principles">
            <li className="landing-trust-item">
              <h3>Secure</h3>
              <p>Authenticated voter eligibility and one-voter-one-ballot controls.</p>
            </li>
            <li className="landing-trust-item">
              <h3>Transparent</h3>
              <p>Clear election schedules, published candidate rosters and open tally rules.</p>
            </li>
            <li className="landing-trust-item">
              <h3>Verifiable</h3>
              <p>Deterministic ballot confirmation receipts and auditable on-chain tally reconciliation.</p>
            </li>
          </ul>

          <p className="landing-trust-note">
            Structured integrity checks and verifiable audit trails allow participants and administrators to independently confirm that recorded outcomes reflect eligible cast ballots.
          </p>
        </section>
      </div>
    </BaseLayout>
  );
};
