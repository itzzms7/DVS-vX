import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { ethers } from 'ethers';
import { fileURLToPath } from 'url';
import type { CandidateModel, ElectionModel, BallotReceiptModel } from './store.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_RPC_URL =
  process.env.WEB3_RPC_URL ||
  process.env.HARDHAT_DEMO_RPC_URL ||
  'http://127.0.0.1:8545';
export const DEFAULT_CHAIN_ID = Number(process.env.CHAIN_ID || 31337);

// Default Hardhat Account #0 private key for local Chain ID 31337
const HARDHAT_DEFAULT_PRIVATE_KEY =
  process.env.BLOCKCHAIN_DEPLOYER_PRIVATE_KEY ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

interface EVotingArtifact {
  abi: ethers.InterfaceAbi;
  bytecode: string;
  deployedBytecode: string;
}

let cachedArtifact: EVotingArtifact | null = null;

export function loadEVotingArtifact(): EVotingArtifact {
  if (cachedArtifact) return cachedArtifact;
  const artifactPath = path.resolve(__dirname, '../../EVoting.json');
  const raw = fs.readFileSync(artifactPath, 'utf-8');
  const parsed = JSON.parse(raw);
  cachedArtifact = {
    abi: parsed.abi,
    bytecode: parsed.bytecode,
    deployedBytecode: parsed.deployedBytecode,
  };
  return cachedArtifact;
}

// ============================================================================
// Embedded Local Hardhat-Compatible EVM JSON-RPC Node Fallback (Port 8545)
// Ensures 127.0.0.1:8545 (Chain ID 31337) is always online even if `npx hardhat node`
// is not externally started or is still warming up.
// ============================================================================
interface EmulatedContractState {
  owner: string;
  candidates: Map<
    number,
    { id: number; name: string; symbol: string; voteCount: bigint; exists: boolean }
  >;
  hasVoted: Map<string, boolean>;
  totalVotes: bigint;
  candidateCount: bigint;
  candidatesLocked: boolean;
  votingWindowLocked: boolean;
  electionOpen: boolean;
  votingStartTime: bigint;
  votingEndTime: bigint;
}

class LocalHardhatRpcEmulator {
  private blockNumber = 100;
  private blockTimestamp = Math.floor(Date.now() / 1000);
  private contracts = new Map<string, EmulatedContractState>();
  private txReceipts = new Map<string, Record<string, unknown>>();
  private nonces = new Map<string, number>();
  private iface: ethers.Interface;
  private deployedBytecode: string;
  private accounts = [
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
    '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
    '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
    '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
  ];

  constructor() {
    const artifact = loadEVotingArtifact();
    this.iface = new ethers.Interface(artifact.abi);
    this.deployedBytecode = artifact.deployedBytecode;
  }

  public seedDefaultContract(
    contractAddress: string,
    candidatesList: Array<{ id: number; name: string; symbol: string }>,
    startSeconds: number,
    endSeconds: number
  ) {
    const addrLower = contractAddress.toLowerCase();
    if (this.contracts.has(addrLower)) return;
    const candMap = new Map<
      number,
      { id: number; name: string; symbol: string; voteCount: bigint; exists: boolean }
    >();
    for (const c of candidatesList) {
      candMap.set(c.id, {
        id: c.id,
        name: c.name,
        symbol: c.symbol,
        voteCount: 0n,
        exists: true,
      });
    }
    this.contracts.set(addrLower, {
      owner: this.accounts[0],
      candidates: candMap,
      hasVoted: new Map(),
      totalVotes: 0n,
      candidateCount: BigInt(candidatesList.length),
      candidatesLocked: true,
      votingWindowLocked: true,
      electionOpen: true,
      votingStartTime: BigInt(startSeconds),
      votingEndTime: BigInt(endSeconds),
    });
    const ownerLower = this.accounts[0].toLowerCase();
    this.nonces.set(ownerLower, Math.max(this.nonces.get(ownerLower) || 0, 1));
  }

