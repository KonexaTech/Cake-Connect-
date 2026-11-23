-- Proposed staging-only dispatch association and participant tracking. No payment/order mutation.
CREATE TABLE IF NOT EXISTS public.cc_delivery_dispatches (
 order_id uuid PRIMARY KEY REFERENCES public.cc_orders(id) ON DELETE RESTRICT,
 job_id uuid NOT NULL UNIQUE, intake_status text NOT NULL CHECK(intake_status IN ('searching','assigned','ready','collected','enroute','delivered','cancelled','failed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cc_delivery_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cc_delivery_dispatches FROM PUBLIC;
CREATE POLICY cc_delivery_state_participant_read ON public.cc_delivery_state FOR SELECT USING (EXISTS(SELECT 1 FROM public.cc_orders o LEFT JOIN public.cc_shops s ON s.id=o.shop_id WHERE o.id=order_id AND (o.customer_subject=NULLIF(current_setting('app.current_subject',true),'') OR s.owner_subject=NULLIF(current_setting('app.current_subject',true),'') OR EXISTS(SELECT 1 FROM public.cc_admins a WHERE a.subject=NULLIF(current_setting('app.current_subject',true),'')))));
CREATE POLICY cc_delivery_dispatches_participant_read ON public.cc_delivery_dispatches FOR SELECT USING (EXISTS(SELECT 1 FROM public.cc_orders o LEFT JOIN public.cc_shops s ON s.id=o.shop_id WHERE o.id=order_id AND (o.customer_subject=NULLIF(current_setting('app.current_subject',true),'') OR s.owner_subject=NULLIF(current_setting('app.current_subject',true),'') OR EXISTS(SELECT 1 FROM public.cc_admins a WHERE a.subject=NULLIF(current_setting('app.current_subject',true),'')))));
CREATE POLICY cc_dispatch_owner_insert ON public.cc_delivery_dispatches FOR INSERT WITH CHECK(EXISTS(SELECT 1 FROM public.cc_orders o JOIN public.cc_shops s ON s.id=o.shop_id WHERE o.id=order_id AND s.owner_subject=NULLIF(current_setting('app.current_subject',true),'')));
