create table if not exists api_calls (
  id text primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  path text not null,
  method text not null default 'GET',
  status int not null,
  ms int,
  retry_after text,
  remaining text,
  limit_hdr text,
  reset_hdr text,
  error text
);

create index if not exists api_calls_created_idx on api_calls (created_at desc);
create index if not exists api_calls_kind_idx on api_calls (kind, created_at desc);
