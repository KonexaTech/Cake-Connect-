import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionOrder } from "../src/order-states.js";
test("delayed orders return through acceptance rather than unsupported database transitions",()=>{
  assert.equal(canTransitionOrder("pending","delayed","pickup"),true);
  assert.equal(canTransitionOrder("delayed","accepted","pickup"),true);
  assert.equal(canTransitionOrder("delayed","rejected","pickup"),true);
  for(const status of ["preparing","ready_for_collection","out_for_delivery","completed"]) assert.equal(canTransitionOrder("delayed",status,"pickup"),false);
});
test("fulfillment and terminal transitions preserve the persisted lifecycle",()=>{
  assert.equal(canTransitionOrder("preparing","out_for_delivery","delivery"),true);
  assert.equal(canTransitionOrder("preparing","out_for_delivery","pickup"),false);
  assert.equal(canTransitionOrder("preparing","ready_for_collection","pickup"),true);
  assert.equal(canTransitionOrder("preparing","ready_for_collection","delivery"),false);
  assert.equal(canTransitionOrder("pending","completed","pickup"),false);
  assert.equal(canTransitionOrder("completed","accepted","pickup"),false);
});
