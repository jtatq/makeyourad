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
- `POST /api/operator/orders/:id/generate` body `{ "action": "start" | "tick", "force": false }` — queues a SuperGrok Imagine job (or ticks the xAI REST path if `GENERATION_ENGINE=xai`)
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
  -d '{"direction":"Match Alan'\''s face and the real pool from the attached photos.","generate":true}'
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
