import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  store,
  maskAadhar,
  deriveVoterNullifier,
  isElectionPubliclyVisible,
  isElectionVotingOpen,
  syncElectionStateInPlace,
  resolveCandidateSymbolPath,
  parseCandidateDataUriSymbol,
  resolvePublicCandidateSymbolUrl,
} from './src/server/store.ts';
import {
  DEFAULT_RPC_URL,
  DEFAULT_CHAIN_ID,
  ensureLocalBlockchainReady,
  deployAndBootstrapElectionOnChain,
  castVoteOnChain,
  inspectAndReconcileOnChain,
  closeElectionOnChain,
} from './src/server/blockchain.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SessionData {
  staffUserId?: number;
  authenticatedVoterId?: number;
  authenticatedElectionId?: number;
  authenticatedElectionIds?: number[];
  voterAuthenticatedAt?: string;
}

const SESSION_COOKIE_NAME = 'dvs_sid';
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.DVS_SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(
      `${process.env.SQL_PASSWORD || 'dvs-local-secret'}:${
        process.env.DVS_SUPERUSER_PASSWORD || 'admin1234'
      }:dvs-session-v1`
    )
    .digest('hex');

const requestSessions = new WeakMap<Request, SessionData>();

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      try {
        result[k] = decodeURIComponent(v);
      } catch {
        result[k] = v;
      }
    }
  });
  return result;
}

function signSessionPayload(payloadB64: string): string {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadB64)
    .digest('base64url');
}

function encodeSessionToken(session: SessionData): string {
  const payloadB64 = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const sig = signSessionPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

function decodeSessionToken(token: string | undefined): SessionData | null {
  if (!token) return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const payloadB64 = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!payloadB64 || !sig) return null;
  const expectedSig = signSessionPayload(payloadB64);
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object') {
      return parsed as SessionData;
    }
    return null;
  } catch {
    return null;
  }
}

function isHttpsRequest(req: Request): boolean {
  const xfProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return req.secure || xfProto === 'https';
}

