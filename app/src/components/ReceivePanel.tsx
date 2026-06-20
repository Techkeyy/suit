import React, { useState } from 'react';
import { useWallet } from '../lib/wallet';
import { withdraw, getNotes, CONFIG, StoredNote } from '../lib/suit';

type Phase = 'idle' | 'working' | 'done' | 'error';

const toXlm = (base: string) => (Number(BigInt(base)) / 1e7).toLocaleString();

export default function ReceivePanel() {
  const { address, openModal } = useWallet();
  const [notes, setNotes] = useState<StoredNote[]>(() => getNotes());
  const [selected, setSelected] = useState<string | null>(null);
  const [recipient, setRecipient] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const unspent = notes.filter((n) => !n.spent);

  async function handleWithdraw() {
    if (!address) return openModal();
    const note = unspent.find((n) => n.leafHex === selected) || unspent[0];
    if (!note) {
      setErr('No shielded notes on this device. Shield funds first.');
      setPhase('error');
      return;
    }
    setErr(null);
    setTxHash(null);
    try {
      const to = recipient.trim() || address;
      setPhase('working');
      const hash = await withdraw(address, { amount: note.amount, secret: note.secret }, to);
      setTxHash(hash);
      setNotes(getNotes());
      setSelected(null);
      setPhase('done');
    } catch (e: any) {
      setErr(e.message || String(e));
      setPhase('error');
    }
  }

  const activeNote = unspent.find((n) => n.leafHex === selected) || unspent[0];

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="eyebrow" style={{ marginBottom: 24 }}>Withdraw from pool</div>

      {/* shielded notes */}
      <div style={{ marginBottom: 22 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Your shielded notes</div>
        {unspent.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
            None on this device. Shield funds first.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {unspent.map((n) => {
              const active = (selected || unspent[0]?.leafHex) === n.leafHex;
              return (
                <button key={n.leafHex} onClick={() => setSelected(n.leafHex)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', padding: '14px 16px', background: active ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer' }}>
                  <span>
                    <span className="num" style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 600 }}>{toXlm(n.amount)} XLM</span>
                    <span className="num" style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 10 }}>leaf {n.leafIndex} · {n.leafHex.slice(0, 10)}…</span>
                  </span>
                  <span className="num" style={{ width: 14, height: 14, borderRadius: '50%', border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`, background: active ? 'var(--accent)' : 'transparent' }} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 22 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Recipient address</div>
        <input className="num" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="G… (blank = your own wallet)"
          style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)', fontSize: 13, padding: '12px 14px', borderRadius: 6 }} />
      </div>

      <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleWithdraw} disabled={phase === 'working' || (!!address && unspent.length === 0)}>
        {!address ? 'Connect wallet' : phase === 'working' ? 'Withdrawing…' : activeNote ? `Withdraw ${toXlm(activeNote.amount)} XLM` : 'Withdraw'}
      </button>

      {err && (
        <div className="num" style={{ fontSize: 11, color: 'rgba(248,180,180,0.9)', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: 12, marginTop: 16, wordBreak: 'break-all' }}>{err}</div>
      )}
      {txHash && (
        <a href={`${CONFIG.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer" className="num"
          style={{ display: 'block', fontSize: 11, color: 'var(--accent)', marginTop: 16, wordBreak: 'break-all' }}>
          ✓ Withdrawn. View transaction: {txHash.slice(0, 20)}…
        </a>
      )}

      <div style={{ padding: '14px 16px', background: 'var(--surface)', borderLeft: '2px solid var(--border-strong)', marginTop: 18 }}>
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.65 }}>
          Funds are released from the shared pool to the recipient, not from your account. A nullifier
          prevents double-spends. Note: this version verifies the Merkle path on-chain, which reveals
          which leaf is spent — full deposit↔withdrawal unlinkability (a ZK membership proof) is on the roadmap.
        </p>
      </div>
    </div>
  );
}