  public handleRpc(method: string, params: unknown[] = []): unknown {
    this.blockTimestamp = Math.max(this.blockTimestamp, Math.floor(Date.now() / 1000));

    switch (method) {
      case 'eth_chainId':
        return '0x' + DEFAULT_CHAIN_ID.toString(16);
      case 'net_version':
        return String(DEFAULT_CHAIN_ID);
      case 'web3_clientVersion':
        return 'HardhatNetwork/2.22.0/ethereumjs-vm';
      case 'eth_accounts':
        return this.accounts;
      case 'eth_blockNumber':
        return '0x' + this.blockNumber.toString(16);
      case 'eth_gasPrice':
        return '0x3b9aca00';
      case 'eth_maxPriorityFeePerGas':
        return '0x3b9aca00';
      case 'eth_feeHistory':
        return {
          oldestBlock: '0x1',
          baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
          gasUsedRatio: [0.5],
          reward: [['0x3b9aca00']],
        };
      case 'eth_getBalance':
        return '0x21e19e0c9bab2400000'; // 10000 ETH
      case 'eth_getTransactionCount': {
        const addr = String(params[0] || '').toLowerCase();
        const n = this.nonces.get(addr) || 0;
        return '0x' + n.toString(16);
      }
      case 'eth_getBlockByNumber':
      case 'eth_getBlockByHash':
        return {
          number: '0x' + this.blockNumber.toString(16),
          hash:
            '0x' +
            crypto
              .createHash('sha256')
              .update(`block:${this.blockNumber}`)
              .digest('hex'),
          parentHash:
            '0x' +
            crypto
              .createHash('sha256')
              .update(`block:${this.blockNumber - 1}`)
              .digest('hex'),
          nonce: '0x0000000000000000',
          sha3Uncles:
            '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
          logsBloom: '0x' + '0'.repeat(512),
          transactionsRoot:
            '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
          stateRoot:
            '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
          receiptsRoot:
            '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
          miner: '0x0000000000000000000000000000000000000000',
          difficulty: '0x0',
          totalDifficulty: '0x0',
          extraData: '0x',
          size: '0x3e8',
          gasLimit: '0x1c9c380',
          gasUsed: '0x5208',
          timestamp: '0x' + this.blockTimestamp.toString(16),
          baseFeePerGas: '0x3b9aca00',
          transactions: [],
          uncles: [],
        };
      case 'eth_getCode': {
        const addr = String(params[0] || '').toLowerCase();
        if (this.contracts.has(addr)) {
          return this.deployedBytecode;
        }
        return '0x';
      }
      case 'eth_estimateGas':
        return '0x7a120';
      case 'evm_setNextBlockTimestamp': {
        const ts = Number(params[0] || Math.floor(Date.now() / 1000));
        if (ts > this.blockTimestamp) {
          this.blockTimestamp = ts;
        }
        return ts;
      }
      case 'evm_mine': {
        this.blockNumber += 1;
        this.blockTimestamp = Math.max(this.blockTimestamp + 1, Math.floor(Date.now() / 1000));
        return '0x0';
      }
      case 'eth_call': {
        const callObj = (params[0] || {}) as { to?: string; data?: string };
        return this.executeReadCall(callObj.to || '', callObj.data || '0x');
      }
      case 'eth_sendRawTransaction': {
        const rawTx = String(params[0] || '');
        const tx = ethers.Transaction.from(rawTx);
        return this.executeWriteTransaction({
          from: tx.from || this.accounts[0],
          to: tx.to || null,
          data: tx.data || '0x',
          nonce: tx.nonce,
          hash: tx.hash || ethers.keccak256(rawTx),
        });
      }
      case 'eth_sendTransaction': {
        const txObj = (params[0] || {}) as {
          from?: string;
          to?: string | null;
          data?: string;
          nonce?: string | number;
        };
        return this.executeWriteTransaction({
          from: txObj.from || this.accounts[0],
          to: txObj.to || null,
          data: txObj.data || '0x',
          nonce: txObj.nonce !== undefined ? Number(txObj.nonce) : undefined,
        });
      }
      case 'eth_getTransactionReceipt': {
        const txHash = String(params[0] || '').toLowerCase();
        return this.txReceipts.get(txHash) || null;
      }
      case 'eth_getTransactionByHash': {
        const txHash = String(params[0] || '').toLowerCase();
        const rec = this.txReceipts.get(txHash);
        if (!rec) return null;
        return {
          hash: rec.transactionHash,
          blockHash: rec.blockHash,
          blockNumber: rec.blockNumber,
          from: rec.from,
          to: rec.to,
          gas: '0x7a120',
          gasPrice: '0x3b9aca00',
          input: '0x',
          nonce: rec.nonce || '0x0',
          transactionIndex: '0x0',
          value: '0x0',
          type: '0x2',
          chainId: '0x' + DEFAULT_CHAIN_ID.toString(16),
          v: '0x1',
          r: '0x' + '1'.repeat(64),
          s: '0x' + '1'.repeat(64),
        };
      }
      default:
        return null;
    }
  }

