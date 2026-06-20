import React, { createContext, useContext, useEffect, useState } from 'react';
import { connectWallet, getWalletAddress } from './suit';

interface WalletState {
  address: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
}

const Ctx = createContext<WalletState>({
  address: null,
  connecting: false,
  error: null,
  connect: async () => {},
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getWalletAddress().then((a) => a && setAddress(a));
  }, []);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      setAddress(await connectWallet());
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setConnecting(false);
    }
  };

  return <Ctx.Provider value={{ address, connecting, error, connect }}>{children}</Ctx.Provider>;
}

export const useWallet = () => useContext(Ctx);
