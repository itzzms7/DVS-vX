import crypto from 'crypto';
import { eq, desc } from 'drizzle-orm';
import { db, createPool, withDbRetry } from '../db/index.ts';
import {
  elections as electionsTable,
  candidates as candidatesTable,
  voters as votersTable,
  voterEligibilities as voterEligibilitiesTable,
  ballotReceipts as ballotReceiptsTable,
  staffUsers as staffUsersTable,
  adminAuditLogs as adminAuditLogsTable,
} from '../db/schema.ts';

export type ElectionStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'CLOSED' | 'FINALIZED';

export interface CandidateModel {
  id: number;
  election_id: number;
  candidate_id_num: number;
  name: string;
  symbol: string;
  description: string;
  display_order: number;
  symbol_image_url: string;
  is_active: boolean;
  is_synced_on_chain: boolean;
}

export interface ElectionModel {
  id: number;
  election_id: number;
  title: string;
  description: string;
  election_type: 'ELECTION' | 'POLL' | 'REFERENDUM' | 'CORPORATE';
  commencement_mode: 'IMMEDIATE' | 'SCHEDULED';
  immediate_duration_hours: number | null;
  status: ElectionStatus;
  deployment_status:
    | 'NOT_DEPLOYED'
    | 'DEPLOYED'
    | 'DEPLOYMENT_FAILED'
    | 'CHAIN_RESET_REDEPLOY_REQUIRED';
  result_publication_policy: 'HIDDEN_UNTIL_CLOSE' | 'PUBLIC_AFTER_CLOSE' | 'ALWAYS_VISIBLE';
  start_datetime: string | null;
  end_datetime: string | null;
  finalized_at: string | null;
  reconciled_at: string | null;
  created_at: string;
  updated_at: string;
  contract_address: string;
  chain_id: number;
  candidates_locked_on_chain: boolean;
  voting_window_locked_on_chain: boolean;
  results_verified: boolean;
  results_published: boolean;
}

export interface VoterModel {
  id: number;
  name: string;
  aadhar_number: string;
  phone: string;
  bound_wallet: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  has_voted: boolean;
  voted_at: string | null;
  is_synthetic: boolean;
  security_flagged: boolean;
  security_flag_reason: string;
  created_at: string;
}

export interface VoterEligibilityModel {
  id: number;
  election_id: number;
  voter_id: number;
  is_eligible: boolean;
  has_voted: boolean;
  voted_at: string | null;
}

export interface BallotReceiptModel {
  id: number;
  voter_id: number;
  election_id: number;
  candidate_id: number;
  voter_hash: string;
  contract_address: string;
  tx_hash: string;
  block_number: number;
  receipt_reference: string;
  confirmed_at: string;
}

export interface StaffUserModel {
  id: number;
  username: string;
  name: string;
  password: string;
  is_superuser: boolean;
  is_staff: boolean;
  portal_role: 'SUPER_ADMIN' | 'ELECTION_ADMIN' | 'ELECTION_WORKER' | 'AUDITOR';
  groups: string[];
  created_at: string;
}

export interface ElectionAdminAssignmentModel {
  id: number;
  election_id: number;
  user_id: number;
  username: string;
  role: 'ELECTION_ADMIN' | 'ELECTION_WORKER' | 'AUDITOR';
  assigned_at: string;
}

export interface AdminAuditLogModel {
  id: number;
  actor_username: string;
  action: string;
  target_model: string;
  target_id: string;
  details: string;
  ip_address: string;
  timestamp: string;
}

export interface ExternalProviderVerificationRecordModel {
  id: number;
  provider_id: string;
  provider_name: string;
  provider_type: string;
  is_simulated: boolean;
  masked_identifier: string;
  verification_status: string;
  failure_code: string;
  sanitized_attributes_json: string;
  response_latency_ms: number;
  verified_at: string;
}

export interface PendingVoterOnboardingModel {
  id: number;
  target_election_id: number | null;
  provider_id: string;
  provider_type: string;
  masked_identifier: string;
  raw_aadhar: string;
  proposed_name: string;
  claimed_wallet: string | null;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  is_synthetic: boolean;
  created_at: string;
  resulting_voter_id: number | null;
}

