// Sidebar — collapsible, icons by default, expand on hover.
// Persists expanded state via data attribute on parent (not localStorage, purely visual).

function Sidebar({ active = "chat", onSelect, me, badges = {}, onStatusChange, searchQuery = "", onSearchChange }) {
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const searchInputRef = React.useRef(null);
  React.useEffect(() => {
    if (searchOpen && searchInputRef.current) searchInputRef.current.focus();
  }, [searchOpen]);
  const [pinned, setPinned] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const expanded = pinned || hovered;

  const sections = [
    {
      label: null,
      items: [
        { id: "chat",      label: "Chat",             icon: IconChat,       badge: badges.chat },
        { id: "briefing",  label: "Briefing",         icon: IconBriefing,   badge: badges.briefing },
        { id: "notes",     label: "Notes & Todos",    icon: IconNotes },
        { id: "calendar",  label: "Calendar",         icon: IconCalendar },
        { id: "locker",    label: "Document Locker",  icon: IconLocker },
        { id: "guest",     label: "Guest Messages",   icon: IconGuest,      badge: badges.guest },
        { id: "reminders", label: "Reminders",        icon: IconReminder,   badge: badges.reminders },
        { id: "money",     label: "Money",            icon: IconMoney },
        { id: "auth",      label: "Authenticator",    icon: IconAuth },
      ],
    },
    {
      label: "Intel",
      // K-108 is its own site (separate login); clicking opens that page
      // rather than a tab within the vault shell.
      items: [{ id: "k108", label: "K-108", icon: IconIntel, external: "/k108" }],
    },
    {
      label: "System",
      items: [{ id: "settings", label: "Settings", icon: IconSettings }],
    },
  ];

  const handleSelect = (item) => {
    if (item.external) {
      // Break out of the iframe when embedded; otherwise navigate in-place.
      const target = window.parent && window.parent !== window ? window.parent : window;
      target.location.href = item.external;
      return;
    }
    onSelect && onSelect(item.id);
  };

  const width = expanded ? 240 : 64;

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width,
        flexShrink: 0,
        transition: "width 220ms cubic-bezier(.2,.8,.2,1)",
        background: "var(--rv-sidebar-bg)",
        borderRight: "1px solid var(--rv-border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        color: "var(--rv-text-dim)",
        position: "relative",
        zIndex: 10,
      }}
    >
      {/* Brand row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 16px 8px",
          minHeight: 56,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Crest size={28} />
          {expanded && (
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--rv-text)", letterSpacing: 0.2 }}>
                Royal Vault
              </span>
              <span style={{ fontSize: 10.5, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", letterSpacing: 0.4 }}>
                PRIVATE · ENCRYPTED
              </span>
            </div>
          )}
        </div>
        {expanded && (
          <button
            onClick={() => setPinned(!pinned)}
            title={pinned ? "Unpin" : "Pin open"}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: 6,
              borderRadius: 6,
              color: pinned ? "var(--rv-accent)" : "var(--rv-text-faint)",
              display: "grid",
              placeItems: "center",
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = "var(--rv-hover)")}
            onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <IconPanel size={15} />
          </button>
        )}
      </div>

      {/* Search — filters chat thread live */}
      <div style={{ padding: "4px 10px 8px" }}>
        <div
          onClick={() => {
            if (!expanded) return;
            setSearchOpen(true);
            onSelect && onSelect("chat");
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 34,
            padding: expanded ? "0 10px" : "0",
            justifyContent: expanded ? "flex-start" : "center",
            borderRadius: 8,
            background: expanded ? "var(--rv-input-bg)" : "transparent",
            border: expanded ? `1px solid ${searchOpen ? "var(--rv-accent)" : "var(--rv-border)"}` : "1px solid transparent",
            color: "var(--rv-text-faint)",
            fontSize: 13,
            cursor: expanded ? "text" : "default",
          }}
        >
          <IconSearch size={15} />
          {expanded && (
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { onSearchChange && onSearchChange(""); e.currentTarget.blur(); }
              }}
              placeholder="Search chat…"
              style={{
                flex: 1, minWidth: 0,
                background: "transparent", border: "none", outline: "none",
                color: "var(--rv-text)", fontSize: 13, fontFamily: "inherit",
                padding: 0,
              }}
            />
          )}
          {expanded && searchQuery && (
            <button onClick={(e) => { e.stopPropagation(); onSearchChange && onSearchChange(""); }} style={{
              all: "unset", cursor: "pointer", color: "var(--rv-text-faint)",
              fontSize: 14, padding: "0 2px",
            }}>×</button>
          )}
        </div>
      </div>

      {/* Scrollable nav */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 10px 12px" }} className="rv-scroll">
        {sections.map((section, si) => (
          <div key={si} style={{ marginTop: si === 0 ? 0 : 14 }}>
            {section.label && expanded && (
              <div
                style={{
                  fontFamily: "var(--rv-mono)",
                  fontSize: 10,
                  letterSpacing: 1.2,
                  textTransform: "uppercase",
                  color: "var(--rv-text-faint)",
                  padding: "8px 10px 4px",
                }}
              >
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const Ico = item.icon;
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    height: 36,
                    padding: expanded ? "0 10px" : "0",
                    justifyContent: expanded ? "flex-start" : "center",
                    borderRadius: 8,
                    color: isActive ? "var(--rv-text)" : "var(--rv-text-dim)",
                    background: isActive ? "var(--rv-active)" : "transparent",
                    fontSize: 13,
                    fontWeight: isActive ? 500 : 400,
                    width: "100%",
                    marginBottom: 1,
                    position: "relative",
                    transition: "background 120ms ease, color 120ms ease",
                  }}
                  onMouseOver={(e) => {
                    if (!isActive) e.currentTarget.style.background = "var(--rv-hover)";
                  }}
                  onMouseOut={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  {isActive && (
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 8,
                        bottom: 8,
                        width: 2,
                        borderRadius: 2,
                        background: "var(--rv-accent)",
                        boxShadow: "0 0 8px var(--rv-accent-glow)",
                      }}
                    />
                  )}
                  <Ico size={17} />
                  {expanded && <span style={{ whiteSpace: "nowrap" }}>{item.label}</span>}
                  {expanded && item.badge != null && item.badge !== 0 && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontFamily: "var(--rv-mono)",
                        fontSize: 10,
                        minWidth: 18,
                        height: 18,
                        padding: "0 5px",
                        borderRadius: 9,
                        background: "var(--rv-accent)",
                        color: "#1a1510",
                        fontWeight: 600,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        letterSpacing: 0.4,
                      }}
                    >
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                  {!expanded && item.badge != null && item.badge !== 0 && (
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        right: 10,
                        top: 6,
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        background: "var(--rv-accent)",
                        boxShadow: "0 0 6px var(--rv-accent-glow)",
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer: current user */}
      {(() => {
        const displayName = me?.displayName || me?.name || "";
        const handle = (me?.name || "").toLowerCase();
        const initials = displayName
          ? displayName.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase()
          : "??";
        const presence = me?.status || me?._presence || "offline";
        const presenceLabel = presence === "online" ? "online"
          : presence === "idle" ? "idle"
          : presence === "dnd" ? "do not disturb"
          : presence === "offline" ? "offline" : "signed in";
        const presenceColors = {
          online: "var(--rv-ok)",
          idle: "oklch(0.82 0.17 80)",
          dnd: "oklch(0.65 0.22 25)",
          offline: "var(--rv-text-faint)",
        };
        return (
          <div style={{ position: "relative", borderTop: "1px solid var(--rv-border)" }}>
            <button
              onClick={() => setStatusOpen(v => !v)}
              disabled={!me}
              style={{
                all: "unset", cursor: me ? "pointer" : "default",
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", boxSizing: "border-box",
                padding: expanded ? "10px 14px" : "10px 0",
                justifyContent: expanded ? "flex-start" : "center",
              }}
            >
              <div style={{ position: "relative", flexShrink: 0 }}>
                <div
                  style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: me?.avatar
                      ? "var(--rv-avatar-bg)"
                      : "linear-gradient(135deg, var(--rv-accent) 0%, var(--rv-accent-2) 100%)",
                    display: "grid", placeItems: "center",
                    fontSize: 11, fontWeight: 600, color: "#1a1611",
                    overflow: "hidden",
                    border: me?.avatar ? "1px solid var(--rv-border)" : "none",
                  }}
                >
                  {me?.avatar
                    ? <img src={me.avatar} alt={displayName}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    : initials}
                </div>
                <span style={{
                  position: "absolute", right: -1, bottom: -1,
                  width: 10, height: 10, borderRadius: "50%",
                  background: presenceColors[presence] || "var(--rv-text-faint)",
                  border: "2px solid var(--rv-sidebar-bg)",
                }} />
              </div>
              {expanded && (
                <div style={{ lineHeight: 1.15, overflow: "hidden", textAlign: "left", flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12.5, color: "var(--rv-text)", fontWeight: 500,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{displayName || "Not signed in"}</div>
                  <div style={{
                    fontSize: 10.5, color: "var(--rv-text-faint)",
                    fontFamily: "var(--rv-mono)", letterSpacing: 0.3,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {presenceLabel}
                  </div>
                </div>
              )}
            </button>
            {statusOpen && me && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 4px)", left: 8, right: expanded ? 8 : "auto",
                  minWidth: 180,
                  background: "oklch(0.12 0.01 60 / 0.96)",
                  backdropFilter: "blur(16px)",
                  border: "1px solid var(--rv-border)",
                  borderRadius: 10, padding: 4,
                  boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
                  zIndex: 50,
                }}
              >
                {[
                  { id: "online", label: "Online" },
                  { id: "idle", label: "Idle" },
                  { id: "dnd", label: "Do not disturb" },
                  { id: "offline", label: "Offline" },
                ].map(s => (
                  <button key={s.id} onClick={() => {
                    onStatusChange && onStatusChange(s.id);
                    setStatusOpen(false);
                  }} style={{
                    all: "unset", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 10,
                    width: "100%", boxSizing: "border-box",
                    padding: "8px 10px", borderRadius: 6,
                    fontSize: 12, color: "var(--rv-text)",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "var(--rv-hover)")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: presenceColors[s.id],
                    }} />
                    <span>{s.label}</span>
                    {presence === s.id && <span style={{ marginLeft: "auto", color: "var(--rv-accent)" }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </aside>
  );
}

// House crest — simple geometric monogram placeholder
function Crest({ size = 28 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background: "var(--rv-crest-bg)",
        border: "1px solid var(--rv-border)",
        display: "grid",
        placeItems: "center",
        color: "var(--rv-accent)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M6 18V8l6 4 6-4v10" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 3l0 2.5M9.5 5h5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

Object.assign(window, { Sidebar, Crest });
