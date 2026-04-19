// Tweaks panel — variation switcher + beam controls + accent picker.
// Implements the __edit_mode_available / __activate_edit_mode protocol.

function TweaksPanel({ state, setState, onClose }) {
  const variations = [
    { id: "A", name: "Ivory & Amber", sub: "Warm / editorial" },
    { id: "B", name: "Steel & Azure", sub: "Cool / operator" },
    { id: "C", name: "Obsidian Aurora", sub: "Iridescent beam" },
    { id: "D", name: "Graphite & Teal", sub: "Signature / aqua" },
  ];

  const accents = {
    A: [{ hue: 72, name: "Amber" }, { hue: 40, name: "Ember" }, { hue: 95, name: "Lime" }, { hue: 340, name: "Rose" }],
    B: [{ hue: 240, name: "Azure" }, { hue: 210, name: "Steel" }, { hue: 180, name: "Teal" }, { hue: 270, name: "Violet" }],
    C: [{ hue: 290, name: "Aurora" }, { hue: 200, name: "Glacier" }, { hue: 140, name: "Emerald" }, { hue: 20, name: "Sun" }],
    // D uses the locked brand color #00D8BB — swatch list is cosmetic only,
    // variation D's --rv-accent is hard-pinned to that hex regardless of hue.
    D: [{ hue: 180, name: "Teal" }, { hue: 172, name: "Aqua" }, { hue: 200, name: "Cyan" }, { hue: 160, name: "Mint" }],
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        width: 320,
        background: "rgba(18,16,13,0.92)",
        backdropFilter: "blur(20px)",
        border: "1px solid var(--rv-border)",
        borderRadius: 14,
        zIndex: 1000,
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        color: "var(--rv-text)",
        fontSize: 12.5,
      }}
    >
      <div style={{
        padding: "12px 16px",
        borderBottom: "1px solid var(--rv-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--rv-mono)", fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--rv-text-faint)" }}>
            Tweaks
          </span>
          <span style={{ fontSize: 11, color: "var(--rv-accent)" }}>● live</span>
        </div>
        <button onClick={onClose} style={{ all: "unset", cursor: "pointer", color: "var(--rv-text-faint)", fontSize: 18 }}>×</button>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Variation */}
        <div>
          <Label>Variation</Label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
            {variations.map((v) => (
              <button
                key={v.id}
                onClick={() => setState({ variation: v.id, accentHue: accents[v.id][0].hue })}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "10px 8px",
                  borderRadius: 8,
                  border: state.variation === v.id ? "1px solid var(--rv-accent)" : "1px solid var(--rv-border)",
                  background: state.variation === v.id ? "var(--rv-accent-soft)" : "transparent",
                  textAlign: "center",
                  lineHeight: 1.3,
                }}
              >
                <div style={{ fontSize: 11, fontFamily: "var(--rv-mono)", color: "var(--rv-accent)", letterSpacing: 0.5 }}>
                  VAR · {v.id}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--rv-text)", marginTop: 4 }}>{v.name}</div>
                <div style={{ fontSize: 9.5, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", marginTop: 2 }}>{v.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Accent hue */}
        <div>
          <Label>Accent color</Label>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {accents[state.variation].map((a) => (
              <button
                key={a.hue}
                onClick={() => setState({ accentHue: a.hue })}
                title={a.name}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: `oklch(0.78 0.16 ${a.hue})`,
                  border: state.accentHue === a.hue ? "2px solid var(--rv-text)" : "2px solid transparent",
                  boxShadow: state.accentHue === a.hue ? `0 0 14px oklch(0.78 0.16 ${a.hue} / 0.6)` : "none",
                  transition: "transform 100ms",
                }}
              />
            ))}
          </div>
        </div>

        {/* Beam enabled */}
        <div>
          <Row>
            <Label>Border beam</Label>
            <Switch value={state.beamEnabled} onChange={(v) => setState({ beamEnabled: v })} />
          </Row>
        </div>

        {/* Beam intensity */}
        <div style={{ opacity: state.beamEnabled ? 1 : 0.4, pointerEvents: state.beamEnabled ? "auto" : "none" }}>
          <Row>
            <Label>Intensity</Label>
            <span style={{ fontFamily: "var(--rv-mono)", fontSize: 11, color: "var(--rv-text-faint)" }}>
              {Math.round(state.beamIntensity * 100)}%
            </span>
          </Row>
          <input
            type="range"
            min="0.15" max="1" step="0.05"
            value={state.beamIntensity}
            onChange={(e) => setState({ beamIntensity: parseFloat(e.target.value) })}
            style={{ width: "100%", marginTop: 6, accentColor: "var(--rv-accent)" }}
          />
        </div>

        {/* Beam speed */}
        <div style={{ opacity: state.beamEnabled ? 1 : 0.4, pointerEvents: state.beamEnabled ? "auto" : "none" }}>
          <Row>
            <Label>Speed</Label>
            <span style={{ fontFamily: "var(--rv-mono)", fontSize: 11, color: "var(--rv-text-faint)" }}>
              {state.beamSpeed.toFixed(1)}s
            </span>
          </Row>
          <input
            type="range"
            min="2" max="16" step="0.5"
            value={state.beamSpeed}
            onChange={(e) => setState({ beamSpeed: parseFloat(e.target.value) })}
            style={{ width: "100%", marginTop: 6, accentColor: "var(--rv-accent)" }}
          />
        </div>

        {/* Beam scope */}
        <div style={{ opacity: state.beamEnabled ? 1 : 0.4, pointerEvents: state.beamEnabled ? "auto" : "none" }}>
          <Label>Where</Label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 8 }}>
            {["Input only", "+ Active", "Signature"].map((s, i) => (
              <button
                key={s}
                onClick={() => setState({ beamScope: i })}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "7px 6px",
                  borderRadius: 7,
                  border: state.beamScope === i ? "1px solid var(--rv-accent)" : "1px solid var(--rv-border)",
                  background: state.beamScope === i ? "var(--rv-accent-soft)" : "transparent",
                  textAlign: "center",
                  fontSize: 10.5,
                  color: "var(--rv-text)",
                  fontFamily: "var(--rv-mono)",
                  letterSpacing: 0.3,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const Label = ({ children }) => (
  <span style={{
    fontFamily: "var(--rv-mono)",
    fontSize: 10.5,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "var(--rv-text-dim)",
  }}>{children}</span>
);

const Row = ({ children }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>{children}</div>
);

function Switch({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        all: "unset",
        cursor: "pointer",
        width: 34,
        height: 20,
        borderRadius: 10,
        background: value ? "var(--rv-accent)" : "var(--rv-border)",
        position: "relative",
        transition: "background 160ms",
      }}
    >
      <span style={{
        position: "absolute",
        top: 2,
        left: value ? 16 : 2,
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: value ? "#1a1510" : "var(--rv-text-dim)",
        transition: "left 160ms",
      }} />
    </button>
  );
}

Object.assign(window, { TweaksPanel });
