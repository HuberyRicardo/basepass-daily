import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { base } from "wagmi/chains";
import { baseAccount, coinbaseWallet, injected } from "wagmi/connectors";
import { Attribution } from "ox/erc8021";
import type { EIP1193Provider } from "viem";

type WalletProvider = EIP1193Provider & {
  isMetaMask?: true;
  isOkxWallet?: true;
  isOKExWallet?: true;
  providers?: WalletProvider[];
};

declare global {
  interface Window {
    ethereum?: WalletProvider;
    okxwallet?: WalletProvider;
  }
}

export const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "8453");

const envContractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;

export const contractAddress = (
  envContractAddress && /^0x[0-9a-fA-F]{40}$/.test(envContractAddress) ? envContractAddress : undefined
) as `0x${string}` | undefined;

const envDataSuffix = process.env.NEXT_PUBLIC_DATA_SUFFIX;
const builderCode = process.env.NEXT_PUBLIC_BUILDER_CODE ?? "bc_q741sz3e";

export const dataSuffix = (
  envDataSuffix && envDataSuffix !== "0x" && /^0x[0-9a-fA-F]+$/.test(envDataSuffix)
    ? envDataSuffix
    : Attribution.toDataSuffix({ codes: [builderCode] })
) as `0x${string}`;

type InjectedWindow = {
  ethereum?: WalletProvider;
  okxwallet?: WalletProvider;
};

function selectProvider(predicate: (provider: WalletProvider) => boolean) {
  return (windowObject?: unknown) => {
    const injectedWindow = windowObject as InjectedWindow | undefined;
    const ethereum = injectedWindow?.ethereum;
    const providers = ethereum?.providers ?? [];
    return providers.find(predicate) ?? (ethereum && predicate(ethereum) ? ethereum : undefined);
  };
}

function isOkxProvider(provider: WalletProvider) {
  return provider.isOkxWallet === true || provider.isOKExWallet === true;
}

function isMetaMaskProvider(provider: WalletProvider) {
  return provider.isMetaMask === true && !isOkxProvider(provider);
}

export const okxConnector = injected({
  shimDisconnect: true,
  target: {
    id: "okxWallet",
    name: "OKX Wallet",
    provider: (windowObject) =>
      (windowObject as InjectedWindow | undefined)?.okxwallet ??
      selectProvider(isOkxProvider)(windowObject),
  },
});

export const metaMaskConnector = injected({
  shimDisconnect: true,
  target: {
    id: "metaMask",
    name: "MetaMask",
    provider: selectProvider(isMetaMaskProvider),
  },
});

export const injectedFallbackConnector = injected({
  shimDisconnect: true,
  target: {
    id: "injectedWallet",
    name: "Injected Wallet",
    provider: (windowObject) => (windowObject as InjectedWindow | undefined)?.ethereum,
  },
});

export const coinbaseConnector = coinbaseWallet({
  appName: "BasePass Daily",
  preference: {
    options: "all",
    attribution: { dataSuffix },
  },
});

export const baseAccountConnector = baseAccount({
  appName: "BasePass Daily",
  preference: {
    options: "all",
  },
});

export const config = createConfig({
  chains: [base],
  connectors: [okxConnector, metaMaskConnector, injectedFallbackConnector, coinbaseConnector, baseAccountConnector],
  multiInjectedProviderDiscovery: false,
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  transports: {
    [base.id]: http(),
  },
  dataSuffix,
});
