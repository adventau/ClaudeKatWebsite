// ── brrr push notifications (webhook-based iOS push via https://brrr.now) ──

const BRRR_WEBHOOKS = {
  kaliph:   process.env.BRRR_WEBHOOK_KALIPH,
  kathrine: process.env.BRRR_WEBHOOK_KATHRINE,
};

/**
 * Send a push notification to the recipient via brrr webhook.
 * Failures are logged but never thrown — notifications are a side effect.
 */
async function sendMessageNotification(senderUsername, recipientUsername, messagePreview) {
  const secret = BRRR_WEBHOOKS[recipientUsername];
  if (!secret) return; // no webhook configured — bail silently

  const senderName = senderUsername.charAt(0).toUpperCase() + senderUsername.slice(1);
  const preview = messagePreview
    ? (messagePreview.length > 100 ? messagePreview.substring(0, 100) + '\u2026' : messagePreview)
    : 'New message';

  try {
    const res = await fetch(`https://api.brrr.now/v1/${secret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${senderName} \u{1F48C}`,
        message: preview,
        sound: 'bubble_ding',
        'interruption-level': 'active',
      }),
    });
    if (!res.ok) {
      console.error(`[brrr] notification failed for ${recipientUsername}: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`[brrr] notification error for ${recipientUsername}:`, err.message);
  }
}

module.exports = { sendMessageNotification };
