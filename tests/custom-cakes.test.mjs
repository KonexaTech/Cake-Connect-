import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { neonApi } from '../worker/src/neon-api.js';
import { verifiedNeonSubject } from '../worker/src/neon-auth.js';
import { customAuthFixture } from '../worker/test/custom-cake-auth-fixture.mjs';
const shop='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', otherShop='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const valid=()=>({requestId,bakerShopId:shop,eventDate:new Date(Date.now()+86400000*30).toISOString().slice(0,10),servings:20,flavor:'Customer requested flavour',sizeDescription:'Baker to approve size',designNotes:'TEST ONLY custom design requirements'});
let auth;
test.before(async()=>{auth=await customAuthFixture();});
async function fixture(t){
 const db=new PGlite();
 const names=(await readdir(new URL('../neon/migrations/',import.meta.url))).filter(n=>/^\d{3}_.*\.sql$/.test(n)).sort();
 for(const name of names)await db.exec(await readFile(new URL('../neon/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`CREATE ROLE cake_runtime; GRANT USAGE ON SCHEMA public TO cake_runtime; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO cake_runtime; GRANT EXECUTE ON FUNCTION public.cc_lock_approved_cake_shop(uuid) TO cake_runtime;
 INSERT INTO cc_shops(id,owner_subject,name,area,approved) VALUES('${shop}','baker','TEST Bakery','TEST Area',true),('${otherShop}','other-baker','TEST Other Bakery','TEST Area',true);
 INSERT INTO cc_admins(subject) VALUES('administrator');`);
 t.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),auth.base+'/.well-known/jwks.json');return Response.json({keys:[auth.jwk]});});
 const env={NEON_AUTH_URL:auth.base,CUSTOM_CAKES_ENABLED:'true'};
 async function call(path,actor='customer',method='GET',payload,extraEnv={}){
  const headers={'content-type':'application/json'};if(actor)headers.authorization='Bearer '+await auth.token(actor);
  const request=new Request('https://cake-connect-api-qa.example.test'+path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload)});
  const response=await neonApi(request,{...env,...extraEnv},async(_,callback)=>{
   const subject=await verifiedNeonSubject(request,env);
   await db.exec('SET ROLE cake_runtime');await db.query("SELECT set_config('app.current_subject',$1,false)",[subject||'']);
   try{return await callback(db);}finally{await db.exec('RESET ROLE');}
  });
  return {status:response.status,data:await response.json()};
 }
 return {db,call,close:()=>db.close()};
}
test('custom requests are persisted/idempotent and cannot forge quotes, impersonate buyers or read another customer',async t=>{
 const f=await fixture(t);try{
  const created=await f.call('/api/custom-cake-orders','customer','POST',valid());assert.equal(created.status,201);assert.equal(created.data.order.payment_state,'unquoted');assert.equal(created.data.order.deposit_paid_cents,0);assert.equal(created.data.order.flavor,valid().flavor);
  const repeated=await f.call('/api/custom-cake-orders','customer','POST',{...valid(),requestId:requestId.toUpperCase(),bakerShopId:shop.toUpperCase()});assert.equal(repeated.status,200);assert.equal(repeated.data.replayed,true);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM cc_custom_cake_orders')).rows[0].n,1);
  assert.equal((await f.call('/api/custom-cake-orders','customer','POST',{...valid(),servings:21})).status,409);
  assert.equal((await f.call('/api/custom-cake-orders','customer','POST',{...valid(),quotedTotalCents:1})).status,400);
  assert.equal((await f.call('/api/custom-cake-orders/'+requestId,'outsider')).status,404);
  assert.equal((await f.call('/api/custom-cake-orders/mine','outsider')).data.orders.length,0);
  assert.equal((await f.call('/api/owner/custom-cake-orders','baker')).data.orders.length,1);
  assert.equal((await f.call('/api/admin/custom-cake-orders','administrator')).data.orders.length,1);
  assert.equal((await f.call('/api/admin/custom-cake-orders','customer')).status,403);
  assert.equal((await f.call('/api/custom-cake-orders',null,'POST',valid())).status,401);
 }finally{await f.close();}
});
test('bakery quote, stale acceptance and confirmed-deposit guards preserve truthful balances',async t=>{
 const f=await fixture(t);try{
  await f.call('/api/custom-cake-orders','customer','POST',valid());
  const quote={quotedTotalCents:50000,depositRequiredCents:20000};
  assert.equal((await f.call('/api/owner/custom-cake-orders/'+requestId+'/quote','other-baker','PATCH',quote)).status,404);
  assert.equal((await f.call('/api/owner/custom-cake-orders/'+requestId+'/quote','administrator','PATCH',quote)).status,403);
  const quoted=await f.call('/api/owner/custom-cake-orders/'+requestId+'/quote','baker','PATCH',quote);assert.equal(quoted.status,200);assert.equal(quoted.data.order.balance_due_cents,50000);assert.equal(quoted.data.order.payment_state,'unpaid');
  assert.equal((await f.call('/api/custom-cake-orders/'+requestId+'/accept','customer','PATCH',{...quote,quotedTotalCents:40000})).status,409);
  const accepted=await f.call('/api/custom-cake-orders/'+requestId+'/accept','customer','PATCH',quote);assert.equal(accepted.status,200);assert.equal(accepted.data.order.status,'accepted');
  assert.equal((await f.call('/api/owner/custom-cake-orders/'+requestId+'/status','baker','PATCH',{status:'in_progress'})).status,409);
  assert.equal((await f.call('/api/custom-cake-orders/'+requestId+'/payments','customer','POST',{status:'confirmed',amount_cents:20000})).status,503);
  assert.equal((await f.call('/api/custom-cake-orders/'+requestId+'/payments','customer')).data.payments.length,0);
  await f.db.exec("SELECT set_config('app.current_subject','',false)");
  await f.db.query("INSERT INTO cc_cake_payments(cake_order_id,payment_type,amount_cents,status,provider) VALUES($1,'deposit',20000,'pending','manual')",[requestId]);
  assert.equal((await f.call('/api/custom-cake-orders/'+requestId,'customer')).data.order.deposit_paid_cents,0);
  // Controlled SQL fixture represents an externally verified ledger record;
  // production API has no payment-confirmation endpoint and does not simulate it.
  await f.db.exec("SELECT set_config('app.current_subject','',false)");
  await f.db.query("UPDATE cc_cake_payments SET status='confirmed' WHERE cake_order_id=$1",[requestId]);
  assert.equal((await f.call('/api/owner/custom-cake-orders/'+requestId+'/status','baker','PATCH',{status:'in_progress'})).status,200);
  await f.call('/api/owner/custom-cake-orders/'+requestId+'/status','baker','PATCH',{status:'ready'});
  assert.equal((await f.call('/api/owner/custom-cake-orders/'+requestId+'/status','baker','PATCH',{status:'completed'})).status,409);
  const balance=await f.call('/api/custom-cake-orders/'+requestId,'customer');assert.equal(balance.data.order.deposit_paid_cents,20000);assert.equal(balance.data.order.balance_due_cents,30000);assert.equal(balance.data.order.payment_state,'partially_paid');
 }finally{await f.close();}
});
test('customer RLS decisions cannot change financial/request fields or mark production complete',async t=>{
 const f=await fixture(t);try{
  await f.call('/api/custom-cake-orders','customer','POST',valid());await f.call('/api/owner/custom-cake-orders/'+requestId+'/quote','baker','PATCH',{quotedTotalCents:10000,depositRequiredCents:0});
  await f.db.exec("SET ROLE cake_runtime; SELECT set_config('app.current_subject','customer',false)");
  for(const update of ["quoted_total_cents=1","deposit_paid_cents=10000","baker_shop_id='"+otherShop+"'","design_notes='changed'","status='completed'"])await assert.rejects(f.db.query('UPDATE cc_custom_cake_orders SET '+update+' WHERE id=$1',[requestId]),/Customer/);
  await f.db.exec('RESET ROLE');
  assert.equal((await f.call('/api/custom-cake-orders/'+requestId+'/accept','customer','PATCH',{quotedTotalCents:10000,depositRequiredCents:0})).status,200);
  assert.equal((await f.call('/api/custom-cake-orders/'+requestId+'/cancel','customer','PATCH',{})).status,200);
  assert.equal((await f.call('/api/custom-cake-orders/'+requestId,'customer')).data.order.status,'cancelled');
 }finally{await f.close();}
});
test('custom feature stays closed without explicit configuration/security migration and rejects malformed requests',async t=>{
 const f=await fixture(t);try{
  assert.equal((await f.call('/api/custom-cake-orders','customer','POST',valid(),{CUSTOM_CAKES_ENABLED:'false'})).status,503);
  for(const payload of [{...valid(),requestId:[requestId]},{...valid(),bakerShopId:[shop]},{...valid(),eventDate:'2026-02-31'},{...valid(),servings:null},{...valid(),designNotes:'x'.repeat(17000)}])assert([400,413].includes((await f.call('/api/custom-cake-orders','customer','POST',payload)).status));
  await f.db.exec('DROP FUNCTION public.cc_guard_customer_cake_decision() CASCADE');
  assert.equal((await f.call('/api/custom-cake-orders','customer','POST',valid())).status,503);
 }finally{await f.close();}
});
test('suspending a bakery preserves its customers saved custom and ordinary order history',async t=>{
 const f=await fixture(t);try{
  await f.call('/api/custom-cake-orders','customer','POST',valid());
  const regular='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await f.db.exec("SELECT set_config('app.current_subject','',false)");
  await f.db.query("INSERT INTO cc_menu_items(id,shop_id,name,price_cents) VALUES($1,$2,'TEST item',100)",[regular,shop]);
  await f.db.query("INSERT INTO cc_orders(id,order_number,shop_id,customer_subject,customer_name,customer_phone,area,fulfillment_type,subtotal_cents,total_cents) VALUES($1,'TEST-HISTORY',$2,'customer','Test Customer','0000000000','TEST','pickup',100,100)",[regular,shop]);
  await f.db.query("INSERT INTO cc_order_items(order_id,menu_item_id,item_name,unit_price_cents,quantity) VALUES($1,$1,'TEST item',100,1)",[regular]);
  await f.db.query("INSERT INTO cc_order_status_events(order_id,new_status,actor_subject,actor_role) VALUES($1,'pending','customer','customer')",[regular]);
  await f.db.query('UPDATE cc_shops SET approved=false WHERE id=$1',[shop]);
  assert.equal((await f.call('/api/custom-cake-orders/'+requestId,'customer')).status,200);
  assert.equal((await f.call('/api/custom-cake-orders/mine','customer')).data.orders.length,1);
  assert.equal((await f.call('/api/orders/'+regular,'customer')).status,200);
  assert.equal((await f.call('/api/orders/'+regular+'/items','customer')).data.items.length,1);
  assert.equal((await f.call('/api/orders/'+regular+'/history','customer')).data.events.length,1);
  assert.notEqual((await f.call('/api/orders/'+regular,'outsider')).status,200);
  assert.equal((await f.call('/api/custom-cake-orders/'+requestId,'outsider')).status,404);
 }finally{await f.close();}
});
