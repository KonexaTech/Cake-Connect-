-- PROPOSED ONLY. Server-role grants require review; no customer policies or financial writes.
CREATE TABLE IF NOT EXISTS public.cc_delivery_state (
 order_id uuid PRIMARY KEY REFERENCES public.cc_orders(id) ON DELETE RESTRICT,
 job_id uuid NOT NULL, sequence bigint NOT NULL CHECK(sequence>0),
 status text NOT NULL CHECK(status IN ('searching','assigned','ready','collected','enroute','delivered','cancelled','failed')),
 occurred_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.cc_delivery_events (
 event_id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.cc_orders(id) ON DELETE RESTRICT,
 job_id uuid NOT NULL, sequence bigint NOT NULL CHECK(sequence>0),
 status text NOT NULL CHECK(status IN ('searching','assigned','ready','collected','enroute','delivered','cancelled','failed')),
 occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$')
);
ALTER TABLE public.cc_delivery_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cc_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cc_delivery_state,public.cc_delivery_events FROM PUBLIC;
