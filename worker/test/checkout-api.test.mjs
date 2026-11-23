import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { neonApi } from "../src/neon-api.js";

test("authenticated checkout rejects malformed payloads before SQL and normalizes UUID retries", async t => {
  const {privateKey,publicKey}=await generateKeyPair("EdDSA");
  const jwk={...await exportJWK(publicKey),kid:"checkout-fixture",alg:"EdDSA"};
  const base="https://checkout-auth.example.test";
  const token=await new SignJWT({}).setProtectedHeader({alg:"EdDSA",kid:jwk.kid})
    .setSubject("isolated-customer").setIssuer(base).setAudience(base).setIssuedAt().setExpirationTime("1m").sign(privateKey);
  t.mock.method(globalThis,"fetch",async url=>{
    assert.equal(String(url),base+"/.well-known/jwks.json");
    return new Response(JSON.stringify({keys:[jwk]}),{headers:{"content-type":"application/json"}});
  });
  const id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const valid={requestId:id,shopId:id,items:[{itemId:id,quantity:1}],customerName:"Test Buyer",customerPhone:"0712345678",area:"Test Area",fulfillmentType:"pickup"};
  for(const body of [{...valid,items:[null]},{...valid,customerPhone:{}},{...valid,fulfillmentType:"delivery",deliveryAddress:{street:"x"}}]) {
    const response=await neonApi(new Request("https://worker.example.test/api/orders",{
      method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(body)
    }),{NEON_AUTH_URL:base},()=>{throw Error("Invalid order reached database")});
    assert.equal(response.status,400);
    assert.deepEqual(await response.json(),{error:"Invalid checkout"});
  }
  const normalized=[];
  const db={query:async(sql,params)=>{
    if(sql.startsWith("SELECT id,order_number")){
      normalized.push(params[1]);
      return {rows:[{id,order_number:"TEST-REPLAY",status:"pending",total_cents:100,shop_id:id,customer_name:valid.customerName,customer_phone:valid.customerPhone,area:valid.area,delivery_address:null,fulfillment_type:"pickup"}]};
    }
    if(sql.startsWith("SELECT menu_item_id"))return {rows:[{id,quantity:1}]};
    if(sql==="BEGIN"||sql==="COMMIT")return {rows:[]};
    throw Error("Unexpected SQL: "+sql);
  }};
  const replay=await neonApi(new Request("https://worker.example.test/api/orders",{
    method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},
    body:JSON.stringify({...valid,requestId:id.toUpperCase(),shopId:id.toUpperCase(),items:[{itemId:id.toUpperCase(),quantity:1}]})
  }),{NEON_AUTH_URL:base},async(_,callback)=>callback(db));
  assert.equal(replay.status,200);
  assert.equal((await replay.json()).replayed,true);
  assert.deepEqual(normalized,[id]);

});
