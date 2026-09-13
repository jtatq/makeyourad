-- MakeYourAd v1 schema. Unowned rows: no user accounts.
-- Public writes go through checkout + waitlist only; orders are operator-gated.

create table if not exists checkouts (
  id text primary key,
  product text not null,
  add_ons text not null default '[]',
  price_cents integer not null,
  business_name text not null,
  category text not null,
  city text not null,
  state text not null,
  website text,
  phone text not null,
  email text not null,
  brief text not null,
  tone text not null,
  platforms text not null default '[]',
  mascot_description text,
  stripe_session_id text unique,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id text primary key,
  checkout_id text,
  product text not null,
  add_ons text not null default '[]',
  price_cents integer not null,
  stripe_session_id text unique,
  business_name text not null,
  category text not null,
  city text not null,
  state text not null,
  website text,
  phone text not null,
  email text not null,
  brief text not null,
  tone text not null,
  platforms text not null default '[]',
  mascot_description text,
  status text not null default 'paid',
  claimed_at timestamptz,
  qc_passed_at timestamptz,
  delivered_at timestamptz,
  attention_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_status_idx on orders (status);
create index if not exists orders_created_idx on orders (created_at);

create table if not exists order_assets (
  id text primary key,
  order_id text,
  checkout_id text,
  kind text not null,
  filename text not null,
  mime text not null,
  data_url text,
  external_url text,
  created_at timestamptz not null default now()
);

create index if not exists order_assets_order_idx on order_assets (order_id);
create index if not exists order_assets_checkout_idx on order_assets (checkout_id);

create table if not exists order_events (
  id text primary key,
  order_id text not null,
  action text not null,
  note text,
  actor text not null default 'operator',
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_idx on order_events (order_id);

create table if not exists waitlist (
  id text primary key,
  email text not null,
  name text,
  city text,
  likeness_ack boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_email_idx on waitlist (lower(email));

create table if not exists outbound_emails (
  id text primary key,
  to_email text not null,
  subject text not null,
  body_html text not null,
  kind text not null,
  order_id text,
  sent_via text not null,
  created_at timestamptz not null default now()
);
