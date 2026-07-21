import { NextResponse } from "next/server";
import { createWalletClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { basePassDailyAbi } from "@/abi/basePassDaily";

type RelayBody =
  | {
      action: "claim";
      user: `0x${string}`;
      referrer: `0x${string}`;
      deadline: string;
      signature: `0x${string}`;
    }
  | {
      action: "redeem";
      user: `0x${string}`;
      rewardId: string;
      deadline: string;
      signature: `0x${string}`;
    }
  | {
      action: "raffle";
      user: `0x${string}`;
      entries: string;
      deadline: string;
      signature: `0x${string}`;
    };

const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined;
const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
const rpcUrl = process.env.BASE_RPC_URL;
const dataSuffix = (
  process.env.NEXT_PUBLIC_DATA_SUFFIX && /^0x[0-9a-fA-F]*$/.test(process.env.NEXT_PUBLIC_DATA_SUFFIX)
    ? process.env.NEXT_PUBLIC_DATA_SUFFIX
    : "0x"
) as `0x${string}`;

export async function POST(request: Request) {
  if (!contractAddress || !isAddress(contractAddress)) {
    return NextResponse.json({ error: "Contract address is not configured." }, { status: 500 });
  }

  if (!relayerPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(relayerPrivateKey)) {
    return NextResponse.json({ error: "Relayer private key is not configured." }, { status: 500 });
  }

  const body = (await request.json()) as RelayBody;
  if (!body.user || !isAddress(body.user) || !body.signature?.startsWith("0x")) {
    return NextResponse.json({ error: "Invalid relay request." }, { status: 400 });
  }

  const deadline = BigInt(body.deadline);
  if (deadline < BigInt(Math.floor(Date.now() / 1000))) {
    return NextResponse.json({ error: "Signature expired." }, { status: 400 });
  }

  const account = privateKeyToAccount(relayerPrivateKey);
  const client = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl),
    dataSuffix,
  });

  try {
    const hash = await sendRelayTransaction(client, account, body);
    return NextResponse.json({ hash });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Relay transaction failed." },
      { status: 500 },
    );
  }
}

async function sendRelayTransaction(
  client: ReturnType<typeof createWalletClient>,
  account: ReturnType<typeof privateKeyToAccount>,
  body: RelayBody,
): Promise<`0x${string}`> {
  if (body.action === "claim") {
    if (!isAddress(body.referrer)) throw new Error("Invalid referrer.");
    return client.writeContract({
      account,
      chain: base,
      address: contractAddress!,
      abi: basePassDailyAbi,
      functionName: "claimDailyPassFor",
      args: [body.user, body.referrer, BigInt(body.deadline), body.signature],
      dataSuffix,
    });
  }

  if (body.action === "redeem") {
    return client.writeContract({
      account,
      chain: base,
      address: contractAddress!,
      abi: basePassDailyAbi,
      functionName: "redeemRewardFor",
      args: [body.user, BigInt(body.rewardId), BigInt(body.deadline), body.signature],
      dataSuffix,
    });
  }

  return client.writeContract({
    account,
    chain: base,
    address: contractAddress!,
    abi: basePassDailyAbi,
    functionName: "enterRaffleFor",
    args: [body.user, BigInt(body.entries), BigInt(body.deadline), body.signature],
    dataSuffix,
  });
}
