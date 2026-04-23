// Composer — priority star, GIF picker, emoji picker, attach, voice, send.

// Discord-style shortcode → emoji map used for :name: autocomplete.
const VAULT_EMOJI = {
  'grinning':'😀','smiley':'😃','smile':'😄','grin':'😁','joy':'😂','rofl':'🤣',
  'sweat_smile':'😅','blush':'😊','innocent':'😇','smiling_face_with_hearts':'🥰',
  'heart_eyes':'😍','star_struck':'🤩','kissing_heart':'😘','kissing':'😗',
  'yum':'😋','stuck_out_tongue':'😛','stuck_out_tongue_winking_eye':'😜',
  'zany_face':'🤪','stuck_out_tongue_closed_eyes':'😝','money_mouth':'🤑',
  'hugging':'🤗','hand_over_mouth':'🤭','shushing_face':'🤫','thinking':'🤔',
  'saluting_face':'🫡','zipper_mouth':'🤐','raised_eyebrow':'🤨','neutral_face':'😐',
  'expressionless':'😑','no_mouth':'😶','smirk':'😏','unamused':'😒',
  'rolling_eyes':'🙄','grimacing':'😬','lying_face':'🤥','melting_face':'🫠',
  'relieved':'😌','pensive':'😔','sleepy':'😪','drooling_face':'🤤','sleeping':'😴',
  'mask':'😷','face_with_thermometer':'🤒','head_bandage':'🤕','nauseated_face':'🤢',
  'face_vomiting':'🤮','hot_face':'🥵','cold_face':'🥶','woozy_face':'🥴',
  'dizzy_face':'😵','exploding_head':'🤯','cowboy':'🤠','partying_face':'🥳',
  'sunglasses':'😎','nerd':'🤓','monocle_face':'🧐',
  'confused':'😕','worried':'😟','slightly_frowning_face':'🙁','frowning':'☹️',
  'open_mouth':'😮','hushed':'😯','astonished':'😲','flushed':'😳',
  'pleading_face':'🥺','face_holding_back_tears':'🥹','cry':'😢','sob':'😭',
  'scream':'😱','confounded':'😖','persevere':'😣','disappointed':'😞',
  'sweat':'😓','weary':'😩','tired_face':'😫','yawning_face':'🥱',
  'triumph':'😤','rage':'😡','cursing_face':'🤬','smiling_imp':'😈','imp':'👿',
  'skull':'💀','skull_crossbones':'☠️','poop':'💩','clown':'🤡','ghost':'👻',
  'alien':'👽','space_invader':'👾','robot':'🤖',
  'wave':'👋','raised_back_of_hand':'🤚','raised_hand':'✋','vulcan':'🖖',
  'ok_hand':'👌','pinched_fingers':'🤌','v':'✌️','crossed_fingers':'🤞',
  'love_you_gesture':'🤟','metal':'🤘','call_me':'🤙',
  'point_left':'👈','point_right':'👉','point_up_2':'👆','middle_finger':'🖕',
  'point_down':'👇','point_up':'☝️','thumbsup':'👍','thumbs_up':'👍','+1':'👍',
  'thumbsdown':'👎','thumbs_down':'👎','-1':'👎','fist':'✊','punch':'👊',
  'clap':'👏','raised_hands':'🙌','heart_hands':'🫶','open_hands':'👐',
  'handshake':'🤝','pray':'🙏','muscle':'💪','writing_hand':'✍️','nail_care':'💅',
  'heart':'❤️','red_heart':'❤️','orange_heart':'🧡','yellow_heart':'💛',
  'green_heart':'💚','blue_heart':'💙','purple_heart':'💜','black_heart':'🖤',
  'white_heart':'🤍','brown_heart':'🤎','broken_heart':'💔','two_hearts':'💕',
  'revolving_hearts':'💞','heartbeat':'💓','sparkling_heart':'💖','cupid':'💘',
  'sparkles':'✨','star':'⭐','star2':'🌟','dizzy':'💫','fire':'🔥','boom':'💥',
  'rainbow':'🌈','sunny':'☀️','crescent_moon':'🌙','zap':'⚡','snowflake':'❄️',
  'ocean':'🌊','cherry_blossom':'🌸','hibiscus':'🌺','four_leaf_clover':'🍀',
  'butterfly':'🦋','rose':'🌹','musical_note':'🎵','notes':'🎶','microphone':'🎤',
  'headphones':'🎧','crown':'👑','gem':'💎','crystal_ball':'🔮','dart':'🎯',
  'bulb':'💡','brain':'🧠','rocket':'🚀','trophy':'🏆','tada':'🎉',
  'confetti_ball':'🎊','gift':'🎁','ribbon':'🎀','medal':'🏅','first_place':'🥇',
  'moneybag':'💰','money_with_wings':'💸','iphone':'📱','computer':'💻',
  'bell':'🔔','white_check_mark':'✅','x':'❌','100':'💯',
  'pizza':'🍕','hamburger':'🍔','fries':'🍟','hotdog':'🌭','taco':'🌮',
  'ice_cream':'🍦','doughnut':'🍩','cookie':'🍪','cake':'🎂',
  'coffee':'☕','tea':'🍵','beer':'🍺','wine_glass':'🍷','cocktail':'🍸',
  'dog':'🐶','cat':'🐱','rabbit':'🐰','fox':'🦊','bear':'🐻','panda_face':'🐼',
  'koala':'🐨','lion_face':'🦁','cow':'🐮','pig':'🐷','frog':'🐸',
  'monkey_face':'🐵','chicken':'🐔','penguin':'🐧','bird':'🐦','eagle':'🦅',
  'owl':'🦉','bat':'🦇','wolf':'🐺','horse':'🐴','unicorn':'🦄','bee':'🐝',
  'snake':'🐍','turtle':'🐢','octopus':'🐙','shark':'🦈','whale':'🐳',
  'eyes':'👀','eye':'👁️','tongue':'👅','lips':'👄','kiss':'💋',
  'droplet':'💧','sweat_drops':'💦','dash':'💨','zzz':'💤',
  'speech_balloon':'💬','thought_balloon':'💭','anger':'💢',
  'no_entry':'⛔','warning':'⚠️','radioactive':'☢️','biohazard':'☣️',
  'heavy_plus_sign':'➕','heavy_minus_sign':'➖','question':'❓','exclamation':'❗',
  'recycle':'♻️','infinity':'♾️','peace':'☮️','yin_yang':'☯️','beginner':'🔰',
  'trident':'🔱','rainbow_flag':'🏳️‍🌈','checkered_flag':'🏁',
};

