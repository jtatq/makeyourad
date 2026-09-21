# MakeYourAd

Self-serve storefront: a local business buys an ad, pays once, and gets files by email within 24 hours.

v1 is a storefront plus an operator queue. Operators generate the ad from the packet (SuperGrok Imagine stills + motion), then QC and deliver.

## Stack

TanStack Start, TypeScript, Tailwind, Postgres (Neon in production, embedded PGLite in preview). Stripe Checkout when keys are present. Resend for mail when a key is present.

## Env vars (server-only — do not prefix with `VITE_`)

| Var | Required | Purpose |
| --- | --- | --- |
| `OPERATOR_TOKEN` | production | Bearer token for `/api/operator/*` and the admin queue password. Preview falls back to `makeyourad-operator`. |
| `IMAGINE_WORKER_TOKEN` | optional | SuperGrok Imagine worker. Defaults to `mya-imagine-supergrok` so this account can fulfill Generate jobs. |
| `OPERATOR_EMAIL` | recommended | Inbox for paid-order notices and the daily SLA digest. |
| `STRIPE_SECRET_KEY` | production | Enables Stripe Checkout. Without it, preview uses a demo pay step that still creates a `paid` order server-side. |
| `STRIPE_WEBHOOK_SECRET` | production | Verifies `checkout.session.completed`. The webhook is the source of truth for paid orders. |
| `RESEND_API_KEY` | production | Sends confirmation, delivery, and operator mail. Without it, mail is logged in the admin outbox. |
| `FROM_EMAIL` | optional | Resend from-address. |
| `ADMIN_PASSWORD` | optional | Alternate admin password if you do not want to type the operator token. |
| `XAI_API_KEY` | production | xAI REST. Generate uses **grok-imagine-image-2.0** (2K) and **grok-imagine-video-1.5** (1080p) on the droplet. SuperGrok Imagine is fallback only if this is unset. |
| `GENERATION_ENGINE` | optional | `xai` when a key is present (default). Set `imagine` to force the SuperGrok worker queue. |
| `AUTO_GENERATE` | optional | Droplet (non-Vercel) defaults **on** when `XAI_API_KEY` is set. Set `0` to disable the background tick. On Vercel, set `1` to opt in (usually leave off). |
| `DATABASE_URL` | production | Injected on deploy. Do not set in preview. |

Never put secrets in client code.

## Operator API

All routes require `Authorization: Bearer $OPERATOR_TOKEN`.

- `GET /api/operator/orders?status=paid`
- `GET /api/operator/orders/:id`
- `GET /api/operator/orders/:id/packet`
- `POST /api/operator/orders/:id/generate` body `{ "action": "start" | "tick", "force": false, "direction": "...", "videoDirection": "...", "endCard": ["..."], "lowerThird": ["..."] }` — queues a SuperGrok Imagine job (or ticks the xAI REST path if `GENERATION_ENGINE=xai`). `videoDirection` is the visual shot list for the video pass; if omitted it is parsed from `[VISUAL:]` / camera notes in the brief. Exact `endCard` / `lowerThird` lines are composited after generation (also parsed from `[END CARD:]` / `[LOWER THIRD:]`).
- `POST /api/operator/orders/:id/cancel` (aliases `/kill`, `/abort`) — stop a running generate so it cannot keep spending
- `GET /api/operator/imagine/pending` — running Imagine jobs
- `GET /api/operator/imagine/next` — claim the next still or clip
- `POST /api/operator/imagine/complete` body `{ "orderId", "slotId", "kind": "still"|"video", "filename", "mime", "dataUrl" }`
- `POST /api/operator/orders/:id/attach` body `{ "files": [{ "filename", "url" }] }` — finished delivery files (QC)
- `POST /api/operator/orders/:id/references` — owner / job-site photos for generate (see below)
- `POST /api/operator/orders/:id/qc` body `{ "watched": true, "namesPhoneCityCorrect": true, "noArtifacts": true }`
- `POST /api/operator/orders/:id/deliver`
- `POST /api/operator/orders/:id/flag` body `{ "note": "..." }`
- `GET /api/operator/sla`
- `POST /api/operator/sla` sends the aging-order digest

