"use client";

import {
  ArrowRight,
  BadgeCheck,
  Gift,
  LinkIcon,
  LogOut,
  Sparkles,
  Ticket,
  Trophy,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, zeroAddress } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { basePassDailyAbi } from "@/abi/basePassDaily";
import {
  coinbaseConnector,
  config,
  contractAddress,
  dataSuffix,
  metaMaskConnector,
  okxConnector,
} from "@/lib/wagmi";

type Reward = {
  id: number;
  name: string;
  metadataUri: string;
  pointCost: bigint;
  stock: bigint;
  active: boolean;
};

const rewardPreview: Reward[] = [
  {
    id: 0,
    name: "Local Coffee Upgrade",
    metadataUri: "Sample perk",
    pointCost: 80n,
    stock: 24n,
    active: true,
  },
  {
    id: 1,
    name: "Weekend Fitness Drop-in",
    metadataUri: "Sample perk",
    pointCost: 140n,
    stock: 12n,
    active: true,
  },
  {
    id: 2,
    name: "Streaming Trial Pass",
    metadataUri: "Sample perk",
    pointCost: 220n,
    stock: 8n,
    active: true,
  },
];

function shortAddress(address?: string) {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function currentDay() {
  return BigInt(Math.floor(Date.now() / 1000 / 86_400));
}

function points(value?: bigint) {
  return value ? Number(formatUnits(value, 0)).toLocaleString("en-US") : "0";
}

export default function Home() {
  const [showWallets, setShowWallets] = useState(false);
  const [referrer] = useState<`0x${string}`>(() => {
    if (typeof window === "undefined") return zeroAddress;
    const value = new URLSearchParams(window.location.search).get("ref");
    return value && isAddress(value) ? value : zeroAddress;
  });
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const { address, chainId, isConnected } = useAccount();
  const { connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContract, data: hash, isPending: isWriting, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, config });

  const isReadyForContract = contractAddress !== zeroAddress;

  const userReads = useReadContracts({
    config,
    allowFailure: false,
    query: {
      enabled: Boolean(address) && isReadyForContract,
    },
    contracts: address
      ? [
          {
            address: contractAddress,
            abi: basePassDailyAbi,
            functionName: "walletCheckInCount",
            args: [address],
          },
          {
            address: contractAddress,
            abi: basePassDailyAbi,
            functionName: "rewardPoints",
            args: [address],
          },
          {
            address: contractAddress,
            abi: basePassDailyAbi,
            functionName: "lastCheckInDay",
            args: [address],
          },
          {
            address: contractAddress,
            abi: basePassDailyAbi,
            functionName: "checkInStreak",
            args: [address],
          },
          {
            address: contractAddress,
            abi: basePassDailyAbi,
            functionName: "raffleEntries",
            args: [address],
          },
        ]
      : [],
  });

  const rewardCount = useReadContract({
    config,
    address: contractAddress,
    abi: basePassDailyAbi,
    functionName: "rewardCount",
    query: {
      enabled: isReadyForContract,
    },
  });

  const raffleRound = useReadContract({
    config,
    address: contractAddress,
    abi: basePassDailyAbi,
    functionName: "raffleRound",
    query: {
      enabled: isReadyForContract,
    },
  });

  const lastWinner = useReadContract({
    config,
    address: contractAddress,
    abi: basePassDailyAbi,
    functionName: "lastRaffleWinner",
    query: {
      enabled: isReadyForContract,
    },
  });

  const raffleEntryCost = useReadContract({
    config,
    address: contractAddress,
    abi: basePassDailyAbi,
    functionName: "raffleEntryCost",
    query: {
      enabled: isReadyForContract,
    },
  });

  const rewardIds = useMemo(() => {
    const count = rewardCount.data ? Number(rewardCount.data) : 0;
    return Array.from({ length: Math.min(count, 6) }, (_, id) => id);
  }, [rewardCount.data]);

  const rewardReads = useReadContracts({
    config,
    allowFailure: true,
    query: {
      enabled: isReadyForContract && rewardIds.length > 0,
    },
    contracts: rewardIds.map((id) => ({
      address: contractAddress,
      abi: basePassDailyAbi,
      functionName: "getReward",
      args: [BigInt(id)],
    })),
  });

  useEffect(() => {
    if (!isSuccess) return;
    void userReads.refetch();
    void rewardCount.refetch();
    void rewardReads.refetch();
    void raffleRound.refetch();
    void lastWinner.refetch();
    void raffleEntryCost.refetch();
  }, [isSuccess, lastWinner, raffleEntryCost, raffleRound, rewardCount, rewardReads, userReads]);

  const [checkInCount = 0n, rewardPointBalance = 0n, lastCheckInDay = 0n, streak = 0n, entries = 0n] =
    userReads.data ?? [];

  const claimedToday = isConnected && lastCheckInDay === currentDay();
  const inviteLink = address && origin ? `${origin}/?ref=${address}` : "Connect wallet to create your link";

  const rewards = useMemo<Reward[]>(() => {
    if (!rewardReads.data?.length) return rewardPreview;
    return rewardReads.data
      .map((result, index) => {
        if (result.status !== "success") return null;
        const reward = result.result as unknown as readonly [string, string, bigint, bigint, boolean];
        return {
          id: rewardIds[index],
          name: reward[0],
          metadataUri: reward[1],
          pointCost: reward[2],
          stock: reward[3],
          active: reward[4],
        };
      })
      .filter((reward): reward is Reward => Boolean(reward));
  }, [rewardIds, rewardReads.data]);

  async function ensureBaseChain() {
    if (chainId === 8453) return;
    await switchChainAsync({ chainId: 8453 });
  }

  async function claimPass() {
    if (!isConnected || !address || claimedToday || !isReadyForContract) return;
    reset();
    await ensureBaseChain();
    writeContract({
      address: contractAddress,
      abi: basePassDailyAbi,
      functionName: "claimDailyPass",
      args: [referrer],
      dataSuffix,
    });
  }

  async function redeemReward(rewardId: number) {
    if (!isConnected || !isReadyForContract) return;
    reset();
    await ensureBaseChain();
    writeContract({
      address: contractAddress,
      abi: basePassDailyAbi,
      functionName: "redeemReward",
      args: [BigInt(rewardId)],
      dataSuffix,
    });
  }

  async function enterRaffle() {
    if (!isConnected || !isReadyForContract) return;
    reset();
    await ensureBaseChain();
    writeContract({
      address: contractAddress,
      abi: basePassDailyAbi,
      functionName: "enterRaffle",
      args: [1n],
      dataSuffix,
    });
  }

  function connectWallet(kind: "okx" | "metamask" | "coinbase") {
    const connector = kind === "okx" ? okxConnector : kind === "metamask" ? metaMaskConnector : coinbaseConnector;
    connect(
      { connector, chainId: 8453 },
      {
        onSuccess: () => setShowWallets(false),
      },
    );
  }

  const mainButtonLabel = !isConnected ? "Connect Wallet" : claimedToday ? "Claimed Today" : "Claim Daily Pass";
  const isBusy = isConnecting || isWriting || isConfirming;

  return (
    <main className="min-h-screen bg-[#08090c] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-24 pt-5 sm:px-6 lg:px-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-[#9ee7cf]">
              <Sparkles className="h-3.5 w-3.5" />
              Daily local perks on Base
            </div>
            <h1 className="text-3xl font-semibold leading-tight tracking-normal text-white sm:text-5xl">
              BasePass Daily
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/62 sm:text-base">
              Discover perks. Earn points. Unlock rewards.
            </p>
          </div>
          {isConnected ? (
            <button
              type="button"
              onClick={() => disconnect()}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
              aria-label="Disconnect wallet"
              title="Disconnect"
            >
              <LogOut className="h-4 w-4" />
            </button>
          ) : null}
        </header>

        <section id="pass" className="mt-7 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[8px] border border-white/10 bg-[#101216] p-5 shadow-2xl shadow-black/30">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/42">Connected wallet</p>
                <p className="mt-1 font-mono text-sm text-white">{shortAddress(address)}</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2f6bff]/15 text-[#74a3ff]">
                <Wallet className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Metric label="Today pass status" value={claimedToday ? "Complete" : "Open"} />
              <Metric label="Total check-ins" value={points(checkInCount)} />
              <Metric label="Reward points" value={points(rewardPointBalance)} />
              <Metric label="Current streak" value={`${points(streak)} days`} />
            </div>

            <button
              type="button"
              disabled={(isConnected && claimedToday) || isBusy || (isConnected && !isReadyForContract)}
              onClick={() => (isConnected ? void claimPass() : setShowWallets(true))}
              className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-[8px] bg-[#f4f7fb] px-5 text-sm font-semibold text-[#08090c] transition hover:bg-white disabled:cursor-not-allowed disabled:bg-white/18 disabled:text-white/45"
            >
              {isBusy ? "Waiting for wallet..." : mainButtonLabel}
              {!claimedToday ? <ArrowRight className="h-4 w-4" /> : <BadgeCheck className="h-4 w-4" />}
            </button>

            {showWallets ? (
              <div className="mt-3 rounded-[8px] border border-white/10 bg-black/30 p-2">
                <WalletOption label="OKX Wallet" onClick={() => connectWallet("okx")} />
                <WalletOption label="MetaMask" onClick={() => connectWallet("metamask")} />
                <WalletOption label="Coinbase Wallet" onClick={() => connectWallet("coinbase")} />
              </div>
            ) : null}

            {!isReadyForContract ? (
              <p className="mt-3 text-xs leading-5 text-[#ffcf7a]">
                Contract address is not configured. Add NEXT_PUBLIC_CONTRACT_ADDRESS before claiming.
              </p>
            ) : null}
            {writeError ? <p className="mt-3 text-xs leading-5 text-[#ff8d8d]">{writeError.message}</p> : null}
            {hash ? (
              <a
                href={`https://basescan.org/tx/${hash}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block truncate text-xs text-[#9ee7cf] underline-offset-4 hover:underline"
              >
                Transaction: {hash}
              </a>
            ) : null}
          </div>

          <div className="grid gap-4">
            <Panel id="invite" icon={<LinkIcon className="h-5 w-5" />} title="Referral link">
              <p className="break-all rounded-[8px] border border-white/10 bg-white/[0.035] p-3 font-mono text-xs leading-5 text-white/72">
                {inviteLink}
              </p>
              <p className="mt-3 text-xs leading-5 text-white/48">
                Active referrer: {referrer === zeroAddress ? "None" : shortAddress(referrer)}
              </p>
            </Panel>

            <Panel icon={<Ticket className="h-5 w-5" />} title="Raffle status">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Current round" value={points(raffleRound.data)} compact />
                <Metric label="Your entries" value={points(entries)} compact />
                <Metric label="Entry cost" value={`${points(raffleEntryCost.data)} pts`} compact />
                <Metric label="Last winner" value={shortAddress(lastWinner.data)} compact />
              </div>
              <button
                type="button"
                disabled={!isConnected || isBusy || !isReadyForContract}
                onClick={() => void enterRaffle()}
                className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.05] text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:text-white/35"
              >
                <Trophy className="h-4 w-4" />
                Enter Raffle
              </button>
            </Panel>
          </div>
        </section>

        <section id="rewards" className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Available rewards</h2>
            <span className="text-xs text-white/42">{rewards.length} shown</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rewards.map((reward) => (
              <article key={reward.id} className="rounded-[8px] border border-white/10 bg-[#101216] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold leading-5 text-white">{reward.name}</h3>
                    <p className="mt-1 text-xs leading-5 text-white/48">{reward.metadataUri || "Local partner perk"}</p>
                  </div>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#9ee7cf]/12 text-[#9ee7cf]">
                    <Gift className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-white/55">
                  <span>{points(reward.pointCost)} pts</span>
                  <span>{reward.active ? `${points(reward.stock)} left` : "Paused"}</span>
                </div>
                <button
                  type="button"
                  disabled={!isConnected || isBusy || !reward.active || reward.stock === 0n || !isReadyForContract}
                  onClick={() => void redeemReward(reward.id)}
                  className="mt-3 h-10 w-full rounded-[8px] bg-white/[0.05] text-sm font-semibold text-white transition hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:text-white/35"
                >
                  Redeem
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-[#08090c]/90 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-around text-xs font-medium text-white/55">
          <a href="#pass" className="text-white">
            Pass
          </a>
          <a href="#rewards">Rewards</a>
          <a href="#invite">Invite</a>
        </div>
      </nav>
    </main>
  );
}

function Metric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`rounded-[8px] border border-white/10 bg-white/[0.035] ${compact ? "p-3" : "p-4"}`}>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/38">{label}</p>
      <p className="mt-2 min-w-0 truncate text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function Panel({
  id,
  icon,
  title,
  children,
}: {
  id?: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="rounded-[8px] border border-white/10 bg-[#101216] p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.055] text-white/70">{icon}</div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function WalletOption({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 w-full items-center justify-between rounded-[8px] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.07]"
    >
      <span>{label}</span>
      <ArrowRight className="h-4 w-4 text-white/45" />
    </button>
  );
}
