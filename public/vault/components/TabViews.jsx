// TabViews.jsx — functional, standalone implementations of every non-chat tab.
// Everything hits the site's real endpoints; empty states render when there's
// nothing to show. Nothing here punts to /app or another theme — each tab is
// self-contained.

/* ============ SHARED CHROME ============ */

function PageHeader({ title, subtitle, meta, actions, search }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "14px 28px",
      borderBottom: "1px solid var(--rv-border)",
      minHeight: 62,
      background: "var(--rv-chat-header-bg)",
      backdropFilter: "blur(12px)",
    }}>
      <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
          <h1 style={{
            margin: 0, fontSize: 16, fontWeight: 600,
            color: "var(--rv-text)", letterSpacing: 0.1,
            whiteSpace: "nowrap", flexShrink: 0,
          }}>{title}</h1>
          {meta && <span style={{
            fontFamily: "var(--rv-mono)", fontSize: 10.5,
            color: "var(--rv-text-faint)", letterSpacing: 0.4,
            textTransform: "uppercase",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            minWidth: 0,
          }}>· {meta}</span>}
        </div>
        {subtitle && <div style={{
          fontSize: 12, color: "var(--rv-text-dim)", marginTop: 3,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{subtitle}</div>}
      </div>
      {actions && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </div>
  );
}

const pgBtn = {
  all: "unset", cursor: "pointer",
  height: 32, padding: "0 12px",
  borderRadius: 8, fontSize: 12.5,
  display: "inline-flex", alignItems: "center", gap: 6,
  color: "var(--rv-text)",
  background: "var(--rv-input-bg)",
  border: "1px solid var(--rv-input-border)",
  whiteSpace: "nowrap",
  flexShrink: 0,
};
const pgBtnPrimary = {
  ...pgBtn,
  background: "var(--rv-accent)",
  color: "#1a1510",
  border: "1px solid var(--rv-accent)",
  fontWeight: 500,
};

function PageBody({ children, pad = true }) {
  return (
    <div className="rv-scroll" style={{
      flex: 1, minHeight: 0, overflowY: "auto",
      WebkitOverflowScrolling: "touch",
      padding: pad ? "22px 28px 40px" : 0,
    }}>{children}</div>
  );
}

function Section({ title, meta, children, right }) {
  return (
    <section style={{ marginBottom: 28 }}>
      {(title || right) && (
        <div style={{
          display: "flex", alignItems: "baseline", gap: 10,
          marginBottom: 12, paddingBottom: 8,
          borderBottom: "1px solid var(--rv-border)",
        }}>
          {title && <h2 style={{
            margin: 0, fontSize: 11, letterSpacing: 1.2,
            color: "var(--rv-text-faint)",
            fontFamily: "var(--rv-mono)", textTransform: "uppercase",
          }}>{title}</h2>}
          {meta && <span style={{
            fontFamily: "var(--rv-mono)", fontSize: 10.5,
            color: "var(--rv-text-faint)",
          }}>· {meta}</span>}
          <div style={{ flex: 1 }} />
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

function Card({ children, padding = 16, onClick, hoverable = true, style }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--rv-card-bg)",
        border: "1px solid var(--rv-border)",
        borderRadius: 12,
        padding,
        cursor: onClick ? "pointer" : "default",
        transition: "border-color 160ms, background 160ms",
        ...style,
      }}
      onMouseOver={(e) => { if (hoverable) e.currentTarget.style.borderColor = "var(--rv-accent-line)"; }}
      onMouseOut={(e) => { if (hoverable) e.currentTarget.style.borderColor = "var(--rv-border)"; }}
    >
      {children}
    </div>
  );
}

function Tag({ children, tone = "neutral" }) {
  const tones = {
    neutral: { bg: "var(--rv-badge-bg)", color: "var(--rv-text-dim)", border: "var(--rv-border)" },
    accent: { bg: "var(--rv-accent-soft)", color: "var(--rv-accent)", border: "var(--rv-accent-line)" },
    ok: { bg: "oklch(0.80 0.14 150 / 0.15)", color: "oklch(0.80 0.14 150)", border: "oklch(0.80 0.14 150 / 0.35)" },
    warn: { bg: "oklch(0.78 0.16 60 / 0.18)", color: "oklch(0.85 0.15 60)", border: "oklch(0.78 0.16 60 / 0.40)" },
    alert: { bg: "oklch(0.60 0.20 25 / 0.15)", color: "oklch(0.75 0.18 30)", border: "oklch(0.60 0.20 25 / 0.35)" },
  };
  const t = tones[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 999,
      fontFamily: "var(--rv-mono)", fontSize: 10, letterSpacing: 0.4,
      background: t.bg, color: t.color, border: `1px solid ${t.border}`,
      whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function Empty({ icon: Ico = IconSearch, title, subtitle, action }) {
  return (
    <div style={{
      textAlign: "center", padding: "60px 20px",
      color: "var(--rv-text-faint)",
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: "var(--rv-input-bg)", border: "1px solid var(--rv-border)",
        display: "grid", placeItems: "center", margin: "0 auto 12px",
        color: "var(--rv-text-dim)",
      }}><Ico size={20} /></div>
      <div style={{ fontSize: 14, color: "var(--rv-text)", marginBottom: 4 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, lineHeight: 1.5 }}>{subtitle}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      padding: "48px 0", textAlign: "center",
      fontFamily: "var(--rv-mono)", fontSize: 11,
      letterSpacing: 1.2, color: "var(--rv-text-faint)",
      textTransform: "uppercase",
    }}>Loading…</div>
  );
}

function useApi(url, deps = []) {
  const [state, setState] = React.useState({ data: null, loading: true, error: null, status: null });
  const [nonce, setNonce] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, error: null, status: null });
    fetch(url, { credentials: "same-origin" })
      .then(async r => {
        if (!r.ok) {
          if (!cancelled) setState({ data: null, loading: false, error: `HTTP ${r.status}`, status: r.status });
          return;
        }
        const data = await r.json();
        if (!cancelled) setState({ data, loading: false, error: null, status: r.status });
      })
      .catch(err => { if (!cancelled) setState({ data: null, loading: false, error: err.message, status: null }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, nonce, ...deps]);
  return { ...state, reload: () => setNonce(n => n + 1) };
}

function TextInput({ value, onChange, placeholder, type = "text", autoFocus, onEnter, style }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }}
      placeholder={placeholder}
      autoFocus={autoFocus}
      style={{
        padding: "8px 12px", borderRadius: 8,
        background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)",
        color: "var(--rv-text)", fontSize: 13, fontFamily: "inherit", outline: "none",
        width: "100%", boxSizing: "border-box",
        ...style,
      }}
    />
  );
}

/* ============ BRIEFING — situation-room layout inspired by /app ============ */
const SR_KICKERS = {
  intel:    "INTEL REPORT",
  schedule: "DAY PLAN",
  money:    "LEDGER",
  watch:    "WATCH",
  action:   "ACTIONS",
  memo:     "MEMO",
};
const SR_ICONS = { intel: IconSearch, schedule: IconCalendar, money: IconMoney, watch: IconBolt, action: IconCheck, memo: IconDoc };
function classifyChapter(title) {
  const t = (title || "").toLowerCase();
  if (/(intel|overview|summary|world|news|pulse|situation|nudge)/.test(t)) return "intel";
  if (/(schedule|agenda|calendar|today|plan|day ahead|itiner)/.test(t)) return "schedule";
  if (/(money|finance|spend|budget|cash|account|transaction|ledger|balance)/.test(t)) return "money";
  if (/(watch|flag|note|signal|trend)/.test(t)) return "watch";
  if (/(action|todo|to-do|to do|do today|priority|task)/.test(t)) return "action";
  return "memo";
}
// Parse briefing markdown (same format as /app). Splits on H1 / H2, matches the
// classic renderBriefingChapters() algorithm. Content before the first heading
// becomes the greeting (line 1) + standfirst (line 2) of the masthead.
function parseBriefing(raw) {
  if (!raw) return { greeting: "", standfirst: "", chapters: [], topics: [] };
  const html = (typeof window !== "undefined" && window.marked)
    ? window.marked.parse(raw, { breaks: true })
    : escapeForHtml(raw);
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const nodes = Array.from(tmp.childNodes);
  const chapters = [];
  const preambleNodes = [];
  let current = null;
  for (const node of nodes) {
    const isHeading = node.nodeType === 1 && (node.tagName === "H1" || node.tagName === "H2");
    if (isHeading) {
      if (current) chapters.push(current);
      current = { title: node.textContent.trim(), nodes: [] };
    } else if (current) {
      current.nodes.push(node);
    } else {
      preambleNodes.push(node);
    }
  }
  if (current) chapters.push(current);

  // Pull greeting + standfirst out of the preamble (its first two paragraphs).
  let greeting = "", standfirst = "";
  const leftover = [];
  for (const n of preambleNodes) {
    if (n.nodeType === 1 && n.tagName === "P") {
      const t = n.textContent.trim();
      if (!greeting) { greeting = t; continue; }
      if (!standfirst) { standfirst = t; continue; }
      leftover.push(n);
    } else if (n.nodeType === 1) {
      leftover.push(n);
    }
  }

  // Anything left from the preamble joins as an opening "Briefing" memo
  // (matches /app's behaviour).
  if (leftover.length) {
    chapters.unshift({ title: "Briefing", nodes: leftover });
  }

  // Drop chapters with no body
  const kept = chapters.filter(c => c.nodes.some(n => (n.textContent || "").trim().length > 0));

  // Serialise each chapter's nodes back to HTML so React can render via dangerouslySetInnerHTML
  const withHtml = kept.map(c => {
    const wrap = document.createElement("div");
    c.nodes.forEach(n => wrap.appendChild(n.cloneNode(true)));
    return { title: c.title, html: wrap.innerHTML };
  });

  // Extract the top 3 headline topics — first three list items found across
  // all chapters. These populate the structured header cards above the body.
  const topics = [];
  for (const ch of kept) {
    if (topics.length >= 3) break;
    for (const n of ch.nodes) {
      if (topics.length >= 3) break;
      if (n.nodeType === 1 && (n.tagName === "UL" || n.tagName === "OL")) {
        for (const li of Array.from(n.querySelectorAll(":scope > li"))) {
          if (topics.length >= 3) break;
          const text = (li.textContent || "").trim();
          if (text) topics.push({ text, kind: classifyChapter(ch.title) });
        }
      }
    }
  }

  return { greeting, standfirst, chapters: withHtml, topics };
}

function escapeForHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtDateLong(dStr) {
  const [yy, mm, dd] = String(dStr).split("-").map(Number);
  if (!yy) return dStr;
  return new Date(yy, (mm || 1) - 1, dd || 1).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}
function fmtDayStrip(dStr) {
  const [yy, mm, dd] = String(dStr).split("-").map(Number);
  if (!yy) return { weekday: "", day: dStr };
  const d = new Date(yy, (mm || 1) - 1, dd || 1);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase(),
    day: String(d.getDate()),
  };
}

function BriefingView() {
  const [date, setDate] = React.useState(null);
  const url = date ? `/api/briefings/today?date=${encodeURIComponent(date)}` : "/api/briefings/today";
  const { data, loading, error, reload } = useApi(url, [date]);
  const { data: datesData } = useApi("/api/briefings/dates");
  const dates = Array.isArray(datesData?.dates) ? datesData.dates : [];
  const found = data && data.found !== false && (data.content || data.html || data.summary);

  // Mark as read when viewing
  React.useEffect(() => {
    if (found && !data.isRead) {
      fetch("/api/briefings/read", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: data.date }),
      }).catch(() => {});
    }
  }, [found, data]);

  const now = new Date();
  const timeStr = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const parsed = React.useMemo(
    () => (found ? parseBriefing(data.content || data.summary || "") : null),
    [found, data]
  );
  const activeDate = date || (dates[0] || null) || (data?.date || null);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader title="Daily Briefing" actions={<button style={pgBtn} onClick={reload}>Reload</button>} />
      <PageBody>
        {loading ? <Spinner /> : (
          <div style={{
            maxWidth: 920, margin: "0 auto", width: "100%",
            display: "flex", flexDirection: "column", gap: 22,
          }}>
            {/* Masthead */}
            <div style={{ paddingTop: 4, position: "relative" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                fontFamily: "var(--rv-mono)", fontSize: 10.5,
                letterSpacing: 2.5, color: "var(--rv-text-faint)",
                textTransform: "uppercase", marginBottom: 16,
              }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "3px 9px", border: "1px solid var(--rv-border)",
                  borderRadius: 3, color: "var(--rv-text)",
                  background: "var(--rv-input-bg)", fontWeight: 700, letterSpacing: 3,
                }}>
                  <span className="rv-sr-dot" />
                  DAILY BRIEFING
                </span>
                <span style={{ width: 28, height: 1, background: "var(--rv-border)" }} />
                <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{timeStr}</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span style={{ whiteSpace: "nowrap" }}>{fmtDateLong(activeDate || new Date().toISOString().slice(0, 10))}</span>
              </div>
              <h1 style={{
                margin: "0 0 10px", fontWeight: 700,
                fontSize: "clamp(2rem, 3.2vw, 2.6rem)",
                lineHeight: 1.05, letterSpacing: -0.2,
                color: "var(--rv-text)",
                fontFamily: "'Cormorant Garamond', Georgia, serif",
                animation: "srRise 0.5s cubic-bezier(.2,.8,.2,1) both",
              }}>
                {parsed?.greeting || "Good morning."}
              </h1>
              {parsed?.standfirst && (
                <p style={{
                  margin: 0, fontSize: 15, lineHeight: 1.55, maxWidth: "62ch",
                  color: "var(--rv-text-dim)",
                  animation: "srRise 0.55s 0.08s cubic-bezier(.2,.8,.2,1) both",
                }}>{parsed.standfirst}</p>
              )}

              {/* Day spine — horizontal scrollable day cards */}
              {dates.length > 0 && (
                <div style={{
                  display: "flex", gap: 4, marginTop: 24,
                  overflowX: "auto", padding: "2px 0",
                  animation: "srRise 0.55s 0.16s cubic-bezier(.2,.8,.2,1) both",
                  scrollbarWidth: "none",
                }}>
                  {dates.slice(0, 30).map(d => {
                    const active = (activeDate) === d;
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const isToday = d === todayStr;
                    const { weekday, day } = fmtDayStrip(d);
                    return (
                      <button key={d} onClick={() => setDate(d)} style={{
                        all: "unset", cursor: "pointer", flex: "0 0 auto",
                        width: 50, minHeight: 60,
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        gap: 4, padding: "8px 4px 7px",
                        border: `1px solid ${active ? "var(--rv-accent)" : "var(--rv-border)"}`,
                        borderRadius: 6,
                        background: active ? "linear-gradient(180deg, var(--rv-accent-soft), transparent)"
                          : isToday ? "var(--rv-accent-soft)" : "transparent",
                        boxShadow: active ? "0 0 0 1px var(--rv-accent), 0 8px 24px -10px var(--rv-accent-glow)" : "none",
                        transform: active ? "translateY(-1px)" : "none",
                        color: "var(--rv-text-dim)",
                        fontFamily: "var(--rv-mono)",
                        transition: "all 180ms cubic-bezier(.2,.8,.2,1)",
                      }}>
                        <span style={{
                          fontSize: 9, letterSpacing: 2, opacity: 0.75,
                          color: active ? "var(--rv-accent)" : "var(--rv-text-faint)",
                          textTransform: "uppercase",
                        }}>{weekday}</span>
                        <span style={{
                          fontSize: 16, fontWeight: 700, lineHeight: 1,
                          color: active || isToday ? "var(--rv-text)" : "var(--rv-text-dim)",
                          fontVariantNumeric: "tabular-nums",
                        }}>{day}</span>
                        <span style={{
                          width: 4, height: 4, borderRadius: "50%",
                          background: active ? "var(--rv-accent)" : "var(--rv-text-faint)",
                          opacity: 0.8,
                        }} />
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{
                position: "absolute", left: 0, right: 0, bottom: -12,
                height: 1,
                background: "linear-gradient(90deg, transparent 0%, var(--rv-border) 8%, var(--rv-border) 92%, transparent 100%)",
              }} />
            </div>

            {/* Top 3 Topics — structured scannable summary above the chapters */}
            {found && parsed?.topics?.length > 0 && (
              <BriefingTopTopics topics={parsed.topics} />
            )}

            {/* Chapters */}
            {error || !found || !parsed?.chapters?.length ? (
              <div style={{
                padding: "60px 20px", textAlign: "center",
                color: "var(--rv-text-faint)",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
              }}>
                <svg viewBox="0 0 120 120" style={{ width: 88, height: 88, color: "var(--rv-accent)", opacity: 0.55 }}>
                  <circle cx="60" cy="60" r="58" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.25"/>
                  <circle cx="60" cy="60" r="48" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.35"/>
                  <circle cx="60" cy="60" r="38" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.5"/>
                  <circle cx="60" cy="60" r="3" fill="currentColor"/>
                </svg>
                <div style={{ fontSize: 15, color: "var(--rv-text)" }}>No briefing for this date</div>
                <div style={{ fontSize: 12.5, color: "var(--rv-text-faint)" }}>
                  Your daily briefing is prepared each morning and delivered here automatically.
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {parsed.chapters.map((ch, idx) => <BriefingChapter key={idx} chapter={ch} idx={idx} />)}
              </div>
            )}

            {found && (
              <div style={{
                display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
                padding: "16px 18px",
                border: "1px solid var(--rv-border)",
                borderRadius: 10,
                background: "var(--rv-card-bg)",
              }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{
                    fontFamily: "var(--rv-mono)", fontSize: 9.5, letterSpacing: 2,
                    color: "var(--rv-text-faint)", textTransform: "uppercase",
                  }}>Filed</span>
                  <span style={{
                    fontFamily: "var(--rv-mono)", fontSize: 12, color: "var(--rv-text-dim)",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : activeDate}
                  </span>
                </div>
                <div style={{ flex: 1 }} />
                {data.isRead ? (
                  <span style={{ fontFamily: "var(--rv-mono)", fontSize: 11, color: "oklch(0.80 0.14 150)" }}>✓ Read</span>
                ) : (
                  <span style={{ fontFamily: "var(--rv-mono)", fontSize: 11, color: "var(--rv-accent)" }}>● New</span>
                )}
              </div>
            )}
          </div>
        )}
      </PageBody>
    </div>
  );
}

// Top 3 headline topics — a structured scannable summary card rendered above
// the full chapters. Matches the Original Release's 3-topic top layout.
function BriefingTopTopics({ topics }) {
  return (
    <div
      className="rv-sr-topics"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 10,
        padding: "2px 0",
      }}
    >
      {topics.slice(0, 3).map((t, i) => {
        const kind = t.kind || "memo";
        const accent = `var(--rv-accent)`;
        return (
          <article
            key={i}
            style={{
              position: "relative",
              padding: "14px 14px 14px 18px",
              background: "var(--rv-card-bg)",
              border: "1px solid var(--rv-border)",
              borderRadius: 12,
              display: "flex", flexDirection: "column", gap: 8,
              minHeight: 96,
              animation: "srRise 0.55s cubic-bezier(.2,.8,.2,1) both",
              animationDelay: `${0.08 + i * 0.07}s`,
            }}
          >
            <span
              aria-hidden
              style={{
                position: "absolute", left: 0, top: 14, bottom: 14, width: 3,
                borderRadius: 3,
                background: accent,
                boxShadow: `0 0 14px var(--rv-accent-glow)`,
                opacity: 0.8,
              }}
            />
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              fontFamily: "var(--rv-mono)", fontSize: 9.5,
              letterSpacing: 2, textTransform: "uppercase",
              color: accent, opacity: 0.9,
            }}>
              <span style={{
                padding: "2px 6px",
                border: "1px solid var(--rv-accent-line)",
                borderRadius: 3,
                background: "var(--rv-accent-soft)",
                lineHeight: 1, letterSpacing: 1.5,
              }}>№ {String(i + 1).padStart(2, "0")}</span>
              <span>{SR_KICKERS[kind] || "MEMO"}</span>
            </div>
            <div style={{
              fontSize: 13.5, lineHeight: 1.5,
              color: "var(--rv-text)",
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}>{t.text}</div>
          </article>
        );
      })}
    </div>
  );
}

