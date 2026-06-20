import React, { useState } from 'react';
import Landing from './components/Landing';
import AppShell from './components/AppShell';

type View = 'landing' | 'app';

export default function App() {
  const [view, setView] = useState<View>('landing');

  if (view === 'app') {
    return <AppShell onBack={() => setView('landing')} />;
  }
  return <Landing onLaunch={() => setView('app')} />;
}
