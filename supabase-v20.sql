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
