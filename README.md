# Decentralized Voting System (DVS)

DVS is a full-stack decentralized voting system built with:
- **Frontend**: React 19 + Vite
- **Backend**: Node.js + Express (`server.ts`)
- **Database**: Google Cloud SQL for PostgreSQL via Drizzle ORM (`src/db/schema.ts`)
- **Blockchain**: Ethereum Smart Contract (`blocks/contracts/EVoting.sol`, `EVoting.json`) on Hardhat (`http://127.0.0.1:8545`, Chain ID `31337`)

## Running DVS

```bash
npm install
npm run dev
```