function BriefingChapter({ chapter, idx }) {
  const kind = classifyChapter(chapter.title);
  const Ico = SR_ICONS[kind] || SR_ICONS.memo;
  // `memo` is the generic kind — it inherits the active theme's accent so the
  // briefing re-colors as the user switches themes. The named kinds keep
  // category-specific hues (intel=blue, schedule=green, etc.) for semantic
  // clarity across themes.
  const isMemo = kind === "memo";
  const accentHues = { intel: 200, schedule: 140, money: 150, watch: 50, action: 280 };
  const accent = isMemo
    ? "var(--rv-accent)"
    : `oklch(0.82 0.16 ${accentHues[kind] || 72})`;
  const accentSoft = isMemo
    ? "var(--rv-accent-soft)"
    : `oklch(0.82 0.16 ${accentHues[kind] || 72} / 0.14)`;
  const accentLine = isMemo
    ? "var(--rv-accent-line)"
    : `oklch(0.82 0.16 ${accentHues[kind] || 72} / 0.35)`;
  const accentGlow = isMemo
    ? "var(--rv-accent-glow)"
    : `oklch(0.82 0.16 ${accentHues[kind] || 72} / 0.4)`;
  return (
    <article
      className="rv-sr-chapter rv-sr-body-wrap"
      style={{
        position: "relative",
        background: "var(--rv-card-bg)",
        border: "1px solid var(--rv-border)",
        borderRadius: 14,
        padding: "22px 26px 24px 30px",
        transition: "border-color 0.2s, transform 0.2s",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute", left: 0, top: 18, bottom: 18, width: 3,
          borderRadius: 3,
          background: accent,
          boxShadow: `0 0 16px ${accentGlow}`,
          opacity: 0.85,
        }}
      />
      <header style={{
        display: "flex", alignItems: "center", gap: 12,
        marginBottom: 14, paddingBottom: 12,
        borderBottom: "1px solid var(--rv-border)",
      }}>
        <span style={{
          width: 34, height: 34, borderRadius: 8,
          display: "inline-grid", placeItems: "center",
          background: accentSoft, color: accent,
          border: `1px solid ${accentLine}`,
          flexShrink: 0,
        }}>
          <Ico size={17} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontFamily: "var(--rv-mono)", fontSize: 9.5,
            letterSpacing: 2.5, textTransform: "uppercase",
            color: accent, opacity: 0.9, lineHeight: 1, marginBottom: 5,
          }}>{SR_KICKERS[kind] || "MEMO"}</div>
          <div style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 19, fontWeight: 700, color: "var(--rv-text)",
            lineHeight: 1.2,
          }}>{chapter.title}</div>
        </div>
        <span style={{
          marginLeft: "auto",
          fontFamily: "var(--rv-mono)", fontSize: 10.5,
          color: "var(--rv-text-faint)", letterSpacing: 1.5,
          fontVariantNumeric: "tabular-nums",
          padding: "4px 8px",
          border: "1px solid var(--rv-border)", borderRadius: 4,
        }}>№ {String(idx + 1).padStart(2, "0")}</span>
      </header>
      <div
        className="rv-sr-body"
        style={{
          fontSize: 14.5, lineHeight: 1.65, color: "var(--rv-text)",
        }}
        dangerouslySetInnerHTML={{ __html: chapter.html || "" }}
      />
    </article>
  );
}

