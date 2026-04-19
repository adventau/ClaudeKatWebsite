// Simple stroked icons, 20px default. Use currentColor so sidebar theming works.
const Icon = ({ d, size = 18, fill = "none", strokeWidth = 1.6, children, viewBox = "0 0 24 24" }) => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox}
    fill={fill}
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    {d ? <path d={d} /> : children}
  </svg>
);

const IconChat = (p) => <Icon {...p}><path d="M4 5h16v11H9l-5 4V5z" /></Icon>;
const IconBriefing = (p) => <Icon {...p}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></Icon>;
const IconNotes = (p) => <Icon {...p}><path d="M5 3h11l3 3v15H5z" /><path d="M9 9h7M9 13h7M9 17h4" /></Icon>;
const IconCalendar = (p) => <Icon {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Icon>;
const IconLocker = (p) => <Icon {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 4v16M8 9h0.01M8 14h0.01" /></Icon>;
const IconContacts = (p) => <Icon {...p}><circle cx="12" cy="9" r="3.5" /><path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5" /></Icon>;
const IconGuest = (p) => <Icon {...p}><path d="M21 12a8 8 0 1 1-3-6.2L21 4v5h-5" /></Icon>;
const IconReminder = (p) => <Icon {...p}><path d="M6 8a6 6 0 0 1 12 0v5l2 3H4l2-3z" /><path d="M10 19a2 2 0 0 0 4 0" /></Icon>;
const IconMoney = (p) => <Icon {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 10v4M18 10v4" /></Icon>;
const IconAuth = (p) => <Icon {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></Icon>;
const IconIntel = (p) => <Icon {...p}><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.3-4.3" /></Icon>;
const IconSettings = (p) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></Icon>;

const IconPlus = (p) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
const IconSearch = (p) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.3-4.3" /></Icon>;
const IconPanel = (p) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></Icon>;
const IconAttach = (p) => <Icon {...p}><path d="M21 10.5l-8.8 8.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 17a2 2 0 0 1-2.9-2.9L15 6.9" /></Icon>;
const IconMic = (p) => <Icon {...p}><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Icon>;
const IconSend = (p) => <Icon {...p}><path d="M12 19V5M5 12l7-7 7 7" /></Icon>;
const IconMore = (p) => <Icon {...p}><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></Icon>;
const IconShare = (p) => <Icon {...p}><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" /></Icon>;
const IconCheck = (p) => <Icon {...p}><path d="M5 12l4 4 10-10" /></Icon>;
const IconStar = (p) => <Icon {...p}><path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z" /></Icon>;
const IconPin = (p) => <Icon {...p}><path d="M12 2l3 6 5 1-4 4 1 6-5-3-5 3 1-6-4-4 5-1z" /></Icon>;
const IconBolt = (p) => <Icon {...p}><path d="M13 2L4 14h6l-1 8 9-12h-6z" /></Icon>;
const IconChev = (p) => <Icon {...p}><path d="M9 6l6 6-6 6" /></Icon>;
const IconEdit = (p) => <Icon {...p}><path d="M4 20h4l10-10-4-4L4 16z" /></Icon>;
const IconDoc = (p) => <Icon {...p}><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /></Icon>;
const IconRefresh = (p) => <Icon {...p}><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" /></Icon>;
const IconPlay = (p) => <Icon {...p}><path d="M7 4l12 8-12 8z" fill="currentColor" stroke="none" /></Icon>;
const IconPhone = (p) => <Icon {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.52 19.52 0 0 1-6-6 19.86 19.86 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.89.7 2.78a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.3-1.27a2 2 0 0 1 2.11-.45c.89.33 1.82.57 2.78.7A2 2 0 0 1 22 16.92z" /></Icon>;
const IconVideo = (p) => <Icon {...p}><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M22 8l-6 4 6 4V8z" /></Icon>;
const IconX = (p) => <Icon {...p}><path d="M18 6L6 18M6 6l12 12" /></Icon>;

Object.assign(window, {
  Icon, IconChat, IconBriefing, IconNotes, IconCalendar, IconLocker,
  IconContacts, IconGuest, IconReminder, IconMoney, IconAuth, IconIntel,
  IconSettings, IconPlus, IconSearch, IconPanel, IconAttach, IconMic,
  IconSend, IconMore, IconShare, IconCheck, IconStar, IconPin, IconBolt,
  IconChev, IconEdit, IconDoc, IconRefresh, IconPlay, IconPhone, IconVideo, IconX,
});
