-- =============================================================
-- Gulnish Crochet — full Supabase setup (current)
-- =============================================================
-- Paste this whole file into Supabase:
--   Dashboard -> SQL Editor -> New query -> Run
-- It is safe to run more than once (every statement is guarded).
--
-- WHAT THIS GIVES YOU
--   * Products, settings, orders, newsletter, photo storage.
--   * Real login (Supabase Auth): each person has their own email + password.
--   * An allow-list table, shop_admins: ONLY the user ids you put in it can
--     add/edit products, settings or photos. Everyone else is blocked by the
--     database itself, even if they somehow create an account.
--   * An audit_log table: every admin action is recorded with who + when.
--
-- ORDER OF WORK
--   1. Run this file.
--   2. Create a login for yourself (and each employee):
--        Dashboard -> Authentication -> Users -> "Add user" (email + password).
--      Copy each user's UUID.
--   3. Allow them (one line per person):
--        insert into public.shop_admins (user_id) values ('THEIR-UUID');
--   4. Storage bucket "shop-images" is created by this file (public read).
-- =============================================================

-- ---------- ADMINS (the allow-list) ----------
-- Only user ids listed here may edit products/settings/orders or upload
-- photos. Put these tables first so the helper below can use it.
create table if not exists public.shop_admins (
  user_id    uuid primary key,
  created_at timestamptz default now()
);

alter table public.shop_admins enable row level security;

-- A signed-in user may read only their own admin row. This is what lets the
-- website ask "am I an admin?" without exposing the whole list. The policy
-- deliberately does NOT look at shop_admins from inside its own rule, which
-- would make Postgres recurse and fail.
drop policy if exists "shop_admins: members read" on public.shop_admins;
drop policy if exists "shop_admins: self read" on public.shop_admins;
create policy "shop_admins: self read"
  on public.shop_admins for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.shop_admins to authenticated;

-- Helper used by every other policy. SECURITY DEFINER so it can check the
-- allow-list without tripping over that table's own row-level security.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.shop_admins where user_id = auth.uid());
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- Existing admins may read the whole list, add or remove people. (Nobody can
-- self-promote: the very first admin must be added with the SQL at the bottom
-- of this file, from the Dashboard.)
drop policy if exists "shop_admins: admins read" on public.shop_admins;
create policy "shop_admins: admins read"
  on public.shop_admins for select
  to authenticated
  using (public.is_admin());

drop policy if exists "shop_admins: admins insert" on public.shop_admins;
create policy "shop_admins: admins insert"
  on public.shop_admins for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "shop_admins: admins delete" on public.shop_admins;
create policy "shop_admins: admins delete"
  on public.shop_admins for delete
  to authenticated
  using (public.is_admin());

-- ---------- ACCESS REQUESTS (staff self-registration) ----------
-- Optional flow: an employee signs up with their own email + password, which
-- writes a "pending" row here. Nothing happens until an admin approves it
-- (which adds the user to shop_admins). Until then the user has no access at
-- all — the database enforces it.
create table if not exists public.access_requests (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  status     text not null default 'pending'
             check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);

create index if not exists access_requests_status_idx
  on public.access_requests (status, created_at desc);

alter table public.access_requests enable row level security;

-- A signed-in user may create exactly one pending request for themselves.
drop policy if exists "access_requests: self insert" on public.access_requests;
create policy "access_requests: self insert"
  on public.access_requests for insert
  to authenticated
  with check (user_id = auth.uid() and status = 'pending');

-- ...and read their own, so the page can show "pending approval".
drop policy if exists "access_requests: self read" on public.access_requests;
create policy "access_requests: self read"
  on public.access_requests for select
  to authenticated
  using (user_id = auth.uid());

-- A signed-in user may also re-open their own request after a rejection.
drop policy if exists "access_requests: self reopen" on public.access_requests;
create policy "access_requests: self reopen"
  on public.access_requests for update
  to authenticated
  using (user_id = auth.uid() and status = 'rejected')
  with check (user_id = auth.uid() and status = 'pending');