function BriefingPreferences({ onClose }) {
  const { data, loading, reload } = useApi("/api/briefings/preferences");
  const prefs = Array.isArray(data?.preferences) ? data.preferences : [];
  const [newPref, setNewPref] = React.useState("");
  const add = async () => {
    if (!newPref.trim()) return;
    await fetch("/api/briefings/preferences", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule_text: newPref.trim() }),
    });
    setNewPref("");
    reload();
  };
  const del = async (id) => {
    await fetch(`/api/briefings/preferences/${id}`, { method: "DELETE", credentials: "same-origin" });
    reload();
  };
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "oklch(0.08 0.01 60 / 0.72)",
      display: "grid", placeItems: "center", padding: 20,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        maxWidth: 520, width: "100%", maxHeight: "80vh", overflowY: "auto",
        background: "var(--rv-sidebar-bg)",
        border: "1px solid var(--rv-border)",
        borderRadius: 16, padding: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: "var(--rv-text)" }}>Briefing preferences</h2>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ all: "unset", cursor: "pointer", color: "var(--rv-text-faint)", fontSize: 18 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--rv-text-dim)", marginBottom: 14 }}>
          Nudge tomorrow's briefing with your own preferences.
        </div>
        {loading ? <Spinner /> : (
          <>
            <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
              {prefs.length === 0 && <div style={{ fontSize: 12, color: "var(--rv-text-faint)" }}>No preferences yet.</div>}
              {prefs.map(p => (
                <div key={p.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", borderRadius: 8,
                  background: "var(--rv-input-bg)", border: "1px solid var(--rv-border)",
                }}>
                  <span style={{ flex: 1, fontSize: 13, color: "var(--rv-text)" }}>{p.rule_text || p.text}</span>
                  <button onClick={() => del(p.id)} style={{ all: "unset", cursor: "pointer", color: "var(--rv-text-faint)" }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <TextInput value={newPref} onChange={setNewPref} placeholder="Add a preference…" onEnter={add} style={{ flex: 1 }} />
              <button style={pgBtnPrimary} onClick={add}>Add</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ============ NOTES ============ */
function NotesView() {
  const { data, loading, error, reload } = useApi("/api/notes");
  // Shape: { mine: [note], shared: [note] } — each note: { id, title, content, type: 'note'|'todo', todos, pinned, updatedAt, createdAt }
  const all = React.useMemo(() => {
    if (!data) return { notes: [], todos: [] };
    const combined = [...(data.mine || []), ...(data.shared || [])];
    return {
      notes: combined.filter(n => n.type !== "todo"),
      todos: combined.filter(n => n.type === "todo"),
    };
  }, [data]);
  const [selectedId, setSelectedId] = React.useState(null);
  React.useEffect(() => {
    if (all.notes.length && !selectedId) setSelectedId(all.notes[0].id);
  }, [all.notes, selectedId]);
  const selected = all.notes.find(n => n.id === selectedId) || all.notes[0];

  const createNote = async () => {
    const title = await window.rvPrompt("Give your note a title.", "", { title: "New note", placeholder: "Note title", primaryLabel: "Create" });
    if (!title) return;
    await fetch("/api/notes", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content: "", type: "note" }),
    });
    reload();
  };
  const createTodo = async () => {
    const title = await window.rvPrompt("What's the todo?", "", { title: "New todo", placeholder: "Todo text", primaryLabel: "Create" });
    if (!title) return;
    await fetch("/api/notes", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content: "", type: "todo" }),
    });
    reload();
  };
  const toggleTodo = async (todo) => {
    await fetch(`/api/notes/${todo.id}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: !todo.completed }),
    });
    reload();
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader
        title="Notes & Todos"
        actions={<>
          <button style={pgBtn} onClick={createTodo}><IconPlus size={12} /> Todo</button>
          <button style={pgBtnPrimary} onClick={createNote}><IconPlus size={12} /> Note</button>
        </>}
      />
      {loading ? <PageBody><Spinner /></PageBody>
        : error ? <PageBody><Empty title="Couldn't load notes" subtitle={error} /></PageBody>
        : (all.notes.length === 0 && all.todos.length === 0)
          ? <PageBody><Empty title="No notes yet" subtitle="Create your first note to get started." /></PageBody>
          : (
            <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
              {/* Todos column */}
              <div style={{ width: 300, borderRight: "1px solid var(--rv-border)", display: "flex", flexDirection: "column" }}>
                <div style={{
                  padding: "14px 18px 8px", fontFamily: "var(--rv-mono)",
                  fontSize: 10, letterSpacing: 1.2, color: "var(--rv-text-faint)",
                  textTransform: "uppercase",
                }}>Todos · {all.todos.length}</div>
                <div className="rv-scroll" style={{ flex: 1, overflowY: "auto", padding: "0 10px 20px" }}>
                  {all.todos.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "var(--rv-text-faint)" }}>No todos.</div>}
                  {all.todos.map((t) => (
                    <button key={t.id} onClick={() => toggleTodo(t)} style={{
                      all: "unset", cursor: "pointer", display: "flex",
                      alignItems: "flex-start", gap: 10, padding: "10px 10px",
                      borderRadius: 8, width: "100%", boxSizing: "border-box",
                      opacity: t.completed ? 0.5 : 1,
                    }}>
                      <span style={{
                        width: 16, height: 16, borderRadius: 5,
                        border: `1.5px solid ${t.completed ? "var(--rv-accent)" : "var(--rv-border)"}`,
                        background: t.completed ? "var(--rv-accent)" : "transparent",
                        marginTop: 1, flexShrink: 0,
                        display: "grid", placeItems: "center",
                        color: "#1a1510", fontSize: 10,
                      }}>{t.completed && "✓"}</span>
                      <span style={{
                        fontSize: 13, color: "var(--rv-text)", lineHeight: 1.4, flex: 1,
                        textDecoration: t.completed ? "line-through" : "none",
                      }}>{t.title || t.content || ""}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes list */}
              <div style={{ width: 280, borderRight: "1px solid var(--rv-border)", display: "flex", flexDirection: "column" }}>
                <div style={{
                  padding: "14px 18px 8px", fontFamily: "var(--rv-mono)",
                  fontSize: 10, letterSpacing: 1.2, color: "var(--rv-text-faint)",
                  textTransform: "uppercase",
                }}>Notes · {all.notes.length}</div>
                <div className="rv-scroll" style={{ flex: 1, overflowY: "auto" }}>
                  {all.notes.map((n) => (
                    <button key={n.id} onClick={() => setSelectedId(n.id)} style={{
                      all: "unset", cursor: "pointer", display: "block",
                      width: "100%", boxSizing: "border-box", padding: "12px 18px",
                      borderLeft: selectedId === n.id ? "2px solid var(--rv-accent)" : "2px solid transparent",
                      background: selectedId === n.id ? "var(--rv-active)" : "transparent",
                    }}>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 6, marginBottom: 3,
                      }}>
                        {n.pinned && <span style={{ color: "var(--rv-accent)", fontSize: 10 }}>📌</span>}
                        <div style={{ fontSize: 13, color: "var(--rv-text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title || "Untitled"}</div>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--rv-text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {(n.content || "").slice(0, 80)}
                      </div>
                      {n.updatedAt && <div style={{ fontFamily: "var(--rv-mono)", fontSize: 9.5, color: "var(--rv-text-faint)", marginTop: 4 }}>{new Date(n.updatedAt).toLocaleDateString()}</div>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Editor */}
              <div className="rv-scroll" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "28px 40px" }}>
                {selected ? (
                  <NoteEditor key={selected.id} note={selected} onSaved={reload} />
                ) : <Empty title="Select a note" />}
              </div>
            </div>
          )
      }
    </div>
  );
}

function NoteEditor({ note, onSaved }) {
  const [title, setTitle] = React.useState(note.title || "");
  const [content, setContent] = React.useState(note.content || "");
  const dirty = title !== (note.title || "") || content !== (note.content || "");
  const save = async () => {
    await fetch(`/api/notes/${note.id}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });
    onSaved && onSaved();
  };
  const remove = async () => {
    const ok = await window.rvConfirm("Delete this note? This can't be undone.", { title: "Delete note", primaryLabel: "Delete", danger: true });
    if (!ok) return;
    await fetch(`/api/notes/${note.id}`, { method: "DELETE", credentials: "same-origin" });
    onSaved && onSaved();
  };
  const togglePin = async () => {
    await fetch(`/api/notes/${note.id}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !note.pinned }),
    });
    onSaved && onSaved();
  };
  const toggleShare = async () => {
    await fetch(`/api/notes/${note.id}/share`, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shared: !(note.sharedWith && note.sharedWith.length) }),
    });
    onSaved && onSaved();
  };
  const shared = Array.isArray(note.sharedWith) && note.sharedWith.length > 0;
  return (
    <>
      <div style={{ fontFamily: "var(--rv-mono)", fontSize: 10, letterSpacing: 1.2, color: "var(--rv-text-faint)", textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <span>{note.updatedAt ? new Date(note.updatedAt).toLocaleString() : ""}</span>
        {note.pinned && <span style={{ color: "var(--rv-accent)" }}>📌 Pinned</span>}
        {shared && <span style={{ color: "var(--rv-accent)" }}>· Shared</span>}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled"
        style={{
          width: "100%", border: "none", background: "transparent",
          outline: "none", fontSize: 24, color: "var(--rv-text)",
          fontWeight: 600, marginBottom: 16, fontFamily: "inherit",
        }}
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Start writing…"
        rows={16}
        style={{
          width: "100%", border: "none", background: "transparent",
          outline: "none", fontSize: 14, color: "var(--rv-text-dim)",
          lineHeight: 1.7, fontFamily: "inherit", resize: "vertical",
          minHeight: 240,
        }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button style={pgBtnPrimary} onClick={save} disabled={!dirty}>{dirty ? "Save" : "Saved"}</button>
        <button style={pgBtn} onClick={togglePin}>{note.pinned ? "Unpin" : "Pin"}</button>
        <button style={pgBtn} onClick={toggleShare}>{shared ? "Unshare" : "Share with partner"}</button>
        <button style={pgBtn} onClick={remove}>Delete</button>
      </div>
    </>
  );
}

/* ============ CALENDAR — real month grid with events on each day ============ */
function CalendarView() {
  const { data, loading, error, reload } = useApi("/api/calendar");
  const events = React.useMemo(() => {
    if (!data) return [];
    const shared = Array.isArray(data.shared) ? data.shared : [];
    const kaliph = Array.isArray(data.kaliph) ? data.kaliph : [];
    const kathrine = Array.isArray(data.kathrine) ? data.kathrine : [];
    return [...shared, ...kaliph, ...kathrine];
  }, [data]);
  const [anchor, setAnchor] = React.useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [creating, setCreating] = React.useState(null); // null | {date: ISO}

  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const eventsByDay = React.useMemo(() => {
    const m = {};
    for (const e of events) {
      const start = e.start || e.date;
      if (!start) continue;
      const d = new Date(start);
      if (isNaN(d)) continue;
      const key = dayKey(d);
      (m[key] = m[key] || []).push(e);
    }
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => new Date(a.start || a.date) - new Date(b.start || b.date));
    }
    return m;
  }, [events]);

  const firstOfMonth = anchor;
  const year = firstOfMonth.getFullYear();
  const month = firstOfMonth.getMonth();
  const firstWeekday = firstOfMonth.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstWeekday + 1;
    const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
    const d = new Date(year, month, dayNum);
    cells.push({ d, inMonth });
  }
  const monthLabel = firstOfMonth.toLocaleString(undefined, { month: "long", year: "numeric" });
  const today = new Date();
  const todayKey = dayKey(today);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader
        title="Calendar"
        meta={monthLabel}
        actions={<>
          <button style={pgBtn} onClick={() => setAnchor(new Date(year, month - 1, 1))}>‹</button>
          <button style={pgBtn} onClick={() => setAnchor(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button>
          <button style={pgBtn} onClick={() => setAnchor(new Date(year, month + 1, 1))}>›</button>
          <button style={pgBtnPrimary} onClick={() => setCreating({ date: dayKey(today) })}><IconPlus size={12} /> New event</button>
        </>}
      />
      {creating && (
        <NewEventForm
          defaultDate={creating.date}
          onDone={() => { setCreating(null); reload(); }}
          onCancel={() => setCreating(null)}
        />
      )}
      <PageBody pad={false}>
        {loading ? <Spinner />
          : error ? <Empty title="Couldn't load calendar" subtitle={error} />
          : (
            <div style={{ padding: "20px 28px 32px" }}>
              {/* Weekday header */}
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
                fontFamily: "var(--rv-mono)", fontSize: 10, letterSpacing: 1.2,
                color: "var(--rv-text-faint)", textTransform: "uppercase",
                marginBottom: 8,
              }}>
                {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
                  <div key={d} style={{ padding: "6px 8px" }}>{d}</div>
                ))}
              </div>
              {/* Grid */}
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
                gap: 4,
              }}>
                {cells.map(({ d, inMonth }, i) => {
                  const key = dayKey(d);
                  const evs = eventsByDay[key] || [];
                  const isToday = key === todayKey;
                  return (
                    <button
                      key={i}
                      onClick={() => setCreating({ date: key })}
                      style={{
                        all: "unset", cursor: "pointer",
                        minHeight: 96, padding: 8,
                        borderRadius: 10,
                        border: `1px solid ${isToday ? "var(--rv-accent)" : "var(--rv-border)"}`,
                        background: isToday ? "var(--rv-accent-soft)" : (inMonth ? "var(--rv-card-bg)" : "transparent"),
                        opacity: inMonth ? 1 : 0.35,
                        display: "flex", flexDirection: "column", gap: 4,
                      }}
                    >
                      <div style={{
                        fontSize: 12, fontFamily: "var(--rv-mono)",
                        color: isToday ? "var(--rv-accent)" : "var(--rv-text)",
                        fontWeight: isToday ? 600 : 400,
                      }}>{d.getDate()}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, overflow: "hidden", minHeight: 0 }}>
                        {evs.slice(0, 3).map(e => (
                          <span key={e.id} style={{
                            fontSize: 10.5, padding: "2px 6px",
                            borderRadius: 4,
                            background: e.color || "var(--rv-accent-soft)",
                            color: e.color ? "#1a1510" : "var(--rv-accent)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            textAlign: "left",
                          }}>{e.title}</span>
                        ))}
                        {evs.length > 3 && (
                          <span style={{ fontSize: 9.5, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", padding: "0 6px" }}>+{evs.length - 3} more</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Upcoming list below the grid */}
              <div style={{ marginTop: 24 }}>
                <h2 style={{
                  margin: "0 0 10px", fontSize: 11, letterSpacing: 1.2,
                  color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)",
                  textTransform: "uppercase",
                }}>Upcoming</h2>
                {events.filter(e => {
                  const d = new Date(e.start || e.date);
                  return !isNaN(d) && d >= new Date(today.getFullYear(), today.getMonth(), today.getDate());
                }).sort((a, b) => new Date(a.start || a.date) - new Date(b.start || b.date)).slice(0, 10).map(e => (
                  <CalendarEventRow key={e.id} event={e} onChanged={reload} />
                ))}
                {events.length === 0 && <Empty title="No events" subtitle="Click any day above to add one." />}
              </div>
            </div>
          )
        }
      </PageBody>
    </div>
  );
}

function CalendarEventRow({ event, onChanged }) {
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(event.title || "");
  const [start, setStart] = React.useState(event.start || event.date || "");
  const [description, setDescription] = React.useState(event.description || "");
  const [reminder, setReminder] = React.useState(event.reminder ?? "");
  const [color, setColor] = React.useState(event.color || "#7c3aed");
  const save = async () => {
    await fetch(`/api/calendar/${event.id}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, start, description, reminder: reminder === "" ? "" : parseInt(reminder), color }),
    });
    setEditing(false);
    onChanged && onChanged();
  };
  const del = async () => {
    const ok = await window.rvConfirm(`Delete "${event.title}"? This can't be undone.`, { title: "Delete event", primaryLabel: "Delete", danger: true });
    if (!ok) return;
    await fetch(`/api/calendar/${event.id}`, { method: "DELETE", credentials: "same-origin" });
    onChanged && onChanged();
  };
  const d = new Date(event.start || event.date);
  const hasTime = (event.start || event.date || "").includes("T");
  if (editing) {
    return (
      <div style={{
        padding: "12px 14px", marginBottom: 4,
        background: "var(--rv-card-bg)", border: "1px solid var(--rv-accent-line)",
        borderRadius: 8, display: "grid", gridTemplateColumns: "1fr 220px 140px 100px auto auto auto", gap: 10, alignItems: "center",
      }}>
        <TextInput value={title} onChange={setTitle} placeholder="Title" onEnter={save} />
        <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 8, background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)", color: "var(--rv-text)", fontSize: 12, colorScheme: "dark" }} />
        <select value={reminder} onChange={(e) => setReminder(e.target.value)} style={selectStyle}>
          <option value="">No reminder</option>
          <option value="5">5 min before</option>
          <option value="15">15 min before</option>
          <option value="30">30 min before</option>
          <option value="60">1 hr before</option>
          <option value="1440">1 day before</option>
        </select>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
          style={{ width: 36, height: 32, borderRadius: 6, border: "1px solid var(--rv-border)", background: "var(--rv-input-bg)" }} />
        <button style={pgBtnPrimary} onClick={save}>Save</button>
        <button style={pgBtn} onClick={() => setEditing(false)}>Cancel</button>
        <button style={pgBtn} onClick={del}>Delete</button>
      </div>
    );
  }
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "160px 1fr auto auto",
      alignItems: "center", gap: 14,
      padding: "10px 14px", marginBottom: 4,
      background: "var(--rv-card-bg)",
      border: "1px solid var(--rv-border)",
      borderLeft: `3px solid ${event.color || "var(--rv-accent)"}`,
      borderRadius: 8,
    }}>
      <div style={{ fontFamily: "var(--rv-mono)", fontSize: 11, color: "var(--rv-accent)" }}>
        {d.toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" })}
        {hasTime ? ` · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
      </div>
      <div>
        <div style={{ fontSize: 13, color: "var(--rv-text)" }}>{event.title}</div>
        {event.reminder ? <div style={{ fontSize: 10.5, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)" }}>🔔 {event.reminder} min before</div> : null}
      </div>
      <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={() => setEditing(true)}>Edit</button>
      <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={del}>Delete</button>
    </div>
  );
}

function NewEventForm({ onDone, onCancel, defaultDate }) {
  const [title, setTitle] = React.useState("");
  const [start, setStart] = React.useState(() => {
    if (defaultDate) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      return `${defaultDate}T${hh}:${mm}`;
    }
    return new Date().toISOString().slice(0, 16);
  });
  const [description, setDescription] = React.useState("");
  const submit = async () => {
    if (!title.trim()) return;
    await fetch("/api/calendar", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, start, description }),
    });
    onDone();
  };
  return (
    <div style={{
      padding: "14px 28px", borderBottom: "1px solid var(--rv-border)",
      background: "var(--rv-card-bg)", display: "flex", gap: 10, alignItems: "center",
    }}>
      <TextInput value={title} onChange={setTitle} placeholder="Event title" autoFocus onEnter={submit} style={{ flex: 1 }} />
      <input
        type="datetime-local"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        style={{
          padding: "8px 12px", borderRadius: 8,
          background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)",
          color: "var(--rv-text)", fontSize: 13, fontFamily: "inherit", outline: "none",
          colorScheme: "dark",
        }}
      />
      <TextInput value={description} onChange={setDescription} placeholder="Notes (optional)" style={{ flex: 1 }} />
      <button style={pgBtnPrimary} onClick={submit}>Create</button>
      <button style={pgBtn} onClick={onCancel}>Cancel</button>
    </div>
  );
}

/* ============ DOCUMENT LOCKER ============ */

const FOLDER_ICON_SIZE = 44;
function FolderIcon() {
  return (
    <div style={{
      width: FOLDER_ICON_SIZE, height: FOLDER_ICON_SIZE * 0.82,
      position: "relative",
    }}>
      <div style={{
        position: "absolute", left: 4, top: -3, width: 14, height: 6,
        background: "oklch(0.30 0.08 72)",
        border: "1px solid oklch(0.40 0.10 72)",
        borderBottom: "none",
        borderRadius: "4px 4px 0 0",
      }} />
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(160deg, oklch(0.30 0.08 72), oklch(0.24 0.06 72))",
        border: "1px solid oklch(0.42 0.12 72)",
        borderRadius: "2px 8px 8px 8px",
        boxShadow: "inset 0 1px 0 oklch(0.50 0.14 72)",
      }} />
    </div>
  );
}

function FolderMenu({ onRename, onDelete }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    const h = () => setOpen(false);
    setTimeout(() => document.addEventListener("click", h, { once: true }), 0);
    return () => document.removeEventListener("click", h);
  }, [open]);
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", flexShrink: 0 }}>
      <button onClick={() => setOpen(v => !v)} style={{
        all: "unset", cursor: "pointer",
        width: 22, height: 22, borderRadius: 4,
        display: "grid", placeItems: "center",
        color: "var(--rv-text-faint)",
      }}>
        <IconMore size={14} />
      </button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: "100%",
          marginTop: 4, minWidth: 120,
          background: "oklch(0.12 0.01 60 / 0.96)",
          backdropFilter: "blur(14px)",
          border: "1px solid var(--rv-border)",
          borderRadius: 8, padding: 3,
          boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
          zIndex: 20,
        }}>
          <button onClick={onRename} style={menuItem}>Rename</button>
          <button onClick={onDelete} style={{ ...menuItem, color: "oklch(0.75 0.18 30)" }}>Delete</button>
        </div>
      )}
    </div>
  );
}

function FileActionsMenu({ onRename, onDelete }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    const h = () => setOpen(false);
    setTimeout(() => document.addEventListener("click", h, { once: true }), 0);
    return () => document.removeEventListener("click", h);
  }, [open]);
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", justifySelf: "end" }}>
      <button onClick={() => setOpen(v => !v)} style={{
        all: "unset", cursor: "pointer",
        width: 28, height: 28, borderRadius: 6,
        display: "grid", placeItems: "center",
        color: "var(--rv-text-faint)",
      }}>
        <IconMore size={14} />
      </button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: "100%",
          marginTop: 4, minWidth: 120,
          background: "oklch(0.12 0.01 60 / 0.96)",
          backdropFilter: "blur(14px)",
          border: "1px solid var(--rv-border)",
          borderRadius: 8, padding: 3,
          boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
          zIndex: 20,
        }}>
          <button onClick={onRename} style={menuItem}>Rename</button>
          <button onClick={onDelete} style={{ ...menuItem, color: "oklch(0.75 0.18 30)" }}>Delete</button>
        </div>
      )}
    </div>
  );
}

const menuItem = {
  all: "unset", cursor: "pointer", display: "block",
  width: "100%", boxSizing: "border-box",
  padding: "7px 10px", borderRadius: 5,
  fontSize: 12, color: "var(--rv-text)",
};

function mapKind(kindKey, mimeType) {
  const map = { JPEG: "IMG", PNG: "IMG", GIF: "IMG", WEBP: "IMG", HEIC: "IMG",
    MP4: "VID", MOV: "VID", WEBM: "VID",
    MP3: "AUD", WAV: "AUD", OGG: "AUD",
    XLSX: "XLS", DOCX: "DOC", PPTX: "PPT",
    VND: (mimeType && mimeType.includes("spreadsheet") ? "XLS"
      : mimeType && mimeType.includes("wordprocessing") ? "DOC"
      : mimeType && mimeType.includes("presentation") ? "PPT" : "FILE"),
  };
  return map[kindKey] || kindKey;
}

function relativeAgo(ts) {
  if (!ts) return "";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return "mo";
  return "yr";
}

// Vault is passcode-protected. We keep the passcode in component state (never
// localStorage) and ask on every mount. Matches the main app's behavior.
function LockerView() {
  const [passcode, setPasscode] = React.useState(null);
  if (!passcode) {
    return <LockerPasscodeGate onUnlock={setPasscode} />;
  }
  return <LockerContent passcode={passcode} onLock={() => setPasscode(null)} />;
}

function LockerPasscodeGate({ onUnlock }) {
  const [digits, setDigits] = React.useState(["", "", "", ""]);
  const [err, setErr] = React.useState("");
  const refs = [React.useRef(), React.useRef(), React.useRef(), React.useRef()];
  const setDigit = (i, v) => {
    const next = [...digits];
    next[i] = v.slice(-1);
    setDigits(next);
    if (v && i < 3) refs[i + 1].current?.focus();
    if (i === 3 && next.every(d => d !== "")) attempt(next.join(""));
  };
  const attempt = async (code) => {
    setErr("");
    const r = await fetch(`/api/vault?passcode=${encodeURIComponent(code)}`, { credentials: "same-origin" });
    if (r.status === 403) {
      setErr("Incorrect passcode");
      setDigits(["", "", "", ""]);
      refs[0].current?.focus();
      return;
    }
    if (!r.ok) { setErr("Couldn't unlock"); return; }
    onUnlock(code);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader title="Document Locker" />
      <PageBody>
        <div style={{ maxWidth: 360, margin: "40px auto 0", textAlign: "center" }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: "var(--rv-input-bg)", border: "1px solid var(--rv-border)",
            display: "grid", placeItems: "center", margin: "0 auto 16px",
            color: "var(--rv-accent)",
          }}><IconLocker size={22} /></div>
          <div style={{
            fontSize: 20, color: "var(--rv-text)", fontWeight: 600,
            letterSpacing: 0.2, marginBottom: 6,
          }}>Document Locker</div>
          <div style={{
            fontFamily: "var(--rv-mono)", fontSize: 11,
            color: "var(--rv-text-faint)", letterSpacing: 0.6,
            textTransform: "uppercase", marginBottom: 20,
          }}>Enter your 4-digit passcode</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 14 }}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={refs[i]}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={(e) => setDigit(i, e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => { if (e.key === "Backspace" && !d && i > 0) refs[i - 1].current?.focus(); }}
                style={{
                  width: 52, height: 56, textAlign: "center",
                  fontSize: 22, fontFamily: "var(--rv-mono)",
                  background: "var(--rv-input-bg)",
                  border: `1px solid ${err ? "oklch(0.60 0.20 25)" : "var(--rv-input-border)"}`,
                  borderRadius: 10, color: "var(--rv-text)", outline: "none",
                }}
                autoFocus={i === 0}
              />
            ))}
          </div>
          {err && <div style={{ color: "oklch(0.75 0.18 30)", fontSize: 12, fontFamily: "var(--rv-mono)" }}>{err}</div>}
        </div>
      </PageBody>
    </div>
  );
}

function LockerContent({ passcode, onLock }) {
  const { data, loading, error, reload } = useApi(`/api/vault?passcode=${encodeURIComponent(passcode)}`);
  const [user, setUser] = React.useState(null);
  const [folderPath, setFolderPath] = React.useState([]); // array of {id, name}
  React.useEffect(() => {
    fetch("/api/auth/session", { credentials: "same-origin" }).then(r => r.json()).then(s => setUser(s.user));
  }, []);
  const allItems = (data && user && Array.isArray(data[user])) ? data[user] : [];
  const currentFolderId = folderPath.length ? folderPath[folderPath.length - 1].id : null;
  const items = allItems.filter(it => (it.folder || null) === currentFolderId);
  const fileInputRef = React.useRef(null);
  const uploadFiles = async (files) => {
    const fd = new FormData();
    fd.append("passcode", passcode);
    if (currentFolderId) fd.append("folder", currentFolderId);
    [...files].forEach(f => fd.append("files", f));
    await fetch("/api/vault", { method: "POST", credentials: "same-origin", body: fd });
    reload();
  };
  const makeFolder = async () => {
    const name = await window.rvPrompt("Give the folder a name.", "", { title: "New folder", placeholder: "Folder name", primaryLabel: "Create" });
    if (!name) return;
    const fd = new FormData();
    fd.append("passcode", passcode);
    fd.append("folderName", name);
    if (currentFolderId) fd.append("folder", currentFolderId);
    await fetch("/api/vault", { method: "POST", credentials: "same-origin", body: fd });
    reload();
  };
  const addLink = async () => {
    const url = await window.rvPrompt("Paste the URL.", "", { title: "New link", placeholder: "https://…", primaryLabel: "Next" });
    if (!url) return;
    const linkName = await window.rvPrompt("Name this link (optional).", url, { title: "Link name", placeholder: "Display name", primaryLabel: "Add" }) || url;
    const fd = new FormData();
    fd.append("passcode", passcode);
    fd.append("link", url);
    fd.append("linkName", linkName);
    if (currentFolderId) fd.append("folder", currentFolderId);
    await fetch("/api/vault", { method: "POST", credentials: "same-origin", body: fd });
    reload();
  };
  const renameItem = async (it) => {
    const name = await window.rvPrompt(`Rename "${it.name}".`, it.name, { title: "Rename", placeholder: "New name", primaryLabel: "Rename" });
    if (!name || name === it.name) return;
    await fetch(`/api/vault/${it.id}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode, name }),
    });
    reload();
  };
  const deleteItem = async (it) => {
    const ok = await window.rvConfirm(`Delete "${it.name}"? This can't be undone.`, { title: "Delete item", primaryLabel: "Delete", danger: true });
    if (!ok) return;
    await fetch(`/api/vault/${it.id}`, {
      method: "DELETE", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    reload();
  };
  const openFolder = (f) => setFolderPath(prev => [...prev, { id: f.id, name: f.name }]);
  const goTo = (i) => setFolderPath(prev => prev.slice(0, i));
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader
        title="Document Locker"
        meta={!loading && !error ? `${items.length} item${items.length === 1 ? "" : "s"}` : undefined}
        actions={<>
          <button style={pgBtn} onClick={addLink}><IconPlus size={12} /> Link</button>
          <button style={pgBtn} onClick={makeFolder}><IconPlus size={12} /> Folder</button>
          <button style={pgBtnPrimary} onClick={() => fileInputRef.current?.click()}><IconPlus size={12} /> Upload</button>
          <button style={pgBtn} onClick={onLock}>Lock</button>
          <input ref={fileInputRef} type="file" multiple style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = ""; }} />
        </>}
      />
      <div style={{
        padding: "8px 28px", borderBottom: "1px solid var(--rv-border)",
        display: "flex", gap: 6, fontFamily: "var(--rv-mono)", fontSize: 11,
        color: "var(--rv-text-faint)",
      }}>
        <button onClick={() => setFolderPath([])} style={{ all: "unset", cursor: "pointer", color: folderPath.length ? "var(--rv-accent)" : "var(--rv-text)" }}>Root</button>
        {folderPath.map((f, i) => (
          <React.Fragment key={f.id}>
            <span>/</span>
            <button onClick={() => goTo(i + 1)} style={{ all: "unset", cursor: "pointer", color: i === folderPath.length - 1 ? "var(--rv-text)" : "var(--rv-accent)" }}>{f.name}</button>
          </React.Fragment>
        ))}
      </div>
      <PageBody>
        {loading ? <Spinner />
          : error ? <Empty title="Locker error" subtitle={error} />
          : (() => {
              const folders = items.filter(it => it.type === "folder");
              const files = items.filter(it => it.type !== "folder");
              // Count docs inside each folder from the full vault
              const folderCounts = {};
              folders.forEach(f => {
                folderCounts[f.id] = allItems.filter(it => it.folder === f.id).length;
              });
              if (folders.length === 0 && files.length === 0) {
                return <Empty title="This folder is empty" subtitle="Upload a file, add a link, or create a folder." />;
              }
              return (
                <>
                  {folders.length > 0 && (
                    <Section title="Folders">
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                        gap: 10,
                      }}>
                        {folders.map(f => (
                          <Card key={f.id} padding={14} onClick={() => openFolder(f)} style={{ position: "relative" }}>
                            <FolderIcon />
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 10 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: 13.5, color: "var(--rv-text)", fontWeight: 500,
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>{f.name}</div>
                                <div style={{
                                  fontFamily: "var(--rv-mono)", fontSize: 10.5,
                                  color: "var(--rv-text-faint)", marginTop: 3, letterSpacing: 0.4,
                                }}>
                                  {folderCounts[f.id] || 0} doc{folderCounts[f.id] === 1 ? "" : "s"}
                                  {f.uploadedAt ? ` · ${relativeAgo(f.uploadedAt)}` : ""}
                                </div>
                              </div>
                              <FolderMenu onRename={() => renameItem(f)} onDelete={() => deleteItem(f)} />
                            </div>
                          </Card>
                        ))}
                      </div>
                    </Section>
                  )}
                  {files.length > 0 && (
                    <Section title="Recent">
                      <div style={{
                        border: "1px solid var(--rv-border)", borderRadius: 12,
                        overflow: "hidden", background: "var(--rv-card-bg)",
                      }}>
                        {files.slice().sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0)).map((f, i) => {
                          const name = f.name || "Untitled";
                          const isLink = f.type === "link";
                          const kindKey = isLink ? "LINK"
                            : (f.mimeType?.split("/")[1] || name.split(".").pop() || "FILE").slice(0, 4).toUpperCase();
                          const kindDisplay = mapKind(kindKey, f.mimeType);
                          const sizeStr = f.size
                            ? (f.size >= 1024 * 1024 ? `${(f.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(f.size / 1024)} KB`)
                            : (isLink ? "link" : "");
                          return (
                            <div key={f.id} style={{
                              display: "grid",
                              gridTemplateColumns: "56px 1fr 120px 140px 100px 36px",
                              alignItems: "center", gap: 18,
                              padding: "13px 18px",
                              borderTop: i === 0 ? "none" : "1px solid var(--rv-border)",
                            }}>
                              <div style={{
                                width: 40, height: 38, borderRadius: 6,
                                background: "var(--rv-input-bg)", border: "1px solid var(--rv-border)",
                                display: "grid", placeItems: "center",
                                fontFamily: "var(--rv-mono)", fontSize: 10,
                                color: "var(--rv-accent)", letterSpacing: 0.5, fontWeight: 600,
                              }}>{kindDisplay}</div>
                              <a href={f.url || "#"} target="_blank" rel="noreferrer" style={{
                                textDecoration: "none", color: "var(--rv-text)", fontSize: 13.5,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}>{name}</a>
                              <div style={{ fontFamily: "var(--rv-mono)", fontSize: 11, color: "var(--rv-text-faint)" }}>
                                {sizeStr}
                              </div>
                              <div style={{ fontSize: 12, color: "var(--rv-text-dim)" }}>
                                {(f.uploadedBy || "").charAt(0).toUpperCase() + (f.uploadedBy || "").slice(1)}
                              </div>
                              <div style={{ fontFamily: "var(--rv-mono)", fontSize: 11, color: "var(--rv-text-faint)" }}>
                                {f.uploadedAt ? relativeAgo(f.uploadedAt) : ""}
                              </div>
                              <FileActionsMenu onRename={() => renameItem(f)} onDelete={() => deleteItem(f)} />
                            </div>
                          );
                        })}
                      </div>
                    </Section>
                  )}
                </>
              );
            })()
        }
      </PageBody>
    </div>
  );
}