function getColonQuery(val, pos) {
  let i = pos - 1;
  while (i >= 0 && val[i] !== ':' && val[i] !== ' ' && val[i] !== '\n') i--;
  if (i < 0 || val[i] !== ':') return null;
  const query = val.slice(i + 1, pos);
  if (query.length < 2) return null;
  return { start: i, end: pos, query: query.toLowerCase() };
}

function convertColonEmojis(text) {
  return text.replace(/:([a-z0-9_+\-]+):/gi, (match, name) => {
    const emoji = VAULT_EMOJI[name.toLowerCase()];
    return emoji ? emoji.trim() : match;
  });
}

function Composer({ beamIntensity, beamSpeed, beamEnabled, beamHue, contactName, onSend, onKeystroke, onTyping, replyTo, onCancelReply }) {
  const typingTimeoutRef = React.useRef(null);
  const [value, setValue] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const [priority, setPriority] = React.useState(false);
  const [emojiOpen, setEmojiOpen] = React.useState(false);
  const [gifOpen, setGifOpen] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [pendingFiles, setPendingFiles] = React.useState([]);
  const [formatting, setFormatting] = React.useState({ bold: false, italic: false, underline: false, font: "default" });
  const [formatOpen, setFormatOpen] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const recorderRef = React.useRef(null);
  const recordedChunksRef = React.useRef([]);
  const [recTime, setRecTime] = React.useState(0);
  const recIntervalRef = React.useRef(null);
  const taRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const [emojiAC, setEmojiAC] = React.useState({ open: false, results: [], index: 0 });
  const emojiACTimerRef = React.useRef(null);

  React.useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = "auto";
    taRef.current.style.height = Math.min(taRef.current.scrollHeight, 180) + "px";
  }, [value]);

  const beamColorA = beamHue ? `oklch(0.85 0.15 ${beamHue})` : "var(--rv-accent-beam)";
  const beamColorB = "rgba(255,255,255,0)";
  const priorityColor = "oklch(0.82 0.17 50)";

  const insertAtCursor = (text) => {
    const ta = taRef.current;
    if (!ta) { setValue(v => v + text); return; }
    const start = ta.selectionStart, end = ta.selectionEnd;
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + text.length, start + text.length); });
  };

  const selectEmojiAC = React.useCallback((idx) => {
    const result = emojiAC.results[idx];
    if (!result || !taRef.current) return;
    const ta = taRef.current;
    const match = getColonQuery(ta.value, ta.selectionStart);
    if (!match) return;
    const newVal = ta.value.slice(0, match.start) + result.emoji + ta.value.slice(match.end);
    setValue(newVal);
    setEmojiAC({ open: false, results: [], index: 0 });
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = match.start + result.emoji.length;
      ta.focus();
    });
  }, [emojiAC.results]);

  const handleSend = async () => {
    if (sending) return;
    if (!value.trim() && pendingFiles.length === 0) return;
    if (!onSend) { setValue(""); return; }
    setEmojiAC({ open: false, results: [], index: 0 });
    const snapshot = { text: convertColonEmojis(value.trim()), priority, files: pendingFiles, formatting };
    setSending(true);
    try {
      const ok = await onSend(snapshot);
      if (ok !== false) {
        setValue("");
        setPriority(false);
        setPendingFiles([]);
        setFormatting({ bold: false, italic: false, underline: false, font: "default" });
      }
    } finally {
      setSending(false);
    }
  };

  const sendGif = async (gifUrl) => {
    if (!onSend) return;
    await onSend({ text: "", gifUrl, priority });
    setGifOpen(false);
    setPriority(false);
  };

  const pickFiles = (files) => {
    if (!files || !files.length) return;
    setPendingFiles(prev => [...prev, ...Array.from(files)]);
  };
  const removeFile = (i) => setPendingFiles(prev => prev.filter((_, idx) => idx !== i));

  // Voice recording
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) recordedChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        if (blob.size < 200) return;
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
        if (onSend) await onSend({ text: "", files: [file], voice: true, priority });
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setRecTime(0);
      clearInterval(recIntervalRef.current);
      recIntervalRef.current = setInterval(() => setRecTime(t => t + 1), 1000);
    } catch (e) {
      if (window.rvAlert) window.rvAlert("Microphone access denied. Enable it in your browser settings.", { title: "Can't record" });
    }
  };
  const stopRec = (send = true) => {
    clearInterval(recIntervalRef.current);
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      if (!send) rec.ondataavailable = null;
      rec.stop();
    }
    setRecording(false);
    setRecTime(0);
  };

  // Drag-drop + paste
  const wrapRef = React.useRef(null);
  const [dragOver, setDragOver] = React.useState(false);
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
    const onDragLeave = () => setDragOver(false);
    const onDrop = (e) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer?.files?.length) pickFiles(e.dataTransfer.files);
    };
    const onPaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (const it of items) {
        if (it.kind === "file") {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        pickFiles(files);
      }
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    el.addEventListener("paste", onPaste);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
      el.removeEventListener("paste", onPaste);
    };
  }, []);

  const toggleFmt = (k) => setFormatting(prev => ({ ...prev, [k]: !prev[k] }));

  return (
    <div ref={wrapRef} style={{ padding: "10px 32px 22px", background: "transparent", position: "relative" }}>
      {dragOver && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 10,
          background: "var(--rv-accent-soft)",
          border: "2px dashed var(--rv-accent)",
          borderRadius: 20, margin: "10px 32px 22px",
          display: "grid", placeItems: "center",
          color: "var(--rv-accent)",
          fontFamily: "var(--rv-mono)", fontSize: 12,
          letterSpacing: 1, textTransform: "uppercase",
          pointerEvents: "none",
        }}>Drop to attach</div>
      )}
      <div style={{ width: "100%", margin: "0 auto", position: "relative" }}>
        {emojiOpen && <EmojiPicker onPick={(e) => { insertAtCursor(e); setEmojiOpen(false); }} onClose={() => setEmojiOpen(false)} />}
        {gifOpen && <GifPicker onPick={(gif) => sendGif(gif.url)} onClose={() => setGifOpen(false)} />}
        {emojiAC.open && (
          <div style={{
            position: "absolute", bottom: "100%", left: 0, right: 0,
            marginBottom: 6, zIndex: 200,
            background: "var(--rv-sidebar-bg)",
            border: "1px solid var(--rv-border)",
            borderRadius: 12, overflow: "hidden",
            boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
          }}>
            {emojiAC.results.map((r, i) => (
              <div
                key={r.name}
                onMouseDown={(e) => { e.preventDefault(); selectEmojiAC(i); }}
                onMouseEnter={() => setEmojiAC(prev => ({ ...prev, index: i }))}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "7px 14px", cursor: "pointer",
                  background: i === emojiAC.index ? "var(--rv-hover, oklch(1 0 0 / 0.07))" : "transparent",
                  transition: "background 0.1s",
                }}
              >
                <span style={{ fontSize: "1.25rem", width: 28, textAlign: "center", lineHeight: 1 }}>{r.emoji}</span>
                <span style={{
                  fontSize: 12, fontFamily: "var(--rv-mono)",
                  color: i === emojiAC.index ? "var(--rv-text)" : "var(--rv-text-dim, var(--rv-text-faint))",
                  fontWeight: i === emojiAC.index ? 500 : 400,
                }}>:{r.name}:</span>
              </div>
            ))}
          </div>
        )}
        <div
          style={{
            position: "relative",
            borderRadius: 20,
            background: "var(--rv-input-bg)",
            border: priority ? `1px solid ${priorityColor}` : "1px solid var(--rv-input-border)",
            boxShadow: priority
              ? `0 0 0 1px ${priorityColor}, 0 8px 32px oklch(0.82 0.17 50 / 0.15)`
              : (focused ? "0 8px 32px rgba(0,0,0,0.4)" : "0 2px 12px rgba(0,0,0,0.25)"),
            transition: "box-shadow 200ms, border-color 200ms",
            overflow: "visible",
          }}
        >
          {beamEnabled && !priority && (
            <BorderBeam
              size={beamIntensity > 0.7 ? 120 : beamIntensity > 0.4 ? 80 : 50}
              duration={beamSpeed}
              intensity={beamIntensity}
              radius={20}
              thickness={1.5}
              colorA={beamColorA}
              colorB={beamColorB}
              glow={beamIntensity > 0.6}
            />
          )}
          {beamEnabled && priority && (
            <BorderBeam
              size={140} duration={Math.max(3, beamSpeed * 0.6)}
              intensity={Math.max(0.8, beamIntensity)}
              radius={20} thickness={1.5}
              colorA={priorityColor} colorB={beamColorB}
              glow={true}
            />
          )}

          {replyTo && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 14px 0",
              fontFamily: "var(--rv-mono)", fontSize: 11,
              color: "var(--rv-text-dim)", position: "relative", zIndex: 2,
            }}>
              <span style={{ color: "var(--rv-accent)" }}>↳ Replying to {replyTo.from === "me" ? "yourself" : (replyTo.sender || "message")}</span>
              <span style={{
                flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: "var(--rv-text-faint)", fontStyle: "italic", fontFamily: "inherit",
              }}>"{(replyTo.text || "").slice(0, 120)}"</span>
              <button onClick={onCancelReply} style={{
                all: "unset", cursor: "pointer", color: "var(--rv-text-faint)",
                padding: "2px 6px", fontSize: 14,
              }}>×</button>
            </div>
          )}
          <div style={{ position: "relative", padding: "12px 14px 10px" }}>
            {priority && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                fontFamily: "var(--rv-mono)", fontSize: 10.5,
                color: priorityColor, letterSpacing: 0.6,
                marginBottom: 6, textTransform: "uppercase",
              }}>
                <span>★</span>Priority message{contactName ? ` · ${contactName} will be pinged` : ""}
              </div>
            )}
            <textarea
              ref={taRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (onKeystroke) onKeystroke();
                if (onTyping && e.target.value) {
                  onTyping(true);
                  clearTimeout(typingTimeoutRef.current);
                  typingTimeoutRef.current = setTimeout(() => onTyping(false), 2500);
                }
                clearTimeout(emojiACTimerRef.current);
                const ta = e.target;
                emojiACTimerRef.current = setTimeout(() => {
                  const match = getColonQuery(ta.value, ta.selectionStart);
                  if (!match) { setEmojiAC({ open: false, results: [], index: 0 }); return; }
                  const results = Object.entries(VAULT_EMOJI)
                    .filter(([name]) => name.includes(match.query))
                    .slice(0, 8)
                    .map(([name, emoji]) => ({ name, emoji: emoji.trim() }));
                  setEmojiAC(results.length
                    ? { open: true, results, index: 0 }
                    : { open: false, results: [], index: 0 });
                }, 80);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                onTyping && onTyping(false);
                clearTimeout(typingTimeoutRef.current);
                setTimeout(() => setEmojiAC({ open: false, results: [], index: 0 }), 150);
              }}
              onKeyDown={(e) => {
                if (emojiAC.open) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setEmojiAC(prev => ({ ...prev, index: (prev.index + 1) % prev.results.length })); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setEmojiAC(prev => ({ ...prev, index: (prev.index - 1 + prev.results.length) % prev.results.length })); return; }
                  if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); selectEmojiAC(emojiAC.index); return; }
                  if (e.key === "Escape") { e.preventDefault(); setEmojiAC({ open: false, results: [], index: 0 }); return; }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onTyping && onTyping(false);
                  clearTimeout(typingTimeoutRef.current);
                  handleSend();
                }
              }}
              placeholder={contactName ? `Message ${contactName}…` : "Send a message…"}
              rows={1}
              style={{
                width: "100%", background: "transparent",
                border: "none", outline: "none", resize: "none",
                color: "var(--rv-text)", fontSize: 14, lineHeight: 1.55,
                fontFamily: "inherit", padding: 0, maxHeight: 180,
              }}
            />
            {pendingFiles.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {pendingFiles.map((f, i) => (
                  <div key={i} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "4px 8px 4px 10px", borderRadius: 999,
                    background: "var(--rv-pill-bg)",
                    border: "1px solid var(--rv-border)",
                    fontSize: 11, fontFamily: "var(--rv-mono)", color: "var(--rv-text-dim)",
                  }}>
                    <span>{f.name}</span>
                    <button onClick={() => removeFile(i)} style={{
                      all: "unset", cursor: "pointer", color: "var(--rv-text-faint)",
                      fontSize: 14, lineHeight: 1,
                    }}>×</button>
                  </div>
                ))}
              </div>
            )}
            {recording ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 10, marginTop: 8,
                padding: "8px 12px", borderRadius: 10,
                background: "oklch(0.60 0.20 25 / 0.12)",
                border: "1px solid oklch(0.60 0.20 25 / 0.40)",
              }}>
                <span style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: "oklch(0.65 0.22 25)", animation: "typingDot 1.2s infinite",
                  boxShadow: "0 0 10px oklch(0.65 0.22 25)",
                }} />
                <span style={{ fontFamily: "var(--rv-mono)", fontSize: 11.5, color: "oklch(0.85 0.17 30)" }}>
                  Recording · {Math.floor(recTime / 60)}:{String(recTime % 60).padStart(2, "0")}
                </span>
                <div style={{ flex: 1 }} />
                <button onClick={() => stopRec(false)} style={{ ...composerBtn, height: 28, color: "var(--rv-text-dim)" }}>Cancel</button>
                <button onClick={() => stopRec(true)} style={{ ...composerBtn, height: 28, background: "var(--rv-accent)", color: "#1a1510", padding: "0 12px" }}>Send</button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8, minWidth: 0 }}>
                <button style={composerBtn} title="Attach file" onClick={() => fileInputRef.current?.click()}><IconAttach size={16} /></button>
                <input ref={fileInputRef} type="file" multiple style={{ display: "none" }}
                  onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }} />
                <button
                  style={{ ...composerBtn, background: formatOpen ? "var(--rv-hover)" : undefined, color: formatOpen ? "var(--rv-accent)" : undefined }}
                  onClick={() => setFormatOpen(v => !v)}
                  title="Formatting"
                >
                  <span style={{ fontFamily: "var(--rv-mono)", fontSize: 10, fontWeight: 700, fontStyle: "italic", letterSpacing: 0.5 }}>B·I</span>
                </button>
                <button
                  style={{ ...composerBtn, background: gifOpen ? "var(--rv-hover)" : undefined, color: gifOpen ? "var(--rv-accent)" : undefined }}
                  onClick={() => { setGifOpen(v => !v); setEmojiOpen(false); }}
                  title="GIF"
                >
                  <span style={{ fontFamily: "var(--rv-mono)", fontSize: 10, fontWeight: 600, letterSpacing: 0.5 }}>GIF</span>
                </button>
                <button
                  style={{ ...composerBtn, background: emojiOpen ? "var(--rv-hover)" : undefined, color: emojiOpen ? "var(--rv-accent)" : undefined }}
                  onClick={() => { setEmojiOpen(v => !v); setGifOpen(false); }}
                  title="Emoji"
                >
                  <IconSmile size={16} />
                </button>
                <PriorityPill active={priority} onToggle={() => setPriority(v => !v)} />
                <div style={{ flex: 1, minWidth: 4 }} />
                <span className="composer-hint" style={{ fontFamily: "var(--rv-mono)", fontSize: 10.5, color: "var(--rv-text-faint)", margin: "0 8px 0 6px", whiteSpace: "nowrap" }}>
                  ⏎ send
                </span>
                {!value.trim() && pendingFiles.length === 0 ? (
                  <button onClick={startRec} style={{ ...composerBtn, width: 32, height: 32 }} title="Record voice message">
                    <IconMic size={16} />
                  </button>
                ) : null}
                <button
                  onClick={handleSend}
                  disabled={sending || (!value.trim() && pendingFiles.length === 0)}
                  style={{
                    all: "unset", cursor: (sending || (!value.trim() && pendingFiles.length === 0)) ? "not-allowed" : "pointer",
                    width: 32, height: 32, borderRadius: 10,
                    background: (value.trim() || pendingFiles.length) ? (priority ? priorityColor : "var(--rv-accent)") : "var(--rv-input-border)",
                    color: (value.trim() || pendingFiles.length) ? "#1a1510" : "var(--rv-text-faint)",
                    display: "grid", placeItems: "center",
                    transition: "transform 100ms, background 120ms",
                    boxShadow: (value.trim() || pendingFiles.length) ? (priority ? "0 0 18px oklch(0.82 0.17 50 / 0.5)" : "0 0 18px var(--rv-accent-glow)") : "none",
                    opacity: sending ? 0.5 : 1,
                  }}
                >
                  <IconSend size={15} />
                </button>
              </div>
            )}
            {formatOpen && !recording && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6, marginTop: 8,
                padding: "6px 8px", borderRadius: 10,
                background: "var(--rv-input-bg)", border: "1px solid var(--rv-border)",
              }}>
                {[
                  { k: "bold", label: "B", style: { fontWeight: 700 } },
                  { k: "italic", label: "I", style: { fontStyle: "italic" } },
                  { k: "underline", label: "U", style: { textDecoration: "underline" } },
                ].map(b => (
                  <button key={b.k} onClick={() => toggleFmt(b.k)} style={{
                    all: "unset", cursor: "pointer",
                    width: 28, height: 28, borderRadius: 6,
                    display: "grid", placeItems: "center",
                    background: formatting[b.k] ? "var(--rv-accent-soft)" : "transparent",
                    color: formatting[b.k] ? "var(--rv-accent)" : "var(--rv-text-dim)",
                    fontFamily: "serif", fontSize: 14, ...b.style,
                  }}>{b.label}</button>
                ))}
                <span style={{ width: 1, height: 18, background: "var(--rv-border)", margin: "0 4px" }} />
                <select
                  value={formatting.font}
                  onChange={(e) => setFormatting(prev => ({ ...prev, font: e.target.value }))}
                  style={{
                    padding: "4px 8px", borderRadius: 6,
                    background: "var(--rv-input-bg)", border: "1px solid var(--rv-border)",
                    color: "var(--rv-text)", fontSize: 11.5, fontFamily: "inherit",
                  }}
                >
                  <option value="default">Default</option>
                  <option value="mono">Mono</option>
                  <option value="serif">Serif</option>
                  <option value="cursive">Cursive</option>
                </select>
              </div>
            )}
          </div>
        </div>
        <div style={{
          fontFamily: "var(--rv-mono)", fontSize: 10.5,
          color: "var(--rv-text-faint)", textAlign: "center",
          marginTop: 10, letterSpacing: 0.3,
        }}>
          End-to-end encrypted · Two-person house channel
        </div>
      </div>
    </div>
  );
}

