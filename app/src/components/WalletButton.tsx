import React, { useState } from 'react';
import { useWallet } from '../lib/wallet';
import { CONFIG } from '../lib/suit';

export default function WalletButton() {
  const { address, connect, connecting, error, disconnect, modalOpen, openModal, closeModal } = useWallet();
  const [copied, setCopied] = useState(false);

  const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

  const copy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const trigger = address ? (
    <button
      onClick={openModal}
      style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border-strong)', padding: '7px 14px', borderRadius: 6, cursor: 'pointer' }}
    >
      <span style={{ width: 7, height: 7, background: 'var(--accent)', borderRadius: '50%', boxShadow: '0 0 8px var(--accent)' }} />
      <span className="num" style={{ fontSize: 11, color: 'var(--text-1)', letterSpacing: '0.04em' }}>{short(address)}</span>
    </button>
  ) : (
    <button className="btn btn-primary" onClick={openModal}>Connect wallet</button>
  );

  return (
    <>
      {trigger}
      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            {/* header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
              <span className="eyebrow">{address ? 'Wallet' : 'Connect a wallet'}</span>
              <button onClick={closeModal} style={{ background: 'none', color: 'var(--text-3)', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
            </div>

            {address ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                  <span style={{ width: 8, height: 8, background: 'var(--accent)', borderRadius: '50%', boxShadow: '0 0 10px var(--accent)' }} />
                  <span className="num" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)' }}>Connected · Testnet</span>
                </div>

                <div style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>Address</div>
                <button onClick={copy} title="Copy"
                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 18, cursor: 'pointer' }}>
                  <span className="num" style={{ fontSize: 12, color: 'var(--text-2)', wordBreak: 'break-all', textAlign: 'left' }}>{address}</span>
                  <span className="num" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: copied ? 'var(--accent)' : 'var(--text-3)', flexShrink: 0 }}>{copied ? 'Copied' : 'Copy'}</span>
                </button>

                <a href={`${CONFIG.explorer}/account/${address}`} target="_blank" rel="noreferrer"
                  style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', marginBottom: 22, textDecoration: 'none' }}>
                  View on Stellar Expert ↗
                </a>

                <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => { disconnect(); closeModal(); }}>
                  Disconnect
                </button>
              </>
            ) : (
              <>
                <button onClick={connect} disabled={connecting}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, background: 'var(--bg-2)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '16px', cursor: connecting ? 'default' : 'pointer', marginBottom: 16, textAlign: 'left' }}>
                  <span style={{ width: 38, height: 38, borderRadius: 9, background: 'linear-gradient(135deg, #f7a600, #e87b00)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font-serif)', fontWeight: 700, color: '#1a1207', fontSize: 18 }}>F</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 14, color: 'var(--text-1)', fontWeight: 500 }}>Freighter</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Browser extension</span>
                  </span>
                  <span className="num" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: connecting ? 'var(--text-3)' : 'var(--accent)' }}>{connecting ? 'Connecting…' : 'Connect'}</span>
                </button>

                {error && (
                  <div style={{ fontSize: 11, color: 'rgba(248,180,180,0.9)', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: 10, marginBottom: 14, lineHeight: 1.5 }}>{error}</div>
                )}

                <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
                  Testnet only. You'll approve the connection in Freighter. Don't have it?{' '}
                  <a href="https://www.freighter.app/" target="_blank" rel="noreferrer" style={{ color: 'var(--text-2)' }}>Install →</a>
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
