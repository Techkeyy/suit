import React, { useState } from 'react';
import { useWallet } from '../lib/wallet';
import { withdraw, getNotes, CONFIG, UTXONote, stroopsToXlm } from '../lib/suit';

type Phase = 'idle' | 'working' | 'done' | 'error';

export default function ReceivePanel() {
  const { address, openModal } = useWallet();
  const [notes, setNotes] = useState<UTXONote[]>(() => getNotes());
  const [selected, setSelected] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [changeInfo, setChangeInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const unspent = notes.filter(n => !n.spent);
  const active = unspent.find(n => n.leafIndex === selected) || unspent[0];
  const activeXlm = active ? stroopsToXlm(active.amount) : '0';

  async function handleWithdraw() {
    if (!address) return openModal();
    if (!active) { setErr('No shielded notes. Shield first.'); setPhase('error'); return; }
    if (!amount || Number(amount) <= 0) { setErr('Enter a withdrawal amount.'); setPhase('error'); return; }
    if (!recipient.trim()) { setErr('Enter a recipient Stellar address.'); setPhase('error'); return; }
    const noteXlm = Number(stroopsToXlm(active.amount));
    if (Number(amount) > noteXlm) { setErr(`Amount exceeds note balance (${activeXlm} XLM).`); setPhase('error'); return; }

    setErr(null); setTxHash(null); setLog([]); setChangeInfo(null);
    try {
      setPhase('working');
      const res = await withdraw(address, active, amount, recipient.trim(), m => setLog(l => [...l, m]));
      setTxHash(res.txHash);
      if (res.changeNote) {
        setChangeInfo(`Change note: ${stroopsToXlm(res.changeNote.amount)} XLM (leaf ${res.changeNote.leafIndex})`);
      }
      setNotes(getNotes());
      setSelected(null);
      setAmount('');
      setPhase('done');
    } catch (e: any) {
      setErr(e.message || String(e));
      setPhase('error');
    }
  }

  function handleSelectNote(n: UTXONote) {
    setSelected(n.leafIndex);
    setAmount(stroopsToXlm(n.amount));
  }

  const busy = phase === 'working';

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="eyebrow" style={{ marginBottom: 24 }}>Withdraw from pool</div>

      <div className="eyebrow" style={{ marginBottom: 10 }}>Your shielded notes</div>
      {unspent.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-3)', padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 22 }}>
          None on this device. Shield some XLM first.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
          {unspent.map(n => {
            const isActive = active?.leafIndex === n.leafIndex;
            return (
              <button key={n.leafIndex} onClick={() => handleSelectNote(n)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', padding: '14px 16px', background: isActive ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${isActive ? 'var(--accent-border)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer' }}>
                <span>
                  <span className="num" style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 600 }}>{stroopsToXlm(n.amount)} XLM</span>
                  <span className="num" style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 10 }}>leaf {n.leafIndex}</span>
                </span>
                <span style={{ width: 14, height: 14, borderRadius: '50%', border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border-strong)'}`, background: isActive ? 'var(--accent)' : 'transparent' }} />
              </button>
            );
          })}
        </div>
      )}

      <div className="eyebrow" style={{ marginBottom: 10 }}>Withdrawal amount</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <input className="num" type="number" min="0.0000001" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" disabled={busy}
          style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)', fontSize: 16, fontWeight: 600, padding: '12px 14px', borderRadius: 6 }} />
        <span className="num" style={{ fontSize: 12, color: 'var(--text-3)' }}>/ {activeXlm} XLM</span>
        {active && (
          <button className="num" onClick={() => setAmount(stroopsToXlm(active.amount))}
            style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', padding: '6px 10px', borderRadius: 3, cursor: 'pointer' }}>
            Max
          </button>
        )}
      </div>

      <div className="eyebrow" style={{ marginBottom: 10 }}>Recipient address</div>
      <input className="num" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="G… (any Stellar testnet address)" disabled={busy}
        style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)', fontSize: 13, padding: '12px 14px', borderRadius: 6, marginBottom: 22 }} />

      <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleWithdraw} disabled={busy || (!!address && unspent.length === 0)}>
        {!address ? 'Connect wallet' : busy ? 'Proving & withdrawing…' : amount ? `Withdraw ${amount} XLM` : 'Withdraw XLM'}
      </button>

      {log.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: 14, marginTop: 14 }}>
          {log.map((l, i) => (
            <div key={i} className="num" style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.8 }}>{l}</div>
          ))}
        </div>
      )}
      {err && (
        <div className="num" style={{ fontSize: 11, color: 'rgba(248,180,180,0.9)', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: 12, marginTop: 14, wordBreak: 'break-all' }}>{err}</div>
      )}
      {txHash && (
        <div style={{ marginTop: 14 }}>
          <a href={`${CONFIG.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer" className="num" style={{ display: 'block', fontSize: 11, color: 'var(--accent)', wordBreak: 'break-all', marginBottom: 6 }}>
            Withdrawn unlinkably. View tx: {txHash.slice(0, 20)}…
          </a>
          {changeInfo && (
            <div className="num" style={{ fontSize: 11, color: 'var(--text-2)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, marginTop: 6 }}>{changeInfo}</div>
          )}
        </div>
      )}

      <div style={{ padding: '14px 16px', background: 'var(--surface)', borderLeft: '2px solid var(--accent-border)', marginTop: 18 }}>
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.65 }}>
          Withdraw any portion of a shielded note. The proof reveals only a nullifier and value conservation — never
          which deposit, never the amount. Change is returned as a new note you can spend later.
        </p>
      </div>
    </div>
  );
}