/* ============ PRIORITY PILL ============ */
function PriorityPill({ active, onToggle }) {
  const priorityColor = "oklch(0.82 0.17 50)";
  return (
    <button
      onClick={onToggle}
      style={{
        all: "unset", cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 6,
        height: 28, padding: "0 11px 0 10px",
        borderRadius: 999,
        background: active ? "oklch(0.55 0.18 50 / 0.18)" : "var(--rv-pill-bg)",
        border: `1px solid ${active ? priorityColor : "var(--rv-border)"}`,
        color: active ? priorityColor : "var(--rv-text-dim)",
        fontSize: 11.5, fontFamily: "var(--rv-mono)",
        letterSpacing: 0.3, whiteSpace: "nowrap",
        transition: "background 140ms, border-color 140ms, color 140ms, box-shadow 140ms",
        boxShadow: active ? `0 0 12px oklch(0.55 0.18 50 / 0.35)` : "none",
        flexShrink: 0,
      }}
      title={active ? "Unmark as priority" : "Mark as priority"}
    >
      <span style={{
        fontSize: 13, lineHeight: 1,
        color: active ? priorityColor : "var(--rv-text-faint)",
        transition: "color 140ms, text-shadow 140ms",
        textShadow: active ? `0 0 6px ${priorityColor}` : "none",
      }}>{active ? "★" : "☆"}</span>
      <span>{active ? "Priority" : "Normal"}</span>
    </button>
  );
}

