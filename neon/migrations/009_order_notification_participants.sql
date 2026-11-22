-- PROPOSED ONLY: review and apply to the isolated Cake Connect QA branch after backup.
-- Existing owner status transactions insert a notification for the customer.
-- Preserve admin notices; bind ordinary notices to the real order participants.
BEGIN;
DROP POLICY IF EXISTS cc_notification_insert ON public.cc_notifications;
CREATE POLICY cc_notification_insert ON public.cc_notifications FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.cc_admins a
          WHERE a.subject=NULLIF(current_setting('app.current_subject', true),''))
  OR EXISTS (
    SELECT 1 FROM public.cc_orders o
    JOIN public.cc_shops s ON s.id=o.shop_id
    WHERE o.id=cc_notifications.order_id AND (
      (cc_notifications.kind='new_order'
       AND o.customer_subject=NULLIF(current_setting('app.current_subject', true),'')
       AND cc_notifications.recipient_subject=s.owner_subject)
      OR (cc_notifications.kind='order_status'
          AND s.owner_subject=NULLIF(current_setting('app.current_subject', true),'')
          AND cc_notifications.recipient_subject=o.customer_subject)
    )
  )
);
COMMIT;