QC is required before delivery. Prompt templates live in `src/lib/prompts/`.

Stripe webhook: `POST /api/stripe/webhook`.

## Operator bot jobs (20s spots + reference photos)

Grok Bot / operators create a 20s job with `POST /api/operator/bot/jobs`. Generation uses the same `upload` / `logo` assets as customer checkout. **Send the real owner and job-site photos with the job** — do not host them on pastebins. Remakes keep those photos on the order.

`GET /api/operator/bot/jobs/:id` (and the create/remake responses) include a `references` array so you can confirm the photos landed.

### Upload then attach (recommended if the bot already has files)

```bash
# 1) Store photos on this app. Returns signed /api/files URLs.
curl -sS -X POST "$ORIGIN/api/operator/uploads" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -F "files=@alan-owner.jpg" \
  -F "files=@pool-1.jpg" \
  -F "files=@pool-3.jpg"

# 2) Create the 20s job and attach those URLs (or the returned asset ids).
curl -sS -X POST "$ORIGIN/api/operator/bot/jobs" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "profile": "<the entire audience paste>",
    "generate": true,
    "references": [
      {"filename":"alan-owner.jpg","url":"https://mya.geotargetus.dev/api/files/ast_…?exp=…&sig=…"},
      {"filename":"pool-1.jpg","assetId":"ast_…"},
      {"filename":"pool-3.jpg","assetId":"ast_…"}
    ]
  }'
```

### Multipart in one request

```bash
curl -sS -X POST "$ORIGIN/api/operator/bot/jobs" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -F "profile=<the entire audience paste>" \
  -F "generate=true" \
  -F "references=@alan-owner.jpg" \
  -F "references=@pool-1.jpg" \
  -F "references=@pool-3.jpg"
```

JSON may also send `references: [{ "filename", "mime", "dataUrl", "kind": "upload"|"logo" }]` — same shape as checkout photos.

### Remake (reuses existing photos)

```bash
curl -sS -X POST "$ORIGIN/api/operator/bot/jobs/$ORDER_ID/remake" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"direction":"Match Alan'\''s face and the real pool from the attached photos. Minimal on-screen text — business name and city only.","generate":true}'
```

`generate:true` (the default) **always starts a new still** — it clears the prior take and returns a new `stillUrl`. Attached reference photos are sent into `/images/edits` (not a text-only fallback). Direction may ask for **minimal on-screen text** (business name + city / end-card only); the spoken VO still uses the full script.

### Second-pass video direction (shot list ≠ spoken VO)

Briefs often mix a spoken Voiceover with camera notes (`[VISUAL:]`, `[SFX:]`, lower-thirds, end cards, "Open on… / Transition to…"). Those lines used to flatten into one prompt, so the model treated the shot list as copy (or ignored it because the motion prompt said "one continuous shot").

MakeYourAd now splits the paste:

1. **First pass (still)** — spoken VO stays verbatim. Opening frame may follow the first visual beat. The shot list is **not** burned as on-screen captions. Reference photos still win for real faces/places.
2. **Second pass (video / remake video)** — the visual beat sheet is applied strongly on `/videos/generations`. Spoken words are not rewritten. Directed transitions override the old one-room default.

Bots can send `videoDirection` (aliases: `video_direction`, `visualDirection`, `shotList`, `cameraDirection`) or leave it off and rely on parsing. Job GET/create/remake responses include the resolved `videoDirection`.

