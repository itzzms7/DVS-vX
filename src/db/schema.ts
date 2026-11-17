import { pgTable, serial, integer, text, boolean } from 'drizzle-orm/pg-core';

export const elections = pgTable('elections', {
  id: serial('id').primaryKey(),
  electionId: integer('election_id').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  electionType: text('election_type').notNull().default('ELECTION'),
  commencementMode: text('commencement_mode').notNull().default('SCHEDULED'),
  immediateDurationHours: integer('immediate_duration_hours'),
  status: text('status').notNull().default('DRAFT'),
  deploymentStatus: text('deployment_status').notNull().default('NOT_DEPLOYED'),
  resultPublicationPolicy: text('result_publication_policy')
    .notNull()
    .default('HIDDEN_UNTIL_CLOSE'),
  startDatetime: text('start_datetime'),
  endDatetime: text('end_datetime'),
  finalizedAt: text('finalized_at'),
  reconciledAt: text('reconciled_at'),
  contractAddress: text('contract_address').notNull().default(''),
  chainId: integer('chain_id').notNull().default(31337),
  candidatesLockedOnChain: boolean('candidates_locked_on_chain').notNull().default(false),
  votingWindowLockedOnChain: boolean('voting_window_locked_on_chain')
    .notNull()
    .default(false),
  resultsVerified: boolean('results_verified').notNull().default(false),
  resultsPublished: boolean('results_published').notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const candidates = pgTable('candidates', {
  id: serial('id').primaryKey(),
  electionId: integer('election_id').notNull(),
  candidateIdNum: integer('candidate_id_num').notNull(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  description: text('description').notNull().default(''),
  displayOrder: integer('display_order').notNull().default(1),
  symbolImageUrl: text('symbol_image_url').notNull().default(''),
  isActive: boolean('is_active').notNull().default(true),
  isSyncedOnChain: boolean('is_synced_on_chain').notNull().default(false),
});

export const voters = pgTable('voters', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  aadharNumber: text('aadhar_number').notNull().unique(),
  phone: text('phone').notNull().default(''),
  boundWallet: text('bound_wallet'),
  status: text('status').notNull().default('ACTIVE'),
  hasVoted: boolean('has_voted').notNull().default(false),
  votedAt: text('voted_at'),
  isSynthetic: boolean('is_synthetic').notNull().default(false),
  securityFlagged: boolean('security_flagged').notNull().default(false),
  securityFlagReason: text('security_flag_reason').notNull().default(''),
  createdAt: text('created_at').notNull(),
});

export const voterEligibilities = pgTable('voter_eligibilities', {
  id: serial('id').primaryKey(),
  electionId: integer('election_id').notNull(),
  voterId: integer('voter_id').notNull(),
  isEligible: boolean('is_eligible').notNull().default(true),
  hasVoted: boolean('has_voted').notNull().default(false),
  votedAt: text('voted_at'),
});

export const ballotReceipts = pgTable('ballot_receipts', {
  id: serial('id').primaryKey(),
  voterId: integer('voter_id').notNull(),
  electionId: integer('election_id').notNull(),
  candidateId: integer('candidate_id').notNull(),
  voterHash: text('voter_hash').notNull(),
  contractAddress: text('contract_address').notNull().default(''),
  txHash: text('tx_hash').notNull(),
  blockNumber: integer('block_number').notNull().default(0),
  receiptReference: text('receipt_reference').notNull(),
  confirmedAt: text('confirmed_at').notNull(),
});

export const staffUsers = pgTable('staff_users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  name: text('name').notNull(),
  password: text('password').notNull(),
  isSuperuser: boolean('is_superuser').notNull().default(false),
  isStaff: boolean('is_staff').notNull().default(true),
  portalRole: text('portal_role').notNull().default('ELECTION_ADMIN'),
  groupsJson: text('groups_json').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
});

export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: serial('id').primaryKey(),
  actorUsername: text('actor_username').notNull(),
  action: text('action').notNull(),
  targetModel: text('target_model').notNull(),
  targetId: text('target_id').notNull(),
  details: text('details').notNull().default(''),
  ipAddress: text('ip_address').notNull().default('127.0.0.1'),
  timestamp: text('timestamp').notNull(),
});