export const STATUS_BADGE_MAP: Record<string, [string, string]> = {
  ACTIVE: ['badge-active', 'Active'],
  SCHEDULED: ['badge-scheduled', 'Scheduled'],
  CLOSED: ['badge-closed', 'Completed'],
  FINALIZED: ['badge-finalized', 'Completed'],
  DRAFT: ['badge-draft', 'Draft'],
};

export const STATUS_SENTENCE_MAP: Record<string, string> = {
  ACTIVE: 'Voting is currently open for eligible participants.',
  SCHEDULED: 'Voting is scheduled to begin on the starting date.',
  CLOSED: 'Voting has ended for this election.',
  FINALIZED: 'Voting has concluded and official results are finalized.',
  DRAFT: 'This election is currently in preparation.',
};

export function maskAadhar(aadhar: string): string {
  const digits = String(aadhar || '').replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `••••••••${digits.slice(-4)}`;
}

export function resolveCandidateSymbolPath(symbolText: string): [string, string] {
  const symLower = String(symbolText || '').trim().toLowerCase();
  if (symLower.includes('congress')) {
    return ['/static/symbols/congress.png', 'Congress Symbol'];
  }
  if (symLower.includes('bjp') || symLower.includes('bharatiya')) {
    return ['/static/symbols/bjp.png', 'BJP Symbol'];
  }
  if (symLower.includes('samajwadi') || symLower.includes('samajvadi')) {
    return ['/static/symbols/samajvadi.png', 'Samajwadi Symbol'];
  }
  return ['/static/symbols/congress.png', `${symbolText} Symbol`];
}

export function parseCandidateDataUriSymbol(rawUrl: string): {
  mimeType: string;
  extension: string;
  buffer: Buffer;
} | null {
  const trimmed = String(rawUrl || '').trim();
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const base64Body = match[2].replace(/\s+/g, '');
  let extension = 'png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
    extension = 'jpg';
  } else if (mimeType.includes('webp')) {
    extension = 'webp';
  } else if (mimeType.includes('gif')) {
    extension = 'gif';
  } else if (mimeType.includes('svg')) {
    extension = 'svg';
  }
  try {
    const buffer = Buffer.from(base64Body, 'base64');
    if (buffer.length === 0) return null;
    return { mimeType, extension, buffer };
  } catch {
    return null;
  }
}

export function resolvePublicCandidateSymbolUrl(cand: CandidateModel): string {
  const [fallbackSymSrc] = resolveCandidateSymbolPath(cand.symbol);
  const raw = String(cand.symbol_image_url || '').trim();
  if (!raw) return fallbackSymSrc;
  const parsedDataUri = parseCandidateDataUriSymbol(raw);
  if (parsedDataUri) {
    return `/media/candidate-symbols/${cand.election_id}/${cand.candidate_id_num}.${parsedDataUri.extension}`;
  }
  return raw;
}

export function deriveVoterNullifier(electionId: number, voterUsername: string, aadhar: string): string {
  const payload = `${electionId}:${voterUsername.trim().toLowerCase()}:${aadhar.trim()}`;
  return '0x' + crypto.createHash('sha256').update(payload).digest('hex');
}

// On-the-fly status computation based on start_datetime / end_datetime (no scheduler process)
export function computeElectionLifecycleStatus(
  election: ElectionModel,
  now: Date = new Date()
): ElectionStatus {
  if (election.status === 'FINALIZED' || election.status === 'DRAFT') {
    return election.status;
  }
  const startDt = election.start_datetime ? new Date(election.start_datetime) : null;
  const endDt = election.end_datetime ? new Date(election.end_datetime) : null;

  if (endDt && !Number.isNaN(endDt.getTime()) && now >= endDt) {
    return 'CLOSED';
  }
  if (startDt && !Number.isNaN(startDt.getTime())) {
    if (now < startDt) {
      return 'SCHEDULED';
    }
    return 'ACTIVE';
  }
  return election.status;
}

export function syncElectionStateInPlace(election: ElectionModel, now: Date = new Date()): void {
  const computed = computeElectionLifecycleStatus(election, now);
  if (computed !== election.status) {
    election.status = computed;
    if (computed === 'CLOSED') {
      election.results_published = true;
    }
    election.updated_at = now.toISOString();
    void store.persistElectionUpdate(election);
  }
}

export function isElectionPubliclyVisible(
  election: ElectionModel,
  now: Date = new Date()
): boolean {
  syncElectionStateInPlace(election, now);
  if (election.status === 'DRAFT' || election.status === 'SCHEDULED') {
    return false;
  }
  return true;
}

