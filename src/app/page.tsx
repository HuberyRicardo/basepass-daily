"use client";

import { useEffect, useMemo, useState } from "react";
import { isAddress, zeroAddress } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { basePassDailyAbi } from "@/abi/basePassDaily";
import { coinbaseConnector, config, contractAddress, dataSuffix, metaMaskConnector, okxConnector } from "@/lib/wagmi";

type WalletKind = "okx" | "metamask" | "coinbase";

type LocalStats = {
  checkIns: number;
  points: number;
  streak: number;
  lastDay: number;
  raffleEntries: number;
};

const emptyStats: LocalStats = {
  checkIns: 0,
  points: 0,
  streak: 0,
  lastDay: 0,
  raffleEntries: 0,
};

type InjectedWalletProvider = {
  isMetaMask?: true;
  isOkxWallet?: true;
  isOKExWallet?: true;
  providers?: InjectedWalletProvider[];
};

function today() {
  return Math.floor(Date.now() / 1000 / 86_400);
}

function todayBigInt() {
  return BigInt(today());
}

function shortAddress(address?: string) {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function walletName(kind: WalletKind) {
  if (kind === "okx") return "OKX Wallet";
  if (kind === "metamask") return "MetaMask";
  return "Coinbase Wallet";
}

function hasInjectedWallet(kind: Exclude<WalletKind, "coinbase">) {
  if (typeof window === "undefined") return false;
  const injectedWindow = window as typeof window & {
    ethereum?: InjectedWalletProvider;
    okxwallet?: InjectedWalletProvider;
  };
  if (kind === "okx" && injectedWindow.okxwallet) return true;
  const ethereum = injectedWindow.ethereum;
  const providers = ethereum?.providers ?? [];
  const allProviders = ethereum ? [ethereum, ...providers] : providers;
  return allProviders.some((provider) =>
    kind === "okx"
      ? provider.isOkxWallet === true || provider.isOKExWallet === true
      : provider.isMetaMask === true,
  );
}

export default function Home() {
  const [message, setMessage] = useState("");
  const [localStats, setLocalStats] = useState<LocalStats>(emptyStats);
  const [referrer] = useState<`0x${string}`>(() => {
    if (typeof window === "undefined") return zeroAddress;
    const value = new URLSearchParams(window.location.search).get("ref");
    return value && isAddress(value) ? value : zeroAddress;
  });

  const { address, chainId, isConnected } = useAccount();
  const { connectAsync, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContract, data: hash, error: writeError, isPending: isWriting } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ config, hash });

  const isOnchain = Boolean(contractAddress);
  const isBusy = isConnecting || isWriting || isConfirming;

  const reads = useReadContracts({
    config,
    allowFailure: false,
    query: { enabled: Boolean(address) && isOnchain },
    contracts:
      address && contractAddress
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

  useEffect(() => {
    if (!address || isOnchain) {
      queueMicrotask(() => setLocalStats(emptyStats));
      return;
    }
    const stored = window.localStorage.getItem(`basepass-daily:${address.toLowerCase()}`);
    queueMicrotask(() => setLocalStats(stored ? { ...emptyStats, ...JSON.parse(stored) } : emptyStats));
  }, [address, isOnchain]);

  useEffect(() => {
    if (!address || isOnchain) return;
    window.localStorage.setItem(`basepass-daily:${address.toLowerCase()}`, JSON.stringify(localStats));
  }, [address, isOnchain, localStats]);

  useEffect(() => {
    if (!isSuccess) return;
    queueMicrotask(() => setMessage("Transaction confirmed."));
    void reads.refetch();
  }, [isSuccess, reads]);

  const [checkIns = 0n, rewardPoints = 0n, lastCheckInDay = 0n, streak = 0n, raffleEntries = 0n] = reads.data ?? [];

  const stats = useMemo(
    () => ({
      checkIns: isOnchain ? Number(checkIns) : localStats.checkIns,
      points: isOnchain ? Number(rewardPoints) : localStats.points,
      streak: isOnchain ? Number(streak) : localStats.streak,
      raffleEntries: isOnchain ? Number(raffleEntries) : localStats.raffleEntries,
      claimedToday: isConnected && (isOnchain ? lastCheckInDay === todayBigInt() : localStats.lastDay === today()),
    }),
    [checkIns, isConnected, isOnchain, lastCheckInDay, localStats, raffleEntries, rewardPoints, streak],
  );

  async function connectWallet(kind: WalletKind) {
    const name = walletName(kind);
    setMessage(`Opening ${name}...`);

    if (kind !== "coinbase" && !hasInjectedWallet(kind)) {
      setMessage(`${name} was not detected in this browser.`);
      return;
    }

    const connector = kind === "okx" ? okxConnector : kind === "metamask" ? metaMaskConnector : coinbaseConnector;

    try {
      await connectAsync({ connector, chainId: 8453 });
      setMessage(`${name} connected.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet connection failed.");
    }
  }

  async function ensureBase() {
    if (chainId === 8453) return;
    await switchChainAsync({ chainId: 8453 });
  }

  async function claimDailyPass() {
    if (!address || stats.claimedToday) return;
    setMessage("Claiming Daily Pass...");

    if (!isOnchain || !contractAddress) {
      setLocalStats((current) => {
        const nextStreak = current.lastDay + 1 === today() ? current.streak + 1 : 1;
        return {
          ...current,
          checkIns: current.checkIns + 1,
          points: current.points + 10 + (nextStreak > 1 ? 2 : 0),
          streak: nextStreak,
          lastDay: today(),
        };
      });
      setMessage("Daily Pass claimed locally.");
      return;
    }

    await ensureBase();
    writeContract({
      address: contractAddress,
      abi: basePassDailyAbi,
      functionName: "claimDailyPass",
      args: [referrer],
      dataSuffix,
    });
  }

  async function redeemReward() {
    if (!address) return;
    setMessage("Redeeming reward...");

    if (!isOnchain || !contractAddress) {
      setLocalStats((current) => (current.points >= 80 ? { ...current, points: current.points - 80 } : current));
      setMessage("Reward redeemed locally.");
      return;
    }

    await ensureBase();
    writeContract({
      address: contractAddress,
      abi: basePassDailyAbi,
      functionName: "redeemReward",
      args: [0n],
      dataSuffix,
    });
  }

  async function enterRaffle() {
    if (!address) return;
    setMessage("Entering raffle...");

    if (!isOnchain || !contractAddress) {
      setLocalStats((current) =>
        current.points >= 20
          ? { ...current, points: current.points - 20, raffleEntries: current.raffleEntries + 1 }
          : current,
      );
      setMessage("Raffle entered locally.");
      return;
    }

    await ensureBase();
    writeContract({
      address: contractAddress,
      abi: basePassDailyAbi,
      functionName: "enterRaffle",
      args: [1n],
      dataSuffix,
    });
  }

  return (
    <main className="min-h-screen bg-[#08090c] px-4 py-6 text-white">
      <div className="mx-auto max-w-md space-y-4 rounded-[8px] border border-white/10 bg-[#101216] p-5">
        <div>
          <h1 className="text-2xl font-semibold">BasePass Daily</h1>
          <p className="mt-1 text-sm text-white/55">Discover perks. Earn points. Unlock rewards.</p>
        </div>

        <div className="rounded-[8px] border border-white/10 bg-black/25 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-white/40">Wallet</p>
          <p className="mt-1 font-mono text-sm">{shortAddress(address)}</p>
        </div>

        {!isConnected ? (
          <div className="grid gap-2">
            <WalletButton label="OKX Wallet" disabled={isBusy} onClick={() => connectWallet("okx")} />
            <WalletButton label="MetaMask" disabled={isBusy} onClick={() => connectWallet("metamask")} />
            <WalletButton label="Coinbase Wallet" disabled={isBusy} onClick={() => connectWallet("coinbase")} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => disconnect()}
            className="h-11 w-full rounded-[8px] border border-white/10 bg-white/[0.05] text-sm font-semibold hover:bg-white/[0.09]"
          >
            Disconnect
          </button>
        )}

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Today" value={stats.claimedToday ? "Claimed" : "Open"} />
          <Stat label="Check-ins" value={String(stats.checkIns)} />
          <Stat label="Points" value={String(stats.points)} />
          <Stat label="Streak" value={`${stats.streak} days`} />
        </div>

        <div className="grid gap-2">
          <ActionButton disabled={!isConnected || stats.claimedToday || isBusy} onClick={claimDailyPass}>
            {stats.claimedToday ? "Claimed Today" : "Claim Daily Pass"}
          </ActionButton>
          <ActionButton disabled={!isConnected || isBusy} onClick={redeemReward}>
            Redeem Reward
          </ActionButton>
          <ActionButton disabled={!isConnected || isBusy} onClick={enterRaffle}>
            Enter Raffle
          </ActionButton>
        </div>

        <div className="rounded-[8px] border border-white/10 bg-black/25 p-3 text-xs leading-5 text-white/65">
          <p>{isOnchain ? "Onchain mode: transactions use Base gas." : "Local mode: no gas required."}</p>
          <p>Raffle entries: {stats.raffleEntries}</p>
          <p className="break-all">Referral: {address ? `${origin}/?ref=${address}` : "Connect wallet first"}</p>
        </div>

        {message ? <p className="text-sm text-[#9ee7cf]">{message}</p> : null}
        {writeError ? <p className="text-sm text-[#ff8d8d]">{writeError.message}</p> : null}
        {hash ? (
          <a
            href={`https://basescan.org/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm text-[#9ee7cf] underline-offset-4 hover:underline"
          >
            {hash}
          </a>
        ) : null}
      </div>
    </main>
  );
}

function WalletButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-12 rounded-[8px] bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/30"
    >
      {label}
    </button>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void onClick()}
      className="h-11 rounded-[8px] border border-white/10 bg-white/[0.05] text-sm font-semibold hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:text-white/35"
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-white/10 bg-white/[0.035] p-3">
      <p className="text-xs text-white/40">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