/* ============ GUEST MESSAGES (with in-vault thread view) ============ */
function GuestView({ currentUser }) {
  const { data, loading, error, reload } = useApi("/api/guest-messages");
  const guests = Array.isArray(data) ? data : [];
  const [openGuest, setOpenGuest] = React.useState(null);
  const [creating, setCreating] = React.useState(false);
  if (openGuest) {
    return <GuestThread
      guestId={openGuest.id}
      guestName={openGuest.name}
      avatar={openGuest.avatar}
      currentUser={currentUser}
      onBack={() => { setOpenGuest(null); reload(); }}
    />;
  }
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader
        title="Guest Messages"
        meta={!loading && !error ? `${guests.length} guest${guests.length === 1 ? "" : "s"}` : undefined}
        subtitle="Click a guest to open their thread."
        actions={<button style={pgBtnPrimary} onClick={() => setCreating(true)}><IconPlus size={12} /> New guest pass</button>}
      />
      {creating && <NewGuestForm onDone={() => { setCreating(false); reload(); }} onCancel={() => setCreating(false)} />}
      <PageBody>
        {loading ? <Spinner />
          : error ? <Empty title="Couldn't load guests" subtitle={error} />
          : guests.length === 0 ? <Empty title="No guests yet" subtitle="Create a guest pass to let someone message you here." />
          : (
            <div style={{ display: "grid", gap: 10 }}>
              {guests.map((g) => {
                const myCh = g.channels ? g.channels[currentUser] || [] : [];
                const grp = (g.channels && g.channels.group) || [];
                const all = [...myCh, ...grp].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                const last = all[0];
                const total = Object.values(g.messageCount || {}).reduce((a, b) => a + (b || 0), 0);
                return <GuestCard key={g.id} guest={g} last={last} total={total} onOpen={() => setOpenGuest(g)} onChanged={reload} />;
              })}
            </div>
          )
        }
      </PageBody>
    </div>
  );
}

function GuestCard({ guest: g, last, total, onOpen, onChanged }) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(g.name);
  const [password, setPassword] = React.useState("");
  const [channels, setChannels] = React.useState({
    kaliph: (g.channels || {}).kaliph !== undefined || (Array.isArray(g.allowedChannels) && g.allowedChannels.includes("kaliph")),
    kathrine: (g.channels || {}).kathrine !== undefined || (Array.isArray(g.allowedChannels) && g.allowedChannels.includes("kathrine")),
    group: (g.channels || {}).group !== undefined || (Array.isArray(g.allowedChannels) && g.allowedChannels.includes("group")),
  });
  const fileRef = React.useRef(null);
  const save = async () => {
    const body = { name, channels: Object.entries(channels).filter(([, v]) => v).map(([k]) => k) };
    if (password) body.password = password;
    await fetch(`/api/guests/${g.id}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setEditing(false);
    setPassword("");
    onChanged && onChanged();
  };
  const del = async () => {
    const ok = await window.rvConfirm(`Delete guest "${g.name}"? This removes their pass and all their messages.`, { title: "Delete guest", primaryLabel: "Delete", danger: true });
    if (!ok) return;
    await fetch(`/api/guests/${g.id}`, { method: "DELETE", credentials: "same-origin" });
    onChanged && onChanged();
  };
  const uploadAvatar = async (file) => {
    const fd = new FormData();
    fd.append("avatar", file);
    await fetch(`/api/guests/${g.id}/avatar`, { method: "POST", credentials: "same-origin", body: fd });
    onChanged && onChanged();
  };
  if (editing) {
    return (
      <Card padding={16} hoverable={false}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
          <div onClick={() => fileRef.current?.click()} style={{
            width: 38, height: 38, borderRadius: "50%", cursor: "pointer",
            background: "var(--rv-avatar-bg)", border: "1px solid var(--rv-border)",
            display: "grid", placeItems: "center",
            fontSize: 13, fontWeight: 600, color: "var(--rv-text)",
            overflow: "hidden",
          }}>
            {g.avatar
              ? <img src={g.avatar} alt={g.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : (g.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.[0]) uploadAvatar(e.target.files[0]); e.target.value = ""; }} />
          <div style={{ flex: 1 }}>
            <TextInput value={name} onChange={setName} placeholder="Guest name" />
          </div>
          <TextInput value={password} onChange={setPassword} placeholder="New password (optional)" type="password" style={{ width: 220 }} />
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--rv-text-dim)", marginBottom: 10 }}>
          <span>Channels:</span>
          {["kaliph", "kathrine", "group"].map(k => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={!!channels[k]} onChange={() => setChannels(prev => ({ ...prev, [k]: !prev[k] }))} />
              {k}
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={pgBtnPrimary} onClick={save}>Save</button>
          <button style={pgBtn} onClick={() => setEditing(false)}>Cancel</button>
          <button style={pgBtn} onClick={del}>Delete guest</button>
        </div>
      </Card>
    );
  }
  return (
    <Card padding={16}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div onClick={onOpen} style={{
          width: 38, height: 38, borderRadius: "50%", cursor: "pointer",
          background: "var(--rv-avatar-bg)", border: "1px solid var(--rv-border)",
          display: "grid", placeItems: "center",
          fontSize: 13, fontWeight: 600, color: "var(--rv-text)",
          overflow: "hidden", flexShrink: 0,
        }}>
          {g.avatar
            ? <img src={g.avatar} alt={g.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : (g.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
        </div>
        <div onClick={onOpen} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 13.5, color: "var(--rv-text)", fontWeight: 500 }}>{g.name}</span>
            {total > 0 && <Tag tone="accent">{total}</Tag>}
          </div>
          {last?.text && (
            <div style={{ fontSize: 12, color: "var(--rv-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span style={{ color: "var(--rv-text-faint)" }}>{last.sender}:</span> {last.text}
            </div>
          )}
          {!last && <div style={{ fontSize: 11.5, color: "var(--rv-text-faint)" }}>No messages yet</div>}
        </div>
        {last?.timestamp && (
          <div style={{ fontFamily: "var(--rv-mono)", fontSize: 10.5, color: "var(--rv-text-faint)", flexShrink: 0 }}>
            {new Date(last.timestamp).toLocaleDateString()}
          </div>
        )}
        <button style={{ ...pgBtn, height: 28, padding: "0 10px", fontSize: 11 }} onClick={(e) => { e.stopPropagation(); setEditing(true); }}>Edit</button>
      </div>
    </Card>
  );
}

function NewGuestForm({ onDone, onCancel }) {
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [expiresIn, setExpiresIn] = React.useState("");
  const [channels, setChannels] = React.useState({ kaliph: true, kathrine: true, group: true });
  const [err, setErr] = React.useState("");
  const submit = async () => {
    setErr("");
    if (!name.trim() || !password.trim()) { setErr("Name and password required"); return; }
    const allowed = Object.entries(channels).filter(([, v]) => v).map(([k]) => k);
    const body = { name: name.trim(), password, channels: allowed };
    if (expiresIn) body.expiresIn = parseInt(expiresIn);
    const r = await fetch("/api/guests", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error || `HTTP ${r.status}`); return; }
    onDone();
  };
  const toggle = (k) => setChannels(prev => ({ ...prev, [k]: !prev[k] }));
  return (
    <div style={{
      padding: "14px 28px", borderBottom: "1px solid var(--rv-border)",
      background: "var(--rv-card-bg)",
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 140px auto auto", gap: 10, alignItems: "center" }}>
        <TextInput value={name} onChange={setName} placeholder="Guest name" autoFocus onEnter={submit} />
        <TextInput value={password} onChange={setPassword} placeholder="Guest password" type="password" onEnter={submit} />
        <select value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)} style={selectStyle}>
          <option value="">Never expires</option>
          <option value="24">24 hours</option>
          <option value="168">7 days</option>
          <option value="720">30 days</option>
        </select>
        <button style={pgBtnPrimary} onClick={submit}>Create</button>
        <button style={pgBtn} onClick={onCancel}>Cancel</button>
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12, color: "var(--rv-text-dim)" }}>
        <span>Channels:</span>
        {["kaliph", "kathrine", "group"].map(k => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={!!channels[k]} onChange={() => toggle(k)} />
            {k}
          </label>
        ))}
      </div>
      {err && <div style={{ marginTop: 8, color: "oklch(0.75 0.18 30)", fontSize: 12 }}>{err}</div>}
    </div>
  );
}

function GuestThread({ guestId, guestName, avatar, currentUser, onBack }) {
  const { data, loading, reload } = useApi(`/api/guest-messages`);
  const [channel, setChannel] = React.useState(currentUser || "group");
  const [text, setText] = React.useState("");
  const guest = Array.isArray(data) ? data.find(g => g.id === guestId) : null;
  const messages = guest?.channels?.[channel] || [];
  const scrollerRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages.length]);
  const send = async () => {
    const v = text.trim();
    if (!v) return;
    const fd = new FormData();
    fd.append("text", v);
    fd.append("target", channel);
    await fetch(`/api/guests/${guestId}/message`, { method: "POST", credentials: "same-origin", body: fd });
    setText("");
    reload();
  };
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader
        title={guestName || "Guest"}
        subtitle={`Channel · ${channel === "group" ? "both of you" : `private with ${channel}`}`}
        actions={<>
          <button style={pgBtn} onClick={() => setChannel(currentUser)}>{channel === currentUser ? "● Mine" : "Mine"}</button>
          <button style={pgBtn} onClick={() => setChannel("group")}>{channel === "group" ? "● Both" : "Both"}</button>
          <button style={pgBtn} onClick={onBack}>Back</button>
        </>}
      />
      <div ref={scrollerRef} className="rv-scroll" style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
        {loading && !guest ? <Spinner />
          : messages.length === 0 ? <Empty title="No messages in this channel" subtitle="Send the first one below." />
          : messages.map((m) => {
              const mine = m.sender === currentUser;
              return (
                <div key={m.id} style={{
                  display: "flex", gap: 10, marginTop: 8,
                  flexDirection: mine ? "row-reverse" : "row",
                }}>
                  <div style={{
                    maxWidth: "min(68%, 640px)",
                    padding: "10px 14px", borderRadius: 14,
                    background: mine
                      ? "linear-gradient(180deg, var(--rv-bubble-me), var(--rv-bubble-me-dark))"
                      : "linear-gradient(180deg, var(--rv-bubble-them), var(--rv-bubble-them-dark))",
                    color: mine ? "var(--rv-bubble-me-fg)" : "var(--rv-text)",
                    border: mine ? "1px solid var(--rv-bubble-me-border)" : "1px solid var(--rv-bubble-them-border)",
                    fontSize: 14, lineHeight: 1.5,
                    wordBreak: "break-word",
                  }}>
                    {!mine && <div style={{ fontSize: 10.5, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", marginBottom: 4 }}>{m.sender}</div>}
                    <div>{m.text}</div>
                  </div>
                </div>
              );
            })
        }
      </div>
      <div style={{ padding: "10px 28px 20px", display: "flex", gap: 10 }}>
        <TextInput value={text} onChange={setText} placeholder={`Message ${guestName}…`} onEnter={send} style={{ flex: 1 }} />
        <button style={pgBtnPrimary} onClick={send} disabled={!text.trim()}><IconSend size={14} /> Send</button>
      </div>
    </div>
  );
}

/* ============ REMINDERS ============ */
function RemindersView() {
  const { data, loading, error, reload } = useApi("/api/reminders");
  const reminders = Array.isArray(data) ? data : [];
  const [creating, setCreating] = React.useState(false);
  const toggle = async (r) => {
    await fetch(`/api/reminders/${r.id}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: !r.completed }),
    });
    reload();
  };
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader
        title="Reminders"
        meta={!loading && !error ? `${reminders.length} total` : undefined}
        actions={<button style={pgBtnPrimary} onClick={() => setCreating(true)}><IconPlus size={12} /> New reminder</button>}
      />
      {creating && <NewReminderForm onDone={() => { setCreating(false); reload(); }} onCancel={() => setCreating(false)} />}
      <PageBody>
        {loading ? <Spinner />
          : error ? <Empty title="Couldn't load reminders" subtitle={error} />
          : reminders.length === 0 ? <Empty title="No reminders" subtitle="Add your first reminder to get started." />
          : (
            <div style={{ display: "grid", gap: 6 }}>
              {reminders.map((r) => <ReminderRow key={r.id} reminder={r} onChanged={reload} onToggle={() => toggle(r)} />)}
            </div>
          )
        }
      </PageBody>
    </div>
  );
}

