# Family Background Research — Routine Integration

**Date:** 2026-04-19  
**Author:** Claude (Kiara Melina)  
**Scope:** Queue-based family background research flow only (`surveillance_results` table). Oracle tool path (`oracle_run_surveillance`, `k108_surveillance_jobs`, `k108_surveillance_results`) is untouched.

---

## What Changed

The in-process Claude API runner (`runInternalSurveillance`) has been replaced with a lightweight Routine trigger (`fireRoutineFamilyResearch`). The Family Archive server fires a single `POST` to the Anthropic Routine fire endpoint and returns immediately. The Routine does the work (Claude + web_search) and posts the completed report back via the existing `POST /api/archivist/results` endpoint — the same path the legacy Cowork runner uses.

### Files modified

| File | Change |
|------|--------|
| `server.js` | Removed `runInternalSurveillance`, `surveillanceBuildSubjectBrief`, `surveillanceSystemPrompt`, `surveillanceUserPrompt`, `surveillanceExtractReport`. Added `fireRoutineFamilyResearch` and `familyResearchMarkFailed`. Updated call site in `POST /k108/profiles/:id/surveillance/queue`. |
| `db.js` | Added `ALTER TABLE surveillance_queue ADD COLUMN IF NOT EXISTS error TEXT` migration. |

### What was removed

- `runInternalSurveillance()` — direct Anthropic API call (Claude Sonnet + web_search)
- `surveillanceBuildSubjectBrief()` — prompt-builder for the old flow
- `surveillanceSystemPrompt()` — analyst system prompt (now lives in the Routine)
- `surveillanceUserPrompt()` — user-turn prompt (now lives in the Routine)
- `surveillanceExtractReport()` — Claude response parser (no longer needed server-side)

`familyResearchDetermineScope()` and `FAMILY_RESEARCH_DEFAULT_SCOPE` are kept — scope is computed server-side and sent to the Routine in the payload.

### What was added / changed

- `fireRoutineFamilyResearch(queueId, profileId, fullName, requestedBy)` — POSTs the research payload to the Anthropic Routine fire URL
- `familyResearchMarkFailed(queueId, profileId, errorMsg)` — sets `status='failed'` + `error=<message>` on the queue row and emits `k108:surveillance_failed` via Socket.IO
- `surveillance_queue.error TEXT` column — stores the failure reason when the Routine trigger fails

---

## New Env Vars

Add both to Railway > Service > Variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `ROUTINE_SURVEILLANCE_ID` | The Routine's ID only — **not** the full URL. Found in the Routine's Settings page. The Family Archive server constructs the full fire URL as `https://api.anthropic.com/v1/claude_code/routines/<ID>/fire`. | `trig_01DU2wEKxxGjRH2GxurhYCHb` |
| `ROUTINE_SURVEILLANCE_TOKEN` | Anthropic bearer token used to authenticate the fire request. | `sk-ant-...` or `rt_live_xxx` |

**Existing vars that must remain set:**

| Variable | Used by |
|----------|---------|
| `BRIEFING_SECRET` | Authenticates the Routine's callback to `/api/archivist/results` |
| `BRRR_WEBHOOK_KALIPH` / `BRRR_WEBHOOK_KATHRINE` | Push notifications fired inside `/api/archivist/results` |

`ANTHROPIC_API_KEY` is no longer needed for the family background research flow. It may still be required by Oracle and other features — do not remove it unless you've audited those usages.

---

## Routine Fire Request

### URL

```
POST https://api.anthropic.com/v1/claude_code/routines/{ROUTINE_SURVEILLANCE_ID}/fire
```

### Required Headers

```
Authorization: Bearer <ROUTINE_SURVEILLANCE_TOKEN>
anthropic-version: 2023-06-01
anthropic-beta: experimental-cc-routine-2026-04-01
Content-Type: application/json
```

### Body Shape

The Routine API accepts a **single `text` field**. The entire payload is serialized into a natural-language message string and sent inside it:

```json
{
  "text": "New family background research request.\n\nParse the JSON block below and execute your instructions.\n\nPAYLOAD:\n{ ... }"
}
```

The embedded JSON block (pretty-printed via `JSON.stringify(payload, null, 2)`) contains:

```json
{
  "queueId": 123,
  "profileId": 456,
  "name": "Marcus Thane",
  "requestedBy": "kaliph",
  "profile": {
    "id": 456,
    "first_name": "Marcus",
    "middle_name": null,
    "last_name": "Thane",
    "aliases": [],
    "age": 34,
    "birthday": "1991-03-15",
    "address": { "street": "123 Oak St", "city": "Gurnee", "state": "IL", "zip": "60031" },
    "phones": [{ "number": "847-555-0100", "label": "mobile" }],
    "emails": [{ "address": "m.thane@example.com" }],
    "social_links": [{ "platform": "LinkedIn", "url": "linkedin.com/in/marcusthane" }],
    "employer_info": { "company": "Northbrook Consulting", "title": "Senior Analyst", "industry": "Finance" },
    "notes": "..."
  },
  "relations": [
    { "label": "associate", "first_name": "Dana", "last_name": "Osei" }
  ],
  "scope": {
    "focus": "Gurnee, Illinois",
    "region": "Cook/Lake County, Illinois",
    "deviation": false,
    "detail": "Default K-108 operational area — Gurnee, Waukegan, Zion...",
    "counties": ["Lake County, IL", "Cook County, IL"],
    "state": "IL"
  },
  "submitUrl": "https://royalkvault.up.railway.app/api/archivist/results",
  "briefingSecret": "<value of BRIEFING_SECRET>"
}
```