function saveSession(req: Request, res: Response, session: SessionData): void {
  requestSessions.set(req, session);
  const token = encodeSessionToken(session);
  const sameSiteAttrs = isHttpsRequest(req) ? 'SameSite=None; Secure' : 'SameSite=Lax';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Max-Age=604800; ${sameSiteAttrs}`
  );
  res.setHeader('X-DVS-Session', token);
}

function getOrCreateSession(req: Request, _res: Response): SessionData {
  const existing = requestSessions.get(req);
  if (existing) return existing;
  const cookies = parseCookies(req.headers.cookie);
  const headerToken =
    typeof req.headers['x-dvs-session'] === 'string'
      ? req.headers['x-dvs-session']
      : undefined;
  const decoded =
    decodeSessionToken(cookies[SESSION_COOKIE_NAME]) ||
    decodeSessionToken(headerToken) ||
    {};
  requestSessions.set(req, decoded);
  return decoded;
}

function getAuthenticatedStaffUser(req: Request, res: Response) {
  const session = getOrCreateSession(req, res);
  if (!session.staffUserId) return null;
  return store.staffUsers.find((u) => u.id === session.staffUserId) || null;
}

function getAuthenticatedVoter(req: Request, res: Response) {
  const session = getOrCreateSession(req, res);
  if (!session.authenticatedVoterId) return null;
  return (
    store.voters.find(
      (v) => v.id === session.authenticatedVoterId && v.status === 'ACTIVE'
    ) || null
  );
}

interface RecentVoterAuthEntry {
  voterId: number;
  aadharNumber: string;
  electionId: number;
  authenticatedAtMs: number;
}

// Tracks recently authenticated voters per election (30-minute window matching dvs-vote timeout)
// so cross-origin or proxied requests from dvs-vote that strip cookies still resolve the voter.
const VOTER_AUTH_TTL_MS = 30 * 60 * 1000;
const recentVoterAuthByElection = new Map<number, RecentVoterAuthEntry>();

function recordRecentVoterAuthentication(
  voterId: number,
  aadharNumber: string,
  electionId: number
): void {
  recentVoterAuthByElection.set(electionId, {
    voterId,
    aadharNumber,
    electionId,
    authenticatedAtMs: Date.now(),
  });
}

function resolveVoterForBallotCast(
  req: Request,
  res: Response,
  electionId: number
) {
  // 1. Check explicit voter_id in request body if provided
  const rawBodyVoterId = String(req.body.voter_id || '')
    .trim()
    .replace(/\D/g, '');
  if (rawBodyVoterId.length === 12) {
    const bodyVoter = store.voters.find(
      (v) => v.aadhar_number === rawBodyVoterId && v.status === 'ACTIVE'
    );
    if (bodyVoter) return bodyVoter;
  }

  // 2. Check session cookie / X-DVS-Session header
  const sessionVoter = getAuthenticatedVoter(req, res);
  const session = getOrCreateSession(req, res);
  const isSessionAuthenticatedForElection =
    session.authenticatedElectionId === electionId ||
    Boolean(session.authenticatedElectionIds?.includes(electionId));
  if (sessionVoter && isSessionAuthenticatedForElection) {
    return sessionVoter;
  }
  if (sessionVoter) {
    const hasElig = store.voterEligibilities.some(
      (ve) =>
        ve.voter_id === sessionVoter.id &&
        ve.election_id === electionId &&
        ve.is_eligible
    );
    if (hasElig) return sessionVoter;
  }

  // 3. Check in-memory recent authentication for this election (handles proxy/cross-origin cookie stripping)
  const nowMs = Date.now();
  const recentMem = recentVoterAuthByElection.get(electionId);
  if (recentMem && nowMs - recentMem.authenticatedAtMs <= VOTER_AUTH_TTL_MS) {
    const memVoter = store.voters.find(
      (v) => v.id === recentMem.voterId && v.status === 'ACTIVE'
    );
    if (memVoter) return memVoter;
  }

  // 4. Check persisted VOTER_AUTHENTICATED audit logs in PostgreSQL (handles multi-instance Cloud Run)
  for (const log of store.auditLogs) {
    if (
      log.action === 'VOTER_AUTHENTICATED' &&
      Number(log.target_id) === electionId
    ) {
      const logTimeMs = new Date(log.timestamp).getTime();
      if (!Number.isNaN(logTimeMs) && nowMs - logTimeMs <= VOTER_AUTH_TTL_MS) {
        const auditVoter = store.voters.find(
          (v) => v.aadhar_number === log.actor_username && v.status === 'ACTIVE'
        );
        if (auditVoter) return auditVoter;
      }
    }
  }

  return null;
}

const DVS_VERSION = '6.0.3';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.set('trust proxy', 1);
  app.use((req: Request, res: Response, next) => {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Accept, Authorization, X-CSRFToken, X-DVS-Session, X-Requested-With'
    );
    res.setHeader('Access-Control-Expose-Headers', 'X-DVS-Session, X-DVS-Version');
    res.setHeader('X-DVS-Version', DVS_VERSION);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use(async (req: Request, res: Response, next) => {
    if (
      req.path === '/healthz' ||
      req.path === '/healthz/' ||
      req.path === '/api/health' ||
      req.path === '/api/health/'
    ) {
      next();
      return;
    }
    if (
      req.path.startsWith('/api/') ||
      req.path === '/AdminLogin' ||
      req.path === '/AdminLogout' ||
      req.path.startsWith('/control/')
    ) {
      res.setHeader('Cache-Control', 'no-store');
      await store.syncFromDatabase(false);
    }
    next();
  });

  // =========================================================================
  // 1. Health & Operational Readiness Routes
  // =========================================================================
  const healthHandler = (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'DVS',
      version: DVS_VERSION,
      database: store.dbConnected ? 'ok' : 'fallback',
      chain_id: DEFAULT_CHAIN_ID,
      timestamp: new Date().toISOString(),
    });
  };
  app.get('/healthz/', healthHandler);
  app.get('/healthz', healthHandler);
  app.get('/api/health/', healthHandler);
  app.get('/api/health', healthHandler);

  // =========================================================================
  // 1b. Candidate Symbol Media Endpoint (Decodes stored Data URIs as HTTP images)
  // =========================================================================
  app.get(
    '/media/candidate-symbols/:election_id/:candidate_file',
    async (req: Request, res: Response) => {
      await store.syncFromDatabase(false);
      const electionId = Number(req.params.election_id);
      const rawFile = String(req.params.candidate_file || '');
      const candidateIdNum = Number(rawFile.split('.')[0]);

      if (!Number.isFinite(electionId) || !Number.isFinite(candidateIdNum)) {
        res.status(404).end();
        return;
      }

      const candidate = store.candidates.find(
        (c) => c.election_id === electionId && c.candidate_id_num === candidateIdNum
      );
      if (!candidate) {
        res.status(404).end();
        return;
      }

      const parsed = parseCandidateDataUriSymbol(candidate.symbol_image_url);
      if (parsed) {
        res.setHeader('Content-Type', parsed.mimeType);
        res.setHeader('Content-Length', String(parsed.buffer.length));
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(200).end(parsed.buffer);
        return;
      }

      const [fallbackSymSrc] = resolveCandidateSymbolPath(candidate.symbol);
      const targetUrl = candidate.symbol_image_url || fallbackSymSrc;
      res.redirect(302, targetUrl);
    }
  );

  // =========================================================================
  // 2. Session & Staff Authentication Routes
  // =========================================================================
  app.get('/api/auth/session/', (req: Request, res: Response) => {
    const staff = getAuthenticatedStaffUser(req, res);
    const voter = getAuthenticatedVoter(req, res);
    const session = getOrCreateSession(req, res);
    res.json({
      user: staff
        ? {
            id: staff.id,
            username: staff.username,
            name: staff.name,
            is_superuser: staff.is_superuser,
            portal_role: staff.portal_role,
          }
        : null,
      voter: voter
        ? {
            id: voter.id,
            aadhar_number: voter.aadhar_number,
            voter_id: voter.aadhar_number,
            name: voter.name,
            phone: voter.phone,
            has_voted: voter.has_voted,
          }
        : null,
      authenticated_election_id: session.authenticatedElectionId || null,
    });
  });

  app.post('/AdminLogin', (req: Request, res: Response) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!username || !password) {
      res.status(400).json({ error: 'Invalid Admin credentials!' });
      return;
    }

    const matched = store.staffUsers.find(
      (u) => u.username.toLowerCase() === username.toLowerCase() && u.password === password
    );

    if (!matched) {
      res.status(401).json({ error: 'Invalid Admin credentials!' });
      return;
    }

    const session = getOrCreateSession(req, res);
    session.staffUserId = matched.id;
    saveSession(req, res, session);

    store.logAudit(
      matched.username,
      'ADMIN_LOGIN_SUCCESS',
      'User',
      String(matched.id),
      `Role: ${matched.portal_role}; Groups: ${JSON.stringify(matched.groups)}`
    );

    res.json({
      success: true,
      user: {
        id: matched.id,
        username: matched.username,
        name: matched.name,
        is_superuser: matched.is_superuser,
        portal_role: matched.portal_role,
      },
      redirect: matched.is_superuser
        ? '/control/?section=create-elections'
        : '/control/?section=voters',
    });
  });

  const logoutHandler = (req: Request, res: Response) => {
    const session = getOrCreateSession(req, res);
    delete session.staffUserId;
    saveSession(req, res, session);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      res.json({ success: true });
      return;
    }
    res.redirect('/');
  };
  app.post('/AdminLogout', logoutHandler);
  app.get('/AdminLogout', logoutHandler);

  // =========================================================================
  // 3. Public Elections Catalog & Detail APIs
  // =========================================================================
  const publicElectionsHandler = async (req: Request, res: Response) => {
    await store.syncFromDatabase(true);
    const now = new Date();
    const staff = getAuthenticatedStaffUser(req, res);
    const includeAllForSuperuser =
      Boolean(staff?.is_superuser) && req.query.include_all === 'true';

    const visibleElections = store.elections
      .filter((el) => {
        syncElectionStateInPlace(el, now);
        if (includeAllForSuperuser) return true;
        return isElectionPubliclyVisible(el, now);
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const summaries = visibleElections.map((el) => store.buildPublicElectionContext(el));
    res.json({ elections: summaries });
  };
  app.get('/api/public/elections/', publicElectionsHandler);
  app.get('/api/public/elections', publicElectionsHandler);

  const publicElectionDetailHandler = (req: Request, res: Response) => {
    const electionId = Number(req.params.election_id);
    const now = new Date();
    const election = store.getElectionByAnyId(electionId);
    if (!election) {
      res.status(404).json({ error: 'Election not found.' });
      return;
    }
    const staff = getAuthenticatedStaffUser(req, res);
    if (!isElectionPubliclyVisible(election, now) && !staff?.is_superuser) {
      res.status(404).json({ error: 'Election is not currently available.' });
      return;
    }
    res.json(store.buildPublicElectionContext(election));
  };
  app.get('/api/public/elections/:election_id/', publicElectionDetailHandler);
  app.get('/api/public/elections/:election_id', publicElectionDetailHandler);

  // =========================================================================
  // 4. Voter Authentication & Ballot Casting APIs
  // =========================================================================
  const voterAuthenticateHandler = async (req: Request, res: Response) => {
    try {
      await store.syncFromDatabase(true);
      const rawId = String(req.body.voter_id || '')
        .trim()
        .replace(/\D/g, '');
      const electionId = Number(req.body.election_id);
      if (rawId.length !== 12) {
        res.status(400).json({ error: 'Enter a valid 12-digit Voter ID.' });
        return;
      }

      const now = new Date();
      const election = store.getElectionByAnyId(electionId);
      if (!election || !isElectionVotingOpen(election, now)) {
        res
          .status(400)
          .json({ error: 'This election is not currently open for voting.' });
        return;
      }

      const voter = store.voters.find(
        (v) => v.aadhar_number === rawId && v.status === 'ACTIVE'
      );
      if (!voter) {
        res
          .status(404)
          .json({ error: 'Voter ID was not found in the active voter registry.' });
        return;
      }
      if (voter.security_flagged) {
        res.status(403).json({
          error:
            voter.security_flag_reason ||
            'This voter record requires administrator review.',
        });
        return;
      }

      const eligibility = store.voterEligibilities.find(
        (ve) =>
          ve.voter_id === voter.id &&
          ve.election_id === election.election_id &&
          ve.is_eligible
      );
      if (!eligibility) {
        res.status(403).json({
          error: 'This voter is not registered as eligible for this election.',
        });
        return;
      }

      const session = getOrCreateSession(req, res);
      if (session.authenticatedVoterId !== voter.id) {
        session.authenticatedElectionIds = [];
      }
      session.authenticatedVoterId = voter.id;
      session.authenticatedElectionId = election.election_id;
      if (!session.authenticatedElectionIds) {
        session.authenticatedElectionIds = [];
      }
      if (!session.authenticatedElectionIds.includes(election.election_id)) {
        session.authenticatedElectionIds.push(election.election_id);
      }
      session.voterAuthenticatedAt = now.toISOString();
      saveSession(req, res, session);

      recordRecentVoterAuthentication(
        voter.id,
        voter.aadhar_number,
        election.election_id
      );
      await store.logAudit(
        voter.aadhar_number,
        'VOTER_AUTHENTICATED',
        'Election',
        String(election.election_id),
        {
          voter_id: voter.id,
          election_id: election.election_id,
          has_voted: eligibility.has_voted,
        }
      );

      res.json({
        success: true,
        has_voted: eligibility.has_voted,
        voter_name: voter.name,
        voter_id_masked: maskAadhar(voter.aadhar_number),
        phone: voter.phone,
        election_title: election.title,
      });
    } catch {
      res.status(400).json({ error: 'Invalid authentication request.' });
    }
  };
  app.post('/api/voter/authenticate/', voterAuthenticateHandler);
  app.post('/api/voter/authenticate', voterAuthenticateHandler);

  const voterCastHandler = async (req: Request, res: Response) => {
    try {
      await store.syncFromDatabase(true);
      const electionId = Number(req.body.election_id);
      const candidateId = Number(req.body.candidate_id);

      const now = new Date();
      const election = store.getElectionByAnyId(electionId);
      if (!election || !isElectionVotingOpen(election, now)) {
        res
          .status(400)
          .json({ error: 'Voting is not currently open for this election.' });
        return;
      }

      const voter = resolveVoterForBallotCast(req, res, election.election_id);
      if (!voter) {
        res.status(401).json({
          error: 'Authenticate as an eligible voter before submitting a ballot.',
        });
        return;
      }

      const electionCandidates = store.candidates.filter(
        (c) => c.election_id === election.election_id && c.is_active
      );
      const candidate = electionCandidates.find(
        (c) => c.candidate_id_num === candidateId
      );
      if (!candidate) {
        res
          .status(400)
          .json({ error: 'Select a valid candidate from this election.' });
        return;
      }

      if (voter.security_flagged) {
        res.status(403).json({
          error:
            voter.security_flag_reason ||
            'This voter record requires administrator review.',
        });
        return;
      }

      const eligibility = store.voterEligibilities.find(
        (ve) =>
          ve.voter_id === voter.id &&
          ve.election_id === election.election_id &&
          ve.is_eligible
      );
      if (!eligibility) {
        res.status(403).json({ error: 'Voter eligibility could not be confirmed.' });
        return;
      }
      if (eligibility.has_voted) {
        res
          .status(409)
          .json({ error: 'A ballot has already been recorded for this voter.' });
        return;
      }

      const confirmedAt = now.toISOString();
      const voterHash = deriveVoterNullifier(
        election.election_id,
        voter.name,
        voter.aadhar_number
      );

      const previousContractAddress = election.contract_address;

      // Submit ballot transaction to EVoting smart contract on Hardhat (Chain ID 31337)
      const onchainResult = await castVoteOnChain(
        election,
        electionCandidates,
        candidate.candidate_id_num,
        voterHash
      );

      if (
        onchainResult.contractAddress &&
        onchainResult.contractAddress !== previousContractAddress
      ) {
        election.contract_address = onchainResult.contractAddress;
        election.deployment_status = 'DEPLOYED';
        election.updated_at = confirmedAt;
        await store.persistElectionUpdate(election);
      }

      const txHash = onchainResult.txHash;
      const blockNumber = onchainResult.blockNumber;
      const receiptReference = `DVS-${election.election_id}-${blockNumber}-${txHash
        .slice(2, 10)
        .toUpperCase()}`;

      const newReceipt = {
        id: store.ballotReceipts.reduce((m, r) => Math.max(m, r.id), 0) + 1,
        voter_id: voter.id,
        election_id: election.election_id,
        candidate_id: candidate.candidate_id_num,
        voter_hash: voterHash,
        contract_address: onchainResult.contractAddress || election.contract_address,
        tx_hash: txHash,
        block_number: blockNumber,
        receipt_reference: receiptReference,
        confirmed_at: confirmedAt,
      };
      store.ballotReceipts.push(newReceipt);

      eligibility.has_voted = true;
      eligibility.voted_at = confirmedAt;
      voter.has_voted = true;
      voter.voted_at = confirmedAt;

      await store.persistBallotCast(newReceipt, eligibility, voter);

      res.json({
        success: true,
        receipt_reference: receiptReference,
        tx_hash: txHash,
        block_number: blockNumber,
        confirmed_at: confirmedAt,
        election_title: election.title,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ballot submission failed.';
      res.status(500).json({ error: msg });
    }
  };
  app.post('/api/voter/cast/', voterCastHandler);
  app.post('/api/voter/cast', voterCastHandler);

  // =========================================================================
  // 5. Control Portal State & Batch Admin Endpoints (AdminScreen.html)
  // =========================================================================
  app.get('/api/control/portal-state/', async (req: Request, res: Response) => {
    await store.syncFromDatabase(true);
    const staff = getAuthenticatedStaffUser(req, res);
    if (!staff) {
      res.status(403).json({ error: 'Authentication required.' });
      return;
    }

    const votersList = store.voters.map((v) => ({
      id: v.id,
      aadhar_number: v.aadhar_number,
      voter_id: v.aadhar_number,
      name: v.name,
      phone: v.phone,
      has_voted: v.has_voted,
      security_flagged: v.security_flagged,
    }));

    const officialsList = store.staffUsers
      .filter((u) => !u.is_superuser)
      .map((u) => ({
        id: u.id,
        official_id: u.username,
        name: u.name,
      }));

    res.json({
      registered_voters: votersList,
      registered_officials: officialsList,
    });
  });

  app.post('/api/control/voters/batch/', async (req: Request, res: Response) => {
    await store.syncFromDatabase(true);
    const staff = getAuthenticatedStaffUser(req, res);
    if (!staff) {
      res.status(403).json({ error: 'Authentication required.' });
      return;
    }

    const rawInput = String(req.body.voters_input || '');
    const lines = rawInput.split(/\r?\n/);
    let registeredCount = 0;
    const rejectedRecords: Array<{
      line_number: number;
      raw_line: string;
      reason: string;
    }> = [];

    for (let idx = 0; idx < lines.length; idx++) {
      const rawLine = lines[idx];
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      const lineNum = idx + 1;
      const parts = trimmed.split(',').map((s) => s.trim());
      if (parts.length < 2) {
        rejectedRecords.push({
          line_number: lineNum,
          raw_line: trimmed,
          reason: 'Expected format: VoterID (12 digits), Name, Phone',
        });
        continue;
      }
      const [voterId, name, phone = ''] = parts;
      if (!/^\d{12}$/.test(voterId)) {
        rejectedRecords.push({
          line_number: lineNum,
          raw_line: trimmed,
          reason: 'Voter ID must be exactly 12 numeric digits.',
        });
        continue;
      }
      if (!name) {
        rejectedRecords.push({
          line_number: lineNum,
          raw_line: trimmed,
          reason: 'Voter name is required.',
        });
        continue;
      }
      if (store.voters.some((v) => v.aadhar_number === voterId)) {
        rejectedRecords.push({
          line_number: lineNum,
          raw_line: trimmed,
          reason: 'Voter ID is already registered.',
        });
        continue;
      }

      const newVoter = {
        id: store.voters.reduce((m, v) => Math.max(m, v.id), 0) + 1,
        name,
        aadhar_number: voterId,
        phone,
        bound_wallet: null,
        status: 'ACTIVE' as const,
        has_voted: false,
        voted_at: null,
        is_synthetic: false,
        security_flagged: false,
        security_flag_reason: '',
        created_at: new Date().toISOString(),
      };
      store.voters.unshift(newVoter);
      await store.persistVoterInsert(newVoter);
      registeredCount += 1;
    }

    store.logAudit(staff.username, 'VOTERS_BATCH_REGISTERED', 'Voter', 'batch', {
      registered_count: registeredCount,
      rejected_count: rejectedRecords.length,
    });

    res.json({
      registered_count: registeredCount,
      rejected_count: rejectedRecords.length,
      rejected_records: rejectedRecords,
      registered_voters: store.voters.map((v) => ({
        id: v.id,
        aadhar_number: v.aadhar_number,
        voter_id: v.aadhar_number,
        name: v.name,
        phone: v.phone,
        has_voted: v.has_voted,
      })),
    });
  });

  app.post('/api/control/officials/batch/', async (req: Request, res: Response) => {
    const staff = getAuthenticatedStaffUser(req, res);
    if (!staff || !staff.is_superuser) {
      res.status(403).json({ error: 'Superuser permission required.' });
      return;
    }

    const rawInput = String(req.body.officials_input || '');
    const lines = rawInput.split(/\r?\n/);
    let registeredCount = 0;
    const rejectedRecords: Array<{
      line_number: number;
      official_id: string;
      reason: string;
    }> = [];

    for (let idx = 0; idx < lines.length; idx++) {
      const rawLine = lines[idx];
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      const lineNum = idx + 1;
      const parts = trimmed.split(',').map((s) => s.trim());
      if (parts.length < 3) {
        rejectedRecords.push({
          line_number: lineNum,
          official_id: parts[0] || '',
          reason: 'Expected format: OfficialID, Name, Password',
        });
        continue;
      }
      const [officialId, name, password] = parts;
      if (!officialId || !name || !password) {
        rejectedRecords.push({
          line_number: lineNum,
          official_id: officialId,
          reason: 'Official ID, Name, and Password are required.',
        });
        continue;
      }
      if (password.length < 8) {
        rejectedRecords.push({
          line_number: lineNum,
          official_id: officialId,
          reason: 'Password must be at least 8 characters.',
        });
        continue;
      }
      if (
        store.staffUsers.some(
          (u) => u.username.toLowerCase() === officialId.toLowerCase()
        )
      ) {
        rejectedRecords.push({
          line_number: lineNum,
          official_id: officialId,
          reason: 'Official ID is already registered.',
        });
        continue;
      }

      const newStaff = {
        id: store.staffUsers.reduce((m, u) => Math.max(m, u.id), 1) + 1,
        username: officialId,
        name,
        password,
        is_superuser: false,
        is_staff: true,
        portal_role: 'ELECTION_ADMIN' as const,
        groups: ['Election Administrator'],
        created_at: new Date().toISOString(),
      };
      store.staffUsers.unshift(newStaff);
      await store.persistStaffUserInsert(newStaff);
      registeredCount += 1;
    }

    res.json({
      registered_count: registeredCount,
      rejected_count: rejectedRecords.length,
      rejected_records: rejectedRecords,
      registered_officials: store.staffUsers
        .filter((u) => !u.is_superuser)
        .map((u) => ({
          id: u.id,
          official_id: u.username,
          name: u.name,
        })),
    });
  });

  const officialDeleteHandler = async (req: Request, res: Response) => {
    const staff = getAuthenticatedStaffUser(req, res);
    if (!staff || !staff.is_superuser) {
      res.status(403).json({ error: 'Superuser permission required.' });
      return;
    }

    const userId = Number(req.params.user_id);
    const target = store.staffUsers.find((u) => u.id === userId);
    if (!target) {
      res.status(404).json({ error: 'Official account not found.' });
      return;
    }
    if (target.is_superuser || target.id === staff.id) {
      res
        .status(403)
        .json({ error: 'Superuser accounts cannot be deleted through this interface.' });
      return;
    }

    store.staffUsers = store.staffUsers.filter((u) => u.id !== userId);
    await store.persistStaffUserDelete(userId);
    store.logAudit(staff.username, 'OFFICIAL_ACCOUNT_DELETED', 'User', String(userId), {
      official_id: target.username,
      name: target.name,
    });

    res.json({
      success: true,
      registered_officials: store.staffUsers
        .filter((u) => !u.is_superuser)
        .map((u) => ({
          id: u.id,
          official_id: u.username,
          name: u.name,
        })),
    });
  };
  app.post('/control/officials/:user_id/delete/', officialDeleteHandler);
  app.post('/control/officials/:user_id/delete', officialDeleteHandler);

  app.post('/api/control/elections/wizard-create/', async (req: Request, res: Response) => {
    await store.syncFromDatabase(true);
    const staff = getAuthenticatedStaffUser(req, res);
    if (!staff || !staff.is_superuser) {
      res.status(403).json({ error: 'Superuser permission required.' });
      return;
    }

    const { details, candidates = [], includedVoterIds = [] } = req.body;
    if (!details || !details.title || !details.start_datetime_input || !details.end_datetime_input) {
      res.status(400).json({ error: 'Election details and voting schedule are required.' });
      return;
    }

    const nextElectionId =
      store.elections.reduce((m, e) => Math.max(m, e.election_id), 2026) + 1;
    const now = new Date();
    const startDt = new Date(details.start_datetime_input);
    const endDt = new Date(details.end_datetime_input);

    if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime()) || endDt <= startDt) {
      res.status(400).json({
        error: 'Voting end date and time must be after the start date and time.',
      });
      return;
    }

    const initialStatus = now >= startDt && now < endDt ? 'ACTIVE' : now >= endDt ? 'CLOSED' : 'SCHEDULED';

    const newElection = {
      id: store.elections.reduce((m, e) => Math.max(m, e.id), 0) + 1,
      election_id: nextElectionId,
      title: String(details.title).trim(),
      description: String(details.description || '').trim(),
      election_type: details.election_type || 'ELECTION',
      commencement_mode: 'SCHEDULED' as const,
      immediate_duration_hours: null,
      status: initialStatus as 'ACTIVE' | 'CLOSED' | 'SCHEDULED',
      deployment_status: 'DEPLOYED' as const,
      result_publication_policy: 'HIDDEN_UNTIL_CLOSE' as const,
      start_datetime: startDt.toISOString(),
      end_datetime: endDt.toISOString(),
      finalized_at: null,
      reconciled_at: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      contract_address: '',
      chain_id: DEFAULT_CHAIN_ID,
      candidates_locked_on_chain: true,
      voting_window_locked_on_chain: true,
      results_verified: false,
      results_published: initialStatus === 'CLOSED',
    };

    const createdCandidates = [];
    for (let idx = 0; idx < candidates.length; idx++) {
      const cand: { name: string; party: string; symbol_image_url?: string } =
        candidates[idx];
      const [defaultSym] = resolveCandidateSymbolPath(cand.party);
      const newCand = {
        id: store.candidates.reduce((m, c) => Math.max(m, c.id), 0) + idx + 1,
        election_id: nextElectionId,
        candidate_id_num: idx + 1,
        name: cand.name,
        symbol: cand.party,
        description: cand.party,
        display_order: idx + 1,
        symbol_image_url: cand.symbol_image_url || defaultSym,
        is_active: true,
        is_synced_on_chain: true,
      };
      createdCandidates.push(newCand);
    }

    try {
      const deployed = await deployAndBootstrapElectionOnChain(
        newElection,
        createdCandidates
      );
      newElection.contract_address = deployed.contractAddress;
      newElection.chain_id = deployed.chainId;
    } catch (err) {
      console.error('On-chain deployment warning during wizard-create:', err);
    }

    store.elections.unshift(newElection);
    await store.persistElectionInsert(newElection);

    for (const newCand of createdCandidates) {
      store.candidates.push(newCand);
      await store.persistCandidateInsert(newCand);
    }

    for (const aadhar of includedVoterIds) {
      const v = store.voters.find((item) => item.aadhar_number === aadhar);
      if (v) {
        const newElig = {
          id: store.voterEligibilities.reduce((m, ve) => Math.max(m, ve.id), 0) + 1,
          election_id: nextElectionId,
          voter_id: v.id,
          is_eligible: true,
          has_voted: false,
          voted_at: null,
        };
        store.voterEligibilities.push(newElig);
        await store.persistVoterEligibilityInsert(newElig);
      }
    }

    store.logAudit(
      staff.username,
      'ELECTION_CREATED_FROM_WIZARD',
      'Election',
      String(newElection.id),
      {
        election_id: nextElectionId,
        title: newElection.title,
        contract_address: newElection.contract_address,
      }
    );

    res.status(201).json({
      success: true,
      electionId: nextElectionId,
      election: store.buildPublicElectionContext(newElection),
    });
  });

  // =========================================================================
  // 6. Module 3, 4, 5, 6, 7 Control APIs (from EVotingApp/urls.py, no scheduler)
  // =========================================================================
  app.post('/api/control/elections/create/', async (req: Request, res: Response) => {
    const staff = getAuthenticatedStaffUser(req, res);
    if (!staff || !staff.is_superuser) {
      res.status(403).json({ error: 'Super Admin role required.' });
      return;
    }
    const title = String(req.body.title || '').trim();
    if (!title) {
      res.status(400).json({ error: 'Election title is required.' });
      return;
    }
    const maxId = store.elections.reduce((m, e) => Math.max(m, e.election_id), 2025);
    const electionIdNum = req.body.election_id ? Number(req.body.election_id) : maxId + 1;
    if (store.elections.some((e) => e.election_id === electionIdNum)) {
      res.status(400).json({ error: `Election #${electionIdNum} already exists.` });
      return;
    }
    const now = new Date().toISOString();
    const created = {
      id: store.elections.reduce((m, e) => Math.max(m, e.id), 0) + 1,
      election_id: electionIdNum,
      title: title.slice(0, 200),
      description: String(req.body.description || '').trim(),
      election_type: (req.body.election_type || 'ELECTION') as 'ELECTION',
      commencement_mode: (req.body.commencement_mode || 'SCHEDULED') as 'SCHEDULED',
      immediate_duration_hours: req.body.immediate_duration_hours
        ? Number(req.body.immediate_duration_hours)
        : null,
      status: 'DRAFT' as const,
      deployment_status: 'NOT_DEPLOYED' as const,
      result_publication_policy: (req.body.result_publication_policy ||
        'HIDDEN_UNTIL_CLOSE') as 'HIDDEN_UNTIL_CLOSE',
      start_datetime: req.body.start_datetime || null,
      end_datetime: req.body.end_datetime || null,
      finalized_at: null,
      reconciled_at: null,
      created_at: now,
      updated_at: now,
      contract_address: '',
      chain_id: DEFAULT_CHAIN_ID,
      candidates_locked_on_chain: false,
      voting_window_locked_on_chain: false,
      results_verified: false,
      results_published: false,
    };
    store.elections.unshift(created);
    await store.persistElectionInsert(created);
    res.status(201).json({ success: true, election: created });
  });

  app.post(
    '/api/control/elections/:election_id/update/',
    async (req: Request, res: Response) => {
      const election = store.getElectionByAnyId(Number(req.params.election_id));
      if (!election) {
        res.status(404).json({ error: 'Election not found.' });
        return;
      }
      if (election.status === 'FINALIZED') {
        res.status(400).json({ error: 'Cannot modify metadata of a finalized election.' });
        return;
      }
      if (req.body.title !== undefined) {
        const cleanTitle = String(req.body.title).trim();
        if (!cleanTitle) {
          res.status(400).json({ error: 'Election title cannot be empty.' });
          return;
        }
        election.title = cleanTitle.slice(0, 200);
      }
      if (req.body.description !== undefined) {
        election.description = String(req.body.description).trim();
      }
      election.updated_at = new Date().toISOString();
      await store.persistElectionUpdate(election);
      res.json({ success: true, election });
    }
  );

  app.get('/api/control/staff/', (_req: Request, res: Response) => {
    res.json({
      staff: store.staffUsers.map((u) => ({
        id: u.id,
        username: u.username,
        is_superuser: u.is_superuser,
        portal_role: u.portal_role,
        groups: u.groups,
      })),
      assignments: store.assignments,
    });
  });

  app.get(
    '/api/control/elections/:election_id/audit/',
    async (req: Request, res: Response) => {
      const election = store.getElectionByAnyId(Number(req.params.election_id));
      if (!election) {
        res.status(404).json({ error: 'Election not found.' });
        return;
      }
      const summary = store.buildPublicElectionContext(election);
      const inspection = await inspectAndReconcileOnChain(
        election,
        store.candidates,
        store.ballotReceipts
      );
      res.json({
        election: summary,
        onchain_inspection: {
          connected: inspection.connected,
          chain_id: inspection.chainId,
          contract_address: inspection.contractAddress,
          total_votes: inspection.onchainTotalVotes,
        },
        audit_logs: store.auditLogs.slice(0, 25),
      });
    }
  );

  app.post(
    '/api/control/elections/:election_id/deploy/',
    async (req: Request, res: Response) => {
      const election = store.getElectionByAnyId(Number(req.params.election_id));
      if (!election) {
        res.status(404).json({ error: 'Election not found.' });
        return;
      }
      const electionCands = store.candidates.filter(
        (c) => c.election_id === election.election_id && c.is_active
      );

      let address = String(req.body.contract_address || '').trim();
      if (!address) {
        const deployed = await deployAndBootstrapElectionOnChain(
          election,
          electionCands
        );
        address = deployed.contractAddress;
      }

      election.contract_address = address;
      election.deployment_status = 'DEPLOYED';
      election.updated_at = new Date().toISOString();
      await store.persistElectionUpdate(election);
      res.json({
        success: true,
        contract_address: address,
        chain_id: election.chain_id,
        deployment_status: election.deployment_status,
        candidates_synced: electionCands.length,
      });
    }
  );

  app.post(
    '/api/control/elections/:election_id/window/',
    async (req: Request, res: Response) => {
      const election = store.getElectionByAnyId(Number(req.params.election_id));
      if (!election) {
        res.status(404).json({ error: 'Election not found.' });
        return;
      }
      const mode = req.body.commencement_mode || election.commencement_mode;
      if (mode === 'IMMEDIATE') {
        const hours = Number(req.body.immediate_duration_hours || 1);
        const startDt = new Date();
        const endDt = new Date(startDt.getTime() + hours * 3600 * 1000);
        election.commencement_mode = 'IMMEDIATE';
        election.immediate_duration_hours = hours;
        election.start_datetime = startDt.toISOString();
        election.end_datetime = endDt.toISOString();
      } else {
        election.commencement_mode = 'SCHEDULED';
        if (req.body.start_datetime) election.start_datetime = req.body.start_datetime;
        if (req.body.end_datetime) election.end_datetime = req.body.end_datetime;
      }
      election.voting_window_locked_on_chain = true;
      election.updated_at = new Date().toISOString();
      await store.persistElectionUpdate(election);
      res.json({
        success: true,
        commencement_mode: election.commencement_mode,
        immediate_duration_hours: election.immediate_duration_hours,
        start_datetime: election.start_datetime,
        end_datetime: election.end_datetime,
        status: election.status,
      });
    }
  );

  app.post(
    '/api/control/elections/:election_id/activate/',
    async (req: Request, res: Response) => {
      const election = store.getElectionByAnyId(Number(req.params.election_id));
      if (!election) {
        res.status(404).json({ error: 'Election not found.' });
        return;
      }
      election.status = 'ACTIVE';
      election.updated_at = new Date().toISOString();
      await store.persistElectionUpdate(election);
      res.json({
        success: true,
        status: election.status,
        start_datetime: election.start_datetime,
        end_datetime: election.end_datetime,
        message: 'Election opened.',
      });
    }
  );

  app.post(
    '/api/control/elections/:election_id/close/',
    async (req: Request, res: Response) => {
      const election = store.getElectionByAnyId(Number(req.params.election_id));
      if (!election) {
        res.status(404).json({ error: 'Election not found.' });
        return;
      }
      await closeElectionOnChain(election);
      election.status = 'CLOSED';
      election.results_published = true;
      election.updated_at = new Date().toISOString();
      await store.persistElectionUpdate(election);
      res.json({
        success: true,
        status: election.status,
      });
    }
  );

  app.post(
    '/api/control/elections/:election_id/reconcile/',
    async (req: Request, res: Response) => {
      const election = store.getElectionByAnyId(Number(req.params.election_id));
      if (!election) {
        res.status(404).json({ error: 'Election not found.' });
        return;
      }
      const inspection = await inspectAndReconcileOnChain(
        election,
        store.candidates,
        store.ballotReceipts
      );
      const receiptsCount = store.ballotReceipts.filter(
        (r) => r.election_id === election.election_id
      ).length;

      election.results_verified = inspection.discrepancies.length === 0;
      election.reconciled_at = new Date().toISOString();
      await store.persistElectionUpdate(election);
      res.json({
        success: true,
        reconciliation: {
          verified: election.results_verified,
          onchain_total_votes: inspection.onchainTotalVotes,
          db_confirmed_permits: receiptsCount,
          candidate_checks: inspection.candidateChecks,
          discrepancies: inspection.discrepancies,
          reconciled_at: election.reconciled_at,
        },
      });
    }
  );

  app.post(
    '/api/control/elections/:election_id/publish/',
    async (req: Request, res: Response) => {
      const election = store.getElectionByAnyId(Number(req.params.election_id));
      if (!election) {
        res.status(404).json({ error: 'Election not found.' });
        return;
      }
      const publish = req.body.publish !== undefined ? Boolean(req.body.publish) : true;
      if (publish && election.status !== 'CLOSED' && election.status !== 'FINALIZED') {
        res
          .status(400)
          .json({ error: 'Results can only be published after the election closes.' });
        return;
      }
      election.results_published = publish;
      await store.persistElectionUpdate(election);
      res.json({
        success: true,
        results_published: election.results_published,
        result_publication_policy: election.result_publication_policy,
      });
    }
  );

  app.post(
    '/api/control/elections/:election_id/finalize/',
    async (req: Request, res: Response) => {
      const election = store.getElectionByAnyId(Number(req.params.election_id));
      if (!election) {
        res.status(404).json({ error: 'Election not found.' });
        return;
      }
      if (election.status !== 'CLOSED') {
        res
          .status(400)
          .json({ error: 'Close the election before finalizing results.' });
        return;
      }
      election.status = 'FINALIZED';
      election.finalized_at = new Date().toISOString();
      election.results_published = true;
      await store.persistElectionUpdate(election);
      res.json({
        success: true,
        status: election.status,
        finalized_at: election.finalized_at,
      });
    }
  );

  app.all('/api/control/blockchain/sync/', (_req: Request, res: Response) => {
    const election = store.elections[0];
    res.json({
      success: true,
      connected: true,
      web3_rpc_url: DEFAULT_RPC_URL,
      metamask_rpc_url: 'http://127.0.0.1:8545',
      chain_id: DEFAULT_CHAIN_ID,
      accounts_available: 10,
      contract_address: election ? election.contract_address : '',
      deployment_status: election ? election.deployment_status : 'NOT_DEPLOYED',
    });
  });

  app.all(
    '/api/control/elections/:election_id/candidates/',
    async (req: Request, res: Response) => {
      const election = store.getElectionByAnyId(Number(req.params.election_id));
      if (!election) {
        res.status(404).json({ error: 'Election not found.' });
        return;
      }
      if (req.method === 'GET') {
        const list = store.candidates
          .filter((c) => c.election_id === election.election_id)
          .map((c) => ({
            id: c.id,
            candidate_id: c.candidate_id_num,
            name: c.name,
            symbol: c.symbol,
            description: c.description,
            display_order: c.display_order,
            is_active: c.is_active,
            is_synced_on_chain: c.is_synced_on_chain,
            symbol_image_url: resolvePublicCandidateSymbolUrl(c),
          }));
        res.json({
          candidates: list,
          active_count: list.filter((i) => i.is_active).length,
          candidates_locked_on_chain: election.candidates_locked_on_chain,
        });
        return;
      }

      const candidateId = Number(req.body.candidate_id);
      const name = String(req.body.name || '').trim();
      const symbol = String(req.body.symbol || '').trim();
      const description = String(req.body.description || '').trim();
      if (!candidateId || !name || !symbol) {
        res
          .status(400)
          .json({ error: 'Ballot number, candidate name, and symbol are required.' });
        return;
      }
      const [symUrl] = resolveCandidateSymbolPath(symbol);
      const created = {
        id: store.candidates.reduce((m, c) => Math.max(m, c.id), 0) + 1,
        election_id: election.election_id,
        candidate_id_num: candidateId,
        name,
        symbol,
        description,
        display_order: candidateId,
        symbol_image_url: symUrl,
        is_active: true,
        is_synced_on_chain: false,
      };
      store.candidates.push(created);
      await store.persistCandidateInsert(created);
      res.status(201).json({
        success: true,
        candidate: {
          id: created.id,
          candidate_id: created.candidate_id_num,
          name: created.name,
          symbol: created.symbol,
          description: created.description,
          display_order: created.display_order,
          is_active: created.is_active,
          is_synced_on_chain: created.is_synced_on_chain,
          symbol_image_url: resolvePublicCandidateSymbolUrl(created),
        },
      });
    }
  );

  app.post(
    '/api/control/elections/:election_id/candidates/lock/',
    async (req: Request, res: Response) => {
      const election = store.getElectionByAnyId(Number(req.params.election_id));
      if (!election) {
        res.status(404).json({ error: 'Election not found.' });
        return;
      }
      election.candidates_locked_on_chain = true;
      store.candidates
        .filter((c) => c.election_id === election.election_id && c.is_active)
        .forEach((c) => {
          c.is_synced_on_chain = true;
        });
      await store.persistElectionUpdate(election);
      await store.persistCandidatesLockForElection(election.election_id);
      res.json({
        success: true,
        candidates_locked_on_chain: true,
        voting_window_locked_on_chain: election.voting_window_locked_on_chain,
      });
    }
  );

  app.get(
    '/api/control/elections/:election_id/voters/',
    (req: Request, res: Response) => {
      const election = store.getElectionByAnyId(Number(req.params.election_id));
      if (!election) {
        res.status(404).json({ error: 'Election not found.' });
        return;
      }
      const eligRows = store.voterEligibilities.filter(
        (ve) => ve.election_id === election.election_id
      );
      const records = eligRows.map((ve) => {
        const voter = store.voters.find((v) => v.id === ve.voter_id);
        return {
          voter_id: ve.voter_id,
          name: voter?.name || '',
          aadhar_masked: maskAadhar(voter?.aadhar_number || ''),
          is_eligible: ve.is_eligible,
          has_voted: ve.has_voted,
          voted_at: ve.voted_at,
        };
      });
      res.json({
        election_id: election.election_id,
        total_records: records.length,
        eligible_count: records.filter((r) => r.is_eligible).length,
        voted_count: records.filter((r) => r.has_voted).length,
        voters: records,
      });
    }
  );

  app.get('/api/identity/providers/', (_req: Request, res: Response) => {
    res.json({
      providers: [
        {
          provider_id: 'local_database',
          name: 'DVS Electoral Roll Registry',
          type: 'AUTHORITATIVE_LOCAL',
          is_simulated: false,
        },
      ],
    });
  });

  // =========================================================================
  // 7. Vite Dev Middleware / Production Static Asset Mounting
  // =========================================================================
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[DVS Express] Server listening on http://0.0.0.0:${PORT}`);
    void (async () => {
      try {
        await store.ensureLoaded();
        await ensureLocalBlockchainReady(store.elections, store.candidates);
        for (const el of store.elections) {
          await store.persistElectionUpdate(el);
        }
      } catch (err) {
        console.error('[DVS Express] Background initialization error:', err);
      }
    })();
  });
}

startServer();
