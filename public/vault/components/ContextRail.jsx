// ContextRail — tabbed vault for the thread: Media · Pins · Links · Files.
// Two-person channel, so no Members tab — the rail is about what's been
// shared between them over time.

function ContextRail({ thread, onClose, onJump }) {
  const [tab, setTab] = React.useState("profile");
  const messages = Array.isArray(thread?.rawMessages) ? thread.rawMessages : [];
  // Media: image/video file attachments + gif messages
  const media = React.useMemo(() => {
    const out = [];
    for (const m of messages) {
      if (m.type === "gif" && m.gifUrl) {
        out.push({ id: m.id, url: m.gifUrl, kind: "gif", timestamp: m.timestamp, sender: m.sender });
      }
      if (Array.isArray(m.files)) {
        for (const f of m.files) {
          if (!f.url) continue;
          const t = (f.type || "").toLowerCase();
          if (t.startsWith("image/") || t.startsWith("video/")) {
            out.push({ id: `${m.id}:${f.url}`, url: f.url, kind: t.startsWith("video/") ? "video" : "image", name: f.name, timestamp: m.timestamp, sender: m.sender });
          }
        }
      }
    }
    return out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [messages]);
  // Files: non-image/video attachments
  const files = React.useMemo(() => {
    const out = [];
    for (const m of messages) {
      if (Array.isArray(m.files)) {
        for (const f of m.files) {
          const t = (f.type || "").toLowerCase();
          if (!f.url) continue;
          if (!t.startsWith("image/") && !t.startsWith("video/")) {
            out.push({ id: `${m.id}:${f.url}`, ...f, timestamp: m.timestamp, sender: m.sender });
          }
        }
      }
    }
    return out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [messages]);
  // Links: extract from message text
  const links = React.useMemo(() => {
    const urlRe = /https?:\/\/[^\s<>"'\)\]]+/gi;
    const seen = new Set();
    const out = [];
    for (const m of messages) {
      if (!m.text) continue;
      const found = m.text.match(urlRe) || [];
      for (const u of found) {
        const key = `${m.id}:${u}`;
        if (seen.has(u)) continue;
        seen.add(u);
        try {
          const host = new URL(u).hostname.replace(/^www\./, "");
          out.push({ id: key, url: u, host, text: m.text, timestamp: m.timestamp, sender: m.sender });
        } catch { /* skip invalid */ }
      }
    }
    return out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [messages]);

  const tabs = [
    { id: "profile", label: "Profile" },
    { id: "media", label: "Media", count: media.length || undefined },
    { id: "pins", label: "Pins" },
    { id: "links", label: "Links", count: links.length || undefined },
    { id: "files", label: "Files", count: files.length || undefined },
  ];

  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: "1px solid var(--rv-border)",
        background: "var(--rv-rail-bg)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* Header */}
      <div style={{ padding: "14px 18px 10px", borderBottom: "1px solid var(--rv-border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 12.5, color: "var(--rv-text)", fontWeight: 500 }}>Thread Vault</div>
            <div style={{
              fontFamily: "var(--rv-mono)", fontSize: 10.5,
              color: "var(--rv-text-faint)", letterSpacing: 0.3, marginTop: 2,
            }}>
              {thread.contact ? `with ${thread.contact.name}` : "private channel"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              all: "unset", cursor: "pointer",
              width: 24, height: 24, borderRadius: 6,
              display: "grid", placeItems: "center",
              color: "var(--rv-text-faint)", fontSize: 16,
            }}
          >×</button>
        </div>

        {/* Tab strip */}
        <div className="rv-scroll" style={{
          display: "flex", gap: 2, marginTop: 14,
          borderBottom: "1px solid var(--rv-border)",
          marginBottom: -10, marginLeft: -18, marginRight: -18, paddingLeft: 18, paddingRight: 18,
          overflowX: "auto",
          scrollbarWidth: "none",
        }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                all: "unset", cursor: "pointer",
                padding: "10px 7px 11px",
                fontSize: 12.5, fontWeight: tab === t.id ? 500 : 400,
                color: tab === t.id ? "var(--rv-text)" : "var(--rv-text-faint)",
                position: "relative",
                display: "flex", alignItems: "center", gap: 5,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {t.label}
              {t.count != null && (
                <span style={{
                  fontFamily: "var(--rv-mono)", fontSize: 10,
                  color: tab === t.id ? "var(--rv-accent)" : "var(--rv-text-faint)",
                  opacity: 0.8,
                }}>{t.count}</span>
              )}
              {tab === t.id && (
                <span style={{
                  position: "absolute", left: 6, right: 6, bottom: -1, height: 2,
                  background: "var(--rv-accent)", borderRadius: 1,
                  boxShadow: "0 0 10px var(--rv-accent-glow)",
                }} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab body */}
      <div className="rv-scroll" style={{ flex: 1, overflowY: "auto", padding: tab === "profile" ? 0 : "14px 16px 18px", minHeight: 0 }}>
        {tab === "profile" && <ProfilePanel contact={thread.contact} />}
        {tab === "media" && <MediaGrid items={media} />}
        {tab === "pins" && <PinsList onJump={onJump} messages={messages} />}
        {tab === "links" && <LinksList items={links} />}
        {tab === "files" && <FilesList items={files} />}
      </div>
    </aside>
  );
}

/* ---------- PROFILE ---------- */
function ProfilePanel({ contact }) {
  const online = contact.status === "online";
  const presenceLabel = online
    ? "Online"
    : contact.presence === "idle"
      ? "Idle"
      : "Offline";
  const bannerStyle = contact.bannerSrc
    ? {
        height: 120, position: "relative", overflow: "hidden",
        backgroundImage:
          `linear-gradient(180deg, transparent 50%, var(--rv-rail-bg) 100%),` +
          `url(${contact.bannerSrc})`,
        backgroundSize: "cover, cover",
        backgroundPosition: "center, center",
      }
    : {
        height: 120, position: "relative", overflow: "hidden",
        background: `
          linear-gradient(180deg, transparent 50%, var(--rv-rail-bg) 100%),
          radial-gradient(circle at 20% 30%, oklch(0.50 0.14 var(--rv-accent-hue) / 0.55), transparent 55%),
          radial-gradient(circle at 80% 60%, oklch(0.40 0.12 calc(var(--rv-accent-hue) + 40) / 0.45), transparent 50%),
          repeating-linear-gradient(
            90deg,
            oklch(0.22 0.02 var(--rv-accent-hue)) 0 1px,
            transparent 1px 14px
          ),
          oklch(0.18 0.03 var(--rv-accent-hue))
        `,
      };

  return (
    <div>
      {/* Banner */}
      <div style={bannerStyle}>
        {!contact.bannerSrc && (
          <svg viewBox="0 0 320 120" preserveAspectRatio="none" style={{
            position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", height: 60, opacity: 0.55,
          }}>
            <path d="M0,90 L20,90 L20,60 L30,60 L30,80 L50,80 L50,50 L60,50 L60,75 L80,75 L80,55 L95,55 L95,85 L115,85 L115,45 L130,45 L130,80 L150,80 L150,60 L165,60 L165,78 L185,78 L185,40 L200,40 L200,72 L220,72 L220,58 L240,58 L240,82 L260,82 L260,68 L280,68 L280,88 L300,88 L300,70 L320,70 L320,120 L0,120 Z"
              fill="oklch(0.14 0.03 var(--rv-accent-hue))" />
          </svg>
        )}
      </div>

      {/* Avatar overlap */}
      <div style={{ padding: "0 18px", marginTop: -38, position: "relative" }}>
        <div style={{ position: "relative", width: 72, height: 72 }}>
          <div style={{
            width: 72, height: 72, borderRadius: "50%",
            background: "var(--rv-avatar-bg)",
            border: "4px solid var(--rv-rail-bg)",
            display: "grid", placeItems: "center",
            fontSize: 24, fontWeight: 600, color: "var(--rv-text)",
            letterSpacing: 0.5,
            boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
            overflow: "hidden",
          }}>
            {contact.avatarSrc
              ? <img src={contact.avatarSrc} alt={contact.name}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              : contact.avatar}
          </div>
          {online && (
            <span style={{
              position: "absolute", right: 2, bottom: 2,
              width: 16, height: 16, borderRadius: "50%",
              background: "var(--rv-ok)",
              border: "3px solid var(--rv-rail-bg)",
            }} />
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{
            fontSize: 22, fontWeight: 600,
            color: "var(--rv-accent)",
            letterSpacing: -0.2,
            lineHeight: 1.1,
            textShadow: "0 0 24px var(--rv-accent-glow)",
          }}>
            {contact.name}
          </div>
          <div style={{
            fontSize: 12.5, color: "var(--rv-text-faint)",
            fontFamily: "var(--rv-mono)", marginTop: 4,
            letterSpacing: 0.3,
          }}>
            {contact.handle && <>@{contact.handle}</>}
            {contact.role && <> · <span style={{ color: "var(--rv-accent)" }}>●</span> {contact.role}</>}
          </div>
        </div>

        <div style={{ height: 1, background: "var(--rv-border)", margin: "16px 0" }} />

        {/* Fields — real profile data */}
        <ProfileField
          label="Status"
          value={<><span style={{ marginRight: 6, color: online ? "var(--rv-ok)" : "var(--rv-text-faint)" }}>●</span>{presenceLabel}{contact.role ? ` · ${contact.role}` : ""}</>}
        />
        {contact.pronouns && <ProfileField label="Pronouns" value={contact.pronouns} />}
        {contact.about
          ? <ProfileField label="About" value={contact.about} />
          : <ProfileField label="About" value={<span style={{ color: "var(--rv-text-faint)", fontStyle: "italic" }}>No bio yet</span>} />}
        <ProfileField label="Last seen" value={contact.lastSeen || "recently"} mono />
        {contact.memberSince && <ProfileField label="Member since" value={contact.memberSince} mono />}

        <div style={{ height: 22 }} />
      </div>
    </div>
  );
}

function ProfileField({ label, value, mono }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontFamily: "var(--rv-mono)", fontSize: 10,
        letterSpacing: 1.2, textTransform: "uppercase",
        color: "var(--rv-text-faint)", marginBottom: 5,
      }}>{label}</div>
      <div style={{
        fontSize: 12.5, color: "var(--rv-text)",
        lineHeight: 1.5,
        fontFamily: mono ? "var(--rv-mono)" : "inherit",
      }}>
        {value}
      </div>
    </div>
  );
}

function ProfileAction({ icon, label }) {
  return (
    <button style={{
      all: "unset", cursor: "pointer",
      padding: "9px 10px",
      borderRadius: 8,
      border: "1px solid var(--rv-border)",
      background: "var(--rv-card-bg)",
      display: "flex", alignItems: "center", gap: 8,
      fontSize: 12, color: "var(--rv-text)",
      justifyContent: "center",
    }}
    onMouseOver={(e) => (e.currentTarget.style.background = "var(--rv-hover)")}
    onMouseOut={(e) => (e.currentTarget.style.background = "var(--rv-card-bg)")}
    >
      <span style={{ color: "var(--rv-accent)", display: "grid", placeItems: "center" }}>{icon}</span>
      {label}
    </button>
  );
}

/* ---------- MEDIA ---------- */
function MediaGrid({ items }) {
  if (!items || items.length === 0) {
    return <RailEmpty title="No media yet" sub="Images, videos, and GIFs shared in chat will appear here." />;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
      {items.map((m) => (
        <a key={m.id} href={m.url} target="_blank" rel="noreferrer" style={{
          aspectRatio: "1 / 1", borderRadius: 6, overflow: "hidden",
          border: "1px solid var(--rv-border)", background: "var(--rv-input-bg)",
          position: "relative", display: "block",
        }}>
          {m.kind === "video"
            ? <video src={m.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline />
            : <img src={m.url} alt={m.name || ""} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          }
          {m.kind === "video" && (
            <span style={{
              position: "absolute", right: 4, top: 4,
              background: "rgba(0,0,0,0.55)", color: "#fff",
              padding: "1px 4px", borderRadius: 3,
              fontFamily: "var(--rv-mono)", fontSize: 8,
            }}>VIDEO</span>
          )}
          {m.kind === "gif" && (
            <span style={{
              position: "absolute", right: 4, top: 4,
              background: "rgba(0,0,0,0.55)", color: "#fff",
              padding: "1px 4px", borderRadius: 3,
              fontFamily: "var(--rv-mono)", fontSize: 8,
            }}>GIF</span>
          )}
        </a>
      ))}
    </div>
  );
}

function RailEmpty({ title, sub }) {
  return (
    <div style={{
      padding: "40px 16px", textAlign: "center", color: "var(--rv-text-faint)",
    }}>
      <div style={{
        fontFamily: "var(--rv-mono)", fontSize: 10, letterSpacing: 1.2,
        textTransform: "uppercase", color: "var(--rv-text-dim)", marginBottom: 6,
      }}>{title}</div>
      <div style={{ fontSize: 12, lineHeight: 1.5 }}>{sub}</div>
    </div>
  );
}

function MediaTile({ hue, label }) {
  return (
    <div
      title={label}
      style={{
        aspectRatio: "1 / 1",
        borderRadius: 6,
        border: "1px solid var(--rv-border)",
        overflow: "hidden",
        position: "relative",
        cursor: "pointer",
        background: `repeating-linear-gradient(
          135deg,
          oklch(0.32 0.04 ${hue}) 0px,
          oklch(0.32 0.04 ${hue}) 4px,
          oklch(0.26 0.04 ${hue}) 4px,
          oklch(0.26 0.04 ${hue}) 8px
        )`,
      }}
    >
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(to top, rgba(0,0,0,0.5), transparent 60%)",
      }} />
      <div style={{
        position: "absolute", left: 5, right: 5, bottom: 4,
        fontFamily: "var(--rv-mono)", fontSize: 8.5,
        color: "rgba(255,255,255,0.85)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        letterSpacing: 0.2,
      }}>
        {label}
      </div>
    </div>
  );
}

/* ---------- PINS ---------- */
function PinsList({ onJump, messages }) {
  const [pins, setPins] = React.useState(null);
  // Derive a signature of the currently-loaded thread's pin state so this
  // component refetches whenever a message is pinned/unpinned.
  const pinSig = React.useMemo(() => {
    if (!Array.isArray(messages)) return "";
    return messages.filter(m => m.pinnedAt).map(m => `${m.id}:${m.pinnedAt}`).join("|");
  }, [messages]);
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/messages/pinned", { credentials: "same-origin" })
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (!cancelled) setPins(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setPins([]); });
    return () => { cancelled = true; };
  }, [pinSig]);
  if (pins === null) return <div style={{ padding: "40px 16px", textAlign: "center", fontFamily: "var(--rv-mono)", fontSize: 11, color: "var(--rv-text-faint)", letterSpacing: 1.2, textTransform: "uppercase" }}>Loading…</div>;
  if (pins.length === 0) return <RailEmpty title="No pinned messages" sub="Pin a message from the chat to keep it here." />;
  return (
    <>
      {pins.map((p) => (
        <button
          key={p.id}
          onClick={() => onJump && onJump(p)}
          title="Jump to pinned message"
          style={{
            all: "unset", cursor: onJump ? "pointer" : "default",
            display: "block", width: "100%", boxSizing: "border-box",
            borderLeft: "2px solid var(--rv-accent)",
            paddingLeft: 12, paddingRight: 8, paddingTop: 2, paddingBottom: 2,
            marginBottom: 14,
            borderRadius: 2,
            transition: "background 120ms",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rv-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            fontFamily: "var(--rv-mono)", fontSize: 10,
            color: "var(--rv-text-faint)", letterSpacing: 0.4,
            textTransform: "uppercase", marginBottom: 5,
          }}>
            <span style={{ color: "var(--rv-accent)" }}>📌</span>
            <span style={{ whiteSpace: "nowrap" }}>{p.sender} · {p.timestamp ? new Date(p.timestamp).toLocaleDateString() : ""}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--rv-text)", lineHeight: 1.45, wordBreak: "break-word" }}>
            {p.text || (p.gifUrl ? "[GIF]" : (p.files?.length ? `[${p.files.length} file${p.files.length === 1 ? "" : "s"}]` : ""))}
          </div>
        </button>
      ))}
    </>
  );
}

