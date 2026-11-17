export type ElectionStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'CLOSED' | 'FINALIZED';

export interface CandidateRosterItem {
  candidate_id: number;
  name: string;
  symbol: string;
  description?: string;
  symbol_src: string;
  symbol_alt: string;
  is_selected?: boolean;
}

export interface ElectionResultRow {
  candidate_id: number;
  name: string;
  symbol: string;
  description?: string;
  symbol_src: string;
  symbol_alt: string;
  votes: number;
  vote_share_percent: number;
}

export interface PublicElectionDetail {
  election_id: number;
  title: string;
  description: string;
  election_type: 'ELECTION' | 'POLL' | 'REFERENDUM' | 'CORPORATE';
  commencement_mode: 'IMMEDIATE' | 'SCHEDULED';
  immediate_duration_hours: number;
  status: ElectionStatus;
  status_badge_class: string;
  status_label: string;
  status_sentence: string;
  start_datetime: string | null;
  end_datetime: string | null;
  finalized_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  turnout: {
    eligible_voters: number;
    votes_cast?: number;
    participation_rate_percent: number;
  };
  results: {
    visible: boolean;
    classification?: string;
  };
  result_rows: ElectionResultRow[];
  total_tally: number | null;
  official_winner: ElectionResultRow | null;
  candidate_count: number;
  candidate_roster: CandidateRosterItem[];
  eligible_voter_ids?: string[];
}

export interface VoterRecord {
  id: number;
  aadhar_number: string;
  voter_id: string;
  name: string;
  phone: string;
  has_voted?: boolean;
  security_flagged?: boolean;
}

export interface OfficialRecord {
  id: number;
  official_id: string;
  name: string;
  password?: string;
}

export interface WizardDetails {
  title: string;
  description: string;
  election_type: 'ELECTION' | 'POLL' | 'REFERENDUM' | 'CORPORATE';
  election_type_label: string;
  start_datetime_input: string;
  end_datetime_input: string;
}

export interface WizardCandidate {
  name: string;
  party: string;
  symbol_image_url: string;
}

export interface VoterSubmissionResult {
  registered_count?: number;
  included_count?: number;
  rejected_count: number;
  rejected_records: Array<{
    line_number: number;
    raw_line?: string;
    voter_id?: string;
    reason: string;
  }>;
}

export interface OfficialSubmissionResult {
  registered_count: number;
  rejected_count: number;
  rejected_records: Array<{
    line_number: number;
    official_id?: string;
    reason: string;
  }>;
}

export interface VerifiedReceipt {
  tx_hash: string;
  block_number: number;
  contract_address: string;
  election_id: number;
  election_title: string;
  confirmed_at: string;
  receipt_reference: string;
}

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  is_superuser: boolean;
  portal_role: 'SUPER_ADMIN' | 'ELECTION_ADMIN';
}

export const WIZARD_ELECTION_TYPE_CHOICES: Array<[WizardDetails['election_type'], string]> = [
  ['ELECTION', 'Election'],
  ['POLL', 'Poll'],
  ['REFERENDUM', 'Referendum'],
  ['CORPORATE', 'Corporate / Organisational Voting'],
];
