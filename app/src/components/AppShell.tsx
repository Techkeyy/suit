import React, { useState } from 'react';
import SendPanel from './SendPanel';
import ReceivePanel from './ReceivePanel';
import ReceiptsPanel from './ReceiptsPanel';

type Tab = 'send' | 'receive' | 'receipts';

interface Props {
  onBack: () => void;
}

export default function AppShell({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>('send');

  const navStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '18px 28px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    background: '#0a0a0a',
  };

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '8px 28px', fontSize: 11, color: 'rgba(255,255,255,0.45)', textAlign: 'center' }}>
        Front-end preview. Live ZK proof generation &amp; on-chain verification run via the SDK / CLI (see demo).{' '}
        Deployed verifier on testnet:{' '}
        <a href="https://stellar.expert/explorer/testnet/contract/CA2W26LBXZ7FZWKKPW4NHTO52AUYWBAT47S2QMMDDEWORFG4RYQKAWIV" target="_blank" rel="noreferrer" style={{ color: 'rgba(255,255,255,0.7)' }}>CA2W…KAWIV</a>
      </div>
      <nav style={navStyle}>
        <div
          onClick={onBack}
          style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 700, letterSpacing: '0.28em', textTransform: 'uppercase', cursor: 'pointer' }}
        >
          SUIT<span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 300 }}> Protocol</span>
        </div>

        <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', padding: 4, borderRadius: 6 }}>
          {(['send', 'receive', 'receipts'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                fontSize: 11,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: tab === t ? '#000' : 'rgba(255,255,255,0.4)',
                background: tab === t ? '#fff' : 'transparent',
                padding: '7px 18px',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >{t}</button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '6px 14px', borderRadius: 4 }}>
          <div style={{ width: 7, height: 7, background: 'rgba(255,255,255,0.7)', borderRadius: '50%' }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>GDQP…7XKM</span>
        </div>
      </nav>

      <div style={{ padding: 28 }}>
        {tab === 'send' && <SendPanel />}
        {tab === 'receive' && <ReceivePanel />}
        {tab === 'receipts' && <ReceiptsPanel />}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 28px', borderTop: '1px solid rgba(255,255,255,0.06)', background: '#0a0a0a' }}>
        {[
          { num: 'Groth16', label: 'ZK system' },
          { num: 'Testnet', label: 'Network' },
          { num: 'On-chain', label: 'Proof verified' },
          { num: 'BLS12-381', label: 'Curve' },
          { num: '∞', label: 'Auditable' },
        ].map(s => (
          <div key={s.label} style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 300 }}>{s.num}</div>
            <div style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
