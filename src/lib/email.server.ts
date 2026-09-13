import { env } from "./env.server";
import { makeId } from "./ids";
import { getSql } from "./db";
import { operatorEmail } from "./operator-auth.server";

export type EmailKind = "confirmation" | "delivery" | "operator_notify" | "sla";

function fromAddress(): string {
  return env("FROM_EMAIL") ?? "MakeYourAd <orders@makeyourad.com>";
}

async function deliver(opts: {
  to: string;
  subject: string;
  html: string;
  kind: EmailKind;
  orderId?: string | null;
}): Promise<{ id: string; sentVia: "resend" | "log" }> {
  const sql = await getSql();
  const id = makeId("eml");
  const key = env("RESEND_API_KEY");
  let sentVia: "resend" | "log" = "log";

  if (key) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress(),
          to: [opts.to],
          subject: opts.subject,
          html: opts.html,
        }),
      });
      if (res.ok) sentVia = "resend";
      else console.error("[email] Resend failed", await res.text());
    } catch (err) {
      console.error("[email] Resend error", err);
    }
  }

  await sql.query(
    `insert into outbound_emails (id, to_email, subject, body_html, kind, order_id, sent_via)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [id, opts.to, opts.subject, opts.html, opts.kind, opts.orderId ?? null, sentVia],
  );
  return { id, sentVia };
}

const wrap = (body: string) => `<!doctype html>
<html><body style="margin:0;background:#f4f0e8;color:#1c1915;font-family:Georgia,serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <p style="letter-spacing:.18em;text-transform:uppercase;font-size:11px;color:#243830;">MakeYourAd</p>
    ${body}
    <p style="margin-top:40px;font-size:13px;color:#6e685e;">You own the finished ad. Delivery within 24 hours of order.</p>
  </div>
</body></html>`;

export async function sendOrderConfirmation(opts: {
  to: string;
  businessName: string;
  productName: string;
  priceLabel: string;
  orderId: string;
}) {
  return deliver({
    to: opts.to,
    orderId: opts.orderId,
    kind: "confirmation",
    subject: `We have your order — ${opts.businessName}`,
    html: wrap(`
      <h1 style="font-weight:500;font-size:28px;line-height:1.2;">In production.</h1>
      <p style="font-size:16px;line-height:1.55;">
        Thanks, ${escapeHtml(opts.businessName)}. Your ${escapeHtml(opts.productName)}
        (${escapeHtml(opts.priceLabel)}) is in production. We’ll email the files
        within 24 hours to this address.
      </p>
      <p style="font-size:14px;color:#6e685e;">Order ${escapeHtml(opts.orderId)}</p>
    `),
  });
}

export async function sendDeliveryEmail(opts: {
  to: string;
  businessName: string;
  orderId: string;
  links: Array<{ filename: string; url: string }>;
}) {
  const list = opts.links
    .map(
      (l) =>
        `<li style="margin:8px 0;"><a href="${escapeHtml(l.url)}" style="color:#243830;">${escapeHtml(l.filename)}</a></li>`,
    )
    .join("");
  return deliver({
    to: opts.to,
    orderId: opts.orderId,
    kind: "delivery",
    subject: `Your ad is ready — ${opts.businessName}`,
    html: wrap(`
      <h1 style="font-weight:500;font-size:28px;line-height:1.2;">Your ad is ready.</h1>
      <p style="font-size:16px;line-height:1.55;">
        ${escapeHtml(opts.businessName)}, the files are below. You own them outright.
        Download and run them wherever you like.
      </p>
      <ul style="padding-left:18px;font-size:16px;">${list}</ul>
      <p style="font-size:14px;color:#6e685e;">Links stay live for 30 days. Order ${escapeHtml(opts.orderId)}</p>
    `),
  });
}

export async function sendOperatorPaidNotice(opts: {
  orderId: string;
  businessName: string;
  productName: string;
  city: string;
  state: string;
}) {
  return deliver({
    to: operatorEmail(),
    orderId: opts.orderId,
    kind: "operator_notify",
    subject: `Paid order ${opts.orderId} — ${opts.businessName}`,
    html: wrap(`
      <h1 style="font-weight:500;font-size:24px;">New paid order</h1>
      <p>${escapeHtml(opts.businessName)} · ${escapeHtml(opts.productName)} · ${escapeHtml(opts.city)}, ${escapeHtml(opts.state)}</p>
      <p>Order ${escapeHtml(opts.orderId)}. SLA is 24 hours. Packet is at /api/operator/orders/${escapeHtml(opts.orderId)}/packet</p>
    `),
  });
}

export async function sendSlaDigest(opts: {
  aging: Array<{ id: string; businessName: string; hours: number; status: string }>;
}) {
  if (opts.aging.length === 0) {
    return deliver({
      to: operatorEmail(),
      kind: "sla",
      subject: "MakeYourAd SLA — nothing aging",
      html: wrap(`<p>No open orders older than 12 hours.</p>`),
    });
  }
  const rows = opts.aging
    .map(
      (o) =>
        `<li>${escapeHtml(o.id)} — ${escapeHtml(o.businessName)} — ${escapeHtml(o.status)} — ${o.hours.toFixed(1)}h</li>`,
    )
    .join("");
  return deliver({
    to: operatorEmail(),
    kind: "sla",
    subject: `MakeYourAd SLA — ${opts.aging.length} order(s) past 12 hours`,
    html: wrap(`<h1>Aging orders</h1><ul>${rows}</ul>`),
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&" + "amp;";
      case "<":
        return "&" + "lt;";
      case ">":
        return "&" + "gt;";
      case '"':
        return "&" + "quot;";
      default:
        return "&#39;";
    }
  });
}


export async function listOutbound(limit = 40) {
  const sql = await getSql();
  return sql.query<{
    id: string;
    to_email: string;
    subject: string;
    kind: string;
    sent_via: string;
    created_at: string;
    order_id: string | null;
  }>(
    `select id, to_email, subject, kind, sent_via, created_at, order_id
     from outbound_emails order by created_at desc limit $1`,
    [limit],
  );
}
