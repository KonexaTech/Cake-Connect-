-- QA rollback: FIRST disable CUSTOM_CAKES_ENABLED and roll back the QA API/UI.
-- Keeps all existing tables, requests, quotes, payments and image metadata.
BEGIN;
DROP POLICY IF EXISTS cc_cake_order_customer_decision ON public.cc_custom_cake_orders;
DROP TRIGGER IF EXISTS cc_customer_cake_decision_guard ON public.cc_custom_cake_orders;
DROP FUNCTION IF EXISTS public.cc_guard_customer_cake_decision();
DROP FUNCTION IF EXISTS public.cc_lock_approved_cake_shop(uuid);
COMMIT;
-- 007_custom_cake_orders.sql restores already-existing QA definitions. Never
-- drop these tables or the existing payment trigger as a rollback shortcut.
