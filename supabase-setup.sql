-- =============================================================
-- Gulnish Crochet — full Supabase setup (current)
-- =============================================================
-- Paste this whole file into Supabase:
--   Dashboard -> SQL Editor -> New query -> Run
-- It is safe to run more than once (every statement is guarded).
--
-- Order of work:
--   1. Run this file.
--   2. Create your admin login: Dashboard -> Authentication -> Users
--      -> "Add user" (email + password). Copy the new user's UUID.
--   3. Fill in the INSERT at the bottom ("admins") with that UUID and run it.
--   4. Storage bucket "shop-images" is created by this file (public).
-- =============================================================

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
  created_at  timestamptz default now()
);

-- Backfill columns for an older table.
alter table public.products add column if not exists price_max   numeric not null default 0;
alter table public.products add column if not exists subcategory text not null default '';
alter table public.products add column if not exists keywords    jsonb default '[]'::jsonb;
alter table public.products add column if not exists status      text default 'in stock';
alter table public.products add column if not exists stock       int;
alter table public.products add column if not exists gallery     jsonb default '[]'::jsonb;

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
  using (exists (select 1 from public.shop_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.shop_admins a where a.user_id = auth.uid()));

-- ---------- SETTINGS (single row, id = 'app') ----------
create table if not exists public.settings (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

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
  using (exists (select 1 from public.shop_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.shop_admins a where a.user_id = auth.uid()));

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
  using (exists (select 1 from public.shop_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.shop_admins a where a.user_id = auth.uid()));

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

-- ---------- ADMINS ----------
-- Only user ids listed here may edit products/settings/orders or upload photos.
create table if not exists public.shop_admins (
  user_id    uuid primary key,
  created_at timestamptz default now()
);

alter table public.shop_admins enable row level security;

drop policy if exists "shop_admins: members read" on public.shop_admins;
create policy "shop_admins: members read"
  on public.shop_admins for select
  using (exists (select 1 from public.shop_admins a where a.user_id = auth.uid()));

grant select on public.shop_admins to anon, authenticated;

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
  with check (bucket_id = 'shop-images'
    and exists (select 1 from public.shop_admins a where a.user_id = auth.uid()));

drop policy if exists "shop-images: admin update" on storage.objects;
drop policy if exists "shop-images: admins update" on storage.objects;
create policy "shop-images: admins update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'shop-images'
    and exists (select 1 from public.shop_admins a where a.user_id = auth.uid()));

drop policy if exists "shop-images: admin delete" on storage.objects;
drop policy if exists "shop-images: admins delete" on storage.objects;
create policy "shop-images: admins delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'shop-images'
    and exists (select 1 from public.shop_admins a where a.user_id = auth.uid()));

-- =============================================================
-- STEP 3 (after creating your admin user) — replace the UUID and run:
-- =============================================================
-- insert into public.shop_admins (user_id) values ('REPLACE-WITH-YOUR-USER-UUID');
