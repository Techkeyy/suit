import React, { useState } from 'react';
import Landing from './components/Landing';
import AppShell from './components/AppShell';
import { WalletProvider } from './lib/wallet';

type View = 'landing' | 'app';

export default function App() {
  const [view, setView] = useState<View>('landing');

  return (
    <WalletProvider>
      {view === 'app' ? (
        <AppShell onBack={() => setView('landing')} />
      ) : (
        <Landing onLaunch={() => setView('app')} />
      )}
    </WalletProvider>
  );
}
