import React, { useEffect, useState } from 'react';
import { useWallet } from '../lib/wallet';
import { withdraw, getNotes, getActiveToken, getRelayerInfo, enableAndFundUSDC, fundTestnetXLM, getWalletTokenBalance, CONFIG, UTXONote, stroopsToXlm } from '../lib/suit';

type Phase = 'idle' | 'working' | 'done' | 'error';

export default function ReceivePanel() {
  const { address, openModal, refreshBalance } = useWallet();
  const [notes, setNotes] = useState<UTXONote[]>(() => getNotes());
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [changeInfo, setChangeInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [relayer, setRelayer] = useState<string | null | undefined>(undefined); // undefined = checking
  const [faucet, setFaucet] = useState<{ busy: boolean; msg: string; err: string }>({ busy: false, msg: '', err: '' });
  const [tokenBal, setTokenBal] = useState<string | null>(null);

  const sym = getActiveToken().sym;
  const unspent = notes.filter(n => !n.spent);
  const active = unspent.find(n => n.commitment === selected) || unspent[0];
  const activeAmt = active ? stroopsToXlm(active.amount) : '0';

  useEffect(() => {
    getRelayerInfo().then(info => setRelayer(info ? info.relayer : null)).catch(() => setRelayer(null));
  }, []);

  useEffect(() => {
    if (address) getWalletTokenBalance(address).then(setTokenBal).catch(() => setTokenBal(null));
  }, [address]);

  async function handleFaucet() {
    if (!address) return openModal();
    setFaucet({ busy: true, msg: '', err: '' });
    try {
      if (sym === 'USDC') {
        await enableAndFundUSDC(address, m => setFaucet(f => ({ ...f, msg: m })));
      } else {
        await fundTestnetXLM(address, m => setFaucet(f => ({ ...f, msg: m })));
      }
      const bal = await getWalletTokenBalance(address);
      setTokenBal(bal);
      setFaucet({ busy: false, msg: `Funded. Wallet balance: ${Number(bal).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${sym}`, err: '' });
      refreshBalance();
    } catch (e: any) {
      setFaucet({ busy: false, msg: '', err: e.message || String(e) });
    }
  }

  async function handleWithdraw() {
    if (!address) return openModal();
    if (!active) { setErr('No shielded notes. Shield first.'); setPhase('error'); return; }
    if (!amount || Number(amount) <= 0) { setErr('Enter a withdrawal amount.'); setPhase('error'); return; }
    if (!recipient.trim()) { setErr('Enter a recipient Stellar address.'); setPhase('error'); return; }
    const noteAmt = Number(stroopsToXlm(active.amount));
    if (Number(amount) > noteAmt) { setErr(`Amount exceeds note balance (${activeAmt} ${sym}).`); setPhase('error'); return; }

    setErr(null); setTxHash(null); setLog([]); setChangeInfo(null);
    try {
      setPhase('working');
      const res = await withdraw(address, active, amount, recipient.trim(), m => setLog(l => [...l, m]));
      setLog(l => [...l, '✓ Confirmed on-chain']);
      setTxHash(res.txHash);
      if (res.changeNote) {
        setChangeInfo(`Change note saved: ${stroopsToXlm(res.changeNote.amount)} ${sym} (spendable)`);
      }
      setNotes(getNotes());
      setSelected(null);
      setAmount('');
      setPhase('done');
      refreshBalance();
    } catch (e: any) {
      setErr(e.message || String(e));
      setPhase('error');
    }
  }

  function handleSelectNote(n: UTXONote) {
    setSelected(n.commitment);
    setAmount(stroopsToXlm(n.amount));
  }

  const busy = phase === 'working';

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="eyebrow" style={{ marginBottom: 24 }}>Withdraw from pool</div>

      <div className="eyebrow" style={{ marginBottom: 10 }}>Your shielded notes</div>
      {unspent.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-3)', padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 22 }}>
          None on this device. Shield some {sym} first.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
          {unspent.map(n => {
            const isActive = active?.commitment === n.commitment;
            return (
              <button key={n.commitment} onClick={() => handleSelectNote(n)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', padding: '14px 16px', background: isActive ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${isActive ? 'var(--accent-border)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer' }}>
                <span>
                  <span className="num" style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 600 }}>{stroopsToXlm(n.amount)} {sym}</span>
                  <span className="num" style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 10 }}>note ·{n.commitment.slice(0, 6)}</span>
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
        <span className="num" style={{ fontSize: 12, color: 'var(--text-3)' }}>/ {activeAmt} {sym}</span>
        {active && (
          <button className="num" onClick={() => setAmount(stroopsToXlm(active.amount))}
            style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', padding: '6px 10px', borderRadius: 3, cursor: 'pointer' }}>
            Max
          </button>
        )}
      </div>

      <div className="eyebrow" style={{ marginBottom: 10 }}>Recipient address</div>
      <input className="num" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="G… (any Stellar testnet address)" disabled={busy}
        style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)', fontSize: 13, padding: '12px 14px', borderRadius: 6, marginBottom: 14 }} />

      {/* Relayer status — tells the user whether their wallet stays hidden */}
      <div className="num" style={{ fontSize: 11, marginBottom: 18, padding: '9px 12px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8,
        background: relayer ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${relayer ? 'var(--accent-border)' : 'var(--border)'}`,
        color: relayer ? 'var(--accent)' : 'var(--text-3)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: relayer ? 'var(--accent)' : 'var(--text-3)', flexShrink: 0 }} />
        {relayer === undefined ? 'Checking relayer…'
          : relayer ? 'Relayer active — submitted from a different account, so your wallet never appears on-chain.'
          : 'Relayer offline — withdrawal will be submitted from your wallet (visible). Funds are still unlinkable to your deposit.'}
      </div>

      <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Need testnet {sym}?</span>
          <button className="num" onClick={handleFaucet} disabled={faucet.busy}
            style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', padding: '6px 12px', borderRadius: 3, cursor: faucet.busy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
            {faucet.busy ? 'Working…' : `Get test ${sym}`}
          </button>
        </div>
        {address && tokenBal !== null && (
          <div className="num" style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Wallet:</span>
            <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{Number(tokenBal).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            <span style={{ color: 'var(--text-3)' }}>{sym}</span>
          </div>
        )}
        {faucet.msg && <div className="num" style={{ fontSize: 10.5, color: 'var(--accent)', marginTop: 8 }}>{faucet.msg}</div>}
        {faucet.err && <div className="num" style={{ fontSize: 10.5, color: 'rgba(248,180,180,0.9)', marginTop: 8, wordBreak: 'break-all' }}>{faucet.err}</div>}
      </div>

      <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleWithdraw} disabled={busy || (!!address && unspent.length === 0)}>
        {!address ? 'Connect wallet' : busy ? 'Proving & withdrawing…' : amount ? `Withdraw ${amount} ${sym}` : `Withdraw ${sym}`}
      </button>

      {log.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: 14, marginTop: 14 }}>
          {log.map((l, i) => {
            const done = l.startsWith('✓');
            const pending = busy && i === log.length - 1 && !done;
            return (
              <div key={i} className="num" style={{ fontSize: 11, color: done ? 'var(--accent)' : 'var(--text-2)', lineHeight: 1.8 }}>
                {l}{pending ? ' …' : ''}
              </div>
            );
          })}
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
          The proof hides <em>which</em> deposit you're spending — the withdrawal can't be linked back to it.
          A non-custodial relayer submits it from its own account, so your wallet never appears on-chain; the
          proof binds the recipient and fee, so the relayer <em>cannot</em> redirect your funds. The recipient
          and amount are public (they must be, to move real {sym}); change returns as a new private note.
        </p>
      </div>
    </div>
  );
}
