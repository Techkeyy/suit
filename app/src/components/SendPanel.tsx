import React, { useState } from 'react';
import { useWallet } from '../lib/wallet';
import { deposit, verifyOnChain, generateRangeProof, CONFIG, Note } from '../lib/suit';

type Phase = 'idle' | 'proving' | 'verifying' | 'depositing' | 'done' | 'error';

export default function SendPanel() {
  const { address, connect } = useWallet();
  const [amount, setAmount] = useState('100');
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const push = (m: string) => setLog((l) => [...l, m]);

  // amount entered in XLM; circuit works in 7-decimal base units (stroops)
  const toBase = (xlm: string) => BigInt(Math.round(parseFloat(xlm) * 1e7));

  async function handleSend() {
    if (!address) return connect();
    setErr(null);
    setTxHash(null);
    setNote(null);
    setLog([]);
    try {
      const amt = toBase(amount);
      if (amt < CONFIG.minAmount || amt > CONFIG.maxAmount) {
        throw new Error(
          `Amount must be between ${Number(CONFIG.minAmount) / 1e7} and ${Number(CONFIG.maxAmount) / 1e7} XLM (policy bounds)`
        );
      }
      setPhase('proving');
      push('Generating Groth16 range proof in your browser…');

      setPhase('depositing');
      push('Submitting deposit — pool verifies the proof on-chain before accepting funds…');
      const res = await deposit(address, amt);
      setTxHash(res.txHash);
      setNote(res.note);
      push(`Deposit confirmed. Commitment inserted at leaf ${res.note.leafIndex}.`);
      push('Save the note below — the recipient needs it to withdraw.');
      setPhase('done');
    } catch (e: any) {
      setErr(e.message || String(e));
      setPhase('error');
    }
  }

  async function handleVerifyPreview() {
    if (!address) return connect();
    setErr(null);
    setLog([]);
    try {
      const amt = toBase(amount);
      setPhase('proving');
      push('Generating proof…');
      const bundle = await generateRangeProof(amt, 12345n);
      setPhase('verifying');
      push('Calling verifier.verify on-chain (read-only)…');
      const ok = await verifyOnChain(bundle.proofBytes, bundle.publicBytes);
      push(`On-chain verifier returned: ${ok ? 'true ✓' : 'false ✗'}`);
      setPhase('idle');
    } catch (e: any) {
      setErr(e.message || String(e));
      setPhase('error');
    }
  }

  const busy = phase === 'proving' || phase === 'verifying' || phase === 'depositing';
  const noteString = note ? JSON.stringify({ amount: note.amount, secret: note.secret }) : '';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'rgba(255,255,255,0.07)' }}>
      <div style={{ background: '#0a0a0a', padding: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          Private deposit <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>Proven amount (private input)</div>
          <div style={{ position: 'relative' }}>
            <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="100" type="number"
              style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontFamily: 'Cormorant Garamond, serif', fontSize: 42, fontWeight: 300, padding: '8px 0 12px', letterSpacing: '0.02em' }} />
            <span style={{ position: 'absolute', right: 0, bottom: 16, fontSize: 12, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>XLM</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 8 }}>
            Proven within policy bounds [{Number(CONFIG.minAmount) / 1e7} – {Number(CONFIG.maxAmount) / 1e7} XLM]. Pool escrows a fixed 100 XLM denomination.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <button onClick={handleSend} disabled={busy}
            style={{ flex: 2, background: '#fff', color: '#000', border: 'none', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', padding: 14, cursor: busy ? 'default' : 'pointer', fontWeight: 500, opacity: busy ? 0.6 : 1 }}>
            {!address ? 'Connect wallet' : busy ? 'Working…' : 'Shield and deposit'}
          </button>
          <button onClick={handleVerifyPreview} disabled={busy}
            style={{ flex: 1, background: 'transparent', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.15)', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', padding: 14, cursor: busy ? 'default' : 'pointer' }}>
            Verify proof
          </button>
        </div>

        {log.length > 0 && (
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 4, padding: 14, marginBottom: 12 }}>
            {log.map((l, i) => (
              <div key={i} style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', lineHeight: 1.7 }}>› {l}</div>
            ))}
          </div>
        )}

        {err && (
          <div style={{ fontSize: 11, color: 'rgba(248,180,180,0.9)', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 4, padding: 12, marginBottom: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>{err}</div>
        )}

        {txHash && (
          <a href={`${CONFIG.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer"
            style={{ display: 'block', fontSize: 11, color: '#4ade80', marginBottom: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>
            ✓ View transaction: {txHash.slice(0, 16)}…
          </a>
        )}

        {note && (
          <div style={{ background: 'rgba(255,255,255,0.04)', borderLeft: '2px solid #4ade80', padding: 14 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>Withdrawal note — give to recipient</div>
            <textarea readOnly value={noteString} onFocus={(e) => e.currentTarget.select()}
              style={{ width: '100%', height: 56, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', fontSize: 11, padding: 8, borderRadius: 4, resize: 'none' }} />
          </div>
        )}
      </div>

      <div style={{ background: '#0a0a0a', padding: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          How it works <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
        </div>
        {[
          { step: '01', title: 'You enter an amount', desc: 'It is used only as a private input to the Circom circuit. It never appears on the Stellar ledger.' },
          { step: '02', title: 'A range proof is generated', desc: 'A Circom/Groth16 proof (BLS12-381) is generated in your browser, proving the amount is within policy bounds.' },
          { step: '03', title: 'Pool verifies on-chain', desc: 'The pool cross-calls the verifier; the BLS12-381 pairing check must pass before the deposit is accepted. No valid proof, no deposit.' },
          { step: '04', title: 'Receiver withdraws', desc: 'With the note, the receiver withdraws from the pool using a nullifier — double-spends are rejected on-chain.' },
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