function ReminderRow({ reminder: r, onChanged, onToggle }) {
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(r.title || "");
  const [datetime, setDatetime] = React.useState(r.datetime ? new Date(r.datetime).toISOString().slice(0, 16) : "");
  const [repeat, setRepeat] = React.useState(r.repeat || "");
  const [priority, setPriority] = React.useState(r.priority || "normal");
  const [notify, setNotify] = React.useState(r.notify || { site: true, push: false, email: false });
  const save = async () => {
    await fetch(`/api/reminders/${r.id}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, datetime, repeat, priority, notify }),
    });
    setEditing(false);
    onChanged && onChanged();
  };
  const snooze = async (hours) => {
    const next = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    await fetch(`/api/reminders/${r.id}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datetime: next }),
    });
    onChanged && onChanged();
  };
  if (editing) {
    return (
      <div style={{
        padding: "12px 14px",
        background: "var(--rv-card-bg)", border: "1px solid var(--rv-accent-line)",
        borderRadius: 10,
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 200px 140px 140px", gap: 10, marginBottom: 10 }}>
          <TextInput value={title} onChange={setTitle} placeholder="Reminder title" onEnter={save} />
          <input type="datetime-local" value={datetime} onChange={(e) => setDatetime(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)", color: "var(--rv-text)", fontSize: 12, colorScheme: "dark" }} />
          <select value={repeat} onChange={(e) => setRepeat(e.target.value)} style={selectStyle}>
            <option value="">No repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} style={selectStyle}>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--rv-text-dim)", marginBottom: 10 }}>
          <span>Notify:</span>
          {["site", "push", "email"].map(k => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={!!notify[k]} onChange={() => setNotify(prev => ({ ...prev, [k]: !prev[k] }))} />
              {k}
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={pgBtnPrimary} onClick={save}>Save</button>
          <button style={pgBtn} onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "12px 14px",
      background: "var(--rv-card-bg)", border: "1px solid var(--rv-border)",
      borderRadius: 10,
      borderLeft: r.priority === "high" ? "3px solid oklch(0.82 0.17 50)" : "1px solid var(--rv-border)",
      opacity: r.completed ? 0.5 : 1,
    }}>
      <button onClick={onToggle} style={{
        all: "unset", cursor: "pointer",
        width: 18, height: 18, borderRadius: 6,
        border: `1.5px solid ${r.completed ? "var(--rv-accent)" : "var(--rv-border)"}`,
        background: r.completed ? "var(--rv-accent)" : "transparent",
        display: "grid", placeItems: "center",
        color: "#1a1510", fontSize: 11,
      }}>{r.completed && "✓"}</button>
      <span style={{ fontFamily: "var(--rv-mono)", fontSize: 11, color: "var(--rv-accent)", minWidth: 160 }}>
        {r.datetime ? new Date(r.datetime).toLocaleString() : ""}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: "var(--rv-text)", textDecoration: r.completed ? "line-through" : "none" }}>{r.title || ""}</div>
        {(r.repeat || r.notify) && (
          <div style={{ fontSize: 10.5, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", marginTop: 2 }}>
            {r.repeat ? `↻ ${r.repeat}` : ""}
            {r.notify && Object.entries(r.notify).filter(([, v]) => v).length > 0 ? ` · 🔔 ${Object.entries(r.notify).filter(([, v]) => v).map(([k]) => k).join(", ")}` : ""}
          </div>
        )}
      </div>
      {r.priority === "high" && <span style={{ color: "oklch(0.82 0.17 50)", fontSize: 13 }}>★</span>}
      <button style={{ ...pgBtn, height: 26, padding: "0 8px", fontSize: 11 }} onClick={() => snooze(1)}>+1h</button>
      <button style={{ ...pgBtn, height: 26, padding: "0 8px", fontSize: 11 }} onClick={() => snooze(24)}>+1d</button>
      <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={() => setEditing(true)}>Edit</button>
      <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={async () => {
        const ok = await window.rvConfirm("Delete this reminder?", { title: "Delete reminder", primaryLabel: "Delete", danger: true });
        if (!ok) return;
        await fetch(`/api/reminders/${r.id}`, { method: "DELETE", credentials: "same-origin" });
        onChanged && onChanged();
      }}>×</button>
    </div>
  );
}

function NewReminderForm({ onDone, onCancel }) {
  const [title, setTitle] = React.useState("");
  const [datetime, setDatetime] = React.useState(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
  const [priority, setPriority] = React.useState("normal");
  const submit = async () => {
    if (!title.trim()) return;
    await fetch("/api/reminders", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, datetime, priority }),
    });
    onDone();
  };
  return (
    <div style={{
      padding: "14px 28px", borderBottom: "1px solid var(--rv-border)",
      background: "var(--rv-card-bg)", display: "flex", gap: 10, alignItems: "center",
    }}>
      <TextInput value={title} onChange={setTitle} placeholder="Reminder" autoFocus onEnter={submit} style={{ flex: 1 }} />
      <input
        type="datetime-local"
        value={datetime}
        onChange={(e) => setDatetime(e.target.value)}
        style={{
          padding: "8px 12px", borderRadius: 8,
          background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)",
          color: "var(--rv-text)", fontSize: 13, fontFamily: "inherit", outline: "none",
          colorScheme: "dark",
        }}
      />
      <select value={priority} onChange={(e) => setPriority(e.target.value)} style={{
        padding: "8px 12px", borderRadius: 8,
        background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)",
        color: "var(--rv-text)", fontSize: 13, fontFamily: "inherit",
      }}>
        <option value="normal">Normal</option>
        <option value="high">High</option>
      </select>
      <button style={pgBtnPrimary} onClick={submit}>Create</button>
      <button style={pgBtn} onClick={onCancel}>Cancel</button>
    </div>
  );
}

/* ============ MONEY ============ */
const MONEY_CATEGORIES = [
  { id: "food",           label: "🍕 Food" },
  { id: "transportation", label: "🚗 Transportation" },
  { id: "entertainment",  label: "🎬 Entertainment" },
  { id: "shopping",       label: "🛍️ Shopping" },
  { id: "bills",          label: "💡 Bills" },
  { id: "health",         label: "🏥 Health" },
  { id: "savings",        label: "💰 Savings" },
  { id: "other",          label: "📦 Other" },
];
const catLabel = (id) => MONEY_CATEGORIES.find(c => c.id === id)?.label || id;
const money$ = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const selectStyle = {
  padding: "8px 12px", borderRadius: 8,
  background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)",
  color: "var(--rv-text)", fontSize: 13, fontFamily: "inherit", cursor: "pointer",
};

function MoneyView({ currentUser }) {
  const { data, loading, error, reload } = useApi("/api/money");
  const money = data || {};
  const balances = money.balances || {};
  const transactions = Array.isArray(money.transactions) ? money.transactions : [];
  const goals = Array.isArray(money.goals) ? money.goals : [];
  const recurring = Array.isArray(money.recurring) ? money.recurring : [];
  const investments = money.investments || { holdings: [] };
  const setup = money.setup;

  const [showTxn, setShowTxn] = React.useState(false);
  const [showGoal, setShowGoal] = React.useState(false);
  const [showRec, setShowRec] = React.useState(false);
  const [showInv, setShowInv] = React.useState(false);
  const [txnFilter, setTxnFilter] = React.useState("week"); // week | month | all

  if (!loading && !error && !setup) return <MoneySetup onDone={reload} />;

  const totalBalance = Object.values(balances).reduce((a, b) => a + (b?.amount || 0), 0);
  const totalGoalsSaved = goals.reduce((a, g) => a + (g.currentAmount || 0), 0);
  const portfolioValue = (investments.holdings || []).reduce(
    (a, h) => a + (h.value || (h.shares || 0) * (h.currentPrice || h.avgPrice || 0)), 0);
  const netWorth = totalBalance + totalGoalsSaved + portfolioValue;

  // Period filter for transactions
  const now = Date.now();
  const periodMs = txnFilter === "week" ? 7 * 86400000
    : txnFilter === "month" ? 30 * 86400000
    : Infinity;
  const filteredTxns = transactions.filter(t => {
    if (periodMs === Infinity) return true;
    const ts = t.date ? new Date(t.date).getTime() : (t.createdAt || 0);
    return (now - ts) <= periodMs;
  });
  const periodIn = filteredTxns
    .filter(t => t.type === "income" || t.type === "deposit")
    .reduce((a, t) => a + (t.amount || 0), 0);
  const periodOut = filteredTxns
    .filter(t => !(t.type === "income" || t.type === "deposit"))
    .reduce((a, t) => a + (t.amount || 0), 0);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader
        title="Money"
        meta={!loading && !error ? money$(totalBalance) : undefined}
        actions={<>
          <button style={pgBtn} onClick={() => setShowGoal(true)}><IconPlus size={12} /> Goal</button>
          <button style={pgBtn} onClick={() => setShowRec(true)}><IconPlus size={12} /> Recurring</button>
          <button style={pgBtn} onClick={() => setShowInv(true)}><IconPlus size={12} /> Investment</button>
          <button style={pgBtnPrimary} onClick={() => setShowTxn(true)}><IconPlus size={12} /> Transaction</button>
        </>}
      />
      {showTxn && <NewTxnForm currentUser={currentUser} onDone={() => { setShowTxn(false); reload(); }} onCancel={() => setShowTxn(false)} />}
      {showGoal && <NewGoalForm onDone={() => { setShowGoal(false); reload(); }} onCancel={() => setShowGoal(false)} />}
      {showRec && <NewRecurringForm currentUser={currentUser} onDone={() => { setShowRec(false); reload(); }} onCancel={() => setShowRec(false)} />}
      {showInv && <NewInvestmentForm onDone={() => { setShowInv(false); reload(); }} onCancel={() => setShowInv(false)} />}
      <PageBody>
        {loading ? <Spinner />
          : error ? <Empty title="Couldn't load money data" subtitle={error} />
          : (
            <>
              {/* Net Worth Snapshot */}
              <Section title="Snapshot">
                <Card padding={20}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 20 }}>
                    <div>
                      <div style={{ fontSize: 11, fontFamily: "var(--rv-mono)", color: "var(--rv-text-faint)", letterSpacing: 1.2, textTransform: "uppercase" }}>Net Worth</div>
                      <div style={{ fontSize: 34, fontWeight: 600, fontFamily: "var(--rv-mono)", color: "var(--rv-text)", marginTop: 6, letterSpacing: -0.5 }}>
                        {money$(netWorth)}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(120px, 1fr))", gap: 20 }}>
                      <SnapStat label="Cash" value={money$(totalBalance)} />
                      <SnapStat label="Saved" value={money$(totalGoalsSaved)} />
                      <SnapStat label="Portfolio" value={money$(portfolioValue)} />
                    </div>
                  </div>
                </Card>
              </Section>

              {/* Balances */}
              <Section title="Balances">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                  {Object.entries(balances).map(([u, b]) => (
                    <Card key={u} padding={16}>
                      <div style={{ fontSize: 11, fontFamily: "var(--rv-mono)", color: "var(--rv-text-faint)", letterSpacing: 0.8, textTransform: "uppercase" }}>{u}</div>
                      <div style={{
                        fontSize: 22, fontWeight: 500, marginTop: 8, fontFamily: "var(--rv-mono)",
                        color: (b?.amount || 0) < 0 ? "oklch(0.75 0.18 30)" : "var(--rv-text)",
                      }}>{money$(b?.amount || 0)}</div>
                      {b?.updatedAt && (
                        <div style={{ fontSize: 10.5, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", marginTop: 4 }}>
                          Updated {new Date(b.updatedAt).toLocaleDateString()}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </Section>

              {/* Goals */}
              <Section title="Goals" meta={goals.length > 0 ? `${goals.length}` : undefined}>
                {goals.length === 0
                  ? <div style={{ fontSize: 12, color: "var(--rv-text-faint)" }}>No goals yet. Add one to start saving toward something.</div>
                  : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                      {goals.map(g => <GoalCard key={g.id} goal={g} onChanged={reload} />)}
                    </div>
                  )
                }
              </Section>

              {/* Recurring */}
              {recurring.length > 0 && (
                <Section title="Recurring" meta={`${recurring.length}`}>
                  <div style={{ display: "grid", gap: 6 }}>
                    {recurring.map(r => (
                      <div key={r.id} style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "12px 14px",
                        background: "var(--rv-card-bg)", border: "1px solid var(--rv-border)",
                        borderRadius: 10,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: "var(--rv-text)" }}>{r.description || r.name}</div>
                          <div style={{ fontSize: 11, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", marginTop: 2 }}>
                            {r.frequency || "monthly"} · {catLabel(r.category || "other")}
                          </div>
                        </div>
                        <div style={{
                          fontFamily: "var(--rv-mono)", fontSize: 13,
                          color: r.type === "income" || r.type === "deposit" ? "oklch(0.85 0.14 150)" : "var(--rv-text)",
                        }}>{r.type === "income" || r.type === "deposit" ? "+" : "−"}{money$(r.amount || 0)}</div>
                        <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={async () => {
                          await fetch(`/api/money/recurring/${r.id}/log`, { method: "POST", credentials: "same-origin" });
                          reload();
                        }}>Log</button>
                        <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={async () => {
                          const ok = await window.rvConfirm(`Delete recurring "${r.description || r.name || "entry"}"?`, { title: "Delete recurring", primaryLabel: "Delete", danger: true });
                          if (!ok) return;
                          await fetch(`/api/money/recurring/${r.id}`, { method: "DELETE", credentials: "same-origin" });
                          reload();
                        }}>×</button>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Investments / Portfolio */}
              <Section
                title="Portfolio"
                meta={portfolioValue > 0 ? money$(portfolioValue) : undefined}
              >
                {(!Array.isArray(investments.holdings) || investments.holdings.length === 0)
                  ? <div style={{ fontSize: 12, color: "var(--rv-text-faint)" }}>No holdings yet. Click "+ Investment" to track a position.</div>
                  : (
                    <div style={{ border: "1px solid var(--rv-border)", borderRadius: 12, overflow: "hidden", background: "var(--rv-card-bg)" }}>
                      {investments.holdings.map((h, i) => <HoldingRow key={h.id || h.symbol || i} holding={h} isFirst={i === 0} onChanged={reload} />)}
                    </div>
                  )
                }
              </Section>

              {/* Transactions with period filter */}
              <Section
                title="Activity"
                meta={filteredTxns.length > 0
                  ? `${filteredTxns.length} · +${money$(periodIn)} / −${money$(periodOut)}`
                  : undefined}
                right={
                  <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--rv-input-bg)", border: "1px solid var(--rv-border)", borderRadius: 8 }}>
                    {["week", "month", "all"].map(p => (
                      <button key={p} onClick={() => setTxnFilter(p)} style={{
                        height: 24, padding: "0 10px", fontSize: 11, borderRadius: 6,
                        border: "none", cursor: "pointer", fontFamily: "var(--rv-mono)",
                        background: txnFilter === p ? "var(--rv-accent)" : "transparent",
                        color: txnFilter === p ? "var(--rv-bg)" : "var(--rv-text-faint)",
                        textTransform: "uppercase", letterSpacing: 1,
                      }}>{p}</button>
                    ))}
                  </div>
                }
              >
                {filteredTxns.length === 0
                  ? <div style={{ fontSize: 12, color: "var(--rv-text-faint)" }}>
                      {transactions.length === 0
                        ? 'No transactions yet. Click "+ Transaction" to add one.'
                        : `No transactions in the last ${txnFilter === "week" ? "week" : txnFilter === "month" ? "month" : "period"}.`}
                    </div>
                  : (
                    <div style={{ border: "1px solid var(--rv-border)", borderRadius: 12, overflow: "hidden", background: "var(--rv-card-bg)" }}>
                      {[...filteredTxns].reverse().slice(0, 80).map((t, i) => <TxnRow key={t.id} txn={t} isFirst={i === 0} onChanged={reload} />)}
                    </div>
                  )
                }
              </Section>

              {/* Budget */}
              <BudgetSection />
            </>
          )
        }
      </PageBody>
    </div>
  );
}

function SnapStat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontFamily: "var(--rv-mono)", color: "var(--rv-text-faint)", letterSpacing: 1, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 500, fontFamily: "var(--rv-mono)", color: "var(--rv-text)", marginTop: 4 }}>{value}</div>
    </div>
  );
}

function HoldingRow({ holding: h, isFirst, onChanged }) {
  const [trading, setTrading] = React.useState(false);
  const [tradeMode, setTradeMode] = React.useState("buy");
  const [shares, setShares] = React.useState("");
  const [price, setPrice] = React.useState("");
  const value = h.value || (h.shares || 0) * (h.currentPrice || h.avgPrice || 0);
  const cost = (h.shares || 0) * (h.avgPrice || 0);
  const gain = value - cost;
  const gainPct = cost > 0 ? (gain / cost) * 100 : 0;
  const trade = async () => {
    const s = parseFloat(shares);
    const p = parseFloat(price);
    if (!s || !p) return;
    await fetch(`/api/money/investments/${h.id}/${tradeMode}`, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: s, price: p }),
    });
    setShares(""); setPrice(""); setTrading(false);
    onChanged && onChanged();
  };
  if (trading) {
    return (
      <div style={{
        padding: "12px 18px",
        borderTop: isFirst ? "none" : "1px solid var(--rv-border)",
        background: "var(--rv-input-bg)",
        display: "grid", gridTemplateColumns: "90px 100px 140px 140px auto auto", gap: 10, alignItems: "center",
      }}>
        <div style={{ fontFamily: "var(--rv-mono)", fontSize: 12, color: "var(--rv-accent)", fontWeight: 600 }}>{h.symbol || h.ticker}</div>
        <select value={tradeMode} onChange={(e) => setTradeMode(e.target.value)} style={selectStyle}>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
        <TextInput value={shares} onChange={setShares} placeholder="Shares" type="number" onEnter={trade} />
        <TextInput value={price} onChange={setPrice} placeholder="Price per share" type="number" onEnter={trade} />
        <button style={pgBtnPrimary} onClick={trade}>Confirm</button>
        <button style={pgBtn} onClick={() => setTrading(false)}>Cancel</button>
      </div>
    );
  }
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "90px 1fr 120px 140px 120px auto auto",
      alignItems: "center", gap: 14, padding: "13px 18px",
      borderTop: isFirst ? "none" : "1px solid var(--rv-border)",
    }}>
      <div style={{ fontFamily: "var(--rv-mono)", fontSize: 12, color: "var(--rv-accent)", fontWeight: 600 }}>{h.symbol || h.ticker}</div>
      <div style={{ fontSize: 13, color: "var(--rv-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name || h.symbol}</div>
      <div style={{ fontFamily: "var(--rv-mono)", fontSize: 11, color: "var(--rv-text-faint)" }}>{h.shares} sh @ {money$(h.avgPrice || 0)}</div>
      <div style={{ fontFamily: "var(--rv-mono)", fontSize: 13, textAlign: "right", color: "var(--rv-text)" }}>{money$(value)}</div>
      <div style={{
        fontFamily: "var(--rv-mono)", fontSize: 11, textAlign: "right",
        color: gain >= 0 ? "oklch(0.85 0.14 150)" : "oklch(0.75 0.18 30)",
      }}>
        {gain >= 0 ? "+" : ""}{money$(gain)} ({gainPct >= 0 ? "+" : ""}{gainPct.toFixed(1)}%)
      </div>
      <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={() => setTrading(true)}>Trade</button>
      <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={async () => {
        const ok = await window.rvConfirm(`Remove ${h.symbol || "this holding"} from your portfolio?`, { title: "Remove holding", primaryLabel: "Remove", danger: true });
        if (!ok) return;
        await fetch(`/api/money/investments/${h.id}`, { method: "DELETE", credentials: "same-origin" });
        onChanged && onChanged();
      }}>×</button>
    </div>
  );
}

