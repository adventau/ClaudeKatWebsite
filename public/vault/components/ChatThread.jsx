// ChatThread — person-to-person conversation view.
// Features: softer bubbles, hover action menu (reactions + reply + more),
// reactions display, priority flagged messages, reply-to quotes.

// No SEED_THREAD — the vault shell fetches live thread data at mount time.

function ChatHeader({ contact, onToggleRail, railOpen, onCall, onVideo }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 24px",
        borderBottom: "1px solid var(--rv-border)",
        minHeight: 62,
        background: "var(--rv-chat-header-bg)",
        backdropFilter: "blur(12px)",
        position: "relative",
        zIndex: 5,
      }}
    >
      <Avatar name={contact.avatar} src={contact.avatarSrc} status={contact.status} />
      <div style={{ lineHeight: 1.2, flex: 1, minWidth: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--rv-text)", whiteSpace: "nowrap", flexShrink: 0 }}>{contact.name}</span>
          {contact.role && <span style={{ fontSize: 11, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>· {contact.role}</span>}
        </div>
        <div style={{ fontSize: 11, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", marginTop: 2, letterSpacing: 0.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          <span style={{ color: contact.status === "online" ? "var(--rv-ok)" : "var(--rv-text-faint)" }}>●</span> {contact.status === "online" ? "online" : (contact.presence || "offline")} · last seen {contact.lastSeen}
        </div>
      </div>
      <button style={iconBtnStyle} title="Voice call" onClick={onCall}><IconPhone size={16} /></button>
      <button style={iconBtnStyle} title="Video call" onClick={onVideo}><IconVideo size={16} /></button>
      <button
        style={{ ...iconBtnStyle, color: railOpen ? "var(--rv-accent)" : undefined, background: railOpen ? "var(--rv-accent-soft)" : undefined }}
        onClick={onToggleRail}
        title="Thread vault"
      ><IconPanel size={15} /></button>
    </div>
  );
}

function HeaderSearch({ open, setOpen, query, setQuery }) {
  const inputRef = React.useRef(null);
  React.useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);
  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex", alignItems: "center",
          height: 32,
          width: open ? 240 : 32,
          borderRadius: 8,
          background: open ? "var(--rv-input-bg)" : "transparent",
          border: open ? "1px solid var(--rv-input-border)" : "1px solid transparent",
          overflow: "hidden",
          transition: "width 240ms cubic-bezier(.2,.8,.2,1), background 160ms, border-color 160ms",
          cursor: open ? "text" : "pointer",
        }}
        onClick={() => !open && setOpen(true)}
      >
        <div style={{
          width: 32, height: 32, display: "grid", placeItems: "center",
          color: "var(--rv-text-dim)", flexShrink: 0,
        }}>
          <IconSearch size={15} />
        </div>
        {open && (
          <>
            <input
              ref={inputRef}
              value={query || ""}
              onChange={(e) => setQuery && setQuery(e.target.value)}
              placeholder="Search in thread…"
              style={{
                flex: 1, minWidth: 0,
                background: "transparent", border: "none", outline: "none",
                color: "var(--rv-text)", fontSize: 13,
                fontFamily: "inherit",
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setOpen(false); setQuery && setQuery(""); }
              }}
            />
            <button
              onClick={(e) => { e.stopPropagation(); setOpen(false); setQuery && setQuery(""); }}
              style={{
                all: "unset", cursor: "pointer",
                padding: "0 10px", height: 32,
                color: "var(--rv-text-faint)", fontSize: 12,
                fontFamily: "var(--rv-mono)",
              }}
            >ESC</button>
          </>
        )}
      </div>
    </div>
  );
}

const iconBtnStyle = {
  all: "unset",
  cursor: "pointer",
  width: 32,
  height: 32,
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  color: "var(--rv-text-dim)",
  transition: "background 120ms, color 120ms",
};

function Avatar({ name, status, size = 36, src }) {
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <div
        style={{
          width: size, height: size, borderRadius: "50%",
          background: "var(--rv-avatar-bg)",
          border: "1px solid var(--rv-border)",
          display: "grid", placeItems: "center",
          fontSize: size * 0.36, fontWeight: 600,
          color: "var(--rv-text)", letterSpacing: 0.3,
          overflow: "hidden",
        }}
      >
        {src
          ? <img src={src} alt={name || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : name}
      </div>
      {status === "online" && (
        <span
          style={{
            position: "absolute", right: -1, bottom: -1,
            width: size * 0.28, height: size * 0.28,
            borderRadius: "50%", background: "var(--rv-ok)",
            border: "2px solid var(--rv-bg)",
          }}
        />
      )}
    </div>
  );
}

