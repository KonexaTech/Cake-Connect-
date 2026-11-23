-- Restores source for the already-inspected Cake QA tables. Review only on the
-- dedicated Cake development database; never on Kota/Kasii or production.
CREATE TABLE IF NOT EXISTS public.cc_custom_cake_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_number text UNIQUE NOT NULL,
 customer_subject text NOT NULL,
 baker_shop_id uuid NOT NULL REFERENCES public.cc_shops(id),
 event_date date,
 servings integer CHECK(servings BETWEEN 1 AND 2000),
 flavor text NOT NULL,
 size_description text NOT NULL,
 design_notes text NOT NULL DEFAULT '',
 reference_image_key text,
 quoted_total_cents integer CHECK(quoted_total_cents>=0),
 deposit_required_cents integer NOT NULL DEFAULT 0 CHECK(deposit_required_cents>=0),
 deposit_paid_cents integer NOT NULL DEFAULT 0 CHECK(deposit_paid_cents>=0),
 final_paid_cents integer NOT NULL DEFAULT 0 CHECK(final_paid_cents>=0),
 status text NOT NULL DEFAULT 'requested' CHECK(status IN('requested','quoted','accepted','in_progress','ready','completed','cancelled','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(deposit_paid_cents+final_paid_cents<=COALESCE(quoted_total_cents,2147483647))
);
CREATE TABLE IF NOT EXISTS public.cc_cake_order_images (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cake_order_id uuid NOT NULL REFERENCES public.cc_custom_cake_orders(id) ON DELETE RESTRICT,
 uploaded_by_subject text NOT NULL,
 object_key text NOT NULL UNIQUE,
 content_type text NOT NULL CHECK(content_type IN('image/jpeg','image/png','image/webp')),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cc_cake_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cake_order_id uuid NOT NULL REFERENCES public.cc_custom_cake_orders(id) ON DELETE RESTRICT,
 payment_type text NOT NULL CHECK(payment_type IN('deposit','balance')),
 amount_cents integer NOT NULL CHECK(amount_cents>0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','confirmed','failed','refunded')),
 provider text NOT NULL DEFAULT 'manual' CHECK(provider IN('manual','payfast','ozow','yoco')),
 provider_reference text,
 recorded_by_subject text,
 confirmed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cc_custom_cake_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cc_cake_order_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cc_cake_payments ENABLE ROW LEVEL SECURITY;
-- Mirrors the existing inspected QA trigger. No API in this change can confirm
-- a payment; a pending/failed/refunded record never increases paid balances.
CREATE OR REPLACE FUNCTION public.cc_apply_confirmed_cake_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE o public.cc_custom_cake_orders%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status='confirmed' AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Confirmed cake payments are immutable'; END IF;
 IF NEW.status='confirmed' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
  SELECT * INTO o FROM public.cc_custom_cake_orders WHERE id=NEW.cake_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cake order not found'; END IF;
  IF o.quoted_total_cents IS NULL THEN RAISE EXCEPTION 'Cake order must be quoted before confirming payment'; END IF;
  IF NEW.payment_type='deposit' THEN
   IF o.deposit_paid_cents+NEW.amount_cents>o.deposit_required_cents THEN RAISE EXCEPTION 'Deposit exceeds required amount'; END IF;
   UPDATE public.cc_custom_cake_orders SET deposit_paid_cents=deposit_paid_cents+NEW.amount_cents,updated_at=now() WHERE id=o.id;
  ELSE
   IF o.deposit_paid_cents+o.final_paid_cents+NEW.amount_cents>o.quoted_total_cents THEN RAISE EXCEPTION 'Payment exceeds outstanding balance'; END IF;
   UPDATE public.cc_custom_cake_orders SET final_paid_cents=final_paid_cents+NEW.amount_cents,updated_at=now() WHERE id=o.id;
  END IF;
  NEW.confirmed_at=COALESCE(NEW.confirmed_at,now());
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.cc_cake_payments'::regclass AND tgname='cc_confirmed_payment_apply') THEN
  CREATE TRIGGER cc_confirmed_payment_apply BEFORE INSERT OR UPDATE OF status ON public.cc_cake_payments FOR EACH ROW EXECUTE FUNCTION public.cc_apply_confirmed_cake_payment();
 END IF;
END $$;