function NewInvestmentForm({ onDone, onCancel }) {
  const [symbol, setSymbol] = React.useState("");
  const [name, setName] = React.useState("");
  const [shares, setShares] = React.useState("");
  const [price, setPrice] = React.useState("");
  const submit = async () => {
    const sym = symbol.trim().toUpperCase();
    const s = parseFloat(shares);
    const p = parseFloat(price);
    if (!sym || !s || !p) return;
    await fetch("/api/money/investments", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym, ticker: sym, name: name || sym, shares: s, avgPrice: p, costBasis: s * p }),
    });
    onDone();
  };
  return (
    <div style={{
      padding: "14px 28px", borderBottom: "1px solid var(--rv-border)",
      background: "var(--rv-card-bg)", display: "grid",
      gridTemplateColumns: "120px 1fr 120px 140px auto auto", gap: 10, alignItems: "center",
    }}>
      <TextInput value={symbol} onChange={setSymbol} placeholder="Ticker" autoFocus onEnter={submit} />
      <TextInput value={name} onChange={setName} placeholder="Company name (optional)" onEnter={submit} />
      <TextInput value={shares} onChange={setShares} placeholder="Shares" type="number" onEnter={submit} />
      <TextInput value={price} onChange={setPrice} placeholder="Cost per share" type="number" onEnter={submit} />
      <button style={pgBtnPrimary} onClick={submit}>Add</button>
      <button style={pgBtn} onClick={onCancel}>Cancel</button>
    </div>
  );
}

