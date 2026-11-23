import { test,expect } from '@playwright/test';
const future=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
async function controls(page,role){
 await page.route('https://esm.sh/**',route=>route.abort());
 await page.goto('/neon-'+role+'.html');
 await page.evaluate(async role=>{
  const {installCustomCakeControls}=await import('/custom-cake-ui.mjs');
  window.__cakeCalls=[];
  window.__cakeRecord={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',order_number:'TEST-REQUEST',status:'requested',event_date:'2030-01-01',quoted_total_cents:null,deposit_required_cents:0,deposit_paid_cents:0,balance_due_cents:null};
  window.__cakeControls=installCustomCakeControls({role,api:async(path,method='GET',body)=>{
   window.__cakeCalls.push({path,method,body});
   if(path.endsWith('/capabilities'))return {enabled:true};
   if(window.__delayRead)return new Promise(resolve=>{window.__releaseRead=()=>resolve({order:{...window.__cakeRecord,order_number:'PRIVATE OLD ACCOUNT'}});});
   return {order:{...window.__cakeRecord,id:body?.requestId||window.__cakeRecord.id}};
  }});
  await window.__cakeControls.refreshCapabilities();
 },role);
}
test('custom customer controls reuse a secure request ID on retries and clear stale account responses',async({page})=>{
 await controls(page,'customer');
 await page.evaluate(()=>{Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});document.getElementById('shop').add(new Option('TEST Bakery','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));});
 await page.locator('#shop').selectOption('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 await page.locator('#cakeEventDate').fill(future);await page.locator('#cakeServings').fill('20');await page.locator('#cakeFlavor').fill('TEST requested flavour');await page.locator('#cakeSize').fill('TEST requested size');
 const submit=page.getByRole('button',{name:'Submit custom request to selected bakery'});
 await submit.click();await expect(page.locator('#customCakeStatus')).toContainText('TEST-REQUEST');await submit.click();
 const ids=await page.evaluate(()=>window.__cakeCalls.filter(x=>x.method==='POST').map(x=>x.body.requestId));
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 await page.evaluate(()=>{window.__delayRead=true;});await page.getByRole('button',{name:'View current quote'}).click();
 await page.waitForFunction(()=>typeof window.__releaseRead==='function');await page.evaluate(()=>{window.__cakeControls.clear();window.__releaseRead();});
 await expect(page.locator('#customCakeStatus')).toHaveText('Sign in to use custom cake requests.');await expect(page.locator('#customCakeId')).toHaveValue('');await expect(page.locator('#cakeFlavor')).toHaveValue('');
 await expect(page.getByText('PRIVATE OLD ACCOUNT')).toHaveCount(0);
});
test('baker quotes preserve entered Rand amounts without inventing a deposit percentage',async({page})=>{
 await controls(page,'owner');await page.locator('#customCakeControls').evaluate(el=>{el.closest('section').hidden=false;});
 await page.locator('#customCakeId').fill('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');await page.locator('#cakeQuoteAmount').fill('123.45');await page.locator('#cakeDepositAmount').fill('5.25');
 await page.getByRole('button',{name:'Save bakery quote'}).click();
 const quote=await page.evaluate(()=>window.__cakeCalls.find(x=>x.path.endsWith('/quote')));expect(quote.body).toEqual({quotedTotalCents:12345,depositRequiredCents:525});
 expect(quote.body).not.toHaveProperty('depositPaidCents');
});
