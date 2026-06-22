import React, { useEffect, useState } from 'react';
import { getNotes, getPoolCount, CONFIG, Note } from '../lib/suit';

export default function ReceiptsPanel() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    setNotes(getNotes());
    getPoolCount().then(setCount).catch(() => {});
  }, []);

  const unspent = notes.filter((n) => !n.spent).length;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="eyebrow" style={{ marginBottom: 20 }}>Pool activity</div>

      <div style={{ display: 'flex', gap: 1, background: 'var(--border)', marginBottom: 24 }}>
        {[
          { k: 'On-chain deposits', v: count === null ? '…' : String(count) },
          { k: 'Your notes', v: String(notes.length) },
          { k: 'Unspent', v: String(unspent) },
        ].map((s) => (
          <div key={s.k} style={{ flex: 1, background: 'var(--bg-2)', padding: 18, textAlign: 'center' }}>
            <div className="num" style={{ fontSize: 26, fontWeight: 600 }}>{s.v}</div>
            <div className="eyebrow" style={{ marginTop: 4 }}>{s.k}</div>
          </div>
        ))}
      </div>

      <div className="eyebrow" style={{ marginBottom: 8 }}>Your notes (this device)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notes.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
            No notes yet. Shield {CONFIG.denomination} XLM to create one.
          </div>
        )}
        {notes.map((n) => (
          <div key={n.leafIndex} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
            <div>
              <div className="num" style={{ fontSize: 13, color: 'var(--text-1)' }}>{CONFIG.denomination} XLM · leaf {n.leafIndex}</div>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-3)', textTransform: 'uppercase', marginTop: 4 }}>commitment · amount uniform</div>
            </div>
            <span className="num" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: n.spent ? 'var(--text-3)' : 'var(--accent)', background: n.spent ? 'var(--surface-2)' : 'var(--accent-dim)', border: `1px solid ${n.spent ? 'var(--border-strong)' : 'var(--accent-border)'}`, padding: '3px 10px', borderRadius: 2 }}>
              {n.spent ? 'Spent' : 'In pool'}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, padding: 16, background: 'var(--surface)', borderLeft: '2px solid var(--accent-border)' }}>
        <div className="eyebrow" style={{ color: 'var(--text-1)', marginBottom: 6 }}>Unlinkable</div>
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
          Deposits are identical commitments in a shared Poseidon Merkle tree. Withdrawals prove membership in
          zero-knowledge, so the chain can't link a withdrawal back to your deposit.{' '}
          <a href={`${CONFIG.explorer}/contract/${CONFIG.poolId}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>pool contract ↗</a>
        </p>
      </div>
    </div>
  );
}
