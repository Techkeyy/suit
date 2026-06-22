import React, { useState } from 'react';
import { useWallet } from '../lib/wallet';
import { shield, CONFIG } from '../lib/suit';

type Phase = 'idle' | 'working' | 'done' | 'error';

export default function SendPanel() {
  const { address, openModal } = useWallet();
  const [phase, setPhase] = useState<Phase>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleShield() {
    if (!address) return openModal();
    setErr(null);
    setTxHash(null);
    try {
      setPhase('working');
      const res = await shield(address);
      setTxHash(res.txHash);
      setPhase('done');
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

        <div className="eyebrow" style={{ marginBottom: 10 }}>Denomination</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
          <span className="num" style={{ fontSize: 48, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1 }}>{CONFIG.denomination}</span>
          <span className="num" style={{ fontSize: 13, letterSpacing: '0.15em', color: 'var(--text-3)', textTransform: 'uppercase' }}>XLM</span>
          <span className="num" style={{ marginLeft: 'auto', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', padding: '4px 10px', borderRadius: 3 }}>Fixed</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 22 }}>
          A fixed denomination makes every deposit identical — that uniformity is what hides you in the pool.
          Your note is generated and stored locally; only the commitment goes on-chain.
        </p>

        <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleShield} disabled={busy}>
          {!address ? 'Connect wallet' : busy ? 'Shielding…' : `Shield ${CONFIG.denomination} XLM`}
        </button>

        {err && (
          <div className="num" style={{ fontSize: 11, color: 'rgba(248,180,180,0.9)', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: 12, marginTop: 14, wordBreak: 'break-all' }}>{err}</div>
        )}
        {txHash && (
          <div style={{ marginTop: 14 }}>
            <a href={`${CONFIG.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer" className="num" style={{ display: 'block', fontSize: 11, color: 'var(--accent)', wordBreak: 'break-all', marginBottom: 8 }}>
              ✓ Shielded. View transaction: {txHash.slice(0, 18)}…
            </a>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Note saved on this device. Go to <strong style={{ color: 'var(--text-1)' }}>Withdraw</strong> to send it to any address — unlinkably.</div>
          </div>
        )}
      </div>

      <div style={{ background: 'var(--bg-2)', padding: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
          How it works <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>
        {[
          { step: '01', title: 'Shield a fixed amount', desc: 'Your browser generates a secret note (nullifier + secret) and posts only its commitment = Poseidon(nullifier, secret) on-chain.' },
          { step: '02', title: 'It joins the pool', desc: 'The commitment is inserted into an on-chain Poseidon Merkle tree alongside everyone else’s — all identical 100 XLM deposits.' },
          { step: '03', title: 'Withdraw unlinkably', desc: 'Later, prove in zero-knowledge that you own some note in the tree — revealing only a nullifier, never which deposit. No on-chain link to you.' },
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
