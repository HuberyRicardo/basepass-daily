"use client";

import { useEffect, useMemo, useState } from "react";
import { concatHex, encodeFunctionData, isAddress, zeroAddress, type Hex } from "viem";
import {
  type Connector,
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useReadContracts,
  useSendCalls,
  useSendTransaction,
  useSwitchChain,
  useWaitForCallsStatus,
  useWaitForTransactionReceipt,
} from "wagmi";
import { basePassDailyAbi } from "@/abi/basePassDaily";
import { builderCode, config, contractAddress, dataSuffix } from "@/lib/wagmi";

type WalletKind = "okx" | "metamask" | "coinbase";

type Reward = {
  id: number;
  name: string;
  metadataUri: string;
  pointCost: bigint;
  stock: bigint;
  active: boolean;
};

type LocalStats = {
  checkIns: number;
  points: number;
  streak: number;
  lastDay: number;
  raffleEntries: number;
  rewardStock: Record<string, number>;
};

const emptyStats: LocalStats = {
  checkIns: 0,
  points: 0,
  streak: 0,
  lastDay: 0,
  raffleEntries: 0,
  rewardStock: {},
};

const fallbackRewards: Reward[] = [
  { id: 0, name: "Local Coffee Upgrade", metadataUri: "Sample reward", pointCost: 80n, stock: 24n, active: true },
  { id: 1, name: "Weekend Fitness Drop-in", metadataUri: "Sample reward", pointCost: 140n, stock: 12n, active: true },
  { id: 2, name: "Streaming Trial Pass", metadataUri: "Sample reward", pointCost: 220n, stock: 8n, active: true },
];

function dayNow() {
  return Math.floor(Date.now() / 1000 / 86_400);
}

function dayNowBigInt() {
  return BigInt(dayNow());
}

