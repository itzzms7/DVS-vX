import { defineConfig } from "hardhat/config";

export default defineConfig({
  solidity: {
    version: "0.8.28",
  },
  paths: {
    sources: "./blocks/contracts",
  },
  networks: {
    default: {
      type: "edr-simulated",
      chainId: 31337,
    },
    localhost: {
      type: "http",
      url: process.env.HARDHAT_DEMO_RPC_URL || "http://127.0.0.1:8545",
      chainId: 31337,
    },
    hardhatDemo: {
      type: "http",
      url: process.env.HARDHAT_DEMO_RPC_URL || "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
});

