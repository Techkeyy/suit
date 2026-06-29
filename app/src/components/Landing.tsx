import React from "react";

interface Props {
  onLaunch: () => void;
}

const POOL = "https://stellar.expert/explorer/testnet/contract/CAXFFBZHC7CFYFOQSMV57TAY2CEO6Y2GMOQKLKSERD4O4DBMLFSMDA63";
const VERIFIER = "https://stellar.expert/explorer/testnet/contract/CDEZRSL6WXBEJZ45WVFDI6DIHJEZ6UEWY3CUJIQPLCQIVUMLXXVKON2T";

const scrollTo = (id: string) => () =>
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

export default function Landing({ onLaunch }: Props) {
  const eyebrow: React.CSSProperties = { display: "block" };

  return (
    <div style={{ background: "var(--bg)", fontFamily: "var(--font-sans)", color: "var(--text-1)" }}>

      {/* ---------- nav ---------- */}
      <nav className="landing-nav" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: "var(--nav-h)", padding: "0 48px", position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, background: "rgba(11,11,14,0.82)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 19, fontWeight: 700, letterSpacing: "0.28em", textTransform: "uppercase" }}>
          SUIT<span style={{ color: "var(--text-3)", fontWeight: 300 }}> Protocol</span>
        </div>
        <div className="landing-nav-links" style={{ display: "flex", gap: 30, alignItems: "center" }}>
          <button className="navlink" onClick={scrollTo("how")}>How it works</button>
          <button className="navlink" onClick={scrollTo("why")}>Why SUIT</button>
          <button className="navlink" onClick={scrollTo("stack")}>ZK stack</button>
        </div>
      </nav>

      {/* ---------- hero ---------- */}
      <div className="landing-hero" style={{ minHeight: "100vh", position: "relative", overflow: "hidden", display: "flex", alignItems: "center" }}>
        <div className="landing-hero-img" style={{ position: "absolute", top: 0, right: 0, width: "58%", height: "100%", zIndex: 1 }}>
          <img src="/suit_hero.jpg" alt="" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 35%", filter: "contrast(1.05) brightness(0.7) saturate(0.9)" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, var(--bg) 8%, transparent 70%)", zIndex: 2 }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "35%", background: "linear-gradient(to bottom, transparent, var(--bg))", zIndex: 2 }} />
        </div>

        <div className="landing-hero-text" style={{ position: "relative", zIndex: 10, width: "52%", padding: "var(--nav-h) 0 0 48px" }}>
          {/* live status — credibility, links to chain */}
          <a href={VERIFIER} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "6px 14px", borderRadius: 999, border: "1px solid var(--accent-border)", background: "var(--accent-dim)", marginBottom: 30, textDecoration: "none" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 10px var(--accent)" }} />
            <span className="num" style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)" }}>Live on Stellar testnet</span>
          </a>

          <h1 className="landing-h1" style={{ fontFamily: "var(--font-serif)", fontSize: 74, fontWeight: 300, lineHeight: 1.04, marginBottom: 24 }}>
            Private payments.<br />
            <em style={{ fontStyle: "italic", color: "var(--text-3)" }}>Your</em> protocol.<br />
            <strong style={{ fontWeight: 700 }}>Build on it.</strong>
          </h1>

          <p style={{ fontSize: 16, color: "var(--text-2)", lineHeight: 1.7, maxWidth: 440, marginBottom: 40 }}>
            The privacy layer for Stellar. Shield any amount, withdraw any
            portion with a zero-knowledge proof, and prove compliance on demand.
            One <code style={{ fontSize: 13, color: "var(--accent)", background: "var(--accent-dim)", padding: "2px 6px", borderRadius: 3 }}>npm install</code> gives
            any app shielded transfers, viewing keys, and audit receipts.
          </p>

          <div style={{ display: "flex", gap: 14, marginBottom: 52 }}>
            <button className="btn btn-primary" style={{ padding: "15px 36px" }} onClick={onLaunch}>Open the app</button>
            <button className="btn btn-ghost" style={{ padding: "15px 36px" }} onClick={scrollTo("how")}>See how it works</button>
          </div>

          {/* protocol layer indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 580 }}>
            {[
              { label: "SDK on npm", live: true },
              { label: "Viewing keys", live: true },
              { label: "Compliance receipts", live: true },
              { label: "On-chain verify", live: true },
            ].map((s, i, arr) => (
              <React.Fragment key={s.label}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: s.live ? "var(--accent)" : "var(--border-strong)", flexShrink: 0 }} />
                <span className="num" style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: s.live ? "var(--text-2)" : "var(--text-3)", whiteSpace: "nowrap" }}>{s.label}{!s.live && " ·"}{!s.live && <span style={{ color: "var(--text-3)" }}> roadmap</span>}</span>
                {i < arr.length - 1 && <div style={{ flex: 1, height: 1, background: "var(--border)" }} />}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- stats ---------- */}
      <div className="stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        {[
          { num: "Groth16", label: "ZK system", accent: false, small: true },
          { num: "npm", label: "@suit-protocol/sdk", accent: true, small: true },
          { num: "BN254", label: "Poseidon · pairing", accent: false, small: true },
          { num: "UTXO", label: "2-in / 2-out model", accent: false, small: true },
        ].map((s, i) => (
          <div key={s.label} style={{ padding: "34px 28px", borderRight: i < 3 ? "1px solid var(--border)" : "none", textAlign: "center" }}>
            <div className="num" style={{ fontSize: s.small ? 21 : 38, fontWeight: 600, color: s.accent ? "var(--accent)" : "var(--text-1)", whiteSpace: "nowrap" }}>{s.num}</div>
            <div className="eyebrow" style={{ marginTop: 10 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ---------- how it works ---------- */}
      <section id="how" className="landing-section" style={{ padding: "120px 48px" }}>
        <span className="eyebrow" style={eyebrow}>How it works</span>
        <h2 className="landing-h2" style={{ fontFamily: "var(--font-serif)", fontSize: 46, fontWeight: 300, margin: "16px 0 64px" }}>Install. Shield. Prove. Ship.</h2>
        <div className="steps-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: "var(--border)" }}>
          {[
            { step: "01", title: "Install the SDK", desc: "npm install @suit-protocol/sdk — plug in your own Signer interface (wallet adapter, Keypair, custodian) and a NoteStore (browser, database, anything). The protocol adapts to your stack." },
            { step: "02", title: "Shield any amount", desc: "Call pool.shield() — the SDK generates a secret UTXO note, proves value conservation in zero-knowledge, and writes only a Poseidon commitment on-chain. The amount stays hidden." },
            { step: "03", title: "Withdraw unlinkably", desc: "pool.withdraw() builds a Groth16 proof consuming notes and producing change — like spending cash. The pool verifies on-chain via BN254 pairing. No link between deposit and withdrawal." },
            { step: "04", title: "Prove compliance", desc: "Generate viewing keys for read-only audit, or compliance receipts that link a withdrawal to its deposit — with nullifier verification on-chain. Privacy by default, disclosure by choice." },
          ].map(item => (
            <div key={item.step} style={{ background: "var(--bg-2)", padding: "40px 30px" }}>
              <div className="num" style={{ fontSize: 40, color: "var(--border-strong)", marginBottom: 22, fontWeight: 600 }}>{item.step}</div>
              <div className="eyebrow" style={{ color: "var(--text-1)", marginBottom: 14, letterSpacing: "0.12em" }}>{item.title}</div>
              <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.8 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- why ---------- */}
      <section id="why" className="landing-section" style={{ padding: "120px 48px", background: "var(--bg-2)", borderTop: "1px solid var(--border)" }}>
        <span className="eyebrow" style={eyebrow}>Why SUIT exists</span>
        <h2 className="landing-h2" style={{ fontFamily: "var(--font-serif)", fontSize: 46, fontWeight: 300, margin: "16px 0 32px", maxWidth: 760 }}>Stellar is public. Your users deserve a choice.</h2>
        <div className="why-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, maxWidth: 1100 }}>
          <div>
            <p style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.9, marginBottom: 22 }}>Every payment on Stellar — amount, sender, receiver — is permanently visible. Bots monitor transactions in real time. Your users' financial data is exposed the moment they transact.</p>
            <p style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.9 }}>SUIT is the protocol layer that fixes this. Integrate the SDK into your app and give your users shielded transfers, viewing keys for selective disclosure, and compliance receipts for regulators — all verified on-chain.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {[
              { title: "For developers", desc: "One npm install. Plug in your signer and storage — the SDK handles proofs, trees, and on-chain verification." },
              { title: "For businesses", desc: "Run payroll, settle invoices, move funds — without exposing amounts or counterparties on the public ledger." },
              { title: "For compliance", desc: "Viewing keys grant read-only audit access. Compliance receipts prove source-of-funds on demand, with nullifier verification on-chain." },
            ].map(item => (
              <div key={item.title} style={{ padding: "22px 26px", background: "var(--surface)", borderLeft: "2px solid var(--border-strong)" }}>
                <div className="eyebrow" style={{ color: "var(--text-1)", letterSpacing: "0.12em", marginBottom: 8 }}>{item.title}</div>
                <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.7 }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- zk stack ---------- */}
      <section id="stack" className="landing-section" style={{ padding: "120px 48px", borderTop: "1px solid var(--border)" }}>
        <span className="eyebrow" style={eyebrow}>The ZK stack</span>
        <h2 className="landing-h2" style={{ fontFamily: "var(--font-serif)", fontSize: 46, fontWeight: 300, margin: "16px 0 12px" }}>What's live. What's next.</h2>
        <p style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 56, maxWidth: 560 }}>
          Depth over breadth — every feature listed as live genuinely verifies on Stellar today.{" "}
          <a href={POOL} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>See it on-chain →</a>
        </p>
        <div className="stack-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "var(--border)" }}>
          {[
            { tool: "Circom", role: "Shielded UTXO pool", status: "Live", live: true, desc: "2-in/2-out transaction circuit (Tornado-Nova model) proving value conservation, Merkle membership, and nullifier uniqueness over BN254. Verified on-chain via Stellar's pairing host functions. Arbitrary amounts, fully unlinkable." },
            { tool: "SDK", role: "Protocol layer", status: "Live on npm", live: true, desc: "Pluggable TypeScript SDK — bring your own Signer, NoteStore, and LeafCache. Includes viewing keys (AES-GCM encrypted audit logs), compliance receipts with ed25519 signatures, and on-chain nullifier verification." },
            { tool: "Noir", role: "KYC identity proof", status: "Roadmap", live: false, desc: "Will prove a sender holds a valid KYC credential without revealing identity — selective disclosure at the protocol level. Circuit design in progress." },
          ].map(item => (
            <div key={item.tool} style={{ background: "var(--bg-2)", padding: "44px 34px" }}>
              <div style={{ fontFamily: "var(--font-serif)", fontSize: 34, fontWeight: 600, marginBottom: 6 }}>{item.tool}</div>
              <div className="eyebrow" style={{ marginBottom: 14 }}>{item.role}</div>
              <span className="num" style={{ display: "inline-block", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", padding: "4px 10px", borderRadius: 3, marginBottom: 20, color: item.live ? "var(--accent)" : "var(--text-3)", background: item.live ? "var(--accent-dim)" : "var(--surface)", border: `1px solid ${item.live ? "var(--accent-border)" : "var(--border-strong)"}` }}>{item.status}</span>
              <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.8 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- closing ---------- */}
      <div className="landing-section landing-closing" style={{ padding: "140px 48px", background: "var(--bg-2)", borderTop: "1px solid var(--border)", textAlign: "center" }}>
        <div className="landing-closing-text" style={{ fontFamily: "var(--font-serif)", fontSize: 60, fontWeight: 300, lineHeight: 1.1 }}>Private by default.</div>
        <div className="landing-closing-text" style={{ fontFamily: "var(--font-serif)", fontSize: 60, fontWeight: 300, color: "var(--text-3)", marginBottom: 44 }}>Auditable by choice.</div>
        <div style={{ display: "flex", gap: 14, justifyContent: "center" }}>
          <button className="btn btn-primary" style={{ padding: "16px 44px" }} onClick={onLaunch}>Try the app</button>
          <a href="https://www.npmjs.com/package/@suit-protocol/sdk" target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ padding: "16px 44px", textDecoration: "none" }}>npm install</a>
        </div>
      </div>

      {/* ---------- footer ---------- */}
      <footer className="landing-footer" style={{ padding: "32px 48px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 16, fontWeight: 700, letterSpacing: "0.28em", textTransform: "uppercase" }}>SUIT<span style={{ color: "var(--text-3)", fontWeight: 300 }}> Protocol</span></div>
        <div className="num" style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.15em" }}>Built on Stellar · @suit-protocol/sdk</div>
      </footer>
    </div>
  );
}
