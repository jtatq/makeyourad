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
| `XAI_API_KEY` | optional | Fallback only. Operator Generate uses **SuperGrok Imagine** on this account by default. Set `GENERATION_ENGINE=xai` to force the REST key. |
| `GENERATION_ENGINE` | optional | `imagine` (default) or `xai`. |
| `DATABASE_URL` | production | Injected on deploy. Do not set in preview. |

Never put secrets in client code.

## Operator API

All routes require `Authorization: Bearer $OPERATOR_TOKEN`.

- `GET /api/operator/orders?status=paid`
- `GET /api/operator/orders/:id`
- `GET /api/operator/orders/:id/packet`
- `POST /api/operator/orders/:id/generate` body `{ "action": "start" | "tick", "force": false }` — queues a SuperGrok Imagine job (or ticks the xAI REST path if `GENERATION_ENGINE=xai`)
- `GET /api/operator/imagine/pending` — running Imagine jobs
- `GET /api/operator/imagine/next` — claim the next still or clip
- `POST /api/operator/imagine/complete` body `{ "orderId", "slotId", "kind": "still"|"video", "filename", "mime", "dataUrl" }`
- `POST /api/operator/orders/:id/attach` body `{ "files": [{ "filename", "url" }] }`
- `POST /api/operator/orders/:id/qc` body `{ "watched": true, "namesPhoneCityCorrect": true, "noArtifacts": true }`
- `POST /api/operator/orders/:id/deliver`
- `POST /api/operator/orders/:id/flag` body `{ "note": "..." }`
- `GET /api/operator/sla`
- `POST /api/operator/sla` sends the aging-order digest

QC is required before delivery. Prompt templates live in `src/lib/prompts/`.

Stripe webhook: `POST /api/stripe/webhook`.
