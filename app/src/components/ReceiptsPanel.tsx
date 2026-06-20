import React, { useEffect, useState } from 'react';
import { getStoredLeaves, getPoolCount, CONFIG } from '../lib/suit';

export default function ReceiptsPanel() {
  const [leaves, setLeaves] = useState<string[]>([]);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    setLeaves(getStoredLeaves());
    getPoolCount().then(setCount).catch(() => {});
  }, []);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 20 }}>
        Pool activity
      </div>

      <div style={{ display: 'flex', gap: 1, background: 'rgba(255,255,255,0.07)', marginBottom: 24 }}>
        {[
          { k: 'On-chain deposits', v: count === null ? '…' : String(count) },
          { k: 'Your commitments', v: String(leaves.length) },
          { k: 'On-chain amounts', v: '0 visible' },
        ].map((s) => (
          <div key={s.k} style={{ flex: 1, background: '#0a0a0a', padding: 18, textAlign: 'center' }}>
            <div className="num" style={{ fontSize: 24, fontWeight: 600 }}>{s.v}</div>
            <div style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginTop: 4 }}>{s.k}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>Commitments (this device)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {leaves.length === 0 && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', padding: '14px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4 }}>
            No deposits yet from this device.
          </div>
        )}
        {leaves.map((leaf, i) => (
          <div key={leaf} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4 }}>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace' }}>leaf {i} · {leaf.slice(0, 16)}…</div>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginTop: 4 }}>Commitment · amount hidden</div>
            </div>
            <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', padding: '3px 10px', borderRadius: 2 }}>
              In pool
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,255,255,0.03)', borderLeft: '2px solid rgba(255,255,255,0.15)' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>Roadmap — compliance receipts</div>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', lineHeight: 1.6 }}>
          On-demand RISC Zero compliance receipts (prove a payment passed KYC / sanctions / policy
          without revealing the amount) are designed but not in this build. The on-chain commitment
          ledger above is real — explore the{' '}
          <a href={`${CONFIG.explorer}/contract/${CONFIG.poolId}`} target="_blank" rel="noreferrer" style={{ color: 'rgba(255,255,255,0.6)' }}>pool contract</a>.
        </p>
      </div>
    </div>
  );
}