export function isElectionVotingOpen(
  election: ElectionModel,
  now: Date = new Date()
): boolean {
  syncElectionStateInPlace(election, now);
  if (election.status !== 'ACTIVE') return false;
  if (election.start_datetime && now < new Date(election.start_datetime)) return false;
  if (election.end_datetime && now >= new Date(election.end_datetime)) return false;
  return true;
}

class DVSStore {
  public dbConnected = false;

  public elections: ElectionModel[] = [];

  public candidates: CandidateModel[] = [];

  public voters: VoterModel[] = [
    {
      id: 1,
      name: 'Rahul Kumar',
      aadhar_number: '100000000001',
      phone: '9876543210',
      bound_wallet: null,
      status: 'ACTIVE',
      has_voted: false,
      voted_at: null,
      is_synthetic: false,
      security_flagged: false,
      security_flag_reason: '',
      created_at: '2026-11-01T10:00:00Z',
    },
    {
      id: 2,
      name: 'Arjun Kumar',
      aadhar_number: '100000000002',
      phone: '9876543211',
      bound_wallet: null,
      status: 'ACTIVE',
      has_voted: false,
      voted_at: null,
      is_synthetic: false,
      security_flagged: false,
      security_flag_reason: '',
      created_at: '2026-11-01T10:00:00Z',
    },
    {
      id: 3,
      name: 'Sameer Khan',
      aadhar_number: '100000000003',
      phone: '9876543212',
      bound_wallet: null,
      status: 'ACTIVE',
      has_voted: false,
      voted_at: null,
      is_synthetic: false,
      security_flagged: false,
      security_flag_reason: '',
      created_at: '2026-11-01T10:00:00Z',
    },
  ];

  public voterEligibilities: VoterEligibilityModel[] = [];

  public ballotReceipts: BallotReceiptModel[] = [];

  public staffUsers: StaffUserModel[] = [
    {
      id: 1,
      username: process.env.DVS_SUPERUSER_USERNAME || 'Suhail',
      name: process.env.DVS_SUPERUSER_USERNAME || 'Suhail',
      password: process.env.DVS_SUPERUSER_PASSWORD || 'admin1234',
      is_superuser: true,
      is_staff: true,
      portal_role: 'SUPER_ADMIN',
      groups: ['Super Admin'],
      created_at: '2026-11-01T00:00:00Z',
    },
  ];

  public assignments: ElectionAdminAssignmentModel[] = [];
  public auditLogs: AdminAuditLogModel[] = [];
  public verificationRecords: ExternalProviderVerificationRecordModel[] = [];
  public pendingOnboardings: PendingVoterOnboardingModel[] = [];

  private schemaEnsured = false;
  private activeLoadPromise: Promise<void> | null = null;
  private lastLoadedAt = 0;