function TxnRow({ txn: t, isFirst, onChanged }) {
  const [editing, setEditing] = React.useState(false);
  const [type, setType] = React.useState(t.type || "expense");
  const [description, setDescription] = React.useState(t.description || "");
  const [amount, setAmount] = React.useState(String(t.amount || ""));
  const [category, setCategory] = React.useState(t.category || "other");
  const income = (editing ? type : t.type) === "income" || (editing ? type : t.type) === "deposit";
  const save = async () => {
    await fetch(`/api/money/transactions/${t.id}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, description, amount: parseFloat(amount), category }),
    });
    setEditing(false);
    onChanged && onChanged();
  };
  if (editing) {
    return (
      <div style={{
        padding: "12px 18px",
        borderTop: isFirst ? "none" : "1px solid var(--rv-border)",
        background: "var(--rv-input-bg)",
        display: "grid", gridTemplateColumns: "120px 1fr 140px 160px auto auto", gap: 10, alignItems: "center",
      }}>
        <select value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="deposit">Deposit</option>
        </select>
        <TextInput value={description} onChange={setDescription} placeholder="Description" onEnter={save} />
        <TextInput value={amount} onChange={setAmount} placeholder="Amount" type="number" onEnter={save} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectStyle}>
          {MONEY_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button style={pgBtnPrimary} onClick={save}>Save</button>
        <button style={pgBtn} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    );
  }
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 140px 120px 120px auto auto",
      alignItems: "center", gap: 14, padding: "13px 18px",
      borderTop: isFirst ? "none" : "1px solid var(--rv-border)",
    }}>
      <div style={{ fontSize: 13, color: "var(--rv-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {t.description || catLabel(t.category) || "Transaction"}
      </div>
      <div style={{ fontSize: 11, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)" }}>
        {catLabel(t.category)}
      </div>
      <div style={{ fontFamily: "var(--rv-mono)", fontSize: 11, color: "var(--rv-text-faint)" }}>
        {t.date ? new Date(t.date).toLocaleDateString() : ""}
      </div>
      <div style={{
        fontFamily: "var(--rv-mono)", fontSize: 13, textAlign: "right",
        color: income ? "oklch(0.85 0.14 150)" : "var(--rv-text)",
      }}>{income ? "+" : "−"}{money$(t.amount || 0)}</div>
      <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={() => setEditing(true)}>Edit</button>
      <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={async () => {
        const ok = await window.rvConfirm(`Delete transaction "${t.description || catLabel(t.category) || "entry"}"?`, { title: "Delete transaction", primaryLabel: "Delete", danger: true });
        if (!ok) return;
        await fetch(`/api/money/transactions/${t.id}`, { method: "DELETE", credentials: "same-origin" });
        onChanged && onChanged();
      }}>×</button>
    </div>
  );
}

function BudgetSection() {
  const { data, loading, reload } = useApi("/api/budget");
  // Server shape: { categories: [{id, name, emoji, budgetAmount, color, pairedWith}] }
  const cats = data?.categories || data?.budget?.categories || [];
  const [newName, setNewName] = React.useState("");
  const [newBudget, setNewBudget] = React.useState("");
  const [newEmoji, setNewEmoji] = React.useState("📦");
  const [newColor, setNewColor] = React.useState("#e8b24a");
  const addCat = async () => {
    if (!newName.trim() || !parseFloat(newBudget)) return;
    await fetch("/api/budget/categories", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName,
        budgetAmount: parseFloat(newBudget),
        emoji: newEmoji || "📦",
        color: newColor,
      }),
    });
    setNewName(""); setNewBudget("");
    reload();
  };
  const del = async (id) => {
    const ok = await window.rvConfirm("Delete this budget category?", { title: "Delete category", primaryLabel: "Delete", danger: true });
    if (!ok) return;
    await fetch(`/api/budget/categories/${id}`, { method: "DELETE", credentials: "same-origin" });
    reload();
  };
  return (
    <Section title="Budget" meta={!loading ? `${cats.length} categories` : undefined}>
      <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
        {cats.map(c => {
          const spent = (c.spent || c.current || 0);
          const budgetAmount = c.budgetAmount ?? c.budget ?? 0;
          const pct = budgetAmount > 0 ? Math.min(100, (spent / budgetAmount) * 100) : 0;
          return (
            <div key={c.id} style={{
              display: "grid", gridTemplateColumns: "32px 1fr 220px 120px auto",
              alignItems: "center", gap: 14,
              padding: "12px 14px", background: "var(--rv-card-bg)",
              border: "1px solid var(--rv-border)",
              borderLeft: `3px solid ${c.color || "var(--rv-accent)"}`,
              borderRadius: 10,
            }}>
              <div style={{ fontSize: 18, lineHeight: 1 }}>{c.emoji || "📦"}</div>
              <div style={{ fontSize: 13, color: "var(--rv-text)" }}>{c.name}</div>
              <div>
                <div style={{ height: 6, borderRadius: 3, background: "var(--rv-input-bg)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: `${pct}%`,
                    background: pct > 90 ? "oklch(0.75 0.18 30)" : (c.color || "var(--rv-accent)"),
                  }} />
                </div>
                <div style={{ fontSize: 10.5, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", marginTop: 3 }}>
                  {money$(spent)} of {money$(budgetAmount)} ({Math.round(pct)}%)
                </div>
              </div>
              <div style={{ fontFamily: "var(--rv-mono)", fontSize: 12, color: "var(--rv-accent)", textAlign: "right" }}>
                {money$(Math.max(0, budgetAmount - spent))} left
              </div>
              <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={() => del(c.id)}>×</button>
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 180px 40px auto", gap: 10, alignItems: "center" }}>
        <TextInput value={newEmoji} onChange={setNewEmoji} placeholder="📦" />
        <TextInput value={newName} onChange={setNewName} placeholder="Category name" onEnter={addCat} />
        <TextInput value={newBudget} onChange={setNewBudget} placeholder="Monthly budget $" type="number" onEnter={addCat} />
        <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)}
          style={{ width: 36, height: 32, borderRadius: 6, border: "1px solid var(--rv-border)", background: "var(--rv-input-bg)" }} />
        <button style={pgBtnPrimary} onClick={addCat}>Add</button>
      </div>
    </Section>
  );
}

function GoalCard({ goal, onChanged }) {
  const [show, setShow] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const pct = goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
  const contribute = async (op) => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    await fetch(`/api/money/goals/${goal.id}/${op}`, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: n }),
    });
    setAmount(""); setShow(false);
    onChanged && onChanged();
  };
  return (
    <Card padding={16} hoverable={false}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: "var(--rv-text)", fontWeight: 500 }}>{goal.name}</div>
          <div style={{ fontSize: 11, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", marginTop: 2 }}>
            {money$(goal.currentAmount)} of {money$(goal.targetAmount)}
          </div>
        </div>
        <div style={{ fontSize: 11, fontFamily: "var(--rv-mono)", color: goal.completedAt ? "oklch(0.85 0.14 150)" : "var(--rv-accent)" }}>
          {goal.completedAt ? "✓ Done" : `${Math.round(pct)}%`}
        </div>
      </div>
      <div style={{ marginTop: 10, height: 6, borderRadius: 3, background: "var(--rv-input-bg)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: goal.color || "var(--rv-accent)", transition: "width 300ms" }} />
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={() => setShow(!show)}>
          {show ? "Cancel" : "Contribute"}
        </button>
        <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={async () => {
          const ok = await window.rvConfirm(`Delete goal "${goal.name}"? Any saved amount returns to your balance.`, { title: "Delete goal", primaryLabel: "Delete", danger: true });
          if (!ok) return;
          await fetch(`/api/money/goals/${goal.id}`, { method: "DELETE", credentials: "same-origin" });
          onChanged && onChanged();
        }}>Delete</button>
      </div>
      {show && (
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <TextInput value={amount} onChange={setAmount} placeholder="Amount" type="number" style={{ flex: 1 }} onEnter={() => contribute("contribute")} />
          <button style={{ ...pgBtnPrimary, height: 30, padding: "0 12px", fontSize: 11.5 }} onClick={() => contribute("contribute")}>Add</button>
          <button style={{ ...pgBtn, height: 30, padding: "0 12px", fontSize: 11.5 }} onClick={() => contribute("withdraw")}>Withdraw</button>
        </div>
      )}
    </Card>
  );
}

function NewTxnForm({ onDone, onCancel, currentUser }) {
  const [type, setType] = React.useState("expense");
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [category, setCategory] = React.useState("other");
  const [split, setSplit] = React.useState(false);
  const submit = async () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    await fetch("/api/money/transactions", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, description, amount: n, category, paidBy: currentUser, split }),
    });
    onDone();
  };
  return (
    <div style={{
      padding: "14px 28px", borderBottom: "1px solid var(--rv-border)",
      background: "var(--rv-card-bg)", display: "grid",
      gridTemplateColumns: "120px 1fr 140px 170px auto auto auto", gap: 10, alignItems: "center",
    }}>
      <select value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
        <option value="expense">Expense</option>
        <option value="income">Income</option>
        <option value="deposit">Deposit</option>
      </select>
      <TextInput value={description} onChange={setDescription} placeholder="Description" autoFocus onEnter={submit} />
      <TextInput value={amount} onChange={setAmount} placeholder="Amount" type="number" onEnter={submit} />
      <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectStyle}>
        {MONEY_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--rv-text-dim)" }}>
        <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Split
      </label>
      <button style={pgBtnPrimary} onClick={submit}>Save</button>
      <button style={pgBtn} onClick={onCancel}>Cancel</button>
    </div>
  );
}

function NewGoalForm({ onDone, onCancel }) {
  const [name, setName] = React.useState("");
  const [target, setTarget] = React.useState("");
  const [color, setColor] = React.useState("#e8b24a");
  const submit = async () => {
    if (!name.trim() || !parseFloat(target)) return;
    await fetch("/api/money/goals", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, targetAmount: parseFloat(target), color }),
    });
    onDone();
  };
  return (
    <div style={{
      padding: "14px 28px", borderBottom: "1px solid var(--rv-border)",
      background: "var(--rv-card-bg)", display: "flex", gap: 10, alignItems: "center",
    }}>
      <TextInput value={name} onChange={setName} placeholder="Goal name" autoFocus onEnter={submit} style={{ flex: 1 }} />
      <TextInput value={target} onChange={setTarget} placeholder="Target $" type="number" onEnter={submit} style={{ width: 140 }} />
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
        style={{ width: 40, height: 36, borderRadius: 8, border: "1px solid var(--rv-input-border)", background: "var(--rv-input-bg)" }} />
      <button style={pgBtnPrimary} onClick={submit}>Create</button>
      <button style={pgBtn} onClick={onCancel}>Cancel</button>
    </div>
  );
}

function NewRecurringForm({ onDone, onCancel, currentUser }) {
  const [type, setType] = React.useState("expense");
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [category, setCategory] = React.useState("bills");
  const [frequency, setFrequency] = React.useState("monthly");
  const submit = async () => {
    const n = parseFloat(amount);
    if (!n || !description.trim()) return;
    await fetch("/api/money/recurring", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, description, amount: n, category, frequency, paidBy: currentUser }),
    });
    onDone();
  };
  return (
    <div style={{
      padding: "14px 28px", borderBottom: "1px solid var(--rv-border)",
      background: "var(--rv-card-bg)", display: "grid",
      gridTemplateColumns: "120px 1fr 140px 170px 140px auto auto", gap: 10, alignItems: "center",
    }}>
      <select value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
        <option value="expense">Expense</option>
        <option value="income">Income</option>
      </select>
      <TextInput value={description} onChange={setDescription} placeholder="Description" autoFocus onEnter={submit} />
      <TextInput value={amount} onChange={setAmount} placeholder="Amount" type="number" onEnter={submit} />
      <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectStyle}>
        {MONEY_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <select value={frequency} onChange={(e) => setFrequency(e.target.value)} style={selectStyle}>
        <option value="weekly">Weekly</option>
        <option value="biweekly">Biweekly</option>
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
      </select>
      <button style={pgBtnPrimary} onClick={submit}>Save</button>
      <button style={pgBtn} onClick={onCancel}>Cancel</button>
    </div>
  );
}

function MoneySetup({ onDone }) {
  const [k, setK] = React.useState("0");
  const [kt, setKt] = React.useState("0");
  const submit = async () => {
    await fetch("/api/money/setup", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kaliph: k, kathrine: kt }),
    });
    onDone();
  };
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader title="Money" subtitle="One-time setup — enter starting balances" />
      <PageBody>
        <div style={{ maxWidth: 400, margin: "40px auto 0", display: "grid", gap: 14 }}>
          <label style={{ fontSize: 12, color: "var(--rv-text-dim)" }}>
            Kaliph starting balance
            <TextInput value={k} onChange={setK} placeholder="0" type="number" />
          </label>
          <label style={{ fontSize: 12, color: "var(--rv-text-dim)" }}>
            Kathrine starting balance
            <TextInput value={kt} onChange={setKt} placeholder="0" type="number" />
          </label>
          <button style={pgBtnPrimary} onClick={submit}>Save</button>
        </div>
      </PageBody>
    </div>
  );
}

/* ============ AUTHENTICATOR ============ */
function AuthView() {
  const [status, setStatus] = React.useState(null);
  const [pw, setPw] = React.useState("");
  const [err, setErr] = React.useState("");
  const refresh = () => fetch("/api/totp/status", { credentials: "same-origin" }).then(r => r.json()).then(setStatus);
  React.useEffect(() => { refresh(); }, []);
  if (!status) return <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
    <PageHeader title="Authenticator" />
    <PageBody><Spinner /></PageBody>
  </div>;

  if (!status.hasPassword) {
    const setup = async () => {
      setErr("");
      if (pw.length < 4) { setErr("Minimum 4 characters"); return; }
      const r = await fetch("/api/totp/set-password", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error || "Failed"); return; }
      setPw(""); refresh();
    };
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <PageHeader title="Authenticator" subtitle="Create an authenticator password to protect your 2FA codes" />
        <PageBody>
          <div style={{ maxWidth: 360, margin: "40px auto 0", display: "grid", gap: 10 }}>
            <TextInput value={pw} onChange={setPw} placeholder="New password (min 4 chars)" type="password" onEnter={setup} autoFocus />
            {err && <div style={{ color: "oklch(0.75 0.18 30)", fontSize: 12 }}>{err}</div>}
            <button style={pgBtnPrimary} onClick={setup}>Set password</button>
          </div>
        </PageBody>
      </div>
    );
  }

  if (!status.unlocked) {
    const unlock = async () => {
      if (!pw.trim()) { setErr("Enter your password"); return; }
      setErr("");
      const r = await fetch("/api/totp/auth", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error || "Incorrect password"); return; }
      setPw(""); refresh();
    };
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <PageHeader title="Authenticator" />
        <PageBody>
          <div style={{ display: "grid", placeItems: "center", padding: "40px 20px 60px" }}>
            <div style={{
              width: "100%", maxWidth: 380, padding: 28,
              background: "var(--rv-card-bg)",
              border: "1px solid var(--rv-border)",
              borderRadius: 16,
              boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
              textAlign: "center",
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: 16,
                background: "var(--rv-accent-soft)",
                border: "1px solid var(--rv-accent-line)",
                display: "grid", placeItems: "center", margin: "0 auto 18px",
                color: "var(--rv-accent)",
                boxShadow: "0 0 30px var(--rv-accent-glow)",
              }}><IconAuth size={26} /></div>
              <div style={{ fontSize: 18, color: "var(--rv-text)", fontWeight: 600, marginBottom: 6 }}>
                Authenticator locked
              </div>
              <div style={{
                fontFamily: "var(--rv-mono)", fontSize: 11, color: "var(--rv-text-faint)",
                letterSpacing: 0.4, marginBottom: 22,
              }}>
                Enter your password to view 2FA codes
              </div>
              <TextInput
                value={pw} onChange={setPw}
                placeholder="Password" type="password"
                onEnter={unlock} autoFocus
              />
              {err && <div style={{ color: "oklch(0.75 0.18 30)", fontSize: 12, marginTop: 10, textAlign: "left" }}>{err}</div>}
              <button
                onClick={unlock}
                style={{
                  all: "unset", cursor: "pointer",
                  display: "grid", placeItems: "center",
                  width: "100%", height: 40, marginTop: 14,
                  boxSizing: "border-box",
                  borderRadius: 10,
                  background: "var(--rv-accent)",
                  color: "#1a1510",
                  fontSize: 13.5, fontWeight: 600,
                  letterSpacing: 0.2,
                  textAlign: "center",
                }}
              >Unlock</button>
            </div>
          </div>
        </PageBody>
      </div>
    );
  }

  return <AuthUnlocked onLocked={refresh} />;
}

function AuthUnlocked({ onLocked }) {
  const { data, loading, error, status: httpStatus, reload } = useApi("/api/totp/accounts");
  // If the server says we're actually locked (403), bounce back to the gate.
  React.useEffect(() => { if (httpStatus === 403) onLocked(); }, [httpStatus]);
  const accounts = Array.isArray(data) ? data : [];
  const [now, setNow] = React.useState(Date.now());
  const [adding, setAdding] = React.useState(false);
  React.useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const lock = async () => {
    await fetch("/api/totp/lock", { method: "POST", credentials: "same-origin" });
    onLocked();
  };
  const remove = async (id) => {
    const ok = await window.rvConfirm("Delete this 2FA token? You'll need to re-scan or re-enter its secret.", { title: "Delete token", primaryLabel: "Delete", danger: true });
    if (!ok) return;
    await fetch(`/api/totp/accounts/${id}`, { method: "DELETE", credentials: "same-origin" });
    reload();
  };
  const period = 30;
  const secondsLeft = period - Math.floor(now / 1000) % period;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader
        title="Authenticator"
        meta={!loading && !error ? `${accounts.length} token${accounts.length === 1 ? "" : "s"}` : undefined}
        actions={<>
          <button style={pgBtnPrimary} onClick={() => setAdding(true)}><IconPlus size={12} /> Add token</button>
          <button style={pgBtn} onClick={lock}>Lock</button>
        </>}
      />
      {adding && <AddTokenForm onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />}
      <PageBody>
        {loading ? <Spinner />
          : error ? <Empty title="Couldn't load tokens" subtitle={error} />
          : accounts.length === 0 ? <Empty title="No tokens" subtitle="Add a 2FA token to get started." />
          : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {accounts.map((a) => (
                <TOTPCard key={a.id} account={a} now={now} period={period} secondsLeft={secondsLeft} onChanged={reload} onRemove={() => remove(a.id)} />
              ))}
            </div>
          )
        }
      </PageBody>
    </div>
  );
}

function TOTPCard({ account: a, now, period, secondsLeft, onChanged, onRemove }) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(a.name || "");
  const [issuer, setIssuer] = React.useState(a.issuer || "");
  const [copied, setCopied] = React.useState(false);
  const copyTimerRef = React.useRef(null);
  React.useEffect(() => () => clearTimeout(copyTimerRef.current), []);
  const save = async () => {
    await fetch(`/api/totp/accounts/${a.id}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, issuer }),
    });
    setEditing(false);
    onChanged && onChanged();
  };
  const rawCode = generateTOTP(a.secret, now, period);
  const copyCode = async () => {
    if (!rawCode) return;
    try {
      await navigator.clipboard.writeText(rawCode);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = rawCode;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1400);
  };
  return (
    <Card padding={18}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <>
              <TextInput value={issuer} onChange={setIssuer} placeholder="Issuer" style={{ marginBottom: 6 }} />
              <TextInput value={name} onChange={setName} placeholder="Name" onEnter={save} />
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, fontFamily: "var(--rv-mono)", color: "var(--rv-text-faint)", letterSpacing: 0.8, textTransform: "uppercase" }}>{a.issuer || "TOKEN"}</div>
              <div style={{ fontSize: 13, color: "var(--rv-text)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
            </>
          )}
        </div>
        {editing ? (
          <>
            <button onClick={save} style={{ all: "unset", cursor: "pointer", color: "var(--rv-accent)", padding: 4, fontSize: 11 }}>Save</button>
            <button onClick={() => setEditing(false)} style={{ all: "unset", cursor: "pointer", color: "var(--rv-text-faint)", padding: 4, fontSize: 11 }}>Cancel</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} style={{ all: "unset", cursor: "pointer", color: "var(--rv-text-faint)", padding: 4, fontSize: 11 }}>Edit</button>
            <button onClick={onRemove} style={{ all: "unset", cursor: "pointer", color: "var(--rv-text-faint)", padding: 4 }} title="Delete">×</button>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={copyCode}
        title={copied ? "Copied to clipboard" : "Click to copy"}
        style={{
          all: "unset", display: "block", width: "100%",
          fontFamily: "var(--rv-mono)", fontSize: 26,
          color: copied ? "oklch(0.85 0.14 150)" : "var(--rv-accent)",
          letterSpacing: 3, marginTop: 10, cursor: "pointer",
          textShadow: copied ? "none" : "0 0 16px var(--rv-accent-glow)",
          transition: "color 180ms ease",
        }}
      >
        {copied ? "Copied ✓" : (rawCode.match(/.{1,3}/g)?.join(" ") || "— — —")}
      </button>
      <div style={{ marginTop: 10, height: 3, borderRadius: 2, background: "var(--rv-input-bg)", overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${(secondsLeft / period) * 100}%`,
          background: "var(--rv-accent)", transition: "width 1s linear",
        }} />
      </div>
    </Card>
  );
}

function AddTokenForm({ onDone, onCancel }) {
  const [name, setName] = React.useState("");
  const [issuer, setIssuer] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [err, setErr] = React.useState("");
  const submit = async () => {
    setErr("");
    if (!name.trim() || !secret.trim()) { setErr("Name and secret are required"); return; }
    const r = await fetch("/api/totp/accounts", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), issuer: issuer.trim(), secret: secret.replace(/\s+/g, "") }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error || `HTTP ${r.status}`); return; }
    onDone();
  };
  return (
    <div style={{
      padding: "14px 28px", borderBottom: "1px solid var(--rv-border)",
      background: "var(--rv-card-bg)",
    }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <TextInput value={name} onChange={setName} placeholder="Account name (e.g. Gmail)" autoFocus onEnter={submit} style={{ flex: 1 }} />
        <TextInput value={issuer} onChange={setIssuer} placeholder="Issuer (optional)" onEnter={submit} style={{ flex: 1 }} />
        <TextInput value={secret} onChange={setSecret} placeholder="Base32 secret" onEnter={submit} style={{ flex: 1.3 }} />
        <button style={pgBtnPrimary} onClick={submit}>Add</button>
        <button style={pgBtn} onClick={onCancel}>Cancel</button>
      </div>
      {err && <div style={{ marginTop: 8, color: "oklch(0.75 0.18 30)", fontSize: 12 }}>{err}</div>}
    </div>
  );
}

// Minimal TOTP generator — RFC 6238 with SHA-1, 6 digits, 30s period.
function generateTOTP(secret, nowMs = Date.now(), period = 30, digits = 6) {
  try {
    const key = base32Decode(secret);
    const counter = Math.floor(nowMs / 1000 / period);
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(4, counter);
    return hotpSync(key, new Uint8Array(buf), digits);
  } catch {
    return "------";
  }
}
function base32Decode(str) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = str.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  const bytes = [];
  let bits = 0, value = 0;
  for (const c of clean) {
    const v = alphabet.indexOf(c);
    if (v < 0) continue;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 0xff); }
  }
  return new Uint8Array(bytes);
}
// HMAC-SHA1 implemented via SubtleCrypto is async; we need sync-ish for render.
// Use a pre-computed cache that updates every period so render stays fast.
const _totpCache = new Map();
function hotpSync(key, counterBytes, digits) {
  const cacheKey = Array.from(key).join(",") + "|" + Array.from(counterBytes).join(",");
  if (_totpCache.has(cacheKey)) return _totpCache.get(cacheKey);
  // Compute asynchronously and cache; return placeholder on first call
  crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"])
    .then(k => crypto.subtle.sign("HMAC", k, counterBytes))
    .then(sig => {
      const h = new Uint8Array(sig);
      const offset = h[h.length - 1] & 0xf;
      const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
      const digit = String(code % Math.pow(10, digits)).padStart(digits, "0");
      _totpCache.set(cacheKey, digit);
    }).catch(() => {});
  return "------";
}

/* ============ K-108 (fallback — nav normally handled by Sidebar) ============ */
function IntelView() {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader title="K-108" />
      <PageBody>
        <Empty
          title="K-108 has its own login"
          subtitle="Open it in its own page to sign in."
          action={<button style={pgBtnPrimary} onClick={() => {
            const t = window.parent && window.parent !== window ? window.parent : window;
            t.location.href = "/k108";
          }}>Open K-108</button>}
        />
      </PageBody>
    </div>
  );
}

/* ============ SETTINGS ============ */
const VAULT_THEME_LIST = [
  { id: "royal-vault",    name: "Royal Vault",     swatch: "linear-gradient(135deg,#1a1510,#7a5a2e,#e8b24a)" },
  { id: "graphite-teal",  name: "Graphite & Teal", swatch: "linear-gradient(135deg,#0f1718,#123234,#00D8BB)" },
  { id: "apple-music",    name: "Apple Music",     swatch: "linear-gradient(135deg,#000000,#fa2d48,#ff6482)" },
];

// Map a user-facing vault theme id → the internal variation letter that
// the <html data-variant="X"> CSS is keyed to.
const VAULT_THEME_VARIATION = {
  "royal-vault":   "A",
  "graphite-teal": "D",
  "apple-music":   "E",
};
// Map a user-facing vault theme id → the hue used by hue-driven components
// (e.g. Composer's border beam). Teal ≈ 180°, royal amber ≈ 72°, Apple pink ≈ 17°.
const VAULT_THEME_HUE = {
  "royal-vault":   72,
  "graphite-teal": 180,
  "apple-music":   17,
};
Object.assign(window, { VAULT_THEME_VARIATION, VAULT_THEME_HUE });

function SettingsView({ currentUser, contact, onProfileSaved }) {
  const [me, setMe] = React.useState(null);
  const [site, setSite] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 1500); };
  const load = () => {
    if (!currentUser) return;
    fetch("/api/users", { credentials: "same-origin" }).then(r => r.json())
      .then(users => setMe(users[currentUser] || null));
    fetch("/api/settings", { credentials: "same-origin" }).then(r => r.ok ? r.json() : null)
      .then(s => setSite(s));
  };
  React.useEffect(load, [currentUser]);

  const patchUser = async (patch) => {
    await fetch(`/api/users/${currentUser}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setMe(prev => ({ ...(prev || {}), ...patch }));
    flash("Saved");
    onProfileSaved && onProfileSaved();
  };

  const uploadAvatar = async (file) => {
    const fd = new FormData();
    fd.append("avatar", file);
    const r = await fetch(`/api/users/${currentUser}/avatar`, {
      method: "POST", credentials: "same-origin", body: fd,
    });
    if (r.ok) {
      const { avatar } = await r.json();
      setMe(prev => ({ ...(prev || {}), avatar }));
      flash("Avatar updated");
      onProfileSaved && onProfileSaved();
    }
  };

  const switchSystem = () => window.__rvSwitchSystem && window.__rvSwitchSystem("original");

  if (!me) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader title="Settings" />
      <PageBody><Spinner /></PageBody>
    </div>
  );

  const emails = (site && site.emails) || {};
  const myEmails = Array.isArray(emails[currentUser]) ? emails[currentUser] : (emails[currentUser] ? [emails[currentUser]] : []);
  const currentTheme = me.vaultTheme || VAULT_THEME_LIST[0].id;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <PageHeader title="Settings" subtitle={toast || "Your preferences and account"} />
      <PageBody>
        <div style={{ maxWidth: 780, display: "grid", gap: 24 }}>

          <SettingsCard title="Profile">
            <SettingsRow label="Avatar" first value={<AvatarEditor me={me} onFile={uploadAvatar} />} />
            <SettingsRow label="Banner" value={<BannerEditor me={me} onFile={async (file) => {
              const fd = new FormData();
              fd.append("banner", file);
              const r = await fetch(`/api/users/${currentUser}/banner`, { method: "POST", credentials: "same-origin", body: fd });
              if (r.ok) {
                const { banner } = await r.json();
                setMe(prev => ({ ...(prev || {}), banner }));
                flash("Banner updated");
                onProfileSaved && onProfileSaved();
              }
            }} onClear={async () => {
              await patchUser({ banner: null });
            }} />} sub="Shown on your profile in the Thread Vault." />
            <SettingsRow label="Display name" value={
              <SettingsText defaultValue={me.displayName || ""} placeholder="Your display name" onSave={(v) => patchUser({ displayName: v })} />
            } />
            <SettingsRow label="Name color" value={
              <NameColorPicker value={me.nameStyle?.color || ""} onChange={(color) =>
                patchUser({ nameStyle: { ...(me.nameStyle || {}), color } })
              } />
            } sub="Color of your name in chat." />
            <SettingsRow label="Pronouns" value={
              <SettingsText defaultValue={me.pronouns || ""} placeholder={`e.g. "she/her"`} onSave={(v) => patchUser({ pronouns: v })} />
            } />
            <SettingsRow label="Bio" value={
              <SettingsText multiline defaultValue={me.bio || ""} placeholder="A short bio shown on your profile" onSave={(v) => patchUser({ bio: v })} />
            } />
            <SettingsRow label="Custom status" value={
              <SettingsText defaultValue={me.customStatus || ""} placeholder={`e.g. "working"`} onSave={(v) => patchUser({ customStatus: v })} />
            } />
          </SettingsCard>

          <SettingsCard title="Appearance">
            <SettingsRow label="Site system" first value={
              <select
                value="vault"
                onChange={(e) => { if (e.target.value === "original") switchSystem(); }}
                style={{
                  padding: "8px 12px", borderRadius: 8,
                  background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)",
                  color: "var(--rv-text)", fontSize: 13, minWidth: 200,
                }}
              >
                <option value="original">Original Release</option>
                <option value="vault">Modified Vault</option>
              </select>
            } sub="Switches the entire visual system." />
            <SettingsRow label="Theme" value={
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {VAULT_THEME_LIST.map(t => (
                  <button key={t.id} onClick={() => patchUser({ vaultTheme: t.id, theme: t.id })} style={{
                    all: "unset", cursor: "pointer",
                    display: "flex", flexDirection: "column", gap: 6,
                    padding: 6, borderRadius: 10,
                    border: `1px solid ${currentTheme === t.id ? "var(--rv-accent)" : "var(--rv-border)"}`,
                    background: currentTheme === t.id ? "var(--rv-accent-soft)" : "var(--rv-input-bg)",
                    width: 140,
                  }}>
                    <div style={{ height: 48, borderRadius: 6, background: t.swatch, border: "1px solid var(--rv-border)" }} />
                    <div style={{ fontSize: 12, color: "var(--rv-text)", display: "flex", alignItems: "center", gap: 6 }}>
                      {currentTheme === t.id && <span style={{ color: "var(--rv-accent)" }}>●</span>}
                      {t.name}
                    </div>
                  </button>
                ))}
              </div>
            } sub="Themes available within Modified Vault. More coming soon." />
          </SettingsCard>

          <SettingsCard title="Chat">
            <SettingsRow label="Chat wallpaper" first value={
              <SettingsSwitch value={!!me.wallpaperEnabled} onChange={(v) => patchUser({ wallpaperEnabled: v })} />
            } />
            <SettingsRow label="GIFs" value={
              <SettingsSwitch value={me.gifEnabled !== false} onChange={(v) => patchUser({ gifEnabled: v })} />
            } />
            <SettingsRow label="Sound effects" value={
              <SettingsSwitch value={me.soundEnabled !== false} onChange={(v) => patchUser({ soundEnabled: v })} />
            } />
            <SettingsRow label="Class countdown" value={
              <SettingsSwitch value={me.countdownEnabled !== false} onChange={(v) => patchUser({ countdownEnabled: v })} />
            } />
            <SettingsRow label="Performance mode" value={
              <SettingsSwitch value={!!me.perfMode} onChange={(v) => patchUser({ perfMode: v })} />
            } sub="Disables animations, blur, and shadows." />
          </SettingsCard>

          <SettingsCard title="Notifications">
            <SettingsRow label={`${me.displayName || currentUser}'s emails`} first value={
              <EmailList list={myEmails} onChange={async (next) => {
                const copy = { ...emails, [currentUser]: next };
                setSite(prev => ({ ...(prev || {}), emails: copy }));
                await fetch("/api/settings", {
                  method: "PUT", credentials: "same-origin",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ emails: copy }),
                });
                flash("Emails updated");
              }} />
            } sub="Where priority messages to you get emailed." />
            {contact?.handle && (
              <SettingsRow label={`${contact.name || contact.handle}'s emails`} value={
                <EmailList list={Array.isArray(emails[contact.handle]) ? emails[contact.handle] : (emails[contact.handle] ? [emails[contact.handle]] : [])} onChange={async (next) => {
                  const copy = { ...emails, [contact.handle]: next };
                  setSite(prev => ({ ...(prev || {}), emails: copy }));
                  await fetch("/api/settings", {
                    method: "PUT", credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ emails: copy }),
                  });
                  flash("Emails updated");
                }} />
              } sub={`Where priority messages to ${contact.name || contact.handle} get emailed.`} />
            )}
            <SettingsRow label="Shared fallback email" value={
              <SettingsText defaultValue={emails.shared || ""} placeholder="shared@email.com" onSave={async (v) => {
                const copy = { ...emails, shared: v };
                setSite(prev => ({ ...(prev || {}), emails: copy }));
                await fetch("/api/settings", {
                  method: "PUT", credentials: "same-origin",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ emails: copy }),
                });
                flash("Shared email updated");
              }} />
            } sub="Used when a user has no email of their own configured." />
          </SettingsCard>

          <SettingsCard title="Security">
            <SettingsRow label="Authenticator password" first value={
              <AuthPasswordEditor onFlash={flash} />
            } sub="Password that unlocks the 2FA authenticator." />
            <SettingsRow label="Locker passcode" value={
              <LockerPasscodeEditor onFlash={flash} />
            } sub="4-digit passcode that unlocks the Document Locker." />
            <SettingsRow label="Profile passcode" value={
              <ProfilePasscodeEditor me={me} onFlash={flash} onSaved={() => {
                setMe(prev => ({ ...(prev || {}), profilePasscode: prev?.profilePasscode ? prev.profilePasscode : "set" }));
                onProfileSaved && onProfileSaved();
              }} />
            } sub="4-digit PIN required when picking your profile at login." />
          </SettingsCard>

          <SettingsCard title="Keyboard shortcuts">
            {[
              ["Send message", "Enter"],
              ["New line in composer", "Shift + Enter"],
              ["Focus search", "Ctrl / ⌘ + K"],
              ["Go to Chat", "Ctrl / ⌘ + 1"],
              ["Go to Notes", "Ctrl / ⌘ + 2"],
              ["Go to Settings", "Ctrl / ⌘ + ,"],
              ["Cancel editing / close picker", "Escape"],
            ].map(([label, key], i) => (
              <div key={label} style={{
                display: "grid", gridTemplateColumns: "1fr auto",
                alignItems: "center", gap: 14, padding: "12px 18px",
                borderTop: i === 0 ? "none" : "1px solid var(--rv-border)",
              }}>
                <div style={{ fontSize: 13, color: "var(--rv-text)" }}>{label}</div>
                <kbd style={{
                  background: "var(--rv-input-bg)", border: "1px solid var(--rv-border)",
                  padding: "3px 10px", borderRadius: 6,
                  fontSize: 11.5, fontFamily: "var(--rv-mono)", color: "var(--rv-accent)",
                }}>{key}</kbd>
              </div>
            ))}
          </SettingsCard>

          <SettingsCard title="Bell schedule">
            <SettingsRow label="Weekly periods" first value={
              <BellScheduleEditor currentUser={currentUser} onFlash={flash} />
            } sub="Set up your class schedule — your current class shows in the chat." />
          </SettingsCard>

          <SettingsCard title="Feedback">
            <SettingsRow label="Send feedback" first value={
              <FeedbackForm onFlash={flash} />
            } sub="Report bugs or suggest features. Saved for later review." />
          </SettingsCard>

          <SettingsCard title="Account">
            <SettingsRow label="Signed in as" first value={me.displayName || currentUser} />
            <SettingsRow label="Partner" value={contact?.name || "—"} />
            <SettingsRow label="Partner presence" value={contact?.status === "online" ? "Online" : (contact?.presence || "offline")} />
            <SettingsRow label="Sign out" value={
              <button style={pgBtn} onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
                const t = window.parent && window.parent !== window ? window.parent : window;
                t.location.href = "/";
              }}>Sign out</button>
            } />
          </SettingsCard>

        </div>
      </PageBody>
    </div>
  );
}

