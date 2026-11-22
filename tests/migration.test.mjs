import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const sql = name => readFileSync(new URL("../neon/migrations/"+name,import.meta.url),"utf8");

test("RLS migration parses against isolated representative tables without changing policy meanings",async()=>{
  const db=new PGlite();
  try {
    for(const file of ["001_kota_connect.sql","002_order_status_events.sql","003_commission_ledger.sql","006_admin_authorization.sql","007_fresh_shop_applications_notifications.sql"]) await db.exec(sql(file));
    // The custom-cake base migration is absent from the repository. These minimal
    // test tables exercise policy parsing only, not a complete restore procedure.
    await db.exec(`CREATE TABLE cc_custom_cake_orders(id uuid PRIMARY KEY,baker_shop_id uuid,customer_subject text,quoted_total_cents int,deposit_required_cents int,deposit_paid_cents int,final_paid_cents int,status text);
    CREATE TABLE cc_cake_order_images(id uuid PRIMARY KEY,cake_order_id uuid,uploaded_by_subject text);
    CREATE TABLE cc_cake_payments(id uuid PRIMARY KEY,cake_order_id uuid,recorded_by_subject text);`);
    await db.exec(sql("008_cc_row_level_security.sql"));
    const {rows}=await db.query("SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity");
    assert.equal(rows[0].count,13);
    await db.exec(`INSERT INTO cc_shops(id,owner_subject,name,area,approved) VALUES('aaaaaaaa-0000-0000-0000-000000000001','owner-a','Test Bakery A','Test',true),('aaaaaaaa-0000-0000-0000-000000000002','owner-b','Test Bakery B','Test',true);
    INSERT INTO cc_custom_cake_orders(id,baker_shop_id,customer_subject,status) VALUES('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','buyer-a','requested'),('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002','buyer-b','requested');
    CREATE ROLE fixture_user; GRANT USAGE ON SCHEMA public TO fixture_user; GRANT SELECT ON ALL TABLES IN SCHEMA public TO fixture_user;
    SET ROLE fixture_user; SELECT set_config('app.current_subject','buyer-a',false);`);
    const visible=await db.query("SELECT customer_subject FROM cc_custom_cake_orders");
    assert.deepEqual(visible.rows,[{customer_subject:"buyer-a"}]);
    await db.exec("RESET ROLE");
    const policy=await db.query("SELECT with_check FROM pg_policies WHERE policyname='cc_cake_order_customer_insert'");
    assert.match(policy.rows[0].with_check,/quoted_total_cents IS NULL/);
    assert.match(policy.rows[0].with_check,/deposit_paid_cents = 0/);
  } finally {await db.close();}
});

async function setupNotificationFixture(db) {
  for(const file of ["001_kota_connect.sql","002_order_status_events.sql","003_commission_ledger.sql","003_order_idempotency.sql","004_commission_integrity.sql","005_order_status_transitions.sql","006_admin_authorization.sql","007_fresh_shop_applications_notifications.sql","008_disable_launch_commission.sql"]) await db.exec(sql(file));
  await db.exec(`CREATE TABLE cc_custom_cake_orders(id uuid PRIMARY KEY,baker_shop_id uuid,customer_subject text,quoted_total_cents int,deposit_required_cents int,deposit_paid_cents int,final_paid_cents int,status text);
    CREATE TABLE cc_cake_order_images(id uuid PRIMARY KEY,cake_order_id uuid,uploaded_by_subject text);
    CREATE TABLE cc_cake_payments(id uuid PRIMARY KEY,cake_order_id uuid,recorded_by_subject text);`);
  await db.exec(sql("008_cc_row_level_security.sql"));
}
test('owner status update and customer notification commit together; outsiders cannot spoof recipients', async () => {
  const db = new PGlite();
  try {
    await setupNotificationFixture(db);
    const shop = '00000000-0000-4000-8000-000000000001';
    const order = '00000000-0000-4000-8000-000000000002';
    await db.exec(`
      CREATE ROLE cc_runtime NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO cc_runtime;
      GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO cc_runtime;
      INSERT INTO cc_shops(id,owner_subject,name,area,approved) VALUES('${shop}','owner','Fixture shop','Fixture area',true);
      INSERT INTO cc_orders(id,order_number,shop_id,customer_subject,customer_name,customer_phone,area,fulfillment_type,subtotal_cents,total_cents,test_order)
        VALUES('${order}','FIXTURE-1','${shop}','customer','Fixture Customer','fixture','Fixture area','pickup',100,100,true);
      SET ROLE cc_runtime;
      SELECT set_config('app.current_subject','owner',false);
    `);
    const notification = `INSERT INTO cc_notifications(order_id,recipient_subject,kind,title) VALUES('${order}','customer','order_status','Fixture status')`;
    // Reproduce the existing live QA policy's failure without touching QA data.
    await assert.rejects(db.exec(notification), /row-level security policy/);
    await db.exec('RESET ROLE');
    await db.exec(readFileSync(new URL('../neon/migrations/009_order_notification_participants.sql', import.meta.url), 'utf8'));
    await db.exec("SET ROLE cc_runtime; SELECT set_config('app.current_subject','owner',false)");
    await db.exec(`BEGIN; UPDATE cc_orders SET status='accepted' WHERE id='${order}'; ${notification}; COMMIT;`);
    assert.equal((await db.query('SELECT status FROM cc_orders')).rows[0].status, 'accepted');
    await assert.rejects(db.exec(`INSERT INTO cc_notifications(order_id,recipient_subject,kind,title) VALUES('${order}','outsider','order_status','Spoof')`), /row-level security policy/);
    await db.exec("SELECT set_config('app.current_subject','outsider',false)");
    assert.equal((await db.query('SELECT id FROM cc_orders')).rows.length, 0);
    assert.equal((await db.query('SELECT id FROM cc_notifications')).rows.length, 0);
    await assert.rejects(db.exec(notification), /row-level security policy/);
    await db.exec("SELECT set_config('app.current_subject','customer',false)");
    assert.equal((await db.query('SELECT title FROM cc_notifications')).rows[0].title, 'Fixture status');
    await db.exec(`INSERT INTO cc_notifications(order_id,recipient_subject,kind,title) VALUES('${order}','owner','new_order','Fixture new order')`);
    await assert.rejects(db.exec(notification), /row-level security policy/);
    await db.exec('RESET ROLE');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM cc_commission_entries')).rows[0].n, 0);
  } finally { await db.close(); }
});