  private async ensureSchemaTables(): Promise<void> {
    if (this.schemaEnsured || !process.env.SQL_HOST) return;
    const pool = createPool();
    const probe = await withDbRetry(() =>
      pool.query<{ exists: boolean }>(
        "SELECT to_regclass('public.elections') IS NOT NULL AS exists"
      )
    );
    if (probe.rows[0]?.exists) {
      this.schemaEnsured = true;
      return;
    }

    try {
      await withDbRetry(() =>
        pool.query(`
          CREATE TABLE IF NOT EXISTS elections (
            id SERIAL PRIMARY KEY,
            election_id INTEGER NOT NULL UNIQUE,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            election_type TEXT NOT NULL DEFAULT 'ELECTION',
            commencement_mode TEXT NOT NULL DEFAULT 'SCHEDULED',
            immediate_duration_hours INTEGER,
            status TEXT NOT NULL DEFAULT 'DRAFT',
            deployment_status TEXT NOT NULL DEFAULT 'NOT_DEPLOYED',
            result_publication_policy TEXT NOT NULL DEFAULT 'HIDDEN_UNTIL_CLOSE',
            start_datetime TEXT,
            end_datetime TEXT,
            finalized_at TEXT,
            reconciled_at TEXT,
            contract_address TEXT NOT NULL DEFAULT '',
            chain_id INTEGER NOT NULL DEFAULT 31337,
            candidates_locked_on_chain BOOLEAN NOT NULL DEFAULT FALSE,
            voting_window_locked_on_chain BOOLEAN NOT NULL DEFAULT FALSE,
            results_verified BOOLEAN NOT NULL DEFAULT FALSE,
            results_published BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS candidates (
            id SERIAL PRIMARY KEY,
            election_id INTEGER NOT NULL,
            candidate_id_num INTEGER NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            display_order INTEGER NOT NULL DEFAULT 1,
            symbol_image_url TEXT NOT NULL DEFAULT '',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            is_synced_on_chain BOOLEAN NOT NULL DEFAULT FALSE
          );
          CREATE TABLE IF NOT EXISTS voters (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            aadhar_number TEXT NOT NULL UNIQUE,
            phone TEXT NOT NULL DEFAULT '',
            bound_wallet TEXT,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            has_voted BOOLEAN NOT NULL DEFAULT FALSE,
            voted_at TEXT,
            is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
            security_flagged BOOLEAN NOT NULL DEFAULT FALSE,
            security_flag_reason TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS voter_eligibilities (
            id SERIAL PRIMARY KEY,
            election_id INTEGER NOT NULL,
            voter_id INTEGER NOT NULL,
            is_eligible BOOLEAN NOT NULL DEFAULT TRUE,
            has_voted BOOLEAN NOT NULL DEFAULT FALSE,
            voted_at TEXT
          );
          CREATE TABLE IF NOT EXISTS ballot_receipts (
            id SERIAL PRIMARY KEY,
            voter_id INTEGER NOT NULL,
            election_id INTEGER NOT NULL,
            candidate_id INTEGER NOT NULL,
            voter_hash TEXT NOT NULL,
            contract_address TEXT NOT NULL DEFAULT '',
            tx_hash TEXT NOT NULL,
            block_number INTEGER NOT NULL DEFAULT 0,
            receipt_reference TEXT NOT NULL,
            confirmed_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS staff_users (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            password TEXT NOT NULL,
            is_superuser BOOLEAN NOT NULL DEFAULT FALSE,
            is_staff BOOLEAN NOT NULL DEFAULT TRUE,
            portal_role TEXT NOT NULL DEFAULT 'ELECTION_ADMIN',
            groups_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id SERIAL PRIMARY KEY,
            actor_username TEXT NOT NULL,
            action TEXT NOT NULL,
            target_model TEXT NOT NULL,
            target_id TEXT NOT NULL,
            details TEXT NOT NULL DEFAULT '',
            ip_address TEXT NOT NULL DEFAULT '127.0.0.1',
            timestamp TEXT NOT NULL
          );
        `)
      );
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      if (code !== '42501') {
        throw err;
      }
    }
    this.schemaEnsured = true;
  }

  public async ensureLoaded(): Promise<void> {
    if (!process.env.SQL_HOST) return;
    if (this.dbConnected) return;
    await this.loadFromDatabase();
  }

  public async syncFromDatabase(force = false): Promise<void> {
    if (!process.env.SQL_HOST) return;
    const now = Date.now();
    if (!force && this.dbConnected && now - this.lastLoadedAt < 1500) {
      return;
    }
    await this.loadFromDatabase();
  }