-- Admins can read every request and approve / reject.
drop policy if exists "access_requests: admins read" on public.access_requests;
create policy "access_requests: admins read"
  on public.access_requests for select
  to authenticated
  using (public.is_admin());

drop policy if exists "access_requests: admins update" on public.access_requests;
create policy "access_requests: admins update"
  on public.access_requests for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "access_requests: admins delete" on public.access_requests;
create policy "access_requests: admins delete"
  on public.access_requests for delete
  to authenticated
  using (public.is_admin());

-- ---------- PRODUCTS ----------
create table if not exists public.products (
  id          text primary key,
  name        text not null,
  price       numeric default 0,
  price_max   numeric not null default 0,
  category    text,
  subcategory text not null default '',
  image       text,
  keywords    jsonb default '[]'::jsonb,
  colors      jsonb default '[]'::jsonb,
  status      text default 'in stock',
  stock       int,
  gallery     jsonb default '[]'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  updated_by  uuid
);

-- Backfill columns for an older table.
alter table public.products add column if not exists price_max   numeric not null default 0;
alter table public.products add column if not exists subcategory text not null default '';
alter table public.products add column if not exists keywords    jsonb default '[]'::jsonb;
alter table public.products add column if not exists status      text default 'in stock';
alter table public.products add column if not exists stock       int;
alter table public.products add column if not exists gallery     jsonb default '[]'::jsonb;
alter table public.products add column if not exists updated_at  timestamptz default now();
alter table public.products add column if not exists updated_by  uuid;

-- A published top price must sit above the base; anything else is stored as 0.
alter table public.products drop constraint if exists products_price_max_above_price;
alter table public.products add constraint products_price_max_above_price
  check (price_max = 0 or price_max > price);

create index if not exists products_category_subcategory_idx
  on public.products (category, subcategory);

alter table public.products enable row level security;

drop policy if exists "products: public read" on public.products;
create policy "products: public read"
  on public.products for select
  using (true);

drop policy if exists "products: admin write" on public.products;
drop policy if exists "products: admins write" on public.products;
create policy "products: admins write"
  on public.products for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- SETTINGS (single row, id = 'app') ----------
create table if not exists public.settings (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  updated_by uuid
);

alter table public.settings add column if not exists updated_at timestamptz default now();
alter table public.settings add column if not exists updated_by uuid;

alter table public.settings enable row level security;

drop policy if exists "settings: public read" on public.settings;
create policy "settings: public read"
  on public.settings for select
  using (true);

drop policy if exists "settings: admin write" on public.settings;
drop policy if exists "settings: admins write" on public.settings;
create policy "settings: admins write"
  on public.settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Bootstrap the row with sane defaults. The app fills in the current eight
-- categories/subcategories on first load and the admin panel saves them back.
insert into public.settings (id, data)
values (
  'app',
  jsonb_build_object(
    'whatsapp', '03075729901',
    'whatsappCountry', '92',
    'craftDays', 5,
    'deliveryDays', 3,
    'bankAccountTitle', '',
    'bankAccountNo', '',
    'bankIBAN', '',
    'jazzcashNumber', '',
    'easypaisaNumber', '',
    'shippingFee', '',
    'version', 4
  )
)
on conflict (id) do nothing;

-- ---------- ORDERS ----------
create table if not exists public.orders (
  id              text primary key,
  phone           text,
  customer_name   text,
  email           text,
  address         text,
  city            text,
  province        text,
  landmark        text,
  notes           text,
  items           jsonb default '[]'::jsonb,
  total           numeric default 0,
  payment         text,
  status          text default 'Pending',
  placed_at       timestamptz,
  created_at      timestamptz default now()
);

alter table public.orders add column if not exists province        text;
alter table public.orders add column if not exists landmark        text;
alter table public.orders add column if not exists status_history  jsonb default '[]'::jsonb;
alter table public.orders add column if not exists payment_method  text;
alter table public.orders add column if not exists payment_status  text default 'Pending';
alter table public.orders add column if not exists est_delivery    timestamptz;
alter table public.orders add column if not exists updated_at      timestamptz;
alter table public.orders add column if not exists craft_days      int;
alter table public.orders add column if not exists delivery_days   int;
alter table public.orders add column if not exists notify_updates  boolean default false;
alter table public.orders add column if not exists delivery_charge numeric not null default 0;
alter table public.orders add column if not exists grand_total     numeric;

