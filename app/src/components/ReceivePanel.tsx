import React, { useState } from 'react';
import { useWallet } from '../lib/wallet';
import { withdraw, CONFIG, getStoredLeaves } from '../lib/suit';

type Phase = 'idle' | 'working' | 'done' | 'error';

export default function ReceivePanel() {
  const { address, openModal } = useWallet();
  const [noteStr, setNoteStr] = useState('');
  const [recipient, setRecipient] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleWithdraw() {
    if (!address) return openModal();
    setErr(null);
    setTxHash(null);
    try {
      const note = JSON.parse(noteStr);
      if (!note.amount || !note.secret) throw new Error('Invalid note: expected { amount, secret }');
      const to = recipient.trim() || address;
      setPhase('working');
      const hash = await withdraw(address, note, to);
      setTxHash(hash);
      setPhase('done');
    } catch (e: any) {
      setErr(e.message || String(e));
      setPhase('error');
    }
  }

  const knownLeaves = getStoredLeaves().length;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 24 }}>
        Withdraw from pool
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>Withdrawal note</div>
        <textarea value={noteStr} onChange={e => setNoteStr(e.target.value)} placeholder='{"amount":"1000000000","secret":"…"}'
          style={{ width: '100%', height: 56, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 12, padding: '12px 14px', borderRadius: 4, fontFamily: 'monospace', resize: 'none' }} />
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}>{knownLeaves} commitment(s) known to this device's pool view.</div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>Recipient (defaults to your wallet)</div>
        <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="G… (leave blank to withdraw to yourself)"
          style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, padding: '12px 14px', borderRadius: 4, fontFamily: 'monospace' }} />
      </div>

      <button onClick={handleWithdraw} disabled={phase === 'working'}
        style={{ width: '100%', background: '#fff', color: '#000', border: 'none', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', padding: 14, cursor: phase === 'working' ? 'default' : 'pointer', fontWeight: 500, opacity: phase === 'working' ? 0.6 : 1 }}>
        {!address ? 'Connect wallet' : phase === 'working' ? 'Building proof & withdrawing…' : 'Withdraw 100 XLM'}
      </button>

      {err && (
        <div style={{ fontSize: 11, color: 'rgba(248,180,180,0.9)', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 4, padding: 12, marginTop: 16, fontFamily: 'monospace', wordBreak: 'break-all' }}>{err}</div>
      )}
      {txHash && (
        <a href={`${CONFIG.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer"
          style={{ display: 'block', fontSize: 11, color: '#4ade80', marginTop: 16, fontFamily: 'monospace', wordBreak: 'break-all' }}>
          ✓ Withdrawn. View transaction: {txHash.slice(0, 20)}…
        </a>
      )}

      <div style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderLeft: '2px solid rgba(255,255,255,0.15)', marginTop: 16 }}>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', lineHeight: 1.6 }}>
          The note proves a commitment exists in the pool via a Merkle path; a nullifier prevents double-spends.
          Note: this version verifies the Merkle path on-chain, so the spent leaf is revealed — full
          deposit↔withdrawal unlinkability (a ZK membership proof) is on the roadmap.
        </p>
      </div>
    </div>
  );
}