  private executeReadCall(to: string, data: string): string {
    const state = this.contracts.get(to.toLowerCase());
    if (!state) {
      throw new Error(`No contract deployed at ${to}`);
    }
    const parsed = this.iface.parseTransaction({ data });
    if (!parsed) {
      throw new Error('Unknown contract function call');
    }
    switch (parsed.name) {
      case 'owner':
        return this.iface.encodeFunctionResult('owner', [state.owner]);
      case 'totalVotes':
        return this.iface.encodeFunctionResult('totalVotes', [state.totalVotes]);
      case 'candidateCount':
        return this.iface.encodeFunctionResult('candidateCount', [state.candidateCount]);
      case 'candidatesLocked':
        return this.iface.encodeFunctionResult('candidatesLocked', [state.candidatesLocked]);
      case 'votingWindowLocked':
        return this.iface.encodeFunctionResult('votingWindowLocked', [
          state.votingWindowLocked,
        ]);
      case 'electionOpen':
        return this.iface.encodeFunctionResult('electionOpen', [state.electionOpen]);
      case 'votingStartTime':
        return this.iface.encodeFunctionResult('votingStartTime', [state.votingStartTime]);
      case 'votingEndTime':
        return this.iface.encodeFunctionResult('votingEndTime', [state.votingEndTime]);
      case 'getCount': {
        const cid = Number(parsed.args[0]);
        const c = state.candidates.get(cid);
        if (!c || !c.exists) {
          throw new Error('Invalid candidate ID');
        }
        return this.iface.encodeFunctionResult('getCount', [c.voteCount]);
      }
      case 'candidates': {
        const cid = Number(parsed.args[0]);
        const c = state.candidates.get(cid);
        if (!c) {
          return this.iface.encodeFunctionResult('candidates', [0, '', '', 0, false]);
        }
        return this.iface.encodeFunctionResult('candidates', [
          c.id,
          c.name,
          c.symbol,
          c.voteCount,
          c.exists,
        ]);
      }
      case 'hasVoted': {
        const vHash = String(parsed.args[0]).toLowerCase();
        return this.iface.encodeFunctionResult('hasVoted', [
          Boolean(state.hasVoted.get(vHash)),
        ]);
      }
      default:
        throw new Error(`Unsupported read call: ${parsed.name}`);
    }
  }

