import React from 'react';

const mockReceipts = [
  { id: 'RCPT-0x9f2a1b…e4c7', meta: 'RISC Zero · Standard policy · 2 hrs ago' },
  { id: 'RCPT-0x3d7c4e…b120', meta: 'RISC Zero · Payroll policy · 1 day ago' },
  { id: 'RCPT-0xaa01f3…9de2', meta: 'RISC Zero · Institutional policy · 3 days ago' },
];

export default function ReceiptsPanel() {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 20 }}>
        Compliance receipts
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mockReceipts.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, cursor: 'pointer' }}>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace', letterSpacing: '0.05em' }}>{r.id}</div>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginTop: 4 }}>{r.meta}</div>
            </div>
            <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', padding: '3px 10px', borderRadius: 2 }}>
              On-chain verified
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 24, padding: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 4 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>Verify a receipt</div>
        <input placeholder="Paste receipt ID or bytes..."
          style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 13, padding: '8px 0', marginBottom: 12 }} />
        <button style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#000', background: '#fff', border: 'none', padding: '10px 24px', cursor: 'pointer', fontWeight: 500 }}>
          Verify on-chain
        </button>
      </div>
    </div>
  );
}