  public async loadFromDatabase(): Promise<void> {
    if (!process.env.SQL_HOST) return;
    if (this.activeLoadPromise) {
      await this.activeLoadPromise;
      return;
    }

    this.activeLoadPromise = (async () => {
      try {
        await this.ensureSchemaTables();
        const [
          dbElections,
          dbCandidates,
          dbVoters,
          dbEligibilities,
          dbReceipts,
          dbStaff,
          dbAuditLogs,
        ] = await withDbRetry(() =>
          Promise.all([
            db.select().from(electionsTable),
            db.select().from(candidatesTable),
            db.select().from(votersTable),
            db.select().from(voterEligibilitiesTable),
            db.select().from(ballotReceiptsTable),
            db.select().from(staffUsersTable),
            db.select().from(adminAuditLogsTable).orderBy(desc(adminAuditLogsTable.id)),
          ])
        );

        this.elections = dbElections.map((e) => ({
          id: e.id,
          election_id: e.electionId,
          title: e.title,
          description: e.description,
          election_type: e.electionType as ElectionModel['election_type'],
          commencement_mode: e.commencementMode as ElectionModel['commencement_mode'],
          immediate_duration_hours: e.immediateDurationHours,
          status: e.status as ElectionStatus,
          deployment_status: e.deploymentStatus as ElectionModel['deployment_status'],
          result_publication_policy:
            e.resultPublicationPolicy as ElectionModel['result_publication_policy'],
          start_datetime: e.startDatetime,
          end_datetime: e.endDatetime,
          finalized_at: e.finalizedAt,
          reconciled_at: e.reconciledAt,
          contract_address: e.contractAddress,
          chain_id: e.chainId,
          candidates_locked_on_chain: e.candidatesLockedOnChain,
          voting_window_locked_on_chain: e.votingWindowLockedOnChain,
          results_verified: e.resultsVerified,
          results_published: e.resultsPublished,
          created_at: e.createdAt,
          updated_at: e.updatedAt,
        }));

        this.candidates = dbCandidates.map((c) => ({
          id: c.id,
          election_id: c.electionId,
          candidate_id_num: c.candidateIdNum,
          name: c.name,
          symbol: c.symbol,
          description: c.description,
          display_order: c.displayOrder,
          symbol_image_url: c.symbolImageUrl,
          is_active: c.isActive,
          is_synced_on_chain: c.isSyncedOnChain,
        }));

        if (dbVoters.length > 0) {
          this.voters = dbVoters.map((v) => ({
            id: v.id,
            name: v.name,
            aadhar_number: v.aadharNumber,
            phone: v.phone,
            bound_wallet: v.boundWallet,
            status: v.status as VoterModel['status'],
            has_voted: v.hasVoted,
            voted_at: v.votedAt,
            is_synthetic: v.isSynthetic,
            security_flagged: v.securityFlagged,
            security_flag_reason: v.securityFlagReason,
            created_at: v.createdAt,
          }));
        }

        this.voterEligibilities = dbEligibilities.map((ve) => ({
          id: ve.id,
          election_id: ve.electionId,
          voter_id: ve.voterId,
          is_eligible: ve.isEligible,
          has_voted: ve.hasVoted,
          voted_at: ve.votedAt,
        }));

        this.ballotReceipts = dbReceipts.map((r) => ({
          id: r.id,
          voter_id: r.voterId,
          election_id: r.electionId,
          candidate_id: r.candidateId,
          voter_hash: r.voterHash,
          contract_address: r.contractAddress,
          tx_hash: r.txHash,
          block_number: r.blockNumber,
          receipt_reference: r.receiptReference,
          confirmed_at: r.confirmedAt,
        }));

        if (dbStaff.length > 0) {
          this.staffUsers = dbStaff.map((u) => {
            let parsedGroups: string[] = [];
            try {
              parsedGroups = JSON.parse(u.groupsJson || '[]');
            } catch {
              parsedGroups = [];
            }
            return {
              id: u.id,
              username: u.username,
              name: u.name,
              password: u.password,
              is_superuser: u.isSuperuser,
              is_staff: u.isStaff,
              portal_role: u.portalRole as StaffUserModel['portal_role'],
              groups: parsedGroups,
              created_at: u.createdAt,
            };
          });
        }

        if (dbAuditLogs.length > 0) {
          this.auditLogs = dbAuditLogs.map((l) => ({
            id: l.id,
            actor_username: l.actorUsername,
            action: l.action,
            target_model: l.targetModel,
            target_id: l.targetId,
            details: l.details,
            ip_address: l.ipAddress,
            timestamp: l.timestamp,
          }));
        }

        this.dbConnected = true;
        this.lastLoadedAt = Date.now();
      } catch (error) {
        console.error('Database Error in loadFromDatabase:', error);
      } finally {
        this.activeLoadPromise = null;
      }
    })();

    await this.activeLoadPromise;
  }

  public async persistElectionInsert(election: ElectionModel): Promise<void> {
    if (!process.env.SQL_HOST) return;
    try {
      await this.ensureSchemaTables();
      const [inserted] = await withDbRetry(() =>
        db
          .insert(electionsTable)
          .values({
            electionId: election.election_id,
            title: election.title,
            description: election.description,
            electionType: election.election_type,
            commencementMode: election.commencement_mode,
            immediateDurationHours: election.immediate_duration_hours,
            status: election.status,
            deploymentStatus: election.deployment_status,
            resultPublicationPolicy: election.result_publication_policy,
            startDatetime: election.start_datetime,
            endDatetime: election.end_datetime,
            finalizedAt: election.finalized_at,
            reconciledAt: election.reconciled_at,
            contractAddress: election.contract_address,
            chainId: election.chain_id,
            candidatesLockedOnChain: election.candidates_locked_on_chain,
            votingWindowLockedOnChain: election.voting_window_locked_on_chain,
            resultsVerified: election.results_verified,
            resultsPublished: election.results_published,
            createdAt: election.created_at,
            updatedAt: election.updated_at,
          })
          .returning()
      );
      if (inserted) {
        election.id = inserted.id;
      }
    } catch (error) {
      console.error('Database Error in persistElectionInsert:', error);
    }
  }