function shortAddress(address?: string) {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function walletLabel(kind: WalletKind) {
  if (kind === "okx") return "OKX Wallet";
  if (kind === "metamask") return "MetaMask";
  return "Coinbase Wallet";
}

function connectorMatches(connector: Connector, kind: WalletKind) {
  const id = connector.id.toLowerCase();
  const name = connector.name.toLowerCase();
  if (kind === "okx") return id.includes("okx") || name.includes("okx");
  if (kind === "metamask") return id.includes("metamask") || name.includes("metamask");
  return id.includes("coinbase") || name.includes("coinbase") || id.includes("baseaccount") || name.includes("base account");
}

function isInjectedFallback(connector: Connector) {
  const id = connector.id.toLowerCase();
  const name = connector.name.toLowerCase();
  return id.includes("injectedwallet") || name.includes("injected wallet");
}

function friendlyWalletError(error: unknown) {
  if (!(error instanceof Error)) return "Wallet connection failed.";
  if (error.message.toLowerCase().includes("user rejected")) {
    return "Connection was canceled in the wallet. Open MetaMask and approve the request to continue.";
  }
  return error.message;
}

function prefersCalls(connector?: Connector) {
  const id = connector?.id.toLowerCase() ?? "";
  const name = connector?.name.toLowerCase() ?? "";
  return id.includes("coinbase") || name.includes("coinbase") || id.includes("baseaccount") || name.includes("base account");
}

export default function Home() {
  const [message, setMessage] = useState("");
  const [origin, setOrigin] = useState("");
  const [localStats, setLocalStats] = useState<LocalStats>(emptyStats);
  const [referrer] = useState<`0x${string}`>(() => {
    if (typeof window === "undefined") return zeroAddress;
    const ref = new URLSearchParams(window.location.search).get("ref");
    return ref && isAddress(ref) ? ref : zeroAddress;
  });

  const { address, chainId, connector, isConnected } = useAccount();
  const { connectAsync, connectors, error: connectError, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const {
    sendCallsAsync,
    data: callsResult,
    error: sendCallsError,
    isPending: isSendingCalls,
  } = useSendCalls({ config });
  const {
    sendTransactionAsync,
    data: hash,
    error: sendTransactionError,
    isPending: isSendingTransaction,
  } = useSendTransaction({ config });
  const { data: callsStatus, isSuccess: isCallsSuccess } = useWaitForCallsStatus({
    config,
    id: callsResult?.id,
    query: { enabled: Boolean(callsResult?.id) },
  });
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ config, hash });
  const callReceiptHash = callsStatus?.receipts?.[0]?.transactionHash;

  const isOnchain = Boolean(contractAddress);
  const isBusy = isConnecting || isSendingCalls || isSendingTransaction || isConfirming;

  useEffect(() => {
    queueMicrotask(() => setOrigin(window.location.origin));
  }, []);

  const userReads = useReadContracts({
    config,
    allowFailure: false,
    query: { enabled: Boolean(address) && isOnchain },
    contracts:
      address && contractAddress
        ? [
            { address: contractAddress, abi: basePassDailyAbi, functionName: "walletCheckInCount", args: [address] },
            { address: contractAddress, abi: basePassDailyAbi, functionName: "rewardPoints", args: [address] },
            { address: contractAddress, abi: basePassDailyAbi, functionName: "lastCheckInDay", args: [address] },
            { address: contractAddress, abi: basePassDailyAbi, functionName: "checkInStreak", args: [address] },
            { address: contractAddress, abi: basePassDailyAbi, functionName: "raffleEntries", args: [address] },
          ]
        : [],
  });

  const rewardCount = useReadContract({
    config,
    address: contractAddress ?? zeroAddress,
    abi: basePassDailyAbi,
    functionName: "rewardCount",
    query: { enabled: isOnchain },
  });

  const raffleEntryCost = useReadContract({
    config,
    address: contractAddress ?? zeroAddress,
    abi: basePassDailyAbi,
    functionName: "raffleEntryCost",
    query: { enabled: isOnchain },
  });

  const rewardIds = useMemo(() => {
    const count = rewardCount.data ? Number(rewardCount.data) : 0;
    return Array.from({ length: Math.min(count, 3) }, (_, id) => id);
  }, [rewardCount.data]);

  const rewardReads = useReadContracts({
    config,
    allowFailure: true,
    query: { enabled: isOnchain && rewardIds.length > 0 },
    contracts: rewardIds.map((id) => ({
      address: contractAddress ?? zeroAddress,
      abi: basePassDailyAbi,
      functionName: "getReward",
      args: [BigInt(id)],
    })),
  });

  useEffect(() => {
    if (!address || isOnchain) {
      queueMicrotask(() => setLocalStats(emptyStats));
      return;
    }
    const stored = window.localStorage.getItem(`basepass-daily:${address.toLowerCase()}`);
    queueMicrotask(() => setLocalStats(stored ? ({ ...emptyStats, ...JSON.parse(stored) } as LocalStats) : emptyStats));
  }, [address, isOnchain]);

  useEffect(() => {
    if (!address || isOnchain) return;
    window.localStorage.setItem(`basepass-daily:${address.toLowerCase()}`, JSON.stringify(localStats));
  }, [address, isOnchain, localStats]);

  useEffect(() => {
    if (!isSuccess && !isCallsSuccess) return;
    queueMicrotask(() => setMessage("Transaction confirmed. Stats refreshed."));
    void userReads.refetch();
    void rewardReads.refetch();
    void rewardCount.refetch();
    void raffleEntryCost.refetch();
  }, [isCallsSuccess, isSuccess, raffleEntryCost, rewardCount, rewardReads, userReads]);

  const [checkIns = 0n, points = 0n, lastDay = 0n, streak = 0n, raffleEntries = 0n] = userReads.data ?? [];

  const stats = {
    checkIns: isOnchain ? Number(checkIns) : localStats.checkIns,
    points: isOnchain ? Number(points) : localStats.points,
    streak: isOnchain ? Number(streak) : localStats.streak,
    raffleEntries: isOnchain ? Number(raffleEntries) : localStats.raffleEntries,
    claimedToday: isConnected && (isOnchain ? lastDay === dayNowBigInt() : localStats.lastDay === dayNow()),
  };

  const rewards = useMemo<Reward[]>(() => {
    if (!rewardReads.data?.length) return fallbackRewards;
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

  const visibleRewards = rewards.map((reward) => ({
    ...reward,
    stock: isOnchain ? reward.stock : BigInt(localStats.rewardStock[String(reward.id)] ?? Number(reward.stock)),
  }));

  async function connectWallet(kind: WalletKind) {
    const label = walletLabel(kind);
    const connector =
      connectors.find((item) => connectorMatches(item, kind)) ??
      (kind === "okx" ? connectors.find((item) => isInjectedFallback(item)) : undefined);
    setMessage(`Opening ${label}...`);

    if (!connector) {
      setMessage(`${label} is not available here. Open this Mini App inside that wallet browser or Base App.`);
      return;
    }

    try {
      await connectAsync({ connector });
      setMessage(`${label} connected.`);
    } catch (error) {
      setMessage(friendlyWalletError(error));
    }
  }

  async function ensureBase() {
    if (chainId === 8453) return;
    await switchChainAsync({ chainId: 8453 });
  }

  async function sendAttributedContractCall(callData: Hex) {
    if (!contractAddress) return;
    await ensureBase();
    const attributedCallData = concatHex([callData, dataSuffix]);

    if (prefersCalls(connector)) {
      try {
        const result = await sendCallsAsync({
          calls: [{ to: contractAddress, data: attributedCallData }],
          capabilities: { dataSuffix: { value: dataSuffix, optional: true } },
          chainId: 8453,
          experimental_fallback: true,
        });
        setMessage(`Call submitted: ${result.id}`);
        return;
      } catch (error) {
        setMessage("Smart wallet batch failed. Opening wallet transaction...");
        console.info("wallet_sendCalls failed, falling back to sendTransaction", error);
      }
    }

    await sendTransactionAsync({
      to: contractAddress,
      data: callData,
      chainId: 8453,
    });
  }

  async function claimDailyPass() {
    if (!address) return;
    setMessage("Claiming Daily Pass...");

    if (!isOnchain || !contractAddress) {
      setLocalStats((current) => {
        const nextStreak = current.lastDay + 1 === dayNow() ? current.streak + 1 : 1;
        const referralBonus = referrer !== zeroAddress && referrer.toLowerCase() !== address.toLowerCase() ? 15 : 0;
        return {
          ...current,
          checkIns: current.checkIns + 1,
          points: current.points + 10 + (nextStreak > 1 ? 2 : 0) + referralBonus,
          streak: nextStreak,
          lastDay: dayNow(),
        };
      });
      setMessage("Daily Pass claimed locally.");
      return;
    }

    await sendAttributedContractCall(
      encodeFunctionData({
        abi: basePassDailyAbi,
        functionName: "claimDailyPass",
        args: [referrer],
      }),
    );
  }

  async function redeemReward(rewardId: number) {
    if (!address) return;
    const reward = visibleRewards.find((item) => item.id === rewardId);
    if (!reward) return;
    setMessage(`Redeeming ${reward.name}...`);

    if (!isOnchain || !contractAddress) {
      setLocalStats((current) => {
        const stock = current.rewardStock[String(rewardId)] ?? Number(reward.stock);
        const cost = Number(reward.pointCost);
        if (current.points < cost || stock < 1) return current;
        return {
          ...current,
          points: current.points - cost,
          rewardStock: { ...current.rewardStock, [rewardId]: stock - 1 },
        };
      });
      setMessage("Reward redeemed locally.");
      return;
    }

    await sendAttributedContractCall(
      encodeFunctionData({
        abi: basePassDailyAbi,
        functionName: "redeemReward",
        args: [BigInt(rewardId)],
      }),
    );
  }

  async function enterRaffle() {
    if (!address) return;
    const cost = isOnchain ? Number(raffleEntryCost.data ?? 20n) : 20;
    setMessage("Entering raffle...");

    if (!isOnchain || !contractAddress) {
      setLocalStats((current) =>
        current.points >= cost
          ? { ...current, points: current.points - cost, raffleEntries: current.raffleEntries + 1 }
          : current,
      );
      setMessage("Raffle entered locally.");
      return;
    }

    await sendAttributedContractCall(
      encodeFunctionData({
        abi: basePassDailyAbi,
        functionName: "enterRaffle",
        args: [1n],
      }),
    );
  }

  return (
    <main className="min-h-screen bg-[#08090c] px-4 py-5 text-white">
      <div className="mx-auto max-w-lg space-y-4">
        <header>
          <h1 className="text-2xl font-semibold">BasePass Daily</h1>
          <p className="mt-1 text-sm text-white/55">Discover perks. Earn points. Unlock rewards.</p>
        </header>

        <section className="space-y-3 rounded-[8px] border border-white/10 bg-[#101216] p-4">
          <div>
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
            <button type="button" onClick={() => disconnect()} className="secondary-button">
              Disconnect
            </button>
          )}

          {message ? <p className="text-sm text-[#9ee7cf]">{message}</p> : null}
          {connectError ? <p className="text-sm text-[#ff8d8d]">{connectError.message}</p> : null}
          {sendCallsError ? <p className="text-sm text-[#ff8d8d]">{sendCallsError.message}</p> : null}
          {sendTransactionError ? <p className="text-sm text-[#ff8d8d]">{sendTransactionError.message}</p> : null}
        </section>

        <section className="grid grid-cols-2 gap-2">
          <Stat label="Today pass status" value={stats.claimedToday ? "Claimed" : "Open"} />
          <Stat label="Total check-ins" value={String(stats.checkIns)} />
          <Stat label="Reward points" value={String(stats.points)} />
          <Stat label="Current streak" value={`${stats.streak} days`} />
        </section>

        <section className="space-y-3 rounded-[8px] border border-white/10 bg-[#101216] p-4">
          <button
            type="button"
            disabled={!isConnected || isBusy}
            onClick={() => void claimDailyPass()}
            className="primary-button"
          >
            Claim Daily Pass
          </button>
          <p className="text-xs text-white/45">{isOnchain ? "Onchain mode: user pays Base gas." : "Local mode: no gas required."}</p>
        </section>

        <section className="space-y-2 rounded-[8px] border border-white/10 bg-[#101216] p-4">
          <h2 className="font-semibold">Available rewards</h2>
          {visibleRewards.map((reward) => (
            <div key={reward.id} className="rounded-[8px] border border-white/10 bg-black/25 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{reward.name}</p>
                  <p className="text-xs text-white/45">
                    {Number(reward.pointCost)} pts - {Number(reward.stock)} left
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!isConnected || isBusy || !reward.active || reward.stock === 0n}
                  onClick={() => void redeemReward(reward.id)}
                  className="small-button"
                >
                  Redeem
                </button>
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-3 rounded-[8px] border border-white/10 bg-[#101216] p-4">
          <h2 className="font-semibold">Raffle</h2>
          <p className="text-sm text-white/55">
            Entries: {stats.raffleEntries} - Cost: {isOnchain ? Number(raffleEntryCost.data ?? 20n) : 20} pts
          </p>
          <button type="button" disabled={!isConnected || isBusy} onClick={() => void enterRaffle()} className="secondary-button">
            Enter Raffle
          </button>
        </section>

        <section className="rounded-[8px] border border-white/10 bg-[#101216] p-4">
          <h2 className="font-semibold">Invite</h2>
          <p className="mt-2 break-all text-xs text-white/55">
            {address ? `${origin}/?ref=${address}` : "Connect wallet to create your referral link"}
          </p>
          <p className="mt-2 text-xs text-white/45">Active referrer: {referrer === zeroAddress ? "None" : shortAddress(referrer)}</p>
        </section>

        {hash || callReceiptHash ? (
          <a
            href={`https://basescan.org/tx/${hash ?? callReceiptHash}`}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm text-[#9ee7cf] underline-offset-4 hover:underline"
          >
            Transaction: {hash ?? callReceiptHash}
          </a>
        ) : null}

        {callsResult?.id ? <p className="break-all text-xs text-white/45">Call batch: {callsResult.id}</p> : null}

        <section className="rounded-[8px] border border-white/10 bg-[#101216] p-4">
          <h2 className="font-semibold">Attribution</h2>
          <p className="mt-2 break-all text-xs text-white/45">Mode: {isOnchain ? "Onchain" : "Local"}</p>
          <p className="mt-1 break-all text-xs text-white/45">Contract: {contractAddress ?? "Not configured"}</p>
          <p className="mt-1 break-all text-xs text-white/45">Builder Code: {builderCode}</p>
          <p className="mt-1 break-all text-xs text-white/45">Data Suffix: {dataSuffix}</p>
        </section>
      </div>
    </main>
  );
}

function WalletButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="primary-button">
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-white/10 bg-[#101216] p-3">
      <p className="text-xs text-white/40">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
