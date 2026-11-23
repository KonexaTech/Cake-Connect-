-- PROPOSED: dedicated Cake QA only, after current schema inspection/approval.
-- Customer status updates are narrowly guarded; they cannot edit quote/payment
-- amounts, baker identity, original request details or paid-order cancellation.
CREATE OR REPLACE FUNCTION public.cc_guard_customer_cake_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NULLIF(current_setting('app.current_subject',true),'')=OLD.customer_subject THEN
  IF ROW(NEW.id,NEW.order_number,NEW.customer_subject,NEW.baker_shop_id,NEW.event_date,NEW.servings,NEW.flavor,NEW.size_description,NEW.design_notes,NEW.reference_image_key,NEW.quoted_total_cents,NEW.deposit_required_cents,NEW.deposit_paid_cents,NEW.final_paid_cents,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id,OLD.order_number,OLD.customer_subject,OLD.baker_shop_id,OLD.event_date,OLD.servings,OLD.flavor,OLD.size_description,OLD.design_notes,OLD.reference_image_key,OLD.quoted_total_cents,OLD.deposit_required_cents,OLD.deposit_paid_cents,OLD.final_paid_cents,OLD.created_at) THEN
   RAISE EXCEPTION 'Customer cannot change the quote, payments or original request';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
   (OLD.status='quoted' AND NEW.status='accepted' AND OLD.quoted_total_cents IS NOT NULL)
   OR (OLD.status IN('requested','quoted','accepted') AND NEW.status='cancelled' AND OLD.deposit_paid_cents=0 AND OLD.final_paid_cents=0)
  ) THEN RAISE EXCEPTION 'Customer decision is not allowed'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cc_customer_cake_decision_guard ON public.cc_custom_cake_orders;
CREATE TRIGGER cc_customer_cake_decision_guard BEFORE UPDATE ON public.cc_custom_cake_orders FOR EACH ROW EXECUTE FUNCTION public.cc_guard_customer_cake_decision();
DROP POLICY IF EXISTS cc_cake_order_customer_decision ON public.cc_custom_cake_orders;
CREATE POLICY cc_cake_order_customer_decision ON public.cc_custom_cake_orders FOR UPDATE
 USING(customer_subject=NULLIF(current_setting('app.current_subject',true),''))
 WITH CHECK(customer_subject=NULLIF(current_setting('app.current_subject',true),''));
-- FOR SHARE directly on shops is filtered by the caller's UPDATE RLS policy,
-- which correctly does not permit customers to edit bakeries. This narrowly
-- scoped server-only routine locks only an approved shop; no generic bypass.
CREATE OR REPLACE FUNCTION public.cc_lock_approved_cake_shop(target_shop uuid)
RETURNS TABLE(id uuid,owner_subject text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NULLIF(current_setting('app.current_subject',true),'') IS NULL THEN
  RAISE EXCEPTION 'Authenticated server subject required';
 END IF;
 RETURN QUERY SELECT s.id,s.owner_subject FROM public.cc_shops s
  WHERE s.id=target_shop AND s.approved=true FOR SHARE;
END $$;
REVOKE ALL ON FUNCTION public.cc_lock_approved_cake_shop(uuid) FROM PUBLIC;
-- Owner must grant EXECUTE only to the verified API server database role if it
-- differs from the function owner. Do not grant to browser/Data API roles.
