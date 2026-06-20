import React, { useState } from 'react';
import { useWallet } from '../lib/wallet';
import { deposit, verifyOnChain, generateRangeProof, CONFIG } from '../lib/suit';

type Phase = 'idle' | 'working' | 'done' | 'error';

const DENOM_XLM = Number(CONFIG.denomination) / 1e7;

export default function SendPanel() {
  const { address, openModal } = useWallet();
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const push = (m: string) => setLog((l) => [...l, m]);

  async function handleShield() {
    if (!address) return openModal();
    setErr(null);
    setTxHash(null);
    setLog([]);
    try {
      setPhase('working');
      push('Generating Groth16 proof in your browser…');
      push('Submitting deposit — the pool verifies the proof on-chain before accepting funds…');
      const res = await deposit(address);
      setTxHash(res.txHash);
      push(`Shielded. Commitment inserted at leaf ${res.note.leafIndex}.`);
      push('Go to Withdraw to send it on to any address — privately.');
      setPhase('done');
    } catch (e: any) {
      setErr(e.message || String(e));
      setPhase('error');
    }
  }

  async function handleVerifyPreview() {
    if (!address) return openModal();
    setErr(null);
    setLog([]);
    try {
      setPhase('working');
      push('Generating proof…');
      const bundle = await generateRangeProof(CONFIG.denomination, 12345n);
      push('Calling verifier.verify on-chain (read-only)…');
      const ok = await verifyOnChain(bundle.proofBytes, bundle.publicBytes);
      push(`On-chain verifier returned: ${ok ? 'true ✓' : 'false ✗'}`);
      setPhase('idle');
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

        {/* fixed denomination */}
        <div style={{ marginBottom: 8 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Denomination</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span className="num" style={{ fontSize: 48, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1 }}>{DENOM_XLM}</span>
            <span className="num" style={{ fontSize: 13, letterSpacing: '0.15em', color: 'var(--text-3)', textTransform: 'uppercase' }}>XLM</span>
            <span className="num" style={{ marginLeft: 'auto', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', padding: '4px 10px', borderRadius: 3 }}>Fixed</span>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, margin: '14px 0 24px' }}>
          A fixed denomination keeps every deposit identical on-chain, so amounts can't be told apart.
          Your secret note is generated locally and stored in this browser.
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleShield} disabled={busy}>
            {!address ? 'Connect wallet' : busy ? 'Working…' : `Shield ${DENOM_XLM} XLM`}
          </button>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={handleVerifyPreview} disabled={busy}>
            Verify proof
          </button>
        </div>

        {log.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: 14, marginBottom: 12 }}>
            {log.map((l, i) => (
              <div key={i} className="num" style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.8 }}>› {l}</div>
            ))}
          </div>
        )}
        {err && (
          <div className="num" style={{ fontSize: 11, color: 'rgba(248,180,180,0.9)', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: 12, marginBottom: 12, wordBreak: 'break-all' }}>{err}</div>
        )}
        {txHash && (
          <a href={`${CONFIG.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer" className="num"
            style={{ display: 'block', fontSize: 11, color: 'var(--accent)', wordBreak: 'break-all' }}>
            ✓ View transaction: {txHash.slice(0, 18)}…
          </a>
        )}
      </div>

      <div style={{ background: 'var(--bg-2)', padding: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
          How it works <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>
        {[
          { step: '01', title: 'Shield a fixed amount', desc: 'You deposit a fixed 100 XLM. Your browser generates a secret note and a Groth16 proof locally.' },
          { step: '02', title: 'Pool verifies on-chain', desc: 'The pool cross-calls the verifier; the BLS12-381 pairing check must pass — and the commitment must match the proof — before funds are accepted.' },
          { step: '03', title: 'Withdraw to anyone', desc: 'Later, withdraw your shielded note to any Stellar address. The funds leave the shared pool, not your account.' },
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
