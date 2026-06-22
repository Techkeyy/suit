import React, { useEffect, useState } from 'react';
import { getNotes, getPoolCount, CONFIG, UTXONote, stroopsToXlm } from '../lib/suit';

export default function ReceiptsPanel() {
  const [notes, setNotes] = useState<UTXONote[]>([]);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    setNotes(getNotes());
    getPoolCount().then(setCount).catch(() => {});
  }, []);

  const unspent = notes.filter(n => !n.spent);
  const totalShielded = unspent.reduce((s, n) => s + BigInt(n.amount), 0n);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="eyebrow" style={{ marginBottom: 20 }}>Pool activity</div>

      <div style={{ display: 'flex', gap: 1, background: 'var(--border)', marginBottom: 24 }}>
        {[
          { k: 'On-chain commitments', v: count === null ? '…' : String(count) },
          { k: 'Your notes', v: String(notes.length) },
          { k: 'Shielded balance', v: `${stroopsToXlm(totalShielded.toString())} XLM` },
        ].map(s => (
          <div key={s.k} style={{ flex: 1, background: 'var(--bg-2)', padding: 18, textAlign: 'center' }}>
            <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>{s.v}</div>
            <div className="eyebrow" style={{ marginTop: 4 }}>{s.k}</div>
          </div>
        ))}
      </div>

      <div className="eyebrow" style={{ marginBottom: 8 }}>Your notes (this device)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notes.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
            No notes yet. Shield some XLM to create one.
          </div>
        )}
        {notes.map(n => (
          <div key={`${n.leafIndex}-${n.commitment.slice(0,8)}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
            <div>
              <div className="num" style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 600 }}>{stroopsToXlm(n.amount)} XLM</div>
              <div className="num" style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>leaf {n.leafIndex} · {new Date(n.ts).toLocaleString()}</div>
            </div>
            <span className="num" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: n.spent ? 'var(--text-3)' : 'var(--accent)', background: n.spent ? 'var(--surface-2)' : 'var(--accent-dim)', border: `1px solid ${n.spent ? 'var(--border-strong)' : 'var(--accent-border)'}`, padding: '3px 10px', borderRadius: 2 }}>
              {n.spent ? 'Spent' : 'In pool'}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, padding: 16, background: 'var(--surface)', borderLeft: '2px solid var(--accent-border)' }}>
        <div className="eyebrow" style={{ color: 'var(--text-1)', marginBottom: 6 }}>Arbitrary amounts, full privacy</div>
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
          Each note carries a hidden amount inside a Poseidon commitment. Value conservation is proven
          in zero-knowledge — the chain verifies the math without seeing any values.{' '}
          <a href={`${CONFIG.explorer}/contract/${CONFIG.poolId}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>pool contract</a>
        </p>
      </div>
    </div>
  );
}
