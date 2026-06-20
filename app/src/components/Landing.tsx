import React from "react";

interface Props {
  onLaunch: () => void;
}

export default function Landing({ onLaunch }: Props) {
  return (
    <div style={{ background: "#000", fontFamily: "Inter, sans-serif", color: "#fff" }}>

      <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 48px", position: "fixed" as const, top: 0, left: 0, right: 0, zIndex: 100, background: "rgba(0,0,0,0.9)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 19, fontWeight: 700, letterSpacing: "0.28em", textTransform: "uppercase" as const, color: "#fff" }}>
          SUIT<span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 300 }}> Protocol</span>
        </div>
        <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
          {["How it works", "Why SUIT", "For business"].map(l => (
            <span key={l} style={{ fontSize: 10, letterSpacing: "0.18em", color: "rgba(255,255,255,0.42)", textTransform: "uppercase" as const, cursor: "pointer" }}>{l}</span>
          ))}
          <button onClick={onLaunch} style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "#000", background: "#fff", padding: "9px 24px", border: "none", cursor: "pointer", fontWeight: 500 }}>Launch app</button>
        </div>
      </nav>

      <div style={{ height: "100vh", position: "relative" as const, overflow: "hidden" }}>

        <div style={{ position: "absolute" as const, top: 0, right: 0, width: "58%", height: "100%", zIndex: 1 }}>
          <img
            src="/suit_hero.jpg"
            alt=""
            style={{
              position: "absolute" as const,
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover" as const,
              objectPosition: "50% 35%",
              display: "block",
              filter: "contrast(1.08) brightness(0.75)",
            }}
          />
          <div style={{ position: "absolute" as const, top: 0, left: 0, width: "55%", height: "100%", background: "linear-gradient(to right, #000 0%, transparent 100%)", zIndex: 2 }} />
          <div style={{ position: "absolute" as const, bottom: 0, left: 0, width: "100%", height: "30%", background: "linear-gradient(to bottom, transparent, #000)", zIndex: 2 }} />
        </div>

        <div style={{ position: "absolute" as const, top: 0, left: 0, width: "50%", height: "100%", zIndex: 10, display: "flex", flexDirection: "column" as const, justifyContent: "center", padding: "80px 0 0 48px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
            <div style={{ width: 32, height: 1, background: "rgba(255,255,255,0.25)" }} />
            <span style={{ fontSize: 9, letterSpacing: "0.3em", color: "rgba(255,255,255,0.38)", textTransform: "uppercase" as const }}>Zero-knowledge · Built on Stellar</span>
          </div>
          <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 76, fontWeight: 300, lineHeight: 1.02, marginBottom: 24, color: "#fff" }}>
            Your payments.<br />
            <em style={{ fontStyle: "italic", color: "rgba(255,255,255,0.35)" }}>Their</em> business?<br />
            <strong style={{ fontWeight: 700, color: "#fff" }}>Never.</strong>
          </div>
          <p style={{ fontSize: 11, letterSpacing: "0.14em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" as const, lineHeight: 2.2, marginBottom: 44 }}>
            Shielded commitments · Proven amounts<br />On-chain ZK verification · Non-custodial
          </p>
          <div style={{ display: "flex", gap: 14, marginBottom: 48 }}>
            <button onClick={onLaunch} style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase" as const, color: "#000", background: "#fff", border: "none", padding: "15px 40px", cursor: "pointer", fontWeight: 500 }}>Send privately</button>
            <button onClick={onLaunch} style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.5)", background: "transparent", border: "1px solid rgba(255,255,255,0.2)", padding: "15px 40px", cursor: "pointer" }}>Receive funds</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 460 }}>
            {["Range proof", "On-chain verify", "Shielded pool", "Unlinkable (roadmap)"].map((label, i) => (
              <React.Fragment key={label}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: i < 3 ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.18)", flexShrink: 0 }} />
                <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: i < 3 ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.2)", whiteSpace: "nowrap" as const }}>{label}</span>
                {i < 3 && <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", borderTop: "1px solid rgba(255,255,255,0.08)", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "#000" }}>
        {[{ num: "0", label: "Proven amount on-chain" }, { num: "1", label: "Live ZK system (Groth16)" }, { num: "BLS12-381", label: "Verified on testnet" }, { num: "100%", label: "Non-custodial" }].map((s, i) => (
          <div key={s.label} style={{ padding: "28px", borderRight: i < 3 ? "1px solid rgba(255,255,255,0.08)" : "none", textAlign: "center" as const }}>
            <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 32, fontWeight: 300, color: "#fff" }}>{s.num}</div>
            <div style={{ fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.28)", marginTop: 8 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: "120px 48px", background: "#000" }}>
        <div style={{ fontSize: 9, letterSpacing: "0.3em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase" as const, marginBottom: 16 }}>How it works</div>
        <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 48, fontWeight: 300, color: "#fff", marginBottom: 64 }}>Four steps to complete financial privacy.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: "rgba(255,255,255,0.07)" }}>
          {[
            { step: "01", title: "Enter amount", desc: "Your amount stays entirely on your device. Used as a private ZK input. Never touches the Stellar ledger." },
            { step: "02", title: "Proof generated in-browser", desc: "A Circom/Groth16 range proof (BLS12-381) is generated locally, proving the amount is within policy bounds without revealing it." },
            { step: "03", title: "Pool verifies on-chain", desc: "A commitment and the proof go to Stellar. The pool runs a real BLS12-381 pairing check before accepting the deposit — no valid proof, no deposit." },
            { step: "04", title: "Receiver withdraws", desc: "The receiver withdraws from the shared pool using a nullifier; double-spends are rejected on-chain. Full deposit↔withdrawal unlinkability is on the roadmap." },
          ].map(item => (
            <div key={item.step} style={{ background: "#0a0a0a", padding: "40px 32px" }}>
              <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 48, color: "rgba(255,255,255,0.08)", marginBottom: 24 }}>{item.step}</div>
              <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.7)", marginBottom: 14 }}>{item.title}</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.32)", lineHeight: 1.8 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "120px 48px", background: "#050505", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 9, letterSpacing: "0.3em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase" as const, marginBottom: 16 }}>Why we built SUIT</div>
        <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 48, fontWeight: 300, color: "#fff", marginBottom: 32 }}>Every transaction you make is being watched.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, maxWidth: 1100 }}>
          <div>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.38)", lineHeight: 1.9, marginBottom: 24 }}>Stellar is a public ledger. Every payment — amount, sender, receiver — is permanently visible to anyone who looks. Bots monitor transactions in real time and launch phishing attacks within minutes.</p>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.38)", lineHeight: 1.9 }}>SUIT changes that. We built the privacy layer Stellar needs — making privacy the default and auditability a choice you control.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 2 }}>
            {[
              { title: "For freelancers", desc: "Get paid without exposing your rates to every client and competitor on-chain." },
              { title: "For businesses", desc: "Run payroll without every employee seeing every colleague salary on the ledger." },
              { title: "For institutions", desc: "Settle at scale with the compliance trail regulators need — without the exposure." },
              { title: "For everyone", desc: "Financial privacy is a right. SUIT is the infrastructure that makes it real on Stellar." },
            ].map(item => (
              <div key={item.title} style={{ padding: "24px 28px", background: "rgba(255,255,255,0.03)", borderLeft: "2px solid rgba(255,255,255,0.12)" }}>
                <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.65)", marginBottom: 8 }}>{item.title}</div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.32)", lineHeight: 1.7 }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "120px 48px", background: "#000", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 9, letterSpacing: "0.3em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase" as const, marginBottom: 16 }}>The ZK stack</div>
        <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 48, fontWeight: 300, color: "#fff", marginBottom: 64 }}>One proof system, live. More on the roadmap.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "rgba(255,255,255,0.07)" }}>
          {[
            { tool: "Circom", role: "Range proof", status: "Live on testnet", desc: "Proves the payment amount is within policy bounds without revealing it. Groth16 proof verified inside a Soroban contract using Stellar's BLS12-381 pairing host functions." },
            { tool: "Noir", role: "KYC identity proof", status: "Roadmap", desc: "Would prove a sender holds a valid KYC credential without revealing identity. Circuit scaffolded in the repo; no verifier deployed yet." },
            { tool: "RISC Zero", role: "Compliance receipt", status: "Roadmap", desc: "Would prove full compliance logic ran in a zkVM, verifiable by an auditor on demand. Not included in this build." },
          ].map(item => (
            <div key={item.tool} style={{ background: "#0a0a0a", padding: "48px 36px" }}>
              <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 36, fontWeight: 600, color: "#fff", marginBottom: 8 }}>{item.tool}</div>
              <div style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.3)", marginBottom: 12 }}>{item.role}</div>
              <span style={{ display: "inline-block", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase" as const, padding: "3px 10px", borderRadius: 2, marginBottom: 20, color: item.status === "Live on testnet" ? "#4ade80" : "rgba(255,255,255,0.4)", background: item.status === "Live on testnet" ? "rgba(74,222,128,0.1)" : "rgba(255,255,255,0.05)", border: `1px solid ${item.status === "Live on testnet" ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.12)"}` }}>{item.status}</span>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.8 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "140px 48px", background: "#050505", borderTop: "1px solid rgba(255,255,255,0.06)", textAlign: "center" as const }}>
        <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 64, fontWeight: 300, color: "#fff", marginBottom: 8 }}>Private by default.</div>
        <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 64, fontWeight: 300, color: "rgba(255,255,255,0.3)", marginBottom: 48 }}>Auditable by choice.</div>
        <button onClick={onLaunch} style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase" as const, color: "#000", background: "#fff", border: "none", padding: "16px 48px", cursor: "pointer", fontWeight: 500 }}>Launch app</button>
      </div>

      <div style={{ padding: "32px 48px", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 16, fontWeight: 700, letterSpacing: "0.28em", textTransform: "uppercase" as const, color: "#fff" }}>SUIT<span style={{ color: "rgba(255,255,255,0.28)", fontWeight: 300 }}> Protocol</span></div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" as const, letterSpacing: "0.15em" }}>Built on Stellar · Stellar Hacks 2026</div>
      </div>

    </div>
  );
}