### Successful Response

A successful fire returns HTTP 200 with:

```json
{
  "type": "routine_fire",
  "claude_code_session_id": "sess_...",
  "claude_code_session_url": "https://claude.ai/claude-code/sessions/sess_..."
}
```

The Family Archive server logs `claude_code_session_url` so you can click through to watch the run in progress:

```
[family-research] Routine accepted queueId=123 (HTTP 200) session=https://claude.ai/claude-code/sessions/sess_...
```

---

## What the Routine Needs to Do

Configure the Routine in the Anthropic dashboard as follows:

### Trigger
HTTP trigger — copy the Routine ID into `ROUTINE_SURVEILLANCE_ID`. The Family Archive server constructs and fires to the full URL automatically.

### Model
Claude Sonnet (latest). Enable the `web_search` tool.

### System prompt
Act as ORACLE, a senior K-108 intelligence analyst conducting family background research. Geographic scope is provided in the input payload under `scope`. Use plain-text report format — section headers with dashes, `[CONFIRMED]` / `[PROBABLE]` / `[UNVERIFIED]` confidence tags, source citations in parentheses. No markdown (`**`, `#`, backticks forbidden). Max 200 characters per finding line. See git history for the previous `surveillanceSystemPrompt()` function for the exact prompt text.

### Input mapping
Parse the `PAYLOAD` JSON block from the incoming `text` field. Use `profile`, `relations`, and `scope` to build the subject brief and geographic anchor. Run 4–6 `web_search` calls with different query angles pinned to `scope.focus` and `scope.region`.

### Output / callback
When the report is complete, POST to `submitUrl` from the payload:

```
POST <submitUrl>
x-briefing-secret: <briefingSecret from payload>
Content-Type: application/json

{
  "id": <queueId>,
  "name": <name>,
  "requested_by": <requestedBy>,
  "report": "<plain-text K-108 report string>"
}
```

This hits `POST /api/archivist/results` on the Family Archive server, which: inserts into `surveillance_results`, deletes the queue row, links to case timeline if applicable, sends Brrr push notification, and emits `k108:surveillance_complete` via Socket.IO.

---

## Error Handling

If `ROUTINE_SURVEILLANCE_ID` or `ROUTINE_SURVEILLANCE_TOKEN` is missing, or if the POST to the Routine returns a non-2xx status:

1. `surveillance_queue` row is updated: `status='failed'`, `error='<reason>'`
2. Socket.IO emits `k108:surveillance_failed` → `{ profileId, queueId, error }`
3. Family Archive server logs the error with `[family-research]` prefix

The frontend should listen for `k108:surveillance_failed` and surface a visible error on the profile's research button (e.g., "Research failed — contact ORACLE ops"). The button should allow re-queuing.

---

## Data Flow

```
User clicks "Run Surveillance" (profile action bar)
  ↓
POST /k108/profiles/:id/surveillance/queue  (K-108 auth)
  ↓
INSERT surveillance_queue (status='pending')
  ↓
Response {success:true} → button → "Surveillance Pending"
  ↓ [fire-and-forget]
fireRoutineFamilyResearch()
  ├─ Check ROUTINE_SURVEILLANCE_ID + ROUTINE_SURVEILLANCE_TOKEN
  ├─ Verify queue row still pending
  ├─ Load k108_profiles + k108_profile_relations
  ├─ Determine scope via familyResearchDetermineScope()
  ├─ Build message string with embedded JSON payload
  └─ POST https://api.anthropic.com/v1/claude_code/routines/<ID>/fire
       Headers: Authorization, anthropic-version, anthropic-beta
       Body: { "text": "New family background research request.\n\n..." }
       →  HTTP 200 = accepted; log claude_code_session_url
       →  non-2xx = mark failed, emit k108:surveillance_failed

[...later, when Routine finishes its research sweep...]

POST /api/archivist/results  (x-briefing-secret auth)
  ├─ INSERT surveillance_results
  ├─ DELETE surveillance_queue row
  ├─ INSERT k108_case_timeline (if profile linked to open case)
  ├─ POST Brrr push notification
  └─ io.emit('k108:surveillance_complete', { profileId, name })
         ↓
Frontend Socket.IO listener fires → profile re-fetched → report card rendered
```
