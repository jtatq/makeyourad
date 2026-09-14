alter table api_calls add column if not exists order_id text;
alter table api_calls add column if not exists cost_cents int not null default 0;
create index if not exists api_calls_order_idx on api_calls (order_id);
