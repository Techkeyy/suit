import React from "react";

interface Props {
  onLaunch: () => void;
}

const POOL = "https://stellar.expert/explorer/testnet/contract/CAQ2CBPLAUGW5DY34V3TRB47OYX4NQTYGPYCHDXLU6PKWK3JAX6VCRN7";
const VERIFIER = "https://stellar.expert/explorer/testnet/contract/CA2W26LBXZ7FZWKKPW4NHTO52AUYWBAT47S2QMMDDEWORFG4RYQKAWIV";

const scrollTo = (id: string) => () =>
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

export default function Landing({ onLaunch }: Props) {
  const eyebrow: React.CSSProperties = { display: "block" };

  return (
    <div style={{ background: "var(--bg)", fontFamily: "var(--font-sans)", color: "var(--text-1)" }}>

      {/* ---------- nav ---------- */}
      <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: "var(--nav-h)", padding: "0 48px", position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, background: "rgba(11,11,14,0.82)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 19, fontWeight: 700, letterSpacing: "0.28em", textTransform: "uppercase" }}>
          SUIT<span style={{ color: "var(--text-3)", fontWeight: 300 }}> Protocol</span>
        </div>
        <div style={{ display: "flex", gap: 30, alignItems: "center" }}>
          <button className="navlink" onClick={scrollTo("how")}>How it works</button>
          <button className="navlink" onClick={scrollTo("why")}>Why SUIT</button>
          <button className="navlink" onClick={scrollTo("stack")}>ZK stack</button>
          <button className="btn btn-primary" onClick={onLaunch}>Launch app</button>
        </div>
      </nav>

      {/* ---------- hero ---------- */}
      <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden", display: "flex", alignItems: "center" }}>
        <div style={{ position: "absolute", top: 0, right: 0, width: "58%", height: "100%", zIndex: 1 }}>
          <img src="/suit_hero.jpg" alt="" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 35%", filter: "contrast(1.05) brightness(0.7) saturate(0.9)" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, var(--bg) 8%, transparent 70%)", zIndex: 2 }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "35%", background: "linear-gradient(to bottom, transparent, var(--bg))", zIndex: 2 }} />
        </div>

        <div style={{ position: "relative", zIndex: 10, width: "52%", padding: "var(--nav-h) 0 0 48px" }}>
          {/* live status — credibility, links to chain */}
          <a href={VERIFIER} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "6px 14px", borderRadius: 999, border: "1px solid var(--accent-border)", background: "var(--accent-dim)", marginBottom: 30, textDecoration: "none" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 10px var(--accent)" }} />
            <span className="num" style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)" }}>Live on Stellar testnet</span>
          </a>

          <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 74, fontWeight: 300, lineHeight: 1.04, marginBottom: 24 }}>
            Your payments.<br />
            <em style={{ fontStyle: "italic", color: "var(--text-3)" }}>Their</em> business?<br />
            <strong style={{ fontWeight: 700 }}>Never.</strong>
          </h1>

          <p style={{ fontSize: 16, color: "var(--text-2)", lineHeight: 1.7, maxWidth: 440, marginBottom: 40 }}>
            A shielded payment pool on Stellar where every deposit is gated by a
            real zero-knowledge proof — verified on-chain. The amount is proven
            valid without ever appearing on the ledger.
          </p>

          <div style={{ display: "flex", gap: 14, marginBottom: 52 }}>
            <button className="btn btn-primary" style={{ padding: "15px 36px" }} onClick={onLaunch}>Open the app</button>
            <button className="btn btn-ghost" style={{ padding: "15px 36px" }} onClick={scrollTo("how")}>See how it works</button>
          </div>

          {/* proof pipeline indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 520 }}>
            {[
              { label: "Range proof", live: true },
              { label: "On-chain verify", live: true },
              { label: "Shielded pool", live: true },
              { label: "Unlinkable", live: false },
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        {[
          { num: "0", label: "Proven amount on-chain", accent: false },
          { num: "1", label: "Live ZK system · Groth16", accent: true },
          { num: "BLS12-381", label: "Pairing curve", accent: false, small: true },
          { num: "100%", label: "Non-custodial", accent: false },
        ].map((s, i) => (
          <div key={s.label} style={{ padding: "34px 28px", borderRight: i < 3 ? "1px solid var(--border)" : "none", textAlign: "center" }}>
            <div className="num" style={{ fontSize: s.small ? 21 : 38, fontWeight: 600, color: s.accent ? "var(--accent)" : "var(--text-1)", whiteSpace: "nowrap" }}>{s.num}</div>
            <div className="eyebrow" style={{ marginTop: 10 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ---------- how it works ---------- */}
      <section id="how" style={{ padding: "120px 48px" }}>
        <span className="eyebrow" style={eyebrow}>How it works</span>
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 46, fontWeight: 300, margin: "16px 0 64px" }}>Four steps to a private, provable payment.</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: "var(--border)" }}>
          {[
            { step: "01", title: "Enter an amount", desc: "It is used only as a private input to the Circom circuit. It never appears on the Stellar ledger." },
            { step: "02", title: "Prove in your browser", desc: "A Circom/Groth16 proof over BLS12-381 is generated locally, proving the amount is within policy bounds — without revealing it." },
            { step: "03", title: "Pool verifies on-chain", desc: "The pool cross-calls the verifier; the BLS12-381 pairing check must pass before the deposit is accepted. No valid proof, no deposit." },
            { step: "04", title: "Receiver withdraws", desc: "The receiver withdraws from the pool with a nullifier; double-spends are rejected on-chain. Full unlinkability is on the roadmap." },
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
      <section id="why" style={{ padding: "120px 48px", background: "var(--bg-2)", borderTop: "1px solid var(--border)" }}>
        <span className="eyebrow" style={eyebrow}>Why we built SUIT</span>
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 46, fontWeight: 300, margin: "16px 0 32px", maxWidth: 760 }}>Every transaction you make is being watched.</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, maxWidth: 1100 }}>
          <div>
            <p style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.9, marginBottom: 22 }}>Stellar is a public ledger. Every payment — amount, sender, receiver — is permanently visible. Bots monitor transactions in real time and target users within minutes.</p>
            <p style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.9 }}>SUIT adds the privacy layer: amounts proven in zero-knowledge, balances held as commitments, compliance provable on demand — privacy by default, auditability by choice.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {[
              { title: "For freelancers", desc: "Get paid without exposing your rates to every client and competitor on-chain." },
              { title: "For businesses", desc: "Run payroll without every employee seeing every colleague's salary on the ledger." },
              { title: "For institutions", desc: "Settle at scale with the compliance trail regulators need — without the exposure." },
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
      <section id="stack" style={{ padding: "120px 48px", borderTop: "1px solid var(--border)" }}>
        <span className="eyebrow" style={eyebrow}>The ZK stack</span>
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 46, fontWeight: 300, margin: "16px 0 12px" }}>One proof system, live. More on the roadmap.</h2>
        <p style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 56, maxWidth: 560 }}>
          We chose depth over breadth: one system that genuinely verifies on Stellar, rather than several that only appear in a diagram.{" "}
          <a href={POOL} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>See it on-chain →</a>
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "var(--border)" }}>
          {[
            { tool: "Circom", role: "Range proof", status: "Live on testnet", live: true, desc: "Proves the payment amount is within policy bounds without revealing it. Groth16 proof verified inside a Soroban contract using Stellar's BLS12-381 pairing host functions." },
            { tool: "Noir", role: "KYC identity proof", status: "Roadmap", live: false, desc: "Would prove a sender holds a valid KYC credential without revealing identity. Circuit scaffolded in the repo; no verifier deployed yet." },
            { tool: "RISC Zero", role: "Compliance receipt", status: "Roadmap", live: false, desc: "Would prove full compliance logic ran in a zkVM, verifiable by an auditor on demand. Not included in this build." },
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
      <div style={{ padding: "140px 48px", background: "var(--bg-2)", borderTop: "1px solid var(--border)", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 60, fontWeight: 300, lineHeight: 1.1 }}>Private by default.</div>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 60, fontWeight: 300, color: "var(--text-3)", marginBottom: 44 }}>Auditable by choice.</div>
        <button className="btn btn-primary" style={{ padding: "16px 44px" }} onClick={onLaunch}>Launch app</button>
      </div>

      {/* ---------- footer ---------- */}
      <footer style={{ padding: "32px 48px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 16, fontWeight: 700, letterSpacing: "0.28em", textTransform: "uppercase" }}>SUIT<span style={{ color: "var(--text-3)", fontWeight: 300 }}> Protocol</span></div>
        <div className="num" style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.15em" }}>Built on Stellar · Stellar Hacks 2026</div>
      </footer>
    </div>
  );
}