function SettingsCard({ title, children }) {
  return (
    <section>
      <h2 style={{
        margin: "0 0 10px", fontSize: 11, letterSpacing: 1.2,
        color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)",
        textTransform: "uppercase",
      }}>{title}</h2>
      <div style={{ border: "1px solid var(--rv-border)", borderRadius: 12, background: "var(--rv-card-bg)", overflow: "hidden" }}>
        {children}
      </div>
    </section>
  );
}

function SettingsRow({ label, value, sub, first }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "180px 1fr",
      gap: 16, padding: "14px 18px",
      borderTop: first ? "none" : "1px solid var(--rv-border)",
      alignItems: "start",
    }}>
      <div style={{ fontSize: 12.5, color: "var(--rv-text-dim)", paddingTop: 7 }}>{label}</div>
      <div>
        <div style={{ fontSize: 13.5, color: "var(--rv-text)" }}>{value}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--rv-text-faint)", marginTop: 6 }}>{sub}</div>}
      </div>
    </div>
  );
}

function SettingsText({ defaultValue, placeholder, multiline, onSave }) {
  const [v, setV] = React.useState(defaultValue || "");
  const [orig, setOrig] = React.useState(defaultValue || "");
  React.useEffect(() => { setV(defaultValue || ""); setOrig(defaultValue || ""); }, [defaultValue]);
  const dirty = v !== orig;
  const commit = () => { if (dirty) { onSave(v); setOrig(v); } };
  const common = {
    value: v,
    onChange: (e) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e) => { if (!multiline && e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } },
    placeholder,
    style: {
      width: "100%", padding: "8px 12px", borderRadius: 8,
      background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)",
      color: "var(--rv-text)", fontSize: 13, fontFamily: "inherit", outline: "none",
    },
  };
  return multiline
    ? <textarea rows={3} {...common} style={{ ...common.style, resize: "vertical", minHeight: 56 }} />
    : <input type="text" {...common} />;
}

function SettingsSwitch({ value, onChange }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      all: "unset", cursor: "pointer",
      width: 38, height: 22, borderRadius: 11,
      background: value ? "var(--rv-accent)" : "var(--rv-border)",
      position: "relative", transition: "background 160ms",
    }} aria-pressed={value}>
      <span style={{
        position: "absolute", top: 2, left: value ? 18 : 2,
        width: 18, height: 18, borderRadius: "50%",
        background: value ? "#1a1510" : "var(--rv-text-dim)",
        transition: "left 160ms",
      }} />
    </button>
  );
}

function AvatarEditor({ me, onFile }) {
  const ref = React.useRef(null);
  const initials = ((me.displayName || me.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("")).toUpperCase();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{
        width: 56, height: 56, borderRadius: "50%",
        background: "var(--rv-avatar-bg)", border: "1px solid var(--rv-border)",
        display: "grid", placeItems: "center",
        fontSize: 18, fontWeight: 600, color: "var(--rv-text)",
        overflow: "hidden", flexShrink: 0,
      }}>
        {me.avatar
          ? <img src={me.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : initials}
      </div>
      <button style={pgBtn} onClick={() => ref.current?.click()}>Upload image</button>
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ""; }} />
    </div>
  );
}

function BannerEditor({ me, onFile, onClear }) {
  const ref = React.useRef(null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{
        width: 160, height: 64, borderRadius: 10,
        border: "1px solid var(--rv-border)", overflow: "hidden",
        background: me.banner
          ? `url(${me.banner}) center/cover`
          : "linear-gradient(135deg, var(--rv-accent-soft), var(--rv-input-bg))",
      }} />
      <button style={pgBtn} onClick={() => ref.current?.click()}>Upload banner</button>
      {me.banner && <button style={pgBtn} onClick={onClear}>Remove</button>}
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ""; }} />
    </div>
  );
}

function NameColorPicker({ value, onChange }) {
  const presets = ["", "#e8b24a", "#f59e0b", "#ef4444", "#ec4899", "#a855f7", "#3b82f6", "#14b8a6", "#22c55e"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {presets.map(c => (
        <button key={c || "default"} onClick={() => onChange(c || null)} style={{
          all: "unset", cursor: "pointer",
          width: 28, height: 28, borderRadius: "50%",
          background: c || "var(--rv-text)",
          border: (value || "") === (c || "") ? "2px solid var(--rv-accent)" : "2px solid transparent",
          boxShadow: (value || "") === (c || "") ? "0 0 10px var(--rv-accent-glow)" : "none",
        }} title={c || "Default"} />
      ))}
      <input type="color" value={value || "#ffffff"} onChange={(e) => onChange(e.target.value)}
        style={{ width: 32, height: 28, border: "1px solid var(--rv-border)", borderRadius: 6, background: "var(--rv-input-bg)" }} />
    </div>
  );
}

function BellScheduleEditor({ currentUser, onFlash }) {
  const [settings, setSettings] = React.useState(null);
  const [editing, setEditing] = React.useState(null); // {name, start, end}
  const [draft, setDraft] = React.useState({ name: "", start: "", end: "" });
  React.useEffect(() => {
    fetch("/api/settings", { credentials: "same-origin" })
      .then(r => r.json()).then(setSettings).catch(() => setSettings({}));
  }, []);
  if (!settings) return <div style={{ fontSize: 12, color: "var(--rv-text-faint)" }}>Loading…</div>;
  const schedule = (settings.bellSchedule && settings.bellSchedule[currentUser]) || {};
  const regular = Array.isArray(schedule.regular) ? schedule.regular : [];
  const saveSchedule = async (next) => {
    const bell = { ...(settings.bellSchedule || {}), [currentUser]: { ...(schedule), regular: next } };
    await fetch("/api/settings", {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bellSchedule: bell }),
    });
    setSettings(prev => ({ ...(prev || {}), bellSchedule: bell }));
    onFlash && onFlash("Schedule updated");
  };
  const addPeriod = async () => {
    if (!draft.name || !draft.start || !draft.end) return;
    await saveSchedule([...regular, { ...draft, id: Date.now().toString() }]);
    setDraft({ name: "", start: "", end: "" });
  };
  const removePeriod = async (i) => {
    await saveSchedule(regular.filter((_, idx) => idx !== i));
  };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {regular.length === 0 && <div style={{ fontSize: 12, color: "var(--rv-text-faint)" }}>No periods yet.</div>}
      {regular.map((p, i) => (
        <div key={i} style={{
          display: "grid", gridTemplateColumns: "1fr 100px 100px auto",
          alignItems: "center", gap: 10,
          padding: "8px 12px", borderRadius: 8,
          background: "var(--rv-input-bg)", border: "1px solid var(--rv-border)",
        }}>
          <div style={{ fontSize: 13, color: "var(--rv-text)" }}>{p.name}</div>
          <div style={{ fontFamily: "var(--rv-mono)", fontSize: 11, color: "var(--rv-text-faint)" }}>{p.start}</div>
          <div style={{ fontFamily: "var(--rv-mono)", fontSize: 11, color: "var(--rv-text-faint)" }}>{p.end}</div>
          <button style={{ ...pgBtn, height: 26, padding: "0 10px", fontSize: 11 }} onClick={() => removePeriod(i)}>×</button>
        </div>
      ))}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px auto", gap: 8, marginTop: 4 }}>
        <TextInput value={draft.name} onChange={(v) => setDraft(d => ({ ...d, name: v }))} placeholder="Period name (e.g. Math)" onEnter={addPeriod} />
        <input type="time" value={draft.start} onChange={(e) => setDraft(d => ({ ...d, start: e.target.value }))}
          style={{ padding: "8px 10px", borderRadius: 8, background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)", color: "var(--rv-text)", fontSize: 12, colorScheme: "dark" }} />
        <input type="time" value={draft.end} onChange={(e) => setDraft(d => ({ ...d, end: e.target.value }))}
          style={{ padding: "8px 10px", borderRadius: 8, background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)", color: "var(--rv-text)", fontSize: 12, colorScheme: "dark" }} />
        <button style={pgBtnPrimary} onClick={addPeriod}>+ Add</button>
      </div>
    </div>
  );
}

function FeedbackForm({ onFlash }) {
  const [type, setType] = React.useState("suggestion");
  const [text, setText] = React.useState("");
  const submit = async () => {
    if (!text.trim()) return;
    await fetch("/api/suggestions", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, message: text.trim() }),
    });
    setText("");
    onFlash && onFlash("Feedback sent");
  };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <select value={type} onChange={(e) => setType(e.target.value)} style={{
        padding: "8px 12px", borderRadius: 8,
        background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)",
        color: "var(--rv-text)", fontSize: 13, fontFamily: "inherit",
        maxWidth: 240,
      }}>
        <option value="suggestion">Feature suggestion</option>
        <option value="bug">Bug report</option>
      </select>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's on your mind?"
        rows={3}
        style={{
          width: "100%", padding: "8px 12px", borderRadius: 8,
          background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)",
          color: "var(--rv-text)", fontSize: 13, fontFamily: "inherit", outline: "none",
          resize: "vertical", minHeight: 60,
        }}
      />
      <div>
        <button style={pgBtnPrimary} onClick={submit} disabled={!text.trim()}>Send</button>
      </div>
    </div>
  );
}

function EmailList({ list, onChange }) {
  const [items, setItems] = React.useState(list || []);
  const [input, setInput] = React.useState("");
  React.useEffect(() => { setItems(list || []); }, [JSON.stringify(list)]);
  const add = () => {
    const v = input.trim();
    if (!v) return;
    const next = [...items, v];
    setItems(next); setInput(""); onChange(next);
  };
  const remove = (i) => {
    const next = items.filter((_, idx) => idx !== i);
    setItems(next); onChange(next);
  };
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {items.length === 0 && <div style={{ color: "var(--rv-text-faint)", fontSize: 12 }}>No emails added yet.</div>}
      {items.map((e, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 10px 6px 12px", borderRadius: 8,
          background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)",
        }}>
          <span style={{ flex: 1, fontSize: 13, color: "var(--rv-text)", fontFamily: "var(--rv-mono)" }}>{e}</span>
          <button onClick={() => remove(i)} style={{ ...pgBtn, height: 26, padding: "0 8px", fontSize: 11 }}>Remove</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <TextInput value={input} onChange={setInput} placeholder="add@address.com" onEnter={add} type="email" style={{ flex: 1 }} />
        <button style={pgBtnPrimary} onClick={add}>Add</button>
      </div>
    </div>
  );
}

/* ============ Security editors ============ */
function AuthPasswordEditor({ onFlash }) {
  const [status, setStatus] = React.useState(null);
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [err, setErr] = React.useState("");
  React.useEffect(() => {
    fetch("/api/totp/status", { credentials: "same-origin" })
      .then(r => r.json()).then(setStatus).catch(() => setStatus({ hasPassword: false }));
  }, []);
  if (!status) return <div style={{ color: "var(--rv-text-faint)", fontSize: 12 }}>Loading…</div>;
  const submit = async () => {
    setErr("");
    if (next.length < 4) { setErr("Minimum 4 characters"); return; }
    if (next !== confirm) { setErr("Passwords don't match"); return; }
    const r = await fetch("/api/totp/set-password", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(status.hasPassword ? { password: next, currentPassword: current } : { password: next }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error || "Failed"); return; }
    setCurrent(""); setNext(""); setConfirm("");
    setStatus(prev => ({ ...(prev || {}), hasPassword: true }));
    onFlash && onFlash("Authenticator password updated");
  };
  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 360 }}>
      {status.hasPassword && (
        <TextInput value={current} onChange={setCurrent} placeholder="Current password" type="password" />
      )}
      <TextInput value={next} onChange={setNext} placeholder={status.hasPassword ? "New password" : "Password (min 4 chars)"} type="password" />
      <TextInput value={confirm} onChange={setConfirm} placeholder="Confirm password" type="password" onEnter={submit} />
      {err && <div style={{ color: "oklch(0.75 0.18 30)", fontSize: 12 }}>{err}</div>}
      <div>
        <button style={pgBtnPrimary} onClick={submit}>{status.hasPassword ? "Update password" : "Set password"}</button>
      </div>
    </div>
  );
}

function LockerPasscodeEditor({ onFlash }) {
  const [code, setCode] = React.useState("");
  const [err, setErr] = React.useState("");
  const submit = async () => {
    setErr("");
    if (!/^\d{4}$/.test(code)) { setErr("Passcode must be exactly 4 digits"); return; }
    const r = await fetch("/api/settings", {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vaultPasscode: code }),
    });
    if (!r.ok) { setErr("Failed to save"); return; }
    setCode("");
    onFlash && onFlash("Locker passcode updated");
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: 360 }}>
      <input
        type="password"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder="4 digits"
        inputMode="numeric"
        style={{
          width: 120, padding: "8px 12px", borderRadius: 8,
          background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)",
          color: "var(--rv-text)", fontSize: 13, outline: "none",
          fontFamily: "var(--rv-mono)", letterSpacing: "0.4em", textAlign: "center",
        }}
      />
      <button style={pgBtnPrimary} onClick={submit}>Update</button>
      {err && <div style={{ color: "oklch(0.75 0.18 30)", fontSize: 12 }}>{err}</div>}
    </div>
  );
}

function ProfilePasscodeEditor({ me, onFlash, onSaved }) {
  const enabled = !!me?.profilePasscode;
  const [code, setCode] = React.useState("");
  const [err, setErr] = React.useState("");
  const save = async (passcode) => {
    setErr("");
    const r = await fetch("/api/auth/profile-passcode", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) { setErr(j.error || "Failed"); return false; }
    return true;
  };
  const submitSet = async () => {
    if (!/^\d{4}$/.test(code)) { setErr("Passcode must be exactly 4 digits"); return; }
    if (await save(code)) {
      setCode("");
      onFlash && onFlash("Profile passcode updated");
      onSaved && onSaved();
    }
  };
  const disable = async () => {
    const ok = await window.rvConfirm("Remove your profile passcode? Anyone with the site password will be able to pick your profile.", { title: "Remove passcode", primaryLabel: "Remove", danger: true });
    if (!ok) return;
    if (await save("")) {
      onFlash && onFlash("Profile passcode removed");
      onSaved && onSaved();
    }
  };
  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 360 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SettingsSwitch value={enabled} onChange={async (v) => {
          if (!v) disable();
          // Turning on is handled by actually saving a 4-digit PIN below
        }} />
        <span style={{ fontSize: 12.5, color: "var(--rv-text-dim)" }}>
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
          onKeyDown={(e) => { if (e.key === "Enter") submitSet(); }}
          placeholder="4 digits"
          inputMode="numeric"
          style={{
            width: 120, padding: "8px 12px", borderRadius: 8,
            background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)",
            color: "var(--rv-text)", fontSize: 13, outline: "none",
            fontFamily: "var(--rv-mono)", letterSpacing: "0.4em", textAlign: "center",
          }}
        />
        <button style={pgBtnPrimary} onClick={submitSet}>{enabled ? "Change" : "Set"}</button>
      </div>
      {err && <div style={{ color: "oklch(0.75 0.18 30)", fontSize: 12 }}>{err}</div>}
    </div>
  );
}

Object.assign(window, {
  BriefingView, NotesView, CalendarView, LockerView,
  GuestView, RemindersView, MoneyView,
  AuthView, IntelView, SettingsView,
});
