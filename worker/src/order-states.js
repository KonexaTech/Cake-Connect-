// Match the existing database transition trigger; do not widen the persisted lifecycle.
const next = Object.freeze({
  pending: ["accepted", "rejected", "delayed"],
  accepted: ["preparing", "delayed", "rejected"],
  preparing: ["ready_for_collection", "out_for_delivery", "delayed"],
  delayed: ["accepted", "rejected"],
  ready_for_collection: ["completed"],
  out_for_delivery: ["completed"]
});
export function canTransitionOrder(previous, requested, fulfillment) {
  return Boolean(next[previous]?.includes(requested)) &&
    (requested !== "ready_for_collection" || fulfillment === "pickup") &&
    (requested !== "out_for_delivery" || fulfillment === "delivery");
}
