import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";
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

export const dataSuffix = (
  envDataSuffix && /^0x[0-9a-fA-F]*$/.test(envDataSuffix) ? envDataSuffix : "0x"
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

export const okxConnector = injected({
  shimDisconnect: true,
  target: {
    id: "okxWallet",
    name: "OKX Wallet",
    provider: (windowObject) =>
      (windowObject as InjectedWindow | undefined)?.okxwallet ??
      selectProvider((provider) => provider.isOkxWallet === true || provider.isOKExWallet === true)(windowObject),
  },
});

export const metaMaskConnector = injected({
  shimDisconnect: true,
  target: {
    id: "metaMask",
    name: "MetaMask",
    provider: selectProvider((provider) => provider.isMetaMask === true),
  },
});

export const coinbaseConnector = coinbaseWallet({
  appName: "BasePass Daily",
  preference: "extensionOnly",
});

export const config = createConfig({
  chains: [base],
  connectors: [okxConnector, metaMaskConnector, coinbaseConnector],
  multiInjectedProviderDiscovery: false,
  ssr: true,
  transports: {
    [base.id]: http(),
  },
  dataSuffix,
});