  public async persistElectionUpdate(election: ElectionModel): Promise<void> {
    if (!process.env.SQL_HOST) return;
    try {
      await this.ensureSchemaTables();
      await withDbRetry(() =>
        db
          .update(electionsTable)
          .set({
            title: election.title,
            description: election.description,
            commencementMode: election.commencement_mode,
            immediateDurationHours: election.immediate_duration_hours,
            status: election.status,
            deploymentStatus: election.deployment_status,
            resultPublicationPolicy: election.result_publication_policy,
            startDatetime: election.start_datetime,
            endDatetime: election.end_datetime,
            finalizedAt: election.finalized_at,
            reconciledAt: election.reconciled_at,
            contractAddress: election.contract_address,
            chainId: election.chain_id,
            candidatesLockedOnChain: election.candidates_locked_on_chain,
            votingWindowLockedOnChain: election.voting_window_locked_on_chain,
            resultsVerified: election.results_verified,
            resultsPublished: election.results_published,
            updatedAt: election.updated_at,
          })
          .where(eq(electionsTable.electionId, election.election_id))
      );
    } catch (error) {
      console.error('Database Error in persistElectionUpdate:', error);
    }
  }

  public async persistCandidateInsert(cand: CandidateModel): Promise<void> {
    if (!process.env.SQL_HOST) return;
    try {
      await this.ensureSchemaTables();
      const [inserted] = await withDbRetry(() =>
        db
          .insert(candidatesTable)
          .values({
            electionId: cand.election_id,
            candidateIdNum: cand.candidate_id_num,
            name: cand.name,
            symbol: cand.symbol,
            description: cand.description,
            displayOrder: cand.display_order,
            symbolImageUrl: cand.symbol_image_url,
            isActive: cand.is_active,
            isSyncedOnChain: cand.is_synced_on_chain,
          })
          .returning()
      );
      if (inserted) {
        cand.id = inserted.id;
      }
    } catch (error) {
      console.error('Database Error in persistCandidateInsert:', error);
    }
  }

  public async persistCandidatesLockForElection(electionId: number): Promise<void> {
    if (!process.env.SQL_HOST) return;
    try {
      await this.ensureSchemaTables();
      await withDbRetry(() =>
        db
          .update(candidatesTable)
          .set({ isSyncedOnChain: true })
          .where(eq(candidatesTable.electionId, electionId))
      );
    } catch (error) {
      console.error('Database Error in persistCandidatesLockForElection:', error);
    }
  }

  public async persistVoterInsert(voter: VoterModel): Promise<void> {
    if (!process.env.SQL_HOST) return;
    try {
      await this.ensureSchemaTables();
      const [inserted] = await withDbRetry(() =>
        db
          .insert(votersTable)
          .values({
            name: voter.name,
            aadharNumber: voter.aadhar_number,
            phone: voter.phone,
            boundWallet: voter.bound_wallet,
            status: voter.status,
            hasVoted: voter.has_voted,
            votedAt: voter.voted_at,
            isSynthetic: voter.is_synthetic,
            securityFlagged: voter.security_flagged,
            securityFlagReason: voter.security_flag_reason,
            createdAt: voter.created_at,
          })
          .returning()
      );
      if (inserted) {
        voter.id = inserted.id;
      }
    } catch (error) {
      console.error('Database Error in persistVoterInsert:', error);
    }
  }

  public async persistVoterEligibilityInsert(elig: VoterEligibilityModel): Promise<void> {
    if (!process.env.SQL_HOST) return;
    try {
      await this.ensureSchemaTables();
      const [inserted] = await withDbRetry(() =>
        db
          .insert(voterEligibilitiesTable)
          .values({
            electionId: elig.election_id,
            voterId: elig.voter_id,
            isEligible: elig.is_eligible,
            hasVoted: elig.has_voted,
            votedAt: elig.voted_at,
          })
          .returning()
      );
      if (inserted) {
        elig.id = inserted.id;
      }
    } catch (error) {
      console.error('Database Error in persistVoterEligibilityInsert:', error);
    }
  }