/* ============ TOPIC PILL (unused — kept for reference) ============ */
function TopicPill({ topic, open, setOpen, onChange }) {
  const topics = [
    { label: "Estate", sub: "W17", desc: "This week's estate matters" },
    { label: "Board", sub: "Q2", desc: "Q2 review prep" },
    { label: "Ashford", sub: "Counsel", desc: "Legal thread — watched" },
    { label: "Harbour House", sub: "May", desc: "Hosting · brunch pending" },
    { label: "Foundation", sub: "trustees", desc: "Grants + dinner" },
    { label: "Personal", sub: "", desc: "Private — off-ledger" },
  ];
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          all: "unset", cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 6,
          height: 28, padding: "0 10px 0 9px",
          borderRadius: 999,
          background: open ? "var(--rv-accent-soft)" : "var(--rv-pill-bg)",
          border: `1px solid ${open ? "var(--rv-accent-line)" : "var(--rv-border)"}`,
          color: open ? "var(--rv-accent)" : "var(--rv-text-dim)",
          fontSize: 11.5, fontFamily: "var(--rv-mono)",
          letterSpacing: 0.3, whiteSpace: "nowrap",
          transition: "background 120ms, border-color 120ms, color 120ms",
        }}
        title="Thread topic"
      >
        <IconPin size={10} />
        <span style={{ color: "var(--rv-text)" }}>{topic.label}</span>
        {topic.sub && (
          <>
            <span style={{ opacity: 0.5 }}>·</span>
            <span style={{ color: "var(--rv-accent)" }}>{topic.sub}</span>
          </>
        )}
        <span style={{ opacity: 0.5, fontSize: 8, marginLeft: 2 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            width: 280,
            zIndex: 60,
            background: "oklch(0.13 0.01 60 / 0.97)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--rv-border)",
            borderRadius: 12,
            boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
            overflow: "hidden",
          }}>
            <div style={{
              padding: "10px 14px 6px",
              fontFamily: "var(--rv-mono)", fontSize: 9.5,
              color: "var(--rv-text-faint)", letterSpacing: 1.2,
              textTransform: "uppercase",
            }}>Tag this message</div>
            {topics.map((t, i) => {
              const isCurrent = t.label === topic.label;
              return (
                <button
                  key={i}
                  onClick={() => { onChange({ label: t.label, sub: t.sub }); setOpen(false); }}
                  style={{
                    all: "unset", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 10,
                    width: "100%", boxSizing: "border-box",
                    padding: "10px 14px",
                    borderTop: i === 0 ? "none" : "1px solid var(--rv-border)",
                    background: isCurrent ? "var(--rv-accent-soft)" : "transparent",
                  }}
                  onMouseOver={(e) => { if (!isCurrent) e.currentTarget.style.background = "var(--rv-hover)"; }}
                  onMouseOut={(e) => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}
                >
                  <IconPin size={11} style={{ color: isCurrent ? "var(--rv-accent)" : "var(--rv-text-faint)" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12.5, color: "var(--rv-text)",
                      fontFamily: "var(--rv-mono)", letterSpacing: 0.3,
                    }}>
                      {t.label}{t.sub && <span style={{ color: "var(--rv-accent)", marginLeft: 6 }}>· {t.sub}</span>}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--rv-text-faint)", marginTop: 2 }}>{t.desc}</div>
                  </div>
                  {isCurrent && <IconCheck size={12} style={{ color: "var(--rv-accent)" }} />}
                </button>
              );
            })}
            <div style={{
              padding: "8px 14px",
              borderTop: "1px solid var(--rv-border)",
              fontFamily: "var(--rv-mono)", fontSize: 9.5,
              color: "var(--rv-text-faint)", letterSpacing: 0.4,
            }}>Files to the Thread Vault under this topic</div>
          </div>
        </>
      )}
    </div>
  );
}