create index if not exists orders_phone_idx on public.orders (phone);

alter table public.orders enable row level security;

-- Customers may only INSERT (place) an order; they read their own back
-- through the scoped function below, never a full table scan.
drop policy if exists "orders: public read" on public.orders;
drop policy if exists "orders: anon insert" on public.orders;
create policy "orders: anon insert"
  on public.orders for insert
  to anon
  with check (true);

drop policy if exists "orders: insert" on public.orders;
drop policy if exists "orders: admin write" on public.orders;
drop policy if exists "orders: admins all" on public.orders;
create policy "orders: admins all"
  on public.orders for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.get_customer_orders(search text, max_results int default 50)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  select *
  from public.orders
  where id = search
     or phone = regexp_replace(coalesce(search, ''), '[^0-9]', '', 'g')
  order by placed_at desc nulls last, created_at desc
  limit greatest(1, least(coalesce(max_results, 50), 100));
$$;

grant execute on function public.get_customer_orders(text, int) to anon, authenticated;

-- ---------- AUDIT LOG ----------
-- Every admin action the app performs is written here: who (user_id), what
-- (action + entity + entity_id) and when. Read it in Dashboard -> Table
-- Editor -> audit_log to see exactly who changed what.
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  email      text,
  action     text not null,
  entity     text,
  entity_id  text,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_at_idx
  on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

drop policy if exists "audit_log: admins read" on public.audit_log;
create policy "audit_log: admins read"
  on public.audit_log for select
  to authenticated
  using (public.is_admin());

drop policy if exists "audit_log: admins insert" on public.audit_log;
create policy "audit_log: admins insert"
  on public.audit_log for insert
  to authenticated
  with check (public.is_admin() and user_id = auth.uid());

-- ---------- NEWSLETTER ----------
create table if not exists public.newsletter_subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique check (email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'),
  name            text,
  source          text,
  consent         bool not null default true,
  consent_at      timestamptz not null default now(),
  ip_hash         text,
  user_agent      text,
  created_at      timestamptz not null default now(),
  unsubscribed_at timestamptz,
  notes           text
);

create index if not exists newsletter_subscribers_email_idx
  on public.newsletter_subscribers (email);
create index if not exists newsletter_subscribers_created_at_idx
  on public.newsletter_subscribers (created_at desc);

alter table public.newsletter_subscribers enable row level security;

drop policy if exists "Public subscribe" on public.newsletter_subscribers;
create policy "Public subscribe"
  on public.newsletter_subscribers for insert
  with check (true);

drop policy if exists "Service role all" on public.newsletter_subscribers;
create policy "Service role all"
  on public.newsletter_subscribers for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ---------- STORAGE: shop-images bucket ----------
insert into storage.buckets (id, name, public)
values ('shop-images', 'shop-images', true)
on conflict (id) do nothing;

drop policy if exists "shop-images: public read" on storage.objects;
create policy "shop-images: public read"
  on storage.objects for select
  using (bucket_id = 'shop-images');

drop policy if exists "shop-images: admin insert" on storage.objects;
drop policy if exists "shop-images: admins insert" on storage.objects;
create policy "shop-images: admins insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'shop-images' and public.is_admin());

drop policy if exists "shop-images: admin update" on storage.objects;
drop policy if exists "shop-images: admins update" on storage.objects;
create policy "shop-images: admins update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'shop-images' and public.is_admin());

drop policy if exists "shop-images: admin delete" on storage.objects;
drop policy if exists "shop-images: admins delete" on storage.objects;
create policy "shop-images: admins delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'shop-images' and public.is_admin());

-- =============================================================
-- STEP 3 — after creating each user, allow them (replace the UUID):
-- =============================================================
-- insert into public.shop_admins (user_id) values ('REPLACE-WITH-USER-UUID');
-- (Run it once per person. To remove someone, delete their row here.)
