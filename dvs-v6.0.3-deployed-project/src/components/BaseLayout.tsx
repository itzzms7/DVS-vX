import React, { useState, useEffect } from 'react';
import { AuthUser } from '../types/dvs';

interface BaseLayoutProps {
  title?: string;
  containerClass?: string;
  navElectionsActive?: boolean;
  navAdminActive?: boolean;
  isControlPortal?: boolean;
  activeAdminSection?: 'create-elections' | 'voters' | 'officials';
  user: AuthUser | null;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  hero?: React.ReactNode;
  hideFooter?: boolean;
  children: React.ReactNode;
}

export const BaseLayout: React.FC<BaseLayoutProps> = ({
  title = 'DVS — Decentralized Civic Election Platform',
  containerClass = '',
  navElectionsActive = false,
  navAdminActive = false,
  isControlPortal = false,
  activeAdminSection,
  user,
  onNavigate,
  onLogout,
  hero,
  hideFooter = false,
  children,
}) => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && mobileNavOpen) {
        setMobileNavOpen(false);
        const toggleBtn = document.getElementById('btn-mobile-nav-toggle');
        if (toggleBtn) toggleBtn.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileNavOpen]);

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    setMobileNavOpen(false);
    onNavigate(path);
  };

  const handleSignOutClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setMobileNavOpen(false);
    onLogout();
  };

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header className="navbar" role="banner">
        <a
          href="/"
          className="logo"
          onClick={(e) => handleLinkClick(e, '/')}
        >
          DVS
        </a>

        <button
          type="button"
          id="btn-mobile-nav-toggle"
          className="mobile-nav-toggle"
          aria-expanded={mobileNavOpen ? 'true' : 'false'}
          aria-controls="primary-navigation"
          aria-label="Toggle navigation menu"
          onClick={() => setMobileNavOpen((prev) => !prev)}
        >
          {mobileNavOpen ? 'Close' : 'Menu'}
        </button>

        <nav
          id="primary-navigation"
          className={`nav-links${mobileNavOpen ? ' is-open' : ''}`}
          aria-label="Primary navigation"
        >
          {isControlPortal && user ? (
            <>
              {user.is_superuser && (
                <a
                  href="/control/?section=create-elections"
                  className={`nav-link ${activeAdminSection === 'create-elections' ? 'is-active' : ''}`}
                  onClick={(e) => handleLinkClick(e, '/control/?section=create-elections')}
                >
                  Create Elections
                </a>
              )}
              <a
                href="/control/?section=voters"
                className={`nav-link ${activeAdminSection === 'voters' ? 'is-active' : ''}`}
                onClick={(e) => handleLinkClick(e, '/control/?section=voters')}
              >
                Voters
              </a>
              {user.is_superuser && (
                <a
                  href="/control/?section=officials"
                  className={`nav-link ${activeAdminSection === 'officials' ? 'is-active' : ''}`}
                  onClick={(e) => handleLinkClick(e, '/control/?section=officials')}
                >
                  Officials
                </a>
              )}
            </>
          ) : (
            <>
              <a
                href="/elections/"
                className={`nav-link ${navElectionsActive ? 'is-active' : ''}`}
                onClick={(e) => handleLinkClick(e, '/elections/')}
              >
                Elections
              </a>
              <a
                href={user ? '/control/' : '/Admin.html'}
                className={`nav-link ${navAdminActive ? 'is-active' : ''}`}
                onClick={(e) => handleLinkClick(e, user ? '/control/' : '/Admin.html')}
              >
                {user ? 'Operations' : 'Sign In'}
              </a>
            </>
          )}
        </nav>

        <div className="nav-cta">
          {(user || isControlPortal) && (
            <a
              href="/AdminLogout"
              className="btn btn-secondary btn-nav"
              onClick={handleSignOutClick}
            >
              Sign Out
            </a>
          )}
        </div>
      </header>

      <div
        id="global-toast-region"
        className="toast-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />

      <main id="main-content" className="page-main">
        {hero}

        <div className={`page-container ${containerClass}`.trim()}>
          {children}
        </div>
      </main>

      {!hideFooter && (
        <footer className="footer" role="contentinfo">
          <div className="footer-inner">
            <a
              href="/"
              className="footer-brand"
              onClick={(e) => handleLinkClick(e, '/')}
            >
              DVS
            </a>
            <nav className="footer-links" aria-label="Footer navigation">
              <a
                href="/elections/"
                className="footer-link"
                onClick={(e) => handleLinkClick(e, '/elections/')}
              >
                Elections
              </a>
              <a
                href="/control/"
                className="footer-link"
                onClick={(e) => handleLinkClick(e, '/control/')}
              >
                Operations
              </a>
            </nav>
          </div>
        </footer>
      )}
    </>
  );
};