```bash
# Create from a Voiceover + [VISUAL:] brief (parser splits spoken vs picture)
curl -sS -X POST "$ORIGIN/api/operator/bot/jobs" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "profile": "Business Name: Knoxville Chamber\nBusiness Address: 17 Market Square, Knoxville, TN\n\nVoiceover 25–30 seconds\nYou didn'\''t build your business in a vacuum. You built it with grit, neighbors, and a city that shows up. Join us today.\n\n[VISUAL:] Open on downtown Knoxville skyline\n[VISUAL:] Transition to Market Square with Larisa Brass (Director of Innovation), tablet, welcoming nod\n[LOWER THIRD:] Larisa Brass | Director of Innovation\n[VISUAL:] Tight shot interacting / modern workspace\n[END CARD:] Knoxville Chamber logo + KnoxvilleChamber.com over Market Square\n[SFX:] City ambience",
    "generate": true,
    "direction": "Minimal on-screen text — business name and city only. Do not burn the VO as captions."
  }'

# Or supply the beat sheet explicitly (spoken profile stays the VO)
curl -sS -X POST "$ORIGIN/api/operator/bot/jobs" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "profile": "Business Name: Knoxville Chamber\nBusiness Address: 17 Market Square, Knoxville, TN\n\nVoiceover 25–30 seconds\nYou didn'\''t build your business in a vacuum. Join us today.",
    "videoDirection": "Open on downtown Knoxville skyline\nTransition to Market Square with Larisa Brass (Director of Innovation), tablet, welcoming nod\nLower third: Larisa Brass | Director of Innovation\nTight shot interacting / modern workspace\nEnd card: Knoxville Chamber logo + KnoxvilleChamber.com over Market Square",
    "generate": true
  }'

# Remake: keep spoken VO, re-apply (or replace) the shot list on the video pass
curl -sS -X POST "$ORIGIN/api/operator/bot/jobs/$ORDER_ID/remake" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "direction": "Minimal on-screen text — business name and city only.",
    "videoDirection": "Open on downtown Knoxville skyline\nTransition to Market Square with Larisa Brass\nEnd card: Knoxville Chamber logo + KnoxvilleChamber.com",
    "generate": true
  }'
```

Spoken VO in that Knoxville example stays: "You didn't build your business… Join us today." The still does not letter the skyline / Market Square / lower-third list. The video prompt includes that shot list.

### Exact end-card / lower-third overlay (deterministic type)

AI-drawn letters are unreliable for brand copy (`Knowillo` / `Knoxvillo` instead of `Knoxville`). When the brief or API names an end card or lower third, MakeYourAd composites that copy **after** still/video generation (and again on the stitched master if the clip was not already overlaid).

Design:

1. Parse exact lines from `endCard` / `lowerThird` (aliases: `end_card`, `lower_third`, `lowerThirds`) **or** from `[END CARD:]` / `[LOWER THIRD:]` / `End card:` / `Lower third:` in the brief or `videoDirection`.
2. Spoken VO is unchanged. The model is not asked to super the business name, city, phone, or CTA. End-card and lower-third beats are a blank plate.
3. Before Sharp / ffmpeg burn the SVG type, the end-card region (last ~3 seconds, lower half of the frame) and the lower-third band are blurred and darkened so any model-burned letters are illegible. Only the composited type stays readable. Lower third is timed mid-spot; the end card holds the last ~3 seconds. Audio is copied, not rewritten.
4. Remake / cancel / reference photos / second-pass `videoDirection` behave as before. Overlay spec is stored on the job and re-parsed on remake.