/* ============ EMOJI PICKER ============ */
function EmojiPicker({ onPick, onClose }) {
  const [q, setQ] = React.useState("");
  const groups = [
    { name: "Frequent", emojis: ["👍", "✅", "❤️", "🎯", "🙏", "👀", "🔥", "💯"] },
    { name: "Smileys", emojis: ["😀", "😃", "😄", "😁", "😅", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😍", "🥰", "😘", "😎", "🤓"] },
    { name: "Hands", emojis: ["👍", "👎", "👌", "✌️", "🤞", "🤝", "🙏", "👏", "🤲", "💪", "🫡", "👋"] },
    { name: "Objects", emojis: ["📎", "📄", "📅", "⏰", "📌", "🔑", "💼", "📊", "📈", "📉", "💰", "🏛️"] },
    { name: "Symbols", emojis: ["✅", "❌", "⭐", "🎯", "🔔", "💡", "⚠️", "🔒", "🔓", "♥️", "💯", "❤️"] },
  ];
  const filtered = q
    ? [{ name: "Results", emojis: groups.flatMap(g => g.emojis).filter((_, i) => true).slice(0, 40) }]
    : groups;

  return (
    <div style={pickerShell}>
      <div style={pickerHeader}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "0 12px", height: 34,
          background: "var(--rv-input-bg)",
          border: "1px solid var(--rv-input-border)",
          borderRadius: 10,
        }}>
          <IconSearch size={13} />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search emoji…"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--rv-text)", fontSize: 13 }}
            autoFocus
          />
        </div>
        <button onClick={onClose} style={pickerClose}>×</button>
      </div>
      <div className="rv-scroll" style={{ padding: "8px 12px 12px", overflowY: "auto", flex: 1 }}>
        {filtered.map((g) => (
          <div key={g.name} style={{ marginBottom: 10 }}>
            <div style={{
              fontFamily: "var(--rv-mono)", fontSize: 9.5,
              letterSpacing: 1.2, textTransform: "uppercase",
              color: "var(--rv-text-faint)", padding: "6px 2px",
            }}>{g.name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
              {g.emojis.map((e, i) => (
                <button
                  key={i}
                  onClick={() => onPick(e)}
                  style={{
                    all: "unset", cursor: "pointer",
                    aspectRatio: "1/1",
                    display: "grid", placeItems: "center",
                    fontSize: 18, borderRadius: 6,
                    fontFamily: "system-ui, 'Apple Color Emoji', 'Segoe UI Emoji'",
                    transition: "background 120ms, transform 80ms",
                  }}
                  onMouseOver={(ev) => (ev.currentTarget.style.background = "var(--rv-hover)")}
                  onMouseOut={(ev) => (ev.currentTarget.style.background = "transparent")}
                >{e}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={pickerFooter}>
        <span style={{ fontFamily: "var(--rv-mono)", fontSize: 10, color: "var(--rv-text-faint)", letterSpacing: 0.4 }}>
          EMOJI · click to insert
        </span>
      </div>
    </div>
  );
}

/* ============ GIF PICKER — same tabs + Giphy backend as the Original ============ */
// Matches Trending / Reactions / Scandal / Memes / Gaming from the classic /app
// (Favorites omitted for now — no dedicated endpoint exposed yet.)
const GIF_TABS = [
  { id: "trending",  label: "🔥 Trending",  type: "trending" },
  { id: "reactions", label: "😂 Reactions", type: "search", query: "reaction" },
  { id: "scandal",   label: "🌹 Scandal",   type: "search", query: ["scandal olivia pope", "eli pope scandal", "scandal abc", "scandal tv show"] },
  { id: "memes",     label: "😴 Memes",     type: "search", query: "meme" },
  { id: "gaming",    label: "🎮 Gaming",    type: "search", query: "gaming" },
];

function GifPicker({ onPick, onClose }) {
  const [q, setQ] = React.useState("");
  const [tab, setTab] = React.useState("trending");
  const [gifs, setGifs] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [visible, setVisible] = React.useState(18);   // how many of `gifs` to render (lazy reveal)
  const scrollRef = React.useRef(null);
  const PAGE = 18;

  // Fetch trending / category / search depending on state
  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const run = async () => {
      setLoading(true); setErr(null);
      try {
        const query = q.trim();
        // Request a large pool so we have plenty to progressively reveal as the user scrolls.
        const POOL = 60;
        let results = [];
        if (query) {
          const data = await fetch(`/api/gif-search?q=${encodeURIComponent(query)}&limit=${POOL}`, { credentials: "same-origin", signal: controller.signal }).then(r => r.json());
          results = data.results || [];
        } else {
          const t = GIF_TABS.find(x => x.id === tab) || GIF_TABS[0];
          if (t.type === "trending") {
            const data = await fetch(`/api/gif-trending?limit=${POOL}`, { credentials: "same-origin", signal: controller.signal }).then(r => r.json());
            results = data.results || [];
          } else if (Array.isArray(t.query)) {
            const per = Math.ceil(POOL / t.query.length);
            const all = await Promise.all(t.query.map(qq =>
              fetch(`/api/gif-search?q=${encodeURIComponent(qq)}&limit=${per}`, { credentials: "same-origin", signal: controller.signal })
                .then(r => r.json())
                .then(d => d.results || [])
            ));
            const seen = new Set();
            all.flat().forEach(g => { if (!seen.has(g.id)) { seen.add(g.id); results.push(g); } });
          } else {
            const data = await fetch(`/api/gif-search?q=${encodeURIComponent(t.query)}&limit=${POOL}`, { credentials: "same-origin", signal: controller.signal }).then(r => r.json());
            results = data.results || [];
          }
        }
        if (!cancelled) {
          setGifs(results);
          setVisible(PAGE);
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        }
      } catch (e) {
        if (!cancelled && e.name !== "AbortError") setErr("Couldn't load GIFs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const t = setTimeout(run, q.trim() ? 280 : 0);
    return () => { cancelled = true; controller.abort(); clearTimeout(t); };
  }, [q, tab]);

  // Infinite-scroll: reveal more items as the user nears the bottom.
  const onScroll = React.useCallback((e) => {
    const el = e.currentTarget;
    if (loading || loadingMore) return;
    if (visible >= gifs.length) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 200;
    if (nearBottom) {
      setLoadingMore(true);
      // Small delay so loading state is visible and we don't thrash on fast scrolls.
      setTimeout(() => {
        setVisible(v => Math.min(gifs.length, v + PAGE));
        setLoadingMore(false);
      }, 120);
    }
  }, [gifs.length, visible, loading, loadingMore]);

  const shown = gifs.slice(0, visible);

  return (
    <div style={{ ...pickerShell, width: 360, height: 460 }}>
      <div style={pickerHeader}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "0 12px", height: 34, flex: 1,
          background: "var(--rv-input-bg)",
          border: "1px solid var(--rv-input-border)",
          borderRadius: 10,
        }}>
          <IconSearch size={13} />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search GIFs…"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--rv-text)", fontSize: 13, fontFamily: "inherit" }}
            autoFocus
          />
        </div>
        <button onClick={onClose} style={pickerClose}>×</button>
      </div>

      {/* Category tabs — hidden while typing a search */}
      {!q.trim() && (
        <div style={{ display: "flex", gap: 6, padding: "4px 12px 6px", overflowX: "auto", scrollbarWidth: "none", flexShrink: 0 }}>
          {GIF_TABS.map(t => {
            const active = t.id === tab;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                all: "unset", cursor: "pointer",
                padding: "5px 11px", borderRadius: 999,
                fontSize: 11.5, fontFamily: "inherit",
                background: active ? "var(--rv-accent-soft)" : "var(--rv-pill-bg)",
                color: active ? "var(--rv-accent)" : "var(--rv-text-dim)",
                border: active ? "1px solid var(--rv-accent-line)" : "1px solid var(--rv-border)",
                whiteSpace: "nowrap", flexShrink: 0,
                letterSpacing: 0.2,
              }}>{t.label}</button>
            );
          })}
        </div>
      )}

      {/* Grid: 2 columns that flow top-to-bottom (not CSS multi-column which
          creates left-to-right paging under fixed-height containers). */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="rv-scroll"
        style={{
          flex: 1, overflowY: "auto", overflowX: "hidden",
          padding: "8px 12px 12px",
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gridAutoRows: "min-content",
          gap: 6,
          alignContent: "start",
        }}
      >
        {loading && gifs.length === 0 && (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px 0", color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", fontSize: 11 }}>Loading…</div>
        )}
        {err && !loading && (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px 0", color: "oklch(0.75 0.18 30)", fontSize: 12 }}>{err}</div>
        )}
        {!loading && !err && gifs.length === 0 && (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px 0", color: "var(--rv-text-faint)", fontSize: 12 }}>No GIFs found.</div>
        )}
        {shown.map((g) => (
          <button
            key={g.id}
            onClick={() => onPick(g)}
            style={{
              all: "unset", cursor: "pointer",
              display: "block", width: "100%",
              borderRadius: 8,
              overflow: "hidden", position: "relative",
              border: "1px solid var(--rv-border)",
              background: "var(--rv-input-bg)",
              transition: "transform 120ms, border-color 120ms",
            }}
            onMouseOver={(ev) => { ev.currentTarget.style.borderColor = "var(--rv-accent)"; }}
            onMouseOut={(ev) => { ev.currentTarget.style.borderColor = "var(--rv-border)"; }}
          >
            <img
              src={g.preview || g.url}
              alt=""
              style={{ width: "100%", display: "block" }}
              loading="lazy"
              decoding="async"
            />
          </button>
        ))}
        {!loading && visible < gifs.length && (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "10px 0", color: "var(--rv-text-faint)", fontFamily: "var(--rv-mono)", fontSize: 10.5 }}>
            {loadingMore ? "Loading more…" : "Scroll for more"}
          </div>
        )}
      </div>
      <div style={pickerFooter}>
        <span style={{ fontFamily: "var(--rv-mono)", fontSize: 10, color: "var(--rv-text-faint)", letterSpacing: 0.4 }}>
          POWERED BY · GIPHY
        </span>
      </div>
    </div>
  );
}

const pickerShell = {
  position: "absolute",
  bottom: "calc(100% + 8px)",
  right: 0,
  width: 340,
  height: 380,
  background: "oklch(0.13 0.01 60 / 0.95)",
  backdropFilter: "blur(20px)",
  border: "1px solid var(--rv-border)",
  borderRadius: 16,
  boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
  display: "flex",
  flexDirection: "column",
  zIndex: 50,
  overflow: "hidden",
};

const pickerHeader = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 10px 6px",
};

const pickerClose = {
  all: "unset",
  cursor: "pointer",
  width: 30, height: 30,
  borderRadius: 8,
  display: "grid", placeItems: "center",
  color: "var(--rv-text-faint)",
  fontSize: 18,
};

const pickerFooter = {
  padding: "7px 14px",
  borderTop: "1px solid var(--rv-border)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const composerBtn = {
  all: "unset",
  cursor: "pointer",
  height: 30,
  minWidth: 30,
  padding: "0 7px",
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  color: "var(--rv-text-dim)",
  flexShrink: 0,
  transition: "background 120ms, color 120ms",
};

Object.assign(window, { Composer, PriorityPill });