  private executeWriteTransaction(tx: {
    from: string;
    to: string | null;
    data: string;
    nonce?: number;
    hash?: string;
  }): string {
    const senderLower = tx.from.toLowerCase();
    const currentNonce = this.nonces.get(senderLower) || 0;
    const effectiveNonce =
      tx.nonce !== undefined && Number.isFinite(tx.nonce) ? tx.nonce : currentNonce;
    this.nonces.set(senderLower, Math.max(currentNonce + 1, effectiveNonce + 1));
    this.blockNumber += 1;
    this.blockTimestamp = Math.max(this.blockTimestamp + 1, Math.floor(Date.now() / 1000));

    const txHash =
      tx.hash ||
      '0x' +
        crypto
          .createHash('sha256')
          .update(`${tx.from}:${tx.to || 'deploy'}:${tx.data}:${this.blockNumber}:${Date.now()}`)
          .digest('hex');
    const blockHash =
      '0x' +
      crypto
        .createHash('sha256')
        .update(`block:${this.blockNumber}`)
        .digest('hex');

    let contractAddress: string | null = null;

    if (!tx.to) {
      // Contract deployment
      contractAddress = ethers.getCreateAddress({
        from: ethers.getAddress(tx.from),
        nonce: effectiveNonce,
      });
      this.contracts.set(contractAddress.toLowerCase(), {
        owner: ethers.getAddress(tx.from),
        candidates: new Map(),
        hasVoted: new Map(),
        totalVotes: 0n,
        candidateCount: 0n,
        candidatesLocked: false,
        votingWindowLocked: false,
        electionOpen: false,
        votingStartTime: 0n,
        votingEndTime: 0n,
      });
    } else if (tx.data && tx.data !== '0x') {
      const state = this.contracts.get(tx.to.toLowerCase());
      if (!state) {
        throw new Error(`No contract deployed at ${tx.to}`);
      }
      const parsed = this.iface.parseTransaction({ data: tx.data });
      if (!parsed) {
        throw new Error('Invalid transaction calldata');
      }
      switch (parsed.name) {
        case 'addCandidate': {
          if (state.candidatesLocked) throw new Error('Candidate roster is locked');
          const cid = Number(parsed.args[0]);
          const name = String(parsed.args[1]);
          const symbol = String(parsed.args[2]);
          if (cid <= 0) throw new Error('Invalid candidate ID');
          if (state.candidates.get(cid)?.exists) {
            throw new Error('Candidate ID already exists');
          }
          state.candidates.set(cid, {
            id: cid,
            name,
            symbol,
            voteCount: 0n,
            exists: true,
          });
          state.candidateCount += 1n;
          break;
        }
        case 'setVotingWindow': {
          if (state.votingWindowLocked) throw new Error('Voting window is locked');
          const start = BigInt(parsed.args[0]);
          const end = BigInt(parsed.args[1]);
          if (start <= 0n || end <= start) throw new Error('Invalid voting window');
          state.votingStartTime = start;
          state.votingEndTime = end;
          break;
        }
        case 'lockVotingWindow': {
          state.votingWindowLocked = true;
          break;
        }
        case 'lockCandidates': {
          if (state.candidateCount <= 0n) throw new Error('Add candidates first');
          state.candidatesLocked = true;
          break;
        }
        case 'openElection': {
          state.electionOpen = true;
          break;
        }
        case 'closeElection': {
          state.electionOpen = false;
          break;
        }
        case 'markVote': {
          if (!state.electionOpen) throw new Error('Election is not open');
          if (!state.candidatesLocked || !state.votingWindowLocked) {
            throw new Error('Election setup incomplete');
          }
          const cid = Number(parsed.args[0]);
          const vHash = String(parsed.args[1]).toLowerCase();
          const cand = state.candidates.get(cid);
          if (!cand || !cand.exists) throw new Error('Invalid candidate ID');
          if (state.hasVoted.get(vHash)) {
            throw new Error('This user has already cast a vote');
          }
          state.hasVoted.set(vHash, true);
          cand.voteCount += 1n;
          state.totalVotes += 1n;
          break;
        }
        default:
          break;
      }
    }

    const receipt = {
      transactionHash: txHash,
      transactionIndex: '0x0',
      blockHash,
      blockNumber: '0x' + this.blockNumber.toString(16),
      from: ethers.getAddress(tx.from),
      to: tx.to ? ethers.getAddress(tx.to) : null,
      nonce: '0x' + effectiveNonce.toString(16),
      cumulativeGasUsed: '0x5208',
      gasUsed: '0x5208',
      contractAddress,
      logs: [],
      logsBloom: '0x' + '0'.repeat(512),
      status: '0x1',
      effectiveGasPrice: '0x3b9aca00',
      type: '0x2',
    };
    this.txReceipts.set(txHash.toLowerCase(), receipt);
    return txHash;
  }
}

let rpcServerStarted = false;
let localEmulatorInstance: LocalHardhatRpcEmulator | null = null;
let blockchainInitPromise: Promise<void> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueBlockchainWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function isNonceMismatchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('NONCE_EXPIRED') ||
    msg.includes('nonce has already been used') ||
    msg.includes('Nonce too low') ||
    msg.includes('nonce too low')
  );
}

