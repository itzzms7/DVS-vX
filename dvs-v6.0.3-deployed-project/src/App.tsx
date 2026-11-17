import { useState, useEffect, useCallback } from 'react';
import {
  AuthUser,
  OfficialRecord,
  OfficialSubmissionResult,
  PublicElectionDetail,
  VerifiedReceipt,
  VoterRecord,
  VoterSubmissionResult,
  WizardCandidate,
  WizardDetails,
} from './types/dvs';
import { HomeView } from './views/HomeView';
import { ElectionsView } from './views/ElectionsView';
import { ElectionDetailView } from './views/ElectionDetailView';
import { VoteView } from './views/VoteView';
import { AdminLoginView } from './views/AdminLoginView';
import { AdminScreenView } from './views/AdminScreenView';
import { ViewCountView } from './views/ViewCountView';

const SESSION_STORAGE_KEY = 'dvs_session_token';

function getStoredSessionToken(): string {
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function storeSessionToken(token: string | null): void {
  try {
    if (token) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage access errors in restricted frames
  }
}

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getStoredSessionToken();
  if (token && !headers.has('X-DVS-Session')) {
    headers.set('X-DVS-Session', token);
  }
  const res = await fetch(input, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  const nextToken = res.headers.get('X-DVS-Session');
  if (nextToken) {
    storeSessionToken(nextToken);
  }
  return res;
}

function normalizeLocalDatetimeToIso(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return trimmed;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return parsed.toISOString();
}

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(
    () => window.location.pathname + window.location.search
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loginError, setLoginError] = useState<string>('');
  const [elections, setElections] = useState<PublicElectionDetail[]>([]);
  const [registeredVoters, setRegisteredVoters] = useState<VoterRecord[]>([]);
  const [registeredOfficials, setRegisteredOfficials] = useState<OfficialRecord[]>([]);
  const [detailMessages, setDetailMessages] = useState<Record<number, string[]>>({});
  const [sessionVoter, setSessionVoter] = useState<VoterRecord | null>(null);
  const [sessionElectionId, setSessionElectionId] = useState<number | null>(null);
  const [receiptsByElectionVoter, setReceiptsByElectionVoter] = useState<
    Record<string, VerifiedReceipt>
  >({});

  const refreshElections = useCallback(async (includeAll = false) => {
    try {
      const res = await apiFetch(
        `/api/public/elections/${includeAll ? '?include_all=true' : ''}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.elections)) {
          setElections(data.elections);
        }
      }
    } catch {
      // Keep current state if offline
    }
  }, []);

  const refreshPortalState = useCallback(async () => {
    try {
      const res = await apiFetch('/api/control/portal-state/');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.registered_voters)) {
          setRegisteredVoters(data.registered_voters);
        }
        if (Array.isArray(data.registered_officials)) {
          setRegisteredOfficials(data.registered_officials);
        }
      }
    } catch {
      // Ignore if not authenticated
    }
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const sessionRes = await apiFetch('/api/auth/session/');
        let isSuper = false;
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json();
          if (sessionData.user) {
            setUser(sessionData.user);
            isSuper = Boolean(sessionData.user.is_superuser);
          }
          if (sessionData.voter) {
            setSessionVoter(sessionData.voter);
          }
          if (sessionData.authenticated_election_id) {
            setSessionElectionId(sessionData.authenticated_election_id);
          }
        }
        await refreshElections(isSuper);
        if (isSuper) {
          await refreshPortalState();
        }
      } catch {
        await refreshElections(false);
      }
    };
    bootstrap();
  }, [refreshElections, refreshPortalState]);

  useEffect(() => {
    const [pathOnly] = currentPath.split('?');
    if (
      pathOnly === '/elections/' ||
      pathOnly === '/elections' ||
      pathOnly === '/public/elections/' ||
      pathOnly === '/vote/' ||
      pathOnly === '/vote' ||
      pathOnly === '/Vote.html' ||
      /^\/elections\/\d+\/?$/.test(pathOnly)
    ) {
      void refreshElections(Boolean(user?.is_superuser));
    }
  }, [currentPath, user, refreshElections]);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname + window.location.search);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    window.scrollTo(0, 0);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await apiFetch('/AdminLogout', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
    } catch {
      // Ignore
    }
    storeSessionToken(null);
    setUser(null);
    setLoginError('');
    await refreshElections(false);
    navigate('/');
  }, [navigate, refreshElections]);

  const handleAdminLogin = async (username: string, password: string) => {
    try {
      const res = await apiFetch('/AdminLogin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setLoginError(data.error || 'Invalid Admin credentials!');
        return;
      }
      setUser(data.user);
      setLoginError('');
      await refreshElections(Boolean(data.user?.is_superuser));
      await refreshPortalState();
      navigate(data.redirect || '/control/?section=create-elections');
    } catch {
      setLoginError('Invalid Admin credentials!');
    }
  };

  const handleRegisterVotersBatch = async (
    rawInput: string
  ): Promise<VoterSubmissionResult> => {
    try {
      const res = await apiFetch('/api/control/voters/batch/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voters_input: rawInput }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          registered_count: 0,
          rejected_count: 1,
          rejected_records: [
            {
              line_number: 1,
              raw_line: '',
              reason:
                data.error ||
                (res.status === 401 || res.status === 403
                  ? 'Administrator session expired. Please sign in again.'
                  : `Could not register voters (HTTP ${res.status}).`),
            },
          ],
        };
      }
      if (Array.isArray(data.registered_voters)) {
        setRegisteredVoters(data.registered_voters);
      }
      return {
        registered_count: data.registered_count || 0,
        rejected_count: data.rejected_count || 0,
        rejected_records: data.rejected_records || [],
      };
    } catch {
      return {
        registered_count: 0,
        rejected_count: 1,
        rejected_records: [
          {
            line_number: 1,
            raw_line: '',
            reason: 'Network error while submitting voters. Please try again.',
          },
        ],
      };
    }
  };

  const handleRegisterOfficialsBatch = async (
    rawInput: string
  ): Promise<OfficialSubmissionResult> => {
    try {
      const res = await apiFetch('/api/control/officials/batch/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officials_input: rawInput }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          registered_count: 0,
          rejected_count: 1,
          rejected_records: [
            {
              line_number: 1,
              official_id: '',
              reason:
                data.error ||
                (res.status === 401 || res.status === 403
                  ? 'Superuser session expired. Please sign in again.'
                  : `Could not register officials (HTTP ${res.status}).`),
            },
          ],
        };
      }
      if (Array.isArray(data.registered_officials)) {
        setRegisteredOfficials(data.registered_officials);
      }
      return {
        registered_count: data.registered_count || 0,
        rejected_count: data.rejected_count || 0,
        rejected_records: data.rejected_records || [],
      };
    } catch {
      return {
        registered_count: 0,
        rejected_count: 1,
        rejected_records: [
          {
            line_number: 1,
            official_id: '',
            reason: 'Network error while submitting officials. Please try again.',
          },
        ],
      };
    }
  };

  const handleDeleteOfficial = async (officialId: number): Promise<void> => {
    const res = await apiFetch(`/control/officials/${officialId}/delete/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.registered_officials)) {
        setRegisteredOfficials(data.registered_officials);
      }
    }
  };

  const handleCreateElectionFromWizard = async ({
    details,
    candidates,
    includedVoterIds,
  }: {
    details: WizardDetails;
    candidates: WizardCandidate[];
    includedVoterIds: string[];
  }): Promise<{ electionId?: number; error?: string }> => {
    try {
      const normalizedDetails: WizardDetails = {
        ...details,
        start_datetime_input: normalizeLocalDatetimeToIso(details.start_datetime_input),
        end_datetime_input: normalizeLocalDatetimeToIso(details.end_datetime_input),
      };
      const res = await apiFetch('/api/control/elections/wizard-create/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          details: normalizedDetails,
          candidates,
          includedVoterIds,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { error: data.error || 'Could not create election.' };
      }
      await refreshElections(Boolean(user?.is_superuser));
      setDetailMessages((prev) => ({
        ...prev,
        [data.electionId]: [
          `Election '${details.title}' has been created successfully.`,
        ],
      }));
      return { electionId: data.electionId };
    } catch {
      return { error: 'Could not create election.' };
    }
  };

  const handleAuthenticateVoter = async (voterId: string, electionId: number) => {
    const res = await apiFetch('/api/voter/authenticate/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voter_id: voterId, election_id: electionId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'Authentication failed.',
      };
    }

    setSessionVoter({
      id: 0,
      aadhar_number: voterId,
      voter_id: voterId,
      name: data.voter_name || 'Voter',
      phone: '',
      has_voted: Boolean(data.has_voted),
    });
    setSessionElectionId(electionId);

    return {
      success: true,
      has_voted: Boolean(data.has_voted),
      voter_name: data.voter_name,
      voter_id_masked: data.voter_id_masked,
      election_title: data.election_title,
    };
  };

  const handleSubmitVote = async (electionId: number, candidateId: number) => {
    const res = await apiFetch('/api/voter/cast/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ election_id: electionId, candidate_id: candidateId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'Vote submission failed.',
      };
    }

    if (sessionVoter) {
      const receiptKey = `${electionId}:${sessionVoter.aadhar_number}`;
      setReceiptsByElectionVoter((prev) => ({
        ...prev,
        [receiptKey]: {
          tx_hash: data.tx_hash,
          block_number: data.block_number,
          contract_address: '',
          election_id: electionId,
          election_title: data.election_title,
          confirmed_at: data.confirmed_at,
          receipt_reference: data.receipt_reference,
        },
      }));
    }

    await refreshElections(Boolean(user?.is_superuser));

    return {
      success: true,
      receipt_reference: data.receipt_reference,
      tx_hash: data.tx_hash,
      block_number: data.block_number,
      confirmed_at: data.confirmed_at,
      election_title: data.election_title,
    };
  };

  const [pathname, rawSearch = ''] = currentPath.split('?');
  const searchParams = new URLSearchParams(rawSearch);

  if (
    pathname === '/elections/' ||
    pathname === '/elections' ||
    pathname === '/public/elections/'
  ) {
    const statusFilter =
      (searchParams.get('status') || 'ACTIVE').toUpperCase() === 'COMPLETED'
        ? 'COMPLETED'
        : 'ACTIVE';
    const activeElections = elections.filter((e) => e.status === 'ACTIVE');
    const completedElections = elections.filter(
      (e) => e.status === 'CLOSED' || e.status === 'FINALIZED'
    );
    return (
      <ElectionsView
        user={user}
        activeElections={activeElections}
        completedElections={completedElections}
        initialCategory={statusFilter}
        onNavigate={navigate}
        onLogout={handleLogout}
      />
    );
  }

  const electionDetailMatch = pathname.match(/^\/elections\/(\d+)\/?$/);
  if (electionDetailMatch) {
    const requestedId = Number(electionDetailMatch[1]);
    const found = elections.find((e) => e.election_id === requestedId) || null;
    const visible =
      found &&
      (found.status === 'ACTIVE' ||
        found.status === 'CLOSED' ||
        found.status === 'FINALIZED' ||
        Boolean(user?.is_superuser));
    return (
      <ElectionDetailView
        user={user}
        election={visible ? found : null}
        messages={detailMessages[requestedId] || []}
        onNavigate={navigate}
        onLogout={handleLogout}
      />
    );
  }

  if (pathname === '/vote/' || pathname === '/vote' || pathname === '/Vote.html') {
    const requestedElectionId = Number(searchParams.get('election_id') || 2026);
    const publicElections = elections.filter((e) => e.status !== 'DRAFT');
    const selectedElection =
      publicElections.find((e) => e.election_id === requestedElectionId) ||
      publicElections[0] ||
      null;
    const isSessionAuthForElection = Boolean(
      sessionVoter &&
        selectedElection &&
        sessionElectionId === selectedElection.election_id
    );
    const receiptKey =
      isSessionAuthForElection && sessionVoter && selectedElection
        ? `${selectedElection.election_id}:${sessionVoter.aadhar_number}`
        : '';
    const verifiedReceipt = receiptKey ? receiptsByElectionVoter[receiptKey] || null : null;

    return (
      <VoteView
        user={user}
        election={selectedElection}
        publicElections={publicElections}
        sessionVoter={isSessionAuthForElection ? sessionVoter : null}
        voterIsEligible={isSessionAuthForElection ? true : null}
        voterHasVoted={Boolean(verifiedReceipt || sessionVoter?.has_voted)}
        verifiedReceipt={verifiedReceipt}
        onSwitchElection={(newId) => navigate(`/vote/?election_id=${newId}`)}
        onAuthenticateVoter={handleAuthenticateVoter}
        onSubmitVote={handleSubmitVote}
        onNavigate={navigate}
        onLogout={handleLogout}
      />
    );
  }

  if (
    pathname === '/admin/' ||
    pathname === '/admin' ||
    pathname === '/Admin.html' ||
    pathname === '/AdminLogin'
  ) {
    return (
      <AdminLoginView
        user={user}
        errorData={loginError}
        onLogin={handleAdminLogin}
        onNavigate={navigate}
        onLogout={handleLogout}
      />
    );
  }

  if (pathname === '/control/' || pathname === '/control') {
    if (!user) {
      return (
        <AdminLoginView
          user={null}
          errorData={loginError}
          onLogin={handleAdminLogin}
          onNavigate={navigate}
          onLogout={handleLogout}
        />
      );
    }
    const rawSection = (searchParams.get('section') || '').toLowerCase();
    let activeSection: 'create-elections' | 'voters' | 'officials' = user.is_superuser
      ? 'create-elections'
      : 'voters';
    if (rawSection === 'voters') {
      activeSection = 'voters';
    } else if (rawSection === 'officials' && user.is_superuser) {
      activeSection = 'officials';
    } else if (rawSection === 'create-elections' && user.is_superuser) {
      activeSection = 'create-elections';
    }

    return (
      <AdminScreenView
        user={user}
        activeAdminSection={activeSection}
        selectedElectionId={elections[0]?.election_id}
        registeredVoters={registeredVoters}
        registeredOfficials={registeredOfficials}
        onRegisterVotersBatch={handleRegisterVotersBatch}
        onRegisterOfficialsBatch={handleRegisterOfficialsBatch}
        onDeleteOfficial={handleDeleteOfficial}
        onCreateElectionFromWizard={handleCreateElectionFromWizard}
        onNavigate={navigate}
        onLogout={handleLogout}
      />
    );
  }

  if (pathname === '/ViewCount' || pathname === '/ViewCountAction') {
    return (
      <ViewCountView
        user={user}
        onInspectCandidate={() => {}}
        onNavigate={navigate}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <HomeView
      user={user}
      onNavigate={navigate}
      onLogout={handleLogout}
    />
  );
}
