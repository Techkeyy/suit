import React, { createContext, useContext, useEffect, useState } from 'react';
import { connectWallet, getWalletAddress } from './suit';

interface WalletState {
  address: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
}

const Ctx = createContext<WalletState>({
  address: null,
  connecting: false,
  error: null,
  connect: async () => {},
  disconnect: () => {},
  modalOpen: false,
  openModal: () => {},
  closeModal: () => {},
});

const DISCONNECTED_KEY = 'suit_wallet_disconnected';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISCONNECTED_KEY) === '1') return;
    getWalletAddress().then((a) => a && setAddress(a));
  }, []);

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
    setError(null);
  };

  const openModal = () => {
    setError(null);
    setModalOpen(true);
  };
  const closeModal = () => setModalOpen(false);

  return (
    <Ctx.Provider
      value={{ address, connecting, error, connect, disconnect, modalOpen, openModal, closeModal }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useWallet = () => useContext(Ctx);