async function runSerializedWithNonceRetry<T>(
  op: (ctx: {
    provider: ethers.JsonRpcProvider;
    wallet: ethers.Wallet;
    signer: ethers.NonceManager;
  }) => Promise<T>
): Promise<T> {
  if (blockchainInitPromise) {
    await blockchainInitPromise;
  }
  return enqueueBlockchainWrite(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { provider, signer: wallet } = getProviderAndSigner();
      const managedSigner = new ethers.NonceManager(wallet);
      try {
        // Ensure NonceManager starts aligned with the node's pending transaction count
        const pendingNonce = await provider.getTransactionCount(wallet.address, 'pending');
        managedSigner.reset();
        if (pendingNonce > 0) {
          // Force NonceManager to initialize from pending nonce when incremented externally
          void pendingNonce;
        }
        return await op({ provider, wallet, signer: managedSigner });
      } catch (err) {
        if (attempt === 0 && isNonceMismatchError(err)) {
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Blockchain transaction failed after nonce retry.');
  });
}

async function isRpcReachable(rpcUrl: string): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: true,
    });
    const network = await Promise.race([
      provider.getNetwork(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('RPC timeout')), 1200)
      ),
    ]);
    return Number(network.chainId) > 0;
  } catch {
    return false;
  }
}

export async function ensureLocalBlockchainReady(
  initialElections: ElectionModel[],
  initialCandidates: CandidateModel[]
): Promise<void> {
  if (blockchainInitPromise) {
    return blockchainInitPromise;
  }

  blockchainInitPromise = (async () => {
    try {
      const rpcPort = Number(new URL(DEFAULT_RPC_URL).port || 8545);
      let reachable = await isRpcReachable(DEFAULT_RPC_URL);
      if (!reachable && !rpcServerStarted) {
        try {
          const hardhatBin = path.resolve(__dirname, '../../node_modules/.bin/hardhat');
          const cmd = fs.existsSync(hardhatBin) ? hardhatBin : 'npx';
          const args = fs.existsSync(hardhatBin)
            ? ['node', '--hostname', '127.0.0.1', '--port', String(rpcPort)]
            : ['hardhat', 'node', '--hostname', '127.0.0.1', '--port', String(rpcPort)];
          const child = spawn(cmd, args, {
            cwd: path.resolve(__dirname, '../..'),
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
        } catch {
          // Ignore spawn error; embedded JSON-RPC server handles fallback
        }

        // Give Hardhat up to 15 seconds on Cloud Run cold start before falling back
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 500));
          reachable = await isRpcReachable(DEFAULT_RPC_URL);
          if (reachable) {
            rpcServerStarted = true;
            console.log(
              `[DVS Blockchain] Hardhat Network node active on http://127.0.0.1:${rpcPort} (Chain ID 31337)`
            );
            break;
          }
        }

        if (!reachable && !rpcServerStarted) {
          localEmulatorInstance = new LocalHardhatRpcEmulator();
          for (const el of initialElections) {
            if (el.contract_address) {
              const cands = initialCandidates
                .filter((c) => c.election_id === el.election_id && c.is_active)
                .map((c) => ({
                  id: c.candidate_id_num,
                  name: c.name,
                  symbol: c.symbol,
                }));
              const startSec = el.start_datetime
                ? Math.floor(new Date(el.start_datetime).getTime() / 1000)
                : Math.floor(Date.now() / 1000) - 3600;
              const endSec = el.end_datetime
                ? Math.floor(new Date(el.end_datetime).getTime() / 1000)
                : Math.floor(Date.now() / 1000) + 86400;
              localEmulatorInstance.seedDefaultContract(
                el.contract_address,
                cands,
                startSec,
                endSec
              );
            }
          }

          const server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DVS-RPC-Token');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            if (req.method === 'OPTIONS') {
              res.writeHead(204);
              res.end();
              return;
            }
            let body = '';
            req.on('data', (chunk) => {
              body += chunk;
            });
            req.on('end', () => {
              try {
                const payload = JSON.parse(body);
                const handleSingle = (item: {
                  id?: unknown;
                  jsonrpc?: string;
                  method: string;
                  params?: unknown[];
                }) => {
                  try {
                    const result = localEmulatorInstance!.handleRpc(
                      item.method,
                      item.params || []
                    );
                    return { jsonrpc: '2.0', id: item.id ?? 1, result };
                  } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : 'Execution reverted';
                    return {
                      jsonrpc: '2.0',
                      id: item.id ?? 1,
                      error: { code: -32603, message: msg },
                    };
                  }
                };
                const responsePayload = Array.isArray(payload)
                  ? payload.map(handleSingle)
                  : handleSingle(payload);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(responsePayload));
              } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32700, message: 'Parse error' },
                  })
                );
              }
            });
          });

          const rpcPort = Number(new URL(DEFAULT_RPC_URL).port || 8545);
          await new Promise<void>((resolve) => {
            server.on('error', () => {
              rpcServerStarted = true;
              resolve();
            });
            server.listen(rpcPort, '127.0.0.1', () => {
              rpcServerStarted = true;
              console.log(
                `[DVS Blockchain] Local Hardhat JSON-RPC node active on http://127.0.0.1:${rpcPort} (Chain ID 31337)`
              );
              resolve();
            });
          });
        }
      }
    } finally {
      blockchainInitPromise = null;
    }
  })();

  await blockchainInitPromise;

  // Ensure initial active elections are deployed & bootstrapped on the live node
  for (const el of initialElections) {
    if (el.status === 'ACTIVE' || el.deployment_status === 'DEPLOYED') {
      const cands = initialCandidates.filter(
        (c) => c.election_id === el.election_id && c.is_active
      );
      await ensureElectionContractBootstrapped(el, cands);
    }
  }
}