/* ---------- LINKS ---------- */
function LinksList({ items }) {
  if (!items || items.length === 0) {
    return <RailEmpty title="No shared links" sub="Links shared in chat will be collected here." />;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {items.map((l) => {
        const favicon = `https://www.google.com/s2/favicons?domain=${l.host}&sz=64`;
        return (
          <a key={l.id} href={l.url} target="_blank" rel="noreferrer" style={{
            display: "flex", flexDirection: "column",
            borderRadius: 10, overflow: "hidden",
            border: "1px solid var(--rv-border)",
            background: "var(--rv-card-bg)",
            textDecoration: "none", color: "inherit",
          }}>
            <div style={{
              aspectRatio: "1 / 1",
              background: "var(--rv-input-bg)",
              display: "grid", placeItems: "center",
              borderBottom: "1px solid var(--rv-border)",
            }}>
              <img
                src={favicon}
                alt=""
                onError={(e) => { e.currentTarget.style.display = "none"; }}
                style={{ width: 48, height: 48, opacity: 0.85 }}
              />
            </div>
            <div style={{ padding: "8px 10px", minWidth: 0 }}>
              <div style={{
                fontSize: 11.5, color: "var(--rv-text)", fontWeight: 500,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{l.host}</div>
              <div style={{
                fontSize: 10, color: "var(--rv-text-faint)",
                fontFamily: "var(--rv-mono)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                marginTop: 2,
              }}>{l.url.replace(/^https?:\/\/(?:www\.)?/, "").slice(0, 40)}</div>
            </div>
          </a>
        );
      })}
    </div>
  );
}

/* ---------- FILES ---------- */
function FilesList({ items }) {
  if (!items || items.length === 0) {
    return <RailEmpty title="No shared files" sub="Files shared in chat will appear here." />;
  }
  return (
    <>
      {items.map((f) => <FileRow key={f.id} name={f.name || "File"} meta={[
        f.size ? `${Math.round(f.size / 1024)} KB` : null,
        f.sender || null,
        f.timestamp ? new Date(f.timestamp).toLocaleDateString() : null,
      ].filter(Boolean).join(" · ")} kind={(f.type?.split("/")[1] || f.name?.split(".").pop() || "FILE").slice(0, 4).toUpperCase()} url={f.url} />)}
    </>
  );
}

function FileRow({ name, meta, kind, tag, url }) {
  const kindColor = {
    PDF: 0, ZIP: 40, EML: 200, XLS: 140, ICS: 290,
  }[kind] ?? 60;
  const Tag = url ? "a" : "div";
  const linkProps = url ? { href: url, target: "_blank", rel: "noreferrer" } : {};
  return (
    <Tag {...linkProps} style={{
      display: "flex", gap: 11, padding: "9px 8px", alignItems: "center",
      borderRadius: 7, cursor: "pointer",
      marginBottom: 2, textDecoration: "none", color: "inherit",
    }}
    onMouseOver={(e) => (e.currentTarget.style.background = "var(--rv-hover)")}
    onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{
        width: 34, height: 34, borderRadius: 7,
        background: `oklch(0.28 0.05 ${kindColor})`,
        border: "1px solid var(--rv-border)",
        display: "grid", placeItems: "center", flexShrink: 0,
        fontFamily: "var(--rv-mono)", fontSize: 9, fontWeight: 600,
        color: `oklch(0.85 0.12 ${kindColor})`,
        letterSpacing: 0.5,
      }}>
        {kind}
      </div>
      <div style={{ lineHeight: 1.3, flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12.5, color: "var(--rv-text)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{name}</div>
        <div style={{
          fontSize: 10.5, color: "var(--rv-text-faint)",
          fontFamily: "var(--rv-mono)", marginTop: 1,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{meta}</div>
      </div>
      {tag && (
        <span style={{
          fontSize: 9.5, padding: "2px 6px", borderRadius: 4,
          border: "1px solid var(--rv-accent-line)", color: "var(--rv-accent)",
          background: "var(--rv-tag-bg)", fontFamily: "var(--rv-mono)",
          letterSpacing: 0.3, flexShrink: 0,
        }}>{tag}</span>
      )}
    </Tag>
  );
}

function GroupLabel({ children }) {
  return (
    <div style={{
      fontFamily: "var(--rv-mono)", fontSize: 10,
      letterSpacing: 1.2, textTransform: "uppercase",
      color: "var(--rv-text-faint)",
      marginBottom: 8, marginTop: 2,
    }}>{children}</div>
  );
}

Object.assign(window, { ContextRail });