function MessageGroup({ message, contact, isFirstInGroup, isLastInGroup, currentUser, allMessages, onReply, onReact, onPin, onUnsend, onEdit, onJump }) {
  const mine = message.from === "me";
  const [hovered, setHovered] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(message.text || "");
  React.useEffect(() => { if (!editing) setEditValue(message.text || ""); }, [message.text, editing]);
  return (
    <div
      data-msg-id={message.id}
      className="rv-msg-in"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", gap: 12,
        flexDirection: mine ? "row-reverse" : "row",
        marginTop: isFirstInGroup ? 18 : 3,
        alignItems: "flex-end",
        position: "relative",
      }}
    >
      <div style={{ width: 32, flexShrink: 0 }}>
        {isLastInGroup && !mine && <Avatar name={contact.avatar} src={contact.avatarSrc} status={null} size={32} />}
      </div>
      <div style={{ maxWidth: "min(68%, 720px)", minWidth: 0, display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", position: "relative" }}>
        {isFirstInGroup && (
          <div
            style={{
              fontSize: 11, color: "var(--rv-text-faint)",
              fontFamily: "var(--rv-mono)", marginBottom: 5, padding: "0 6px",
              letterSpacing: 0.3, whiteSpace: "nowrap",
              display: "flex", alignItems: "center", gap: 8,
              flexDirection: mine ? "row-reverse" : "row",
            }}
          >
            <span>{mine ? "You" : contact.name} · {message.time}</span>
            {message.meta && (
              <span style={{
                padding: "2px 6px", borderRadius: 4,
                background: "var(--rv-tag-bg)", color: "var(--rv-accent)",
                border: "1px solid var(--rv-accent-line)", fontSize: 9.5,
                whiteSpace: "nowrap", flexShrink: 0,
              }}>{message.meta}</span>
            )}
            {message.priority && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                padding: "2px 6px", borderRadius: 4,
                background: "oklch(0.55 0.18 30 / 0.15)",
                color: "oklch(0.85 0.15 50)",
                border: "1px solid oklch(0.55 0.18 30 / 0.35)",
                fontSize: 9.5, whiteSpace: "nowrap", flexShrink: 0,
              }}>★ PRIORITY</span>
            )}
            {message.pinnedAt && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                padding: "2px 6px", borderRadius: 4,
                background: "var(--rv-tag-bg)", color: "var(--rv-accent)",
                border: "1px solid var(--rv-accent-line)", fontSize: 9.5,
                whiteSpace: "nowrap", flexShrink: 0,
              }}>📌 PINNED</span>
            )}
          </div>
        )}

        {/* Reply quote — resolve replyTo (string id or object) to the referenced message */}
        {(() => {
          const replyRef = resolveReply(message.replyTo, allMessages);
          if (!replyRef) return null;
          const replyFromMe = replyRef.from === "me"
            || replyRef.sender === currentUser;
          const replyLabel = replyFromMe ? "You" : (contact?.name || "");
          const snippet = (replyRef.text && String(replyRef.text).trim())
            || (replyRef.gifUrl ? "[GIF]" : "")
            || (Array.isArray(replyRef.files) && replyRef.files[0]
                ? `[${replyRef.files[0].name || (String(replyRef.files[0].type || "").startsWith("image/") ? "Image" : "File")}]`
                : "")
            || (replyRef.voiceUrl ? "[Voice]" : "")
            || "";
          const hasSnippet = !!snippet;
          return (
            <button
              onClick={() => onJump && onJump(replyRef.id)}
              style={{
                all: "unset", cursor: "pointer",
                alignSelf: mine ? "flex-end" : "flex-start",
                display: "flex", alignItems: "flex-start", gap: 8,
                fontSize: 11.5, fontFamily: "var(--rv-mono)",
                padding: "5px 12px 14px",
                marginBottom: -8,
                maxWidth: "100%",
                width: "min(520px, 100%)",
                boxSizing: "border-box",
                borderLeft: mine ? "none" : "2px solid var(--rv-accent)",
                borderRight: mine ? "2px solid var(--rv-accent)" : "none",
                opacity: 0.85,
              }}
              title="Jump to replied message"
            >
              <span style={{ color: "var(--rv-accent)", whiteSpace: "nowrap", flexShrink: 0 }}>
                ↳ {replyLabel}
              </span>
              <span style={{
                flex: 1, minWidth: 0,
                display: "-webkit-box",
                WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                overflow: "hidden", wordBreak: "break-word",
                color: "var(--rv-text-dim)", fontFamily: "inherit",
                fontStyle: hasSnippet ? "italic" : "normal",
                opacity: hasSnippet ? 1 : 0.6,
                lineHeight: 1.4,
              }}>{hasSnippet ? `"${snippet.slice(0, 200)}"` : "(message unavailable)"}</span>
            </button>
          );
        })()}

        {/* Bubble + hover menu wrapper */}
        {(message.text || (!message.gifUrl && !message.files)) && (
          <div style={{ position: "relative", maxWidth: "100%" }}>
            {editing ? (
              <div style={{
                background: "var(--rv-input-bg)", border: "1px solid var(--rv-accent)",
                borderRadius: 16, padding: "8px 10px", minWidth: 260,
              }}>
                <textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      onEdit && onEdit(message, editValue);
                      setEditing(false);
                    }
                    if (e.key === "Escape") { setEditing(false); setEditValue(message.text || ""); }
                  }}
                  autoFocus
                  style={{
                    width: "100%", background: "transparent", border: "none",
                    outline: "none", resize: "vertical", minHeight: 44,
                    color: "var(--rv-text)", fontSize: 14, lineHeight: 1.5,
                    fontFamily: "inherit",
                  }}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 6, fontSize: 10.5, fontFamily: "var(--rv-mono)", color: "var(--rv-text-faint)" }}>
                  <span>⏎ save</span><span>·</span><span>esc cancel</span>
                </div>
              </div>
            ) : (
              <Bubble mine={mine} isLastInGroup={isLastInGroup} priority={message.priority} formatting={message.formatting}>
                {message.text}
                {message.edited && (
                  <span style={{ fontSize: 10, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", marginLeft: 6, opacity: 0.7 }}>(edited)</span>
                )}
              </Bubble>
            )}
            {hovered && !editing && (
              <HoverMenu
                mine={mine}
                onReply={() => onReply && onReply(message)}
                onReact={(e) => onReact && onReact(message, e)}
                onMore={() => setMoreOpen(v => !v)}
                moreOpen={moreOpen}
              />
            )}
            {moreOpen && !editing && (
              <MoreMenu
                mine={mine}
                message={message}
                onClose={() => setMoreOpen(false)}
                onPin={() => { onPin && onPin(message); setMoreOpen(false); }}
                onEdit={() => { setEditing(true); setMoreOpen(false); }}
                onUnsend={() => { onUnsend && onUnsend(message); setMoreOpen(false); }}
                onCopy={() => { navigator.clipboard?.writeText(message.text || ""); setMoreOpen(false); }}
              />
            )}
          </div>
        )}

        {message.gifUrl && (
          <div style={{
            marginTop: 4,
            borderRadius: 14, overflow: "hidden",
            border: "1px solid var(--rv-border)",
            maxWidth: 280,
          }}>
            <img src={message.gifUrl} alt="GIF" style={{ width: "100%", display: "block" }} />
          </div>
        )}

        {!message.gifUrl && message.text && extractFirstUrl(message.text) && (
          <LinkPreview url={extractFirstUrl(message.text)} />
        )}

        {message.voiceUrl && (
          <div style={{
            marginTop: 4, padding: "8px 12px",
            borderRadius: 16,
            background: mine ? "var(--rv-bubble-me)" : "var(--rv-bubble-them)",
            border: `1px solid ${mine ? "var(--rv-bubble-me-border)" : "var(--rv-bubble-them-border)"}`,
          }}>
            <audio src={message.voiceUrl} controls style={{ width: 240, height: 36 }} />
          </div>
        )}

        {Array.isArray(message.files) && message.files.map((f, i) => {
          const isImage = (f.type || "").startsWith("image/");
          const isAudio = (f.type || "").startsWith("audio/");
          if (isAudio) {
            return (
              <div key={i} style={{
                marginTop: 4, padding: "8px 12px",
                borderRadius: 16,
                background: mine ? "var(--rv-bubble-me)" : "var(--rv-bubble-them)",
                border: `1px solid ${mine ? "var(--rv-bubble-me-border)" : "var(--rv-bubble-them-border)"}`,
              }}>
                <audio src={f.url} controls style={{ width: 240, height: 36 }} />
              </div>
            );
          }
          if (isImage) {
            return (
              <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{
                marginTop: 4, display: "block",
                borderRadius: 14, overflow: "hidden",
                border: "1px solid var(--rv-border)", maxWidth: 320,
              }}>
                <img src={f.url} alt={f.name || ""} style={{ width: "100%", display: "block" }} />
              </a>
            );
          }
          // File card — matches the mockup's attachment card (icon + title +
          // meta + trailing chevron). Meta composes from file type and size.
          const ext = (f.name || "").split(".").pop().toUpperCase();
          const sizeStr = f.size ? `${Math.round(f.size / 1024)} KB` : "";
          const metaBits = [ext && ext.length <= 5 ? ext : null, sizeStr].filter(Boolean);
          return (
            <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{
              marginTop: 6, display: "flex", alignItems: "center", gap: 12,
              padding: "12px 14px", borderRadius: 14,
              border: "1px solid var(--rv-border)",
              background: "var(--rv-card-bg)", textDecoration: "none",
              color: "inherit", minWidth: 260,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: "var(--rv-accent-soft)", color: "var(--rv-accent)",
                display: "grid", placeItems: "center", flexShrink: 0,
              }}><IconDoc size={18} /></div>
              <div style={{ lineHeight: 1.25, minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--rv-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name || "File"}</div>
                {metaBits.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", marginTop: 2 }}>
                    {metaBits.join(" · ")}
                  </div>
                )}
              </div>
              <IconChev size={14} />
            </a>
          );
        })}

        {message.attachment && <AttachmentCard att={message.attachment} />}

        {message.reactions && Object.keys(message.reactions).length > 0 && (
          <div style={{
            display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap",
            flexDirection: mine ? "row-reverse" : "row",
          }}>
            {normalizeReactions(message.reactions, currentUser).map((r) => (
              <button
                key={r.e}
                onClick={() => onReact && onReact(message, r.e)}
                style={{
                  all: "unset", cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 8px 2px 6px", borderRadius: 999,
                  background: r.mine ? "var(--rv-accent-soft)" : "var(--rv-bubble-them)",
                  border: `1px solid ${r.mine ? "var(--rv-accent-line)" : "var(--rv-border)"}`,
                  fontSize: 11, fontFamily: "var(--rv-mono)",
                  color: r.mine ? "var(--rv-accent)" : "var(--rv-text-dim)",
                }}
                title={r.users.join(", ")}
              >
                <span style={{ fontSize: 13, fontFamily: "system-ui" }}>{r.e}</span>
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {isLastInGroup && mine && message.status && (
          <div style={{
            fontSize: 10.5,
            color: message.status === "read" ? "var(--rv-accent)" : "var(--rv-text-faint)",
            fontFamily: "var(--rv-mono)", marginTop: 4, padding: "0 6px",
            letterSpacing: 0.3, textTransform: "uppercase",
          }}>
            {message.status === "read" ? "✓✓ Read" : "✓ Delivered"}
          </div>
        )}
      </div>
    </div>
  );
}

// Server shape: { "👍": ["kaliph", "kathrine"], ... }
// Legacy shape: [{ e, by }, ...]
function normalizeReactions(reactions, currentUser) {
  if (Array.isArray(reactions)) {
    const map = {};
    reactions.forEach(r => {
      if (!map[r.e]) map[r.e] = { e: r.e, count: 0, mine: false, users: [] };
      map[r.e].count++;
      map[r.e].users.push(r.by);
      if (r.by === currentUser || r.by === "me") map[r.e].mine = true;
    });
    return Object.values(map);
  }
  return Object.entries(reactions || {}).map(([e, users]) => ({
    e,
    count: (users || []).length,
    users: users || [],
    mine: Array.isArray(users) && users.includes(currentUser),
  }));
}

// Softer bubble — gentler radius, subtle gradient, inner highlight
function Bubble({ mine, isLastInGroup, priority, formatting, children }) {
  const radius = 18;
  const tail = isLastInGroup ? 6 : radius;
  const fontFamily = formatting?.font === "mono" ? "var(--rv-mono)"
    : formatting?.font === "serif" ? "'Cormorant Garamond', serif"
    : formatting?.font === "cursive" ? "cursive"
    : undefined;
  return (
    <div
      style={{
        position: "relative",
        background: mine
          ? "linear-gradient(180deg, var(--rv-bubble-me) 0%, var(--rv-bubble-me-dark) 100%)"
          : "linear-gradient(180deg, var(--rv-bubble-them) 0%, var(--rv-bubble-them-dark) 100%)",
        color: mine ? "var(--rv-bubble-me-fg)" : "var(--rv-text)",
        padding: "11px 15px 12px",
        borderRadius: mine
          ? `${radius}px ${radius}px ${tail}px ${radius}px`
          : `${radius}px ${radius}px ${radius}px ${tail}px`,
        fontSize: 14,
        lineHeight: 1.5,
        border: mine ? "1px solid var(--rv-bubble-me-border)" : "1px solid var(--rv-bubble-them-border)",
        boxShadow: mine
          ? "0 1px 0 rgba(255,255,255,0.08) inset, 0 1px 3px rgba(0,0,0,0.25)"
          : "0 1px 0 rgba(255,255,255,0.025) inset, 0 1px 2px rgba(0,0,0,0.15)",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
        fontWeight: formatting?.bold ? 700 : undefined,
        fontStyle: formatting?.italic ? "italic" : undefined,
        textDecoration: formatting?.underline ? "underline" : undefined,
        fontFamily,
      }}
    >
      {priority && !mine && (
        <span style={{
          position: "absolute", left: -1, top: 10, bottom: 10,
          width: 3, borderRadius: 2,
          background: "oklch(0.78 0.17 50)",
          boxShadow: "0 0 10px oklch(0.78 0.17 50 / 0.55)",
        }} />
      )}
      {priority && mine && (
        <span style={{
          position: "absolute", right: -1, top: 10, bottom: 10,
          width: 3, borderRadius: 2,
          background: "oklch(0.75 0.17 50)",
          boxShadow: "0 0 10px oklch(0.78 0.17 50 / 0.55)",
        }} />
      )}
      {children}
    </div>
  );
}

// Floating hover menu — quick reactions + emoji picker + reply + more
function HoverMenu({ mine, onReply, onReact, onMore, moreOpen }) {
  const QUICK = ["👍", "✅", "❤️", "🎯"];
  const [emojiOpen, setEmojiOpen] = React.useState(false);
  return (
    <div
      style={{
        position: "absolute",
        top: -18,
        [mine ? "left" : "right"]: 0,
        transform: mine ? "translateX(-6px)" : "translateX(6px)",
        display: "flex", alignItems: "center",
        background: "oklch(0.12 0.01 60 / 0.92)",
        backdropFilter: "blur(14px)",
        border: "1px solid var(--rv-border)",
        borderRadius: 999,
        padding: 3,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        zIndex: 20,
        gap: 1,
      }}
    >
      {QUICK.map((e, i) => (
        <button key={i} onClick={() => onReact && onReact(e)} style={hoverQuickBtn} title={`React with ${e}`}>
          <span style={{ fontSize: 15, fontFamily: "system-ui", lineHeight: 1 }}>{e}</span>
        </button>
      ))}
      <span style={{ width: 1, alignSelf: "stretch", margin: "4px 2px", background: "var(--rv-border)" }} />
      <button
        onClick={(e) => { e.stopPropagation(); setEmojiOpen(v => !v); }}
        style={{ ...hoverQuickBtn, background: emojiOpen ? "var(--rv-hover)" : "transparent", color: emojiOpen ? "var(--rv-accent)" : "var(--rv-text-dim)" }}
        title="Pick emoji reaction"
      >
        <IconSmile size={14} />
      </button>
      <button onClick={onReply} style={hoverQuickBtn} title="Reply">
        <IconReply size={14} />
      </button>
      <button
        onClick={onMore}
        style={{ ...hoverQuickBtn, background: moreOpen ? "var(--rv-hover)" : "transparent" }}
        title="More"
      >
        <IconMore size={14} />
      </button>
      {emojiOpen && (
        <ReactionEmojiPicker
          mine={mine}
          onPick={(e) => { onReact && onReact(e); setEmojiOpen(false); }}
          onClose={() => setEmojiOpen(false)}
        />
      )}
    </div>
  );
}

function ReactionEmojiPicker({ mine, onPick, onClose }) {
  const groups = [
    { name: "Frequent", emojis: ["👍", "✅", "❤️", "🎯", "🙏", "👀", "🔥", "💯", "😂", "😍"] },
    { name: "Smileys", emojis: ["😀","😃","😄","😁","😅","🤣","😊","😇","🙂","🙃","😉","😍","🥰","😘","😎","🤓","😡","😭","🥳","😴"] },
    { name: "Hands", emojis: ["👍","👎","👌","✌️","🤞","🤝","🙏","👏","🤲","💪","🫡","👋","🤘","🤙"] },
    { name: "Objects", emojis: ["📎","📄","📅","⏰","📌","🔑","💼","📊","📈","📉","💰","🏛️"] },
    { name: "Symbols", emojis: ["✅","❌","⭐","🎯","🔔","💡","⚠️","🔒","🔓","♥️","💯","❤️"] },
  ];
  const [q, setQ] = React.useState("");
  const all = groups.flatMap(g => g.emojis);
  React.useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        [mine ? "left" : "right"]: 0,
        width: 280, height: 280,
        background: "oklch(0.12 0.01 60 / 0.97)",
        backdropFilter: "blur(16px)",
        border: "1px solid var(--rv-border)",
        borderRadius: 12, padding: 8,
        boxShadow: "0 16px 40px rgba(0,0,0,0.55)",
        zIndex: 30,
        display: "flex", flexDirection: "column", gap: 6,
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search emoji…"
        autoFocus
        style={{
          padding: "6px 10px", borderRadius: 8,
          background: "var(--rv-input-bg)", border: "1px solid var(--rv-input-border)",
          color: "var(--rv-text)", fontSize: 12, outline: "none",
          fontFamily: "inherit",
        }}
      />
      <div className="rv-scroll" style={{
        flex: 1, overflowY: "auto",
        display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2,
      }}>
        {(q ? all : all).map((e, i) => (
          <button key={i} onClick={() => onPick(e)} style={{
            all: "unset", cursor: "pointer",
            aspectRatio: "1/1",
            display: "grid", placeItems: "center",
            fontSize: 18, borderRadius: 6,
            fontFamily: "system-ui, 'Apple Color Emoji', 'Segoe UI Emoji'",
          }}
          onMouseOver={(ev) => (ev.currentTarget.style.background = "var(--rv-hover)")}
          onMouseOut={(ev) => (ev.currentTarget.style.background = "transparent")}
          >{e}</button>
        ))}
      </div>
    </div>
  );
}

function MoreMenu({ mine, message, onClose, onPin, onEdit, onUnsend, onCopy }) {
  React.useEffect(() => {
    const handler = () => onClose && onClose();
    setTimeout(() => document.addEventListener("click", handler, { once: true }), 0);
    return () => document.removeEventListener("click", handler);
  }, []);
  const items = [];
  items.push({ label: message.pinnedAt ? "Unpin" : "Pin", icon: IconPin, onClick: onPin });
  if (mine) items.push({ label: "Edit", icon: IconEdit, onClick: onEdit });
  items.push({ label: "Copy text", icon: IconShare, onClick: onCopy });
  if (mine) items.push({ label: "Unsend", icon: IconX, onClick: onUnsend, danger: true });
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: -6,
        [mine ? "right" : "left"]: "calc(100% + 6px)",
        background: "oklch(0.12 0.01 60 / 0.96)",
        backdropFilter: "blur(16px)",
        border: "1px solid var(--rv-border)",
        borderRadius: 10,
        padding: 4,
        minWidth: 140,
        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        zIndex: 30,
        display: "flex", flexDirection: "column",
      }}
    >
      {items.map((it, i) => {
        const Ico = it.icon;
        return (
          <button key={i} onClick={it.onClick} style={{
            all: "unset", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 10,
            padding: "7px 10px", borderRadius: 6,
            fontSize: 12, color: it.danger ? "oklch(0.75 0.18 30)" : "var(--rv-text)",
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = "var(--rv-hover)")}
          onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Ico size={13} />
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const hoverQuickBtn = {
  all: "unset", cursor: "pointer",
  width: 26, height: 26, borderRadius: 999,
  display: "grid", placeItems: "center",
  color: "var(--rv-text-dim)",
  transition: "background 120ms, transform 100ms",
};

function AttachmentCard({ att }) {
  return (
    <div
      style={{
        marginTop: 6, padding: "12px 14px",
        borderRadius: 14,
        border: "1px solid var(--rv-border)",
        background: "var(--rv-card-bg)",
        display: "flex", gap: 12, alignItems: "center",
        minWidth: 260,
      }}
    >
      <div
        style={{
          width: 36, height: 36, borderRadius: 10,
          background: "var(--rv-accent-soft)",
          color: "var(--rv-accent)",
          display: "grid", placeItems: "center", flexShrink: 0,
        }}
      ><IconDoc size={18} /></div>
      <div style={{ lineHeight: 1.25, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--rv-text)" }}>{att.title}</div>
        <div style={{ fontSize: 11, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", marginTop: 2 }}>
          {att.meta}
        </div>
      </div>
      <IconChev size={14} />
    </div>
  );
}

function DateDivider({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0 8px" }}>
      <div style={{ flex: 1, height: 1, background: "var(--rv-border)" }} />
      <span style={{ fontFamily: "var(--rv-mono)", fontSize: 10.5, color: "var(--rv-text-faint)", letterSpacing: 1.2, textTransform: "uppercase" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "var(--rv-border)" }} />
    </div>
  );
}

function MessageList({ thread, onReply, onReact, onPin, onUnsend, onEdit, onJump, currentUser, searchQuery, typing, wallpaper, onLoadOlder, hasMore, jumpToId }) {
  const q = (searchQuery || "").trim().toLowerCase();
  const msgs = q
    ? thread.messages.filter(m => (m.text || "").toLowerCase().includes(q))
    : thread.messages;
  const withGroupInfo = msgs.map((m, i) => {
    const prev = msgs[i - 1];
    const next = msgs[i + 1];
    // Priority messages always start/end their own group so the PRIORITY tag
    // header is guaranteed to render above them.
    return {
      ...m,
      isFirstInGroup: !prev || prev.from !== m.from || !!m.priority || !!prev.priority || !!m.pinnedAt || !!prev.pinnedAt,
      isLastInGroup:  !next || next.from !== m.from || !!m.priority || !!next.priority || !!m.pinnedAt || !!next.pinnedAt,
    };
  });

  // Auto-scroll to bottom on new messages (except when loading older)
  const scrollerRef = React.useRef(null);
  const lastCount = React.useRef(msgs.length);

  // Scroll to bottom on initial mount
  React.useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, []);

  React.useEffect(() => {
    if (!scrollerRef.current) return;
    if (msgs.length > lastCount.current) {
      const el = scrollerRef.current;
      const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 400;
      if (nearBottom) el.scrollTop = el.scrollHeight;
    }
    lastCount.current = msgs.length;
  }, [msgs.length]);

  // Top-scroll to load older
  const onScroll = React.useCallback((e) => {
    if (e.target.scrollTop < 80 && hasMore && onLoadOlder) {
      const before = e.target.scrollHeight;
      onLoadOlder().then(() => {
        requestAnimationFrame(() => {
          if (scrollerRef.current) {
            const delta = scrollerRef.current.scrollHeight - before;
            scrollerRef.current.scrollTop = Math.max(80, delta);
          }
        });
      });
    }
  }, [hasMore, onLoadOlder]);

  // Jump to a message by id
  React.useEffect(() => {
    if (!jumpToId) return;
    const el = scrollerRef.current?.querySelector(`[data-msg-id="${jumpToId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("rv-msg-flash");
      setTimeout(() => el.classList.remove("rv-msg-flash"), 1800);
    }
  }, [jumpToId]);

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="rv-scroll"
      style={{
        flex: 1, overflowY: "auto", overflowX: "hidden",
        padding: "8px 32px 24px",
        display: "flex", flexDirection: "column",
        position: "relative",
        minWidth: 0,
        backgroundImage: wallpaper ? `linear-gradient(oklch(0.155 0.014 70 / 0.88), oklch(0.155 0.014 70 / 0.88)), url(${wallpaper})` : undefined,
        backgroundSize: "cover", backgroundPosition: "center",
      }}
    >
      <div style={{ width: "100%", flex: 1 }}>
        {msgs.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "60px 20px",
            color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)",
            fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase",
          }}>
            No messages yet.
          </div>
        ) : (
          <>
            <DateDivider label={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} />
            {withGroupInfo.map((m) => (
              <MessageGroup
                key={m.id}
                message={m}
                contact={thread.contact}
                isFirstInGroup={m.isFirstInGroup}
                isLastInGroup={m.isLastInGroup}
                currentUser={currentUser}
                allMessages={thread.messages}
                onReply={onReply}
                onReact={onReact}
                onPin={onPin}
                onUnsend={onUnsend}
                onEdit={onEdit}
                onJump={onJump}
              />
            ))}
            {typing && <TypingIndicator contact={thread.contact} />}
          </>
        )}
      </div>
    </div>
  );
}

function TypingIndicator({ contact }) {
  return (
    <div style={{ display: "flex", gap: 12, marginTop: 18, alignItems: "flex-end" }}>
      <Avatar name={contact.avatar} src={contact.avatarSrc} size={32} />
      <div
        style={{
          background: "var(--rv-bubble-them)",
          borderRadius: "18px 18px 18px 6px",
          border: "1px solid var(--rv-border)",
          padding: "12px 14px",
          display: "flex", gap: 4,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "var(--rv-text-faint)",
              animation: `typingDot 1.2s ease-in-out ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// Small icons needed here
const IconSmile = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><circle cx="9" cy="10" r="0.6" fill="currentColor" /><circle cx="15" cy="10" r="0.6" fill="currentColor" /><path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8" />
  </svg>
);
const IconReply = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 9V5l-7 7 7 7v-4c5 0 9 1.5 11 6-1-6-4-12-11-12z" />
  </svg>
);

// Server stores replyTo as an id string. Look up the referenced message so
// the quote can show who said what. Falls back gracefully if the referenced
// message isn't in the currently-loaded window.
// Global snippet cache — primed by Composer when replying so we can still show
// a snippet even if the parent message falls outside the loaded window.
window.__rvReplySnippetCache = window.__rvReplySnippetCache || new Map();
function rvPrimeReplySnippet(msg) {
  if (!msg || !msg.id) return;
  const cache = window.__rvReplySnippetCache;
  const text = msg.text
    || (msg.gifUrl ? "[GIF]" : "")
    || (Array.isArray(msg.files) && msg.files[0]
        ? `[${msg.files[0].name || (String(msg.files[0].type || "").startsWith("image/") ? "Image" : "File")}]`
        : "")
    || (msg.voiceUrl ? "[Voice]" : "")
    || "";
  cache.set(String(msg.id), {
    id: String(msg.id),
    text,
    from: msg.from,
    sender: msg.sender,
    gifUrl: msg.gifUrl,
    files: msg.files,
    voiceUrl: msg.voiceUrl,
  });
}
window.rvPrimeReplySnippet = rvPrimeReplySnippet;

function resolveReply(replyTo, allMessages) {
  if (!replyTo) return null;
  if (typeof replyTo === "object") {
    // Legacy object shape — still honour its from/snippet if present
    rvPrimeReplySnippet(replyTo);
    return {
      id: replyTo.id,
      sender: replyTo.sender || replyTo.from,
      from: replyTo.from,
      text: replyTo.text || replyTo.snippet || "",
      gifUrl: replyTo.gifUrl,
      files: replyTo.files,
      voiceUrl: replyTo.voiceUrl,
    };
  }
  const id = String(replyTo);
  if (Array.isArray(allMessages)) {
    const m = allMessages.find(x => String(x.id) === id);
    if (m) { rvPrimeReplySnippet(m); return m; }
  }
  const cached = window.__rvReplySnippetCache.get(id);
  if (cached) return cached;
  return { id, text: "" };
}

function extractFirstUrl(text) {
  const m = String(text || "").match(/https?:\/\/[^\s<>"'\)\]]+/i);
  return m ? m[0] : null;
}

const _linkPreviewCache = new Map();
function LinkPreview({ url }) {
  const [data, setData] = React.useState(() => _linkPreviewCache.get(url) || null);
  const [err, setErr] = React.useState(false);
  React.useEffect(() => {
    if (data || _linkPreviewCache.has(url)) return;
    let cancelled = false;
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { credentials: "same-origin" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled) return;
        if (d) { _linkPreviewCache.set(url, d); setData(d); }
        else setErr(true);
      })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [url, data]);
  if (err || !data) return null;
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{
      marginTop: 4, display: "block", width: "100%", maxWidth: 360,
      borderRadius: 12, overflow: "hidden",
      border: "1px solid var(--rv-border)",
      background: "var(--rv-card-bg)", textDecoration: "none", color: "inherit",
    }}>
      {data.image && (
        <img src={data.image} alt="" style={{ width: "100%", maxHeight: 180, objectFit: "cover", display: "block" }} />
      )}
      <div style={{ padding: "10px 12px" }}>
        {data.title && <div style={{ fontSize: 13, color: "var(--rv-text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.title}</div>}
        {data.description && (
          <div style={{
            fontSize: 11.5, color: "var(--rv-text-dim)", marginTop: 3,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{data.description}</div>
        )}
        <div style={{ fontSize: 10.5, color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", marginTop: 4 }}>{host}</div>
      </div>
    </a>
  );
}

Object.assign(window, {
  ChatHeader, MessageList, MessageGroup, DateDivider, Avatar, TypingIndicator,
  IconSmile, IconReply, LinkPreview, extractFirstUrl,
});