  public async persistBallotCast(
    receipt: BallotReceiptModel,
    eligibility: VoterEligibilityModel,
    voter: VoterModel
  ): Promise<void> {
    if (!process.env.SQL_HOST) return;
    try {
      await this.ensureSchemaTables();
      const [inserted] = await withDbRetry(() =>
        db
          .insert(ballotReceiptsTable)
          .values({
            voterId: receipt.voter_id,
            electionId: receipt.election_id,
            candidateId: receipt.candidate_id,
            voterHash: receipt.voter_hash,
            contractAddress: receipt.contract_address,
            txHash: receipt.tx_hash,
            blockNumber: receipt.block_number,
            receiptReference: receipt.receipt_reference,
            confirmedAt: receipt.confirmed_at,
          })
          .returning()
      );
      if (inserted) {
        receipt.id = inserted.id;
      }

      await withDbRetry(() =>
        db
          .update(voterEligibilitiesTable)
          .set({ hasVoted: true, votedAt: eligibility.voted_at })
          .where(eq(voterEligibilitiesTable.id, eligibility.id))
      );

      await withDbRetry(() =>
        db
          .update(votersTable)
          .set({ hasVoted: true, votedAt: voter.voted_at })
          .where(eq(votersTable.id, voter.id))
      );
    } catch (error) {
      console.error('Database Error in persistBallotCast:', error);
    }
  }

  public async persistStaffUserInsert(staff: StaffUserModel): Promise<void> {
    if (!process.env.SQL_HOST) return;
    try {
      await this.ensureSchemaTables();
      const [inserted] = await withDbRetry(() =>
        db
          .insert(staffUsersTable)
          .values({
            username: staff.username,
            name: staff.name,
            password: staff.password,
            isSuperuser: staff.is_superuser,
            isStaff: staff.is_staff,
            portalRole: staff.portal_role,
            groupsJson: JSON.stringify(staff.groups),
            createdAt: staff.created_at,
          })
          .returning()
      );
      if (inserted) {
        staff.id = inserted.id;
      }
    } catch (error) {
      console.error('Database Error in persistStaffUserInsert:', error);
    }
  }

  public async persistStaffUserDelete(userId: number): Promise<void> {
    if (!process.env.SQL_HOST) return;
    try {
      await this.ensureSchemaTables();
      await withDbRetry(() =>
        db.delete(staffUsersTable).where(eq(staffUsersTable.id, userId))
      );
    } catch (error) {
      console.error('Database Error in persistStaffUserDelete:', error);
    }
  }

