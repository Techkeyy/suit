import React, { useState } from 'react';
import SendPanel from './SendPanel';
import ReceivePanel from './ReceivePanel';
import ReceiptsPanel from './ReceiptsPanel';
import WalletButton from './WalletButton';
import { useWallet } from '../lib/wallet';
import { CONFIG, TOKENS, TokenSym, getActiveSym, getActiveToken, setActiveToken } from '../lib/suit';

type Tab = 'send' | 'receive' | 'receipts';

interface Props {
  onBack: () => void;
}

export default function AppShell({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>('send');
  const [sym, setSym] = useState<TokenSym>(getActiveSym());
  const { error } = useWallet();

  function pickToken(s: TokenSym) {
    if (s === sym) return;
    setActiveToken(s);
    setSym(s);
  }

  const navStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '18px 28px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    background: '#0a0a0a',
  };

  const pool = getActiveToken().poolId;

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ background: 'rgba(74,222,128,0.06)', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '8px 28px', fontSize: 11, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>
        Live on Stellar testnet — arbitrary-amount proofs generated in your browser, verified on-chain.{' '}
        <a href={`${CONFIG.explorer}/contract/${pool}`} target="_blank" rel="noreferrer" style={{ color: 'rgba(255,255,255,0.75)' }}>{sym} pool</a>
        {' · '}
        <a href={`${CONFIG.explorer}/contract/${CONFIG.verifierId}`} target="_blank" rel="noreferrer" style={{ color: 'rgba(255,255,255,0.75)' }}>verifier</a>
        . Requires the Freighter wallet on testnet.
      </div>
      {error && (
        <div style={{ background: 'rgba(248,113,113,0.12)', borderBottom: '1px solid rgba(248,113,113,0.2)', padding: '8px 28px', fontSize: 11, color: 'rgba(248,180,180,0.9)', textAlign: 'center' }}>
          {error}
        </div>
      )}
      <nav style={navStyle}>
        <div
          onClick={onBack}
          style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 700, letterSpacing: '0.28em', textTransform: 'uppercase', cursor: 'pointer' }}
        >
          SUIT<span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 300 }}> Protocol</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Token picker — each token is its own pool deployment */}
          <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', padding: 4, borderRadius: 6 }}>
            {(Object.keys(TOKENS) as TokenSym[]).map(s => (
              <button
                key={s}
                onClick={() => pickToken(s)}
                className="num"
                title={`Shielded ${s} pool`}
                style={{
                  fontSize: 11, letterSpacing: '0.08em',
                  color: sym === s ? 'var(--accent)' : 'var(--text-3)',
                  background: sym === s ? 'var(--accent-dim)' : 'transparent',
                  border: `1px solid ${sym === s ? 'var(--accent-border)' : 'transparent'}`,
                  padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                  transition: 'all 0.15s',
                }}
              >{TOKENS[s].label}</button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', padding: 4, borderRadius: 6 }}>
            {(['send', 'receive', 'receipts'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="num"
                style={{
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: tab === t ? 'var(--bg)' : 'var(--text-2)',
                  background: tab === t ? 'var(--text-1)' : 'transparent',
                  padding: '7px 18px',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >{({ send: 'Shield', receive: 'Withdraw', receipts: 'Activity' } as Record<Tab, string>)[t]}</button>
            ))}
          </div>
        </div>

        <WalletButton />
      </nav>

      {/* key on sym so panels remount and re-read per-pool notes when the token changes */}
      <div style={{ padding: 28 }} key={sym}>
        {tab === 'send' && <SendPanel />}
        {tab === 'receive' && <ReceivePanel />}
        {tab === 'receipts' && <ReceiptsPanel />}
      </div>
    </div>
  );
}
