-- Launch phase: do not accrue commission on completed orders.
-- Keep ledger tables and historical code so commission can be reintroduced later.
DROP TRIGGER IF EXISTS cc_commission_on_order ON cc_orders;