  public async logAudit(
    actorUsername: string,
    action: string,
    targetModel: string,
    targetId: string,
    detailsObj: unknown,
    ipAddress = '127.0.0.1'
  ): Promise<void> {
    const entry: AdminAuditLogModel = {
      id: this.auditLogs.reduce((m, l) => Math.max(m, l.id), 0) + 1,
      actor_username: actorUsername,
      action,
      target_model: targetModel,
      target_id: targetId,
      details: typeof detailsObj === 'string' ? detailsObj : JSON.stringify(detailsObj),
      ip_address: ipAddress,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(entry);

    if (process.env.SQL_HOST) {
      try {
        await this.ensureSchemaTables();
        await withDbRetry(() =>
          db.insert(adminAuditLogsTable).values({
            actorUsername: entry.actor_username,
            action: entry.action,
            targetModel: entry.target_model,
            targetId: entry.target_id,
            details: entry.details,
            ipAddress: entry.ip_address,
            timestamp: entry.timestamp,
          })
        );
      } catch (err) {
        console.error('Database Error in logAudit:', err);
      }
    }
  }

  public getElectionByAnyId(idOrElectionId: number): ElectionModel | undefined {
    const found =
      this.elections.find((e) => e.election_id === idOrElectionId) ||
      this.elections.find((e) => e.id === idOrElectionId);
    if (found) {
      syncElectionStateInPlace(found);
    }
    return found;
  }

  public buildPublicElectionContext(election: ElectionModel) {
    syncElectionStateInPlace(election);
    const statusCode = election.status;
    const [badgeClass, statusLabel] = STATUS_BADGE_MAP[statusCode] || [
      'badge-draft',
      statusCode,
    ];
    const statusSentence =
      STATUS_SENTENCE_MAP[statusCode] || 'Election status is available below.';

    const activeCandidates = this.candidates
      .filter((c) => c.election_id === election.election_id && c.is_active)
      .sort((a, b) => a.display_order - b.display_order || a.candidate_id_num - b.candidate_id_num);

    const candidateRoster = activeCandidates.map((cand) => {
      const [, symAlt] = resolveCandidateSymbolPath(cand.symbol);
      const resolvedSymbolUrl = resolvePublicCandidateSymbolUrl(cand);
      return {
        candidate_id: cand.candidate_id_num,
        name: cand.name,
        symbol: cand.symbol,
        description: cand.description,
        symbol_src: resolvedSymbolUrl,
        symbol_image_url: resolvedSymbolUrl,
        symbol_alt: symAlt,
      };
    });

    const eligibleRows = this.voterEligibilities.filter(
      (ve) => ve.election_id === election.election_id && ve.is_eligible
    );
    const eligibleCount = eligibleRows.length;
    const votedCount = eligibleRows.filter((ve) => ve.has_voted).length;
    const participationRate =
      eligibleCount > 0 ? Math.round((votedCount / eligibleCount) * 1000) / 10 : 0.0;

    const resultsVisible =
      election.status === 'CLOSED' ||
      election.status === 'FINALIZED' ||
      election.results_published ||
      election.result_publication_policy === 'ALWAYS_VISIBLE';

    const receiptsForElection = this.ballotReceipts.filter(
      (r) => r.election_id === election.election_id
    );
    const totalTally = receiptsForElection.length;

    const resultRows = activeCandidates.map((cand) => {
      const [, symAlt] = resolveCandidateSymbolPath(cand.symbol);
      const resolvedSymbolUrl = resolvePublicCandidateSymbolUrl(cand);
      const votesVal = receiptsForElection.filter(
        (r) => r.candidate_id === cand.candidate_id_num
      ).length;
      const sharePct =
        totalTally > 0 ? Math.round((votesVal / totalTally) * 1000) / 10 : 0.0;
      return {
        candidate_id: cand.candidate_id_num,
        name: cand.name,
        symbol: cand.symbol,
        description: cand.description,
        symbol_src: resolvedSymbolUrl,
        symbol_image_url: resolvedSymbolUrl,
        symbol_alt: symAlt,
        votes: votesVal,
        vote_share_percent: sharePct,
      };
    });

    let officialWinner = null;
    if (resultsVisible && totalTally > 0 && resultRows.length > 0) {
      const maxVotes = Math.max(...resultRows.map((r) => r.votes));
      const topRows = resultRows.filter((r) => r.votes === maxVotes);
      if (maxVotes > 0 && topRows.length === 1) {
        officialWinner = topRows[0];
      }
    }

    return {
      election_id: election.election_id,
      title: election.title,
      description: election.description,
      election_type: election.election_type,
      commencement_mode: election.commencement_mode,
      immediate_duration_hours: election.immediate_duration_hours || 1,
      status: statusCode,
      status_badge_class: badgeClass,
      status_label: statusLabel,
      status_sentence: statusSentence,
      start_datetime: election.start_datetime,
      end_datetime: election.end_datetime,
      finalized_at: election.finalized_at,
      created_at: election.created_at,
      updated_at: election.updated_at,
      turnout: {
        eligible_voters: eligibleCount,
        votes_cast: votedCount,
        participation_rate_percent: participationRate,
      },
      results: {
        visible: resultsVisible,
        classification: election.status === 'FINALIZED' ? 'OFFICIAL' : 'VERIFIED',
        candidates: resultRows,
      },
      result_rows: resultRows,
      total_tally: totalTally,
      official_winner: officialWinner,
      candidate_count: candidateRoster.length,
      candidate_roster: candidateRoster,
      candidates: candidateRoster,
      blockchain_audit: {
        contract_address: election.contract_address,
        chain_id: election.chain_id,
        deployment_status: election.deployment_status,
        candidates_locked_on_chain: election.candidates_locked_on_chain,
      },
    };
  }
}

export const store = new DVSStore();
