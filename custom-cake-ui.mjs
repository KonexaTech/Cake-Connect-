// Real API-backed controls only. No simulated orders or payment success states.
function requestId(){if(globalThis.crypto?.randomUUID)return crypto.randomUUID();if(!globalThis.crypto?.getRandomValues)throw Error('Secure randomness is unavailable');const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');}
export function installCustomCakeControls({api,role}){
 const $=id=>document.getElementById(id),controls=$('customCakeControls'),status=$('customCakeStatus'),list=$('customCakeList');
 if(!controls||!status)return {clear(){},async refreshCapabilities(){}};
 let generation=0,enabled=false,busy=false,draft=null,lastQuote=null;
 const money=value=>value===null||value===undefined?'not quoted':'R'+(value/100).toFixed(2);
 const disable=()=>{controls.disabled=!enabled||busy;};
 const clear=()=>{generation++;enabled=false;busy=false;draft=null;lastQuote=null;disable();for(const form of controls.querySelectorAll('form'))form.reset();for(const input of controls.querySelectorAll('[data-custom-reference]'))input.value='';status.textContent='Sign in to use custom cake requests.';if(list)list.textContent='';};
 async function request(...args){const version=generation;const value=await api(...args);if(version!==generation)throw Error('Account changed; reload this request');return value;}
 const show=order=>{lastQuote=order;status.textContent=`${order.order_number}: ${order.status}. Event date: ${order.event_date}. Quote ${money(order.quoted_total_cents)}. Deposit required ${money(order.deposit_required_cents)}; confirmed ${money(order.deposit_paid_cents)}. Outstanding ${money(order.balance_due_cents)}. Online payments are unavailable.`;};
 const required=(id,label)=>{const value=$(id)?.value.trim();if(!value)throw Error(label+' is required');return value;};
 const number=id=>{const value=required(id,'Amount');if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw Error('Enter a non-negative Rand amount with up to two decimals');const [whole,fraction='']=value.split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(cents)||cents>2147483647)throw Error('Amount is too large');return cents;};
 const currentId=()=>required('customCakeId','Custom request ID');
 async function run(fn){if(busy||!enabled)return;const version=generation;busy=true;disable();try{await fn();}catch(error){if(version===generation)status.textContent=error.message||'Request failed; retry safely.';}finally{if(version===generation){busy=false;disable();}}}
 const bind=(id,fn)=>{if($(id))$(id).onclick=()=>run(fn);};
 if(role==='customer'){
  $('customCakeRequest').onsubmit=event=>{event.preventDefault();run(async()=>{
   const details={bakerShopId:required('shop','Select a bakery above'),eventDate:required('cakeEventDate','Event date'),servings:Number(required('cakeServings','Servings')),flavor:required('cakeFlavor','Requested flavour'),sizeDescription:required('cakeSize','Requested size'),designNotes:$('cakeNotes').value.trim()};
   const key=JSON.stringify(details);if(!draft||draft.key!==key)draft={key,id:requestId()};
   const result=await request('/api/custom-cake-orders','POST',{requestId:draft.id,...details});$('customCakeId').value=result.order.id;show(result.order);
  });};
  bind('newCakeRequest',async()=>{draft=null;lastQuote=null;$('customCakeId').value='';status.textContent='A new custom request will be created when submitted.';});
  bind('myCakeRequests',async()=>{const result=await request('/api/custom-cake-orders/mine');list.textContent=result.orders.map(o=>`${o.id} · ${o.status} · ${o.event_date} · ${money(o.quoted_total_cents)}`).join('\n')||'No custom requests yet.';});
  bind('viewCakeRequest',async()=>show((await request('/api/custom-cake-orders/'+encodeURIComponent(currentId()))).order));
  bind('acceptCakeQuote',async()=>{const id=currentId();if(!lastQuote||lastQuote.id!==id||lastQuote.status!=='quoted')throw Error('View the current quote before accepting');show((await request('/api/custom-cake-orders/'+encodeURIComponent(id)+'/accept','PATCH',{quotedTotalCents:lastQuote.quoted_total_cents,depositRequiredCents:lastQuote.deposit_required_cents})).order);});
  bind('cancelCakeRequest',async()=>show((await request('/api/custom-cake-orders/'+encodeURIComponent(currentId())+'/cancel','PATCH',{})).order));
 }else if(role==='owner'){
  bind('myCakeRequests',async()=>{const result=await request('/api/owner/custom-cake-orders');list.textContent=result.orders.map(o=>`${o.id} · ${o.status} · ${o.event_date} · ${o.servings} servings · ${o.flavor} · ${o.size_description} · ${o.design_notes}`).join('\n')||'No custom requests yet.';});
  bind('viewCakeRequest',async()=>show((await request('/api/owner/custom-cake-orders/'+encodeURIComponent(currentId()))).order));
  $('customCakeQuote').onsubmit=event=>{event.preventDefault();run(async()=>show((await request('/api/owner/custom-cake-orders/'+encodeURIComponent(currentId())+'/quote','PATCH',{quotedTotalCents:number('cakeQuoteAmount'),depositRequiredCents:number('cakeDepositAmount')})).order));};
  bind('updateCakeStatus',async()=>show((await request('/api/owner/custom-cake-orders/'+encodeURIComponent(currentId())+'/status','PATCH',{status:required('cakeProductionStatus','Status')})).order));
 }else if(role==='admin')bind('myCakeRequests',async()=>{const result=await request('/api/admin/custom-cake-orders');list.textContent=result.orders.map(o=>`${o.id} · ${o.status} · ${o.event_date} · quote ${money(o.quoted_total_cents)} · outstanding ${money(o.balance_due_cents)}`).join('\n')||'No custom requests yet.';});
 clear();
 return {clear,async refreshCapabilities(){const version=generation;try{const result=await request('/api/custom-cake-orders/capabilities');if(version===generation){enabled=result.enabled===true;disable();status.textContent=enabled?'Custom requests available. Quotes require bakery approval. Payments are unavailable.':'Custom workflow awaits reviewed setup.';}}catch(error){if(version===generation){enabled=false;disable();status.textContent='Custom workflow unavailable: '+error.message;}}}};
}
