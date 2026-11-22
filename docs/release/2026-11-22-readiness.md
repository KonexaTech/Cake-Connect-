# Cake Connect release engineering evidence — 22 November 2026

Decision: **NOT READY for public release or real transactions.** This repair branch is a review candidate, not an independently accepted application release. No database, payment, deployment, production data, navigation or branding change was executed.

## Verified baseline

- Repository: https://github.com/KonexaTech/Cake-Connect-
- Base `main`: `c947b6046b2346f6bce05a0d1b59316bd8a88861`.
- Repair branch: `development/cake-release-hardening-20261122`.
- Open pull requests at initial discovery: none. Existing unmerged `feature/qa-api-hardening-20261121` at `1dab224e6a9d6d347c372f97a10c0d15b17fe01d` is preserved; its subsequent deployment credential gating was not silently discarded or merged.
- Historical main Pages preview workflow: [44900892600](https://github.com/KonexaTech/Cake-Connect-/actions/runs/44900892600), success. This is historical publication evidence, not a fresh authenticated acceptance or proof of a current URL response.
- Later QA deployment workflow [44908693239](https://github.com/KonexaTech/Cake-Connect-/actions/runs/44908693239) failed. No current successful API deployment is claimed. Worker source exposes a specific isolated QA host guard; frontend `app-config.js` intentionally keeps both public Auth and API URLs empty.
- Dedicated existing Neon project `still-queen-97670659`; inspected only QA branch `br-sweet-surf-beaquabf` (`qa-validation-2026-11-21`). Production branch `br-round-frost-bepotddg` was not modified or used for destructive acceptance.
- No paid service or new project was introduced. No live credentials were exported to source or test fixtures.

## Confirmed defects repaired

| Defect | Minimal repair | Evidence |
| --- | --- | --- |
| Password reset uses only `NEON_AUTH_BASE_URL`, while the actual QA configuration supplies `NEON_AUTH_URL` | Use the same preferred URL/fallback as JWT verification in both reset request and reset page | Worker routing tests verify the configured upstream and reset destination with a local HTTP mock; no real email was sent |
| Null line items, objects in phone/address fields and malformed checkout can throw rather than return validation errors | Validate record types, bounded nonempty contact fields, fulfillment and line items before property access/SQL | Authenticated API test uses a real locally signed EdDSA JWT and mocked JWKS; malformed payloads return 400 before database access |
| Case-insensitive UUID acceptance conflicts with lowercase PostgreSQL UUID returns | Normalize order/shop/item UUIDs before lookup and idempotency comparison; reject duplicate item IDs case-insensitively | Authenticated API retry fixture with uppercase UUIDs returns the existing order without writes |
| API permits delayed-to-preparing/ready transitions rejected by the actual existing database trigger | Align API checks to the inspected persisted transition rules; retain fulfillment constraints | Focused lifecycle tests and read-only `pg_get_functiondef` QA inspection |
| Root test glob omits `tests/flow.test.js` | Include both existing `.test.js` and `.test.mjs` suites | Four original marketplace flow tests now execute in the root command |
| Checked-in RLS migration has missing SQL separators and never enables RLS on fresh tables | Repair separators and explicitly enable existing policies on all 13 tables; source only | PGlite compiles policies and proves a non-owner buyer cannot read another buyer's custom-cake row; initial test reproduced zero RLS-enabled tables |
| Existing notification INSERT policy rejects owner-to-customer status notifications under a non-bypass runtime role and permits insufficiently bound customer notices | Proposed separate `009_order_notification_participants.sql` binds sender, kind and recipient to actual order participants; administrative notices retained | PGlite first reproduces original owner denial, then verifies atomic status + notification, customer receipt and denial of outsider/spoofed-recipient notices |

## Exact engineering scope

Modified: `package.json`, `worker/src/index.js`, `worker/src/neon-api.js`, `worker/test/recovery-routing.test.mjs`, `neon/migrations/008_cc_row_level_security.sql`.

Created: root and Worker `package-lock.json`; `worker/src/checkout-validation.js`; `worker/src/order-states.js`; `worker/test/checkout-api.test.mjs`; `worker/test/checkout-validation.test.mjs`; `worker/test/order-states.test.mjs`; `tests/migration.test.mjs`; proposed `neon/migrations/009_order_notification_participants.sql`; this report. PGlite is a local development-only test dependency. No UI files changed.

Both SQL files are **proposals only**, not applied remotely. Source 008 requires the pre-existing custom-cake tables; the repository still lacks their base migration. Local tests explicitly use minimal representative custom-cake tables and do not establish full schema restoration readiness. Before any rollout, export schema/policies and a recoverable backup, validate on an isolated branch with the intended non-BYPASSRLS runtime role, verify legitimate merchant/customer/admin callers, and obtain approval. Rollback must restore reviewed policy definitions from the pre-change export, not disable RLS or delete data. Reverting the code branch has no remote database effect.

## Tests observed

| Check | Result | Scope |
| --- | --- | --- |
| Initial root check | PASS: 10 tests | Original command omitted four existing JS flow tests |
| Initial Worker check | PASS: 6 tests | Baseline did not exercise the configured Auth URL alias |
| Initial production frontend build | PASS | Does not prove backend connectivity |
| Final root `npm run check` | PASS: 20 tests | Existing flow/menu/isolation/role tests, four checkout-validation tests and two local Postgres policy tests |
| Final Worker `npm --prefix worker run check` | PASS: 14 tests | JWT-authenticated checkout validation/retry, lifecycle, reset routing, origin/method and role routing |
| Final frontend `npm run build` | PASS | All six existing HTML entries compiled |
| Existing Playwright mobile viewport journeys | PASS: 4 tests | Customer demo ordering/tracking, sample owner/admin approval, menu editing, photo checkout. Browser memory only, **not** authenticated Neon orders |
| Production dependency audits, root + Worker | PASS: 0 reported vulnerabilities each | `npm audit --omit=dev`; does not prove absence of application vulnerabilities |
| Live authenticated A/B/customer/merchant/admin ordering | BLOCKED | Dedicated approved fixtures and a verified QA API deployment/frontend configuration required |
| Real recovery inbox | BLOCKED | Owner/test inbox acceptance needed |
| Provider payment, deposit verification, refunds and duplicate webhooks | NOT TESTED / missing integration | No fabricated success or live activation |
| Native Android install, upgrade, notifications and physical testing | BLOCKED | No native project/release workflow, signing configuration or physical-device evidence in this repository |

Counts: 38/38 observed final test executions passed (20 root + 14 Worker + 4 browser = **100% of executed checks**). Six Worker helper/role cases also run in the root suite; these are repeated executions, not 38 unique user features. No percentage of implemented features is claimed because a complete atomic feature inventory and live acceptance are absent.

The browser run used installed Chromium, 390×844 viewport, one worker, via an ephemeral local Playwright configuration overriding only the browser executable. It does not establish Android OS compatibility, physical installation, push or battery acceptance. Local evidence logs: `/tmp/cake-final-check.log`, `/tmp/cake-final-worker.log`, `/tmp/cake-final-build.log`, `/tmp/cake-final-e2e.log`. These paths are local ephemeral evidence; CI must reproduce the committed checks.

## Backend/security findings and unfinished work

Read-only QA catalog inspection found 13 public tables with RLS enabled; 12 force RLS, while commission entries do not. Policies include protected custom-cake reads and customer insert restrictions against user-submitted quotes/deposits. The inspection connection is `neondb_owner` with `BYPASSRLS=true`; this is **not** evidence that the deployed Worker uses an appropriately restricted role. Confirm the real runtime credential separately and repeat owner/customer/admin negative tests.

**Commission drift blocks financial acceptance:** QA still has an active `cc_commission_on_order` trigger recording 50 cents, although source `008_disable_launch_commission.sql` disables launch accrual and Cake's business rules are not approved here. No live trigger was changed. The owner must reconcile the intended Cake policy and stage a reviewed migration before real orders. Kota's approved commission must not be inherited without Cake-specific authorization.

Custom-cake database tables exist in QA, but a complete versioned base schema, custom-order frontend/API, sizes/flavours/options, photographs, secure reference-image uploads, server-approved quotes, deposits, verified payments and balance reconciliation remain incomplete. The existing ready-made demo does not implement these requirements. No payment record is treated as provider-verified evidence in this work.

Notification rows are an API foundation, not actual OneSignal delivery. No push or FCM integration was added. Android OneSignal would require FCM configuration and explicit discussion of the no-Firebase preference before setup.

Delivery integration remains disabled/unimplemented. The coordinated proposed shared contract is HMAC-authenticated, versioned, idempotent by source application/order, and server-validated. No connected delivery workflow, driver availability, delivery price quote or paid/deposit eligibility is claimed. In particular, the copied API's fixed delivery charge is not a verified operational quote; it must not be enabled for real transactions before fulfillment integration and approved pricing.

The public entry point remains the existing clearly labelled browser-session demo; separate `neon-*` screens and Worker code are an unfinished backend foundation. Do not remove preview warnings or wire real orders to the demo memory state.

## Mandatory public-release gates

| Gate | Status | Missing evidence/action |
| --- | --- | --- |
| 1. Essential customer/merchant/admin journeys end-to-end | FAIL | Current public frontend is a demo; configure and accept isolated real ordering |
| 2. Authentication and server authorization | BLOCKED | Real dedicated JWT/session/roles and cross-account denial against deployed QA API |
| 3. Database integrity and isolation | BLOCKED | Runtime restricted role acceptance; complete reproducible schema |
| 4. Critical/high launch blockers resolved | FAIL | Commission drift, missing financial/customization/connected backend flows |
| 5. Applicable automated regression suite | PASS | 20 root + 14 Worker + 4 demo browser executions passed; builds and production dependency audit passed |
| 6. Payment, commission and notification acceptance | BLOCKED | Approved Cake policy, provider sandbox credentials/config, verified push |
| 7. Applicable Android/PWA acceptance | BLOCKED | Manifest exists; install/offline/native/device gates remain unverified |
| 8. Monitoring and recoverable operations | BLOCKED | Full schema export, restore drill, alerting/support operational checks |
| 9. Legal/privacy/deployment review | BLOCKED | Owner sign-off and verified deployment configuration |
| 10. Physical devices and release sign-off | BLOCKED | Supervised human acceptance and release approval |

Verified release gate coverage is **1/10 (10%)** under the user's ten mandatory definitions; this is not a probability, implementation percentage or delivery estimate. Seven gates are blocked and two fail. Public release stays **HOLD**.

Next milestone: approve and reconcile Cake-specific commission/quote/deposit requirements; verify the existing QA Worker deployment and dedicated non-bypass database role; recover a complete versioned schema and restore procedure; then run isolated customer→merchant→completion and unauthorized access acceptance before connecting real delivery or payments.
