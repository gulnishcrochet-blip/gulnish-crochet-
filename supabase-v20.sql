-- =========================================================
-- Gulnish Crochet — v20: subcategories
-- =========================================================
-- Run this once in Supabase (SQL Editor -> New query -> Run).
-- Until it is run, subcategories still work in the admin panel and in the
-- browser, but the value is not stored on the shared database, so a product
-- saved from another device opens without it. The admin panel shows a
-- warning banner when it detects this.
-- =========================================================

alter table public.products
  add column if not exists subcategory text not null default '';

-- The category/subcategory filter on /products only ever compares a string
-- that the app already wrote, so a partial index on the pair is enough.
create index if not exists products_category_subcategory_idx
  on public.products (category, subcategory);

-- =========================================================
-- v21: newsletter subscribers
-- =========================================================
-- Lightweight opt-in list for the homepage/newsletter block.
-- Stores email + optional name + source + consent + UA/IP-lite.
-- =========================================================

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'),
  name text,
  source text,
  consent bool not null default true,
  consent_at timestamptz not null default now(),
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  notes text
);

create index if not exists newsletter_subscribers_email_idx
  on public.newsletter_subscribers (email);

create index if not exists newsletter_subscribers_created_at_idx
  on public.newsletter_subscribers (created_at desc);

-- Enable RLS
alter table public.newsletter_subscribers enable row level security;

-- Public can insert (subscribe only). Read/update/delete restricted to service role (admin/UI not exposed).
drop policy if exists "Public subscribe" on public.newsletter_subscribers;
create policy "Public subscribe"
  on public.newsletter_subscribers
  for insert
  with check (true);

drop policy if exists "Service role all" on public.newsletter_subscribers;
create policy "Service role all"
  on public.newsletter_subscribers
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- =========================================================
-- v22: price ranges
-- =========================================================
-- A handmade piece is quoted as a range, so products carry a published top as
-- well as a base: price is the figure the cart adds up to and price_max the
-- highest it can come to. The shop displays "Rs. X - Rs. Y" and confirms the
-- exact price on WhatsApp.
--
-- Until this is run, the app still saves every other field - it detects the
-- missing column, drops it from the upsert and shows a notice in the admin
-- panel. Products keep working as single fixed prices until then.
-- =========================================================

alter table public.products
  add column if not exists price_max numeric not null default 0;

-- A max at or below the base is meaningless (it would print a back-to-front
-- range), so it is normalised away rather than stored.
alter table public.products
  drop constraint if exists products_price_max_above_price;
alter table public.products
  add constraint products_price_max_above_price
  check (price_max = 0 or price_max > price);

-- =========================================================
-- Orders: flat keychain delivery charge
-- ------------------------------------------------------------
-- Keychains ship at a flat Rs. 250 charged once per order, so the order has
-- to remember it separately from the item total. grand_total is the figure
-- the customer was shown, kept alongside rather than recomputed, because the
-- admin panel and the order email both quote it verbatim.
--
-- Until this is run the columns are absent, so the app drops them from the
-- upsert the same way it does for products.price_max and the order still
-- saves with its item total. Delivery is then confirmed on WhatsApp, as it
-- was before.
-- =========================================================

alter table public.orders
  add column if not exists delivery_charge numeric not null default 0;
alter table public.orders
  add column if not exists grand_total numeric;