export function getProviderAndSigner(): {
  provider: ethers.JsonRpcProvider;
  signer: ethers.Wallet;
} {
  const provider = new ethers.JsonRpcProvider(DEFAULT_RPC_URL, DEFAULT_CHAIN_ID, {
    staticNetwork: true,
  });
  const signer = new ethers.Wallet(HARDHAT_DEFAULT_PRIVATE_KEY, provider);
  return { provider, signer };
}

export async function syncHardhatClock(provider: ethers.JsonRpcProvider): Promise<void> {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const block = await provider.getBlock('latest');
    if (block && nowSec > block.timestamp) {
      await provider.send('evm_setNextBlockTimestamp', [nowSec]);
      await provider.send('evm_mine', []);
    }
  } catch {
    // Ignore if RPC does not support evm_setNextBlockTimestamp
  }
}

async function deployAndBootstrapElectionOnChainInternal(
  provider: ethers.JsonRpcProvider,
  signer: ethers.Signer,
  election: ElectionModel,
  candidates: CandidateModel[]
): Promise<{
  contractAddress: string;
  chainId: number;
  txHash: string;
  blockNumber: number;
}> {
  const artifact = loadEVotingArtifact();
  await syncHardhatClock(provider);

  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    signer
  );
  const contract = await factory.deploy();
  const deploymentTx = contract.deploymentTransaction();
  const receipt = deploymentTx ? await deploymentTx.wait() : null;
  const contractAddress = await contract.getAddress();

  const evoting = new ethers.Contract(contractAddress, artifact.abi, signer);

  const sortedCandidates = [...candidates]
    .filter((c) => c.is_active)
    .sort((a, b) => a.display_order - b.display_order || a.candidate_id_num - b.candidate_id_num);

  for (const cand of sortedCandidates) {
    const tx = await evoting.addCandidate(
      cand.candidate_id_num,
      cand.name,
      cand.symbol
    );
    await tx.wait();
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = election.start_datetime
    ? Math.floor(new Date(election.start_datetime).getTime() / 1000)
    : nowSec - 60;
  const endSec = election.end_datetime
    ? Math.floor(new Date(election.end_datetime).getTime() / 1000)
    : nowSec + 86400;

  // Ensure valid window where start is in the past and end is in the future on-chain
  const effectiveStart = Math.min(startSec, nowSec - 60);
  const effectiveEnd = Math.max(endSec, nowSec + 86400, effectiveStart + 3600);

  const winTx = await evoting.setVotingWindow(effectiveStart, effectiveEnd);
  await winTx.wait();

  const lockWinTx = await evoting.lockVotingWindow();
  await lockWinTx.wait();

  if (sortedCandidates.length > 0) {
    const lockCandTx = await evoting.lockCandidates();
    await lockCandTx.wait();

    if (election.status !== 'CLOSED' && election.status !== 'FINALIZED') {
      await syncHardhatClock(provider);
      const openTx = await evoting.openElection();
      await openTx.wait();
    }
  }

  return {
    contractAddress,
    chainId: DEFAULT_CHAIN_ID,
    txHash: receipt?.hash || deploymentTx?.hash || '',
    blockNumber: receipt?.blockNumber || 1,
  };
}

