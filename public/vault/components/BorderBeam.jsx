// BorderBeam — animated rotating conic gradient border.
// Props:
//   size        - radial "beam" length as % of element (default 40)
//   duration    - seconds per revolution (default 8)
//   intensity   - 0..1 opacity multiplier (default 1)
//   colorA / colorB - beam gradient stops
//   thickness   - border thickness in px (default 1.5)
//   radius      - border radius in px (default 14)
//   paused      - if true, animation is paused
//   glow        - if true, adds an outer soft bloom (default false)
//
// Implementation uses a pseudo-stacked layer: an outer rotating conic
// gradient is masked to only show its border by subtracting the inner fill.
// Works via a container with position:relative + two absolutely positioned
// layers. Rendered as a React component.

function BorderBeam({
  size = 40,
  duration = 8,
  intensity = 1,
  colorA = "rgba(255,255,255,0.95)",
  colorB = "rgba(255,255,255,0)",
  thickness = 1.5,
  radius = 14,
  paused = false,
  glow = false,
  reverse = false,
  delay = 0,
}) {
  const uid = React.useId().replace(/:/g, "");
  const animName = `beamSpin_${uid}`;
  const css = `
    @keyframes ${animName} {
      from { transform: rotate(${reverse ? 360 : 0}deg); }
      to   { transform: rotate(${reverse ? 0 : 360}deg); }
    }
  `;

  const outer = {
    position: "absolute",
    inset: 0,
    borderRadius: radius,
    pointerEvents: "none",
    overflow: "hidden",
    opacity: intensity,
  };

  // Rotating conic layer (square, oversized, centered)
  const spinner = {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "150%",
    aspectRatio: "1 / 1",
    transformOrigin: "center",
    translate: "-50% -50%",
    background: `conic-gradient(from 0deg, ${colorB} 0deg, ${colorB} ${
      360 - size
    }deg, ${colorA} ${360 - size / 2}deg, ${colorB} 360deg)`,
    animation: `${animName} ${duration}s linear infinite`,
    animationPlayState: paused ? "paused" : "running",
    animationDelay: `-${delay}s`,
    filter: glow ? "blur(0.5px)" : "none",
  };

  // Inner mask — covers the fill, so only the 1.5px border shows beam
  const innerMask = {
    position: "absolute",
    inset: thickness,
    borderRadius: Math.max(0, radius - thickness),
    background: "var(--beam-mask-bg, #0b0a08)",
  };

  return (
    <>
      <style>{css}</style>
      <div style={outer} aria-hidden="true">
        <div style={spinner} />
        <div style={innerMask} />
      </div>
      {glow && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: -8,
            borderRadius: radius + 8,
            pointerEvents: "none",
            opacity: intensity * 0.35,
            filter: "blur(14px)",
            background: `conic-gradient(from 0deg, ${colorB} 0deg, ${colorB} ${
              360 - size
            }deg, ${colorA} ${360 - size / 2}deg, ${colorB} 360deg)`,
            animation: `${animName} ${duration}s linear infinite`,
            animationPlayState: paused ? "paused" : "running",
            animationDelay: `-${delay}s`,
          }}
        />
      )}
    </>
  );
}

Object.assign(window, { BorderBeam });