```bash
# Preferred: send the exact lines (slash-separated or string arrays)
curl -sS -X POST "$ORIGIN/api/operator/bot/jobs" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "profile": "Business Name: Knoxville Chamber\nBusiness Address: 17 Market Square, Knoxville, TN\n\nVoiceover 25–30 seconds\nYou didn'\''t build your business in a vacuum. Join us today.\n\n[VISUAL:] Open on downtown Knoxville skyline\n[LOWER THIRD:] Larisa Brass | Director of Innovation\n[END CARD:] Knoxville Chamber / Innovation. Prosperity. Knoxville. / KnoxvilleChamber.com",
    "endCard": ["Knoxville Chamber", "Innovation. Prosperity. Knoxville.", "KnoxvilleChamber.com"],
    "lowerThird": "Larisa Brass | Director of Innovation",
    "direction": "Minimal on-screen text — do not burn the VO as captions.",
    "generate": true
  }'

# Remake: keep spoken VO + photos; replace overlay copy
curl -sS -X POST "$ORIGIN/api/operator/bot/jobs/$ORDER_ID/remake" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "endCard": "Knoxville Chamber / Innovation. Prosperity. Knoxville. / KnoxvilleChamber.com",
    "lowerThird": ["Larisa Brass", "Director of Innovation"],
    "generate": true
  }'
```

#### Curl verify notes

```bash
# 1) Create without spending (generate:false) and confirm parsed overlay + unchanged VO fields.
curl -sS -X POST "$ORIGIN/api/operator/bot/jobs" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "profile": "Business Name: Knoxville Chamber\nCity: Knoxville\nState: TN\n\nVoiceover 25–30 seconds\nYou didn'\''t build your business in a vacuum. Join us today.\n\n[END CARD:] Knoxville Chamber / Innovation. Prosperity. Knoxville. / KnoxvilleChamber.com\n[LOWER THIRD:] Larisa Brass | Director of Innovation",
    "generate": false
  }'
# Expect JSON: businessName "Knoxville Chamber", endCard includes "Knoxville" (not Knowillo),
# lowerThird includes "Larisa Brass", jobStatus null / not running.

# 2) After a generate finishes, GET the job and confirm overlay fields are still exact.
curl -sS "$ORIGIN/api/operator/bot/jobs/$ORDER_ID" \
  -H "Authorization: Bearer $OPERATOR_TOKEN"
# Expect: endCard = ["Knoxville Chamber","Innovation. Prosperity. Knoxville.","KnoxvilleChamber.com"]
#         lowerThird = ["Larisa Brass","Director of Innovation"]
#         overlaysApplied true once the clip is composited
# Download stillUrl / videoUrl and read the type — it must spell Knoxville.

# 3) Cancel / remake still work with overlay fields present.
curl -sS -X POST "$ORIGIN/api/operator/bot/jobs/$ORDER_ID/cancel" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"operator stop"}'
```

Optional extra photos on remake: same `references` field or multipart files. Add photos to an existing job without remaking: `POST /api/operator/bot/jobs/:id/references` or `POST /api/operator/orders/:id/references`.

### Status, timeouts, and cancel

`GET /api/operator/bot/jobs/:id` ticks a running xAI job (starts video after a leftover still, then polls). It returns:

- `jobStatus`: `running` | `done` | `error` | `cancelled`
- `phase`: `queued` | `still` | `video` | `done` | `error` | `cancelled`
- `startedAt`, `updatedAt`
- `videoStarted`: `true` once `/videos/generations` was accepted
- `timedOut`: `true` when the job failed a watchdog (still handoff 4 min, video 18 min, job 20 min)
- `error`: set on fail/cancel — do not keep polling as if it were running

Stuck jobs no longer sit at `still` with `videoUrl: null` and no error. Either video starts in the same tick as the still, a later GET/worker tick starts it, or the job fails fast.

```bash
# Poll (also advances still → video and video poll)
curl -sS "$ORIGIN/api/operator/bot/jobs/$ORDER_ID" \
  -H "Authorization: Bearer $OPERATOR_TOKEN"

# Stop a hung generate. Aliases: /kill /abort
curl -sS -X POST "$ORIGIN/api/operator/bot/jobs/$ORDER_ID/cancel" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"operator stop"}'
```

Expected transitions: `running` + `phase:still` → `running` + `phase:video` (`videoStarted:true`) → `done` (or `error` / `timedOut:true`). After cancel: `jobStatus:cancelled`, `error` set, further ticks no-op.

`POST /api/operator/orders/:id/attach` is still for **finished delivery files**, not owner/job-site references.
