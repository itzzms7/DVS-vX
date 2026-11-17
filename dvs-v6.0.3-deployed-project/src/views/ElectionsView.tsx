import React, { useState } from 'react';
import { BaseLayout } from '../components/BaseLayout';
import { AuthUser, PublicElectionDetail } from '../types/dvs';

interface ElectionsViewProps {
  user: AuthUser | null;
  activeElections: PublicElectionDetail[];
  completedElections: PublicElectionDetail[];
  initialCategory?: 'ACTIVE' | 'COMPLETED';
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

function formatDayMonthYear(iso: string | null | undefined): string {
  if (!iso) return 'Not set';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const ElectionsView: React.FC<ElectionsViewProps> = ({
  user,
  activeElections,
  completedElections,
  initialCategory = 'ACTIVE',
  onNavigate,
  onLogout,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<'ACTIVE' | 'COMPLETED'>(initialCategory);

  const hero = (
    <section className="hero elections-hero" aria-labelledby="elections-page-title">
      <div className="elections-hero-inner">
        <h1 id="elections-page-title">Elections</h1>
        <div className="elections-category-switch" role="tablist" aria-label="Election category">
          <button
            type="button"
            id="tab-elections-active"
            className={`elections-switch-btn ${selectedCategory !== 'COMPLETED' ? 'is-active' : ''}`}
            role="tab"
            aria-selected={selectedCategory !== 'COMPLETED' ? 'true' : 'false'}
            aria-controls="panel-elections-active"
            data-category-switch="ACTIVE"
            onClick={() => setSelectedCategory('ACTIVE')}
          >
            Active
          </button>
          <button
            type="button"
            id="tab-elections-completed"
            className={`elections-switch-btn ${selectedCategory === 'COMPLETED' ? 'is-active' : ''}`}
            role="tab"
            aria-selected={selectedCategory === 'COMPLETED' ? 'true' : 'false'}
            aria-controls="panel-elections-completed"
            data-category-switch="COMPLETED"
            onClick={() => setSelectedCategory('COMPLETED')}
          >
            Completed
          </button>
        </div>
      </div>
    </section>
  );

  return (
    <BaseLayout
      title="Elections — DVS"
      containerClass="elections-page-container"
      navElectionsActive
      user={user}
      onNavigate={onNavigate}
      onLogout={onLogout}
      hero={hero}
    >
      <section
        id="panel-elections-active"
        className={`elections-category-panel ${selectedCategory === 'COMPLETED' ? 'is-hidden' : ''}`}
        role="tabpanel"
        aria-labelledby="tab-elections-active"
        data-category-panel="ACTIVE"
      >
        {activeElections.length > 0 ? (
          <div className="public-elections-grid">
            {activeElections.map((el) => (
              <a
                key={el.election_id}
                href={`/elections/${el.election_id}/`}
                className="public-election-card"
                data-election-card="ACTIVE"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(`/elections/${el.election_id}/`);
                }}
              >
                <h2 className="public-election-title">{el.title}</h2>
                <p className="public-election-date">
                  Starting date: {formatDayMonthYear(el.start_datetime || el.created_at)}
                </p>
              </a>
            ))}
          </div>
        ) : (
          <div className="elections-empty-state" role="status">
            <p>No active elections available.</p>
          </div>
        )}
      </section>

      <section
        id="panel-elections-completed"
        className={`elections-category-panel ${selectedCategory !== 'COMPLETED' ? 'is-hidden' : ''}`}
        role="tabpanel"
        aria-labelledby="tab-elections-completed"
        data-category-panel="COMPLETED"
      >
        {completedElections.length > 0 ? (
          <div className="public-elections-grid">
            {completedElections.map((el) => (
              <a
                key={el.election_id}
                href={`/elections/${el.election_id}/`}
                className="public-election-card"
                data-election-card="COMPLETED"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(`/elections/${el.election_id}/`);
                }}
              >
                <h2 className="public-election-title">{el.title}</h2>
                <p className="public-election-date">
                  End date: {formatDayMonthYear(el.end_datetime || el.finalized_at || el.updated_at)}
                </p>
              </a>
            ))}
          </div>
        ) : (
          <div className="elections-empty-state" role="status">
            <p>No completed elections available.</p>
          </div>
        )}
      </section>
    </BaseLayout>
  );
};
