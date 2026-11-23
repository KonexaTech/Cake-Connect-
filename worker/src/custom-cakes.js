// Custom-cake requests use the inspected Cake QA schema. Prices are quoted by
// the approved bakery; this module cannot confirm payments or invent earnings.
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class Failure extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new Failure(status,message);};
const fields='o.id,o.order_number,o.customer_subject,o.baker_shop_id,o.event_date,o.servings,o.flavor,o.size_description,o.design_notes,o.quoted_total_cents,o.deposit_required_cents,o.deposit_paid_cents,o.final_paid_cents,o.status,o.created_at,o.updated_at,s.owner_subject,s.approved';
const date=value=>value instanceof Date?value.toISOString().slice(0,10):value;
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const cents=value=>Number.isSafeInteger(value)&&value>=0&&value<=2147483647;
function only(body,keys){return body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(key=>keys.includes(key));}
async function body(request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))fail(400,'JSON request required');
 const reader=request.body?.getReader();if(!reader)fail(400,'Request body required');
 let size=0;const parts=[];
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384){await reader.cancel();fail(413,'Custom cake request is too large');}parts.push(part.value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'Invalid JSON');}
}
function requestDetails(input){
 if(!only(input,['requestId','bakerShopId','eventDate','servings','flavor','sizeDescription','designNotes'])||typeof input.requestId!=='string'||!uuid.test(input.requestId)||typeof input.bakerShopId!=='string'||!uuid.test(input.bakerShopId)||!text(input.flavor,160)||!text(input.sizeDescription,160)||typeof(input.designNotes??'')!=='string'||(input.designNotes||'').length>2000||!Number.isInteger(input.servings)||input.servings<1||input.servings>2000)fail(400,'Invalid custom cake request');
 if(typeof input.eventDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)||!Number.isFinite(Date.parse(input.eventDate))||new Date(input.eventDate).toISOString().slice(0,10)!==input.eventDate||input.eventDate<new Date().toISOString().slice(0,10))fail(400,'Choose a valid future event date');
 return {id:input.requestId.toLowerCase(),shop:input.bakerShopId.toLowerCase(),event:input.eventDate,servings:input.servings,flavor:input.flavor.trim(),size:input.sizeDescription.trim(),notes:(input.designNotes||'').trim()};
}
function publicOrder(row){
 const {customer_subject,owner_subject,approved,...order}=row;
 order.event_date=date(order.event_date);
 order.balance_due_cents=order.quoted_total_cents===null?null:Math.max(0,order.quoted_total_cents-order.deposit_paid_cents-order.final_paid_cents);
 order.deposit_due_cents=Math.max(0,order.deposit_required_cents-order.deposit_paid_cents);
 order.payment_state=order.quoted_total_cents===null?'unquoted':order.quoted_total_cents===0?'no_payment_due':order.balance_due_cents===0?'paid':order.deposit_paid_cents+order.final_paid_cents>0?'partially_paid':'unpaid';
 order.payment_processing='not_enabled';return order;
}
async function transaction(db,run){await db.query('BEGIN');try{const result=await run();await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}}
async function load(db,id,lock=false){return(await db.query(`SELECT ${fields} FROM cc_custom_cake_orders o LEFT JOIN cc_shops s ON s.id=o.baker_shop_id WHERE o.id=$1${lock?' FOR UPDATE OF o':''}`,[id])).rows[0];}
function readable(row,subject,admin){if(!row||!(row.customer_subject===subject||row.owner_subject===subject||admin))fail(404,'Custom cake order not found');}
function baker(row,subject){if(!row||row.owner_subject!==subject||row.approved!==true)fail(404,'Approved bakery order not found');}
export async function customCakeApi(request,env,withDb,subject,isAdmin){
 const path=new URL(request.url).pathname,method=request.method;
 if(!path.startsWith('/api/custom-cake-orders')&&!path.startsWith('/api/owner/custom-cake-orders')&&!path.startsWith('/api/admin/custom-cake-orders'))return null;
 if(!subject)return json({error:'Sign in with Neon Auth'},401);
 if(env.CUSTOM_CAKES_ENABLED!=='true')return json({error:'Custom cake workflow awaits approved QA configuration'},503);
 const capabilities=await withDb(env,async db=>(await db.query("SELECT (to_regprocedure('public.cc_guard_customer_cake_decision()') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.cc_custom_cake_orders') AND tgname='cc_customer_cake_decision_guard' AND tgenabled<>'D') AND EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cc_custom_cake_orders' AND policyname='cc_cake_order_customer_decision' AND cmd='UPDATE') AND COALESCE(has_function_privilege(current_user,to_regprocedure('public.cc_lock_approved_cake_shop(uuid)'),'EXECUTE'),false)) AS ready")).rows[0]);
 if(capabilities?.ready!==true)return json({error:'Custom cake security migration has not been approved/applied'},503);
 try{
  if(path==='/api/custom-cake-orders/capabilities'&&method==='GET')return json({enabled:true,payment_processing:'not_enabled'});
  if(path==='/api/custom-cake-orders'&&method==='POST'){
   const input=requestDetails(await body(request));
   return await withDb(env,db=>transaction(db,async()=>{
    const previous=await load(db,input.id,true);
    const matches=row=>row.customer_subject===subject&&row.baker_shop_id===input.shop&&date(row.event_date)===input.event&&row.servings===input.servings&&row.flavor===input.flavor&&row.size_description===input.size&&row.design_notes===input.notes;
    if(previous){if(!matches(previous))fail(409,'Request ID already used for different details');return json({order:publicOrder(previous),replayed:true});}
    const shop=(await db.query('SELECT id,owner_subject FROM public.cc_lock_approved_cake_shop($1)',[input.shop])).rows[0];if(!shop)fail(404,'Approved bakery not found');if(shop.owner_subject===subject)fail(403,'Use a separate customer account for your bakery');
    const inserted=await db.query("INSERT INTO cc_custom_cake_orders(id,order_number,customer_subject,baker_shop_id,event_date,servings,flavor,size_description,design_notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING RETURNING id",[input.id,'CC-CAKE-'+input.id.replaceAll('-','').toUpperCase(),subject,input.shop,input.event,input.servings,input.flavor,input.size,input.notes]);
    const saved=await load(db,input.id,true);if(!saved||!matches(saved))fail(409,'Request ID already used for different details');
    return json({order:publicOrder(saved),replayed:!inserted.rowCount},inserted.rowCount?201:200);
   }));
  }
  const adminRoute=path==='/api/admin/custom-cake-orders';
  if(method==='GET'&&['/api/custom-cake-orders/mine','/api/owner/custom-cake-orders','/api/admin/custom-cake-orders'].includes(path)){
   const admin=adminRoute?await isAdmin():false;if(adminRoute&&!admin)fail(403,'Administrator access required');
   const condition=admin?'true':path.startsWith('/api/owner/')?'s.owner_subject=$1':'o.customer_subject=$1';
   const orders=await withDb(env,async db=>(await db.query(`SELECT ${fields} FROM cc_custom_cake_orders o LEFT JOIN cc_shops s ON s.id=o.baker_shop_id WHERE ${condition} ORDER BY o.created_at DESC LIMIT 100`,admin?[]:[subject])).rows);
   return json({orders:orders.map(publicOrder)});
  }
  const route=/^\/api\/(owner\/)?custom-cake-orders\/([a-f0-9-]{36})(?:\/(quote|accept|status|cancel|payments))?$/.exec(path);
  if(!route||!uuid.test(route[2]))return json({error:'Custom cake route not found'},404);
  const id=route[2].toLowerCase(),action=route[3],ownerRoute=!!route[1];
  if(method==='GET'&&!action){const order=await withDb(env,db=>load(db,id));if(ownerRoute)baker(order,subject);else readable(order,subject,await isAdmin());return json({order:publicOrder(order)});}
  if(action==='payments'){
   if(method!=='GET')return json({error:'Payment recording and provider confirmation are not enabled'},503);
   const order=await withDb(env,db=>load(db,id));if(ownerRoute)baker(order,subject);else readable(order,subject,await isAdmin());
   const payments=await withDb(env,async db=>(await db.query('SELECT id,payment_type,amount_cents,status,provider,confirmed_at,created_at FROM cc_cake_payments WHERE cake_order_id=$1 ORDER BY created_at LIMIT 100',[id])).rows);
   return json({payments,payment_processing:'not_enabled'});
  }
  if(method!=='PATCH')return json({error:'Method not allowed'},405);
  const input=await body(request);
  return await withDb(env,db=>transaction(db,async()=>{
   const order=await load(db,id,true);
   if(ownerRoute)baker(order,subject);else if(!order||order.customer_subject!==subject)fail(404,'Custom cake order not found');
   if(action==='quote'&&ownerRoute){
    if(!only(input,['quotedTotalCents','depositRequiredCents'])||!cents(input.quotedTotalCents)||!cents(input.depositRequiredCents)||input.depositRequiredCents>input.quotedTotalCents)fail(400,'Invalid bakery quote');
    if(!['requested','quoted'].includes(order.status)||order.deposit_paid_cents||order.final_paid_cents)fail(409,'This order cannot be requoted');
    await db.query("UPDATE cc_custom_cake_orders SET quoted_total_cents=$2,deposit_required_cents=$3,status='quoted',updated_at=now() WHERE id=$1",[id,input.quotedTotalCents,input.depositRequiredCents]);
   }else if(action==='accept'&&!ownerRoute){
    if(!only(input,['quotedTotalCents','depositRequiredCents'])||!cents(input.quotedTotalCents)||!cents(input.depositRequiredCents))fail(400,'Expected quote required');
    if(order.quoted_total_cents!==input.quotedTotalCents||order.deposit_required_cents!==input.depositRequiredCents)fail(409,'The quote changed; review it before accepting');
    if(order.status!=='accepted'){if(order.status!=='quoted')fail(409,'This order is not awaiting acceptance');await db.query("UPDATE cc_custom_cake_orders SET status='accepted',updated_at=now() WHERE id=$1",[id]);}
   }else if(action==='cancel'&&!ownerRoute){
    if(!only(input,[]))fail(400,'Invalid cancellation');
    if(order.status!=='cancelled'){if(!['requested','quoted','accepted'].includes(order.status)||order.deposit_paid_cents||order.final_paid_cents)fail(409,'Cancellation requires bakery review');await db.query("UPDATE cc_custom_cake_orders SET status='cancelled',updated_at=now() WHERE id=$1",[id]);}
   }else if(action==='status'&&ownerRoute){
    if(!only(input,['status'])||!['in_progress','ready','completed','rejected'].includes(input.status))fail(400,'Invalid bakery status');
    const next={requested:['rejected'],quoted:['rejected'],accepted:['in_progress'],in_progress:['ready'],ready:['completed']};
    if(order.status!==input.status){
     if(!next[order.status]?.includes(input.status))fail(409,'Invalid custom cake transition');
     if(input.status==='in_progress'&&order.deposit_paid_cents<order.deposit_required_cents)fail(409,'Required deposit has not been confirmed');
     if(input.status==='completed'&&(order.quoted_total_cents===null||order.deposit_paid_cents+order.final_paid_cents<order.quoted_total_cents))fail(409,'Outstanding balance has not been confirmed');
     await db.query('UPDATE cc_custom_cake_orders SET status=$2,updated_at=now() WHERE id=$1',[id,input.status]);
    }
   }else return json({error:'Custom cake route not found'},404);
   return json({order:publicOrder(await load(db,id))});
  }));
 }catch(error){if(error instanceof Failure)return json({error:error.message},error.status);throw error;}
}
