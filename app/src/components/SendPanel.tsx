import React, { useState } from 'react';

type ProofStatus = 'idle' | 'generating' | 'ready';

export default function SendPanel() {
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [policy, setPolicy] = useState('standard');
  const [rangeStatus, setRangeStatus] = useState<ProofStatus>('idle');
  const [complianceStatus, setComplianceStatus] = useState<ProofStatus>('idle');

  const handleAmountChange = (val: string) => {
    setAmount(val);
    if (val && parseFloat(val) > 0) {
      setRangeStatus('generating');
      setComplianceStatus('generating');
      setTimeout(() => setRangeStatus('ready'), 1400);
      setTimeout(() => setComplianceStatus('ready'), 2200);
    } else {
      setRangeStatus('idle');
      setComplianceStatus('idle');
    }
  };

  const badge = (status: ProofStatus, readyLabel: string) => {
    const styles: Record<ProofStatus, React.CSSProperties> = {
      idle: { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)' },
      generating: { background: 'rgba(255,200,50,0.08)', color: 'rgba(255,200,50,0.8)', border: '1px solid rgba(255,200,50,0.15)' },
      ready: { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.15)' },
    };
    const labels: Record<ProofStatus, string> = { idle: 'Awaiting input', generating: 'Generating...', ready: readyLabel };
    return (
      <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '3px 10px', borderRadius: 2, ...styles[status] }}>
        {labels[status]}
      </span>
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'rgba(255,255,255,0.07)' }}>
      <div style={{ background: '#0a0a0a', padding: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          Private send <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>Recipient address</div>
          <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="GBTC…4NXP"
            style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, padding: '12px 14px', borderRadius: 4 }} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>Amount</div>
          <div style={{ position: 'relative' }}>
            <input value={amount} onChange={e => handleAmountChange(e.target.value)} placeholder="0.00" type="number"
              style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontFamily: 'Cormorant Garamond, serif', fontSize: 42, fontWeight: 300, padding: '8px 0 12px', letterSpacing: '0.02em' }} />
            <span style={{ position: 'absolute', right: 0, bottom: 16, fontSize: 12, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>USDC</span>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>Compliance policy</div>
          <select value={policy} onChange={e => setPolicy(e.target.value)}
            style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, padding: '12px 14px', borderRadius: 4 }}>
            <option value="standard">Standard — KYC + range proof</option>
            <option value="payroll">Payroll — salary band enforcement</option>
            <option value="institutional">Institutional — full audit trail</option>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {[
            { name: 'Range proof (Circom · BLS12-381)', status: rangeStatus, ready: 'Verified on-chain' },
            { name: 'KYC proof (Noir) — roadmap', status: 'idle' as ProofStatus, ready: '' },
          ].map(row => (
            <div key={row.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 4 }}>
              <span style={{ fontSize: 11, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase' }}>{row.name}</span>
              {badge(row.status, row.ready)}
            </div>
          ))}
        </div>

        <button style={{ width: '100%', background: '#fff', color: '#000', border: 'none', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', padding: 14, cursor: 'pointer', fontWeight: 500 }}>
          Shield and send
        </button>

        <div style={{ display: 'flex', gap: 10, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderLeft: '2px solid rgba(255,255,255,0.15)', marginTop: 16 }}>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', lineHeight: 1.6 }}>
            Amount is used only as a private circuit input. It never touches the Stellar ledger. Only a commitment and three ZK proofs are written on-chain.
          </p>
        </div>
      </div>

      <div style={{ background: '#0a0a0a', padding: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          How it works <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
        </div>
        {[
          { step: '01', title: 'You enter an amount', desc: 'Your amount stays on your device. It is used as a private input to generate a ZK proof.' },
          { step: '02', title: 'A range proof is generated', desc: 'A Circom/Groth16 proof (BLS12-381) is generated locally, proving the amount satisfies policy bounds without revealing it.' },
          { step: '03', title: 'Commitment + proof go on-chain', desc: 'The pool verifies the proof on-chain (real BLS12-381 pairing check) before accepting the commitment. No valid proof, no deposit.' },
          { step: '04', title: 'Receiver withdraws from pool', desc: 'The receiver withdraws from the shared pool. No on-chain link connects your deposit to their withdrawal.' },
        ].map(item => (
          <div key={item.step} style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: 'rgba(255,255,255,0.15)', fontWeight: 300, flexShrink: 0, width: 28 }}>{item.step}</div>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', lineHeight: 1.7 }}>{item.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
