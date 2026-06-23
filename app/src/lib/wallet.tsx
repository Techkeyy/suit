import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { connectWallet, getWalletAddress, getWalletTokenBalance } from './suit';

interface WalletState {
  address: string | null;
  balance: string | null; // native XLM, 7-dp string
  loadingBalance: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => void;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
}

const Ctx = createContext<WalletState>({
  address: null,
  balance: null,
  loadingBalance: false,
  connecting: false,
  error: null,
  connect: async () => {},
  disconnect: () => {},
  refreshBalance: () => {},
  modalOpen: false,
  openModal: () => {},
  closeModal: () => {},
});

const DISCONNECTED_KEY = 'suit_wallet_disconnected';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const refreshBalance = useCallback(() => {
    if (!address) return;
    setLoadingBalance(true);
    getWalletTokenBalance(address)
      .then(setBalance)
      .catch(() => setBalance(null))
      .finally(() => setLoadingBalance(false));
  }, [address]);

  useEffect(() => {
    if (localStorage.getItem(DISCONNECTED_KEY) === '1') return;
    getWalletAddress().then((a) => a && setAddress(a));
  }, []);

  // load balance whenever the address changes
  useEffect(() => {
    if (!address) { setBalance(null); return; }
    refreshBalance();
  }, [address, refreshBalance]);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const a = await connectWallet();
      localStorage.removeItem(DISCONNECTED_KEY);
      setAddress(a);
      setModalOpen(false);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    localStorage.setItem(DISCONNECTED_KEY, '1');
    setAddress(null);
    setBalance(null);
    setError(null);
  };

  const openModal = () => {
    setError(null);
    setModalOpen(true);
  };
  const closeModal = () => setModalOpen(false);

  return (
    <Ctx.Provider
      value={{ address, balance, loadingBalance, connecting, error, connect, disconnect, refreshBalance, modalOpen, openModal, closeModal }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useWallet = () => useContext(Ctx);
