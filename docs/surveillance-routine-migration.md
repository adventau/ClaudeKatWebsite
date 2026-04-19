# Surveillance Routine Migration

**Date:** 2026-04-19  
**Author:** Claude (Kiara Melina)  
**Scope:** Queue-based surveillance flow only (`surveillance_results` table). Oracle tool path (`oracle_run_surveillance`, `k108_surveillance_jobs`, `k108_surveillance_results`) is untouched.

---

## What Changed

The in-process Claude API runner (`runInternalSurveillance`) has been replaced with a lightweight Routine webhook trigger (`fireRoutineSurveillance`). The server now fires a single `POST` to the Routine's hook URL and returns immediately. The Routine does the work (Claude + web_search) and posts the completed report back via the existing `POST /api/archivist/results` endpoint — the same path the legacy Cowork runner uses.

### Files modified

| File | Change |
|------|--------|
| `server.js` | Removed `runInternalSurveillance`, `surveillanceBuildSubjectBrief`, `surveillanceSystemPrompt`, `surveillanceUserPrompt`, `surveillanceExtractReport`. Added `fireRoutineSurveillance` and `surveillanceMarkFailed`. Updated call site in `POST /k108/profiles/:id/surveillance/queue`. |
| `db.js` | Added `ALTER TABLE surveillance_queue ADD COLUMN IF NOT EXISTS error TEXT` migration. |

### What was removed

- `runInternalSurveillance()` — direct Anthropic API call (Claude Sonnet + web_search)
- `surveillanceBuildSubjectBrief()` — prompt-builder for the old flow
- `surveillanceSystemPrompt()` — analyst system prompt (now lives in the Routine)
- `surveillanceUserPrompt()` — user-turn prompt (now lives in the Routine)
- `surveillanceExtractReport()` — Claude response parser (no longer needed server-side)

`surveillanceDetermineScope()` and `SURVEILLANCE_DEFAULT_SCOPE` are kept — the scope is computed server-side and sent to the Routine in the payload.

### What was added / changed

- `fireRoutineSurveillance(queueId, profileId, fullName, requestedBy)` — POSTs payload to `ROUTINE_SURVEILLANCE_URL`
- `surveillanceMarkFailed(queueId, profileId, errorMsg)` — sets `status='failed'` + `error=<message>` on the queue row and emits `k108:surveillance_failed` via Socket.IO
- `surveillance_queue.error TEXT` column — stores the failure reason when the Routine trigger fails

---

## New Env Vars

Add both to Railway > Service > Variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `ROUTINE_SURVEILLANCE_URL` | Routine API hook URL. Found in the Routine's Settings → Trigger. | `https://hooks.routines.dev/r/surveillance-abc123` |
| `ROUTINE_SURVEILLANCE_TOKEN` | Bearer token for the Routine (the `rt_live_xxx` key shown at creation). | `rt_live_xxxxxxxxxxxxxxxx` |

**Existing vars that must remain set:**

| Variable | Used by |
|----------|---------|
| `BRIEFING_SECRET` | Authenticates the Routine's callback to `/api/archivist/results` |
| `BRRR_WEBHOOK_KALIPH` / `BRRR_WEBHOOK_KATHRINE` | Push notifications fired inside `/api/archivist/results` |

`ANTHROPIC_API_KEY` is no longer needed for the surveillance flow. It may still be required by Oracle and other features — do not remove it unless you've audited those usages.

---

## Payload Shape

The server POSTs this JSON body to `ROUTINE_SURVEILLANCE_URL`:

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

The `Authorization` header is `Bearer <ROUTINE_SURVEILLANCE_TOKEN>`.

---

## What the Routine Needs to Do

The Routine should be configured in the Anthropic Routines dashboard as follows:

### Trigger
HTTP POST — use the generated hook URL as `ROUTINE_SURVEILLANCE_URL`.

### Model
Claude Sonnet (latest). Enable the `web_search` tool.

### System prompt
Act as ORACLE, a senior K-108 intelligence analyst. Geographic scope is provided in the input payload under `scope`. Use the same report format as previously — plain text, section headers, `[CONFIRMED]` / `[PROBABLE]` / `[UNVERIFIED]` confidence tags, source citations. See the previous `surveillanceSystemPrompt()` function body in git history for the exact prompt text to use.

### Input mapping
The Routine receives the full payload above. Use `profile`, `relations`, and `scope` to build the subject brief and search scope. Run 4–6 `web_search` calls with different query angles pinned to `scope.focus` and `scope.region`.

### Output / callback
When the report is complete, POST to `submitUrl` with:

```
Header: x-briefing-secret: <briefingSecret from payload>
Content-Type: application/json

{
  "id": <queueId from payload>,
  "name": <name from payload>,
  "requested_by": <requestedBy from payload>,
  "report": "<plain-text K-108 report string>"
}
```

This hits `POST /api/archivist/results` on the server, which handles the rest: inserts into `surveillance_results`, links to case timeline if applicable, sends push notification, and emits `k108:surveillance_complete` via Socket.IO.

---

## Error Handling

If `ROUTINE_SURVEILLANCE_URL` or `ROUTINE_SURVEILLANCE_TOKEN` is missing, or if the POST to the Routine returns a non-2xx status:

1. `surveillance_queue` row is updated: `status='failed'`, `error='<reason>'`
2. Socket.IO emits `k108:surveillance_failed` → `{ profileId, queueId, error }`
3. Server logs the error with `[surveillance]` prefix

The frontend should listen for `k108:surveillance_failed` and surface a visible error on the profile's surveillance button (e.g., "Surveillance failed — contact ORACLE ops"). The button should allow re-queuing.

---

## Data Flow (updated)

```
User clicks "Run Surveillance"
  ↓
POST /k108/profiles/:id/surveillance/queue  (K-108 auth)
  ↓
INSERT surveillance_queue (status='pending')
  ↓
Response {success:true} → button → "Surveillance Pending"
  ↓ [fire-and-forget]
fireRoutineSurveillance()
  ├─ Check ROUTINE_SURVEILLANCE_URL + ROUTINE_SURVEILLANCE_TOKEN
  ├─ Verify queue row still pending
  ├─ Load k108_profiles + k108_profile_relations
  ├─ Determine scope
  └─ POST to Routine URL  →  HTTP 2xx = accepted
         (server returns immediately; Routine works async)

[...later, when Routine finishes...]

POST /api/archivist/results  (x-briefing-secret auth)
  ├─ INSERT surveillance_results
  ├─ DELETE surveillance_queue row
  ├─ INSERT k108_case_timeline (if profile linked to open case)
  ├─ POST Brrr push notification
  └─ io.emit('k108:surveillance_complete', { profileId, name })
         ↓
Frontend updates — report card rendered in profile view
```