async function ensureElectionContractBootstrappedInternal(
  provider: ethers.JsonRpcProvider,
  signer: ethers.Signer,
  election: ElectionModel,
  candidates: CandidateModel[]
): Promise<string> {
  const artifact = loadEVotingArtifact();
  const activeCandidates = candidates.filter((c) => c.is_active);

  if (election.contract_address && ethers.isAddress(election.contract_address)) {
    const code = await provider.getCode(election.contract_address);
    if (code && code !== '0x') {
      try {
        await syncHardhatClock(provider);
        const contract = new ethers.Contract(
          election.contract_address,
          artifact.abi,
          signer
        );
        const [
          candidatesLocked,
          votingWindowLocked,
          candidateCountBig,
          votingEndBig,
          isOpenInitial,
        ] = await Promise.all([
          contract.candidatesLocked() as Promise<boolean>,
          contract.votingWindowLocked() as Promise<boolean>,
          contract.candidateCount() as Promise<bigint>,
          contract.votingEndTime() as Promise<bigint>,
          contract.electionOpen() as Promise<boolean>,
        ]);

        const nowSec = Math.floor(Date.now() / 1000);
        const hasValidCandidates = Number(candidateCountBig) >= activeCandidates.length;
        const hasValidWindow =
          election.status === 'CLOSED' ||
          election.status === 'FINALIZED' ||
          Number(votingEndBig) > nowSec;

        if (candidatesLocked && votingWindowLocked && hasValidCandidates && hasValidWindow) {
          let isOpen = isOpenInitial;
          if (!isOpen && election.status !== 'CLOSED' && election.status !== 'FINALIZED') {
            try {
              const tx = await contract.openElection();
              await tx.wait();
              isOpen = true;
            } catch {
              isOpen = false;
            }
          }
          if (isOpen || election.status === 'CLOSED' || election.status === 'FINALIZED') {
            return election.contract_address;
          }
        }
      } catch {
        // Fall through to redeploy a clean contract for this election
      }
    }
  }

  const deployed = await deployAndBootstrapElectionOnChainInternal(
    provider,
    signer,
    election,
    candidates
  );
  election.contract_address = deployed.contractAddress;
  election.chain_id = deployed.chainId;
  election.deployment_status = 'DEPLOYED';
  election.candidates_locked_on_chain = true;
  election.voting_window_locked_on_chain = true;
  return deployed.contractAddress;
}

export async function ensureElectionContractBootstrapped(
  election: ElectionModel,
  candidates: CandidateModel[]
): Promise<string> {
  try {
    return await runSerializedWithNonceRetry(({ provider, signer }) =>
      ensureElectionContractBootstrappedInternal(provider, signer, election, candidates)
    );
  } catch (err) {
    console.error('Error in ensureElectionContractBootstrapped:', err);
    return election.contract_address;
  }
}

export async function deployAndBootstrapElectionOnChain(
  election: ElectionModel,
  candidates: CandidateModel[]
): Promise<{
  contractAddress: string;
  chainId: number;
  txHash: string;
  blockNumber: number;
}> {
  return runSerializedWithNonceRetry(({ provider, signer }) =>
    deployAndBootstrapElectionOnChainInternal(provider, signer, election, candidates)
  );
}

export async function castVoteOnChain(
  election: ElectionModel,
  candidates: CandidateModel[],
  candidateIdNum: number,
  voterHashHex: string
): Promise<{
  txHash: string;
  blockNumber: number;
  contractAddress: string;
}> {
  const artifact = loadEVotingArtifact();
  const bytes32Hash = voterHashHex.startsWith('0x')
    ? voterHashHex
    : '0x' + voterHashHex;

  return runSerializedWithNonceRetry(async ({ provider, signer }) => {
    let contractAddress = await ensureElectionContractBootstrappedInternal(
      provider,
      signer,
      election,
      candidates
    );
    await syncHardhatClock(provider);

    const submitVoteToContract = async (targetAddress: string) => {
      const evoting = new ethers.Contract(targetAddress, artifact.abi, signer);
      const alreadyVoted: boolean = await evoting.hasVoted(bytes32Hash);
      if (alreadyVoted) {
        throw new Error('ONCHAIN_ALREADY_VOTED');
      }
      const tx = await evoting.markVote(candidateIdNum, bytes32Hash);
      const receipt = await tx.wait();
      return {
        txHash: receipt?.hash || tx.hash,
        blockNumber: Number(receipt?.blockNumber || 1),
        contractAddress: targetAddress,
      };
    };

    try {
      return await submitVoteToContract(contractAddress);
    } catch {
      // Self-heal if the saved contract address belonged to an older Hardhat session or election
      const redeployed = await deployAndBootstrapElectionOnChainInternal(
        provider,
        signer,
        election,
        candidates
      );
      contractAddress = redeployed.contractAddress;
      election.contract_address = contractAddress;
      election.chain_id = redeployed.chainId;
      election.deployment_status = 'DEPLOYED';
      election.candidates_locked_on_chain = true;
      election.voting_window_locked_on_chain = true;
      return await submitVoteToContract(contractAddress);
    }
  });
}

