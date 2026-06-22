import React, { useState } from 'react';
import { useWallet } from '../lib/wallet';
import { shield, CONFIG } from '../lib/suit';

type Phase = 'idle' | 'working' | 'done' | 'error';

export default function SendPanel() {
  const { address, openModal, refreshBalance } = useWallet();
  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleShield() {
    if (!address) return openModal();
    if (!amount || Number(amount) <= 0) { setErr('Enter a valid amount.'); setPhase('error'); return; }
    setErr(null); setTxHash(null); setStep('');
    try {
      setPhase('working');
      const res = await shield(address, amount, setStep);
      setTxHash(res.txHash);
      setPhase('done');
      refreshBalance();
    } catch (e: any) {
      setErr(e.message || String(e));
      setPhase('error');
    }
  }

  const busy = phase === 'working';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)' }}>
      <div style={{ background: 'var(--bg-2)', padding: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
          Shield funds <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <div className="eyebrow" style={{ marginBottom: 10 }}>Amount</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <input
            className="num"
            type="number"
            min="0.0000001"
            step="any"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            disabled={busy}
            style={{ flex: 1, fontSize: 32, fontWeight: 600, color: 'var(--text-1)', background: 'transparent', border: 'none', outline: 'none', padding: 0, lineHeight: 1 }}
          />
          <span className="num" style={{ fontSize: 13, letterSpacing: '0.15em', color: 'var(--text-3)', textTransform: 'uppercase' }}>XLM</span>
          <span className="num" style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', padding: '4px 10px', borderRadius: 3 }}>Any amount</span>
        </div>
        <div style={{ height: 1, background: 'var(--border)', marginBottom: 14 }} />
        <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 22 }}>
          Your note is generated locally with a secret key. Only the commitment goes on-chain.
          The amount is hidden inside a zero-knowledge proof — no one can see how much you shielded.
        </p>

        <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleShield} disabled={busy}>
          {!address ? 'Connect wallet' : busy ? 'Proving…' : amount ? `Shield ${amount} XLM` : 'Shield XLM'}
        </button>

        {step && busy && (
          <div className="num" style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 12, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
            {step}
          </div>
        )}
        {err && (
          <div className="num" style={{ fontSize: 11, color: 'rgba(248,180,180,0.9)', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: 12, marginTop: 14, wordBreak: 'break-all' }}>{err}</div>
        )}
        {txHash && (
          <div style={{ marginTop: 14 }}>
            <a href={`${CONFIG.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer" className="num" style={{ display: 'block', fontSize: 11, color: 'var(--accent)', wordBreak: 'break-all', marginBottom: 8 }}>
              Shielded. View transaction: {txHash.slice(0, 18)}…
            </a>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Note saved on this device. Go to <strong style={{ color: 'var(--text-1)' }}>Withdraw</strong> to send any portion — unlinkably.</div>
          </div>
        )}
      </div>

      <div style={{ background: 'var(--bg-2)', padding: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
          How it works <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>
        {[
          { step: '01', title: 'Shield any amount', desc: 'Your browser generates a secret note (private key + blinding factor) and posts only its commitment = Poseidon(amount, pubKey, blinding) on-chain. The amount is hidden.' },
          { step: '02', title: 'It joins the UTXO pool', desc: 'The commitment is inserted into an on-chain Poseidon Merkle tree. Value conservation is proven in zero-knowledge — no one can see amounts or link notes.' },
          { step: '03', title: 'Withdraw any portion', desc: 'Spend a note partially: prove you own it, withdraw what you need, and get a change note back — like spending a $20 bill and getting change. No on-chain link to your deposit.' },
        ].map(item => (
          <div key={item.step} style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
            <div className="num" style={{ fontSize: 22, color: 'var(--border-strong)', fontWeight: 600, flexShrink: 0, width: 28 }}>{item.step}</div>
            <div>
              <div className="eyebrow" style={{ color: 'var(--text-1)', letterSpacing: '0.12em', marginBottom: 5 }}>{item.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.7 }}>{item.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
