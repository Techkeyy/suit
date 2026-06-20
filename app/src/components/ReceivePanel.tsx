import React, { useState } from 'react';

export default function ReceivePanel() {
  const [note, setNote] = useState('');

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 24 }}>
        Withdraw from pool
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>Payment note</div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Paste encrypted note from sender"
          style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, padding: '12px 14px', borderRadius: 4 }} />
      </div>

      {[
        { key: 'Amount', value: '● ● ● ● ●', muted: true },
        { key: 'Commitment', value: '0x7f3a…c91b', muted: false },
        { key: 'Nullifier', value: '0xe2b1…44af', muted: false },
        { key: 'Pool status', value: 'Commitment verified', muted: false },
      ].map(row => (
        <div key={row.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>{row.key}</span>
          <span style={{ fontSize: 13, color: row.muted ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.75)', fontFamily: 'monospace', letterSpacing: row.muted ? '0.25em' : 'normal' }}>{row.value}</span>
        </div>
      ))}

      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>Merkle proof path</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 4 }}>
          {[true, true, true, false, false].map((active, i) => (
            <React.Fragment key={i}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: active ? '#fff' : 'rgba(255,255,255,0.15)' }} />
              {i < 4 && <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />}
            </React.Fragment>
          ))}
          <span style={{ fontSize: 10, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginLeft: 8 }}>Depth 3 of 5</span>
        </div>
      </div>

      <button style={{ width: '100%', background: '#fff', color: '#000', border: 'none', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', padding: 14, cursor: 'pointer', fontWeight: 500, marginTop: 20 }}>
        Withdraw funds
      </button>

      <div style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderLeft: '2px solid rgba(255,255,255,0.15)', marginTop: 16 }}>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', lineHeight: 1.6 }}>
          Withdrawal is unlinked from your deposit. An observer cannot connect this withdrawal to any specific sender on the Stellar ledger.
        </p>
      </div>
    </div>
  );
}