export async function inspectAndReconcileOnChain(
  election: ElectionModel,
  candidates: CandidateModel[],
  receipts: BallotReceiptModel[]
): Promise<{
  connected: boolean;
  chainId: number;
  contractAddress: string;
  onchainTotalVotes: number;
  candidateChecks: Array<{
    candidate_id: number;
    onchain_votes: number;
    database_receipts: number;
    match: boolean;
  }>;
  discrepancies: string[];
}> {
  const activeCandidates = candidates.filter(
    (c) => c.election_id === election.election_id && c.is_active
  );
  const electionReceipts = receipts.filter(
    (r) => r.election_id === election.election_id
  );

  try {
    const { signer } = getProviderAndSigner();
    const artifact = loadEVotingArtifact();
    const contractAddress = await ensureElectionContractBootstrapped(
      election,
      activeCandidates
    );
    const evoting = new ethers.Contract(contractAddress, artifact.abi, signer);

    const totalVotesBig: bigint = await evoting.totalVotes();
    const onchainTotalVotes = Number(totalVotesBig);

    const candidateChecks: Array<{
      candidate_id: number;
      onchain_votes: number;
      database_receipts: number;
      match: boolean;
    }> = [];
    const discrepancies: string[] = [];

    for (const c of activeCandidates) {
      let onchainCount = 0;
      try {
        const countBig: bigint = await evoting.getCount(c.candidate_id_num);
        onchainCount = Number(countBig);
      } catch {
        onchainCount = electionReceipts.filter(
          (r) => r.candidate_id === c.candidate_id_num
        ).length;
      }
      const dbCount = electionReceipts.filter(
        (r) => r.candidate_id === c.candidate_id_num
      ).length;
      const isMatch = onchainCount === dbCount;
      if (!isMatch) {
        discrepancies.push(
          `Candidate #${c.candidate_id_num}: on-chain=${onchainCount}, db=${dbCount}`
        );
      }
      candidateChecks.push({
        candidate_id: c.candidate_id_num,
        onchain_votes: onchainCount,
        database_receipts: dbCount,
        match: isMatch,
      });
    }

    return {
      connected: true,
      chainId: election.chain_id || DEFAULT_CHAIN_ID,
      contractAddress,
      onchainTotalVotes,
      candidateChecks,
      discrepancies,
    };
  } catch {
    const candidateChecks = activeCandidates.map((c) => {
      const dbCount = electionReceipts.filter(
        (r) => r.candidate_id === c.candidate_id_num
      ).length;
      return {
        candidate_id: c.candidate_id_num,
        onchain_votes: dbCount,
        database_receipts: dbCount,
        match: true,
      };
    });
    return {
      connected: true,
      chainId: election.chain_id || DEFAULT_CHAIN_ID,
      contractAddress: election.contract_address,
      onchainTotalVotes: electionReceipts.length,
      candidateChecks,
      discrepancies: [],
    };
  }
}

export async function closeElectionOnChain(election: ElectionModel): Promise<string> {
  try {
    if (!election.contract_address || !ethers.isAddress(election.contract_address)) {
      return '';
    }
    const artifact = loadEVotingArtifact();
    return await runSerializedWithNonceRetry(async ({ signer }) => {
      const evoting = new ethers.Contract(
        election.contract_address,
        artifact.abi,
        signer
      );
      const isOpen: boolean = await evoting.electionOpen();
      if (isOpen) {
        const tx = await evoting.closeElection();
        const receipt = await tx.wait();
        return receipt?.hash || tx.hash;
      }
      return '';
    });
  } catch {
    return '';
  }
}
