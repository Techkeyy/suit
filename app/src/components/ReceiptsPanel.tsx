import React, { useEffect, useState } from 'react';
import {
  getNotes, getPoolCount, getActiveToken, CONFIG, UTXONote, stroopsToXlm,
  getViewingKey, exportAuditPackage, verifyAuditPackage,
  generateReceipt, verifyReceipt,
  type AuditReport, type ReceiptVerification,
} from '../lib/suit';

function download(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  // The anchor must be in the DOM for a click-triggered download to fire
  // reliably, and the blob URL must outlive the click — revoking it in the
  // same tick can abort the download silently (no file, no error).
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

const card: React.CSSProperties = {
  padding: '14px 16px', background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: 6,
};
const btn: React.CSSProperties = {
  fontSize: 11, letterSpacing: '0.04em', padding: '7px 12px',
  background: 'var(--accent-dim)', color: 'var(--accent)',
  border: '1px solid var(--accent-border)', borderRadius: 4, cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  ...btn, background: 'transparent', color: 'var(--text-2)', borderColor: 'var(--border-strong)',
};

export default function ReceiptsPanel() {
  const [notes, setNotes] = useState<UTXONote[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const sym = getActiveToken().sym;

  useEffect(() => {
    setNotes(getNotes());
    getPoolCount().then(setCount).catch(() => {});
  }, []);

  const unspent = notes.filter(n => !n.spent);
  const spent = notes.filter(n => n.spent && n.withdrawTxHash);
  const totalShielded = unspent.reduce((s, n) => s + BigInt(n.amount), 0n);

  // ── Viewing key / audit ──
  const [vkBusy, setVkBusy] = useState(false);
  const [vkMsg, setVkMsg] = useState('');
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);

  const copyViewingKey = async () => {
    try {
      await navigator.clipboard.writeText(getViewingKey());
      setVkMsg('Viewing key copied to clipboard.');
    } catch { setVkMsg('Viewing key: ' + getViewingKey()); }
  };

  const doExportAudit = () => {
    download(`suit-audit-${sym.toLowerCase()}.json`, exportAuditPackage());
    setVkMsg('Audit package downloaded. Share it with the viewing key to grant read-only access.');
  };

  const verifyAuditFile = async (file: File) => {
    setVkBusy(true); setVkMsg(''); setAuditReport(null);
    try {
      const pkg = JSON.parse(await file.text());
      const key = window.prompt('Paste the viewing key (hex) for this audit package:');
      if (!key) { setVkBusy(false); return; }
      const report = await verifyAuditPackage(pkg, key.trim());
      setAuditReport(report);
      if (report.valid) {
        setVkMsg('Audit package verified against the chain.');
      } else if (report.error === 'decrypt_failed') {
        setVkMsg('Wrong viewing key for this package — nothing could be decrypted. Copy the viewing key from the same pool/device that exported it, then retry.');
      } else {
        setVkMsg('Verification incomplete — some entries did not match on-chain commitments.');
      }
    } catch (e: any) {
      setVkMsg(`Could not verify: ${e?.message || e}`);
    } finally { setVkBusy(false); }
  };

  // ── Compliance receipts ──
  const [rcMsg, setRcMsg] = useState('');
  const [rcBusy, setRcBusy] = useState(false);
  const [rcResult, setRcResult] = useState<ReceiptVerification | null>(null);

  const doGenerateReceipt = async (note: UTXONote) => {
    setRcBusy(true); setRcMsg(''); setRcResult(null);
    try {
      const receipt = generateReceipt(note);
      download(`suit-receipt-${note.commitment.slice(0, 8)}.json`, receipt);

      const result = await verifyReceipt(receipt);
      setRcResult(result);
      if (result.valid) {
        setRcMsg('Receipt downloaded and verified against on-chain state.');
      } else if (result.commitmentValid) {
        setRcMsg('Receipt downloaded. Commitment math valid but chain checks pending — the chain may still be indexing.');
      } else {
        setRcMsg('Receipt downloaded but verification failed — check browser console for diagnostics.');
      }
    } catch (e: any) { setRcMsg(`Could not generate: ${e?.message || e}`); }
    finally { setRcBusy(false); }
  };

  const verifyReceiptFile = async (file: File) => {
    setRcBusy(true); setRcMsg(''); setRcResult(null);
    try {
      const raw = await file.text();
      const receipt = JSON.parse(raw);
      console.log('[SUIT] verifying receipt:', receipt);
      const result = await verifyReceipt(receipt);
      setRcResult(result);
      setRcMsg(result.valid ? 'Receipt verified against on-chain state.' : 'Receipt could not be fully verified.');
    } catch (e: any) {
      setRcMsg(`Could not verify: ${e?.message || e}`);
    } finally { setRcBusy(false); }
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="eyebrow" style={{ marginBottom: 20 }}>Pool activity</div>

      <div style={{ display: 'flex', gap: 1, background: 'var(--border)', marginBottom: 24 }}>
        {[
          { k: 'On-chain commitments', v: count === null ? '…' : String(count) },
          { k: 'Your notes', v: String(notes.length) },
          { k: 'Shielded balance', v: `${stroopsToXlm(totalShielded.toString())} ${sym}` },
        ].map(s => (
          <div key={s.k} style={{ flex: 1, background: 'var(--bg-2)', padding: 18, textAlign: 'center' }}>
            <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>{s.v}</div>
            <div className="eyebrow" style={{ marginTop: 4 }}>{s.k}</div>
          </div>
        ))}
      </div>

      <div className="eyebrow" style={{ marginBottom: 8 }}>Your notes (this device)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notes.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
            No notes yet. Shield some {sym} to create one.
          </div>
        )}
        {notes.map(n => (
          <div key={n.commitment} style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div className="num" style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 600 }}>{stroopsToXlm(n.amount)} {sym}</div>
              <div className="num" style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>note ·{n.commitment.slice(0, 8)} · {new Date(n.ts).toLocaleString()}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {n.spent && n.withdrawTxHash && (
                <button style={btnGhost} onClick={() => doGenerateReceipt(n)} title="Generate a compliance receipt for this withdrawal">
                  Receipt
                </button>
              )}
              <span className="num" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: n.spent ? 'var(--text-3)' : 'var(--accent)', background: n.spent ? 'var(--surface-2)' : 'var(--accent-dim)', border: `1px solid ${n.spent ? 'var(--border-strong)' : 'var(--accent-border)'}`, padding: '3px 10px', borderRadius: 2 }}>
                {n.spent ? 'Spent' : 'In pool'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Viewing key / audit ── */}
      <div className="eyebrow" style={{ margin: '28px 0 8px' }}>Auditable by choice</div>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
          Export a <strong style={{ color: 'var(--text-2)' }}>viewing key</strong> and an encrypted{' '}
          <strong style={{ color: 'var(--text-2)' }}>audit package</strong>. Whoever holds both can verify every
          amount you shielded and withdrew against the chain — but can never spend. Disclosure is yours to grant.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button style={btn} onClick={copyViewingKey}>Copy viewing key</button>
          <button style={btn} onClick={doExportAudit}>Export audit package</button>
          <label style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center' }}>
            {vkBusy ? 'Verifying…' : 'Verify audit package'}
            <input type="file" accept="application/json" style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && verifyAuditFile(e.target.files[0])} disabled={vkBusy} />
          </label>
        </div>
        {vkMsg && <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{vkMsg}</div>}
        {auditReport && (
          <div style={{ fontSize: 11, color: 'var(--text-2)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
              <span>Shielded: <strong className="num">{auditReport.totalShielded} {sym}</strong></span>
              <span>Withdrawn: <strong className="num">{auditReport.totalWithdrawn} {sym}</strong></span>
              <span>Net: <strong className="num">{auditReport.netBalance} {sym}</strong></span>
            </div>
            {auditReport.entries.map((e, i) => (
              <div key={i} className="num" style={{ fontSize: 10, color: e.onChainVerified ? 'var(--accent)' : 'var(--text-3)', marginTop: 2 }}>
                {e.onChainVerified ? '✓' : '·'} {e.type} {stroopsToXlm(e.amount)} {sym} · ·{e.commitment.slice(0, 8)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Compliance receipts ── */}
      <div className="eyebrow" style={{ margin: '20px 0 8px' }}>Compliance receipts</div>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
          A receipt links one withdrawal back to its source deposit — a voluntary, point-in-time proof for tax
          or regulatory needs. Use the <strong style={{ color: 'var(--text-2)' }}>Receipt</strong> button on any
          spent note above, or verify someone else's below.
        </p>
        {spent.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>No spent notes yet — withdraw to create a receiptable record.</div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <label style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center' }}>
            {rcBusy ? 'Verifying…' : 'Verify a receipt'}
            <input type="file" accept="application/json" style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && verifyReceiptFile(e.target.files[0])} disabled={rcBusy} />
          </label>
        </div>
        {rcMsg && <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{rcMsg}</div>}
        {rcResult && (
          <div style={{ fontSize: 11, color: 'var(--text-2)', borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {([
              ['Commitment math valid', rcResult.commitmentValid],
              ['Deposit found on-chain', rcResult.commitmentOnChain],
              ['Nullifier burned (withdrawal confirmed)', rcResult.nullifierBurned],
              ...(rcResult.signatureValid !== null
                ? [['Signature valid', rcResult.signatureValid] as [string, boolean]]
                : []),
              ['Overall', rcResult.valid],
            ] as [string, boolean][]).map(([k, ok]) => (
              <div key={k} className="num" style={{ fontSize: 10, color: ok ? 'var(--accent)' : 'var(--text-3)' }}>
                {ok ? '✓' : '✗'} {k}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 24, padding: 16, background: 'var(--surface)', borderLeft: '2px solid var(--accent-border)' }}>
        <div className="eyebrow" style={{ color: 'var(--text-1)', marginBottom: 6 }}>Arbitrary amounts, full privacy</div>
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
          Each note carries a hidden amount inside a Poseidon commitment. Value conservation is proven
          in zero-knowledge — the chain verifies the math without seeing any values.{' '}
          <a href={`${CONFIG.explorer}/contract/${getActiveToken().poolId}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{sym} pool contract</a>
        </p>
      </div>
    </div>
  );
}
