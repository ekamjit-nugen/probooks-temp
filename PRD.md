# ProBooks — Product Requirements Document (PRD)

> **Status:** v1.0 — generated 2026-06-01
> **Companion documents:**
> - [`SPEC.md`](SPEC.md) — invariants source of truth (the user-provided specification)
> - [`STANDARDS.md`](STANDARDS.md) — engineering standards every agent must follow
> - [`PROGRESS.md`](PROGRESS.md) — what's done / running / next, updated each phase
>
> **Build constraints:**
> 1. Implement phases one by one — test before moving to the next.
> 2. Each phase contains **one user type + one platform** (web OR mobile). Phase 0 is the only exception (backend infrastructure).
> 3. Production-grade standards throughout — see `STANDARDS.md`.

---

## Table of Contents

- [§1 Overview](#1-overview)
- [§2 User types & applications](#2-user-types--applications)
- [§3 The two-gate spine](#3-the-two-gate-spine)
- [§4 Use case catalogue](#4-use-case-catalogue) — **248 use cases**
- [§5 Delivery phases](#5-delivery-phases) — **16 phases**
- [§6 Sequencing rationale](#6-sequencing-rationale)
- [§7 Open decisions](#7-open-decisions)
- [§8 Appendix](#8-appendix)

---

## 1. Overview

ProBooks is a multi-firm SaaS bookkeeping/HST portal for Canadian accounting firms (CRA, HST, T2). It is built as three applications on one shared backend:

- **App A — Platform Admin Console** (web): used by Nugen's Platform Operator only. Tenant lifecycle, billing, global config. Never reads firm financial data.
- **App B — Firm Workspace** (web, desktop-first): used by Firm Admin/Partner (configuration) and Accountant (operations). RBAC separates roles within one app.
- **App C — Client Portal** (mobile PWA): used by the firm's clients (the business owners + optionally an in-house bookkeeper). Calm, glanceable, low-frequency.

All financial data lives in `ca-central-1` per PIPEDA. The full invariant catalogue (INV-XXX-N codes) is in `SPEC.md`.

---

## 2. User types & applications

| # | User type | App | Platform | Trust zone |
|---|---|---|---|---|
| 1 | Platform Operator (Nugen) | A | web | Internal / privileged |
| 2 | Firm Admin / Partner | B | web | Firm-internal |
| 3 | Accountant (firm staff) | B | web | Firm-internal |
| 4 | Client Owner | C | mobile PWA | External / untrusted |
| 5 | Client Staff (in-house bookkeeper, optional) | C | mobile PWA | External / untrusted |

A client business may have both an Owner and a Staff login if the firm enables it (see §7 open decisions and Phase 14).

---

## 3. The two-gate spine

The period lifecycle is a guarded, monotonic state machine:

```
open → processing → processed → complete → filed → archived
```

**Gate 1 (numbers unlock on client portal):**
ALL flags cleared **AND** period processed → draft on-screen HST summary visible to client.

**Gate 2 (Excel + feedback unlock):**
Accountant **explicitly** marks period complete — separate manual switch.

Every use case below either drives the state machine forward, enforces a gate, or supports the surrounding workflow.

---

## 4. Use case catalogue

248 use cases across 10 user-type / platform slices. Each use case has: actor, priority, preconditions, main flow, alternate flows, edge cases, invariants enforced, acceptance criteria, test cases.

## Platform Operator (web)

### UC-OP-01: Authenticate Platform Operator with MFA
**Actor:** Platform Operator (Nugen internal) | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator account exists in platform IDP
- MFA device enrolled (TOTP/WebAuthn)
- Operator has platform_operator role
- Session not currently active or expired

**Main Flow:**
1. 1. Operator navigates to admin.probooks.ca
2. 2. System redirects to SSO/IDP login page
3. 3. Operator enters corporate email + password
4. 4. System prompts MFA challenge (WebAuthn preferred, TOTP fallback)
5. 5. Operator completes MFA
6. 6. Backend issues short-lived JWT (15-min) + refresh token (8-hour) with platform_operator scope
7. 7. System loads Admin Console dashboard with operator's name and last-login timestamp
8. 8. Audit log records LOGIN_SUCCESS with IP, user-agent, geo

**Alternate Flows:**
- If password invalid, show generic 'invalid credentials' (no user enumeration)
- If MFA fails 3x, lock account 15min and notify security team via webhook
- If IDP unreachable, show 'service degraded' page with status link
- If operator's role was revoked since last session, show 'access removed' and clear cookies
- If login from new geo/device, require re-verification email

**Edge Cases:**
- Clock skew on TOTP device > 30s (allow 1-step drift)
- Browser autofill triggers double-submit
- User refreshes mid-MFA challenge (re-issue challenge, don't reuse)
- Concurrent login from two devices (allow but log both sessions)
- Session token replay from leaked refresh token (rotate on each use)
- Operator deleted while session active (next API call returns 401, force logout)
- Browser back button after logout (must not restore session)

**Invariants Enforced:** INV-SEC-AUTH, INV-AUDIT-APPEND, INV-TEN-3

**Acceptance Criteria:**
- Given valid credentials + MFA, when operator logs in, then JWT has platform_operator scope and expires in 15min
- Given 3 failed MFA attempts, when 4th attempt, then account locked 15min and 401 returned
- Given operator role revoked, when accessing any endpoint, then 403 returned and session terminated
- Given successful login, when audit log queried, then LOGIN_SUCCESS event present with full metadata

**Test Cases:**
- Unit: JWT payload includes only platform_operator scope, no tenant_id
- Unit: Refresh token rotates on each use; old refresh token invalidated
- Integration: Failed MFA increments counter; counter resets after 15min lockout
- E2E: Full login → MFA → dashboard flow under 5s
- Security: Verify no user enumeration via timing on invalid email vs invalid password
- Security: Attempt session fixation; verify session ID rotates post-auth
- A11y: Keyboard-only login flow; MFA input has aria-label; error announcements via aria-live
- A11y: Screen reader announces lockout countdown


### UC-OP-02: View Platform Dashboard with Tenant Inventory
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator authenticated
- At least one tenant exists (or empty state if zero)

**Main Flow:**
1. 1. Operator lands on /admin/dashboard after login
2. 2. System loads aggregate counters: total tenants, active, suspended, trial, churned
3. 3. System loads recent activity feed (last 50 platform events)
4. 4. System loads SLA snapshot (uptime %, p95 latency, error rate)
5. 5. Operator sees tenants table with: firm name, plan, status, region, MRR, last-active, created-at
6. 6. Default sort: most recently active descending
7. 7. Counters and table are read-only; no financial data from any tenant displayed

**Alternate Flows:**
- If zero tenants, show empty state with 'Create your first tenant' CTA
- If metrics service down, show cached values with 'stale' badge and timestamp
- If operator is read-only sub-role, hide action buttons but show data

**Edge Cases:**
- 10,000+ tenants: virtualize table rows, paginate API at 50/page
- Tenant created mid-fetch: show next refresh, do not block
- Currency formatting for tenants in different billing currencies (CAD only at MVP)
- Timezone display: all timestamps in operator's local TZ with UTC tooltip
- Rapid refresh spam: debounce 2s
- Dashboard query > 3s: show skeleton loader, then progressive paint

**Invariants Enforced:** INV-TEN-3, INV-TEN-ISO

**Acceptance Criteria:**
- Given operator on dashboard, when page loads, then no firm financial data is fetched or rendered
- Given 0 tenants, when dashboard loads, then empty state CTA visible
- Given >50 tenants, when scrolling, then virtual scroll loads next page seamlessly
- Given metrics stale > 5min, when displayed, then 'stale' badge with last-updated time shown

**Test Cases:**
- Unit: Aggregator counts exclude soft-deleted tenants by default
- Integration: Dashboard endpoint returns no rows from financial tables (transactions, periods)
- E2E: Load dashboard with 1000 tenants; first paint < 2s, interactive < 4s
- Security: Attempt direct query to /api/tenants/:id/transactions as operator → 403
- A11y: Table has proper <th scope='col'>; sortable columns announce sort direction
- A11y: Empty state CTA reachable via Tab; focus visible


### UC-OP-03: Provision New Firm Tenant
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator authenticated with tenant.create permission
- Plan SKUs configured in platform catalog
- ca-central-1 region available (only region at MVP)

**Main Flow:**
1. 1. Operator clicks 'New Tenant' on dashboard
2. 2. Wizard step 1: enter firm legal name, display name, primary contact email, phone, CRA business number
3. 3. Wizard step 2: select plan SKU, billing cadence (monthly/annual), currency (CAD), trial period (0-30 days)
4. 4. Wizard step 3: select region (ca-central-1 only, pre-selected, disabled), confirm PIPEDA acknowledgment
5. 5. Wizard step 4: enter first Firm Admin email + name (will receive invite)
6. 6. Wizard step 5: review summary; operator clicks 'Create tenant'
7. 7. Backend: BEGIN TX → insert tenants row with tenant_id (UUID) → insert subscription → insert region pin → enable RLS policies → enqueue first-admin invite email → COMMIT
8. 8. System redirects to new tenant detail page
9. 9. Audit log: TENANT_CREATED with operator_id, tenant_id, plan_sku, region

**Alternate Flows:**
- If CRA business number fails format validation (9 digits), show inline error
- If firm email domain already linked to another tenant, show warning but allow override with confirmation
- If invite email send fails, mark tenant as 'pending invite' with retry button
- If operator cancels wizard mid-flow, no rows persisted; warn on unsaved data

**Edge Cases:**
- Duplicate firm legal name: allowed (legally distinct firms can share names), but warn
- Special chars in firm name (emoji, RTL text): sanitize and store as-is, render with bidi isolation
- Concurrent operator creating same firm (race): unique constraint on (legal_name, business_number) prevents duplicates
- Browser refresh after step 5 click: idempotency key prevents double creation
- Email DNS unreachable for invite: queue with exponential backoff up to 24h
- ca-central-1 outage: queue creation in 'pending region' state; do not silently fallback
- Very long firm names (>200 chars): reject with limit error
- Trailing whitespace in email: trim before save

**Invariants Enforced:** INV-TEN-ISO, INV-RES-CA, INV-AUDIT-APPEND, INV-TEN-3

**Acceptance Criteria:**
- Given valid input, when operator submits, then tenant row + subscription + region pin persisted atomically
- Given region != ca-central-1 selected, when submit, then 400 'region not supported'
- Given duplicate idempotency key, when retry submit, then same tenant_id returned (not duplicated)
- Given tenant created, when first-admin invite email triggered, then email queued within 5s
- Given audit log queried, when TENANT_CREATED searched, then row immutable and tied to operator_id

**Test Cases:**
- Unit: CRA business number validator accepts 9-digit, rejects 10-digit
- Unit: Wizard form validation: empty required fields block submit
- Integration: Tenant creation atomically rolls back if invite enqueue fails (or marks pending)
- Integration: RLS policy active immediately on new tenant; cross-tenant query blocked
- E2E: Full wizard click-through; verify tenant appears in dashboard within 3s
- E2E: Browser refresh after submit click; verify no duplicate tenant
- Security: Operator without tenant.create permission → 403 on POST /tenants
- Security: Attempt to set tenant_id in payload (should be server-generated, client value ignored)
- A11y: Wizard steps have <nav aria-label='Wizard steps'>; current step has aria-current
- A11y: Errors associated to fields via aria-describedby


### UC-OP-04: Suspend a Tenant
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator authenticated with tenant.suspend permission
- Target tenant exists and is not already suspended
- Operator has provided reason

**Main Flow:**
1. 1. Operator opens tenant detail page
2. 2. Operator clicks 'Suspend tenant' button (destructive style)
3. 3. Modal asks for: reason (dropdown: non-payment, ToS violation, customer request, security incident, other), free-text notes (required), effective date (now or scheduled)
4. 4. Operator types tenant name to confirm (typed match required)
5. 5. Operator clicks 'Suspend'
6. 6. Backend sets tenant.status = 'suspended', tenant.suspended_at = now(), tenant.suspended_reason
7. 7. All firm/client login attempts return 'tenant suspended' page; existing sessions terminated within 60s
8. 8. In-flight period processing jobs paused (not killed)
9. 9. Email sent to Firm Admin notifying suspension with reason category
10. 10. Audit log: TENANT_SUSPENDED
11. 11. UI shows banner on tenant page: 'Suspended on X by Y; reason: Z'

**Alternate Flows:**
- If tenant already suspended, button disabled with tooltip
- If scheduled suspension chosen, store scheduled_suspend_at and run cron at that time
- If operator cancels modal, no state change
- If a period is mid-processing, suspension waits for current AI job to checkpoint (max 5 min) then pauses

**Edge Cases:**
- Two operators suspend simultaneously: optimistic lock on tenant.version prevents double-write
- Suspension during active client upload: upload completes but next API call returns 423 Locked
- Tenant in trial: still suspendable; billing not charged
- Network failure between status update and session termination: idempotent job re-runs
- Scheduled suspension in past timezone: validate effective_at > now
- Confirmation typo (case-sensitive): allow case-insensitive match
- Operator browser refresh during modal: re-load tenant state, modal resets
- Tenant with paid annual subscription: prorated refund flagged for billing review (not auto-issued)

**Invariants Enforced:** INV-TEN-ISO, INV-AUDIT-APPEND, INV-TEN-LIFECYCLE, INV-TEN-3

**Acceptance Criteria:**
- Given suspended tenant, when firm user logs in, then 403 with 'tenant suspended' page
- Given suspension reason 'non-payment', when audit log queried, then reason persisted verbatim
- Given firm admin email queued, when 5s elapse, then email sent (or retried)
- Given concurrent suspend, when second request, then 409 conflict
- Given operator without permission, when POST /tenants/:id/suspend, then 403

**Test Cases:**
- Unit: Suspend transitions only allowed from 'active' or 'trial'; not from 'deleted'
- Integration: Existing JWT for firm user invalidated within 60s via deny-list cache
- Integration: In-flight Bull queue job for that tenant pauses at next checkpoint
- E2E: Suspend tenant; verify firm login fails with appropriate message
- Security: Verify operator cannot suspend their own platform_operator account
- Security: Verify no PII/financial data fetched from tenant during suspend operation
- A11y: Destructive button has aria-describedby pointing to confirmation explanation
- A11y: Confirmation modal traps focus; ESC closes


### UC-OP-05: Reactivate a Suspended Tenant
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator authenticated with tenant.reactivate permission
- Target tenant exists with status = 'suspended'
- Suspension reason has been resolved (operator attests)

**Main Flow:**
1. 1. Operator opens suspended tenant page
2. 2. Operator clicks 'Reactivate' button
3. 3. Modal: select resolution category (payment received, ToS issue resolved, security cleared, other), notes (required), checkbox 'I confirm reason for suspension is resolved'
4. 4. Operator submits
5. 5. Backend: tenant.status = 'active', tenant.suspended_at = null, log reactivation
6. 6. Paused jobs resume at next worker poll
7. 7. Firm Admin notified by email
8. 8. Audit log: TENANT_REACTIVATED with prior_reason linked
9. 9. UI banner updates to active state

**Alternate Flows:**
- If tenant is 'deleted' (not suspended), reactivate is hidden
- If billing past due, prompt operator to confirm billing reconciliation first (warning, not block)
- If operator cancels, no change

**Edge Cases:**
- Reactivation immediately after suspend (operator error): allowed but audit shows both events
- Resume of paused period processing job: must idempotently continue, not restart from scratch
- Tenant with expired SSL cert or stale config: surface warnings post-reactivation
- Concurrent reactivate + delete: delete wins, reactivate returns 409
- Email send failure: queue retry

**Invariants Enforced:** INV-TEN-LIFECYCLE, INV-AUDIT-APPEND, INV-TEN-3

**Acceptance Criteria:**
- Given suspended tenant, when reactivated, then status='active' and firm logins succeed
- Given paused job, when tenant reactivated, then job resumes within next worker cycle
- Given audit log queried, when reactivation event found, then linked to original suspend event

**Test Cases:**
- Unit: State machine rejects reactivate from 'deleted'
- Integration: Paused job resumes; verify checkpoint state intact
- E2E: Suspend → reactivate → firm login succeeds
- Security: Cross-tenant reactivation attempt blocked
- A11y: Reactivate modal labeled and keyboard accessible


### UC-OP-06: Soft-Delete a Tenant (with retention window)
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator authenticated with tenant.delete permission (elevated role)
- Tenant exists
- Customer offboarding signed off (operator attests)

**Main Flow:**
1. 1. Operator opens tenant page, clicks 'Delete tenant' (heavy destructive style)
2. 2. Multi-step confirmation: (a) attest customer authorized, (b) type firm legal name exactly, (c) acknowledge 90-day retention
3. 3. Operator clicks 'Soft delete'
4. 4. Backend: tenant.status='deleted', tenant.deleted_at=now(), schedule hard-delete cron at now()+90 days
5. 5. All sessions terminated immediately; logins return 410 Gone
6. 6. Data remains in DB with deleted flag; reads from firm-side blocked by RLS + status filter
7. 7. Audit log: TENANT_SOFT_DELETED
8. 8. Email to Firm Admin notifying offboarding + 90-day data export window

**Alternate Flows:**
- If active billing subscription, prompt to cancel subscription first (separate flow)
- If tenant is suspended, allow delete without reactivation step
- Operator cancels at any step: no change

**Edge Cases:**
- Hard-delete cron fires while ongoing legal hold: cron checks legal_hold flag, skips and alerts
- Operator soft-deletes then immediately tries to recreate same firm name: allowed (new tenant_id)
- Tenant with archived periods: archived data also soft-deleted; retrievable within 90 days
- Concurrent delete + suspend: delete wins (terminal state)
- Restoration request within 90 days: separate UC (UC-OP-07)
- Storage cost during retention: track for billing/cost attribution
- Audit log for deleted tenant: retained beyond 90 days (regulatory)

**Invariants Enforced:** INV-TEN-LIFECYCLE, INV-AUDIT-APPEND, INV-DATA-RETAIN, INV-FIN-IMMUT, INV-TEN-3

**Acceptance Criteria:**
- Given soft-deleted tenant, when 90 days elapse without restore, then hard-delete job runs
- Given soft-deleted tenant, when firm user attempts login, then 410 Gone with offboarding message
- Given legal hold set, when hard-delete cron runs, then skipped and alert sent to ops
- Given audit log, when deletion event found, then immutable and includes operator + reason

**Test Cases:**
- Unit: 90-day cron calc handles timezone (always UTC + ca-central-1 region)
- Integration: Hard-delete cron respects legal_hold flag
- Integration: Audit log retention exceeds tenant data retention
- E2E: Soft delete; verify firm login blocked, data still in DB
- Security: Operator without delete permission → 403
- Security: Verify no data exported during delete operation
- A11y: Multi-step confirmation; each step keyboard reachable; warnings have role='alert'


### UC-OP-07: Restore a Soft-Deleted Tenant within Retention Window
**Actor:** Platform Operator | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Tenant in 'deleted' state with deleted_at within 90 days
- Operator authenticated with tenant.restore permission
- Customer has requested restoration in writing (ticket linked)

**Main Flow:**
1. 1. Operator opens 'Deleted tenants' filter on dashboard
2. 2. Operator finds tenant, clicks 'Restore'
3. 3. Modal: paste support ticket ID, notes, confirm
4. 4. Operator submits
5. 5. Backend: tenant.status='suspended' (not active, requires manual reactivate), clear deleted_at, cancel hard-delete cron
6. 6. Audit log: TENANT_RESTORED with ticket reference
7. 7. UI shows tenant with 'Restored, suspended' state; operator must reactivate next

**Alternate Flows:**
- If > 90 days, restore button disabled with 'retention expired' tooltip
- If hard-delete already executed, no restore possible; show explanation

**Edge Cases:**
- Restore race with hard-delete cron: cron checks status at start of run
- Multiple operators restore concurrently: idempotent on status change
- Restoration during region outage: queue and retry
- Subscription state unclear: surface as warning, do not auto-restart billing

**Invariants Enforced:** INV-TEN-LIFECYCLE, INV-AUDIT-APPEND, INV-DATA-RETAIN

**Acceptance Criteria:**
- Given tenant deleted < 90 days, when restored, then status='suspended' and hard-delete cron cancelled
- Given tenant deleted > 90 days, when restore attempted, then 410 Gone
- Given restore, when audit log queried, then linked to original delete event

**Test Cases:**
- Unit: Restore allowed only within 90-day window
- Integration: Hard-delete cron job cancellation verified
- E2E: Soft delete → restore within 30 days → reactivate → firm login works
- Security: Verify ticket ID validated against support system if integration exists


### UC-OP-08: Assign or Change Tenant Subscription Plan
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator authenticated with billing.manage permission
- Tenant active or suspended (not deleted)
- Target plan SKU exists in catalog

**Main Flow:**
1. 1. Operator opens tenant > Billing tab
2. 2. Operator clicks 'Change plan'
3. 3. UI shows current plan, available plans with proration preview
4. 4. Operator selects new plan, effective date (immediate or next cycle), proration policy (proration on/off)
5. 5. System computes proration via Stripe API (or chosen billing provider), shows preview
6. 6. Operator confirms
7. 7. Backend: subscription.plan_sku updated, entitlements recomputed (client count cap, accountant count cap, storage cap), Stripe subscription updated
8. 8. Audit log: PLAN_CHANGED with from_sku, to_sku, prorated_amount
9. 9. Firm Admin notified by email

**Alternate Flows:**
- Downgrade with entitlement reduction (e.g., fewer clients allowed than current): block with 'remove N clients first'
- Plan change on suspended tenant: allowed but billing not collected until reactivation
- Free/trial → paid: capture payment method first; redirect to billing setup if missing

**Edge Cases:**
- Stripe API down: retry with exponential backoff; operator informed, retry surface in UI
- Plan SKU deprecated mid-flow: refresh catalog, prevent selection
- Currency mismatch: only CAD at MVP; reject others
- Concurrent plan change: last-write-wins with optimistic lock
- Proration calc returns zero due to mid-cycle math: still log event
- Trial extension: separate plan_modifier; does not reset trial counter
- Annual plan switch mid-year: prorate with credit balance

**Invariants Enforced:** INV-BILL-AUDIT, INV-ENT-CAPS, INV-AUDIT-APPEND, INV-TEN-3

**Acceptance Criteria:**
- Given plan change, when entitlements would be exceeded, then 422 with explanation
- Given plan change, when Stripe call fails, then DB not updated and retry CTA shown
- Given audit log, when PLAN_CHANGED queried, then both SKUs and proration captured

**Test Cases:**
- Unit: Entitlement enforcement: cannot downgrade below current usage
- Integration: Stripe webhook reflects plan change
- Integration: Entitlement cache invalidated after plan change
- E2E: Change plan; verify firm admin can no longer exceed new caps
- Security: Operator without billing.manage → 403
- A11y: Proration preview is announced via aria-live


### UC-OP-09: Manage Per-Tenant Entitlements and Feature Flags
**Actor:** Platform Operator | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Operator authenticated with platform.config permission
- Tenant exists

**Main Flow:**
1. 1. Operator opens tenant > Entitlements tab
2. 2. UI lists feature flags with default values from plan SKU and per-tenant overrides
3. 3. Operator toggles individual flag (e.g., 't2_module_enabled', 'ai_processing_priority_lane', 'beta_dashboard')
4. 4. UI shows preview: 'This will enable X for all users of this tenant on next page load'
5. 5. Operator confirms
6. 6. Backend: upsert tenant_feature_flags row, invalidate cache, publish flag change event
7. 7. Audit log: FEATURE_FLAG_CHANGED with flag_key, prior_value, new_value
8. 8. Optionally schedule revert at future date

**Alternate Flows:**
- Toggle flag for all tenants (global) → handled in UC-OP-10
- Flag dependent on another flag: UI shows dependency, requires parent first
- Operator cancels: no change

**Edge Cases:**
- Toggle during active user session: changes apply on next request, not mid-request
- Flag SDK unreachable: fail safe to plan defaults, alert ops
- Stale cache after toggle: pub-sub invalidation across nodes
- Boolean vs JSON-typed flags: schema validates type
- Flag with prerequisite plan SKU: cannot enable if plan doesn't include
- Feature flag rapid toggle: rate limit at 10/min per tenant

**Invariants Enforced:** INV-ENT-CAPS, INV-AUDIT-APPEND, INV-TEN-3

**Acceptance Criteria:**
- Given flag toggled, when firm user makes next request, then new flag value evaluated
- Given flag requires higher plan, when toggle attempted, then 422
- Given audit log, when flag change queried, then prior and new values present

**Test Cases:**
- Unit: Flag evaluator returns plan default when no tenant override
- Integration: Cache invalidation propagates across NestJS nodes in < 5s
- E2E: Toggle flag; firm user sees new feature on refresh
- Security: Operator without config permission → 403
- A11y: Toggles labeled; state changes announced


### UC-OP-10: Manage Global Platform Feature Flags
**Actor:** Platform Operator (Senior) | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Operator authenticated with platform.global_config permission
- Flag exists in catalog

**Main Flow:**
1. 1. Operator navigates to /admin/feature-flags
2. 2. Table lists all flags with current global default, rollout %, and override count per tenant
3. 3. Operator selects flag, clicks 'Edit global'
4. 4. Modal: set default value, optional percentage rollout (0-100%), targeting rules (e.g., plan_sku='pro')
5. 5. Preview shows N tenants affected
6. 6. Operator confirms
7. 7. Backend: update platform_feature_flags, publish event, recompute eval cache
8. 8. Audit log: GLOBAL_FLAG_CHANGED
9. 9. Optional: notify tenant admins via email if flag is user-visible

**Alternate Flows:**
- Kill switch: emergency disable bypasses targeting and disables for all tenants instantly
- Schedule future activation: store activation_at; cron applies at time
- Rollback to previous value: one-click from history

**Edge Cases:**
- Percentage rollout with sticky hashing: tenant always gets same bucket
- Targeting rule conflict (multiple rules match): defined priority order
- Flag deletion: prevent if any tenant override exists
- Eval cache TTL during high-traffic: short TTL with pub-sub invalidation
- Concurrent edits: optimistic lock on flag.version

**Invariants Enforced:** INV-AUDIT-APPEND, INV-TEN-3

**Acceptance Criteria:**
- Given 50% rollout, when 100 tenants evaluate, then ~50 see new value with sticky hash
- Given kill switch, when activated, then flag disables for all within 60s
- Given audit log, when flag history viewed, then full timeline with operators present

**Test Cases:**
- Unit: Sticky hash is deterministic per tenant_id
- Unit: Targeting rule evaluator handles AND/OR composition
- Integration: Cache invalidation across nodes < 60s
- E2E: Rollout 25% → verify approx population gets flag
- Security: Non-senior operator → 403 on global flag write


### UC-OP-11: Invite First Firm Admin for a Tenant
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Tenant created (status='active' or 'trial')
- No firm admin user exists yet (or operator re-invites)
- Operator has tenant.invite_admin permission

**Main Flow:**
1. 1. Operator on tenant detail page sees 'First admin: pending' or 'not invited'
2. 2. Operator clicks 'Invite first firm admin'
3. 3. Form: email, full name, optional role notes
4. 4. Operator submits
5. 5. Backend: create user record with role='firm_admin', status='pending', generate single-use invite token (24h expiry), enqueue email with magic link
6. 6. Email sent: 'Welcome to ProBooks, your firm portal is ready. Activate within 24h'
7. 7. Audit log: FIRM_ADMIN_INVITED
8. 8. UI updates: 'Invited at HH:MM; expires in 24h' with Resend button

**Alternate Flows:**
- Resend invite: invalidate prior token, issue new one, log RESENT event
- Invite second/third firm admin: separate flow handled by firm admin themselves (out of scope)
- Email bounces (hard bounce): mark invite failed; operator alerted to update email
- Invite expired: operator can resend; old token rejected

**Edge Cases:**
- Email already used in another tenant: allowed (one user can be admin in many firms), separate user_tenant_role record
- Token replay after acceptance: single-use; second use → 410
- User clicks link after revocation: 410 with explanation
- Operator deletes tenant after invite sent but before acceptance: link returns 410
- International domain email (IDN): normalize to punycode for storage
- Email service outage: queue with retry; operator sees 'pending send' indicator
- Operator re-invites within seconds: rate limit 1/min per email

**Invariants Enforced:** INV-AUDIT-APPEND, INV-SEC-AUTH, INV-TEN-ISO, INV-TEN-3

**Acceptance Criteria:**
- Given invite sent, when link clicked < 24h, then admin can complete signup
- Given invite token used once, when retried, then 410
- Given audit log, when FIRM_ADMIN_INVITED queried, then operator + tenant + email captured

**Test Cases:**
- Unit: Token expiry exactly 24h; timezone-safe
- Integration: Email queue dispatches; bounce handler updates user status
- E2E: Operator invites → admin signs up → reaches firm workspace
- Security: Token rotation on resend; old token invalid
- Security: Operator cannot read invite token from API (only included in email link)
- A11y: Resend button has clear label and announces success


### UC-OP-12: Search, Filter, and Sort Tenants
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator authenticated
- At least one tenant exists

**Main Flow:**
1. 1. Operator on dashboard tenant table
2. 2. Operator types in global search box (firm name, business number, primary email, tenant_id)
3. 3. System debounces 300ms, executes server-side search with prefix + fuzzy match
4. 4. Operator applies filters: status (active/suspended/trial/deleted), plan SKU, region, created date range, MRR range
5. 5. Operator clicks column header to sort (firm name, MRR, last-active, created-at)
6. 6. URL updates with query params for shareable view
7. 7. Results paginate at 50 rows/page; Cmd/Ctrl+K opens command palette for quick jump

**Alternate Flows:**
- Saved searches: operator saves filter set as named view
- Export filtered list to CSV (metadata only, no financial data)
- Empty result: show 'No tenants match' with 'Clear filters' CTA

**Edge Cases:**
- Search input with SQL-injection-like chars: parameterized query, no risk
- Very long search query (>500 chars): trim, warn user
- Multiple filters with empty result: distinguish 'no match' from 'no data'
- Sort by MRR with nulls: nulls last consistently
- Pagination cursor invalidated by concurrent insertion: re-fetch on conflict
- Date range with timezone: pin to UTC, show in operator TZ
- Browser back/forward: restore filter state from URL
- Search auto-cancel on new keystroke (AbortController)

**Invariants Enforced:** INV-TEN-3, INV-TEN-ISO

**Acceptance Criteria:**
- Given search term, when typed, then results update within 500ms
- Given filters applied, when URL shared, then same view loads for another operator
- Given no results, when filters clear, then full list returns
- Given CSV export, when downloaded, then no financial data fields present

**Test Cases:**
- Unit: Filter composition: AND across categories
- Unit: CSV exporter whitelist of metadata-only fields
- Integration: Search latency p95 < 500ms with 10k tenants
- E2E: Apply filter, reload page from URL, verify state
- Security: Search query cannot bypass tenant_id scoping (N/A here, operator sees all)
- A11y: Sortable columns announce ascending/descending state via aria-sort
- A11y: Filter chips have remove buttons with clear labels


### UC-OP-13: View Tenant Support Metadata (no financial data)
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator authenticated
- Tenant exists

**Main Flow:**
1. 1. Operator opens tenant detail page
2. 2. UI loads sections: Identity (legal name, business number, created date), Subscription (plan, MRR, next billing date), Region/Compliance (ca-central-1, PIPEDA ack), Users (counts only: # firm admins, # accountants, # clients, # active sessions), Activity (last login by any user, period counts by status — aggregate only), Storage (GB used, breakdown by category), Support tickets linked
3. 3. NO firm data visible: no client names, transaction amounts, period numbers, document contents
4. 4. Backend enforces: queries restricted to tenant_metadata schema; firm-side queries denied by RLS at row level even for operator

**Alternate Flows:**
- Support escalation mode: 'Request data access' button creates time-limited audit-logged elevated session requiring firm admin co-sign (out of MVP, P2)
- Operator clicks 'View as firm admin' — DENIED at all times; button not rendered

**Edge Cases:**
- Tenant with zero users: show 'No users' with invite CTA
- Tenant with high storage (>10GB): warn and link to capacity planning
- Tenant in deleted state: show audit-log only view
- Stale aggregate cache: show 'Updated X min ago' badge
- Failed metadata fetch: graceful degradation per section

**Invariants Enforced:** INV-TEN-3, INV-TEN-ISO, INV-AUDIT-APPEND

**Acceptance Criteria:**
- Given operator views tenant, when any API queried, then no rows from financial tables returned
- Given operator attempts /api/tenants/:id/transactions, when called, then 403
- Given audit log of operator activity, when reviewed, then no read access to financial data ever logged

**Test Cases:**
- Unit: Metadata DTO whitelist excludes all financial fields
- Integration: Backend rejects any operator JWT attempting financial table queries (RLS + policy guard)
- Integration: Aggregate counts computed via separate read-only views with no PII columns
- E2E: Open tenant page; verify no firm data visible in DOM or network responses
- Security: Penetration test: confirm operator cannot escalate to firm data via any endpoint
- Security: Audit log shows operator reads as 'metadata only'; spot-check 100 random sessions
- A11y: Section headings use proper hierarchy; cards have aria-label


### UC-OP-14: Manage Platform Operator Users (CRUD + Roles)
**Actor:** Platform Operator (Senior/Owner) | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator authenticated with platform.user_admin permission
- Target operator exists or is being invited

**Main Flow:**
1. 1. Operator navigates to /admin/operators
2. 2. Table lists all operators: name, email, role (Owner/Senior/Standard/ReadOnly/Support), MFA status, last login, status
3. 3. Operator clicks 'Invite operator'
4. 4. Form: email, name, role, optional notes
5. 5. Backend creates pending operator + sends invite (similar to firm admin invite but platform-scoped)
6. 6. Operator can: edit role (within same/lower privilege), reset MFA, suspend, delete (with confirmation)
7. 7. Audit log: PLATFORM_OPERATOR_* events

**Alternate Flows:**
- Role downgrade: requires re-confirmation
- Self-edit: operator can edit own profile (name, MFA) but not role
- Delete self: blocked
- Last Owner role: blocked from deletion or downgrade (always 1+ owner)

**Edge Cases:**
- Concurrent role change by two operators: optimistic lock
- Operator with active session whose role is downgraded: re-evaluate permissions on next request
- Email domain restriction (only @nugen.com or configured): validation rejects others
- MFA reset triggered: existing MFA invalidated, user must re-enroll on next login
- Suspended operator session: terminated within 60s
- Audit log of operator deletion: retained indefinitely (compliance)

**Invariants Enforced:** INV-SEC-AUTH, INV-AUDIT-APPEND, INV-PLATFORM-LAST-OWNER

**Acceptance Criteria:**
- Given last Owner, when deletion attempted, then 422 with 'must have at least one Owner'
- Given role change, when audit log queried, then prior + new role present
- Given operator suspended, when next API call, then 401 with session terminated

**Test Cases:**
- Unit: Last-Owner check prevents downgrade
- Integration: Role change invalidates JWT permission cache
- E2E: Invite → accept → login → permissions enforced
- Security: Privilege escalation attempt (Standard → Owner) blocked
- A11y: Operator table sortable; actions in row labeled by operator name


### UC-OP-15: Query and Export Platform Audit Log
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator authenticated with audit.read permission
- Audit log has events

**Main Flow:**
1. 1. Operator navigates to /admin/audit-log
2. 2. UI shows events with filters: event type, actor (operator email), tenant_id, date range, IP, success/failure
3. 3. Operator applies filters; results paginate at 100/page
4. 4. Each row expandable to show full event payload (sanitized — no financial data)
5. 5. Operator clicks 'Export' → choose CSV or JSON, max 100k rows per export
6. 6. Backend streams export; audit log records EXPORT_AUDIT_LOG event with filter snapshot
7. 7. Export download includes filter metadata in header

**Alternate Flows:**
- Search by free text in event details (only on metadata, never on financial payloads)
- Saved filter views
- Real-time tail mode: poll every 5s for new events

**Edge Cases:**
- Very large export (>100k): require multiple chunks or schedule async job with email link
- Export with date range spanning DST: convert to UTC server-side
- Audit log entries for deleted tenants: still queryable
- Pagination cursor stable across new insertions (use immutable cursor like (timestamp, id))
- Operator with limited tenant visibility (scoped role): filter results accordingly
- Malformed JSON in old events: render as raw text, do not crash UI

**Invariants Enforced:** INV-AUDIT-APPEND, INV-AUDIT-IMMUT, INV-TEN-3

**Acceptance Criteria:**
- Given query, when executed, then results returned without any financial data leakage
- Given export, when triggered, then EXPORT event itself logged
- Given filter, when shared via URL, then same view reproduces
- Given audit row, when attempted to modify via any API, then 405 Method Not Allowed

**Test Cases:**
- Unit: DTO sanitizer strips financial fields from event payloads
- Integration: Audit log is append-only; UPDATE/DELETE blocked at DB level
- Integration: Export streaming handles 100k rows without OOM
- E2E: Apply filter, export CSV, validate row count and absence of sensitive fields
- Security: Operator without audit.read → 403
- Security: Tampering attempt on audit row via direct SQL → blocked by trigger/policy
- A11y: Audit table with row-detail expansion is keyboard-accessible


### UC-OP-16: Monitor Platform Observability Dashboard
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator authenticated with observability.read permission
- Telemetry pipeline ingesting metrics

**Main Flow:**
1. 1. Operator navigates to /admin/observability
2. 2. Dashboard shows widgets: API uptime (24h, 7d, 30d), p50/p95/p99 latency by endpoint, error rate by service, AI processing queue depth and wait time, Bull queue health (active/waiting/delayed/failed), DB connection pool, Redis memory, S3 ca-central-1 status, residency check status
3. 3. Each widget time-bucketed; operator can change range (1h, 24h, 7d, 30d)
4. 4. Click widget → drill-down to per-tenant breakdown (aggregate only, no financial data)
5. 5. Set alert rules: threshold-based, route to PagerDuty/Slack
6. 6. View incident timeline (recent and active)

**Alternate Flows:**
- Realtime mode: WebSocket push for live metrics
- Custom dashboard: operator pins widgets to personal view
- Compare across regions: N/A at MVP (single region)

**Edge Cases:**
- Telemetry pipeline backlog: show 'metrics delayed Xm' banner
- Clock drift between operator browser and server: display server time
- Widget data point gap: render as null, not zero
- Alert storm: deduplicate by fingerprint
- Dashboard load on cold cache: progressive rendering; spinners per widget
- Stale cached metrics > 5min: refresh badge prominent

**Invariants Enforced:** INV-TEN-3, INV-OBSV-AGG-ONLY

**Acceptance Criteria:**
- Given dashboard, when loaded, then no per-transaction or financial data shown
- Given threshold breach, when crossed, then alert fires within 60s
- Given drill-down per tenant, when expanded, then only aggregate counters shown

**Test Cases:**
- Unit: Metric aggregator excludes PII dimensions
- Integration: Alert rule evaluator with synthetic spike triggers PagerDuty
- E2E: Load observability dashboard; verify all widgets render within 4s
- Security: Drill-down endpoints do not return raw rows
- A11y: Charts have textual data summaries (sr-only) for screen readers
- A11y: Color-coded statuses also use icons + text


### UC-OP-17: Manage Queue Health and Failed Job Recovery
**Actor:** Platform Operator | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Operator authenticated with ops.queue permission
- Bull/BullMQ queue running

**Main Flow:**
1. 1. Operator navigates to /admin/queues
2. 2. List queues: ai-processing, email, pdf-generation, webhook-dispatch, periodic-jobs
3. 3. Per queue: counts (waiting/active/completed/failed/delayed), throughput, oldest job age
4. 4. Drill into failed jobs: list with job ID, tenant_id, error message, stack trace (sanitized), retry count
5. 5. Operator actions: retry single, retry all failed, discard, view payload (metadata only)
6. 6. Backend records: JOB_RETRIED / JOB_DISCARDED with operator_id
7. 7. Pause/resume queue at queue level (emergency)

**Alternate Flows:**
- Bulk retry > 1000: schedule async with progress bar
- Discard with reason notes
- Replay completed job (dry-run mode) for debugging

**Edge Cases:**
- Job payload containing financial data: sanitized in UI (show structure, not values)
- Retry of idempotent vs non-idempotent jobs: warn before retry of non-idempotent
- Queue paused: in-flight job completes; no new jobs
- Redis disconnection: show error banner, disable actions
- Concurrent retry by two operators: lock per job_id
- Stack trace with sensitive paths: redact

**Invariants Enforced:** INV-TEN-3, INV-AUDIT-APPEND, INV-JOB-IDEMPOTENT

**Acceptance Criteria:**
- Given failed job, when retried, then audit log records retry with operator
- Given queue paused, when new event enqueued, then waits; when resumed, processes
- Given payload viewer, when opened, then financial values redacted

**Test Cases:**
- Unit: Sanitizer redacts $values, account numbers, etc.
- Integration: Retry mechanism honors max retries; doesn't loop infinitely
- E2E: Discard 5 failed jobs; verify audit + queue count decrement
- Security: Operator without ops.queue → 403


### UC-OP-18: Run and Review Data Residency Compliance Checks
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator authenticated with compliance.read permission
- Residency validators configured for ca-central-1

**Main Flow:**
1. 1. Operator navigates to /admin/compliance
2. 2. Dashboard shows: PIPEDA acknowledgment counts, data residency check results (RDS region, S3 bucket regions, Redis, OpenSearch), last full audit run timestamp
3. 3. Operator clicks 'Run full residency check'
4. 4. Backend enumerates all data stores, validates region tags, reports any out-of-region resources
5. 5. Report shows green/red per resource; failures include resource ARN and recommended action
6. 6. Operator can export PDF/CSV for compliance evidence
7. 7. Audit log: COMPLIANCE_CHECK_RUN, COMPLIANCE_CHECK_FAILED (if any)

**Alternate Flows:**
- Scheduled daily auto-check (cron); operator views latest result
- Alert routing: failures auto-notify compliance team via email/PagerDuty
- Per-tenant compliance status: confirm each tenant's data is in ca-central-1

**Edge Cases:**
- Brief AWS API rate limit during scan: retry with backoff
- New resource type not yet covered: report as 'unverified' rather than green
- Resource in transit between regions (rare): mark as transitional
- Audit report on holiday: still runs, no business-hour assumption
- Operator role lacks AWS-side IAM mirror: validator returns 'cannot inspect' for some resources

**Invariants Enforced:** INV-RES-CA, INV-AUDIT-APPEND, INV-TEN-3

**Acceptance Criteria:**
- Given check run, when any resource not in ca-central-1, then RED status + alert
- Given report, when exported, then includes evidence per resource
- Given audit log, when residency events queried, then full history present

**Test Cases:**
- Unit: Region matcher validates ARN region segment
- Integration: Synthetic out-of-region resource triggers RED
- E2E: Operator runs scan; report downloadable as PDF
- Security: Compliance read does not require financial data access


### UC-OP-19: View SLA Dashboard and Generate SLA Reports per Tenant
**Actor:** Platform Operator | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Operator authenticated with sla.read permission
- Uptime/error telemetry collected

**Main Flow:**
1. 1. Operator navigates to /admin/sla
2. 2. Dashboard shows platform-wide SLA: monthly uptime %, error budget burn rate, incident count, MTTR
3. 3. Per-tenant SLA: select tenant from dropdown
4. 4. Shows: contractual SLA target (e.g., 99.9%), actual uptime, credit owed (if breached)
5. 5. Operator generates SLA report (PDF) for billing/customer ops
6. 6. Report covers selected period; aggregate uptime only (no financial data)

**Alternate Flows:**
- Bulk report generation: select multiple tenants → zip download
- Schedule monthly SLA report email to each Firm Admin (configurable)

**Edge Cases:**
- Tenant created mid-month: prorate SLA period
- Incident affecting subset of tenants: ensure accurate per-tenant attribution
- Suspended tenant during incident: exclude from SLA calc during suspension
- Clock skew between monitoring sources: use authoritative time source

**Invariants Enforced:** INV-TEN-3, INV-OBSV-AGG-ONLY

**Acceptance Criteria:**
- Given SLA report, when generated, then matches authoritative uptime data
- Given suspended tenant period, when calculating SLA, then excluded from denominator

**Test Cases:**
- Unit: SLA percentage calc handles partial periods
- Integration: PDF generation deterministic given same inputs
- E2E: Operator generates report; verify PDF opens and content correct


### UC-OP-20: Capacity Planning and Multi-Tenant Cost Attribution View
**Actor:** Platform Operator | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Operator authenticated with capacity.read permission
- AWS Cost Explorer + per-tenant usage telemetry available

**Main Flow:**
1. 1. Operator navigates to /admin/capacity
2. 2. Dashboard shows: total infra spend MTD, breakdown by service (RDS, S3, EC2/ECS, Bedrock/OpenAI, CloudWatch), forecast for end-of-month
3. 3. Per-tenant attribution: storage GB, AI tokens consumed, DB rows, queue jobs run, egress
4. 4. Cost-per-tenant computed via tagging + usage weighting
5. 5. Operator sees top-10 tenants by cost vs MRR (margin view)
6. 6. Drill into specific tenant: usage trends, cost over time
7. 7. Export CSV for finance team

**Alternate Flows:**
- Forecast scenario: 'if traffic +20%, projected cost = $X' (rough model)
- Alert when tenant cost exceeds plan revenue (margin breach)

**Edge Cases:**
- Tag mismatch in AWS resources: surface as 'unattributed'
- AI token usage spike from one tenant: highlight
- Cost data delayed up to 24h from AWS: show 'as of' timestamp
- Newly provisioned tenant: zero cost first hours, show as 'collecting'

**Invariants Enforced:** INV-TEN-3, INV-OBSV-AGG-ONLY

**Acceptance Criteria:**
- Given attribution view, when displayed, then sum of per-tenant cost ≈ total AWS bill (within 5% reconciliation tolerance)
- Given tenant exceeding revenue margin, when threshold crossed, then alert generated

**Test Cases:**
- Unit: Usage-weighted cost allocation algorithm correct
- Integration: Cost Explorer API integration with mock data
- E2E: Drill into tenant; verify costs match telemetry export


### UC-OP-21: Incident Response: Declare, Manage, and Close an Incident
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator authenticated with incident.manage permission
- Incident management module enabled

**Main Flow:**
1. 1. Operator clicks 'Declare incident' in nav
2. 2. Form: severity (SEV1-SEV4), title, affected services, affected tenants (multi-select or all), description, status (investigating/identified/monitoring/resolved)
3. 3. Operator submits → incident created with public-facing statuspage update toggle
4. 4. Backend creates incident, posts to status page if toggled, notifies on-call rotation
5. 5. Timeline page: append updates, ETA, root cause notes
6. 6. Affected tenants flagged for SLA calc adjustment
7. 7. Operator marks resolved; postmortem template created
8. 8. Audit log: INCIDENT_DECLARED, INCIDENT_UPDATED, INCIDENT_RESOLVED

**Alternate Flows:**
- Auto-incident creation from threshold breach (UC-OP-16): pre-populate fields
- Link multiple incidents (parent/child)
- Cancel false-positive incident with reason

**Edge Cases:**
- Status page update fails: retry but do not block incident creation
- Concurrent incidents affecting same tenant: both tracked
- Tenant subset selection: support filter by region/plan
- Time zone in updates: store UTC, display per viewer TZ
- Postmortem draft saved but never published: nudge after 7 days

**Invariants Enforced:** INV-AUDIT-APPEND, INV-TEN-3

**Acceptance Criteria:**
- Given incident declared SEV1, when on-call paged, then PagerDuty alert within 30s
- Given tenants flagged affected, when SLA calc runs, then their uptime adjusted
- Given resolved incident, when audit log queried, then full timeline immutable

**Test Cases:**
- Unit: Severity-based notification routing matrix
- Integration: Status page API integration mock
- E2E: Declare → update → resolve; verify all audit events


### UC-OP-22: Generate Compliance Reports (PIPEDA, SOC2-ready)
**Actor:** Platform Operator (Compliance) | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Operator authenticated with compliance.report permission
- Audit log + residency + access logs available

**Main Flow:**
1. 1. Operator navigates to /admin/compliance/reports
2. 2. Select report type: PIPEDA evidence pack, Access review (operator activity), Data retention report, Encryption status
3. 3. Select date range, tenant scope (all or subset)
4. 4. System gathers evidence from audit log, residency checks, IAM, KMS, backup logs
5. 5. PDF + raw evidence ZIP generated
6. 6. Operator downloads; download event audit-logged
7. 7. Report includes signature page with operator name + timestamp

**Alternate Flows:**
- Schedule quarterly auto-generation and store in compliance vault
- Share report via expiring signed URL to external auditor

**Edge Cases:**
- Large date range causing huge report: warn, suggest split
- Missing evidence for a control: mark 'evidence missing' and flag for review
- Concurrent generation: dedupe by user+range
- Time zone in report: standardize to UTC with note

**Invariants Enforced:** INV-RES-CA, INV-AUDIT-APPEND, INV-AUDIT-IMMUT, INV-TEN-3

**Acceptance Criteria:**
- Given report generated, when content reviewed, then no financial data included
- Given audit log, when report download queried, then linked to operator and timestamp

**Test Cases:**
- Unit: Evidence collector queries only audit + IAM + residency, never financial tables
- Integration: PDF rendered deterministically with embedded hash for tamper detection
- E2E: Generate PIPEDA pack; verify all sections populated


### UC-OP-23: Bulk Operations on Tenants (suspend/resume/notify)
**Actor:** Platform Operator (Senior) | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Operator authenticated with tenant.bulk_ops permission
- Multiple tenants selected

**Main Flow:**
1. 1. Operator on tenant dashboard, applies filter (e.g., plan='trial' AND last_active < 30d)
2. 2. Operator clicks 'Select all matching' (with count preview)
3. 3. Bulk action menu: notify (broadcast email), suspend, change plan, apply feature flag
4. 4. Operator chooses action, fills required fields, confirms total count and reason
5. 5. Two-factor inline: re-enter MFA for destructive bulk action
6. 6. Backend creates bulk job with job_id; processes asynchronously with progress
7. 7. UI polls progress; operator can view detail (succeeded/failed list)
8. 8. Audit log: per-tenant action records linked to bulk_job_id

**Alternate Flows:**
- Dry-run mode: simulate without execution, show what would happen
- Cancel in-progress bulk job: stops new actions, completed ones remain

**Edge Cases:**
- Selected tenant becomes ineligible mid-job (e.g., already suspended): skip, log
- Bulk job exceeds 10k items: split into batches
- Partial failure (50 succeed, 10 fail): provide retry-failed-only option
- Operator session expires mid-job: job continues server-side
- Concurrent bulk jobs by different operators: queue and process serially per tenant

**Invariants Enforced:** INV-TEN-LIFECYCLE, INV-AUDIT-APPEND, INV-TEN-3

**Acceptance Criteria:**
- Given bulk suspend of 100 tenants, when job completes, then 100 audit events present
- Given partial failure, when retry-failed clicked, then only failed subset reprocessed
- Given dry-run, when executed, then no state changes

**Test Cases:**
- Unit: Bulk job state machine with progress events
- Integration: Idempotency on retry of bulk job
- E2E: Bulk suspend 10 tenants; verify all 10 inaccessible to firm users
- Security: Bulk job permission re-evaluated per item if operator role changes mid-job
- A11y: Progress announced via aria-live polite


### UC-OP-24: Configure Plan/SKU Catalog and Entitlements Schema
**Actor:** Platform Operator (Owner) | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Operator authenticated with catalog.manage permission

**Main Flow:**
1. 1. Operator navigates to /admin/catalog/plans
2. 2. Table lists SKUs: name, code, MRR, included entitlements (client cap, accountant cap, storage cap, feature flag defaults), active/deprecated
3. 3. Operator creates new SKU: form for all fields + entitlement matrix + Stripe price ID
4. 4. Operator can deprecate SKU (prevents new assignments; existing tenants unaffected)
5. 5. Backend validates and persists; audit log: PLAN_SKU_CREATED/UPDATED
6. 6. Entitlement changes apply to new tenants only; existing tenants on that SKU keep grandfathered terms unless force-migrate flag set

**Alternate Flows:**
- Force-migrate: bulk update existing tenants on this SKU to new entitlements (separate confirmation)
- Duplicate SKU to create variant

**Edge Cases:**
- Deprecation with tenants still subscribed: warn but allow
- Stripe price ID validation: ping Stripe API
- Concurrent edits to same SKU: optimistic lock
- Negative or zero caps: reject

**Invariants Enforced:** INV-ENT-CAPS, INV-BILL-AUDIT, INV-AUDIT-APPEND

**Acceptance Criteria:**
- Given new SKU, when tenant assigned, then entitlements applied immediately
- Given deprecated SKU, when operator tries to assign, then 422

**Test Cases:**
- Unit: Entitlement matrix validation (non-negative, sensible defaults)
- Integration: Stripe price validation API call
- E2E: Create SKU → assign to new tenant → verify caps enforced


### UC-OP-25: Session Expiry and Idle Timeout Handling
**Actor:** Platform Operator | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Operator has active session

**Main Flow:**
1. 1. Operator active in Admin Console
2. 2. Idle timer starts on no input/network activity
3. 3. At 25 minutes idle: warning modal 'Session expiring in 5 minutes. Stay logged in?'
4. 4. Operator clicks 'Stay' → refresh token used to extend
5. 5. If no action by 30 min: hard logout, redirect to login with reason banner
6. 6. JWT max lifetime 15 min; refresh max 8 hr; absolute max session 12 hr
7. 7. Audit log: SESSION_EXTENDED, SESSION_EXPIRED

**Alternate Flows:**
- Operator on long-running export: heartbeat keeps session alive
- Multi-tab: extend in one tab refreshes others via storage event

**Edge Cases:**
- User submits action exactly at expiry boundary: re-issue + retry once
- Refresh token revoked server-side (e.g., role change): force logout immediately
- Browser put to sleep: on wake, verify session validity before resuming
- Cross-origin iframe attack on logout: CSRF protection on logout endpoint
- Time zone change mid-session (laptop traveling): server-side time authoritative

**Invariants Enforced:** INV-SEC-AUTH, INV-AUDIT-APPEND

**Acceptance Criteria:**
- Given idle 30 min, when operator returns, then login required
- Given session extended, when audit log queried, then SESSION_EXTENDED event present
- Given role revoked mid-session, when next API call, then force logout

**Test Cases:**
- Unit: Idle timer pauses on activity
- Integration: Refresh token rotation works across tabs
- E2E: Wait 30 min idle, verify logout
- Security: Replay of old JWT after refresh → rejected
- A11y: Expiry warning modal traps focus and announces remaining time


## Firm Admin / Partner (web)

### UC-FA-01: Complete First-Time Firm Onboarding Wizard
**Actor:** Firm Admin / Partner (first login after Platform Operator provisioning) | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Tenant has been provisioned by Platform Operator with status=active
- Firm Admin has received invitation email with one-time magic link
- User authenticates via SSO/email and lands on /workspace for the first time
- No accountants, clients, templates, or branding configured yet

**Main Flow:**
1. 1. Firm Admin clicks magic link, completes MFA setup (TOTP enrolment mandatory)
2. 2. System detects firmConfigComplete=false and renders the multi-step onboarding wizard with progress bar (Branding → Defaults → Templates → Invite Team → Invite First Client)
3. 3. Admin uploads firm logo (PNG/SVG ≤ 2MB), picks primary/secondary brand colors (color picker enforces WCAG AA contrast against white)
4. 4. Admin reviews default config: auto-prompt thresholds, extra-prompt cap=2, confidence override=97.5%, line-number sub-labels=ON, soft-tone prompt copy
5. 5. Admin selects starter checklist template (Standard HST Quarterly) and confirms or chooses 'Start blank'
6. 6. Admin invites at least one accountant (email + role=accountant) — POST /firm/accountants/invite
7. 7. Admin optionally invites first client OR chooses 'Skip — invite later'
8. 8. Backend persists each step atomically; on final 'Finish', firmConfigComplete=true and audit log entry CONFIG_INIT_COMPLETE is written
9. 9. Wizard closes; admin lands on empty Firm Dashboard with contextual 'Next steps' cards

**Alternate Flows:**
- If logo upload fails virus scan, show inline error and block progression on that step only
- If admin closes the browser mid-wizard, on next login the wizard resumes at last completed step (state persisted server-side)
- If admin chooses 'Skip — invite later', firmConfigComplete still becomes true but a persistent banner appears: 'Invite your first accountant'
- If MFA enrolment fails 3 times, account is temporarily locked and Platform Operator is notified via internal ticket

**Edge Cases:**
- Logo file is a polyglot PNG/HTML — rejected by content sniffer not extension
- Color picker returns hex with alpha channel (#RRGGBBAA) — stripped to 6-digit hex
- Admin clicks 'Finish' while invite API is still in flight — button disabled with spinner; idempotency key prevents double-insert
- Browser language is fr-CA — wizard renders in French, retains bilingual labels
- Concurrent admin login on second device sees wizard already in progress on first device with read-only notice
- User refreshes page mid-step — form fields restored from server-saved draft
- Session expires during wizard — re-auth prompt overlay, draft preserved

**Invariants Enforced:** INV-TEN-1 (every row scoped to tenant_id), INV-AUD-1 (audit log entry on config completion), INV-SEC-1 (MFA mandatory for firm admin role), INV-CFG-1 (default thresholds and cap applied if not customized)

**Acceptance Criteria:**
- Given a freshly provisioned tenant, when Firm Admin completes all 5 wizard steps, then firmConfigComplete=true and a CONFIG_INIT_COMPLETE audit row exists
- Given the wizard is in progress, when the browser is refreshed, then the user resumes at the last completed step with no data loss
- Given an invalid logo file (executable disguised as PNG), when uploaded, then a 415 error is returned and no file is persisted
- Given MFA is not enrolled, when admin attempts to skip MFA step, then progression is blocked with explanatory error

**Test Cases:**
- Unit: WizardStateMachine reducer transitions only forward on valid step completion
- Integration: POST /onboarding/step/{n} persists partial state and returns next step descriptor
- E2E (Playwright): full wizard happy path completes in <90s, audit log assertion via test API
- Security: upload polyglot file, MIME sniff rejects; CSP forbids inline scripts in logo SVG
- Accessibility: full wizard keyboard navigable, axe-core 0 violations, focus trapped per step, ARIA live regions announce step changes
- Performance: wizard initial paint < 1.5s on cold start (95th percentile)
- Negative: skip-required-fields and assert validation messages with screen reader announcements


### UC-FA-02: Invite and Manage Accountants with RBAC Role Assignment
**Actor:** Firm Admin / Partner | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Firm Admin authenticated with MFA on /workspace/team
- Firm has available accountant seats within current plan entitlement
- Target email is not already a member of this tenant

**Main Flow:**
1. 1. Admin navigates Team → 'Invite Accountant', enters email, full name, and role (Accountant | Firm Admin)
2. 2. UI validates email format, checks plan seat availability via GET /firm/entitlements
3. 3. Admin clicks 'Send invite' → POST /firm/team/invite with idempotency-key header
4. 4. Backend creates pending user record, generates signed magic link (24h TTL), sends email via SES
5. 5. Audit log entry TEAM_INVITED written with inviter, invitee, role
6. 6. UI returns to team list showing new row with status=Pending Invitation and 'Resend' / 'Revoke' actions
7. 7. When invitee accepts, status transitions to Active; on first login they complete MFA setup
8. 8. Admin can later edit role (promote Accountant → Firm Admin, or demote) — POST /firm/team/{id}/role with reason text required

**Alternate Flows:**
- If seats exhausted, show modal with 'Upgrade plan' CTA (deep-link to billing) or 'Remove inactive member' option
- If email already exists in another tenant, system creates a cross-tenant identity link (same Cognito sub, separate tenant_user row); no PII leak between tenants
- If invitee link expires, admin can click 'Resend' which generates a new link and invalidates the old one
- If admin tries to demote the only Firm Admin (themselves) — blocked with 'At least one Firm Admin required'
- If admin tries to remove themselves entirely — blocked unless another Firm Admin exists

**Edge Cases:**
- Two admins invite the same email simultaneously — second invite returns 409 Conflict with idempotency key
- Email contains Unicode/IDN domain — normalized to ASCII (Punycode) before persistence
- Invitee email later bounces hard — status flips to 'Email undeliverable' with retry button
- Admin pastes 100 emails into the name field — server-side schema rejects long input
- Plan downgrade reduces seat count below current active accountants — affected users marked read-only, admin sees banner to resolve
- Role-change race: two admins simultaneously edit same accountant — last write wins, but version check returns 409 on stale
- User accepts invite from VPN with different time zone — invitation TTL evaluated server-side in UTC

**Invariants Enforced:** INV-RBAC-1 (role-based authorization at endpoint level), INV-TEN-2 (cross-tenant identity allowed but data strictly partitioned), INV-AUD-1 (audit log entry on every team change), INV-BILL-1 (seat enforcement against plan entitlement)

**Acceptance Criteria:**
- Given seats available, when admin invites accountant, then a pending record is created and email sent within 30s
- Given seats exhausted, when admin tries to invite, then a 402-style modal blocks creation and offers upgrade
- Given an admin demotes a Firm Admin to Accountant, when the demoted user is the only admin, then operation is rejected
- Given a pending invite older than 24h, when invitee clicks link, then they see 'Link expired — request a new one'

**Test Cases:**
- Unit: RoleChangeGuard rejects demotion when last-admin invariant would break
- Integration: invite endpoint enforces seat limit via DB transaction with SELECT FOR UPDATE
- E2E: invite → accept → MFA → access workspace flow including email assertion via mailhog/Mailpit
- Security: magic link tokens are single-use, HMAC-signed, and stored hashed; replay attempt returns 401
- Security: cross-tenant — invited email belonging to another tenant cannot read this tenant's data even with valid session
- Accessibility: invite modal supports Enter to submit, Esc to close, focus return on close
- Performance: team list renders 500 accountants with virtualized table < 200ms
- Negative: invite with invalid email returns 400 with field-level error


### UC-FA-03: Configure Per-Signal Auto-Prompt Thresholds
**Actor:** Firm Admin / Partner | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/settings/feedback-thresholds
- Default thresholds seeded at tenant provisioning
- User has firm_admin role verified server-side

**Main Flow:**
1. 1. Admin opens Feedback Thresholds page; UI lists each operational signal: turnaround_days, flag_reply_lag_hours, low_confidence_pct, corrections_count, re_uploads_count
2. 2. Each signal shows current threshold value, comparator (>= / <=), current firm-wide hit rate (last 90d), and a 'Preview impact' link
3. 3. Admin edits one or more values; client-side validation enforces bounds (e.g., turnaround_days 1–60)
4. 4. UI shows 'Pending change' indicators and live preview: 'Would have triggered X extra prompts in last quarter'
5. 5. Admin clicks 'Save' → PATCH /firm/config/thresholds with full delta + change reason (optional)
6. 6. Backend validates bounds, writes new version row (versioned config table — old values retained), increments config_version
7. 7. Audit log entry THRESHOLDS_UPDATED with before/after JSON written
8. 8. UI confirms save, shows 'Changes apply to periods opened from now on' notice

**Alternate Flows:**
- If admin enters value outside allowed bounds, server returns 422 with field errors; UI highlights
- If concurrent admin already saved newer version, save returns 409; UI offers 'Reload latest' or 'Force overwrite' (force requires re-confirm)
- If admin clicks 'Reset to defaults', a confirm modal shows defaults from plan baseline; reset writes audit entry THRESHOLDS_RESET

**Edge Cases:**
- Admin enters non-integer (e.g., '7.5' days) — rounded down with toast 'Rounded to 7'
- Threshold lowered to 0 — server warns 'will trigger for every period'; requires double-confirm
- Backend save partially fails (one signal valid, one invalid) — atomic transaction rejects entire payload
- Browser-refresh after editing but before saving — unsaved changes warning via beforeunload
- Admin disconnects mid-save — retry on reconnect uses idempotency key to avoid duplicate version row
- Hit-rate preview query times out on large tenants — UI degrades to 'Preview unavailable, save will still work'
- Tenant in different timezone — '90d window' calculated in firm's configured timezone

**Invariants Enforced:** INV-CFG-2 (config is versioned and immutable per version), INV-FB-1 (auto-prompts depend on these thresholds; extra-prompt cap separately enforced), INV-AUD-1, INV-RBAC-1 (only firm_admin can change)

**Acceptance Criteria:**
- Given default thresholds, when admin saves a valid change, then config_version increments and new periods use new thresholds
- Given an invalid value, when admin saves, then 422 is returned and no version row is written
- Given concurrent edits, when admin B saves on stale base, then 409 conflict is raised with merge options

**Test Cases:**
- Unit: ThresholdSchema validation covers bounds, type coercion, null rejection
- Integration: PATCH endpoint with optimistic-concurrency token; assert 409 on stale version
- E2E: change threshold, complete a period, assert auto-prompt triggers per new value
- Security: non-admin user receives 403 on PATCH
- Accessibility: threshold inputs labeled with associated helper text and aria-describedby
- Performance: 'Preview impact' query returns in < 2s for 10k periods
- Audit: assert audit entry contains before/after diff and inviter user id


### UC-FA-04: Set Extra-Prompt Cap for Quarterly Feedback
**Actor:** Firm Admin / Partner | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/settings/feedback-thresholds
- Base 3 ratings (Quality, Service, App) are always required and not editable
- Default cap = 2

**Main Flow:**
1. 1. Admin sets 'Extra prompts cap' slider/numeric input (range 0–5)
2. 2. UI explains: '3 base + up to N auto-prompted = max N+3 questions per feedback'
3. 3. Admin clicks Save → PATCH /firm/config/feedback with cap value
4. 4. Backend validates 0 ≤ cap ≤ 5, writes versioned row, audit log FEEDBACK_CAP_UPDATED
5. 5. Affects future period completions only; in-flight feedback uses cap from when period was completed

**Alternate Flows:**
- If admin sets cap=0, system warns 'Clients will only see 3 base ratings'; allowed but flagged
- If admin sets cap above plan limit (e.g., starter plan capped at 2), 422 with upgrade CTA

**Edge Cases:**
- Admin enters decimal — rejected by integer schema
- Admin enters negative — rejected client- and server-side
- Cap changed mid-quarter — already-complete periods retain their cap snapshot; new completes use new cap
- Plan downgrade lowers cap mid-cycle — alert banner, but stored value capped at plan max on read

**Invariants Enforced:** INV-FB-2 (feedback question count = 3 + signal-triggered prompts ≤ cap), INV-CFG-2, INV-AUD-1

**Acceptance Criteria:**
- Given cap=2 and 4 signals breached, when client opens feedback, then only 2 auto-prompts shown plus 3 base = 5 total
- Given cap=0, when client opens feedback, then exactly 3 base questions shown
- Given plan limit < requested cap, when admin saves, then 422 with explanation

**Test Cases:**
- Unit: cap clamp function clamps to plan max
- Integration: ratings render in client portal respect saved cap
- E2E: change cap, complete period, client opens feedback, assert prompt count
- Audit: cap change recorded with old/new values
- Security: 403 for non-admin


### UC-FA-05: Edit Soft-Tone Prompt Copy with Tone Enforcement
**Actor:** Firm Admin / Partner | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/settings/prompt-copy
- Default copy seeded for each signal (turnaround, lag, etc.) in English and French

**Main Flow:**
1. 1. Admin selects signal to edit (e.g., 'Turnaround prompt')
2. 2. WYSIWYG editor opens with current copy, char limit (160), and tone-rule reminder
3. 3. Admin types new copy; live linter flags hard tone (exclamation marks, all caps, words like 'unacceptable', 'failure')
4. 4. Admin must edit both EN and FR versions or use 'Auto-translate via DeepL' (then review)
5. 5. Admin clicks Save → POST /firm/config/prompt-copy
6. 6. Backend runs tone classifier (server-side ML or rule-based), rejects if soft-tone score < threshold
7. 7. If accepted, versioned row written, audit log PROMPT_COPY_UPDATED, applies to new feedbacks only

**Alternate Flows:**
- If tone classifier rejects, error message returned with suggested phrasing; admin can iterate
- If admin saves only EN missing FR, save blocked with 'Both languages required'
- If admin clicks 'Reset to default', confirm modal then revert to seed copy

**Edge Cases:**
- Admin pastes copy with HTML/script tags — sanitized server-side via DOMPurify
- Copy contains emoji — allowed but counted against char limit by grapheme count
- RTL test (if Arabic later added) — not in scope but copy field stores Unicode-safe
- Admin uses prohibited token like firm name placeholder — rendered correctly in preview
- Auto-translate API down — graceful fallback 'Auto-translate unavailable, please translate manually'
- Concurrent edits — versioned save with 409 on stale

**Invariants Enforced:** INV-FB-3 (prompt copy is soft-tone; firm cannot weaponize), INV-CFG-2, INV-AUD-1

**Acceptance Criteria:**
- Given copy with all-caps shouting, when saved, then 422 with tone reason
- Given valid copy in EN and FR, when saved, then version increments and clients see new copy
- Given empty FR field, when saved, then validation blocks

**Test Cases:**
- Unit: tone classifier deterministic for known inputs
- Integration: sanitization strips script tags before classifier runs
- E2E: edit copy, trigger feedback in client portal, see new copy
- Security: XSS payload sanitized; CSP blocks inline JS
- Accessibility: editor toolbar buttons reachable by keyboard, aria-labels present
- i18n: French copy renders correctly in fr-CA client portal


### UC-FA-06: Set Industry Benchmarks Used in Reports
**Actor:** Firm Admin / Partner | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/settings/benchmarks
- Industries pre-loaded from NAICS codes

**Main Flow:**
1. 1. Admin selects industry (e.g., 'Restaurants — full service')
2. 2. UI shows benchmark rows: gross_margin_pct, labor_pct_of_revenue, hst_rate, average_turnaround_days, etc., with firm-side editable values and Nugen-provided defaults
3. 3. Admin overrides one or more values within plausible bounds
4. 4. Admin saves → PATCH /firm/config/benchmarks/{industry}
5. 5. Backend validates bounds, writes versioned row, audit log BENCHMARK_UPDATED
6. 6. Benchmarks used in firm-side scorecard and accountant client overview; never shown to clients

**Alternate Flows:**
- If admin reverts to Nugen default, single-click action; audit entry BENCHMARK_RESET
- If admin sets a value clearly out of plausible range (e.g., gross margin > 100%), 422 with reason

**Edge Cases:**
- Industry list updated by Platform Operator mid-edit — UI gracefully reloads list, retains edits
- Admin sets HST rate ≠ provincial actual — warning shown but allowed (audit logs the deviation)
- Decimal precision mismatch (e.g., 33.333%) — stored as numeric(5,2), trailing rounding shown
- Concurrent edits resolved by versioned config

**Invariants Enforced:** INV-RPT-1 (benchmarks never exposed to client portal), INV-CFG-2, INV-AUD-1

**Acceptance Criteria:**
- Given a benchmark override, when accountant views client report, then override applied; client portal still shows no benchmark data
- Given out-of-range value, when saved, then 422

**Test Cases:**
- Unit: bounds validation per benchmark field
- Integration: GET /reports/client/{id} for accountant returns benchmarks; GET for client omits
- E2E: override benchmark, view scorecard, verify
- Security: client API path returns no benchmark fields even if requested via query
- Performance: industry list with 500 benchmarks renders < 300ms with virtualization


### UC-FA-07: Toggle Line-Number Sub-Labels for HST Display
**Actor:** Firm Admin / Partner | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/settings/display
- Default for line-number sub-labels = ON (showing 105/108/109 alongside friendly labels)

**Main Flow:**
1. 1. Admin sees toggle 'Show CRA line numbers (105/108/109) next to HST labels'
2. 2. Admin flips toggle off
3. 3. UI shows preview: client portal would display 'HST collected' instead of 'HST collected (Line 105)'
4. 4. Admin saves → PATCH /firm/config/display.show_hst_line_numbers
5. 5. Versioned config row written, audit log DISPLAY_TOGGLE_UPDATED
6. 6. Setting flows to client portal on next render; accountant portal unaffected (always shows lines)

**Alternate Flows:**
- If admin previously customized labels (future feature) — toggle only affects line-number suffix, not label text

**Edge Cases:**
- Toggle changed while client has portal open — client sees update on next route navigation, not mid-screen
- Toggle changed mid-quarter — applies on next render; PDFs and Excel preserve label format at time of generation

**Invariants Enforced:** INV-HST-1 (HST broken out into 105/108/109 in data layer regardless of display), INV-CFG-2, INV-AUD-1

**Acceptance Criteria:**
- Given toggle off, when client opens current quarter, then labels show without line numbers
- Given toggle off, when accountant opens period, then internal view still shows lines

**Test Cases:**
- Unit: label rendering function respects flag
- Integration: GET /client/period/current returns labels with/without line numbers
- E2E: toggle and verify across both portals
- Security: client cannot bypass to read raw line codes
- Accessibility: toggle has accessible name and current state announced by SR


### UC-FA-08: Set Per-Client Opt-In for Auto-Prompts
**Actor:** Firm Admin / Partner | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/clients/{id}/settings/feedback
- Client exists and has at least one accountant assigned
- Firm-wide auto-prompts are configured

**Main Flow:**
1. 1. Admin opens client settings → Feedback tab
2. 2. UI shows 'Auto-prompts enabled' toggle (default ON inherited from firm) plus per-signal granular toggles when 'Customize' expanded
3. 3. Admin disables auto-prompts entirely OR disables specific signals (e.g., only suppress 'flag_reply_lag' for this client)
4. 4. Admin records a reason (free text, optional but encouraged)
5. 5. Admin saves → PATCH /firm/clients/{id}/config/feedback
6. 6. Versioned client config row written, audit log CLIENT_FEEDBACK_OPTOUT
7. 7. Future feedbacks for this client respect opt-out; base 3 ratings remain

**Alternate Flows:**
- If admin re-enables, reverts to firm defaults; audit entry CLIENT_FEEDBACK_OPTIN
- If client has feedback in flight, opt-out applies to next period not current
- If accountant attempts the change without admin role, blocked with 403

**Edge Cases:**
- Client deleted/archived shortly after — config record retained for audit but inactive
- Concurrent admin and accountant edits — version conflict
- Bulk opt-out across clients handled by separate bulk UC

**Invariants Enforced:** INV-FB-1 (base ratings always required), INV-FB-4 (per-client opt-in overrides firm default), INV-CFG-2, INV-AUD-1

**Acceptance Criteria:**
- Given client opted out, when period completes, then client sees only 3 base ratings
- Given specific signal opted out, when threshold breached, then that signal does not prompt

**Test Cases:**
- Unit: feedback assembly merges firm and client config correctly
- Integration: PATCH endpoint enforces firm_admin role
- E2E: opt out, complete period, client sees correct prompts
- Audit: entry includes specific signals toggled
- Security: 403 for accountant role


### UC-FA-09: Override Confidence Threshold Used to Auto-Raise Flags
**Actor:** Firm Admin / Partner | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/settings/processing
- Default confidence threshold = 97.5%
- Range 80%–99.9%

**Main Flow:**
1. 1. Admin sees current threshold and 'Adjust' control with slider and numeric input
2. 2. Admin reads explainer: 'Transactions below this confidence trigger a yellow system flag for accountant review'
3. 3. Admin moves slider to e.g., 95%; UI shows projected impact (90d retrospective)
4. 4. Admin saves → PATCH /firm/config/processing.confidence_threshold
5. 5. Backend validates range, writes versioned row, audit log CONFIDENCE_THRESHOLD_UPDATED
6. 6. Applies to periods entering processing after save

**Alternate Flows:**
- If threshold set below 90%, warning 'May produce excessive flags' but allowed
- If admin resets to default, single-click revert with audit entry

**Edge Cases:**
- Threshold raised mid-processing — running job uses snapshot value, not new
- Confidence values themselves never shown to client (invariant); only flag color is visible
- Decimal precision (e.g., 97.55%) — stored as numeric(4,2)
- Threshold = 100% — rejected; max 99.9%

**Invariants Enforced:** INV-AI-1 (confidence percentage never visible to client), INV-FLAG-1 (flag color = source, not confidence), INV-CFG-2, INV-AUD-1

**Acceptance Criteria:**
- Given threshold change, when new period processed, then flags raised per new threshold
- Given client portal, when client views flag, then no confidence shown

**Test Cases:**
- Unit: flag-raise predicate uses correct threshold
- Integration: processing job snapshots threshold at start
- E2E: change threshold, run processing on fixture, count flags
- Security: client API never returns confidence field; serializer test
- Audit: change tracked with before/after


### UC-FA-10: Manage Firm-Wide Document Checklist Templates
**Actor:** Firm Admin / Partner | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/settings/checklists
- Template library has at least one starter template

**Main Flow:**
1. 1. Admin sees list of templates with name, description, item count, # of clients using it, last modified
2. 2. Admin clicks 'New template' → form for name, description, item rows (label, required toggle, expected count, document type)
3. 3. Admin saves → POST /firm/checklist-templates with version=1
4. 4. Admin can clone, edit (creates new version), archive, or delete (only if not in use)
5. 5. On edit, UI shows 'X clients use this template — changes apply to new periods, not in-flight'
6. 6. Audit log CHECKLIST_TEMPLATE_CREATED/UPDATED/ARCHIVED

**Alternate Flows:**
- If admin tries to delete in-use template, blocked with list of clients; offers archive instead
- If admin edits a versioned template, system writes new version row and bumps version counter
- If admin sets duplicate item labels in same template, validation blocks

**Edge Cases:**
- Template with 0 items — rejected at save
- Reorder via drag-and-drop — position field updated atomically
- Concurrent edits resolved by optimistic concurrency on version
- Imported template from CSV with malformed headers — graceful error per row
- Internationalization: template labels stored as i18n keys with EN/FR pairs
- Template archived while a period is mid-checklist — period retains the snapshot, archive flag hidden in pickers

**Invariants Enforced:** INV-CFG-2 (versioned templates), INV-AUD-1, INV-DOC-1 (period uses snapshot of template at period start)

**Acceptance Criteria:**
- Given template in use, when admin deletes, then 409 with affected clients; archive instead
- Given template edited, when applied to new period, then new items appear; in-flight unchanged
- Given drag-reorder, when saved, then order persists across reloads

**Test Cases:**
- Unit: template version increment on edit
- Integration: CRUD endpoints enforce firm_admin role
- E2E: create template, assign to client, start period, verify checklist matches
- Security: cross-tenant template access blocked
- Accessibility: drag-drop has keyboard alternative (move up/down buttons)
- Performance: 100-item template editor remains responsive < 16ms render budget


### UC-FA-11: Update Firm Branding (Logo, Colors, Display Name)
**Actor:** Firm Admin / Partner | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/settings/branding
- Branding applies to client portal header, emails, and PDFs

**Main Flow:**
1. 1. Admin uploads new logo (PNG, JPG, SVG ≤ 2MB, min 256x256, max 4096x4096)
2. 2. System validates MIME, dimensions, file size, scans for malware
3. 3. Admin picks primary/secondary color via picker; UI enforces WCAG AA contrast
4. 4. Admin updates display name (used in emails 'From' line)
5. 5. Admin previews client portal, login email, and feedback email mocks
6. 6. Admin saves → PATCH /firm/branding (multipart)
7. 7. Logo stored in S3 with tenant-scoped key, CDN cache invalidated
8. 8. Audit log BRANDING_UPDATED with old/new asset references

**Alternate Flows:**
- If color combo fails contrast, save blocked with picker re-opens
- If logo larger than 2MB, client-side rejection before upload
- If admin resets to default Nugen co-branding, single-click revert

**Edge Cases:**
- SVG with embedded scripts — rejected after sanitization
- Logo upload interrupted (network drop) — multipart resumable upload retries
- Color picker emits HSL values — converted to hex on save
- Email From-name with non-ASCII (e.g., 'Société Comptable Pôle Nord') — RFC 2047 encoded
- CDN propagation delay — clients see old logo for up to 60s; emails use new immediately
- Two admins edit branding concurrently — last write wins with optimistic concurrency

**Invariants Enforced:** INV-SEC-2 (uploaded files virus-scanned, MIME-sniffed), INV-A11Y-1 (color contrast WCAG AA), INV-AUD-1

**Acceptance Criteria:**
- Given new logo and colors, when saved, then client portal renders updated branding within 60s
- Given low-contrast colors, when saved, then 422 with contrast violation message

**Test Cases:**
- Unit: contrast checker against WCAG AA formula
- Integration: multipart upload, virus scan stub, S3 put
- E2E: branding flows through to client portal and emails (assert via Mailpit)
- Security: malicious SVG rejected; CSP headers strip inline scripts
- Accessibility: color picker keyboard navigable; uploaded logo gets accessible alt-text field
- Performance: logo upload + CDN invalidation completes < 10s


### UC-FA-12: View and Manage Plan Seat Entitlements
**Actor:** Firm Admin / Partner | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/settings/billing-seats
- Tenant has an active plan (e.g., Starter/Growth/Scale) with entitlement records

**Main Flow:**
1. 1. Admin sees current plan, total seats (accountants), used vs. available, used vs. available client slots
2. 2. UI displays renewal date, plan changes link (read-only, redirects to Platform Operator request flow)
3. 3. Admin can request plan change via 'Request upgrade' button → POST /firm/billing/request with tier
4. 4. Request opens a Platform Operator ticket; admin sees confirmation
5. 5. Admin can deactivate an accountant to free a seat → confirmation modal then DELETE-equivalent (soft delete)
6. 6. Audit log SEAT_FREED with freed user reference

**Alternate Flows:**
- If admin tries to add accountant beyond plan, redirected to request flow
- If accountant currently owns active client work, deactivation blocked until reassignment
- Plan downgrade pending — banner 'Effective on next billing cycle'

**Edge Cases:**
- Plan changed by Operator mid-session — admin's UI auto-refreshes seat counts via WebSocket or polling
- Race: two admins deactivate the same accountant — second returns 409
- Soft-deleted accountant later restored — re-occupies seat if available
- Trial expiry while admin browsing — banner appears, write actions disabled until resolved

**Invariants Enforced:** INV-BILL-1 (seat enforcement), INV-RBAC-1, INV-AUD-1, INV-DATA-1 (no permanent deletes of historical data)

**Acceptance Criteria:**
- Given seats full, when admin invites, then upgrade modal shown
- Given accountant with active clients, when admin deactivates, then blocked until reassignment
- Given plan upgrade request, when submitted, then Operator ticket created and audit entry written

**Test Cases:**
- Unit: seat counter logic with edge of 0/limit
- Integration: deactivation blocked when active assignments exist
- E2E: request upgrade, simulate Operator approval, verify new seat count
- Security: only firm_admin can request plan changes
- Performance: billing page renders < 1s for tenants with 100 seats


### UC-FA-13: View Firm-Side Scorecard (Objective × Subjective)
**Actor:** Firm Admin / Partner | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/scorecard
- At least one completed period with feedback exists
- Operational signals being collected

**Main Flow:**
1. 1. Admin loads scorecard; UI shows tabs: Overview, By Accountant, By Client, By Industry
2. 2. Overview shows aggregate quality/service/app ratings vs. trailing 90d, with mini-trend sparklines
3. 3. Beside each rating, operational signals shown (avg turnaround, avg flag-reply lag, low-confidence rate) with linked correlation
4. 4. Admin can filter by date range, accountant, client tier, industry
5. 5. Admin can drill into a single accountant or client for detailed signal × rating join
6. 6. Admin can export to CSV/PDF (firm-scoped) → POST /firm/scorecard/export

**Alternate Flows:**
- If no feedback yet, empty state with onboarding tips
- If signal data sparse (< 10 periods), correlation flagged as low confidence
- If admin filters to a single client and only 1 period exists, single-period view shown without trend lines

**Edge Cases:**
- Concurrent feedback being submitted while admin views — page does not auto-mutate; refresh icon shown
- Date range crossing DST boundary — corrected via tenant timezone
- Very large exports (> 50k rows) — async generation with email delivery link
- Anonymous-mode feedback (if enabled) — accountant attribution hidden but aggregated
- Browser back/forward across filter states — URL query params restore state

**Invariants Enforced:** INV-RPT-2 (firm-side reports include subjective + objective, both), INV-OPS-1 (operational signals never shown to client), INV-AUD-2 (report exports audit-logged)

**Acceptance Criteria:**
- Given completed periods with feedback, when admin opens scorecard, then aggregate ratings shown with signal joins
- Given filter applied, when admin reloads URL, then state preserved
- Given export, when generated, then file contains both rating and signal columns

**Test Cases:**
- Unit: aggregation pipeline with multiple filters
- Integration: scorecard endpoint enforces tenant scoping via RLS
- E2E: complete a period with feedback, see new data in scorecard within 1m
- Security: client API cannot reach scorecard endpoints (403)
- Accessibility: charts have data-table fallback, keyboard-navigable tooltips
- Performance: scorecard renders < 2s for 5k periods with virtualized rows


### UC-FA-14: Assign Client to Accountant (Initial Assignment)
**Actor:** Firm Admin / Partner | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/clients/{id}/team
- Client exists; at least one accountant active
- No primary accountant currently assigned OR replacing one

**Main Flow:**
1. 1. Admin opens client team tab; UI shows current primary accountant (or 'Unassigned')
2. 2. Admin clicks 'Assign accountant', searches/selects from active accountants
3. 3. Admin optionally adds secondary accountants (read+write but not owner)
4. 4. Admin saves → PATCH /firm/clients/{id}/assignment
5. 5. Backend validates accountant has capacity (configurable max clients per accountant), writes assignment row, audit log CLIENT_ASSIGNED
6. 6. Assigned accountant gets in-app notification; client portal does not see internal assignment

**Alternate Flows:**
- If selected accountant at capacity, warn with override option (requires reason)
- If admin assigns inactive/pending accountant, blocked
- If client already has primary, this triggers Transfer UC instead

**Edge Cases:**
- Two admins assign different accountants simultaneously — version conflict 409
- Accountant deactivated while assignment in flight — assignment rolled back
- Audit captures assignment without leaking accountant PII beyond user id

**Invariants Enforced:** INV-RBAC-2 (only assigned accountants can write to client), INV-AUD-1, INV-CFG-2

**Acceptance Criteria:**
- Given unassigned client, when admin assigns accountant, then accountant gains read+write to that client
- Given non-assigned accountant, when they try to access client, then 403

**Test Cases:**
- Unit: authorization matrix update on assignment
- Integration: assignment endpoint enforces firm_admin role
- E2E: assign accountant, log in as accountant, verify client visible
- Security: prior accountant loses access on re-assignment
- Performance: search across 500 accountants returns < 200ms


### UC-FA-15: Transfer Client Between Accountants
**Actor:** Firm Admin / Partner | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/clients/{id}/team
- Client has a primary accountant assigned
- Target accountant active and within capacity

**Main Flow:**
1. 1. Admin clicks 'Transfer' → modal lists current and new accountant, options 'Transfer now' or 'Schedule transfer at period close'
2. 2. Admin enters reason (required)
3. 3. Admin selects 'Notify both accountants' (default true) and 'Notify client' (default false — invariant)
4. 4. Admin submits → POST /firm/clients/{id}/transfer with idempotency key
5. 5. Backend ensures no period is mid-processing; if so, requires confirmation
6. 6. Assignment changes atomically; previous accountant loses write, gains read-only history; new accountant takes ownership; audit log CLIENT_TRANSFERRED
7. 7. Open flags are reassigned to new accountant; in-app notifications fired

**Alternate Flows:**
- If client period is in 'processing' state, admin must choose 'Wait for processing to complete' or 'Force transfer (will tag flags)'
- If scheduled at period close, transfer queued; cron at period close executes; audit row TRANSFER_SCHEDULED at scheduling time, CLIENT_TRANSFERRED at execution
- If target accountant inactive, transfer rejected

**Edge Cases:**
- Source and target accountant are same — rejected with helpful error
- Concurrent transfers of same client — 409 conflict
- Accountant deactivated between scheduling and execution — scheduled transfer fails gracefully, admin notified
- Period state changes mid-transfer — guarded by state machine check
- Notifications fail to deliver — retried with exponential backoff; transfer not rolled back

**Invariants Enforced:** INV-RBAC-2, INV-LIFE-1 (period state machine guards), INV-AUD-1, INV-CLI-1 (client never sees internal accountant changes)

**Acceptance Criteria:**
- Given completed transfer, when previous accountant tries to write, then 403; read-only history still accessible
- Given scheduled transfer, when period closes, then transfer auto-executes and audit row written
- Given mid-processing period, when admin force-transfers, then warning shown and processing pauses safely

**Test Cases:**
- Unit: transfer state machine handles immediate vs scheduled
- Integration: transfer endpoint locks both accountants and client row
- E2E: full transfer flow with notifications asserted
- Security: client portal never reveals transfer events
- Audit: full chain TRANSFER_INITIATED, TRANSFER_SCHEDULED (if scheduled), CLIENT_TRANSFERRED recorded


### UC-FA-16: View Firm-Wide Reports (Throughput, Aging, Revenue)
**Actor:** Firm Admin / Partner | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/reports
- Tenant has at least 1 period of data

**Main Flow:**
1. 1. Admin loads Reports hub; sees cards: Period throughput, Aging by state, Accountant workload, Client revenue mix, HST owed by period
2. 2. Admin selects a report; report renders with default filters (last 90d, all clients/accountants)
3. 3. Admin adjusts filters; URL updates (deep-linkable)
4. 4. Admin exports CSV/PDF/Excel; export job enqueued
5. 5. Audit log REPORT_VIEWED + REPORT_EXPORTED entries

**Alternate Flows:**
- If admin schedules recurring email report → POST /firm/reports/schedule
- If filter combination returns 0 rows, empty state with suggestion to broaden

**Edge Cases:**
- Very large export (> 100k rows) — async with download link
- DST/timezone in date filters — handled via tenant timezone
- Exporting while data being updated — snapshot at export time
- Cross-tenant isolation: RLS prevents leakage
- User clicks export twice rapidly — second click idempotent

**Invariants Enforced:** INV-RPT-2, INV-AUD-2, INV-TEN-1

**Acceptance Criteria:**
- Given filters set, when report rendered, then deep-link reproduces same view
- Given export, when completed, then file is tenant-scoped and audit row exists

**Test Cases:**
- Unit: aggregation queries tested with snapshot data
- Integration: RLS prevents cross-tenant rows in result
- E2E: filter, export, download, validate contents
- Performance: report renders < 3s for 10k periods with pagination
- Accessibility: charts have data-table fallback


### UC-FA-17: Manage CRA Login Workflow Assistance Integration
**Actor:** Firm Admin / Partner | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/settings/integrations/cra
- Tenant active

**Main Flow:**
1. 1. Admin sees CRA integration card with status (Not configured / Configured / Needs attention)
2. 2. Admin clicks 'Configure'; modal explains: ProBooks does NOT store CRA credentials; it offers guided workflow checklists for staff filing manually
3. 3. Admin selects which CRA accounts the firm files for (HST, T2, payroll) and toggles 'Show CRA assist panel to accountants'
4. 4. Admin saves → PATCH /firm/config/integrations.cra
5. 5. Audit log INTEGRATION_CRA_CONFIGURED
6. 6. Accountant UI now shows CRA-assist sidebar with step-by-step filing checklists

**Alternate Flows:**
- If admin disables, accountant sidebar hidden; existing filings unaffected
- Future: official CRA API integration toggle (P2)

**Edge Cases:**
- Admin attempts to paste CRA credentials in any field — blocked by client-side detector
- Audit log captures who enabled assist, not credentials
- Configuration update during accountant filing — sidebar updates on next route navigation

**Invariants Enforced:** INV-SEC-3 (no CRA credentials stored), INV-AUD-1, INV-CFG-2

**Acceptance Criteria:**
- Given config saved, when accountant opens filing, then assist panel renders
- Given credentials entered, when submitted, then rejected

**Test Cases:**
- Unit: credential-pattern detector
- Integration: config write respects tenant scope
- E2E: configure, verify accountant view
- Security: pen-test confirms no credential pass-through


### UC-FA-18: Configure Accounting Software Export Mappings (QuickBooks/Xero)
**Actor:** Firm Admin / Partner | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/settings/integrations/exports
- Tenant active

**Main Flow:**
1. 1. Admin sees available export formats: QuickBooks IIF/CSV, Xero CSV, generic CSV
2. 2. Admin enables one or more and configures category mapping (e.g., HST line 105 → QB liability account)
3. 3. Admin tests mapping with sample period → preview file rendered
4. 4. Admin saves → PATCH /firm/config/integrations.exports
5. 5. Audit log INTEGRATION_EXPORTS_CONFIGURED
6. 6. Per-client accountant export options now include configured formats

**Alternate Flows:**
- If admin uploads custom mapping CSV, validated against schema
- If mapping incomplete (unmapped categories), warning shown with fallback to 'Uncategorized'

**Edge Cases:**
- Numeric locale (1,234.56 vs 1.234,56) — admin chooses format
- Encoding (UTF-8 vs Windows-1252 for legacy QB) — admin chooses
- Mapping references deleted GL code — flagged in preview
- Concurrent edits resolved by versioned config

**Invariants Enforced:** INV-CFG-2, INV-AUD-1, INV-DATA-2 (HST broken out in exports)

**Acceptance Criteria:**
- Given mapping configured, when accountant exports, then file matches mapping
- Given incomplete mapping, when accountant exports, then 'Uncategorized' applied with audit note

**Test Cases:**
- Unit: mapping resolver function
- Integration: export endpoint uses latest mapping version
- E2E: configure → export client period → import into QB sandbox, verify
- Performance: export of 10k transactions < 5s
- Security: file does not include other tenants' data even in shared services


### UC-FA-19: Set Retention Policies Within CRA Rules
**Actor:** Firm Admin / Partner | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/settings/retention
- Min retention enforced by Nugen platform = CRA 6-year rule
- Max retention 10 years (configurable in plan)

**Main Flow:**
1. 1. Admin sees retention policy: document retention years, audit log retention years, deletion procedure
2. 2. Admin adjusts retention within allowed range (e.g., 7 years)
3. 3. UI shows impact: 'X documents will become eligible for archive in Y months'
4. 4. Admin saves → PATCH /firm/config/retention
5. 5. Backend validates min/max, writes versioned config, audit log RETENTION_UPDATED
6. 6. Background job re-evaluates eligibility nightly

**Alternate Flows:**
- If admin sets below 6 years, server rejects with 'CRA requires 6 years minimum'
- If admin schedules immediate purge of old data, requires double-confirm with typed phrase

**Edge Cases:**
- Filing-related documents are immutable; retention extension affects archive eligibility, not deletion of immutable data
- Plan downgrade reduces max — current setting clamped on read with banner
- Retention change while job mid-run — job rechecks per-row at execution
- Time zone for 'eligibility date' uses tenant's locale

**Invariants Enforced:** INV-RET-1 (CRA minimum 6 years), INV-DATA-1 (no permanent deletes of financial data including attestations), INV-AUD-3 (audit log retention separate from document retention), INV-CFG-2

**Acceptance Criteria:**
- Given retention 5 years requested, when saved, then 422 with CRA explanation
- Given retention 7 years, when saved, then job marks eligible docs for archive after 7 years

**Test Cases:**
- Unit: bounds validation rejects < 6 and > 10
- Integration: nightly job uses latest policy version
- E2E: change policy, simulate time, assert archive eligibility flags
- Security: deletion APIs reject immutable records
- Audit: change captured with before/after


### UC-FA-20: Manage Filed-Return Archive Structure (HST/T2 Grouping)
**Actor:** Firm Admin / Partner | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/settings/archive
- Tenant has filed returns

**Main Flow:**
1. 1. Admin sees default archive grouping (by client → by fiscal year → HST vs T2)
2. 2. Admin can toggle alternative groupings: by year → by client, by accountant → by client, etc.
3. 3. Admin selects display preference for accountant workspace and client portal independently
4. 4. Admin saves → PATCH /firm/config/archive.grouping
5. 5. Audit log ARCHIVE_GROUPING_UPDATED
6. 6. Archive views re-render with new structure on next load

**Alternate Flows:**
- If admin pins specific archive folder ordering, custom ordering saved
- If client portal grouping changed, change applies on next client login

**Edge Cases:**
- Filed PDFs themselves immutable; only display structure changes
- Empty groups hidden by default
- Concurrent edits resolved by versioned config
- Hundreds of historical periods — virtualized list rendering

**Invariants Enforced:** INV-FIL-1 (filed PDFs immutable), INV-FIL-2 (HST and T2 grouped separately), INV-CFG-2, INV-AUD-1

**Acceptance Criteria:**
- Given grouping changed, when accountant opens archive, then new structure shown
- Given filed PDFs, when any restructure, then file URLs and integrity unchanged

**Test Cases:**
- Unit: grouping function with various structure inputs
- Integration: archive list endpoint applies grouping
- E2E: change grouping, verify accountant and client views
- Security: filed PDFs not movable or renameable via this UC
- Performance: 1000-period archive renders < 1s with virtualization


### UC-FA-21: Invite First Client (Onboarding)
**Actor:** Firm Admin / Partner | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/clients/new
- At least one accountant active to assign
- Plan has available client slots

**Main Flow:**
1. 1. Admin clicks 'Add client'; multi-step modal: Basic info → Tax setup → Accountant assignment → Checklist template → Send invite
2. 2. Admin enters legal name, business number, fiscal year-end, filing frequency (monthly/quarterly/annual)
3. 3. Admin specifies HST registration status, T2 filing required toggle
4. 4. Admin assigns primary accountant (and optional secondary)
5. 5. Admin selects document checklist template (firm-wide)
6. 6. Admin enters client owner email and name; optionally checks 'Send invite immediately'
7. 7. Admin reviews summary; clicks 'Create client' → POST /firm/clients
8. 8. Backend creates client record, generates client_owner pending user, assigns accountant, snapshots checklist template, sends invite email
9. 9. Audit log CLIENT_CREATED with all snapshotted config

**Alternate Flows:**
- If admin defers invite, client created without invite; admin can send later
- If plan client slots exhausted, modal blocks with upgrade CTA
- If business number invalid format (CRA BN9 + program ID), validation blocks

**Edge Cases:**
- Duplicate legal name in tenant — warning but allowed (firms may have multiple entities)
- Duplicate BN — rejected as data integrity violation
- Fiscal year-end of Feb 29 — handled by 'last day of February' rule
- Filing frequency change later affects future periods only (separate UC)
- Invite email bounces — status reflects this
- Admin closes modal mid-flow — draft preserved
- Concurrent admin creates same client — idempotency key prevents dupes

**Invariants Enforced:** INV-CLI-2 (client config snapshotted at creation), INV-LIFE-2 (filing frequency set by firm, not client), INV-BILL-1, INV-AUD-1

**Acceptance Criteria:**
- Given valid data, when admin creates client, then record created, invite sent (if checked), audit row written
- Given duplicate BN, when admin submits, then 409 with explanation
- Given slots exhausted, when submit, then upgrade modal

**Test Cases:**
- Unit: BN format validator (BN9 + 2-letter program + 4-digit account)
- Integration: client creation atomic; rollback on any sub-step failure
- E2E: full create → invite → client first login flow
- Security: cross-tenant BN collision allowed (different tenants); intra-tenant blocked
- Audit: snapshot includes template version and accountant id
- Accessibility: multi-step modal keyboard navigable end-to-end


### UC-FA-22: Bulk Operations Across Clients (Assign, Tag, Opt-Out)
**Actor:** Firm Admin / Partner | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/clients with list view
- Multiple clients exist

**Main Flow:**
1. 1. Admin filters/searches/sorts client list
2. 2. Admin uses select-all-on-page or selects individual rows via checkbox; UI shows count of selected
3. 3. Admin chooses bulk action from menu: Reassign accountant, Apply checklist template, Toggle auto-prompt opt-in, Tag, Archive
4. 4. Confirmation modal shows action summary and affected client count
5. 5. Admin enters reason (required for high-impact actions)
6. 6. Admin confirms → POST /firm/clients/bulk with action + ids + reason + idempotency key
7. 7. Backend processes via background job for > 50 ids; admin sees progress; emits per-client audit entries

**Alternate Flows:**
- If any client in selection cannot accept action (e.g., mid-processing), per-row error returned; partial success allowed
- If admin cancels mid-job, in-flight rows finish, queued rows aborted
- If selection > 1000, hard limit with 'Apply to all matching filter' option using server-side selection

**Edge Cases:**
- Selected client deleted by another admin between select and confirm — skipped with notice
- Network drop mid-confirm — idempotency key prevents duplicate execution
- Reassigning to inactive accountant — rejected for all
- Bulk archive includes client with active period — blocked per-row
- Concurrent bulk jobs by two admins — both succeed but with per-row optimistic concurrency
- Reason field has max 500 chars; > limit truncates client-side with warning
- Selection across paginated results — server-side selection token used to avoid loading all rows

**Invariants Enforced:** INV-AUD-1 (per-client audit entries), INV-CFG-2, INV-LIFE-1

**Acceptance Criteria:**
- Given 100 selected clients, when bulk reassign submitted, then job processes all with per-row audit
- Given partial failures, when job completes, then summary shows successes and failures with reasons
- Given idempotency, when same job retried, then no duplicate effects

**Test Cases:**
- Unit: per-action row processor returns success/error/skipped
- Integration: background job with progress and resumability
- E2E: bulk reassign 50 clients, verify all moved and audited
- Security: bulk operation respects per-client permissions
- Performance: 1000-row bulk completes < 2 minutes
- Accessibility: select-all has accessible state and announcement


### UC-FA-23: Search, Filter, and Sort Clients with Saved Views
**Actor:** Firm Admin / Partner | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/clients
- At least one client exists

**Main Flow:**
1. 1. Admin enters search term (matches name, BN, industry); list filters live with debounce
2. 2. Admin opens filter sidebar: by accountant, by status, by tier, by industry, by next-period date
3. 3. Admin sorts by column (name, last activity, next deadline, MRR)
4. 4. Admin saves current view as named preset → POST /firm/views
5. 5. Saved view becomes selectable; can be shared with team or kept private
6. 6. URL contains query params reflecting filters for deep linking

**Alternate Flows:**
- If admin tries to save view with duplicate name, prompt for overwrite or rename
- If saved view references deleted accountant, view degrades gracefully with notice

**Edge Cases:**
- Search term with SQL special chars or NoSQL injection — parameterized queries only
- Diacritics in search (e.g., 'Société') — Postgres unaccent extension
- Empty result state with reset-filters action
- Sort by column with all nulls — stable ordering with secondary sort
- Large tenant with 10k clients — server-side pagination
- Refresh during typing — debounce cancels in-flight request

**Invariants Enforced:** INV-TEN-1 (search results tenant-scoped via RLS), INV-SEC-4 (parameterized queries)

**Acceptance Criteria:**
- Given filters set, when saved as view, then view restorable from list
- Given URL with query params, when shared with another admin, then loads with same filters
- Given 10k clients, when searching, then results < 300ms p95

**Test Cases:**
- Unit: filter query builder handles all combinations
- Integration: pagination correctness with cursor-based paging
- E2E: save view, reload, assert restored
- Security: SQLi attempt returns no leak
- Performance: 10k-client tenant search benchmark
- Accessibility: filter sidebar focus management, screen-reader-friendly filter chips


### UC-FA-24: View and Search Audit Log
**Actor:** Firm Admin / Partner | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Firm Admin on /workspace/audit-log
- Audit entries exist

**Main Flow:**
1. 1. Admin opens audit log; sees reverse-chronological list with timestamp (tenant TZ), actor, action type, target, summary
2. 2. Admin filters by action type, actor, date range, target client/accountant
3. 3. Admin clicks an entry to expand diff/payload view
4. 4. Admin exports filtered set to CSV → POST /firm/audit/export (export itself audit-logged)
5. 5. Audit log entries are append-only and tamper-evident (hash chain or signed)

**Alternate Flows:**
- If admin attempts to delete or edit an entry, no UI control exists; API rejects
- If admin queries date range > retention, banner explains
- If suspicious activity detected (multiple failed admin actions), banner suggests review

**Edge Cases:**
- Entries from deactivated users — actor name marked '(deactivated)' but id preserved
- Very large export — async with email link
- Time zone display — tenant TZ default, UTC available toggle
- Concurrent admins viewing same range — read-only, no contention
- Backend write while admin views — newer entries appear on refresh, not auto-streamed (avoid PII flicker)

**Invariants Enforced:** INV-AUD-1, INV-AUD-2 (append-only, tamper-evident), INV-DATA-1

**Acceptance Criteria:**
- Given audit entries, when admin filters, then results match action type and range
- Given export, when downloaded, then includes all visible columns and is audit-logged
- Given write attempt to audit row, then API returns 405

**Test Cases:**
- Unit: hash chain verifier
- Integration: write attempts rejected at DB role level
- E2E: trigger actions, verify audit entries appear
- Security: cross-tenant audit entries never visible
- Performance: 100k-entry log filters < 1s with proper indexes
- Accessibility: detail expand has aria-expanded and keyboard control


### UC-FA-25: Handle Permission-Denied and Session-Expired Paths Gracefully
**Actor:** Firm Admin / Partner (and other roles attempting admin actions) | **Priority:** P0 | **Platform:** web

**Preconditions:**
- User has any role lower than firm_admin OR session is expired/expiring

**Main Flow:**
1. 1. User attempts to access admin-only route (e.g., /workspace/settings/team)
2. 2. Frontend route guard checks role from session token; if insufficient, renders 403 page with explanation and 'Request access from your Firm Admin' button
3. 3. If session is expired, redirected to login with returnTo param; on re-auth, returned to original route
4. 4. If MFA challenge required for sensitive action (e.g., transfer client, change retention), inline MFA prompt appears; user completes MFA; action retried
5. 5. Backend always re-verifies role and MFA on each privileged write; never trusts client claims
6. 6. Audit log records denied attempts at backend level (action.denied = true)

**Alternate Flows:**
- If accountant role attempts admin action via direct API call, 403 returned and audit entry written
- If session token tampered, 401 + force logout
- If MFA fails 3 times, lock for 15 minutes; admin notified by email
- If user is firm_admin in another tenant, returning to this tenant requires tenant-switch flow

**Edge Cases:**
- Token nearly expired during long form fill — silent refresh attempted; if fails, modal asks user to re-auth without losing form draft
- Cross-tab logout — broadcast channel forces logout in all tabs
- Cached client-side view shows admin controls briefly before guard runs — controls disabled by default, enabled only after role verified
- Replay attack with stolen token — short-lived access tokens + refresh rotation; revoked token returns 401
- Cookies blocked by browser — fall back to header-based auth; UX warning shown

**Invariants Enforced:** INV-SEC-1 (MFA for firm admin), INV-RBAC-1 (server-side authorization is source of truth), INV-AUD-1 (denied attempts logged), INV-SEC-5 (token lifecycle and revocation)

**Acceptance Criteria:**
- Given accountant role, when accessing admin route, then 403 page shown with no data leak
- Given expired session, when admin clicks save, then re-auth modal shown and form draft preserved
- Given sensitive action, when admin lacks MFA, then MFA prompt inline before save
- Given denied attempt, when audited, then entry exists with actor, intended action, and 'denied' flag

**Test Cases:**
- Unit: role guard hook returns deny for all non-admin roles
- Integration: API endpoints return 403 with structured error
- E2E: accountant logs in, navigates to /settings/team, sees 403
- Security: token replay test, MFA bypass attempts, CSRF protection
- Accessibility: 403 page has main landmark, focus moved to heading, link to support
- Audit: denied attempt produces audit row with original IP and user agent


## Accountant (web)

### UC-AC-01: Log in to Firm Workspace and land on accountant dashboard
**Actor:** Accountant (firm staff) | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Accountant has been invited and accepted invitation; account is active
- Firm tenant is active (not suspended by Platform Operator)
- MFA enrollment completed if firm policy requires it
- User has role=accountant within tenant_id scope

**Main Flow:**
1. Accountant navigates to firm subdomain (e.g., acme.probooks.ca)
2. System routes to login screen with tenant branding
3. Accountant enters email + password
4. Backend validates credentials, enforces MFA if configured
5. Backend issues session JWT scoped to tenant_id + role=accountant
6. Frontend loads dashboard: assigned client list, pending flag inbox count, upcoming deadlines, attention items
7. RLS confirms only this accountant's assigned clients are returned

**Alternate Flows:**
- If credentials invalid, then show generic error (no enumeration) and increment failed-attempt counter
- If account locked after N failed attempts, then show lockout message with reset link
- If tenant is suspended by Platform Operator, then show 'firm subscription suspended, contact admin'
- If user role recently changed to firm_admin, then route to admin landing instead
- If session already exists in another tab, then reuse and refresh dashboard

**Edge Cases:**
- Browser refresh during MFA prompt — restart auth flow, do not partially trust
- Clock skew on TOTP — allow ±30s window
- Tenant suspended mid-session — next API call returns 403 and forces logout
- Accountant has zero assigned clients — render empty-state CTA: 'No clients assigned. Ask your firm admin to assign clients to you.'
- Cross-tenant URL tampering — backend rejects if subdomain tenant_id mismatches JWT tenant_id
- Password autofill triggers double submit — debounce on submit button

**Invariants Enforced:** INV-TENANT-1 (multi-tenant isolation via tenant_id + RLS), INV-RBAC-1 (role=accountant scope), INV-AUDIT-1 (login events written append-only)

**Acceptance Criteria:**
- Given valid credentials, when accountant logs in, then dashboard loads in <2s P95 and shows only assigned clients
- Given suspended tenant, when accountant attempts login, then access is denied with clear message
- Given role=accountant JWT, when API is queried for clients outside assignment, then 403 returned
- Given login event, then audit_log row written with user_id, tenant_id, ip, user_agent, timestamp

**Test Cases:**
- Unit: JWT issuance includes tenant_id + role + assignment scopes
- Integration: RLS policy filters clients table by accountant assignment
- E2E: Login → dashboard renders assigned clients only
- Security: Tampering with subdomain returns 403; brute-force triggers lockout
- Accessibility: Login form labels, focus order, keyboard-only navigation, screen-reader announces errors via aria-live


### UC-AC-02: View and filter client list dashboard with statuses, deadlines, attention items
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Authenticated accountant
- At least zero clients assigned (empty state supported)

**Main Flow:**
1. Accountant lands on dashboard
2. System fetches assigned clients with: current period state, days-to-deadline, open flag count, attention badges (e.g., 'docs locked', 'awaiting client reply', 'low confidence')
3. Accountant filters by state (open/processing/processed/complete/filed/archived), deadline proximity, attention type
4. Accountant sorts by deadline asc, name, last activity
5. Accountant searches by client name, business number, or CRA account
6. Clicking a row navigates to client workspace

**Alternate Flows:**
- If no clients assigned, then show onboarding state with 'Ask admin to assign clients'
- If filter returns zero results, then show 'no matches' with clear-filters button
- If accountant types in search, then debounce 300ms and query server-side

**Edge Cases:**
- Deadline crosses DST boundary — compute in client's CRA-configured timezone (Canada/Eastern default), not browser locale
- Client suspended/archived by firm admin mid-view — row greys out on next refresh
- Very large client list (500+) — paginate or virtualize; do not load all into DOM
- Two browser tabs both open dashboard — last-write-wins on filter state in URL
- Refresh after applying filter — filter persists via URL query params
- Accountant has filter applied and clicks a result — return preserves filter on back nav

**Invariants Enforced:** INV-TENANT-1, INV-RBAC-2 (accountant sees only assigned clients), INV-AUDIT-2 (dashboard views not audited; client open events audited)

**Acceptance Criteria:**
- Given 50 assigned clients, when dashboard loads, then list renders in <1.5s P95
- Given filter=state:processing, when applied, then only processing-period clients shown
- Given accountant queries by business number, then matches return server-side with tenant scope
- Given accountant has no clients assigned, then empty-state CTA is shown

**Test Cases:**
- Unit: Filter builder generates correct SQL predicates
- Integration: Pagination cursor stable across reloads
- E2E: Filter→sort→search→click→navigate→back preserves state
- Security: Accountant from firm A cannot fetch firm B clients by ID manipulation
- Accessibility: Table has caption/aria-label, sortable headers announce sort state, keyboard arrows navigate rows


### UC-AC-03: Create new client with engagement setup (filing frequency, period scheme, checklist customization)
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Authenticated accountant with create_client permission within firm policy
- Firm admin has configured default checklist templates and HST defaults

**Main Flow:**
1. Accountant clicks 'Add Client'
2. Enters legal name, operating name, CRA business number, HST account number, T2 corp number, fiscal year end
3. Selects filing frequency: monthly / quarterly / annual (HST) and T2 year-end
4. System derives period scheme (period start/end dates) from frequency + fiscal year end — accountant CANNOT free-type periods
5. Accountant customizes checklist (start from firm template, add/remove items)
6. Accountant sets per-client opt-ins (e.g., 'show ITC summary on portal', 'enable feedback prompts', benchmark group)
7. Accountant reviews and saves
8. Backend writes client row with tenant_id, generates first period in 'open' state
9. Audit log: client_created event

**Alternate Flows:**
- If business number duplicate within tenant, then block with 'BN already registered to client X'
- If accountant lacks create permission, then 'Add Client' button hidden and API returns 403
- If firm admin has locked certain checklist items as mandatory, then those cannot be removed
- If fiscal year end is today, then first period is current period; else first period is most recent closed period

**Edge Cases:**
- BN format validation (9 digits + RT/RC suffix) — reject malformed
- Fiscal year end Feb 29 in non-leap year — normalize to Feb 28
- Frequency change later requires period scheme migration — handled in separate use case
- Form submitted twice (double-click) — idempotency key prevents duplicate client
- Network failure mid-create — show retry; do not orphan checklist rows
- Concurrent create with same BN by two accountants — DB unique constraint wins, second sees error
- Accountant pastes BN with spaces/hyphens — normalize before validation

**Invariants Enforced:** INV-TENANT-1, INV-PERIOD-1 (period scheme system-derived, not client-selectable), INV-AUDIT-1, INV-CHECKLIST-1 (mandatory items cannot be removed)

**Acceptance Criteria:**
- Given valid client data, when accountant submits, then client + first period created atomically
- Given duplicate BN, when accountant submits, then transaction rolls back and clear error shown
- Given accountant role, when calling client.create API directly without permission, then 403
- Given client created, then audit_log has client_created event with actor + payload diff

**Test Cases:**
- Unit: Period derivation from frequency + FYE for monthly/quarterly/annual
- Unit: BN validator (9+RT/RC)
- Integration: Idempotency key prevents duplicate on retry
- E2E: Create client → first period appears in 'open' state
- Security: Cross-tenant BN visibility — duplicate check scoped to tenant
- Accessibility: Multi-step form with progress, error summary at top, focus management on step change


### UC-AC-04: Invite client owner and optionally client_staff bookkeeper
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Client exists
- Accountant has invite_client_user permission
- Firm config allows client_staff sub-role (configurable)

**Main Flow:**
1. Accountant opens client → 'Users' tab
2. Clicks 'Invite Owner', enters email + full name + optional phone
3. Backend creates pending invite, emails invitation link (signed token, 7-day expiry)
4. If firm allows client_staff, accountant can also 'Invite Bookkeeper' (sub-role=client_staff)
5. Sets bookkeeper permissions (e.g., upload-only vs upload + reply to flags)
6. Sends invite
7. Audit log: client_user_invited

**Alternate Flows:**
- If firm config disables client_staff, then 'Invite Bookkeeper' button hidden
- If email already invited and pending, then offer 'Resend invite' instead of duplicate
- If email belongs to existing client user on another firm, then create separate identity scoped to this tenant (no cross-tenant leakage)
- If invite expires, accountant can revoke + reissue

**Edge Cases:**
- Same email invited as both owner and staff — system enforces one role per client per email
- Bounced email — show bounce status in users table; allow resend
- Client owner already accepted, accountant invites them again — block with 'already a user'
- Concurrent invites by two accountants for same email — DB unique constraint
- Bookkeeper revoked while logged in — next request 401s and forces logout
- Email with international characters (IDN) — normalize per RFC, store original
- Mailbox full / SMTP fail — queue with retry and surface delivery status

**Invariants Enforced:** INV-RBAC-3 (client sub-roles enforced), INV-TENANT-1 (identities scoped per tenant), INV-AUDIT-1

**Acceptance Criteria:**
- Given valid email, when accountant invites owner, then invite email sent and pending row created
- Given firm config disables client_staff, then UI hides the option and API rejects with 403
- Given duplicate active invite, when re-invited, then resend used and no duplicate row
- Given invite token, then signed with HMAC + tenant_id + expiry; reusing expired token fails

**Test Cases:**
- Unit: Token signing + verification
- Integration: Resend reuses existing pending invite
- E2E: Invite → email link → accept → user appears active
- Security: Token tampering rejected; cross-tenant token rejected
- Accessibility: Form field hints, error messaging via aria-describedby


### UC-AC-05: Configure per-client opt-ins and engagement settings
**Actor:** Accountant | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Client exists
- Accountant has manage_client_config permission
- Firm admin's global defaults exist (firm-level toggles)

**Main Flow:**
1. Accountant opens client → 'Settings' tab
2. Toggles per-client opt-ins: show ITC summary on portal, enable feedback prompts, benchmark group assignment, default flag answer required type per checklist item
3. Sets thresholds-override (or inherits from firm defaults)
4. Saves; diff written to audit log with before/after
5. Changes take effect from next period or immediately (clearly labeled)

**Alternate Flows:**
- If firm admin has locked a setting at firm level, then per-client toggle is disabled with tooltip 'locked by firm policy'
- If accountant changes benchmark group mid-period, then notice 'will apply to next period only'
- If accountant lacks permission, then UI read-only and API returns 403

**Edge Cases:**
- Two accountants edit settings concurrently — last-write-wins with optimistic-concurrency version field; second sees 'changed by X, refresh'
- Toggle changes mid-feedback flow — capture current values at feedback render time
- Threshold override out of allowed range — block with validation
- Rapid double-toggle — debounce or use idempotent PATCH

**Invariants Enforced:** INV-CONFIG-1 (firm-locked settings cannot be overridden per-client), INV-AUDIT-1 (config diffs audited)

**Acceptance Criteria:**
- Given firm-locked setting, when accountant tries override via API, then 403
- Given valid toggle change, then version increments and audit row written
- Given concurrent edit, when version mismatches, then 409 with 'stale state' message

**Test Cases:**
- Unit: Setting inheritance resolver (firm default → per-client override)
- Integration: Version-based optimistic concurrency
- E2E: Toggle → save → reflected in next period rendering
- Security: Locked firm settings cannot be bypassed
- Accessibility: Toggle widgets have role=switch with aria-checked


### UC-AC-06: Trigger AI processing for a period (§9.3 handoff boundary)
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Period is in 'open' state
- At least one document uploaded by client
- Accountant has process_period permission
- Client docs not currently being modified (no concurrent upload in progress)

**Main Flow:**
1. Accountant opens client → current period
2. Reviews uploaded documents and checklist coverage
3. Clicks 'Start AI Processing'
4. System shows confirmation: 'Once started, client cannot lock/upload until processing completes. Proceed?'
5. Accountant confirms
6. Backend transitions state open→processing under DB-level guard (state must equal 'open' or 422)
7. Sets aiLocked=true on docs
8. Enqueues processing job (async, idempotent)
9. Audit log: processing_started
10. UI shows in-progress banner with cancel option

**Alternate Flows:**
- If period already in processing, then button disabled with 'processing in progress'
- If no docs uploaded, then warn 'no documents to process' but allow override with confirmation
- If client started uploading mid-click (race), then refuse with 422 'client uploading, retry'
- If accountant cancels mid-process, then job cancellation requested; state reverts to open if no lines persisted yet, else moves to processed-partial

**Edge Cases:**
- Double-click 'Start' — idempotency key dedupes
- Network failure after state transition but before job enqueue — outbox pattern ensures eventual enqueue
- Job timeout (60min) — surface failure, revert to open with error log
- Browser closed mid-trigger — server still completes async job; user sees status on return
- Period reopened after filing (UC-AC-22) — different guard path; this UC for first pass only
- Docs aiLocked but processing job not enqueued (orphan) — reconciliation cron heals

**Invariants Enforced:** INV-PERIOD-2 (state monotonic; guarded transitions), INV-DOC-1 (aiLocked once processing starts), INV-AUDIT-1

**Acceptance Criteria:**
- Given period=open and docs present, when accountant triggers, then state→processing and docs.aiLocked=true atomically
- Given period=processing, when API retried, then 422 or idempotent OK with same job id
- Given client tries upload after aiLocked=true, then 403 with clear message

**Test Cases:**
- Unit: State machine guard reject non-open→processing
- Integration: Outbox enqueues job after commit
- E2E: Trigger → docs locked on client portal in real time
- Security: Accountant from another firm cannot trigger via API tampering
- Performance: 1000 doc period triggers within <3s API response (work is async)


### UC-AC-07: Review extracted ledger lines with confidence colors and corrections
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Period is in 'processing' or 'processed' state with AI output available
- Accountant has review permission

**Main Flow:**
1. Accountant opens period → 'Ledger Review' tab
2. System renders extracted lines grouped by source doc with confidence color (green/yellow/red), HST split (105/108) per line, GL category, vendor
3. Accountant can filter by confidence, category, vendor
4. Accountant clicks a line to view source doc snippet (OCR boxes)
5. Accountant edits/reclassifies a line (category, amount, HST treatment) — each edit recorded as 'correction after first pass' signal silently
6. Saves; audit log records before/after per line

**Alternate Flows:**
- If line marked as duplicate by AI, then offer 'merge' or 'keep both'
- If accountant deletes a line, then soft-delete with reason captured
- If confidence is universally green, accountant can bulk-accept
- If accountant disagrees with HST split, manual override flag captured

**Edge Cases:**
- Very large ledger (5000+ lines) — virtualize table
- Concurrent edit by two accountants — line-level optimistic concurrency
- Edit during processing (state still 'processing') — block until 'processed' or allow with warning
- Browser refresh mid-edit — preserve draft via local storage; warn on navigation away
- Edit a line then period gets reopened/restarted — drafts invalidated with notice
- Confidence % shown to accountant must NOT leak via API/network to client portal

**Invariants Enforced:** INV-SIGNAL-1 (corrections recorded silently), INV-CLIENT-VIS-1 (confidence never sent to client), INV-AUDIT-1

**Acceptance Criteria:**
- Given accountant edits a line, then operational_signals row with type='correction_first_pass' is appended
- Given API response for accountant, then includes confidence; for client, confidence field absent
- Given concurrent edits, when stale, then 409 with diff view

**Test Cases:**
- Unit: Signal recorder on line.update
- Integration: Client-facing serializer strips confidence field
- E2E: Edit line → audit + signal recorded
- Security: Client cannot query accountant ledger view endpoint
- Performance: Virtualized table renders 5000 lines smoothly
- Accessibility: Editable cells reachable via keyboard, ARIA grid pattern


### UC-AC-08: Raise red flag (accountant-sourced) with required answer type
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Period not yet in 'filed' or 'archived' state
- Accountant has raise_flag permission

**Main Flow:**
1. Accountant clicks 'Raise Flag' on a line or at period level
2. Selects flag template or composes custom
3. Specifies required answer type: text, receipt-upload, attestation-not-found, choice
4. Soft-copy + reference to line/doc captured
5. System creates flag with source=accountant (color=red), state=open
6. Notification sent to client portal + email
7. Audit log: flag_raised

**Alternate Flows:**
- If flag duplicates an existing open flag on same line, then warn and offer link instead
- If period is in 'complete' or 'filed' state, then block — must reopen first
- If accountant raises after marking processed, then state stays 'processed' but Gate 1 re-checks (numbers may re-lock if all flags re-open)

**Edge Cases:**
- Flag with required type=receipt-upload but client cannot upload (account suspended) — block raise
- Concurrent raise of same flag — idempotency by (line_id, template_id, accountant_id, minute window)
- Very long copy (>2000 chars) — truncate input with counter
- XSS in soft copy — sanitize on save and on render
- Flag raised then period processing re-triggered — flag remains, attached to new ledger version

**Invariants Enforced:** INV-FLAG-1 (source determines color; red=accountant), INV-GATE-1 (numbers visibility depends on flag count), INV-AUDIT-1

**Acceptance Criteria:**
- Given accountant raises flag, then flag.source=accountant and color=red on both portals
- Given Gate 1 was open, when red flag raised, then numbers re-lock for client
- Given period filed, when raise attempted, then 422 'reopen period first'

**Test Cases:**
- Unit: Color derivation = source (not confidence)
- Integration: Gate 1 recalculation on flag state change
- E2E: Raise flag → client sees red badge + notification
- Security: XSS attempts in copy escaped
- Accessibility: Modal traps focus, escape closes, errors announced


### UC-AC-09: Answer client-deferred flag ('Let my accountant choose')
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Flag exists with client_response='defer'
- Period not filed/archived
- Accountant assigned to this client

**Main Flow:**
1. Accountant sees flag in inbox with badge 'awaiting accountant decision'
2. Opens flag, reviews source line + doc
3. Selects resolution: classify as X, mark not-found, escalate back to client with clarification, etc.
4. If 'classify as X', then line update applied (recorded as correction)
5. If 'not-found', then attestation written (attributed to accountant on behalf, write-once)
6. Flag transitions to 'resolved' with resolver_id=accountant
7. Audit log: flag_resolved_by_accountant

**Alternate Flows:**
- If accountant escalates back, then flag returns to client with new copy, color stays red
- If resolution requires data not yet present (receipt), then accountant cannot fabricate — must escalate or attest not-found

**Edge Cases:**
- Client retracts defer while accountant is resolving — version conflict, 409 with 'client provided answer, review'
- Accountant resolves then immediately undoes — undo creates new audit entry, does not erase prior
- Defer flag on multiple lines — bulk resolve option
- Accountant on PTO — firm admin can reassign queue (separate UC)

**Invariants Enforced:** INV-ATTEST-1 (not-found is write-once, attributed), INV-AUDIT-1, INV-SIGNAL-1 (resolution = correction signal)

**Acceptance Criteria:**
- Given defer flag, when accountant resolves with classification, then line updated + signal recorded + flag closed
- Given not-found resolution by accountant, then attestation row immutable with author=accountant_id
- Given race with client retract, then 409 returned

**Test Cases:**
- Unit: Attestation write-once enforcement at DB
- Integration: Version conflict on simultaneous resolution
- E2E: Defer → accountant resolves → client portal updates
- Security: Cannot edit prior attestation
- Accessibility: Resolution form accessible, radio groups grouped


### UC-AC-10: Reply to client's flag explanation
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Flag exists with at least one client message
- Flag is not in 'resolved' state
- Accountant assigned to client

**Main Flow:**
1. Accountant opens flag thread
2. Sees client explanation + any receipt uploaded
3. Accepts answer (flag→resolved), requests clarification (flag stays open, color stays red), or rejects + raises new sub-flag
4. On accept, applies line correction if needed
5. Audit log: flag_message_added + flag_state_change

**Alternate Flows:**
- If client uploaded receipt, system auto-attached the receipt to transaction (double-write to checklist); accountant verifies
- If accountant rejects with comment, flag remains open, client sees re-prompt
- If accountant marks 'accepted but with adjustment', signal records as correction

**Edge Cases:**
- Client sends another message while accountant is composing reply — banner 'new message, refresh'
- Receipt upload failed but message succeeded — show partial state and prompt re-upload
- Markdown/HTML in client message — render as safe text only
- Flag reply lag signal — captured from raise→first accountant reply per flag (used in scorecard)

**Invariants Enforced:** INV-SIGNAL-2 (flag reply lag recorded silently), INV-AUDIT-1, INV-DOC-2 (receipt double-write transaction + checklist)

**Acceptance Criteria:**
- Given accountant first reply on a flag, then flag_reply_lag signal computed from raise→first_reply
- Given receipt double-write, then both transaction line and checklist count increment atomically
- Given accept, then flag.state='resolved'

**Test Cases:**
- Unit: Reply lag computation
- Integration: Double-write transactional
- E2E: Client reply → accountant accept → flag closed
- Security: XSS sanitization on render
- Accessibility: Thread renders as live region; new messages announced


### UC-AC-11: Mark period processed (compute HST summary, satisfy Gate 1 if flags cleared)
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Period in 'processing' state
- All AI processing jobs finished
- Accountant has process_period permission

**Main Flow:**
1. Accountant reviews ledger and clicks 'Mark Processed'
2. System computes HST summary: line 105 (collected), 108 (ITCs), 109 (net tax)
3. Validates numbers are net of HST
4. Transitions state processing→processed under guard
5. If all flags are closed → Gate 1 opens (client portal shows DRAFT numbers)
6. Audit log: period_processed with computed summary

**Alternate Flows:**
- If open flags remain, then warn 'X open flags, client will not see numbers' — allow proceed
- If HST split missing on any line, block with summary of missing fields
- If number sanity check fails (e.g., 109 ≠ 105 − 108), then 422 with reconciliation diff

**Edge Cases:**
- Concurrent edit by another accountant after Mark Processed clicked but before commit — version conflict
- Currency rounding — penny precision; store cents to avoid float
- Negative HST refund period — sign convention enforced
- Mark Processed clicked twice — idempotent: second call returns 200 with same summary
- Time-zone boundary on period dates — period dates immutable from setup

**Invariants Enforced:** INV-PERIOD-2 (monotonic state), INV-HST-1 (numbers net of HST, 105/108/109 broken out), INV-GATE-1 (Gate 1 condition), INV-AUDIT-1

**Acceptance Criteria:**
- Given valid ledger, when marked processed, then state=processed and HST summary persisted
- Given all flags closed + processed, then Gate 1 open and client portal shows DRAFT badge
- Given line missing HST treatment, then operation blocked with field-level error

**Test Cases:**
- Unit: HST summary computation (positive, negative, zero)
- Integration: Gate 1 transition triggers portal cache invalidation
- E2E: Mark processed → client sees DRAFT numbers (no Excel yet)
- Performance: Summary <500ms for 5000 lines
- Accessibility: Confirm dialog with focus trap


### UC-AC-12: Mark period complete (Gate 2 — explicit manual switch)
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Period in 'processed' state
- All flags closed
- Gate 1 already open (numbers visible to client)
- Accountant has mark_complete permission

**Main Flow:**
1. Accountant clicks 'Mark Complete' (distinct button, with strong confirmation)
2. System verifies preconditions
3. Transitions processed→complete under guard
4. Gate 2 opens: Excel download enabled for client, feedback prompt scheduled
5. Audit log: period_marked_complete with actor_id, timestamp

**Alternate Flows:**
- If open flags exist, then block with list of flag ids
- If processed not yet reached, then button disabled
- If accountant lacks permission, then 403

**Edge Cases:**
- Double-click — idempotent
- Race with concurrent flag-raise — version check rejects mark-complete; banner: 'new flag raised, resolve first'
- Mark complete immediately followed by reopen — both audit entries preserved
- Browser closes mid-confirm — confirmation cookie not stored; user must redo

**Invariants Enforced:** INV-GATE-2 (Gate 2 requires explicit manual switch), INV-PERIOD-2, INV-AUDIT-1

**Acceptance Criteria:**
- Given processed + 0 flags, when accountant clicks Mark Complete, then state=complete and Gate 2 opens
- Given open flag, when API called, then 422 with flag list
- Given API auto-attempt to skip Mark Complete from processed → filed, then 422

**Test Cases:**
- Unit: State guard rejects skip
- Integration: Gate 2 enables Excel + feedback
- E2E: Processed → Mark Complete → client downloads Excel
- Security: No way to bypass via direct API
- Accessibility: Confirmation dialog 'Are you sure?' fully keyboard-navigable


### UC-AC-13: Upload filed-return PDFs (HST and T2 grouped separately) and record filing date
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Period in 'complete' state
- Accountant has file_period permission
- PDF file from CRA / firm tax software available

**Main Flow:**
1. Accountant clicks 'File Return' → upload modal
2. Selects return type: HST or T2 (grouped separately, may upload both or one)
3. Uploads PDF (≤25MB), enters CRA confirmation #, filing date
4. Backend stores file in S3 with KMS encryption, ca-central-1 bucket
5. Marks filing record immutable
6. Transitions complete→filed once both required returns uploaded (or one if firm config)
7. Audit log: return_filed with hash + size + actor

**Alternate Flows:**
- If only HST applicable to client (no T2), then T2 not required
- If file exceeds size limit, then reject with clear error
- If file is not PDF, then reject (MIME + magic bytes check)
- If accountant uploads wrong period's PDF (date inside file ≠ period), warn but allow override with attestation

**Edge Cases:**
- Network interruption mid-upload — resumable upload (multipart)
- Same PDF uploaded twice — hash compare, idempotent
- PDF contains macros or executable — reject by content scan
- Filing date in future — block
- Filing date before period end — warn
- Concurrent upload of HST by two accountants — last writer rejected with 409
- Storage failure after metadata write — outbox + reconciliation

**Invariants Enforced:** INV-FILED-1 (filed returns immutable, never app-generated), INV-PERIOD-2, INV-DATA-RESIDENCY-1 (ca-central-1), INV-AUDIT-1

**Acceptance Criteria:**
- Given valid PDF + confirmation #, when uploaded, then immutable record created with hash
- Given PDF replace attempt, then 403 — cannot overwrite
- Given HST and T2 both required and uploaded, then state→filed

**Test Cases:**
- Unit: MIME + magic byte validation
- Integration: S3 multipart resume
- E2E: Upload HST → upload T2 → state=filed
- Security: Replace attempt blocked; bucket region locked to ca-central-1
- Performance: 25MB upload completes within UX target


### UC-AC-14: Reopen a filed period for post-filing correction (guarded)
**Actor:** Accountant | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Period in 'filed' or 'archived' state
- Accountant has reopen_period permission (often elevated; may require firm admin co-sign)
- Reason captured

**Main Flow:**
1. Accountant clicks 'Reopen Period' on a filed period
2. System prompts for reason (required, audit-grade text)
3. If firm policy requires co-sign, request approval from firm admin (out-of-band notification)
4. Once approved, state filed→reopened (or processed-amended, label per design)
5. Filed return PDF remains immutable; new amendment cycle starts
6. Client portal indicates 'amendment in progress'
7. Audit log: period_reopened with reason + approver

**Alternate Flows:**
- If period archived (post-retention move), reopen requires data restore step
- If amendment then re-filed, original return remains as historical record + amendment as new immutable record
- If accountant lacks permission, then request must be submitted to firm admin

**Edge Cases:**
- Concurrent reopen by two accountants — first wins, second sees 'already reopened'
- Approval timeout — request expires after configurable window
- Reopen while client downloading Excel — Excel of original period remains available; amended period generates new file
- Network loss after state change but before client notification — outbox retries

**Invariants Enforced:** INV-PERIOD-2 (state still monotonic via amendment record, original immutable), INV-FILED-1 (original return immutable), INV-AUDIT-1 (reason + approver recorded)

**Acceptance Criteria:**
- Given filed period, when reopen requested with reason + approval, then amended cycle starts and original PDF remains immutable
- Given no approval, when policy requires, then state unchanged
- Given reopen, then audit log captures reason + approver_id

**Test Cases:**
- Unit: Approval workflow state machine
- Integration: Original return record untouched after amendment
- E2E: Reopen → edit → mark processed → re-mark complete → re-file
- Security: Cannot reopen without permission/approval
- Accessibility: Reason text area with character counter


### UC-AC-15: Manage personal inbox/queue of pending flags across clients
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Authenticated accountant
- At least one open flag assigned to accountant's clients

**Main Flow:**
1. Accountant opens 'My Inbox'
2. Sees list of pending flags across all assigned clients with: client name, period, flag age (lag indicator), required action
3. Sorts by age desc, deadline proximity, priority
4. Clicks flag → opens flag detail in context
5. Marks 'snooze' (optional) with reason

**Alternate Flows:**
- If filter='awaiting my action only', then deferred + new-client-messages shown
- If snoozed, hidden until snooze expires
- If accountant on leave (admin-set), then inbox marked read-only and reassignment surfaced

**Edge Cases:**
- Inbox count out of sync with reality — server is source of truth, polling/SSE updates
- 100+ pending flags — paginate + filter
- Snooze across DST — store as UTC + timezone, render correctly
- Flag client-resolved while accountant viewing — auto-removes with toast

**Invariants Enforced:** INV-RBAC-2 (only own clients), INV-SIGNAL-2 (lag visible), INV-AUDIT-1

**Acceptance Criteria:**
- Given 5 open flags, when inbox loaded, then count=5 and rows visible
- Given snooze, then row hidden until expiry
- Given client resolves flag, then inbox auto-updates within 10s

**Test Cases:**
- Unit: Lag computation, snooze expiry
- Integration: SSE or polling for inbox sync
- E2E: Snooze → wait → re-appears
- Accessibility: Inbox table screen-reader navigable, sortable columns announce


### UC-AC-16: Search across clients, periods, flags, and documents
**Actor:** Accountant | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Authenticated accountant
- Search index populated (Postgres FTS or external)

**Main Flow:**
1. Accountant uses global search bar
2. Types query (client name, BN, vendor in transactions, flag copy text, doc filename)
3. System returns results grouped by type with relevance score
4. Clicking result navigates to context

**Alternate Flows:**
- If query is BN-formatted, then prioritize client matches
- If no results, suggest spelling corrections / similar names
- If accountant types special chars, sanitize and treat as literal

**Edge Cases:**
- SQL injection attempts — parameterized queries
- Search across tenants — must NEVER cross tenant boundary
- Very long query — truncate
- Index lag — show 'recently indexed' note
- Sensitive doc names searchable but content not exposed in snippet to wrong role

**Invariants Enforced:** INV-TENANT-1 (search scoped to tenant + assignment), INV-RBAC-2

**Acceptance Criteria:**
- Given query 'ACME', when searched, then only assigned clients in current tenant matched
- Given query for filed return, then accountant sees only filings on their clients
- Given malicious query, then sanitized without error

**Test Cases:**
- Unit: Query sanitization
- Integration: Tenant + assignment scoping in search
- E2E: Search → result → navigate
- Security: Cross-tenant search attempt blocked
- Performance: <500ms P95 on 10k docs


### UC-AC-17: Export period working files for accountant's own use
**Actor:** Accountant | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Period in 'processed' or later state
- Accountant has export permission

**Main Flow:**
1. Accountant clicks 'Export Working File'
2. Selects format (Excel/CSV) and scope (current period only — system enforces no date picker per invariant)
3. Backend generates file with full ledger including HST split, confidence (accountant-only field), flag history
4. File available for immediate download, signed URL with short TTL

**Alternate Flows:**
- If period in 'processing', then disable with 'wait until processed'
- If file generation queued (large period), then notify when ready

**Edge Cases:**
- File generation crash mid-stream — partial file discarded, regenerate
- TTL expires before download — re-request fresh URL
- Double-click generates two files — idempotency key reuses last 60s
- Export request volume spike — queue with backpressure
- Confidence field in accountant export must remain server-only auth-gated

**Invariants Enforced:** INV-EXPORT-1 (period-scoped, no date picker), INV-CLIENT-VIS-1 (confidence stays accountant-side; client export differs), INV-AUDIT-1 (export event recorded)

**Acceptance Criteria:**
- Given export request, then file generated for that period only
- Given accountant export, then includes confidence column; client export does not
- Given expired URL, then 403

**Test Cases:**
- Unit: Excel writer for HST split correctness
- Integration: Signed URL TTL
- E2E: Export → download → file opens
- Security: Client API cannot fetch accountant export
- Performance: 5000 lines exports in <30s


### UC-AC-18: View operational signals dashboard for own clients (read-only)
**Actor:** Accountant | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Authenticated accountant
- Operational signals recorded over time

**Main Flow:**
1. Accountant opens 'My Performance' tab
2. Sees aggregated signals: turnaround time, flag reply lag, low-confidence %, corrections after first pass, re-uploads, per client and per period
3. Filters by time range, client, period
4. Drill-down shows underlying events

**Alternate Flows:**
- If accountant only sees own metrics (not peers') unless firm admin grants comparison view
- If firm has benchmark group, optionally show anonymized firm-avg

**Edge Cases:**
- No data yet — empty state explanation
- Signal data lag — show 'last updated' timestamp
- Date range crossing DST — UTC compute
- PII not leaked across accountants of same firm unless admin-granted

**Invariants Enforced:** INV-SIGNAL-3 (signals never shown to client), INV-RBAC-2, INV-AUDIT-2 (dashboard views audited at firm admin discretion)

**Acceptance Criteria:**
- Given accountant has 10 closed flags, when dashboard loaded, then median lag computed correctly
- Given client API queries signals endpoint, then 403
- Given firm-level comparison disabled, then peer metrics hidden

**Test Cases:**
- Unit: Median/percentile computations
- Integration: Tenant + role scoping on signal endpoints
- E2E: Dashboard renders charts
- Security: Client cannot reach signal endpoints
- Accessibility: Charts have text/table fallback (sr-only)


### UC-AC-19: Bulk-process multiple clients (batch period actions)
**Actor:** Accountant | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Multiple periods in eligible state (e.g., all 'open' with docs)
- Accountant has bulk_process permission

**Main Flow:**
1. Accountant filters dashboard to 'period state = open, docs uploaded'
2. Multi-selects clients (checkboxes)
3. Chooses bulk action: 'Start Processing' / 'Send reminder' / 'Mark complete' (only valid combinations enabled)
4. Confirmation modal with count and warnings
5. System processes each in parallel (job per period) with idempotency
6. Progress UI with per-client success/fail
7. Audit log: bulk_action with batch_id

**Alternate Flows:**
- If some selected periods are ineligible, then exclude with explanation
- If user cancels mid-batch, completed items stay completed; pending cancelled
- If batch limit exceeded (e.g., 100 max), then chunk or block

**Edge Cases:**
- Partial failures — table shows per-row status with retry
- Browser refresh mid-batch — server-side batch continues; UI reconnects via batch_id
- Duplicate submission — idempotency by batch_id
- Bulk Mark Complete with open flags on some — those skipped with reason

**Invariants Enforced:** INV-PERIOD-2 (per-period guards still enforced), INV-GATE-2 (Mark Complete still requires preconditions), INV-AUDIT-1 (batch + per-item)

**Acceptance Criteria:**
- Given 10 selected periods, when bulk Start Processing, then 10 jobs enqueued and progress tracked
- Given 3 with open flags in bulk Mark Complete, then those 3 skipped with reason 'open flags'
- Given batch_id, when revisited later, then full status visible

**Test Cases:**
- Unit: Eligibility filter per action
- Integration: Batch + per-item audit
- E2E: Bulk → progress → completion
- Security: Bulk action respects per-client permission
- Performance: 100-item batch handled within SLA


### UC-AC-20: Accountant calendar/deadline view across own clients
**Actor:** Accountant | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Authenticated accountant with at least one assigned client

**Main Flow:**
1. Accountant opens 'Calendar' view
2. System renders month/week/day with markers for: period start, processing due, complete-by, filing deadline, T2 year-end milestones
3. Color-coded by urgency
4. Click event opens client/period in context
5. ICS export available

**Alternate Flows:**
- If accountant has 0 clients, show empty state
- If client opts out of calendar visibility (rare), respect it

**Edge Cases:**
- DST transitions in calendar — events anchored to firm-configured timezone
- Multi-day events spanning month boundary — render correctly
- ICS subscription includes auth token — rotate periodically
- Very dense day (10+ events) — collapse with 'see all'
- Holidays / weekend deadlines — render warning indicator

**Invariants Enforced:** INV-TENANT-1, INV-RBAC-2, INV-PERIOD-1 (deadlines derived, not free-typed)

**Acceptance Criteria:**
- Given assigned client with quarterly HST, when calendar loaded, then HST filing deadline rendered for each quarter
- Given ICS export, then file imports into Google/Outlook with correct timezone
- Given client moved to another accountant, then events disappear from this view on next refresh

**Test Cases:**
- Unit: Deadline derivation per CRA rules
- Integration: ICS generation
- E2E: Calendar → click → navigate
- Accessibility: Calendar grid keyboard navigable, ARIA grid pattern
- Performance: 100 clients × 4 events render <2s


### UC-AC-21: Handle session expiry, refresh mid-action, and offline recovery
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Active session that becomes invalid (expiry, revoked, force-logout)

**Main Flow:**
1. Accountant performs action; backend returns 401
2. Frontend intercepts, attempts silent refresh via refresh token
3. If refresh succeeds, retry original action transparently
4. If refresh fails (expired/revoked), redirect to login with 'returnTo' param preserving context
5. After login, return to original screen with saved form state where possible

**Alternate Flows:**
- If action was destructive (e.g., Mark Complete), require re-confirm after re-auth (do not auto-replay)
- If form had unsaved edits, restore from localStorage draft
- If offline, queue read-only actions locally; write actions blocked with banner

**Edge Cases:**
- CSRF token rotated on refresh — frontend must use new token
- Refresh race when multiple tabs trigger — single-flight refresh
- User logs out elsewhere — broadcast channel notifies other tabs
- Force-logout by firm admin (security event) — drafts preserved but flagged 'session terminated for security'
- Long-running upload mid-expiry — chunked upload uses fresh token per chunk

**Invariants Enforced:** INV-AUTH-1 (no silent replay of destructive actions), INV-AUDIT-1 (session events logged)

**Acceptance Criteria:**
- Given token expired, when GET retried, then silent refresh + retry succeeds
- Given destructive POST after re-auth, then user re-confirms
- Given offline, then write blocked with clear banner; reads from cache where safe

**Test Cases:**
- Unit: Single-flight refresh
- Integration: 401 → refresh → retry
- E2E: Tab idle 1h → action triggers reauth → returns to context
- Security: Replay protection on destructive ops
- Accessibility: Re-auth banner uses live region


### UC-AC-22: Permission denial paths and graceful 403 handling
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Accountant attempts an action outside their permissions

**Main Flow:**
1. Accountant clicks a UI element they should not have (e.g., via stale role cache)
2. Backend returns 403 with machine-readable code + human-readable message
3. Frontend shows toast: 'You do not have permission. Contact firm admin.'
4. Permission cache refreshed from server
5. UI re-renders without that action

**Alternate Flows:**
- If permission downgraded mid-session, then on next nav, UI updates and unauthorized routes redirect
- If accountant attempts another tenant's resource via tampered URL, then 404 (not 403) to prevent enumeration
- If accountant lacks permission to view a flag, then it doesn't appear in inbox in the first place

**Edge Cases:**
- Cached UI showing action button after role change — server-side enforcement is source of truth
- Permission inconsistencies between two services (NestJS modules) — central policy engine
- 404 vs 403 distinction — 403 for own tenant, 404 for cross-tenant

**Invariants Enforced:** INV-RBAC-1, INV-RBAC-2, INV-RBAC-3, INV-TENANT-1, INV-AUDIT-1 (denial events logged)

**Acceptance Criteria:**
- Given accountant lacks reopen permission, when API called, then 403 + audit log
- Given cross-tenant access attempt, when API called, then 404
- Given role downgrade, when next request made, then UI updates

**Test Cases:**
- Unit: Policy engine resolves per role
- Integration: 403 audit
- E2E: Click forbidden action → toast + no state change
- Security: Enumeration prevented (404 for cross-tenant)
- Accessibility: Error toast uses role=alert


### UC-AC-23: Onboarding empty states for new accountant
**Actor:** Accountant | **Priority:** P1 | **Platform:** web

**Preconditions:**
- Accountant just accepted invite
- No clients assigned yet OR no periods to act on

**Main Flow:**
1. Accountant first login lands on dashboard
2. Empty state with checklist: 'Wait for firm admin to assign clients' / 'Complete profile' / 'Review training' (if firm has resources)
3. Sidebar items contextual to permissions
4. Hint banner explains workflow

**Alternate Flows:**
- If admin assigns clients during session, real-time SSE updates dashboard with first client
- If accountant completes profile, banner dismisses

**Edge Cases:**
- Empty state for sub-tabs (inbox, calendar, signals) — each tab has tailored empty state
- Profile required fields missing — block sensitive actions until complete
- Dismiss preference persisted per user

**Invariants Enforced:** INV-AUDIT-1 (profile completion logged)

**Acceptance Criteria:**
- Given new accountant, when dashboard loads, then onboarding checklist shown
- Given 0 clients, then 'no clients' empty state has CTA to firm admin
- Given completed checklist, then banner hides

**Test Cases:**
- Unit: Checklist state derivation
- E2E: Onboarding flow
- Accessibility: Empty state uses semantic landmarks; CTAs reachable via keyboard


### UC-AC-24: Audit log inspection (own actions) and observability touchpoints
**Actor:** Accountant | **Priority:** P2 | **Platform:** web

**Preconditions:**
- Authenticated accountant
- Audit entries exist

**Main Flow:**
1. Accountant opens 'My Activity'
2. Sees their own recent actions: flags raised/resolved, periods processed/marked complete, returns uploaded, exports
3. Filters by date, client, action type
4. Drill-down shows before/after diff (for edits)

**Alternate Flows:**
- Firm admin can see all accountants' actions (separate UC); accountant cannot see peers'
- Tamper-evident: log shows hash chain badge

**Edge Cases:**
- Very old entries — server pagination
- Sensitive payload fields (e.g., PII) masked in viewer
- Audit log append-only — no edits/deletes
- Time range crossing year boundary

**Invariants Enforced:** INV-AUDIT-1 (append-only), INV-RBAC-2 (own actions only)

**Acceptance Criteria:**
- Given accountant viewing audit, then only their actions shown
- Given attempt to call peer's audit endpoint, then 403
- Given large date range, then paginated

**Test Cases:**
- Unit: Filter builder
- Integration: Append-only enforcement at DB
- E2E: View → drill → see diff
- Security: Peer audit isolation
- Accessibility: Diff viewer accessible via keyboard


### UC-AC-25: Concurrent multi-user scenarios on same client/period
**Actor:** Accountant | **Priority:** P0 | **Platform:** web

**Preconditions:**
- Two accountants assigned to same client OR firm admin + accountant active simultaneously

**Main Flow:**
1. Accountant A and B both open same period
2. A edits line 42; B sees presence indicator 'A is editing line 42'
3. A saves; B receives realtime update with new value
4. B's draft on same line surfaces merge prompt

**Alternate Flows:**
- If both attempt Mark Processed simultaneously, first wins; second sees 409 with current state
- If accountant and firm admin both edit settings, optimistic concurrency token resolves
- If client uploads doc while accountant in ledger view, banner: 'new doc uploaded, refresh'

**Edge Cases:**
- Presence channel disconnect — fall back to polling
- Many editors (5+) on same screen — presence cap, render avatars only
- Stale tab editing offline then reconnecting — server rejects stale writes via version
- Race between Mark Processed and Raise Flag — Mark Processed blocked if flag raised after process started

**Invariants Enforced:** INV-CONCURRENCY-1 (optimistic locking via version), INV-PERIOD-2 (state guard), INV-AUDIT-1

**Acceptance Criteria:**
- Given two simultaneous edits, then second receives 409 with diff
- Given Mark Processed race, then loser sees 'period already processed'
- Given presence enabled, then editors visible within 2s of activity

**Test Cases:**
- Unit: Version conflict resolver
- Integration: WebSocket/SSE presence channel
- E2E: Two tabs same period → edit conflict → merge UI
- Performance: Presence updates <2s
- Accessibility: Presence avatars have accessible labels


## Client (Owner) (mobile)

### UC-CL-UP-01: Install Client Portal as PWA on mobile device
**Actor:** Client (client_owner) on mobile browser (iOS Safari / Android Chrome) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client has a valid invite link or has logged in once via mobile browser
- Browser supports PWA manifest + service worker (HTTPS origin)
- Tenant active and not suspended

**Main Flow:**
1. 1. Client opens portal URL on mobile browser
2. 2. Browser registers manifest.webmanifest (name, short_name, icons 192/512, theme_color, display: standalone, start_url scoped to tenant subpath)
3. 3. Service worker registers and pre-caches app shell + offline fallback page
4. 4. On second visit (or per OS rules), 'Add to Home Screen' install prompt surfaces via custom in-app banner (beforeinstallprompt on Android; iOS shows Safari share-sheet instruction card)
5. 5. Client taps Install; OS adds icon to home screen with firm branding
6. 6. Launching from icon opens in standalone mode (no browser chrome), authenticated session restored from secure storage
7. 7. Backend records install_event in audit_log with tenant_id, user_id, user_agent, device_class

**Alternate Flows:**
- If iOS: show step-by-step share-sheet visual ('Tap Share → Add to Home Screen'); beforeinstallprompt is unavailable
- If user dismisses install banner: snooze 7 days, do not re-surface within snooze window
- If user already installed (display-mode: standalone detected): hide install CTA entirely

**Edge Cases:**
- Browser without service worker support (in-app webview, e.g., Facebook Messenger browser) → show 'Open in Safari/Chrome' nudge
- Private/Incognito mode → SW registration fails silently, app still works but no offline cache; show subtle 'limited offline' indicator
- Storage quota exceeded → SW install fails, app falls back to online-only
- Manifest icons must include maskable variants for Android adaptive icons
- PWA installed before tenant rebrand — icon stale until reinstall; document this expectation

**Invariants Enforced:** INV-TEN-1 (tenant isolation in start_url and scope), INV-RES-1 (assets served from ca-central-1)

**Acceptance Criteria:**
- Given Android Chrome on second visit, When eligibility criteria met, Then custom install banner appears within 3s of load
- Given iOS Safari, When user opens app, Then iOS install instructions are shown (not Android prompt)
- Given app launched from home screen, When opened, Then it renders without browser URL bar
- Given install completes, Then an audit_log row is written with action='pwa_installed'

**Test Cases:**
- E2E (Playwright + Android emulator): trigger beforeinstallprompt, accept, assert standalone launch
- E2E (iOS WebKit): assert iOS instructional card visible, Android prompt absent
- Unit: manifest validator (icons present at required sizes, scope matches tenant slug)
- Integration: SW pre-cache list includes app shell and offline.html
- A11y: install banner has aria-live='polite', focus trap correct, close button >= 44x44pt
- Security: manifest scope cannot escape tenant subpath (assert no cross-tenant leakage if multi-tenant subdomain reused)


### UC-CL-UP-02: View guided upload checklist for current period
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Authenticated client session
- Active period exists in state open OR processing (banner state depends)
- Firm has configured typed slots for this client (or default template applied)

**Main Flow:**
1. 1. Client opens home tile labeled 'Documents' showing 'X of N uploaded' (server-derived counts)
2. 2. Tap navigates to checklist screen scoped to current period (system-derived from firm-set frequency — client NEVER picks period)
3. 3. UI renders typed slots in two visual groups: 'Received' (green check) and 'Still needed' (gray)
4. 4. A catch-all 'Other documents' drop zone appears at bottom
5. 5. Top banner reflects period state: 'Open — you can add or remove documents' OR 'Processing — uploads locked'
6. 6. Each slot shows: slot label, required/optional badge, last upload timestamp, file count
7. 7. Pull-to-refresh triggers GET /periods/current/checklist with ETag caching

**Alternate Flows:**
- If no current period exists (e.g., between filings): show empty state 'No active period — your accountant will start the next one'
- If period state = processed/complete/filed/archived: checklist becomes read-only with state-appropriate copy
- If client has no slots configured: show only catch-all drop zone with helper text

**Edge Cases:**
- Time zone: 'last upload' rendered in client's device TZ but stored UTC; show TZ abbreviation
- Concurrent: accountant adds new slot mid-session → next refresh reveals it; no destructive merge needed
- Stale cache: ETag mismatch triggers silent re-fetch
- Slow network: skeleton loaders shown for >300ms; never blank
- client_staff sub-role: same view, identical permissions for upload (owner vs staff distinction matters for invites/billing, not upload)

**Invariants Enforced:** INV-PERIOD-1 (client never picks period), INV-TEN-1 (RLS scopes checklist to tenant_id + client_id), INV-GATE-1 (numbers gating; checklist visible regardless)

**Acceptance Criteria:**
- Given active open period, When checklist loads, Then 'X of N' matches sum of received slots
- Given period in processing, Then upload buttons render disabled with banner 'Processing — locked'
- Given no period, Then empty state copy is shown and home tile shows 'No active period'
- Given accountant adds a slot, When client pulls to refresh, Then new slot appears within 1 refresh

**Test Cases:**
- Unit: checklist reducer computes X/N from server payload
- Integration: API returns 200 with slots + counts; RLS denies cross-tenant
- E2E: open period → upload to slot → count increments, slot moves to Received group
- A11y: list uses role='list'; each slot row has accessible name combining label + status
- Performance: checklist with 40 slots renders < 200ms p95 on mid-tier Android
- Security: tampering with period_id in URL returns 403 (cannot view another client's checklist)


### UC-CL-UP-03: Upload document to typed slot via file picker
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Period in state 'open' (not yet aiLocked)
- Slot exists and is not capped
- Client has not been read-only-locked by firm

**Main Flow:**
1. 1. Client taps a 'Still needed' slot
2. 2. Action sheet shows: 'Take Photo', 'Scan Document', 'Choose File', 'Cancel'
3. 3. Client taps 'Choose File'; OS file picker opens with accept filter (PDF, JPG, PNG, HEIC, WEBP)
4. 4. Client selects file; client-side validation runs: size <= 25 MB per file, MIME and magic-bytes match allowlist
5. 5. HEIC files auto-converted client-side to JPEG (libheif-wasm) before upload
6. 6. EXIF GPS + author metadata stripped client-side prior to upload
7. 7. Pre-sign request POST /uploads/presign returns S3 PUT URL scoped to tenant_id/period_id/slot_id
8. 8. Multipart upload to S3 (ca-central-1); progress bar per file
9. 9. On success, POST /uploads/confirm with object key + checksum; server creates document row, links to slot
10. 10. UI moves slot to 'Received', increments 'X of N', updates home tile count

**Alternate Flows:**
- If file > 25 MB: inline error with size; offer 'Take photo instead' shortcut
- If unsupported type: list allowed types; do not start upload
- If presign fails (auth expired): trigger silent re-auth, retry once
- If S3 PUT fails mid-upload: see UC-CL-UP-12 (retry/resume)

**Edge Cases:**
- Same file uploaded twice → server detects by SHA-256, returns existing document_id (idempotent), no duplicate row
- Filename with emojis/unicode → server normalizes to NFC, stores original in metadata
- Browser refresh mid-upload → background queue resumes (UC-CL-UP-13)
- Session expires between presign and PUT → 403 from S3; UI re-auths and re-presigns
- Zero-byte file → rejected client-side with friendly error
- Filename with path traversal characters → server sanitizes; never used as object key directly
- Race: client uploads while accountant transitions to processing → server rejects with 409 'period locked' and surfaces banner

**Invariants Enforced:** INV-DOC-1 (aiLocked — only mutable before processing), INV-TEN-1 (object keys namespaced by tenant_id), INV-AUDIT-1 (upload event appended to audit_log), INV-RES-1 (bucket in ca-central-1)

**Acceptance Criteria:**
- Given open period and HEIC file, When uploaded, Then server receives JPEG with EXIF GPS removed
- Given file > 25 MB, Then upload never starts and error is shown
- Given duplicate SHA-256, Then server returns 200 with existing document id and no new row
- Given upload succeeds, Then home tile and checklist count both reflect new total within 1s

**Test Cases:**
- Unit: HEIC→JPEG conversion produces valid JPEG with EXIF GPS stripped (assert via exiftool)
- Unit: client-side size guard rejects > 25 MB before presign
- Integration: presign returns short-lived URL (<= 15 min), bucket region = ca-central-1
- E2E: pick PDF, see slot transition Received, audit_log row created
- Security: tampering with tenant_id in presign request returns 403
- Security: uploaded EXE renamed .pdf rejected via magic-byte check
- Performance: 10 MB upload completes < 8s on 4G simulated
- A11y: progress bar exposes aria-valuenow; success announced via aria-live


### UC-CL-UP-04: Capture single-page document via camera
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Period in state 'open'
- Browser supports getUserMedia or capture='environment' attribute
- Camera permission granted (or grant flow can run)

**Main Flow:**
1. 1. Client taps slot → 'Take Photo'
2. 2. If permission not granted: in-app primer screen explains why (before triggering OS prompt) — increases grant rate
3. 3. OS camera permission prompt appears; on grant, native camera launches via <input type='file' accept='image/*' capture='environment'>
4. 4. Client captures photo, OS returns image
5. 5. App applies auto-crop + perspective correction (optional client-side, behind feature flag); presents preview with 'Retake' / 'Use Photo'
6. 6. On 'Use Photo': EXIF GPS stripped, JPEG re-encoded at quality 0.85, uploaded as in UC-CL-UP-03 steps 7-10

**Alternate Flows:**
- If permission denied permanently: show 'Open Settings' deep-link instructions per OS
- If permission denied once: show inline rationale and 'Try again' button
- If user cancels in OS camera: return to slot with no state change

**Edge Cases:**
- iOS Safari returns HEIC even from camera capture in some configs → conversion path applies
- Low-light blurry photo → server-side OCR will yield low confidence; no warning to client (per INV — confidence never shown)
- Camera busy (another app holding it) → OS-level error; show retry
- Front camera selected accidentally → user retakes; acceptable
- Device with no camera (rare on mobile) → 'Take Photo' button hidden
- Rapid double-tap on 'Use Photo' → idempotent upload (debounced + SHA-256 dedupe)

**Invariants Enforced:** INV-DOC-1 (aiLocked), INV-PRIV-1 (EXIF GPS stripped before transit), INV-AUDIT-1

**Acceptance Criteria:**
- Given permission not yet asked, When client taps Take Photo, Then primer is shown before OS prompt
- Given photo captured, Then EXIF GPS absent in uploaded object
- Given permission denied, Then helpful recovery instructions are shown

**Test Cases:**
- E2E (mobile device farm): capture photo, assert upload visible in checklist
- Unit: EXIF strip utility removes GPSLatitude/GPSLongitude tags
- Integration: server rejects any object retaining GPS tags (defense in depth)
- A11y: primer screen readable by VoiceOver/TalkBack; buttons >= 44x44pt
- Security: permission primer cannot be skipped to grant elevated access


### UC-CL-UP-05: Scan multi-page document into single PDF
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Period in state 'open'
- Camera permission granted

**Main Flow:**
1. 1. Client taps slot → 'Scan Document'
2. 2. Camera UI opens with overlay 'Page 1 of —'
3. 3. Client captures page 1; thumbnail strip appears at bottom
4. 4. Client taps 'Add Page' to capture page 2, 3, ... up to 20 pages (configurable cap)
5. 5. Thumbnail strip allows drag/long-press reorder, tap to retake, swipe to delete page
6. 6. Client taps 'Done' → app builds multi-page PDF client-side (pdf-lib), each page compressed to <= 200 KB target, total cap 25 MB
7. 7. PDF uploaded via standard presign flow as a single document linked to slot
8. 8. Slot transitions to Received; checklist count increments by 1 (not N pages)

**Alternate Flows:**
- If client closes mid-scan: app offers to save draft scan locally (IndexedDB); resumes on next open within 24h
- If user exceeds 20-page cap: 'Done' enabled; further captures disabled with toast
- If PDF generation fails (memory): fall back to uploading each page as separate JPEG with shared scan_group_id

**Edge Cases:**
- Battery dies mid-scan → draft auto-restored
- Device rotation between captures → orientation normalized in PDF
- Phone in landscape with letterboxed page → cropping logic must not zero-out content
- Reorder while a page is mid-upload (rare since upload is post-Done) → not applicable
- Backgrounding the app for >30 min may evict IndexedDB on iOS → warn user 'don't background for long'
- Memory pressure on low-end devices for 20-page scan → degrade gracefully, suggest split into two scans

**Invariants Enforced:** INV-DOC-1, INV-PRIV-1 (EXIF stripped per page before composition), INV-AUDIT-1

**Acceptance Criteria:**
- Given 5 pages scanned and reordered, When Done, Then uploaded PDF page order matches final thumbnail strip order
- Given mid-scan close, When reopened within 24h, Then draft offered for restore
- Given scan > 20 pages attempted, Then 21st capture is blocked with explanation

**Test Cases:**
- Unit: PDF assembly preserves order from thumbnail array
- Unit: per-page JPEG compression hits target without distorting text legibility (SSIM > 0.95)
- E2E: scan 3 pages, reorder 3→1, upload, download from accountant view, assert order
- Integration: draft persistence in IndexedDB with TTL
- Performance: 10-page scan assembles PDF < 5s on mid-tier Android
- A11y: thumbnail strip navigable by screen reader; reorder operable via long-press + arrow keys on external keyboard


### UC-CL-UP-06: Upload to catch-all 'Other documents' drop zone
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Period 'open'
- Catch-all zone always present on checklist (even with zero slots)

**Main Flow:**
1. 1. Client taps 'Other documents' card
2. 2. Same action sheet as typed slot (Photo / Scan / File)
3. 3. Client selects file(s) — multi-select supported in OS picker
4. 4. Files upload as 'unsorted' documents — no slot linkage
5. 5. Accountant sees them on firm-side under 'Unsorted' for triage; can later reassign to a slot (does not affect client's X/N count for typed slots)
6. 6. UI shows 'Other documents: K uploaded' counter

**Alternate Flows:**
- If client selects 10 files via OS picker: each enqueued; concurrency limited to 3 parallel uploads
- If a file fails: that file retries; others continue

**Edge Cases:**
- Multi-select with one oversized file → oversized file rejected, others proceed; clear per-file feedback
- Mixing photo + PDF in one batch via OS picker (Android) → all processed
- Naming collisions (same filename) → server stores both, distinguishes by checksum

**Invariants Enforced:** INV-DOC-1, INV-TEN-1, INV-AUDIT-1

**Acceptance Criteria:**
- Given 5 mixed files via picker, When uploaded, Then all 5 appear under Other documents with correct counts
- Given oversized file in batch, Then only that file errors; others succeed

**Test Cases:**
- E2E: multi-file selection on Android, all succeed
- Unit: queue limits concurrency to 3
- Integration: 'unsorted' documents not counted in typed-slot X/N
- Security: per-file MIME validation runs independently


### UC-CL-UP-07: Reorder pages within a multi-page document via drag and drop
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Multi-page scan in progress (UC-CL-UP-05) OR uploaded multi-page PDF still in 'open' period and not yet aiLocked

**Main Flow:**
1. 1. Client opens scan composer or document detail
2. 2. Long-press a thumbnail → enters reorder mode with haptic feedback
3. 3. Drag to new position; other thumbnails animate to make space
4. 4. Release to commit; auto-save draft order
5. 5. On final Done/Save, server stores new page order in document version metadata

**Alternate Flows:**
- If post-upload reorder: client must tap 'Save changes' to trigger server re-composition (PDF rebuilt server-side); a new document version row is created
- If accountant has started processing during edit (race): save returns 409 'locked'; UI reverts to last server state

**Edge Cases:**
- Drag to off-screen edge → list auto-scrolls
- Browser refresh mid-reorder → unsaved order discarded; show confirmation modal if dirty when navigating away
- Screen reader users → expose 'move up' / 'move down' alternatives

**Invariants Enforced:** INV-DOC-1 (mutable only before aiLocked)

**Acceptance Criteria:**
- Given reorder + Save before lock, Then accountant sees new order
- Given lock occurs mid-edit, Then save fails with 409 and UI explains state change

**Test Cases:**
- E2E: reorder, save, fetch from accountant view, assert order
- A11y: keyboard/SR users can reorder via alternative controls
- Integration: 409 returned when period.aiLocked=true at save time


### UC-CL-UP-08: Delete uploaded document before AI lock
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Document exists in current period
- Period state = open AND document.aiLocked = false

**Main Flow:**
1. 1. Client taps document → detail sheet shows preview + 'Delete' affordance (only when allowed)
2. 2. Confirm dialog: 'Delete <filename>? This cannot be undone after your accountant starts processing.'
3. 3. On confirm, DELETE /documents/:id with idempotency key
4. 4. Server: verifies aiLocked=false AND period.state=open; soft-deletes document (deleted_at, deleted_by), unlinks from slot
5. 5. Audit log: action='client_delete_document', actor=client_owner
6. 6. Checklist slot reverts to 'Still needed' if it was the only document on that slot; X/N decrements; home tile refreshes

**Alternate Flows:**
- If aiLocked=true: Delete button is hidden; if attempted via stale UI, server returns 409 with copy 'Processing has started — contact your accountant'
- If document is the source of a receipt linked to a transaction via 'receipts uploaded from a flag': deletion is blocked because of double-write coupling; show error directing client to flag UI

**Edge Cases:**
- Race: client taps Delete simultaneously on two devices → first wins, second sees 404/409
- Network failure after server delete but before client confirms → idempotency key ensures retry doesn't re-error; UI re-fetches state
- Soft-deleted file remains in audit/object store per retention (no permanent deletion of financial data per INV)
- Browser back button after delete should reflect updated checklist

**Invariants Enforced:** INV-DOC-1 (delete-before-lock only), INV-AUDIT-1 (append-only audit), INV-RETAIN-1 (no permanent deletes of financial data — soft delete only)

**Acceptance Criteria:**
- Given aiLocked=false, When client deletes, Then document removed from view and X/N decrements
- Given aiLocked=true, Then Delete UI is not present
- Given document tied to flag-receipt, Then delete is blocked with clear reason

**Test Cases:**
- Unit: delete authorization predicate evaluates state correctly
- Integration: 409 returned if aiLocked=true at server boundary
- E2E: upload → delete → assert slot reverts and audit row exists
- Security: cannot delete another client's document (RLS); cannot delete by manipulating id
- Audit: deleted_at and deleted_by populated; soft-delete record retrievable


### UC-CL-UP-09: Observe banner state change from delete-available to processing-locked
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client has checklist screen open while accountant transitions period from open to processing

**Main Flow:**
1. 1. Client viewing checklist; banner reads 'Open — you can add or remove documents'
2. 2. Accountant on firm app triggers processing (period.state → processing, all documents aiLocked=true)
3. 3. Client's app receives push (or polls every 30s); banner re-renders to 'Processing started — uploads locked'
4. 4. Delete affordances hidden across all documents in this period
5. 5. Upload action sheet still openable but submits return 409 with friendly inline copy
6. 6. Home tile copy changes from 'X of N — add documents' to 'Processing — we'll let you know when ready'

**Alternate Flows:**
- If client is offline at moment of transition: on reconnect, state delta fetched and banner updates
- If client navigates away then back: GET checklist returns new state

**Edge Cases:**
- Mid-upload at moment of lock: in-flight upload completes to S3 but POST /uploads/confirm returns 409; client sees graceful 'Locked just now — your file wasn't attached'
- Push token expired → fall back to next poll cycle; max staleness = poll interval
- Banner color/contrast must remain WCAG AA in both states

**Invariants Enforced:** INV-DOC-1, INV-PERIOD-2 (monotonic state transitions)

**Acceptance Criteria:**
- Given accountant locks period, When client app refreshes (push or poll), Then banner reads Processing within <= 30s
- Given in-flight upload, When lock fires, Then upload is not attached and clear copy is shown

**Test Cases:**
- Integration: simulate state transition, assert websocket/push delivers update
- E2E: dual-window test — accountant transitions, client banner updates
- Unit: banner state machine pure function
- A11y: state change announced via aria-live='polite'


### UC-CL-UP-10: Retry upload on poor connectivity
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Upload initiated; network is flaky or drops mid-transfer

**Main Flow:**
1. 1. Multipart upload in progress
2. 2. Network blip → S3 PUT chunk fails with retryable error
3. 3. Client SDK retries with exponential backoff (200ms, 500ms, 1s, 2s, 5s; max 5 attempts)
4. 4. Each chunk retry uses range-based resume (multipart upload IDs persisted in IndexedDB)
5. 5. On success, POST /uploads/confirm completes
6. 6. If all retries fail, file moves to 'Failed — tap to retry' state with manual retry button

**Alternate Flows:**
- If 4xx (non-retryable): surface error, do not retry blindly
- If 5xx: exponential backoff with jitter
- If presign URL expired during retry: re-request new presign and resume

**Edge Cases:**
- Switching networks (Wi-Fi → cellular) mid-upload → continue using new connection
- Airplane mode toggled → see UC-CL-UP-13 (offline queue)
- S3 returns SlowDown (503) → respect Retry-After header
- Total upload exceeds session lifetime → re-auth and resume

**Invariants Enforced:** INV-DOC-1, INV-AUDIT-1 (retry attempts logged with attempt count)

**Acceptance Criteria:**
- Given mid-upload network drop, When connection returns within 30s, Then upload resumes from last successful chunk
- Given 5 failed retries, Then UI shows manual retry and does not silently fail

**Test Cases:**
- Integration (Chaos): inject 30% packet loss, assert eventual completion within 3x ideal time
- Unit: exponential backoff schedule correctness
- E2E: toggle network offline/online during upload
- Security: retried PUTs cannot upload to another tenant's path


### UC-CL-UP-11: Queue uploads while offline, sync when online
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- PWA installed or in-browser session with service worker active
- Period 'open'

**Main Flow:**
1. 1. Client offline (no connectivity)
2. 2. Client selects/captures files; app stores file blob + metadata in IndexedDB queue
3. 3. UI shows 'Queued — will upload when online' badge per item; home tile shows 'X uploaded, Y queued'
4. 4. Service worker registers Background Sync (Android Chrome) OR Periodic Sync; iOS falls back to in-app retry when foregrounded
5. 5. On reconnect, SW dequeues and uploads sequentially (with concurrency = 2)
6. 6. As each succeeds, queue entry removed; checklist updates; toast announces 'Uploaded: <filename>'
7. 7. On failure, item stays queued with attempt count

**Alternate Flows:**
- If period locks while items queued (race): on next sync, server rejects with 409; UI moves item to 'Couldn't attach — period closed' bucket with explanation
- If user clears browser data: queued items lost; warn before clearing
- If queue > 100 items or > 500 MB: warn user, do not block but suggest fewer at a time

**Edge Cases:**
- iOS lacks Background Sync API → uploads only resume on next foregrounding; document this limitation
- Multi-tab open: only one tab acts as sync leader (Web Locks API or BroadcastChannel coordination)
- Storage quota exceeded → reject new queue items with friendly error
- Encrypted at rest in IndexedDB? Use Web Crypto to wrap file bytes with session-derived key for sensitive content (defense in depth)
- Battery saver mode may suppress SW — fall back to foreground sync

**Invariants Enforced:** INV-DOC-1 (server still enforces lock; queue cannot bypass), INV-TEN-1 (queue entries tagged with tenant_id and rejected if user logs out/in to different tenant), INV-RES-1 (uploads only to ca-central-1 endpoints)

**Acceptance Criteria:**
- Given offline capture, When connectivity restored, Then queued items upload without user action (Android) or on next foreground (iOS)
- Given period locks while queued, Then queued items are not silently lost — user is informed
- Given user logs out, Then queue is purged

**Test Cases:**
- E2E (Android emulator): toggle offline, capture 3 files, go online, assert all uploaded
- Unit: queue persistence/restore from IndexedDB
- Integration: BroadcastChannel ensures only one tab uploads
- Security: queued blobs not accessible to other origins; encrypted at rest
- Performance: 50-item queue drains < 90s on 4G


### UC-CL-UP-12: Resume background upload after foregrounding the PWA
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Upload in progress when app is backgrounded or device sleeps

**Main Flow:**
1. 1. Client starts upload; backgrounds the app (lock screen, switch app, etc.)
2. 2. iOS suspends JS quickly; Android may keep running briefly
3. 3. On foreground, app reads multipart upload state from IndexedDB
4. 4. UI shows 'Resuming upload...' for in-flight item
5. 5. Multipart PUTs continue from last completed part
6. 6. On completion, confirm and update checklist

**Alternate Flows:**
- If multipart upload ID expired server-side (S3 default 7 days, but firm may set shorter): restart from scratch
- If foreground occurs after period locked: item moved to failed-attach bucket

**Edge Cases:**
- App killed by OS for memory → state restored on relaunch
- User force-quits → next launch resumes
- Multipart minimum part size = 5 MB; final part can be smaller; handle correctly

**Invariants Enforced:** INV-DOC-1, INV-AUDIT-1

**Acceptance Criteria:**
- Given backgrounding mid-upload, When app re-foregrounded within multipart TTL, Then upload resumes without duplicating completed parts

**Test Cases:**
- E2E: start 30 MB upload, background app for 30s, return, assert completion
- Unit: multipart part tracking
- Integration: server reconciles parts list before complete-multipart


### UC-CL-UP-13: View 'X of N uploaded' progress tile on home
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Authenticated session, active period exists

**Main Flow:**
1. 1. Client opens home screen
2. 2. Documents tile renders: large number 'X of N', sub-label with period range (e.g., 'Q2 2026 (Apr–Jun)') and state
3. 3. Tile updates reactively via push/poll as documents added/removed
4. 4. Tap navigates to checklist

**Alternate Flows:**
- If no period: tile shows 'No active period'
- If period processed: tile shows 'In review' state
- If period filed/archived: tile collapses to a smaller history entry

**Edge Cases:**
- Numbers must be net counts (excluding soft-deleted, excluding catch-all)
- Internationalization: number formatting locale-aware
- Tile re-render must not jitter while updating (use animation guard)

**Invariants Enforced:** INV-TEN-1, INV-PERIOD-1 (period derived from firm-set frequency)

**Acceptance Criteria:**
- Given 3 typed slots filled out of 8, Then tile reads '3 of 8'
- Given catch-all uploads exist, Then catch-all does not affect '3 of 8' numerator/denominator

**Test Cases:**
- Unit: tile selector pure function
- E2E: upload → home tile increments within 1s
- A11y: tile is a single accessible button with combined label


### UC-CL-UP-14: Handle camera permission denial gracefully
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client taps Take Photo or Scan without prior grant OR denied previously

**Main Flow:**
1. 1. Client taps Take Photo
2. 2. If Permissions API reports 'denied', skip native prompt (it won't show again), and present a 'How to enable camera' screen with OS-specific steps + screenshots
3. 3. Offer 'Choose File' as fallback (gallery upload)
4. 4. Track denial reason; if user grants later via Settings, next tap proceeds normally

**Alternate Flows:**
- If 'prompt' state: show primer first, then trigger OS prompt
- If 'granted': skip primer

**Edge Cases:**
- Browser does not expose Permissions API → infer from failed getUserMedia
- User on private browsing where permission resets each session → primer re-shows
- Permission revoked mid-session → next call fails cleanly

**Invariants Enforced:** INV-PRIV-2 (least-privilege permissions)

**Acceptance Criteria:**
- Given permission denied permanently, Then app shows enable instructions and does not loop prompts
- Given permission granted later, Then next Take Photo works without primer

**Test Cases:**
- E2E: deny permission, assert no infinite prompt loop, fallback to file picker works
- A11y: instructions screen accessible
- Unit: permission state machine


### UC-CL-UP-15: Reject unsupported file types and oversized files
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client attempts upload

**Main Flow:**
1. 1. Client selects file via picker
2. 2. Client-side: extension check, MIME check, magic-byte sniff (first 4-12 bytes) against allowlist (PDF, JPEG, PNG, HEIC, WEBP)
3. 3. Size check: <= 25 MB per file, <= 100 MB cumulative pending in this session
4. 4. If invalid: inline error with reason and 'Allowed: PDF, JPG, PNG, HEIC' guidance
5. 5. If valid: proceed to upload
6. 6. Server re-validates magic bytes; rejects mismatches with 415

**Alternate Flows:**
- If user attempts EXE/ZIP/Office docs: block with explanation 'We accept photos and PDFs of your documents'
- If user attempts a password-protected PDF: accepted (treated as upload), but accountant view will surface inability to OCR

**Edge Cases:**
- File renamed .pdf but actually image → magic byte mismatch caught
- Polyglot file (valid PDF + JS payload) → server-side AV scan (e.g., ClamAV or equivalent) before AI processing; quarantine if hit
- Filename with NULL byte or control chars → sanitized
- Filename length > 255 chars → truncated with suffix preserved

**Invariants Enforced:** INV-SEC-1 (server-side validation always runs), INV-AUDIT-1 (rejection logged)

**Acceptance Criteria:**
- Given a .docx file, When picked, Then rejected client-side with allowed types listed
- Given a .pdf with image magic bytes, Then server rejects with 415
- Given a 30 MB file, Then rejected before upload starts

**Test Cases:**
- Unit: magic-byte sniff utility
- Integration: server rejects mismatched MIME with 415
- Security: malicious polyglot file flagged by AV scan
- E2E: pick disallowed type, see inline error


### UC-CL-UP-16: Strip EXIF metadata and convert HEIC before transit
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Upload is an image (JPEG/PNG/HEIC/WEBP)

**Main Flow:**
1. 1. Client picks image or captures photo
2. 2. App reads EXIF, removes GPSLatitude, GPSLongitude, GPSAltitude, MakerNote, and optionally OwnerName tags
3. 3. If HEIC: decode via libheif-wasm, re-encode as JPEG quality 0.85 (preserve resolution)
4. 4. Re-encoded JPEG used for upload
5. 5. Server-side defense: re-strip EXIF on ingest; reject if GPS present (defense in depth)

**Alternate Flows:**
- If HEIC decode fails: fall back to uploading original; server-side conversion runs
- If image is animated (animated WebP): keep first frame only, document this expectation

**Edge Cases:**
- EXIF orientation tag → apply rotation before strip, so image renders right-side-up
- Image with embedded ICC color profile → preserve
- Very large HEIC (40 MP iPhone) decoding on low-RAM Android → progress UI; if OOM, fall back to server-side conversion

**Invariants Enforced:** INV-PRIV-1 (no GPS in stored documents), INV-RES-1

**Acceptance Criteria:**
- Given HEIC with GPS, When uploaded, Then stored object is JPEG and exiftool reports no GPS tags
- Given JPEG with EXIF Orientation=6, Then rendered image is upright

**Test Cases:**
- Unit: EXIF strip removes all GPS-related tags
- Unit: orientation normalization correct for tags 1-8
- Integration: server defense rejects upload with GPS
- Performance: HEIC conversion < 3s for 12 MP image on mid-tier Android


### UC-CL-UP-17: Preview uploaded document before AI processing
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Document uploaded successfully
- Period 'open'

**Main Flow:**
1. 1. Client taps a Received document
2. 2. Detail sheet shows: thumbnail, filename, uploaded-at (TZ aware), slot label, size, Delete (if allowed), 'View full'
3. 3. 'View full' opens PDF/image viewer (pinch-zoom, swipe pages)
4. 4. Closing returns to checklist

**Alternate Flows:**
- If document is multi-page PDF: viewer shows page navigation
- If virus scan still pending: preview shows 'Scanning…' placeholder until ready
- If scan finds malware: document marked quarantined; preview disabled with safe explanation

**Edge Cases:**
- Very large PDF (100+ pages): paginate render to avoid OOM
- Encrypted PDF: show 'Encrypted — accountant may need a password' note
- Renamed slot label since upload: reflect current label

**Invariants Enforced:** INV-TEN-1 (presigned read URL scoped)

**Acceptance Criteria:**
- Given uploaded PDF, When tapped, Then renders within 2s on Wi-Fi
- Given quarantined doc, Then preview unavailable with clear copy

**Test Cases:**
- E2E: upload, open preview, scroll pages
- Security: presigned URL expires < 15 min and cannot be reused cross-tenant
- A11y: viewer announces page numbers; keyboard navigation for pages


### UC-CL-UP-18: Search and filter checklist for large slot lists
**Actor:** Client (client_owner) | **Priority:** P2 | **Platform:** mobile

**Preconditions:**
- Checklist has > 12 slots (firm with rich template)

**Main Flow:**
1. 1. Search bar appears above checklist
2. 2. Filter chips: All / Still needed / Received / Other
3. 3. Type to filter slot labels (debounced 200ms, fuzzy match)
4. 4. Sort options: Default (slot order), Recently uploaded, A–Z
5. 5. Selections persisted per device (localStorage)

**Alternate Flows:**
- If zero results: show 'No slots match — clear filters' CTA
- Search hidden when <= 12 slots to reduce clutter

**Edge Cases:**
- Search query with diacritics → normalized (NFD + stripped)
- Very long slot labels truncated with tooltip on long-press
- Rapid filter toggling debounced

**Invariants Enforced:** INV-TEN-1 (search is client-side over already authorized slots)

**Acceptance Criteria:**
- Given 30 slots and query 'rent', Then only matching slots visible
- Given filter Still needed, Then Received items hidden

**Test Cases:**
- Unit: fuzzy match function correctness
- E2E: filter + sort interactions
- A11y: search input labeled; chip group is a role='radiogroup'


### UC-CL-UP-19: Bulk upload multiple files to a single slot
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Slot allows multiple files (firm config)
- Period 'open'

**Main Flow:**
1. 1. Client opens slot detail; existing uploads listed
2. 2. Tap 'Add more'; OS picker opens with multi-select
3. 3. Selected files validated, enqueued, uploaded with concurrency = 3
4. 4. Progress strip at top: 'Uploading 3 of 7…'
5. 5. Slot count updates after each success

**Alternate Flows:**
- If slot configured single-file: 'Add more' hidden; new upload replaces existing only via explicit Replace flow
- If a file fails: that file marked failed with retry; others continue
- User can cancel remaining queue mid-batch

**Edge Cases:**
- User selects 50 files at once → soft cap warning at 20; allow with confirmation
- Mixed sizes — small ones may complete before large; ensure order preserved in UI by upload completion order, not selection order, with timestamps
- Pausing one upload should not block others

**Invariants Enforced:** INV-DOC-1, INV-AUDIT-1 (each upload logged)

**Acceptance Criteria:**
- Given 5-file bulk, When 1 fails, Then 4 succeed and 1 retry-able
- Given user cancels, Then remaining queue clears but successful uploads persist

**Test Cases:**
- E2E: select 7 files, network blip on file 3, verify retry path
- Unit: queue concurrency limit
- Performance: 20 files (avg 3 MB) complete < 60s on 4G


### UC-CL-UP-20: Receive push notification when period state changes
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client granted Web Push permission
- Tenant has VAPID keys configured

**Main Flow:**
1. 1. After first successful upload, app prompts (post-context primer) to enable notifications
2. 2. On grant, subscribe via PushManager; send subscription to backend POST /push/subscribe
3. 3. When accountant transitions period: backend sends push 'Processing started — your documents are being reviewed'
4. 4. When period reaches complete (gate 2): push 'Your Q2 results are ready to view'
5. 5. Tap notification deep-links to relevant screen

**Alternate Flows:**
- If user denies notifications: never re-prompt; rely on banner state on open
- If push delivery fails: web push protocol expiry handled by removing stale subs
- iOS Safari (16.4+) supports Web Push only for installed PWAs — gate the prompt accordingly

**Edge Cases:**
- Battery saver mode on Android may delay push
- User uninstalls PWA → subscription becomes invalid; clean up on next 410 Gone
- Multi-device: same user subscribed on phone + tablet → both receive
- Quiet hours / do-not-disturb: respect OS
- Notification content must NOT include financial figures (per INV-CONF-1 / numbers gating considerations)

**Invariants Enforced:** INV-CONF-1 (no confidence/figures in notification body), INV-AUDIT-1 (delivery attempts logged at server), INV-RES-1

**Acceptance Criteria:**
- Given period transitions to complete, Then push fires within 1 min
- Given user denies, Then no re-prompt within 30 days

**Test Cases:**
- Integration: VAPID push end-to-end on Android
- Security: subscription tied to tenant+user; cannot enumerate others
- Privacy: notification body redacted of numbers


### UC-CL-UP-21: Handle session expiry mid-upload with silent re-auth
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Long-running upload exceeds access token lifetime
- Refresh token still valid

**Main Flow:**
1. 1. Upload step (presign/confirm) returns 401
2. 2. Token interceptor calls /auth/refresh with HttpOnly refresh cookie
3. 3. New access token persisted in memory (not localStorage)
4. 4. Original request retried transparently
5. 5. User sees no interruption

**Alternate Flows:**
- If refresh fails (rotated/revoked): redirect to login; preserve queued uploads in IndexedDB until re-auth as same user
- If user logs in as different identity: purge queued items tagged to prior user

**Edge Cases:**
- S3 PUT itself uses presigned URL so does not need bearer token; only presign/confirm need refresh
- Refresh races (parallel requests): single-flight to avoid token thrash
- Clock skew on device → use exp w/ tolerance

**Invariants Enforced:** INV-AUTH-1 (refresh rotation), INV-TEN-1 (re-auth preserves tenant context)

**Acceptance Criteria:**
- Given access token expires mid-upload, When refresh succeeds, Then upload completes without user prompt
- Given refresh fails, Then user lands on login; queue preserved if same user re-authenticates

**Test Cases:**
- Integration: short-lived token forces refresh during upload
- Unit: single-flight refresh utility
- Security: refresh cookie SameSite=Strict, Secure, HttpOnly


### UC-CL-UP-22: Empty state and first-time onboarding tour
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- First login OR first time on Documents screen for any period

**Main Flow:**
1. 1. Empty state illustration + 3 coachmarks: 'Tap a slot to upload', 'Use Scan for multi-page', 'Other documents for anything else'
2. 2. CTA: 'Start uploading'
3. 3. Skip-able; do-not-show-again per device
4. 4. First successful upload triggers celebratory toast (single time only)

**Alternate Flows:**
- If tenant has custom onboarding copy (firm-configurable welcome message): use it
- If client returns and has zero uploads in current period: gentle nudge banner, not full tour

**Edge Cases:**
- Tour interrupted by phone call → resume on app return
- Tour content updates over time → version key, re-show only on major UX shift (rare)
- Accessibility: tour respects reduce-motion preference

**Invariants Enforced:** INV-TEN-1 (firm-configurable copy respects tenant)

**Acceptance Criteria:**
- Given first-ever visit, Then tour shows; Given tour dismissed, Then it does not re-appear
- Given firm custom copy set, Then it overrides default

**Test Cases:**
- E2E: first login flow shows tour, second login does not
- A11y: tour focus management correct, no keyboard traps
- Unit: tour state persisted per device


### UC-CL-UP-23: Handle browser refresh and tab close mid-action
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client mid-scan, mid-upload, or with unsaved reorder

**Main Flow:**
1. 1. If unsaved scan draft or in-flight upload exists: beforeunload prompt 'You have an upload in progress. Leave?'
2. 2. If user refreshes anyway: on reload, app restores from IndexedDB (queue + drafts)
3. 3. Toast: 'Resumed your upload' shown if applicable

**Alternate Flows:**
- PWA standalone mode may suppress beforeunload — rely on persistence + restore
- If browser killed by OS: same restore path on next launch

**Edge Cases:**
- Multiple tabs of the app: BroadcastChannel coordinates so only one leader processes the queue; closing the leader promotes another
- Storage quota near limit may prevent persistence — warn user

**Invariants Enforced:** INV-DOC-1

**Acceptance Criteria:**
- Given refresh mid-upload, When app reloads, Then upload resumes within 3s

**Test Cases:**
- E2E: simulate refresh during 10 MB upload, assert completion
- Unit: leader election across tabs
- Integration: beforeunload registered only when dirty


### UC-CL-UP-24: Permission-denied paths for client_staff vs client_owner on uploads
**Actor:** Client (client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client_staff sub-role authenticated

**Main Flow:**
1. 1. client_staff sees identical upload UI to owner (per spec, both can upload, view, answer flags)
2. 2. Any attempt to access owner-only actions (billing, inviting other staff) is blocked with 403
3. 3. Audit log distinguishes uploads by sub-role

**Alternate Flows:**
- If firm policy restricts client_staff upload (future config): UI disables uploads with copy 'Ask the owner to upload'
- If user role is revoked mid-session: next protected call returns 403; force re-auth

**Edge Cases:**
- Role change after PWA install: token refresh reflects new role; cached UI guarded by server-truth on each action
- Concurrent role demotion + active upload: in-flight upload may complete (server enforces at confirm time)

**Invariants Enforced:** INV-AUTH-2 (RBAC sub-role enforcement), INV-AUDIT-1 (sub-role recorded)

**Acceptance Criteria:**
- Given client_staff, When uploading, Then audit log records sub_role='client_staff'
- Given role revoked, Then next action returns 403

**Test Cases:**
- Integration: client_staff cannot reach owner-only endpoints (403)
- Audit: queries filter by sub-role
- Security: token cannot be tampered to elevate sub-role


### UC-CL-UP-25: Observability and audit touchpoints for client uploads
**Actor:** Client (client_owner / client_staff) — observed by backend & accountant | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Any upload-related action occurs

**Main Flow:**
1. 1. Each action (slot view, upload start, upload complete, delete, retry, lock-hit, queue flush) emits a structured event with tenant_id, client_id, period_id, user_id, sub_role, device, network_class, attempt_count, latency
2. 2. Audit log persists immutable rows for: upload_started, upload_succeeded, upload_failed (with reason), client_delete_document, scan_completed, queue_flushed, permission_denied
3. 3. Operational signals captured silently and never shown to client: upload retry rate, queue depth, time-to-first-upload after period open, re-upload count per slot
4. 4. These feed firm-side scorecard (joined with subjective ratings per spec)

**Alternate Flows:**
- If event pipeline degraded: events buffered locally with TTL; reconciled when service back

**Edge Cases:**
- Client deletes browser data: client-side buffered events may be lost; server-issued events still captured at API boundary
- PII minimization: filenames hashed in event stream, plain filename only in primary storage row
- Operator role must not be able to read these signals tied to financial content (per INV — operator never reads firm financial data); aggregate-only metrics for operator

**Invariants Enforced:** INV-AUDIT-1 (append-only, immutable for attestations and key events), INV-CONF-1 (confidence never surfaced to client; signals never shown to client), INV-OP-1 (operator cannot read firm financial data)

**Acceptance Criteria:**
- Given upload completes, Then exactly one upload_succeeded audit row exists
- Given client deletes a document, Then audit row with actor and timestamp persists permanently
- Given operator queries audit, Then they cannot see document content, only aggregate signals

**Test Cases:**
- Integration: every upload action produces expected audit row
- Security: operator role tested against audit and document endpoints — 403 on financial reads
- Privacy: PII fields hashed in event stream
- Performance: audit writes do not block upload critical path (async write w/ guaranteed delivery)


## Client (Owner) (mobile)

### UC-CL-FL-01: View open flags list with mirrored count on home tile
**Actor:** Client (client_owner) on mobile PWA | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client is authenticated with valid JWT session
- Tenant context is resolved from subdomain/token
- At least one period exists for the client's business
- Current period is in 'open' or 'processing' state
- Client has client_owner sub-role with read access to own client_id rows

**Main Flow:**
1. Client opens the PWA home screen
2. Home tile fetches GET /api/v1/client/periods/current/flags/count with tenant_id and client_id filters
3. Home tile renders badge: 'X open flags' where X = COUNT(flags WHERE status='open' AND client_id=:me)
4. Client taps the 'Flags' tile
5. App navigates to /flags route and fetches GET /api/v1/client/periods/current/flags?status=open
6. Backend applies RLS policy ensuring only rows where tenant_id matches session tenant_id and client_id matches session client_id return
7. List renders flags ordered by created_at DESC with: flag title, type pill (Category/Explain/Receipt), source pill (yellow=system, red=accountant), source-doc thumbnail
8. Open count on the list header matches the home tile badge exactly

**Alternate Flows:**
- If count is 0, show empty state 'All caught up - your accountant has no questions right now' with illustration
- If period is in 'complete' state, show banner 'This period is complete - no new flags expected'
- If list has more than 20 items, paginate with infinite scroll (cursor-based)
- If client taps refresh, force-revalidate cache and re-fetch

**Edge Cases:**
- Tile badge and list count diverge due to a new flag arriving mid-render - reconcile via SSE/WebSocket within 2s
- Client has zero periods (never onboarded) - show 'Waiting for your first period' state, hide flags tile
- Tenant_id in JWT does not match any row - return empty list, do NOT leak any data
- Clock skew between device and server causes badge to show stale count - use server-authoritative count, never client-computed
- User rotates device mid-load - preserve scroll/state
- User has 500+ flags (unrealistic but possible bulk import) - virtualize list, cap initial render at 50
- Browser refresh while loading - re-fetch from server, do not show stale cached count without revalidation

**Invariants Enforced:** INV-TENANT-1 (multi-tenant isolation via tenant_id), INV-TENANT-2 (Postgres RLS backstop), INV-CLIENT-1 (client never sees confidence %), INV-FLAG-1 (color = source, not confidence)

**Acceptance Criteria:**
- Given client has 3 open flags, when home tile renders, then badge shows '3'
- Given client taps flags tile, when list loads, then count in list header equals badge count exactly
- Given a flag belongs to a different tenant, when list is fetched, then it MUST NOT appear (RLS denies)
- Given flag source is system, when rendered, then color pill is yellow; given source is accountant, then color pill is red
- Given period state is 'archived', when flags route is opened, then flags are read-only (no answer affordances)

**Test Cases:**
- Unit: count selector returns COUNT(flags WHERE status='open' AND client_id=session.client_id)
- Integration: API endpoint returns 401 if JWT missing, 403 if client_id in token mismatches resource
- Integration (security): seed two tenants with same client_id integer; assert tenant A cannot see tenant B's flags
- E2E (Playwright mobile viewport): login -> home -> verify badge -> tap tile -> verify list count matches
- E2E: simulate 0 flags -> assert empty state copy and illustration present
- Accessibility: badge has aria-label='3 open flags requiring your attention'; list items have role=listitem; touch target >= 44x44pt
- Performance: list TTI under 2s on 3G fast network simulation with 50 flags
- Visual regression: yellow vs red pill contrast ratio >= 4.5:1 against background


### UC-CL-FL-02: Answer Category flag with predefined chip selection
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Open flag of type 'category' exists
- Period is in 'open' or 'processing' state
- Document referenced by flag is not yet ai-locked OR flag was raised post-lock by accountant
- Client has answer-write permission (client_owner or client_staff)

**Main Flow:**
1. Client taps a category flag from the list
2. Detail screen loads with: transaction context (date, amount, vendor), source-doc thumbnail, question text, and chip list of suggested categories from firm's COA
3. Client taps a category chip (e.g., 'Office Supplies')
4. Chip enters 'selected' visual state with confirmation affordance
5. Client taps 'Submit answer'
6. App POSTs to /api/v1/client/flags/:flagId/answer with payload {type:'category', value:'office_supplies', idempotency_key}
7. Backend validates: flag belongs to session.client_id, flag.status='open', category value is in firm's allowed COA list
8. Backend writes answer row, updates flag.status='answered', flag.answered_at=now(), flag.answered_by=session.user_id, appends audit_log entry
9. Flag collapses to green 'cleared' card with selected category shown and 'Change' link
10. Open count decrements by 1 on list header AND home tile (via SSE push)

**Alternate Flows:**
- If client taps 'Let my accountant choose' escape hatch, submit answer with value='deferred_to_accountant' and route the flag back to accountant queue
- If client searches/types instead of tapping a chip, show filtered chip list with substring match
- If client wants to see what each category means, tap (i) icon for tooltip without losing selection
- If client opens flag but doesn't answer, draft is preserved locally (IndexedDB) for 7 days

**Edge Cases:**
- Client double-taps submit rapidly - idempotency_key dedupes; second request returns 200 with prior result
- Network drops mid-submit - app queues request, shows 'Saving...' badge, retries with exponential backoff
- Category list is empty (firm hasn't configured COA) - show 'Let my accountant choose' as the only option
- Flag was canceled by accountant between load and submit - server returns 409 Conflict; client shows 'This flag was withdrawn' toast and removes it
- Flag was already answered by client_staff in another tab - server returns 409; client refreshes to show current state
- Period transitioned to 'complete' mid-answer - server returns 423 Locked; client shows 'Period is no longer accepting answers'
- Very long category names overflow chip - truncate with ellipsis, full text on long-press
- Client is offline - queue answer in service worker outbox; sync when online; show 'Pending sync' badge
- Session expired mid-submit - 401 triggers silent token refresh; if refresh fails, route to login preserving draft

**Invariants Enforced:** INV-FLAG-2 (gates re-lock when flag reopens), INV-AUDIT-1 (append-only audit log), INV-CLIENT-2 (client never selects period), INV-TENANT-1

**Acceptance Criteria:**
- Given client selects 'Office Supplies' and submits, when server responds 200, then flag.status='answered' and audit_log has CLIENT_ANSWERED_CATEGORY entry
- Given client taps 'Let my accountant choose', when submitted, then answer value='deferred_to_accountant' and flag is visually cleared but routed to accountant inbox
- Given two rapid submits with same idempotency_key, when both reach server, then only one write occurs
- Given flag belongs to different client_id, when answer submitted, then server returns 403 and no write occurs
- Given offline, when submit tapped, then UI shows 'Pending sync' and answer persists in IndexedDB

**Test Cases:**
- Unit: category validator rejects values not in firm COA whitelist
- Unit: idempotency middleware returns cached response on duplicate key within 24h window
- Integration: answer endpoint denies cross-tenant flagId with 403
- Integration: answer endpoint denies if flag.status != 'open' (409)
- E2E: tap chip -> submit -> verify green cleared state and count decrement
- E2E (offline): toggle airplane mode -> submit -> assert outbox entry -> reconnect -> assert sync
- Security: attempt to submit with arbitrary category string 'DROP TABLE flags' - assert sanitization and rejection
- Accessibility: chips have role=radio in radiogroup, keyboard navigable, announce selection via aria-live
- Performance: chip render with 50 categories under 100ms


### UC-CL-FL-03: Answer Explain flag with freeform text and draft preservation
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Open flag of type 'explain' exists
- Period accepts answers (open or processing)
- Client has write permission

**Main Flow:**
1. Client taps explain flag, sees question + multiline text input
2. Client types explanation (e.g., 'This was a refund from supplier X for damaged goods')
3. On every keystroke pause (debounced 500ms), draft is autosaved to IndexedDB keyed by flagId
4. Character counter shows X/1000
5. Client taps 'Submit'
6. App POSTs /api/v1/client/flags/:flagId/answer {type:'explain', value:text, idempotency_key}
7. Backend trims, sanitizes (strip HTML/scripts), validates length 1-1000
8. Backend writes answer, marks flag answered, audit log entry
9. UI collapses flag to green cleared with first 80 chars + 'Read more' expander; 'Change' affordance present
10. Local draft is cleared from IndexedDB upon 200 response

**Alternate Flows:**
- If client returns to a previously-drafted flag, restore text from IndexedDB with banner 'Restored your draft'
- If text exceeds 1000 chars, disable submit and show inline error
- If client pastes formatted text, strip formatting; preserve plain text only
- If user wants emoji - allow (Unicode), reject control characters

**Edge Cases:**
- Browser refresh mid-typing - reload restores last autosave
- Two devices editing same flag (owner on phone, staff on tablet) - last-writer-wins by server timestamp; show toast 'Updated by another user' to loser
- User pastes 50KB of text - client truncates to 1000 chars before send
- User submits empty string - inline error 'Please write an explanation or use Let my accountant choose'
- User submits whitespace-only - reject as empty
- Unicode bidirectional text (Arabic mixed with English) - render correctly, store as-is
- Right-to-left input - mirror text alignment
- Network drop mid-submit - queue in service worker, retry, badge 'Pending'
- User backgrounds the app mid-typing on iOS - autosave triggers on visibilitychange
- XSS attempt '<script>alert(1)</script>' - stored as escaped text, never rendered as HTML

**Invariants Enforced:** INV-AUDIT-1, INV-TENANT-1, INV-SECURITY-1 (XSS prevention via output encoding)

**Acceptance Criteria:**
- Given client types and waits 500ms, when keystroke pause occurs, then draft persists to IndexedDB
- Given draft exists, when client returns to flag, then text is restored with banner
- Given submit succeeds, when 200 returned, then IndexedDB draft is removed
- Given text contains HTML, when stored and rendered, then it displays as literal text not executed markup
- Given text > 1000 chars, when submit attempted, then UI prevents send and shows counter in error state

**Test Cases:**
- Unit: sanitizer strips <script>, <iframe>, on* attributes, javascript: URIs
- Unit: validator rejects empty/whitespace-only
- Integration: submit -> verify answer.value in DB equals submitted text (post-sanitization)
- E2E: type 50 chars -> kill tab -> reopen -> assert draft restored
- E2E: submit -> verify draft removed from IndexedDB
- Security: fuzz with XSS payloads, SQL injection strings, polyglot files in pasted content
- Accessibility: textarea has aria-label, label associated, error announced via aria-live=assertive
- Internationalization: test with Hindi, Arabic, Chinese, emoji, combining diacritics


### UC-CL-FL-04: Upload receipt to answer Receipt flag (double-write transaction + checklist)
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Open flag of type 'receipt' exists
- Flag references a specific transaction_id and a checklist_item_id
- Period is open/processing
- Client has camera/photo permission OR file picker access

**Main Flow:**
1. Client taps receipt flag; sees transaction context, vendor, amount, date
2. Sheet offers: 'Take photo', 'Choose from library', 'Choose file'
3. Client selects 'Take photo'; browser invokes camera capture
4. Client captures image; preview displays with 'Retake' or 'Use photo'
5. On 'Use photo', client-side: HEIC->JPG conversion if iOS, resize >4MB to <=4MB, strip EXIF GPS
6. App requests presigned S3 PUT URL: POST /api/v1/client/uploads/presign {flagId, mime, size, sha256}
7. App PUTs file directly to S3 in ca-central-1 bucket
8. App POSTs /api/v1/client/flags/:flagId/answer {type:'receipt', s3_key, sha256, original_filename}
9. Backend verifies S3 object exists, sha256 matches, mime matches whitelist (jpg/png/pdf/heic)
10. Backend performs DOUBLE-WRITE atomically in transaction: (a) attach document to transaction_id, (b) increment checklist counter, (c) write answer row, (d) mark flag answered, (e) audit log entry
11. Flag collapses to green cleared with thumbnail of uploaded receipt and 'Change' affordance

**Alternate Flows:**
- If client cannot find receipt, tap 'I can't find this receipt' -> see UC-CL-FL-05 (Not Found attestation)
- If client uploads PDF instead of image, accept up to 10MB, no compression
- If client uploads multiple pages, allow up to 5 images attached to one flag
- If file is rejected (wrong mime/too large), show inline error with size and type guidance

**Edge Cases:**
- File > 25MB - reject client-side before presign
- File mime mismatch (extension says jpg but bytes are exe) - server-side magic-byte check rejects with 415
- Network drops during S3 PUT - retry up to 3x with exponential backoff
- S3 PUT succeeds but answer POST fails - orphan object reaped by nightly job; client sees 'Upload incomplete, please retry'
- Client uploads same receipt twice (duplicate sha256) - dedupe at storage layer, reuse existing s3_key
- EXIF contains GPS coordinates - stripped client-side before upload (privacy)
- HEIC on Android browser (no native support) - client converts via canvas; if fails, show 'Please convert to JPG'
- User rotates portrait/landscape during capture - preserve orientation
- User uploads receipt for wrong flag (concurrent flags open) - flag_id is bound to the answer payload, not the upload
- Period transitioned to processed mid-upload - server returns 423; orphan S3 object reaped
- Camera permission denied - fallback to file picker with helpful copy
- Client double-uploads from two devices - last-writer wins on flag.answered_at; both files retained, second linked to transaction

**Invariants Enforced:** INV-RECEIPT-1 (double-write transaction + checklist count), INV-DOC-1 (documents lockable only by client before AI processing), INV-AUDIT-1 (audit log appended), INV-RESIDENCY-1 (ca-central-1 only), INV-TENANT-1

**Acceptance Criteria:**
- Given valid receipt uploaded, when answer succeeds, then transaction.documents includes the new doc AND checklist.receipts_count incremented by exactly 1
- Given upload + answer in DB transaction, when answer write fails, then transaction rollback prevents partial state
- Given S3 object stored, when client downloads receipt later, then it streams from ca-central-1
- Given EXIF GPS present, when uploaded, then stored object has GPS stripped
- Given mime spoofed, when server inspects bytes, then rejected with 415

**Test Cases:**
- Unit: HEIC->JPG conversion preserves orientation
- Unit: EXIF stripper removes GPSLatitude/Longitude tags
- Integration: presign endpoint returns URL scoped to tenant prefix s3://probooks-ca/{tenant_id}/{client_id}/...
- Integration (transactional): inject failure into checklist increment, assert document attachment is rolled back
- E2E (mobile camera): mock getUserMedia -> capture -> upload -> assert green cleared + thumbnail
- E2E: upload PDF -> assert no compression, original bytes preserved
- E2E (offline): submit while offline -> assert queued -> reconnect -> assert sync and double-write
- Security: presigned URL expires in 5min and is scoped to single object key
- Security: cross-tenant flagId in presign request rejected
- Performance: 4MB image upload under 10s on LTE
- Accessibility: camera button has aria-label 'Take photo of receipt', focusable
- Storage: verify object stored in ca-central-1 (PIPEDA compliance)


### UC-CL-FL-05: Submit 'Not Found' attestation for missing receipt (immutable)
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Open receipt-type flag exists
- Client has authenticated session and write permission
- No 'not_found' attestation already exists for this flag (write-once)

**Main Flow:**
1. Client taps 'I can't find this receipt' on receipt flag
2. Modal appears: 'You're confirming you cannot find a receipt for this transaction. The transaction will still be recorded. This confirmation is permanent and will be visible to your accountant.'
3. Modal shows transaction details (vendor, amount, date) for context
4. Two buttons: 'Cancel' and 'Confirm - I cannot find this'
5. Client taps Confirm
6. App POSTs /api/v1/client/flags/:flagId/answer {type:'not_found', confirmed:true, idempotency_key}
7. Backend writes attestation row: {flag_id, client_id, attested_by_user_id, attested_at, immutable:true}
8. Backend marks flag answered, transaction remains recorded (NOT deleted), audit log entry CLIENT_NOT_FOUND_ATTESTED
9. Flag collapses to gray 'Not found - attested' (distinct from green cleared) with timestamp and attester name
10. Change affordance is DISABLED with tooltip 'This confirmation is permanent. Contact your accountant if recorded in error.'

**Alternate Flows:**
- If client taps Cancel, modal dismisses, no write, flag remains open
- If client previously attested then accountant raises new follow-up flag, new flag is separate and not blocked by prior attestation

**Edge Cases:**
- Client attempts to change attestation - server returns 422 with message 'Attestation is immutable'
- Client_staff attempts to attest on behalf of owner - allowed but attributed to staff user_id (firm sees who attested)
- Network drops after server write but before client confirmation - on retry, idempotency_key returns prior result
- Two staff users attest simultaneously - first wins, second gets 409
- Accountant deletes the flag after attestation - attestation row retained (immutable financial data); flag soft-deleted but attestation queryable
- Period archived mid-flow - server returns 423; attestation NOT written
- Client confirms but then immediately closes app - server-side write completes, audit log captures it

**Invariants Enforced:** INV-ATTEST-1 (write-once, attributed, timestamped), INV-ATTEST-2 (transaction still recorded after not-found), INV-AUDIT-1 (immutable audit), INV-FIN-1 (no permanent deletes of financial data), INV-TENANT-1

**Acceptance Criteria:**
- Given client confirms not-found, when server writes, then attestation row has immutable=true, attested_by_user_id=session.user_id, attested_at=now()
- Given attestation exists, when client attempts second attestation on same flag, then server returns 422
- Given attestation written, when transaction is queried, then transaction still exists (not deleted)
- Given attestation visible in audit log, when accountant views it, then attester name, timestamp, and IP are present
- Given client_staff attests, when displayed, then 'attested by [staff name]' is shown (not owner)

**Test Cases:**
- Unit: attestation entity has no UPDATE method exposed
- Integration: POST same attestation twice -> assert second returns 422
- Integration: attestation immutability enforced at DB layer (trigger blocks UPDATE)
- E2E: tap not-found -> verify modal copy verbatim -> confirm -> assert gray state and no Change button
- E2E: attempt to PATCH /flags/:id/answer after attestation -> assert 422
- Security: attestation cannot be deleted via DELETE endpoint (returns 405)
- Audit: verify audit_log entry contains user_id, ip, user_agent, timestamp, flag_id, action='CLIENT_NOT_FOUND_ATTESTED'
- Accessibility: confirm button is focused last (not default focus); modal is keyboard-trapped
- Compliance: attestation retention >= 7 years (CRA requirement)


### UC-CL-FL-06: Preview source document via thumbnail lightbox preserving scroll position
**Actor:** Client (client_owner or client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Flag has at least one linked source document (receipt, statement, or invoice)
- Client has read permission to the document

**Main Flow:**
1. Client scrolls flags list to flag #15, taps thumbnail
2. App captures scrollY position in route state
3. Lightbox opens overlay with full-resolution image (or PDF page) for receipts; for statements, shows page with the relevant row highlighted; for invoices, shows full image
4. Pinch-zoom and pan are enabled
5. Close 'X' button or swipe-down dismisses lightbox
6. App restores scrollY exactly so flag #15 is at same vertical position
7. Focus returns to the thumbnail that opened the lightbox

**Alternate Flows:**
- Multi-page PDF - swipe left/right to paginate; current page indicator at bottom
- Statement with highlighted row - render with yellow box around the row matching the transaction
- If document fetch fails, show 'Preview unavailable - tap to retry' inside lightbox
- Long-press thumbnail in list shows preview without opening full lightbox (peek)

**Edge Cases:**
- Document is very large (15MB PDF) - stream with progressive rendering, show spinner
- Document deleted by accountant after flag was raised - lightbox shows 'Document no longer available'
- Multiple lightboxes opened via rapid tapping - debounce; only one instance at a time
- Browser back button while lightbox open - close lightbox first, do not navigate away
- iOS Safari refreshes when memory pressure occurs - restore scroll via session storage on next mount
- Orientation change with lightbox open - re-fit image, preserve zoom level
- User has reduced-motion preference - skip animation, instant open/close
- Statement highlight row coordinates are stale (re-OCR changed bounding box) - fallback to highlighting entire row by amount match
- Document is a corrupt JPEG - browser fails to render; show fallback icon + 'Cannot preview' message

**Invariants Enforced:** INV-TENANT-1 (document fetch enforces tenant_id), INV-CLIENT-1 (no confidence shown even in lightbox metadata)

**Acceptance Criteria:**
- Given flag list scrolled to position Y, when lightbox opens and closes, then scrollY restored to Y exactly
- Given thumbnail tapped, when lightbox opens, then full-res image loads within 2s on LTE
- Given statement with highlight, when rendered, then yellow box surrounds the transaction's row
- Given lightbox open, when device rotates, then image refits without losing zoom state
- Given lightbox dismissed, when focus returns, then thumbnail receives focus (keyboard/screen reader)

**Test Cases:**
- Unit: scrollY restore helper returns identical Y
- Integration: signed URL for document fetch is scoped to tenant + client + flag
- E2E: scroll to item 15 -> tap thumb -> close -> assert window.scrollY equals captured Y
- E2E (statement): assert highlight box bounding rect matches transaction.row_bbox
- Accessibility: lightbox has role=dialog, aria-modal=true, focus trapped, ESC closes, returns focus
- Accessibility: pinch-zoom not the only path - double-tap zoom available, screen reader reads alt text
- Performance: lightbox open animation under 300ms; image decode under 500ms for 2MP
- Security: cross-tenant document URL rejected with 403


### UC-CL-FL-07: Change/reopen previously cleared flag (re-locks gates, re-increments count)
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Flag is in 'answered' status (green cleared)
- Flag is NOT a 'not_found' attestation (those are immutable)
- Period state is open or processing (not complete/filed/archived)
- Numbers may currently be unlocked (Gate 1 passed)

**Main Flow:**
1. Client expands green cleared card, taps 'Change'
2. Confirmation sheet: 'Changing your answer will reopen this question and may delay your numbers being ready. Continue?'
3. Client confirms
4. App POSTs /api/v1/client/flags/:flagId/reopen {idempotency_key}
5. Backend validates flag.status='answered', period state allows mutation
6. Backend: marks flag.status='open', clears previous answer (soft, retained in history), increments open_count, recomputes Gate 1 status
7. If Gate 1 was unlocked, re-lock it; numbers screen on client portal shows 'Numbers pending - answer outstanding flags'
8. Audit log entry CLIENT_REOPENED_FLAG with prior answer snapshot
9. Flag returns to open state in list; count badge increments on home tile via SSE
10. Original answer is editable (Category chip selection restored OR text restored OR receipt thumbnail restored, ready to be changed)

**Alternate Flows:**
- If client cancels confirmation, no state change
- If reopening triggers Gate 1 re-lock, push notification sent to accountant 'Client reopened a flag'
- If flag was answered by accountant escape-hatch ('deferred'), reopen returns to open with no prior selection

**Edge Cases:**
- Concurrent reopen by client_staff while owner is reopening - first wins, second gets 409 with current state
- Period transitioned to 'complete' between view and reopen tap - server returns 423; UI refreshes to read-only
- Accountant marked complete (Gate 2) just before reopen - reopen still allowed if period state < complete; if at complete, blocked with explanatory toast
- Reopen of a flag whose source document was deleted - reopen succeeds but document preview shows 'unavailable'
- Network drop mid-reopen - idempotency key dedupes; UI reconciles via revalidation
- Rapid open->reopen->open cycling - server rate-limits to 1 reopen per 5s per flag
- If flag was originally a 'not_found' - Change is disabled (UC-CL-FL-05 invariant)

**Invariants Enforced:** INV-FLAG-2 (gates re-lock on reopen), INV-GATE-1 (Gate 1: ALL flags cleared AND processed), INV-AUDIT-1, INV-TENANT-1

**Acceptance Criteria:**
- Given client reopens flag, when server processes, then flag.status='open' and open_count incremented
- Given Gate 1 was unlocked, when flag reopened, then Gate 1 re-locks and client numbers screen shows pending state
- Given reopen succeeds, when audit log inspected, then entry contains prior answer snapshot
- Given not_found attestation flag, when client views it, then Change button is disabled with tooltip
- Given period state >= 'complete', when reopen attempted, then server returns 423 and UI explains

**Test Cases:**
- Unit: reopen guard rejects if flag.status != 'answered'
- Unit: Gate 1 recomputation function returns false if any flag.status='open'
- Integration: reopen flag -> assert numbers endpoint returns gate1_unlocked=false
- Integration: rate limit 1 reopen per 5s per flag enforced
- E2E: reopen flag -> verify count++ on home tile, list -> verify Gate 1 lock UI
- Security: cross-tenant reopen returns 403
- Audit: verify audit_log entry with action=CLIENT_REOPENED_FLAG and prior_answer_snapshot
- Accessibility: Change button has aria-label, confirmation sheet keyboard-trapped


### UC-CL-FL-08: Receive real-time update when accountant raises new flag mid-session
**Actor:** Client (client_owner) viewing flags list or detail | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client has open PWA session
- WebSocket / SSE channel established for tenant_id + client_id room
- Accountant raises a red flag (manual) on a transaction

**Main Flow:**
1. Accountant submits new flag from App B (Firm Workspace)
2. Backend persists flag, publishes event flag.created to tenant:client room
3. Client's open PWA receives event over WebSocket
4. Open count badge increments (home tile + list header) via optimistic update
5. Toast banner appears: 'New question from your accountant' with 'View' action
6. If client taps 'View', new flag scrolls into view with subtle pulse animation
7. If client is already on flags list, new flag appears at top with 'New' chip

**Alternate Flows:**
- If client is on detail screen of another flag, badge updates silently, no modal interruption
- If client has notifications disabled in OS, in-app toast still shows
- If client's connection is flaky, missed events are reconciled via polling fallback every 30s

**Edge Cases:**
- WebSocket disconnects - reconnect with exponential backoff, replay missed events using last_event_id cursor
- Multiple flags raised in burst (10 at once) - debounce toast, show 'X new questions' aggregated
- Accountant raises and withdraws within seconds - both events delivered; flag appears then disappears with fade
- Client offline when flag raised - on reconnect, sync delta and badge updates
- Stale session token mid-stream - server closes connection with 4001 'auth expired'; client refreshes token and reconnects
- Cross-tab open in PWA on desktop browser - both tabs receive event independently
- Push notification delivered AND in-app event - dedupe by event_id; do not double-toast
- Server clock skew - use server-emitted created_at, not device clock
- Flag raised in period that is no longer current - badge updates only if flag is for current period; older periods filtered server-side

**Invariants Enforced:** INV-TENANT-1 (room scoped to tenant+client), INV-FLAG-1 (color matches source - red for accountant), INV-REALTIME-1 (event delivery at-least-once with idempotency)

**Acceptance Criteria:**
- Given client session open, when accountant raises flag, then within 2s badge increments
- Given multi-flag burst, when delivered, then UI aggregates to single toast
- Given client offline, when reconnects, then missed flags appear in list
- Given event for different tenant, when received (bug), then RLS at API layer blocks; client never displays it
- Given red flag from accountant, when rendered, then color pill is red

**Test Cases:**
- Unit: WebSocket event handler dispatches to count and list reducers
- Integration: emit flag.created event -> assert client receives within 2s
- Integration: simulate disconnect for 60s -> assert replay catches up via last_event_id
- E2E (multi-window): trigger from App B accountant view -> assert App C client view updates
- Security: connect with tenant A token, attempt to subscribe to tenant B room - rejected
- Performance: badge update render under 100ms after event arrival
- Resilience: kill server -> client retries connection 1s, 2s, 4s, 8s backoff
- Accessibility: toast is announced via aria-live=polite, not assertive


### UC-CL-FL-09: Receive push notification when new flag arrives or numbers unlock
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client granted Web Push permission during onboarding
- PWA service worker registered with push subscription stored server-side per device
- Notification preferences allow flag arrivals or gate-1 unlock

**Main Flow:**
1. Server-side event triggers (flag.created OR gate1.unlocked)
2. Backend queries push_subscriptions for client_id + enabled preference
3. Backend sends Web Push payload to FCM/APNs via web-push library with VAPID keys
4. Service worker receives push, displays notification: 'New question from your accountant' or 'Your draft numbers are ready'
5. Notification has tag for grouping (e.g., tag=flag_count) so multiple pushes collapse into one
6. Client taps notification; PWA opens deep-linked to /flags or /numbers
7. Auth state restored from IndexedDB / cookie; if expired, login screen preserves deep link

**Alternate Flows:**
- If client has multiple devices, all subscribed devices receive notification
- If notification arrives while app is foregrounded, suppress system notification, show in-app toast instead
- If user has Do Not Disturb hours configured in firm settings, server delays delivery until window opens

**Edge Cases:**
- Push subscription expired (410 from FCM) - server marks subscription inactive, prompts re-subscription on next visit
- User uninstalled PWA - subscription invalid, removed
- Browser does not support Web Push (iOS Safari < 16.4) - graceful fallback to in-app banner only; no error to user
- Notification permission revoked - service worker still installed but no push delivery; show settings hint on next visit
- Network flaky - push delivery is best-effort; in-app sync via WebSocket is the source of truth
- Same event triggers WebSocket and push - dedupe by event_id at client; show only one notification
- Localized notification text - server picks language from user.locale preference
- Notification body contains PII (vendor name in flag) - configurable per firm; default redacts to 'New question'
- Multiple browsers on same device subscribed - each has its own subscription; both fire (browser-level dedupe is OS-dependent)

**Invariants Enforced:** INV-TENANT-1 (subscription scoped to tenant + client), INV-PRIVACY-1 (no financial detail in notification payload by default), INV-RESIDENCY-1 (push subscription metadata in ca-central-1)

**Acceptance Criteria:**
- Given push permission granted, when new flag created, then notification displayed within 10s
- Given user taps notification, when app opens, then deep-links to flags route
- Given user has 2 devices, when event fires, then both receive push
- Given push subscription returns 410, when next attempt, then server marks inactive and stops sending
- Given notification body, when inspected, then no transaction amounts or vendor names by default

**Test Cases:**
- Unit: push subscription invalidation on 410
- Integration: trigger flag.created -> assert push payload sent to web-push mock
- E2E (Chrome DevTools): grant permission -> trigger event -> assert notification fires
- Security: VAPID keys rotated quarterly; private key not exposed
- Privacy: assert notification body does not contain amounts or vendor names unless firm config enables it
- Performance: notification delivery latency p95 < 15s
- Compatibility: graceful fallback on iOS < 16.4 (no error, no permission prompt)


### UC-CL-FL-10: Handle offline submission with service worker outbox and sync on reconnect
**Actor:** Client (client_owner or client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- PWA installed or in browser with service worker registered
- Client has at least one open flag and has started answering
- Network is unavailable (airplane mode, subway, etc.)

**Main Flow:**
1. Client opens flags list while offline; cached list renders from IndexedDB
2. Client answers a category flag offline
3. Service worker intercepts POST /flags/:id/answer, queues request in 'outbox' object store with body + idempotency_key + timestamp
4. UI immediately shows green cleared with 'Pending sync' badge
5. Open count decrements optimistically
6. When network returns, sync manager iterates outbox in FIFO order, replays requests
7. On 2xx, remove from outbox, mark flag synced (remove badge)
8. On 4xx (e.g., 409 conflict), surface error toast 'Could not save - tap to review' and route to flag
9. On 5xx, retry with backoff up to 5 attempts; after final failure, surface error

**Alternate Flows:**
- If receipt upload queued offline, file blob stored in Cache Storage; on reconnect, presign + upload + answer chain runs
- If 'Not found' attestation queued offline, sync requires online confirmation; if user is now online and changes mind, queue can be canceled before sync
- If client edits same flag offline twice (change category), only the last request is sent (debounced in outbox)

**Edge Cases:**
- Outbox grows large (100+ items) - cap at 200; oldest evicted with warning
- User opens app on second device while first is offline - second device sees current server state; first device sync may conflict; conflict resolution: server wins, client surfaces 'Your other device already answered'
- Background sync API unavailable (Safari) - sync on next foreground/visibility change
- Service worker updated mid-offline - new SW must take over without losing outbox; outbox stored in IndexedDB (persistent)
- Client uninstalls PWA before sync - outbox lost; acceptable (no commitment to user until sync)
- Idempotency_key conflict (same key with different body) - server returns 422, client clears entry
- Period transitioned to complete during offline window - sync gets 423; client shows 'Period closed, contact accountant'
- Receipt blob in cache exceeds quota (StorageManager.estimate) - prompt user to retry with smaller image
- Clock drift - all timestamps server-side; client timestamps used for ordering only

**Invariants Enforced:** INV-IDEMPOTENCY-1 (idempotency_key required on all mutations), INV-RECEIPT-1 (double-write preserved even via async sync), INV-AUDIT-1 (audit logs server-generated, not client), INV-TENANT-1

**Acceptance Criteria:**
- Given offline, when client submits answer, then UI optimistically updates and outbox persists request
- Given reconnect, when sync runs, then outbox flushed in order with idempotency
- Given 409 conflict on sync, when surfaced, then UI explains and offers Review
- Given app closed and reopened offline, when outbox checked, then prior requests retained
- Given background sync registered, when network returns, then sync runs without app open (where supported)

**Test Cases:**
- Unit: outbox queue FIFO, dedupe by flagId for category/explain types
- Integration: service worker fetch handler intercepts mutations only, passes reads through to cache
- E2E (Cypress + offline): submit answer offline -> assert outbox -> go online -> assert sync and DB write
- E2E (multi-device conflict): submit offline on device A -> online answer on device B -> assert A surfaces conflict
- Storage: assert IndexedDB outbox survives SW update
- Performance: sync 50 queued items in under 30s on LTE
- Resilience: corrupt outbox entry skipped, others sync; log error to telemetry


### UC-CL-FL-11: View answered (cleared) flags with filter toggle
**Actor:** Client (client_owner or client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client is in flags list view
- At least one flag has been answered in current period

**Main Flow:**
1. Client taps filter chip 'Show cleared'
2. List re-renders to include green cleared flags interleaved with open OR filtered to cleared only based on UI choice
3. Cleared flags show selected answer preview (category name, first 80 chars of explain, receipt thumb, or 'Not found - attested')
4. Each cleared flag has Change affordance per UC-CL-FL-07 (unless not_found)
5. Sort options: most recent first, by transaction date, by amount

**Alternate Flows:**
- If no flags answered yet, show empty state 'Answered questions will appear here'
- Search by vendor/amount/keyword filters both open and cleared
- Filter pills: All / Open / Cleared / Not Found

**Edge Cases:**
- Mixed open + cleared rendering at 200+ items - virtualize list
- Sort by amount with mixed currencies (firm operates multi-currency? - assume CAD only for V1)
- Search returns 0 results - 'No matches' state
- User searches with special chars / regex chars - escape on server
- Date range spans timezone change (DST) - use America/Toronto consistently

**Invariants Enforced:** INV-TENANT-1, INV-CLIENT-1 (no confidence shown anywhere)

**Acceptance Criteria:**
- Given filter 'Cleared', when applied, then only answered flags render
- Given sort by amount desc, when applied, then list orders by transaction.amount DESC
- Given search 'staples', when typed, then results include transactions with vendor containing 'staples'
- Given 0 cleared, when filter applied, then empty state shows

**Test Cases:**
- Unit: filter and sort reducers produce correct order
- Integration: query endpoint accepts ?status=answered&sort=amount_desc&q=staples
- E2E: toggle filter -> assert list updates without full reload
- Security: search query SQL-injection-safe (parameterized)
- Accessibility: filter chips have role=tab; selected announced
- Performance: filter switch under 200ms with 100 items


### UC-CL-FL-12: First-time onboarding empty state with explanatory copy
**Actor:** Client (client_owner) new to ProBooks | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client logs in for first time
- No periods or flags yet exist
- Firm has activated the client account

**Main Flow:**
1. Client lands on home; flags tile shows '-' or hides
2. Tap flags tile (or auto-redirect to flags route): empty state with illustration
3. Copy: 'Your accountant will ask questions here as they review your records. We'll let you know when there's something to answer.'
4. Optional CTA: 'Learn how flags work' (links to short explainer)
5. Push notification opt-in prompt appears once with rationale

**Alternate Flows:**
- If firm has not configured prompt copy, fall back to system default
- Skip opt-in prompt if browser does not support Web Push

**Edge Cases:**
- User dismisses opt-in - do not re-prompt for 30 days
- User has multiple businesses linked - empty state per business
- Locale not English - render French (firm-configurable) copy if available, else default English

**Invariants Enforced:** INV-TENANT-1, INV-PROMPT-1 (firm-configurable prompt copy & cap)

**Acceptance Criteria:**
- Given new client, when flags route opened, then onboarding empty state shows
- Given firm prompt copy configured, when empty state rendered, then firm copy used
- Given push not supported, when empty state shown, then opt-in is omitted
- Given user dismisses opt-in, when reopened within 30 days, then prompt not shown

**Test Cases:**
- Unit: empty state selector returns true when periods.length=0 AND flags.length=0
- E2E (new account flow): assert onboarding copy and CTA
- Accessibility: illustration has empty alt, copy is semantic h1/p
- Localization: French fallback rendered when firm.locale=fr-CA


### UC-CL-FL-13: Recover from network error during answer submission with retry UX
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client is submitting any answer type
- Backend is unreachable OR returns 5xx

**Main Flow:**
1. Client taps Submit
2. App POSTs answer; receives network error or 503
3. UI shows inline retry banner: 'Could not save. We'll keep trying.' with 'Retry now' button
4. Service worker queues for background sync (UC-CL-FL-10)
5. User can dismiss inline banner; sync continues in background
6. On retry success, banner replaced by green confirmation toast

**Alternate Flows:**
- If error is 4xx (validation), show specific message, do not auto-retry
- If error is 401, refresh token silently and retry once; if still 401, route to login preserving draft
- If error is 423 (period locked), show 'Period closed - contact accountant', do not retry

**Edge Cases:**
- Persistent 5xx for 10+ retries - show error toast and link to support
- User navigates away during retry - retry continues in background; result toast on return
- Client clock far ahead - signed request timestamp may be rejected by server; show 'Please check your device time'
- Backend deployment rolling restart - 503 expected briefly; backoff handles it
- Rate-limited (429) - respect Retry-After header

**Invariants Enforced:** INV-IDEMPOTENCY-1, INV-AUDIT-1 (no audit log entry until success)

**Acceptance Criteria:**
- Given 503 returned, when user taps Retry, then request resubmitted with same idempotency_key
- Given 401 and refresh succeeds, when retry runs, then user does not see login screen
- Given 423 returned, when shown, then no auto-retry occurs
- Given persistent failure, when 5 retries exhausted, then user shown error with support link

**Test Cases:**
- Unit: retry policy is exponential, max 5 attempts, capped at 60s
- Integration: mock 503 then 200 -> assert second attempt uses same idempotency_key
- E2E: simulate network blip -> assert UX flow without data loss
- Security: refresh token rotation works under retry
- Accessibility: retry banner has role=status; button is focusable and labeled


### UC-CL-FL-14: Handle session expiry mid-action with draft preservation
**Actor:** Client (client_owner or client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client is mid-action (typing explain answer or capturing receipt)
- Access token has expired; refresh token also expired (>30 days inactivity)

**Main Flow:**
1. Client taps Submit; API returns 401
2. App attempts silent refresh; refresh also 401
3. App persists current draft to IndexedDB under user_id + flag_id
4. App routes to /login with returnTo=/flags/:id query param
5. Client logs in (password/MFA)
6. On successful login, app reads draft from IndexedDB, restores flag detail screen with content
7. Toast: 'Session expired - we saved your work'

**Alternate Flows:**
- If user logs in as a different account, drafts from prior account are not surfaced (scoped by user_id)
- If MFA challenge fails, drafts remain stored for 7 days

**Edge Cases:**
- Receipt blob in cache exceeds quota after long offline period - prompt user, may lose blob
- Login screen reached via direct URL - returnTo param defaults to /flags
- User cancels login - app stays on login screen; draft retained
- Concurrent session in another tab logged in - cross-tab BroadcastChannel signals, app refreshes auth state
- Token clock skew causes premature 401 - silent refresh retries with adjusted clock

**Invariants Enforced:** INV-SESSION-1 (refresh tokens rotated; refresh expiry 30 days), INV-PRIVACY-1 (drafts scoped to user; never leaked across accounts)

**Acceptance Criteria:**
- Given session expired mid-typing, when login completes, then draft restored
- Given 7+ days pass without login, when login completes, then draft is expired and discarded
- Given different user logs in, when draft list checked, then prior user's drafts hidden
- Given cross-tab login, when current tab detects, then session updates without reload

**Test Cases:**
- Unit: draft scope key = user_id + flag_id + tenant_id
- Integration: expire token -> attempt submit -> assert redirect with returnTo
- E2E: type -> expire session -> login -> assert restored
- Security: drafts encrypted in IndexedDB at rest using SubtleCrypto with key derived from session
- Privacy: log out clears IndexedDB drafts


### UC-CL-FL-15: View read-only flags after period transitions to complete/filed/archived
**Actor:** Client (client_owner or client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Period state is complete, filed, or archived
- Flags from that period exist

**Main Flow:**
1. Client navigates to a past period (via Archive view) and selects Flags
2. List loads in read-only mode: no Change buttons, no answer affordances
3. Banner: 'This period is [complete/filed/archived]. Flags are shown for your records.'
4. Client can preview source documents and read prior answers

**Alternate Flows:**
- If period was archived without all flags answered (rare edge), show 'Not answered' badge in gray
- If client wants change after filing, banner copy: 'Contact your accountant to update.'

**Edge Cases:**
- Client manipulates URL to access PATCH endpoint on archived period - server returns 423
- Document referenced by archived flag was rotated/redacted by firm - show updated document
- Period archived very recently - state transition cache may be stale; refresh from server
- Multiple periods archived - sort by period_end DESC

**Invariants Enforced:** INV-PERIOD-1 (state machine monotonic), INV-FIN-1 (no permanent deletes), INV-AUDIT-1

**Acceptance Criteria:**
- Given period state >= complete, when flags rendered, then read-only banner present and no Change buttons
- Given API mutation attempted on archived flag, when server processes, then 423 returned
- Given archived period selected, when navigated, then UI clearly indicates archive context

**Test Cases:**
- Unit: read-only selector returns true for state in [complete, filed, archived]
- Integration: PATCH on archived flag returns 423
- E2E: navigate to archived period -> assert read-only UI
- Accessibility: read-only banner has role=status


### UC-CL-FL-16: Detect and reconcile concurrent edits from client_owner and client_staff
**Actor:** Client (client_owner OR client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Two users tied to same client_id are signed in simultaneously
- Both are viewing or answering the same flag

**Main Flow:**
1. User A taps Submit on flag X; succeeds; flag answered
2. User B's open detail screen receives flag.updated event via WebSocket
3. User B's UI updates: shows 'Answered by [User A]' banner with new answer preview
4. User B's pending input (if any) is preserved in a separate 'Suggest change' affordance OR discarded with toast based on whether B had typed
5. Open count on B's home tile decrements via same event

**Alternate Flows:**
- If User B had already submitted concurrently, B's request returns 409 with current state
- If User A submitted Not Found attestation, User B sees gray immutable state; B cannot change

**Edge Cases:**
- User A and B submit within 50ms - first write wins by DB timestamp; second gets 409
- Client_staff submits without owner permission for a specific operation (none in V1, but future-proof) - check role on server
- Both users offline simultaneously, both queue answers - first to sync wins; second sees conflict
- Owner reopens while staff is editing - staff's session sees reopen event, transitions to open mode

**Invariants Enforced:** INV-CONCURRENCY-1 (optimistic concurrency via flag.version), INV-AUDIT-1 (attribute to whoever submitted), INV-TENANT-1

**Acceptance Criteria:**
- Given concurrent submits, when both reach server, then exactly one succeeds and other gets 409
- Given B has draft when A submits, when event received, then B prompted to save as suggestion or discard
- Given A submits not_found, when B sees event, then B's UI locks Change immediately

**Test Cases:**
- Integration: two clients PATCH same flag with same version -> one 200, one 409
- E2E (two browsers): drive owner and staff in parallel, assert reconciliation
- Security: staff cannot escalate to owner-only actions (UC-CL-FL-05 attestation allowed for both per spec)


### UC-CL-FL-17: Install PWA to home screen and verify installability
**Actor:** Client (client_owner) on first visit | **Priority:** P2 | **Platform:** mobile

**Preconditions:**
- Browser supports PWA install (Chrome, Edge, Safari iOS 16.4+)
- Manifest.json served with name, short_name, icons, theme_color, display=standalone
- Service worker registered with offline fallback
- HTTPS

**Main Flow:**
1. Client visits portal in browser
2. After 2nd session OR explicit trigger, install prompt sheet appears: 'Add ProBooks to your home screen for faster access'
3. Client taps 'Add'
4. Browser handles install (beforeinstallprompt event captured and invoked)
5. App opens in standalone mode on next launch with no browser chrome

**Alternate Flows:**
- If client dismisses, do not re-prompt for 14 days
- On iOS, manual instructions shown (Share -> Add to Home Screen) since no programmatic install

**Edge Cases:**
- Manifest icons missing required sizes (192, 512) - installability fails; log warning
- Service worker fails to register due to MIME error - retry once, log to telemetry
- User installs then uninstalls - re-prompt eligible after 14 days
- Display mode change to standalone updates UI (hide install banner)

**Invariants Enforced:** INV-PWA-1 (offline capability via SW), INV-RESIDENCY-1 (static assets served from ca-central-1 CDN)

**Acceptance Criteria:**
- Given manifest valid and SW registered, when Chrome inspected, then 'Installable' criteria met in DevTools
- Given user installs, when launched, then display=standalone (no URL bar)
- Given iOS user, when install banner shown, then manual Add-to-Home-Screen instructions present

**Test Cases:**
- Unit: manifest schema validator passes
- E2E (Lighthouse PWA audit): score >= 90
- Cross-browser: manual install on Chrome, Edge, Safari iOS
- Performance: SW install < 5s
- Accessibility: install prompt focus order, dismiss button labeled


### UC-CL-FL-18: Use keyboard and screen reader to navigate and answer flags
**Actor:** Client (client_owner) using assistive technology | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client uses VoiceOver/TalkBack/external keyboard

**Main Flow:**
1. Client tabs through home tile; focus indicator visible (2px outline, 4.5:1 contrast)
2. Screen reader announces 'Flags, 3 open questions, button'
3. Client activates with Enter/Space
4. On flags list, each flag is a list item with role=listitem, focusable, announces 'Question 1 of 3: Categorize transaction $145.20 at Staples, button'
5. Client opens detail; focus moves to question heading
6. Form controls have associated labels; chip groups have role=radiogroup
7. Submit button announces state changes via aria-live

**Alternate Flows:**
- Screen reader rotor jumps between headings/buttons/landmarks
- Skip link 'Skip to main content' available at top
- Toggle high-contrast mode respected via prefers-contrast media query

**Edge Cases:**
- Lightbox open - focus trapped inside modal; ESC closes
- Toast notification - role=status, polite, not interrupting
- Error message - role=alert, assertive
- Reduced-motion users - skip animations
- Large text (200% zoom) - layout reflows, no horizontal scroll on mobile

**Invariants Enforced:** INV-A11Y-1 (WCAG 2.1 AA compliance)

**Acceptance Criteria:**
- Given screen reader on, when flag list rendered, then each item announced with type and amount
- Given keyboard only, when Tab pressed, then focus visible and logical order
- Given 200% zoom, when applied, then no horizontal scroll
- Given color blindness simulation, when interface tested, then color is not sole indicator (icons + text accompany red/yellow pills)

**Test Cases:**
- Unit: every interactive element has accessible name
- E2E (axe-core): zero serious/critical violations on flags routes
- Manual: VoiceOver on iOS, TalkBack on Android, NVDA on Windows browser
- Visual: focus indicators meet 3:1 contrast against any background
- Reduced motion: prefers-reduced-motion disables non-essential animation


### UC-CL-FL-19: Throttle rapid double-taps on Submit / Change / Confirm
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Any action button on flag screen

**Main Flow:**
1. Client taps Submit
2. Button enters loading state (spinner replaces label) and becomes disabled
3. Duplicate taps within 500ms are ignored at UI level
4. Single request fires with idempotency_key
5. On response, button re-enables OR action completes and unmounts

**Alternate Flows:**
- If response takes > 5s, show 'Still saving...' message
- If user navigates away, request continues; result toast on return

**Edge Cases:**
- iOS Safari delayed click on disabled button - explicit aria-disabled and pointer-events:none
- Bluetooth keyboard with stuck Enter - debounced
- Touch jitter on accessibility devices - 300ms debounce

**Invariants Enforced:** INV-IDEMPOTENCY-1

**Acceptance Criteria:**
- Given 5 rapid taps, when fired, then exactly one POST occurs server-side
- Given button in loading state, when tapped, then no new request
- Given long response, when 5s elapsed, then UX feedback shown

**Test Cases:**
- Unit: debounce/throttle helper
- Integration: 10 concurrent requests with same idempotency_key -> 1 write
- E2E: rapid-tap simulation -> assert single network request


### UC-CL-FL-20: Detect malformed inputs and reject with clear messaging
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client interacts with answer forms or uploads

**Main Flow:**
1. Client uploads .exe renamed .jpg
2. Server inspects magic bytes (file-type lib), rejects with 415
3. UI displays 'This file type is not supported. Please upload an image or PDF.'
4. Client uploads 0-byte file - 400 'File is empty'
5. Client submits explain with 5000 chars (over limit) - 400 'Maximum 1000 characters'
6. Client submits category 'foo' not in COA - 400 'Please select a valid category'

**Alternate Flows:**
- If server detects polyglot file (PDF with embedded script) - reject 415 with generic message
- If filename contains path traversal '../../etc/passwd' - server sanitizes and stores as random UUID

**Edge Cases:**
- File with null bytes in name - rejected
- Very long filename (300 chars) - truncated to 100
- Filename with emoji or non-ASCII - allowed, stored URL-encoded
- Mime type lie (header says jpg, bytes say png) - server trusts bytes
- Server-side virus scan flags upload - reject and notify firm via internal alert (not client)

**Invariants Enforced:** INV-SECURITY-1 (input validation), INV-SECURITY-2 (upload mime validation by bytes)

**Acceptance Criteria:**
- Given .exe uploaded, when server inspects, then rejected with 415
- Given polyglot file, when inspected, then rejected
- Given 0-byte file, when uploaded, then 400 with clear copy
- Given oversized text, when submitted, then rejected client-side and server-side
- Given invalid category, when submitted, then rejected with whitelist enforcement

**Test Cases:**
- Unit: file-type detection by magic bytes
- Integration: upload polyglot test files -> assert rejection
- Security: fuzz endpoint with malformed JSON, SQL injection, XSS payloads
- E2E: drag-drop unsupported file -> assert error copy


### UC-CL-FL-21: Render statement-with-row-highlighted thumbnail for statement-source flags
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Flag's source document is a bank/credit-card statement (multi-row document)
- OCR/parser has stored bounding box for the specific transaction row

**Main Flow:**
1. Client views flag in list; thumbnail renders preview of statement with yellow highlight box overlaid on the transaction row
2. Highlight bounding box is computed server-side from OCR; coordinates normalized 0-1
3. Thumbnail uses pre-rendered image (server-cached) for fast load
4. Tap thumbnail -> lightbox renders full page with same highlight
5. Client can pan/zoom; highlight scales correctly

**Alternate Flows:**
- If row coords missing, fall back to highlighting amount via text-match
- If page is rotated, rotate highlight accordingly

**Edge Cases:**
- Multi-page statement - thumbnail shows correct page with highlight
- Row spans two pages - highlight on primary page only
- OCR confidence low - fallback to no highlight, show full statement
- Statement is image-only (no OCR) - highlight unavailable, show plain thumbnail
- User has color vision deficiency - highlight uses pattern + color, not color alone (e.g., dashed border)

**Invariants Enforced:** INV-CLIENT-1 (no OCR confidence shown to client), INV-TENANT-1

**Acceptance Criteria:**
- Given statement source, when thumbnail renders, then yellow box surrounds row
- Given coords missing, when rendered, then fallback no-highlight thumbnail used
- Given lightbox open, when zoomed, then highlight scales proportionally

**Test Cases:**
- Unit: highlight scaler maps normalized coords to pixel coords
- Integration: thumbnail endpoint returns cached preview within 500ms
- E2E: verify visual highlight on statement-type flag
- Accessibility: highlight has aria-label 'Transaction row highlighted'


### UC-CL-FL-22: Observe answer activity in audit log (write-side observability)
**Actor:** Client (client_owner) - implicit; audit consumer is firm | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Any answer/reopen/attestation action by client
- Audit logging service is healthy

**Main Flow:**
1. Client takes action (e.g., submit category answer)
2. Backend transaction includes audit_log INSERT with {tenant_id, client_id, user_id, action, target_type, target_id, before_state, after_state, ip, user_agent, timestamp}
3. Audit log is append-only (no UPDATE/DELETE allowed)
4. Telemetry event emitted (anonymized) for product analytics: action_type, latency_ms, success
5. Audit log queryable by firm via App B for compliance

**Alternate Flows:**
- If audit insert fails, the entire action transaction rolls back (audit is non-optional)
- If telemetry sink is down, drop events; do not block user action

**Edge Cases:**
- Audit log table grows huge - partitioned by month
- Time-zone in audit log - stored UTC, displayed in firm timezone
- User_id missing (impersonation) - flag impersonation in audit
- IP behind CDN - capture X-Forwarded-For with trust list

**Invariants Enforced:** INV-AUDIT-1 (append-only), INV-AUDIT-2 (transactional with action)

**Acceptance Criteria:**
- Given any answer action, when committed, then audit_log row exists with all required fields
- Given audit insert fails, when action rolled back, then no flag state change
- Given UPDATE attempted on audit table, when run, then DB trigger rejects
- Given firm queries audit, when filtered by client_id, then all actions visible chronologically

**Test Cases:**
- DB: trigger prevents UPDATE/DELETE on audit_log
- Integration: answer endpoint failure rolls back audit insert
- Security: cross-tenant audit query blocked by RLS
- Compliance: audit retention 7 years


### UC-CL-FL-23: Handle very large flag list (performance and virtualization)
**Actor:** Client (client_owner) | **Priority:** P2 | **Platform:** mobile

**Preconditions:**
- Client's period has 200+ flags (heavy month or backfill)

**Main Flow:**
1. Flags route fetches first 50 via GET ?cursor=null&limit=50
2. List uses virtualized scroll (react-window or similar) rendering only visible items + buffer
3. On scroll near bottom, fetch next page with cursor
4. Maintain scroll position when lightbox opens/closes
5. Count badge always reflects total open, computed server-side

**Alternate Flows:**
- If client has 1000+ flags, show 'Showing first 1000' with link to filter
- Bulk-collapse: 'Mark all I can't find' is NOT offered (each not-found requires explicit attestation per UC-CL-FL-05)

**Edge Cases:**
- Pagination race: page 2 fetched while page 1 mutating - reconcile by id
- Cursor invalidated (flag deleted) - server returns next valid cursor
- Memory pressure on low-end device - virtualization keeps RSS low
- Scroll jank under 30fps - profile, adjust buffer size
- User filters mid-scroll - reset cursor, refetch

**Invariants Enforced:** INV-TENANT-1, INV-NO-BULK-ATTESTATION (per spec, attestations are individual)

**Acceptance Criteria:**
- Given 500 flags, when list renders, then memory under 100MB and 60fps scroll
- Given pagination, when scroll reaches end, then next page fetched
- Given filter changed, when applied, then list resets to top

**Test Cases:**
- Performance: scroll 500 items at 60fps on mid-tier Android
- Integration: cursor pagination returns stable order
- E2E: scroll, paginate, return - assert no duplicate items


### UC-CL-FL-24: Verify Gate 1 unlock on numbers screen after last flag cleared
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- All other flags cleared (status=answered)
- Period is in 'processed' state
- Only one open flag remains

**Main Flow:**
1. Client answers final open flag
2. Server transaction updates flag status, then evaluates Gate 1: ALL flags cleared AND period.state >= processed
3. Server emits gate1.unlocked event
4. Client receives event over WebSocket; numbers screen tile state updates to 'View draft numbers'
5. Push notification fires (UC-CL-FL-09) 'Your draft numbers are ready'
6. Home tile shows green check and link to numbers

**Alternate Flows:**
- If period.state still 'open' or 'processing', Gate 1 stays locked even with all flags cleared - shows 'Awaiting your accountant's processing'
- If accountant raises new flag immediately, Gate 1 re-locks

**Edge Cases:**
- Race: client clears last flag and accountant raises new flag in same second - server evaluates atomically; net result depends on commit order; idempotent event delivery ensures eventual consistency
- Numbers fetch on locked period - server returns 423 with 'Gate not yet unlocked'
- Gate 1 unlocks but Excel still locked until Gate 2 - UI explains both gates
- Time skew between server and client - rely on server-emitted state

**Invariants Enforced:** INV-GATE-1, INV-CLIENT-3 (numbers are DRAFT label visible), INV-HST-1 (numbers net of HST, HST broken out)

**Acceptance Criteria:**
- Given last flag cleared and period processed, when evaluated, then Gate 1 unlocks within 2s
- Given Gate 1 unlocked, when numbers viewed, then DRAFT badge visible and HST line items 105/108/109 present
- Given Gate 1 unlocked then new flag raised, then Gate 1 re-locks

**Test Cases:**
- Unit: Gate 1 evaluator function
- Integration: clear last flag -> assert gate1.unlocked event
- E2E: full flow last answer -> numbers visible
- Security: numbers endpoint denies if Gate 1 not unlocked
- Privacy: numbers do not contain confidence %


### UC-CL-FL-25: Logout flow clears flag drafts and revokes push subscription
**Actor:** Client (client_owner or client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Authenticated session

**Main Flow:**
1. Client taps Logout in account menu
2. Confirmation prompt: 'Sign out? Any unsynced answers will be lost.'
3. On confirm: POST /api/v1/auth/logout (revokes refresh token server-side)
4. Service worker clears IndexedDB drafts and outbox
5. Push subscription unsubscribed via pushManager.unsubscribe()
6. Cookies cleared
7. Redirect to /login

**Alternate Flows:**
- If client has unsynced answers in outbox, warn 'X answers not yet saved' and offer to wait for sync
- If logout API fails, still clear client-side state and redirect

**Edge Cases:**
- Multi-device: logout on one device does not invalidate other devices
- Logout while offline - clear local state immediately, sync revocation when online
- User navigates back after logout - login screen, cannot access stale routes
- Refresh token already expired - logout still proceeds idempotently

**Invariants Enforced:** INV-SESSION-1, INV-PRIVACY-1 (logout clears local PII)

**Acceptance Criteria:**
- Given logout, when confirmed, then refresh token revoked server-side
- Given drafts existed, when logout, then IndexedDB drafts removed
- Given push subscribed, when logout, then push unsubscribed and server-side record removed
- Given unsynced outbox, when logout, then user warned with count

**Test Cases:**
- Integration: logout -> attempt to use prior refresh token -> assert 401
- Unit: cleanup function removes all client-side state keys
- E2E: logout -> back button -> assert login screen
- Privacy: assert no PII remains in localStorage/IndexedDB after logout


## Client (Owner) (mobile)

### UC-CL-DB-01: View current-quarter status card in Locked state
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client is authenticated on mobile PWA
- Client has at least one active period assigned by firm
- Current period is in 'open' or 'processing' state OR has unresolved flags
- Gate 1 has NOT been satisfied (flags open OR not processed)

**Main Flow:**
1. 1. Client launches PWA on mobile device
2. 2. PWA performs auth check against /auth/session endpoint
3. 3. Home renders 'Where this quarter stands' card with heading always visible (INV-DISP-1)
4. 4. Backend resolves current period via firm-set frequency (no client selection)
5. 5. Card displays Locked state badge with quarter label (e.g., 'Q2 2026')
6. 6. Card shows placeholder/skeleton for numbers area with lock icon
7. 7. Subtext explains: 'Numbers unlock once your accountant finishes processing and all flags are cleared'
8. 8. No HST figures, no draft tag, no Excel download button rendered
9. 9. CTA points to 'View flags' or 'Upload documents' as applicable

**Alternate Flows:**
- If period state = 'open' with no docs uploaded: show empty-doc nudge
- If period has flags open: surface flag count chip in card
- If period is 'processing': show 'Processing in progress' subtext (no ETA promise)
- If multiple periods active (rare overlap), show only system-derived current one

**Edge Cases:**
- Period rollover at quarter boundary: card must auto-refresh to new period without manual reload
- Timezone: period boundaries computed in firm timezone, displayed in client locale
- Network failure on initial load: render cached last-known state with stale badge
- Backend returns 401 due to expired session: redirect to re-auth without losing deep-link target
- Rapid pull-to-refresh double-taps: debounce; only one fetch in flight
- Browser back from drill-in mid-load: cancel in-flight requests to avoid stale UI
- Heading must remain rendered even if numbers payload fails (INV-DISP-1)

**Invariants Enforced:** INV-DISP-1, INV-GATE-1, INV-CONF-1, INV-PERIOD-1, INV-TENANT-1

**Acceptance Criteria:**
- Given Gate 1 unsatisfied, when client opens home, then card heading is visible and numbers area is locked
- Given network failure, when home loads, then heading still renders with offline indicator
- Given period in any state, when card renders, then no confidence % is anywhere in DOM
- Given period in processing, when client views card, then no Excel download CTA is shown

**Test Cases:**
- E2E: Login as client_owner with locked period → assert heading 'Where this quarter stands' visible, lock icon present, no numbers in DOM
- Integration: GET /periods/current returns {state:'processing', gate1:false} → UI renders Locked variant
- Unit: stateMachine.canShowNumbers(period) returns false unless processed && noOpenFlags
- Security: tenant_a client cannot fetch tenant_b period via direct ID manipulation (RLS check)
- A11y: VoiceOver reads heading first, then state, then CTA in logical order
- A11y: Dynamic Type at 200% does not truncate heading or clip lock icon
- Performance: home renders heading within 1.5s on 3G throttle even before numbers arrive


### UC-CL-DB-02: View current-quarter status card in Pending state (flags open)
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client authenticated
- Period is 'processed' (AI run complete) but one or more flags are still open
- Gate 1 NOT satisfied because flags pending

**Main Flow:**
1. 1. Client opens home
2. 2. PWA fetches /periods/current with flag counts
3. 3. Card heading renders (INV-DISP-1)
4. 4. State badge shows 'Pending' with subtext 'Answer flags to unlock numbers'
5. 5. Flag counter pill shows e.g., '3 flags need your attention'
6. 6. Yellow/red icons shown per flag source (yellow=system, red=accountant) — never confidence
7. 7. Numbers area remains locked with explanatory copy
8. 8. CTA 'Answer flags' deep-links to flag inbox

**Alternate Flows:**
- If only yellow flags: subtext 'Quick questions from the system'
- If only red flags: subtext 'Your accountant needs answers'
- If mixed: show both color chips with counts

**Edge Cases:**
- Last flag cleared while card is open: silent re-fetch via WebSocket/poll, card transitions to Processed
- Flag re-opened by accountant after client cleared: card reverts to Pending
- Stale flag count from cache vs server: server is source of truth on refresh
- Accountant adds new red flag during client session: surface within 30s
- Empty flag inbox but Gate 1 still false (race): show Pending with generic copy until backend reconciles

**Invariants Enforced:** INV-DISP-1, INV-GATE-1, INV-FLAG-COLOR-1, INV-CONF-1

**Acceptance Criteria:**
- Given open flags, when card renders, then numbers stay locked and flag count is accurate
- Given red flag exists, when icon shown, then color reflects source not confidence
- Given last flag answered, when client returns to home, then state transitions to Processed without manual refresh

**Test Cases:**
- E2E: open period with 2 yellow + 1 red flag → assert pill shows '3', colors correct
- Integration: flag.close() event → periods/current reflects gate1=true if all closed
- Unit: flag color mapper rejects confidence input, only accepts source enum
- A11y: screen reader announces 'Pending, 3 flags need your attention'
- Security: client cannot see flags from other clients of same firm


### UC-CL-DB-03: View current-quarter status card in Processed state with Draft numbers
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Period state = 'processed' or beyond (but not yet 'complete')
- All flags cleared (Gate 1 satisfied)
- Gate 2 NOT yet satisfied (accountant has not marked complete)

**Main Flow:**
1. 1. Client opens home; PWA fetches /periods/current
2. 2. Card heading renders (INV-DISP-1)
3. 3. State badge shows 'Processed'
4. 4. 'DRAFT' tag rendered prominently next to numbers (INV-DRAFT-1)
5. 5. HST headline shows payable or refund computed from net (line 109)
6. 6. Sub-lines display: Line 105 (HST collected), Line 108 (ITCs), Line 109 (net)
7. 7. Numbers are net-of-HST per INV-HST-NET-1
8. 8. Excel download button visible but disabled with tooltip 'Available after your accountant marks period complete'
9. 9. No confidence % anywhere

**Alternate Flows:**
- If net tax is refund (negative): headline reads 'Refund of $X' with appropriate color
- If zero net: headline reads 'No HST owing'
- If accountant marks complete mid-view: live update to Available state

**Edge Cases:**
- HST display: cents rounding must match backend computation, never re-rounded in UI
- Currency locale: CAD format with $ sign per Canadian convention
- Negative ITCs (corrections): still displayed as positive on line 108 with explanatory tooltip
- Long firm names / quarter labels: ellipsis with full text accessible to SR
- Draft tag must persist through scroll and not be hidden by sticky headers
- If period regresses (illegal per state machine), UI should not allow downgrade — show error

**Invariants Enforced:** INV-DISP-1, INV-DRAFT-1, INV-GATE-1, INV-GATE-2, INV-HST-NET-1, INV-HST-LINES-1, INV-CONF-1

**Acceptance Criteria:**
- Given Gate 1 met and Gate 2 not met, when card renders, then DRAFT tag is visible and Excel is disabled
- Given HST payload, when displayed, then lines 105/108/109 match backend exactly with no client-side recompute
- Given any state, when card renders, then no confidence percentage is in DOM

**Test Cases:**
- E2E: period gate1=true, gate2=false → assert DRAFT badge present, Excel button aria-disabled='true'
- Visual regression: DRAFT tag remains visible at 200% zoom
- Integration: GET /periods/current/hst returns {l105, l108, l109} → UI renders identical values
- Unit: hstHeadline(l109) returns 'Payable' if positive, 'Refund' if negative, 'No HST owing' if 0
- Security: tamper with response to inject confidencePct → UI must ignore field
- A11y: VoiceOver reads 'Draft, HST payable, $1,234.56'


### UC-CL-DB-04: Download Excel from home after Gate 2 unlocks
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Period state = 'complete', 'filed', or 'archived' (Gate 2 satisfied)
- Client authenticated with active session

**Main Flow:**
1. 1. Client sees Excel download CTA enabled on home card
2. 2. Client taps 'Download Excel'
3. 3. PWA calls POST /periods/{id}/excel with auth token
4. 4. Backend verifies Gate 2, tenant ownership, RLS
5. 5. Backend streams .xlsx with period-scoped data (no date picker)
6. 6. PWA writes to iOS/Android share sheet or default downloads
7. 7. Toast confirms 'Excel downloaded for Q2 2026'
8. 8. Audit log entry written: {event:'client_excel_download', period_id, client_id, ts}

**Alternate Flows:**
- If iOS Safari: blob URL opened in new tab with Save to Files option
- If Android Chrome: file lands in Downloads with native notification
- If PWA installed: uses File System Access API where supported
- If Gate 2 reverts (rare, accountant un-marks): subsequent downloads blocked but already-downloaded files remain on device

**Edge Cases:**
- Slow network: show progress; allow cancel
- Mid-download session expiry: fail gracefully and prompt re-auth then retry
- Concurrent taps: debounce; only one download in flight
- Storage full on device: catch and show error
- File name must include firm name + quarter to avoid collision across clients
- Filename safety: strip path separators and unicode control chars
- Browser refresh mid-download: re-request idempotently
- Background tab when download lands: respect OS behavior
- If period not actually complete (server check fails despite UI state): 403 returned, UI re-syncs

**Invariants Enforced:** INV-GATE-2, INV-EXCEL-SCOPE-1, INV-AUDIT-1, INV-TENANT-1

**Acceptance Criteria:**
- Given Gate 2 met, when client taps download, then xlsx is delivered with correct period scope
- Given Gate 2 not met, when client attempts download, then UI prevents request and backend returns 403
- Given any download, when completed, then audit log records event with client_id and period_id

**Test Cases:**
- E2E iOS Safari: tap download → assert file appears in Files app with correct name
- E2E Android Chrome: tap download → assert file lands in Downloads
- Integration: POST /periods/{id}/excel returns 403 when gate2=false even if URL is known
- Security: client_a cannot download client_b excel even with valid period_id (RLS)
- Audit: assert log row written with non-null client_id, ts
- Performance: 5MB xlsx delivers under 5s on 4G
- Unit: filename builder sanitizes special characters


### UC-CL-DB-05: Drill into current-quarter detail view
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client authenticated
- Current period exists in any state

**Main Flow:**
1. 1. Client taps card on home
2. 2. PWA navigates to /periods/current/detail route
3. 3. Detail view renders full HST breakdown if Gate 1 met, else locked variant
4. 4. Top section: state, DRAFT tag if applicable, quarter label
5. 5. Middle: HST lines 105/108/109 with explanations
6. 6. Bottom: Excel download (gated), flag inbox link, document upload link
7. 7. Back gesture returns to home

**Alternate Flows:**
- If Gate 1 not met: detail shows same locked messaging as home with action chips
- If period is filed/archived: route redirects to filed-quarter detail

**Edge Cases:**
- Deep link from email or notification: must auth-gate properly
- Period changes between home and detail (rollover): re-resolve on detail mount
- Back stack: scrolling position on home preserved
- Pull-to-refresh on detail re-fetches HST and gates

**Invariants Enforced:** INV-DISP-1, INV-DISP-4, INV-GATE-1, INV-DRAFT-1, INV-CONF-1

**Acceptance Criteria:**
- Given home card, when tapped, then detail view loads with numbers (if gate1) one tap deeper per INV-DISP-4
- Given filed period accessed via current route, when loaded, then redirect to archive detail
- Given any detail view, when rendered, then no confidence % present

**Test Cases:**
- E2E: tap home card → assert detail route, assert HST lines visible if processed
- E2E: deep link to /periods/current/detail without auth → redirect to login then back to detail
- Integration: route guard checks state before rendering detail
- A11y: focus moves to detail heading on navigation


### UC-CL-DB-06: Download Excel from current-quarter detail view
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Period Gate 2 satisfied
- Client on current-quarter detail view

**Main Flow:**
1. 1. Client scrolls to download section on detail view
2. 2. Excel button is enabled (matches home gating)
3. 3. Client taps; same flow as UC-CL-DB-04
4. 4. Audit log entry differentiates source: {source:'current_detail'}

**Alternate Flows:**
- If Gate 2 reverts while on detail: button transitions to disabled with toast

**Edge Cases:**
- User initiates download from home and detail simultaneously: server idempotent, one audit per request
- Detail view stale gate state: re-check on tap before request

**Invariants Enforced:** INV-GATE-2, INV-EXCEL-SCOPE-1, INV-AUDIT-1

**Acceptance Criteria:**
- Given Gate 2, when client downloads from detail, then file delivered and audit records source
- Given Gate 2 false, when client opens detail, then button is disabled with explanatory copy

**Test Cases:**
- E2E: download from detail vs home → assert audit log source values differ
- Integration: race condition gate flip mid-tap → returns 403 deterministically
- Unit: source attribute appended to audit payload


### UC-CL-DB-07: Browse historical period archive list
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client authenticated
- Client has at least one filed/archived period in history

**Main Flow:**
1. 1. Client taps 'Past quarters' tab or archive link
2. 2. PWA fetches /periods/archive paginated list
3. 3. Each row shows ONLY label (e.g., 'Q1 2026') + status badge ('Filed') per INV-DISP-4
4. 4. NO numbers on front face (INV-DISP-4)
5. 5. NO date picker; pure list scroll
6. 6. Newest first; infinite scroll or pagination
7. 7. Tap row to drill in (UC-CL-DB-08)

**Alternate Flows:**
- If empty (no past periods): show 'Your filed quarters will appear here once your accountant files them'
- If only 1-2 periods: no pagination chrome
- If client_staff sub-role: same view (read-only, sub-roles same on archive)

**Edge Cases:**
- Very long history (50+ periods): virtualized list to avoid jank
- Network failure: show cached list with stale indicator
- New period archived while scrolling: prepend without losing scroll position
- Concurrent firm switch (multi-firm client): list re-fetches for new tenant
- Pull-to-refresh debounced
- Label localization: Q1/Q2/Q3/Q4 must not localize digits inconsistently
- Tampered list response: client validates tenant_id on each row

**Invariants Enforced:** INV-DISP-4, INV-PERIOD-1, INV-CONF-1, INV-TENANT-1, INV-NO-DATEPICKER-1

**Acceptance Criteria:**
- Given archive list, when rendered, then no monetary figures shown on rows
- Given any row, when displayed, then only label + status badge present
- Given no past periods, when archive opens, then empty state copy shown

**Test Cases:**
- E2E: 10 archived periods → assert exactly 10 rows, no $ symbols in row text
- Integration: GET /periods/archive returns paginated set with tenant scoping
- Security: forged tenant_id in URL returns 403
- A11y: list announced as 'List, 10 items'
- Performance: 200 archived periods scroll at 60fps (virtualization)
- Unit: row component refuses to render numeric props


### UC-CL-DB-08: View filed-quarter detail with P&L and filed returns
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client authenticated
- Selected period state = 'filed' or 'archived'

**Main Flow:**
1. 1. Client taps archive row
2. 2. PWA navigates to /periods/{id}/filed
3. 3. View renders quarter label, status badge ('Filed' or 'Archived')
4. 4. P&L summary section shown (period-scoped totals)
5. 5. Filed returns section: HST returns and T2 returns grouped separately
6. 6. Each filed PDF row: filename, upload date, download button
7. 7. Excel download always available (past periods always downloadable per spec)
8. 8. No DRAFT tag (period is filed)
9. 9. No confidence %

**Alternate Flows:**
- If only HST filings: T2 section hidden with 'No T2 returns for this period' copy
- If only T2 filings: HST section hidden equivalently
- If accountant uploaded multiple revisions: show all with timestamps; latest at top

**Edge Cases:**
- Filed PDF missing despite period filed (data integrity error): show error chip; still allow Excel
- Very large PDF (50MB+): warn before download on cellular
- Filename collisions across periods: namespace by period in storage but display original
- Period in 'archived' state behaves identically to filed for download purposes
- Numbers shown in P&L must be net of HST per INV-HST-NET-1

**Invariants Enforced:** INV-FILED-PDF-1, INV-EXCEL-SCOPE-1, INV-HST-NET-1, INV-IMMUTABLE-1, INV-CONF-1

**Acceptance Criteria:**
- Given filed period, when detail opens, then P&L + grouped filed returns visible
- Given past period, when Excel tapped, then download succeeds regardless of Gate 2 current state
- Given HST + T2 PDFs, when listed, then grouped under separate headers

**Test Cases:**
- E2E: filed period with 1 HST + 2 T2 PDFs → assert two sections with correct counts
- Integration: GET /periods/{id}/filings returns grouped {hst:[], t2:[]}
- Security: client_a cannot fetch client_b filed PDF via URL guess (signed URLs scoped)
- Performance: P&L renders within 2s on 4G
- A11y: section headers announced as headings level 2


### UC-CL-DB-09: Download Excel from filed-quarter detail
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client authenticated
- Period is filed or archived

**Main Flow:**
1. 1. Client on filed-quarter detail
2. 2. Taps Excel download
3. 3. POST /periods/{id}/excel with source='filed_detail'
4. 4. Backend always allows for past periods (no Gate 2 dependency for archive)
5. 5. xlsx streamed and saved per UC-CL-DB-04 mechanics
6. 6. Audit log entry written with source

**Alternate Flows:**
- If file no longer in storage (data lifecycle issue): fall back to regeneration if data preserved, else error

**Edge Cases:**
- Repeated downloads of same period: each audit-logged
- Concurrent download attempts: idempotent
- Filename must reflect filed period not current
- Re-download after device wipe: server retains capability

**Invariants Enforced:** INV-EXCEL-SCOPE-1, INV-AUDIT-1, INV-IMMUTABLE-1

**Acceptance Criteria:**
- Given any past period, when download requested, then file delivered without gate checks
- Given each download, when completed, then audit log captures unique event

**Test Cases:**
- E2E: download Q1, Q2, Q3 of last year → assert three unique audit entries
- Integration: gate2 flag irrelevant for archived periods
- Security: signed URL TTL enforced


### UC-CL-DB-10: Download filed HST or T2 PDF from archive
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client on filed-quarter detail
- Filed PDF exists for HST or T2

**Main Flow:**
1. 1. Client taps PDF row in HST or T2 group
2. 2. PWA requests signed URL via GET /filings/{id}/download
3. 3. Backend verifies tenant + client mapping, returns short-lived URL
4. 4. PWA either opens PDF in viewer or triggers save
5. 5. Audit log: {event:'filed_pdf_download', filing_id, client_id, type:'hst'|'t2'}

**Alternate Flows:**
- If iOS: PDF opens in inline viewer with Share button
- If Android: option to view or save
- If PWA offline and PDF previously cached: serve from cache (UC-CL-DB-20)

**Edge Cases:**
- Signed URL expires before tap: re-mint on demand
- PDF corrupted in storage: 500 returned, error shown
- PDF size > 50MB on cellular: warn before download
- Tampered filing_id: 403 from backend
- Re-uploaded revisions: ensure latest URL fetched not cached old
- Permanent deletion attempt: blocked per INV-IMMUTABLE-1

**Invariants Enforced:** INV-FILED-PDF-1, INV-IMMUTABLE-1, INV-AUDIT-1, INV-TENANT-1

**Acceptance Criteria:**
- Given filed PDF, when tapped, then PDF opens or saves on device
- Given audit, when download occurs, then type (hst/t2) is recorded
- Given expired URL, when retry, then new URL minted transparently

**Test Cases:**
- E2E iOS: tap HST PDF → assert viewer opens with Share button
- Integration: signed URL TTL=300s, request after 301s returns 401, retry auto
- Security: filing_id not belonging to client returns 403
- Audit: download row written with type field populated


### UC-CL-DB-11: Share Excel or PDF via system share sheet
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- File downloaded or available via blob
- Device supports Web Share API or share sheet

**Main Flow:**
1. 1. After download (or via share affordance), client taps Share
2. 2. PWA invokes navigator.share({files:[blob]}) if supported
3. 3. OS share sheet opens (Mail, Messages, Save to Files, etc.)
4. 4. Client picks target (e.g., Mail)
5. 5. File attached; client sends
6. 6. Audit log: {event:'client_share_initiated', file_id, channel:'share_sheet'}

**Alternate Flows:**
- If Web Share API unsupported (older browser): fallback to mailto: with link or copy-link toast
- If user cancels share sheet: no audit event (intent abandoned)

**Edge Cases:**
- iOS Safari quirks: only HTTPS contexts allow share with files
- File too large for share API limits: fallback message
- User shares to insecure channel: outside PWA scope, but audit notes initiated share
- Multiple files in single share: ensure all attach correctly
- PWA installed vs browser tab: behavior parity

**Invariants Enforced:** INV-AUDIT-1

**Acceptance Criteria:**
- Given share API support, when share tapped, then OS sheet opens with file attached
- Given share initiated, when audit checked, then event recorded
- Given API unsupported, when share tapped, then graceful fallback shown

**Test Cases:**
- E2E iOS Safari PWA: share → assert sheet contains 'Mail', 'Save to Files'
- Integration: navigator.share feature detection branches correctly
- Unit: fallback path triggered when canShare returns false
- Audit: share-initiated row written


### UC-CL-DB-12: Read cached filed returns offline
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- PWA installed or visited at least once
- Client previously opened filed period detail while online
- Service worker cached metadata and PDFs

**Main Flow:**
1. 1. Client opens PWA offline
2. 2. Service worker serves shell + cached routes
3. 3. Home shows offline banner with last-sync timestamp
4. 4. Archive list renders from IndexedDB cache
5. 5. Client taps previously viewed filed period
6. 6. Detail renders P&L from cache; PDFs available if cached during prior session
7. 7. Excel download for past periods disabled (cannot mint fresh xlsx offline) with explanatory copy
8. 8. PDFs served from cache where available

**Alternate Flows:**
- If period never viewed online: show 'Not available offline' with retry-when-online CTA
- If cache eviction occurred (storage pressure): graceful empty state
- If client signs out: cache cleared (no offline access)

**Edge Cases:**
- Auth token expired while offline: read-only cached view; no mutating actions
- Network restoration mid-session: silently sync and dismiss offline banner
- Cached PDF size limits per OS quota
- Multiple clients on same device (rare): cache must be keyed by user+tenant
- Tenant switch while offline: blocked until online
- Confidence % never cached because never shown (INV-CONF-1)

**Invariants Enforced:** INV-CONF-1, INV-TENANT-1, INV-OFFLINE-READONLY-1, INV-IMMUTABLE-1

**Acceptance Criteria:**
- Given offline, when client opens PWA, then cached archive + filed details viewable
- Given offline, when client attempts Excel download, then UI explains online-only
- Given sign-out, when device goes offline, then cache is purged

**Test Cases:**
- E2E: cache filed period online, go offline (Chrome DevTools), open detail → assert P&L renders
- Integration: service worker fetch event routes to cache for /filings/* GET
- Security: offline cache encrypted at rest where supported; per-user namespace
- Performance: cached detail loads <500ms
- A11y: offline banner announced to SR


### UC-CL-DB-13: Install PWA to home screen and verify installability
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client visiting PWA in a supporting browser (Chrome, Safari, Edge)
- Manifest + service worker registered

**Main Flow:**
1. 1. After 2+ visits, browser surfaces install prompt OR client triggers via menu
2. 2. PWA shows custom 'Add to Home Screen' nudge with benefits copy
3. 3. Client accepts; OS prompts confirmation
4. 4. App installed with correct icon + name + theme color
5. 5. Standalone display mode without browser chrome
6. 6. Splash screen renders during cold start

**Alternate Flows:**
- If user dismisses: respect for 30 days before re-nudging
- If iOS (no beforeinstallprompt): show manual instructions ('Tap Share, Add to Home Screen')
- If already installed: hide nudge entirely

**Edge Cases:**
- Manifest fetch failure: install prompt suppressed
- Icon missing for required sizes: install prompt suppressed
- Update available after install: service worker shows update toast
- Two installs across browsers: each independent, both work

**Invariants Enforced:** INV-PWA-1

**Acceptance Criteria:**
- Given Chrome, when install criteria met, then prompt shown
- Given iOS, when client opens, then manual instructions accessible from menu
- Given installed app, when launched, then standalone display mode active

**Test Cases:**
- E2E Lighthouse PWA audit: assert installable=true
- Integration: manifest.json valid per spec with required fields
- Manual iOS: Add to Home Screen → assert icon + standalone launch
- Unit: install-nudge logic respects 30-day dismissal window


### UC-CL-DB-14: Handle session expiry gracefully on dashboard
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client previously authenticated; session token expired

**Main Flow:**
1. 1. Client returns to PWA (e.g., from background)
2. 2. PWA detects 401 on first API call
3. 3. UI shows 'Session expired, please sign in again'
4. 4. Deep link / intended route preserved
5. 5. Client re-authenticates
6. 6. Routed back to original target (home or specific detail)

**Alternate Flows:**
- If refresh token still valid: silent refresh without UX disruption
- If MFA required: prompt accordingly
- If client's account disabled: show contact-firm message

**Edge Cases:**
- Mid-download session expiry: download fails, prompt re-auth, optionally retry
- Concurrent tabs re-auth: token shared via storage event
- Clock skew causing premature expiry: tolerate small drift
- Replay attempts blocked server-side

**Invariants Enforced:** INV-AUTH-1, INV-AUDIT-1

**Acceptance Criteria:**
- Given expired token, when API called, then re-auth flow triggered
- Given re-auth success, when complete, then user returned to original route
- Given disabled account, when re-auth attempted, then specific message shown

**Test Cases:**
- E2E: expire token via clock advance → assert re-auth flow
- Security: expired token cannot fetch data even with valid client_id
- Audit: re-auth event logged


### UC-CL-DB-15: Switch between multiple firm engagements (multi-tenant client)
**Actor:** Client (client_owner) | **Priority:** P2 | **Platform:** mobile

**Preconditions:**
- Client account associated with two or more firms (tenants)

**Main Flow:**
1. 1. Client opens app; profile menu shows current firm
2. 2. Client taps firm switcher
3. 3. Sheet lists firms with tenant names
4. 4. Client picks alternate firm
5. 5. PWA clears in-memory state, re-fetches all data scoped to new tenant_id
6. 6. RLS enforces backend isolation

**Alternate Flows:**
- If only one firm: switcher hidden
- If new firm just added by operator/firm admin: appears after refresh

**Edge Cases:**
- Cached data must not bleed across tenants (INV-TENANT-1)
- Offline switch: blocked
- Mid-action (e.g., download in flight): cancel before switch
- URL deep links must include tenant context or fail safely

**Invariants Enforced:** INV-TENANT-1, INV-RLS-1

**Acceptance Criteria:**
- Given multi-firm client, when switching, then all data is re-fetched for new tenant
- Given switched tenant, when cache inspected, then no other tenant data present

**Test Cases:**
- E2E: switch firm → assert archive list, current period both update
- Security: try fetching old tenant period after switch → 403
- Unit: state reset utility clears all caches on tenant change


### UC-CL-DB-16: Render in low-bandwidth and offline-first conditions
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client on slow 3G or intermittent connection

**Main Flow:**
1. 1. Client opens PWA
2. 2. App shell + critical CSS loads first (under 100KB gzipped)
3. 3. Heading + skeleton renders within 1.5s
4. 4. Data fetched progressively; HST area populates last
5. 5. Network status banner appears if offline
6. 6. Stale data shown with timestamp until fresh available

**Alternate Flows:**
- If totally offline at cold start and not cached: minimal offline page with retry
- If intermittent: SWR pattern revalidates on focus

**Edge Cases:**
- Lie-fi (connected but no throughput): timeout after 10s, surface error
- Service worker registration race on first install
- Image-heavy filed PDFs: lazy load thumbnails

**Invariants Enforced:** INV-PERF-1, INV-OFFLINE-READONLY-1

**Acceptance Criteria:**
- Given 3G throttle, when home loads, then heading visible within 1.5s
- Given intermittent network, when reconnected, then data revalidates

**Test Cases:**
- Performance: Lighthouse score >=90 on Mobile
- E2E: throttle to Slow 3G → assert critical path renders quickly
- Integration: service worker stale-while-revalidate verified


### UC-CL-DB-17: Comply with accessibility standards on mobile (VoiceOver, dynamic type, contrast)
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client uses assistive tech (VoiceOver/TalkBack) or dynamic text settings

**Main Flow:**
1. 1. Client enables VoiceOver
2. 2. Opens PWA
3. 3. Focus order: heading → state badge → main numbers → CTAs
4. 4. All interactive elements have accessible names and roles
5. 5. Color contrast >= 4.5:1 for text, 3:1 for large/UI
6. 6. Dynamic Type up to 200% does not break layout
7. 7. Touch targets >= 44x44 pt (iOS) / 48dp (Android)

**Alternate Flows:**
- If reduced motion: disable confetti / spring animations
- If high contrast OS setting: prefer system colors

**Edge Cases:**
- DRAFT tag must be readable by SR not just visual
- Status icons need aria-labels (yellow/red flags) without revealing confidence
- Number formatting read correctly (currency, thousands)
- RTL languages not in MVP but layout should not break if added
- Headings hierarchy correct (h1 → h2)

**Invariants Enforced:** INV-A11Y-1, INV-DISP-1, INV-CONF-1

**Acceptance Criteria:**
- Given VoiceOver, when home loads, then DRAFT and HST headlines read correctly
- Given Dynamic Type 200%, when rendered, then no truncation of headings
- Given audit, when run, then axe-core reports 0 critical violations

**Test Cases:**
- A11y automated: axe-core on every route, 0 critical issues
- Manual iOS: VoiceOver swipe through home → assert reading order
- Visual: simulate Dynamic Type 200%/235% → assert layout integrity
- Contrast: each color combo measured >= AA
- Touch target audit: every tappable >= 44pt


### UC-CL-DB-18: Pull-to-refresh and live update of dashboard state
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client on home or detail view

**Main Flow:**
1. 1. Client performs pull-to-refresh gesture
2. 2. PWA fetches latest period state
3. 3. Spinner indicates refresh in progress
4. 4. Card transitions to new state if changed (e.g., Pending → Processed)
5. 5. Toast confirms 'Up to date' or shows specific change

**Alternate Flows:**
- Background WebSocket push triggers state change without manual refresh
- Polling fallback every 60s when WS unavailable

**Edge Cases:**
- Rapid repeated pulls: debounce
- Refresh during ongoing download: don't cancel download
- Server returns same state: no UI flicker
- Refresh while offline: show offline toast, do not error
- State regression illegal per machine: surface server-side error gracefully

**Invariants Enforced:** INV-PERIOD-1, INV-GATE-1, INV-GATE-2

**Acceptance Criteria:**
- Given pull gesture, when released, then refresh runs at most once per second
- Given offline, when pull triggered, then offline indicator shown

**Test Cases:**
- E2E: pull-to-refresh transitions Pending→Processed after flags cleared server-side
- Integration: WS event emits to subscribed client only
- Unit: debounce throttle correct


### UC-CL-DB-19: Handle permission denial when client_staff attempts owner-only action
**Actor:** Client (client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client authenticated as client_staff sub-role
- Action requires client_owner (e.g., submit feedback, restricted by firm config)

**Main Flow:**
1. 1. client_staff opens home; UI hides owner-only CTAs based on role claim
2. 2. If staff attempts via deep link or stale UI: backend returns 403
3. 3. UI shows 'Only the business owner can do this' message
4. 4. Audit log records denied attempt

**Alternate Flows:**
- If staff role escalated by owner: UI reflects on next session

**Edge Cases:**
- Client_staff can still view dashboard (read access)
- Client_staff Excel download allowed per firm policy (configurable)
- Token tampering: server rejects
- Role changes mid-session: UI re-evaluates on next route change

**Invariants Enforced:** INV-RBAC-1, INV-AUDIT-1

**Acceptance Criteria:**
- Given client_staff, when owner-only action attempted, then denied with clear message
- Given denial, when audit checked, then logged event present

**Test Cases:**
- E2E: login as client_staff → assert owner CTAs hidden
- Security: client_staff bypass attempt via direct API → 403
- Audit: denied attempt row present


### UC-CL-DB-20: Surface error recovery for failed downloads
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client attempts Excel or PDF download

**Main Flow:**
1. 1. Download initiated
2. 2. Network fails or backend 5xx
3. 3. PWA shows error toast with Retry button
4. 4. Client taps Retry; same idempotent request issued
5. 5. On success, file delivered as normal
6. 6. Failed attempts also audit-logged

**Alternate Flows:**
- If repeated failures (3+): suggest 'Try again later' with support link
- If 403: do not auto-retry; surface permission error
- If 401: re-auth then retry once

**Edge Cases:**
- Partial download (incomplete file): discard on client, mark audit as failed
- Backend rate limit (429): exponential backoff
- Storage write failure on device: differentiate from network error
- User backgrounds app mid-download: resume if possible, else cancel cleanly

**Invariants Enforced:** INV-AUDIT-1, INV-IDEMPOTENCY-1

**Acceptance Criteria:**
- Given failed download, when retry tapped, then second attempt is idempotent
- Given 5xx, when error shown, then includes Retry CTA
- Given 3 failures, when surfaced, then support contact provided

**Test Cases:**
- E2E: simulate 500 on /excel → assert error toast + Retry
- Integration: retry uses same request-id; backend dedupes
- Unit: backoff schedule correct


### UC-CL-DB-21: First-time onboarding empty state for brand-new client
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client just accepted invite; no periods active yet OR first period in 'open' state with no docs

**Main Flow:**
1. 1. Client lands on home
2. 2. Welcome card shows firm name + accountant intro
3. 3. 'Where this quarter stands' heading still renders per INV-DISP-1
4. 4. Locked state with onboarding copy
5. 5. Primary CTA: 'Upload your first documents' → docs flow
6. 6. Secondary CTA: 'How this works' → help page

**Alternate Flows:**
- If period not yet created by firm: show 'Your firm is setting up your first quarter'
- If accountant assigned but client hasn't been welcomed: show generic empty

**Edge Cases:**
- Multi-firm new client: show welcome per firm context
- Already-onboarded but no docs: subtle nudge not full welcome
- Help link offline: caches help page for offline view

**Invariants Enforced:** INV-DISP-1, INV-CONF-1

**Acceptance Criteria:**
- Given brand-new client, when home opens, then welcome + heading present
- Given no period: appropriate empty copy shown

**Test Cases:**
- E2E: new client invite → first home view assert welcome card
- A11y: onboarding announced clearly via SR


### UC-CL-DB-22: Display HST refund vs payable headline correctly across edge values
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Period Gate 1 met; HST data available

**Main Flow:**
1. 1. Card renders HST headline
2. 2. If line 109 > 0: 'HST payable: $X' in neutral/red emphasis
3. 3. If line 109 < 0: 'HST refund: $X' in neutral/green emphasis
4. 4. If line 109 = 0: 'No HST owing'
5. 5. Lines 105 and 108 always shown below regardless

**Alternate Flows:**
- If HST not applicable to this firm/client (rare): hide HST section entirely
- If correction entries flip sign post-processing: live update

**Edge Cases:**
- Very small amounts (under $1): show 2 decimals, no rounding to zero
- Very large (>$1M): comma formatting, no overflow
- Negative ITCs: still rendered as positive on line 108
- Currency symbol consistent ($CAD)
- Rounding must mirror backend, not recomputed
- Color must not be sole indicator (icon/text also distinguish)

**Invariants Enforced:** INV-HST-NET-1, INV-HST-LINES-1, INV-DISP-1, INV-CONF-1

**Acceptance Criteria:**
- Given line 109 sign, when displayed, then correct headline variant rendered
- Given $0 net, when shown, then 'No HST owing' message
- Given numeric, when displayed, then exactly matches backend value

**Test Cases:**
- Unit: hstHeadlineMapper covers positive/negative/zero/null
- Integration: backend value $1,234.56 → UI text exactly matches
- Visual regression: refund + payable variants
- A11y: color not sole indicator, text/icon distinguishes
- Edge: extremely large amount renders with commas


### UC-CL-DB-23: Verify no date picker anywhere in client UI
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Any view in client PWA

**Main Flow:**
1. 1. Audit every screen (home, detail, archive, filed detail, settings)
2. 2. No <input type='date'> or custom date pickers present
3. 3. Period navigation is via labeled rows only (e.g., 'Q1 2026')
4. 4. Excel downloads are period-scoped, not date-range

**Alternate Flows:**
- If client tries deep-link with date param: ignored; resolves to current period

**Edge Cases:**
- Hidden date inputs (e.g., for filter state) prohibited
- Calendar emojis fine; not interactive pickers
- Native browser date attribution on form fields not used

**Invariants Enforced:** INV-NO-DATEPICKER-1, INV-PERIOD-1, INV-EXCEL-SCOPE-1

**Acceptance Criteria:**
- Given any route, when DOM inspected, then zero date pickers present
- Given deep link with date param, when loaded, then param ignored

**Test Cases:**
- Automated audit: grep all rendered DOM for input[type=date] / [role=calendar] → 0 matches
- E2E: spider all client routes; assert no date picker components


### UC-CL-DB-24: Verify confidence percentage never surfaces in client UI or payloads
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Any view in client PWA

**Main Flow:**
1. 1. All API responses to client filtered server-side to omit confidence fields
2. 2. UI components have type signatures that exclude confidence
3. 3. Flag icons use source color only
4. 4. Tooltips, modals, accessibility labels all free of confidence references

**Alternate Flows:**
- If backend bug leaks confidence: UI ignores field; QA detects

**Edge Cases:**
- Even debug overlays must not show confidence in client context
- Network responses inspected for compliance
- Audit log on client side does not record confidence

**Invariants Enforced:** INV-CONF-1, INV-FLAG-COLOR-1

**Acceptance Criteria:**
- Given any payload, when inspected, then no confidence field present
- Given any DOM, when searched, then no '%' adjacent to flag or number

**Test Cases:**
- Security: snapshot every client API response → assert confidencePct undefined
- Static: TS type Client.FlagDTO excludes confidence
- E2E: search rendered text on every route for 'confidence' or '%' → 0
- Unit: serializer for client context strips confidence even if upstream sets it


### UC-CL-DB-25: Audit and observability for client dashboard interactions
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client performs any state-changing or download action

**Main Flow:**
1. 1. Each significant event (login, excel download, pdf download, share, flag answer, feedback submit) sent to audit log
2. 2. Append-only log includes {event, actor_id, tenant_id, period_id, ts, ip, user_agent}
3. 3. Operational signals (turnaround, flag reply lag) recorded silently — never shown to client
4. 4. Logs used only by firm side and platform (operator restricted from financial data)

**Alternate Flows:**
- If audit write fails: queue locally + retry; do not block UX
- If operator access requested: log access redacts financial fields

**Edge Cases:**
- Clock skew: server timestamp authoritative
- Bulk events from offline backlog: dedupe via request-id
- PII redaction in logs as needed
- Audit log permanently retained per data retention policy in ca-central-1

**Invariants Enforced:** INV-AUDIT-1, INV-OPSIGNAL-SILENT-1, INV-DATA-RESIDENCY-1, INV-OPERATOR-NOREAD-1

**Acceptance Criteria:**
- Given any download or feedback, when performed, then audit row written within 1s
- Given operational signals, when recorded, then never exposed in client API
- Given residency, when stored, then ca-central-1 only

**Test Cases:**
- Integration: each instrumented action produces exactly one audit row
- Security: operator role cannot SELECT financial columns even via direct DB role
- Compliance: storage region assertion = ca-central-1
- Resilience: queue + retry on transient audit-store failure


## Client (Owner) (mobile)

### UC-CL-FB-01: Receive Gate-2 Feedback Availability Notification
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client is registered to a tenant firm with active engagement
- Period has reached state 'complete' (Gate 2 explicitly toggled by accountant)
- Feedback for this period has not been submitted yet
- Client has push notifications enabled OR has email fallback configured
- Client session/device is registered for PWA notifications

**Main Flow:**
1. Backend transitions period from 'processed' to 'complete' via accountant action
2. FeedbackService creates a pending FeedbackInvitation row (period_id, tenant_id, client_user_id, status='pending', created_at)
3. Notification dispatcher fires a single light push: 'Your [Q2 2026] review is ready'
4. Client receives push on mobile device (PWA service worker shows notification)
5. Tapping the notification deep-links to /feedback/period/:periodId with auth check
6. App C verifies session validity; if expired, redirects to login then back to feedback route
7. Feedback intro screen loads showing period label, firm name, and 'Start review' CTA
8. Tap on 'Start review' opens the feedback form UC-CL-FB-03

**Alternate Flows:**
- If push permission was denied, send fallback email with deep link
- If client has multiple firms, notification specifies firm name in the title
- If client_staff sub-role is logged in instead of owner, notification still arrives but submission rules differ (see UC-CL-FB-15)
- If user dismisses notification, badge count remains on app icon until opened or submitted

**Edge Cases:**
- Period flips back from complete to processed before client taps (rare regression) — feedback intro shows 'Not yet available, your accountant is finalizing'
- Notification arrives during DST changeover; period label uses firm-local timezone, not device
- Multiple periods become available within a short window — only the latest pending invitation triggers a push; older ones are surfaced via UC-CL-FB-13 backlog
- Service worker not yet registered (first visit) — notification queued until next foreground open
- Device offline — push queued by FCM/APNS; on reconnect, delivered with original timestamp
- User reinstalls PWA — re-registers device token; older token invalidated; no duplicate notifications

**Invariants Enforced:** INV-FB-1: Feedback only surfaces at Gate 2 (complete state), INV-FB-2: One feedback invitation per period per client, INV-TENANT-1: Notifications scoped to tenant_id, INV-AUTH-1: Deep link enforces session auth

**Acceptance Criteria:**
- Given a period transitions to 'complete', when 60 seconds have passed, then exactly one push notification is dispatched to the registered client_owner device
- Given the client taps the notification, when authenticated, then the feedback intro screen for that specific period loads within 2 seconds on 4G
- Given push permission is denied, when period reaches complete, then an email is sent with deep link instead
- Given the period regresses from complete, when client opens feedback, then a 'not available' message is shown and no submission is possible
- Given two periods reach complete simultaneously, when notifications dispatch, then only one consolidated or latest push is sent (no spam)

**Test Cases:**
- Unit: FeedbackInvitation creation only triggers when prior state was 'processed' and new state is 'complete'
- Unit: Notification payload contains period label localized to firm timezone
- Integration: Mock period state transition to complete, verify push dispatcher called exactly once with correct tenant scope
- Integration: Verify email fallback fires when device has no push token
- E2E: Trigger gate 2 on staging firm, confirm PWA receives push within 60s on a registered device
- E2E: Tap notification while logged out, verify auth flow then redirect to correct period feedback screen
- Security: Confirm notification payload does not leak any financial figures or staff names
- Security: Confirm tenant_id isolation — client of firm A never receives push for firm B
- Accessibility: Notification text passes screen reader (VoiceOver/TalkBack) read-aloud test
- Performance: Notification fan-out for 10k complete-transitions/min stays within SLA


### UC-CL-FB-02: View Feedback Intro Card on Home Screen
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client is authenticated on App C
- At least one period for any of client's businesses is at state 'complete' with pending feedback
- Client has not yet submitted feedback for that period

**Main Flow:**
1. Client opens PWA home/dashboard
2. Client app calls GET /api/v1/client/feedback/pending
3. Backend returns list of pending invitations (period_id, period_label, firm_name, deadline_hint)
4. Home screen renders a prominent card: 'Your [Q2 2026] review is ready — 2 minutes'
5. Card includes period label, estimated time, and 'Start' button
6. Card shows soft progress dots indicating: 3 base ratings (always) + up to 2 follow-ups (configurable)
7. Tapping 'Start' navigates to feedback flow

**Alternate Flows:**
- If multiple pending feedbacks exist, show a stacked list ordered by period end date (newest first)
- If client has zero pending feedback, the card slot shows recent submitted feedback summary or hides entirely
- If client_staff sub-role and firm policy disallows staff submission, card shows 'Owner must complete' with disabled CTA

**Edge Cases:**
- API returns empty list — empty state with 'You're all caught up' microcopy
- Network failure — card shows skeleton then a 'Tap to retry' fallback
- Card race condition: period archived between fetch and tap — flow defends with 'No longer available'
- Card persists after submission until next sync — local cache invalidation on submit
- Long firm name — text truncates with ellipsis, full name on long-press
- Right-to-left locale — card mirrors layout

**Invariants Enforced:** INV-FB-3: Card only shows for state=complete and not-yet-submitted, INV-TENANT-1: API scoped via session tenant context, INV-RBAC-1: Sub-role policy enforced on CTA enable

**Acceptance Criteria:**
- Given pending feedback exists, when home loads, then the feedback card appears above the fold
- Given no pending feedback, when home loads, then no card slot is rendered
- Given network fails, when home loads, then a retry affordance is shown without crashing
- Given multiple pending feedbacks, when home loads, then they are ordered newest-first and all are tappable

**Test Cases:**
- Unit: Pending feedback selector returns only items with state=complete and submitted=false
- Integration: GET /feedback/pending honors tenant_id from session JWT
- E2E: Submit feedback, refresh home, card disappears
- E2E: Two pending feedbacks render in expected order
- Accessibility: Card is focusable, has aria-label including period and firm, tap target >= 44x44pt
- Performance: Endpoint p95 < 300ms with 50 pending items


### UC-CL-FB-03: Open Feedback Form for a Specific Period
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client authenticated
- Pending feedback invitation exists for the period
- Session is valid and not expired

**Main Flow:**
1. Client taps 'Start' on card or notification deep link
2. App C navigates to /feedback/period/:periodId
3. Frontend calls GET /api/v1/client/feedback/:periodId/form
4. Backend validates: (a) period belongs to client's tenant, (b) period state is 'complete', (c) feedback not yet submitted, (d) sub-role permitted
5. Backend evaluates operational signals against firm thresholds and returns up to N auto-prompt questions (N = firm-configured cap, default 2)
6. Response includes: period_label, firm_name, base_ratings_schema, auto_prompts (with soft copy), allow_freeform, cap, submission_id (idempotency key)
7. Form renders: 3 base ratings, optional freeform field, conditional auto-prompt section, 'Submit' button (initially disabled)

**Alternate Flows:**
- If period not in complete state, return 409 with 'not available' state
- If feedback already submitted, return 200 with read-only confirmation payload, route to UC-CL-FB-12
- If client_staff and firm disallows, return 403; UI shows 'Owner must complete'
- If firm has disabled feedback entirely (rare), endpoint returns 204; UI shows 'Feedback collection paused'

**Edge Cases:**
- Period archived between card load and form open — show 'archived' message
- Auto-prompt evaluation depends on stale signals; backend uses signal snapshot taken at gate 2
- Firm changed cap from 2 to 0 right before open — form renders zero auto-prompts but base ratings still required
- Slow network — show skeleton form with shimmer; do not allow submit until data loads
- Form opens twice (deep link + card tap) — same submission_id reused (idempotent)
- User force-closes app mid-load — next open re-fetches form fresh

**Invariants Enforced:** INV-FB-4: Auto-prompts capped at firm-configured number (default 2), INV-FB-5: Submit gated on three base ratings only (auto-prompts skippable), INV-FB-6: Soft copy used in auto-prompts; staff names and raw metrics never exposed, INV-TENANT-1: Tenant-scoped access, INV-RBAC-1: Sub-role gating

**Acceptance Criteria:**
- Given a valid pending invitation, when form opens, then 3 base rating controls render with no preselected value
- Given firm cap is 2 and 4 signals tripped, when form loads, then only 2 auto-prompts render (top-priority per firm config)
- Given firm cap is 0, when form loads, then no auto-prompts render and submit only requires base ratings
- Given a staff sub-role is blocked, when form is requested, then 403 is returned and UI shows clear messaging
- Given submission already exists, when form is requested, then read-only confirmation view loads

**Test Cases:**
- Unit: Auto-prompt selector picks top-N by firm priority order when more than cap tripped
- Unit: Soft copy template substitution never includes raw metric numbers or staff identifiers
- Integration: Form endpoint returns 409 when period not complete
- Integration: Submission_id is deterministic per (period_id, client_user_id)
- E2E: Owner opens form successfully; staff (when blocked) sees 403 UI
- Security: Attempt to load form for another tenant's period returns 403/404 (RLS)
- Security: API response body verified to never include confidence percentages or operational signal raw values
- Accessibility: Form controls are reachable via screen reader in logical order


### UC-CL-FB-04: Provide Three Base Ratings (Quality, Service, App)
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Feedback form loaded successfully
- Period state is 'complete' and feedback not submitted

**Main Flow:**
1. Client sees three rating rows: 'Quality of work', 'Service & communications', 'App experience'
2. Each row displays 5 large tap targets (>= 44x44pt) labeled 1–5 with star or numeric variant
3. Client taps a value for Quality (e.g., 4)
4. Selection visually confirmed (filled state, haptic feedback if supported)
5. Client taps Service value
6. Client taps App value
7. Submit button becomes enabled only after all three are set
8. State stored locally (in-memory + sessionStorage) for refresh resilience

**Alternate Flows:**
- Client uses swipe gesture across the row instead of tap — value updates as finger moves; release commits
- Client uses keyboard (external Bluetooth) — arrow keys navigate, space/enter selects
- Client uses screen reader — each star announced with current value and 'rate X stars' role

**Edge Cases:**
- Client rapidly double-taps — debounced; only last value retained
- Client taps then immediately swipes — swipe wins, no oscillation
- Client refreshes browser mid-rating — sessionStorage rehydrates selections (since not yet submitted)
- Local storage cleared by OS — form resets to blank with no error
- Very small screen (320px) — rating cells flex without overflow
- VoiceOver user — selection is announced ('Quality rated 4 out of 5')
- Network lost mid-rating — no impact (no API calls until submit)

**Invariants Enforced:** INV-FB-5: All three base ratings required before submit enables, INV-A11Y-1: Tap target >= 44x44pt, INV-A11Y-2: Swipe alternative supported for ratings, INV-FB-7: Ratings range 1–5 integer only

**Acceptance Criteria:**
- Given form is open, when only 2 of 3 ratings are set, then Submit remains disabled
- Given all 3 ratings are set, when client taps Submit, then submit endpoint is called
- Given client refreshes after partial input, when form reloads, then prior selections rehydrate from sessionStorage
- Given screen reader is active, when client navigates ratings, then each control announces label and current value
- Given a swipe gesture, when finger moves across stars, then value updates live and commits on release

**Test Cases:**
- Unit: Submit disabled state derives from (qualityRating && serviceRating && appRating)
- Unit: Rating must be integer 1–5; invalid values rejected client and server side
- Integration: SessionStorage hydration restores pending form state on refresh
- E2E: Set all 3 ratings via tap, verify Submit becomes enabled
- E2E: Set ratings via swipe gesture, verify same enablement
- Accessibility: axe-core scan reports zero violations on form
- Accessibility: VoiceOver/TalkBack reads correct semantics for each rating row
- Performance: Rating tap renders feedback within 100ms


### UC-CL-FB-05: Answer Auto-Prompt Follow-Up Questions
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Form loaded with one or more auto-prompts (firm thresholds tripped)
- Auto-prompt cap > 0
- Period state remains 'complete'

**Main Flow:**
1. Auto-prompt section renders below base ratings with header 'A couple of quick questions'
2. Each auto-prompt displays soft-copy question (e.g., 'How was the turnaround time this period?')
3. Each auto-prompt has 1–5 rating control AND optional one-line freeform
4. Client taps a rating value for prompt 1
5. Client optionally adds short free-text
6. Client repeats for prompt 2 (if present)
7. Client may tap 'Skip' to leave any/all auto-prompts blank without invalidating submit
8. Backend stores rating ↔ signal linkage on submit (which signal triggered which question)

**Alternate Flows:**
- Client skips all auto-prompts — Submit still enabled if base ratings done; backend logs which were skipped
- Client answers only one of two prompts — partial answers accepted
- Freeform field exceeds char limit (default 500) — soft warning at 450, hard cap at 500

**Edge Cases:**
- Backend re-evaluates signals between form load and submit (e.g., firm changes threshold) — server uses snapshot from form load (form-bound)
- Auto-prompt text contains apostrophes/special chars — properly escaped, no XSS
- Client pastes very long string (>500 chars) — clipped on paste with warning
- Auto-prompt freeform contains profanity — not blocked; firm-side moderation only
- Soft copy must never name a specific staff member — enforced via template registry whitelist
- Client rapidly switches values — last-write-wins per prompt

**Invariants Enforced:** INV-FB-4: Cap enforced (no more than N prompts), INV-FB-6: Soft copy only — never raw metrics or staff names, INV-FB-8: Rating ↔ signal linkage persisted on submission, INV-FB-9: Auto-prompts skippable; do not gate submit, INV-CLIENT-1: Operational signal raw values never sent to client (only the templated question)

**Acceptance Criteria:**
- Given 2 auto-prompts render, when client answers neither, then submit is still enabled
- Given client answers one prompt, when submit fires, then exactly one prompt response is persisted with its source signal id
- Given freeform exceeds 500 chars, when client types, then input is capped at 500
- Given the soft-copy template, when rendered, then it never includes raw metric values or staff names
- Given backend evaluates signals at form load, when client submits later, then signal snapshot used for linkage is from form load

**Test Cases:**
- Unit: Auto-prompt template registry rejects templates containing raw metric placeholders or staff name placeholders
- Unit: Skip leaves prompt response as null but signal linkage still recorded
- Integration: Submission persists rating ↔ signal_id mapping for each answered prompt
- E2E: Trigger threshold breach, complete period, verify expected prompt copy renders
- E2E: Skip both prompts, submit succeeds, verify backend recorded skip with linkage
- Security: Confirm no signal raw values appear in any network response visible to client
- Security: Attempt to inject HTML in freeform — sanitized server-side
- Accessibility: Auto-prompt section has logical heading hierarchy and labeled controls


### UC-CL-FB-06: Add Optional Freeform Comment
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Form loaded
- Firm has freeform comments enabled (default on)

**Main Flow:**
1. Client sees an optional textarea labeled 'Anything else? (optional)' at the bottom of the form
2. Client taps to focus; mobile keyboard opens
3. Client types up to 1000 chars (firm-configurable)
4. Character counter updates live (e.g., '120 / 1000')
5. Field auto-saves to sessionStorage every 5 seconds
6. Client can collapse/expand the field with a chevron

**Alternate Flows:**
- Firm disables freeform — section hidden entirely
- Client uses voice dictation — accepted as plain text
- Client pastes from clipboard — formatting stripped to plain text

**Edge Cases:**
- Char limit reached — input rejects further keystrokes; counter shows red
- Unicode emoji and CJK characters counted by codepoint, not byte
- Right-to-left text mixes with LTR — display preserves bidi correctly
- Mobile keyboard covers the field — viewport auto-scrolls to keep field visible
- Browser refresh — sessionStorage restores draft
- Switching apps and returning — draft persists
- Field contains only whitespace — treated as empty on submit

**Invariants Enforced:** INV-FB-10: Freeform comments are optional and never required, INV-FB-11: Server-side length validation matches client-side cap, INV-XSS-1: HTML stripped/escaped server-side

**Acceptance Criteria:**
- Given the field is empty, when client submits, then submission succeeds without freeform
- Given client enters 1001 chars, when client types the 1001st, then input is rejected
- Given client pastes HTML, when stored, then HTML tags are escaped
- Given client switches app and returns within session, when field is restored, then content is preserved
- Given whitespace-only text, when submitted, then freeform stored as null

**Test Cases:**
- Unit: Char counter increments per codepoint (emoji = 1)
- Unit: Trim/empty detection treats whitespace-only as null
- Integration: POST persists freeform with HTML escaped
- E2E: Type, refresh, verify draft restored
- E2E: Voice dictation input accepted
- Security: Inject <script> — server returns sanitized stored value
- Accessibility: Textarea has visible label, character counter announced via aria-live


### UC-CL-FB-07: Edit Ratings Before Final Submission
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Form loaded with at least one rating set
- Submit has not yet been pressed/confirmed

**Main Flow:**
1. Client taps a previously-set rating star to change value
2. New value replaces old visually with animated transition
3. Submit button remains enabled (still has all 3 base ratings)
4. Client may edit freeform and auto-prompts similarly any number of times
5. Local sessionStorage updates with each change

**Alternate Flows:**
- Client taps the same value already selected — no-op (or, optionally, deselect if firm allows; default no-op)
- Client clears freeform by deleting all text — field becomes empty draft
- Client swipes to change rating — replaces prior value

**Edge Cases:**
- Client edits in rapid succession — debounce keeps UI responsive
- Client edits down from 5 to 1 — no warning prompt (allowed)
- Edits while offline — all local; submit will sync (see UC-CL-FB-09)
- Edits to an auto-prompt that has been removed by a re-render (cap changed) — old value discarded gracefully

**Invariants Enforced:** INV-FB-12: Pre-submit edits unrestricted, INV-FB-13: Only final submitted state is persisted server-side

**Acceptance Criteria:**
- Given a rating is set, when client taps a different value, then UI updates to the new value
- Given multiple edits, when client submits, then only the latest value is sent to backend
- Given local edit, when no submit yet occurs, then no API call is made

**Test Cases:**
- Unit: Last-write-wins for each field in local state
- E2E: Set, change, change again, submit — backend receives final values only
- Accessibility: Re-tapping a rating control announces new value via aria-live


### UC-CL-FB-08: Submit Completed Feedback
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- All three base ratings set
- Form was loaded with a valid submission_id (idempotency key)
- Period still in 'complete' or beyond ('filed'/'archived' allowed for late submission per firm policy)

**Main Flow:**
1. Client taps 'Submit' button
2. Submit button shows loading state and is disabled to prevent double-tap
3. Client app POSTs to /api/v1/client/feedback/:periodId with payload {submission_id, ratings, prompts[], freeform}
4. Backend validates: tenant scope, sub-role permission, period state allows submission, submission_id not already used (idempotent), ratings in 1–5
5. Backend persists Feedback row with attribution (client_user_id, sub_role), timestamps (submitted_at), period_id, rating-to-signal linkages, signal snapshot id
6. Backend writes audit log entry (append-only): 'feedback.submitted'
7. Backend returns 200 with confirmation payload
8. Client navigates to confirmation screen (UC-CL-FB-12)
9. Home card for that period disappears on next sync

**Alternate Flows:**
- Server returns 409 (already submitted) — UI navigates to read-only confirmation
- Server returns 422 (validation) — UI highlights offending field and re-enables submit
- Server returns 503 — UI shows retry CTA; local draft preserved
- Period regressed to 'processed' just before submit — server returns 409 with explanation; UI shows 'Period reopened, feedback paused'

**Edge Cases:**
- Double-tap submit — single request fires due to disabled button + idempotency key
- Network drops mid-request — UI shows retry; idempotency key allows safe retry
- Token expired mid-submit — UI prompts re-auth then retries with same submission_id
- Clock skew between client and server — backend uses server timestamp authoritatively
- Concurrent submission from two devices logged in as same user — first write wins, second returns 409
- Backend write succeeds but response lost — client retries with same submission_id, gets 200 with same record (no duplicate)
- Very slow network — client shows progress indicator, does not time out before 30s

**Invariants Enforced:** INV-FB-13: Submission immutable post-write, INV-FB-14: Idempotent submission via submission_id, INV-AUDIT-1: Append-only audit log entry created, INV-FB-15: Attribution to client_user_id and sub_role recorded, INV-FB-8: Rating-signal linkage stored, INV-TENANT-1: Tenant_id stamped on row, RLS enforced

**Acceptance Criteria:**
- Given valid form data, when submit succeeds, then a single Feedback row exists with submitted_at and attribution
- Given a retry with the same submission_id, when called again, then no duplicate row is created and same response is returned
- Given submission succeeds, when audit log queried, then exactly one append entry exists
- Given period regressed, when submit fires, then 409 is returned and no row is written
- Given concurrent submissions, when both arrive, then exactly one persists and the other returns 409

**Test Cases:**
- Unit: Validation rejects rating outside 1–5
- Unit: Idempotency check uses (tenant_id, period_id, client_user_id, submission_id) composite
- Integration: Double-submit with same key — second call returns first record without insert
- Integration: Audit log entry asserts append-only (no update column)
- E2E: Submit, refresh, see confirmation (no re-edit available)
- Security: Attempt to submit for another tenant's period returns 403/404
- Security: Attempt to submit while staff sub-role blocked returns 403
- Performance: P95 submission < 500ms
- Reliability: Simulate network drop after server write; client retry receives same submission record
- Accessibility: Loading state announces 'Submitting feedback' via aria-live


### UC-CL-FB-09: Handle Offline Submission Gracefully
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Form completed (3 base ratings)
- Device is offline at moment of submit
- Service worker is registered (PWA)

**Main Flow:**
1. Client taps Submit while offline
2. Service worker intercepts POST and queues in IndexedDB (background sync)
3. UI shows 'Saved — will submit when online' with offline icon
4. Form moves to a 'pending sync' state, still locked from edits
5. When connectivity returns, service worker replays the queued POST with original submission_id
6. Backend processes idempotently; returns 200
7. Client receives sync success; UI updates to confirmation state
8. Local notification: 'Your [Q2] feedback submitted'

**Alternate Flows:**
- Background sync unsupported (older browser) — UI shows 'Tap to retry when online'; client manually re-submits
- Connectivity returns but server returns 409 (period archived) — UI shows error; offers to view archived submission
- User wipes browser data before sync — queued submission lost; on next open, form is available again (with original submission_id since deterministic)

**Edge Cases:**
- Battery saver mode delays background sync — eventual delivery within OS policy
- Multiple offline submits for different periods — queue preserves order with separate keys
- User closes PWA before sync — sync resumes on next launch via service worker registration
- Sync succeeds but UI not refreshed — next foreground triggers state refresh from server
- Conflicting offline edit (rare via two devices) — server-side idempotency key resolves to single write

**Invariants Enforced:** INV-FB-14: Idempotency via submission_id survives offline replay, INV-PWA-1: Background sync uses service worker queue, INV-FB-13: Once server-confirmed, immutable

**Acceptance Criteria:**
- Given offline, when client submits, then UI confirms 'will submit when online'
- Given connectivity returns, when service worker replays, then backend persists exactly one record
- Given background sync unsupported, when client submits offline, then UI provides manual retry
- Given user wipes PWA data, when reopened, then form is presented fresh (and submission_id is regenerated deterministically)

**Test Cases:**
- Unit: IndexedDB queue serializes payload with submission_id
- Integration: Mock offline + reconnect, verify single backend write
- E2E: Use Chrome devtools offline mode, submit, go online, verify confirmation
- Reliability: Wipe data mid-queue, verify graceful re-entry to form
- Accessibility: Offline status announced via aria-live


### UC-CL-FB-10: View Confirmation State After Submission
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Feedback submitted successfully
- Server returned 200 with confirmation payload

**Main Flow:**
1. App C navigates to /feedback/period/:periodId/confirmation
2. Confirmation screen shows: 'Thanks — your [Q2 2026] review is in'
3. Below: read-only echo of submitted ratings and answers, timestamp (firm timezone), and attribution ('Submitted by you on Jun 1, 2026 at 10:42 AM')
4. CTA: 'Back to home' returns to dashboard
5. Home card for that period is hidden on next refresh

**Alternate Flows:**
- Client revisits the URL later — same read-only view loads from server
- Period later archived — confirmation still viewable, watermark 'Period archived'
- Client wishes to amend — not allowed; UI explains feedback is final once submitted

**Edge Cases:**
- Backend record not yet indexed — confirmation uses payload from POST response, no fetch needed initially
- Browser back button after confirmation — returns to home, not editable form
- Stale tab opened pre-submission — refreshing routes to confirmation
- Timezone display — uses firm-configured timezone, not device's

**Invariants Enforced:** INV-FB-13: Post-submit immutable, INV-FB-16: Read-only view always available to the submitter, INV-AUDIT-1: View access logged

**Acceptance Criteria:**
- Given submission complete, when confirmation screen renders, then submitted ratings exactly match what was sent
- Given client revisits, when navigating to URL, then same read-only view loads
- Given client taps any rating control, when interacted, then no edit is possible

**Test Cases:**
- Unit: Confirmation view derives from immutable record id
- Integration: GET /feedback/:id returns same payload as POST response
- E2E: Submit, navigate away, return — confirmation persists
- Security: Another client cannot fetch this confirmation (403/404)
- Accessibility: Confirmation heading announced first; structure logical


### UC-CL-FB-11: Skip Submission and Resume Later
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Form partially filled or empty
- Period still in submittable state

**Main Flow:**
1. Client taps 'Back' or closes app without submitting
2. Local draft (ratings, prompt answers, freeform) persists in sessionStorage AND optionally IndexedDB for cross-session resilience (firm-configurable; default sessionStorage only)
3. Pending card on home remains visible
4. Client returns later (within same session) and reopens form
5. Draft auto-loads; client can continue editing
6. Client submits when ready

**Alternate Flows:**
- Client returns in a new session — draft gone (sessionStorage); fresh form loads
- Client returns and period has changed state (e.g., archived) — draft discarded, message shown
- Client uses a different device — no draft sync; starts fresh

**Edge Cases:**
- Multiple tabs open — last save wins per tab
- Storage quota exceeded (rare) — drop draft silently, no crash
- User clears browser data — draft lost
- Form schema updated server-side between visits (auto-prompts changed) — draft for matching keys preserved; obsolete keys discarded

**Invariants Enforced:** INV-FB-17: Drafts are client-local; not stored on server, INV-PRIVACY-1: No partial submissions sent to backend

**Acceptance Criteria:**
- Given partial fill, when client closes and reopens within session, then draft is restored
- Given new session, when client reopens, then form loads blank
- Given period archived, when client reopens, then form is unavailable and draft cleared

**Test Cases:**
- Unit: SessionStorage key includes period_id and user_id
- E2E: Fill 2 of 3, close tab, reopen, verify restored
- E2E: Different browser, no draft visible
- Security: Confirm no API calls made during draft save


### UC-CL-FB-12: Receive Light Reminder Notifications for Pending Feedback
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Pending feedback invitation older than reminder threshold (firm-configurable; default 7 days)
- Feedback not yet submitted
- Client has notifications enabled

**Main Flow:**
1. Scheduler job runs daily and identifies pending invitations past threshold
2. Job dispatches a single reminder push: 'Your [Q2 2026] review is still waiting — 2 mins'
3. Reminder count increments on invitation row
4. Maximum reminders capped (default 2 total) to avoid spam
5. Each reminder respects quiet hours in client timezone (no pushes 9pm–8am local)

**Alternate Flows:**
- Client submits between scheduling and dispatch — reminder skipped
- Firm disables reminders — none sent
- Client opts out via in-app notification settings — none sent regardless of firm setting

**Edge Cases:**
- Client timezone unknown — defaults to firm timezone for quiet hours
- Daylight saving change — quiet hours recompute per day
- Two pending feedbacks — single consolidated reminder ('2 reviews waiting')
- Push token expired — fallback to email if configured
- Period auto-archived per firm policy — pending invitation auto-closed; final reminder NOT sent

**Invariants Enforced:** INV-FB-18: Max N reminders per invitation (default 2), INV-FB-19: Quiet hours respected in client local time, INV-FB-20: No reminder if feedback already submitted or period closed, INV-PRIVACY-2: Client opt-out honored over firm default

**Acceptance Criteria:**
- Given pending invitation past 7 days, when scheduler runs, then exactly one reminder is dispatched
- Given client submitted before dispatch, when scheduler runs, then no reminder sent
- Given client opted out, when scheduler runs, then no notification sent
- Given two pending feedbacks, when reminder fires, then single consolidated push sent

**Test Cases:**
- Unit: Reminder eligibility logic excludes submitted and archived invitations
- Unit: Quiet hours window honored per client timezone
- Integration: Mock scheduler tick, verify dispatch count and recipients
- E2E: Stage pending invitation, advance time, verify reminder
- Security: Confirm reminder payload contains no financial info
- Privacy: Confirm opt-out flag fully blocks dispatch


### UC-CL-FB-13: View and Triage Multiple Pending Feedbacks (Backlog)
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Two or more pending feedback invitations exist for the client across one or more firms

**Main Flow:**
1. Client opens home dashboard
2. GET /api/v1/client/feedback/pending returns all pending invitations sorted by period end date desc
3. Home displays a 'Pending reviews' stacked card with count badge
4. Tapping the card opens a list view with one row per pending feedback (firm name, period label, days waiting)
5. Client taps any row to open that feedback form
6. Submissions reduce the count; list auto-updates

**Alternate Flows:**
- Single pending feedback — backlog view shows single row (or single card on home)
- Client has feedback across multiple firms — list groups by firm
- Client filters/searches by firm or quarter (optional; P2)

**Edge Cases:**
- Pending list updates while user views — list re-renders with new items at top
- An invitation becomes invalid (period archived) — row shows 'No longer available' and tap is disabled
- Large backlog (>20) — pagination or lazy load
- Client_staff sub-role with mixed permissions across firms — only allowed firms' rows show submit CTA

**Invariants Enforced:** INV-FB-21: Pending list scoped to authenticated client across allowed tenants, INV-TENANT-1: Each row stamped with tenant_id; cross-tenant data isolation, INV-RBAC-1: Per-firm sub-role gating

**Acceptance Criteria:**
- Given 3 pending feedbacks, when home loads, then count badge shows 3
- Given client submits one, when list refreshes, then count drops to 2
- Given an invitation invalidates, when list refreshes, then row marked 'unavailable'

**Test Cases:**
- Unit: Sort comparator orders by period_end_date desc
- Integration: API returns correct list across multiple tenants the client belongs to
- E2E: Stage 3 pending, complete 1, verify list updates
- Accessibility: Row count announced; each row has unique accessible name


### UC-CL-FB-14: Handle Arrival of New Period While Prior Feedback Pending
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Prior period has pending feedback (state=complete, not submitted)
- Next period transitions to 'complete' (gate 2 triggered)

**Main Flow:**
1. Backend creates new FeedbackInvitation for the new period
2. Both invitations now active and independent
3. Notification: 'Your [Q3 2026] review is ready' (separate from any prior)
4. Home card shows both pending feedbacks (per UC-CL-FB-13)
5. Client may submit them in any order; each is independent
6. Reminders dispatch per invitation, respecting global cap and quiet hours

**Alternate Flows:**
- Firm policy auto-expires older pending feedback after N periods (P2; default off) — older invitation marked expired, no longer submittable
- Client submits new period first, then prior — both succeed independently
- Prior period archived before client submits — old invitation closes; no submission possible (per firm policy)

**Edge Cases:**
- Both notifications could fire same minute — dispatcher de-dupes within 10s window (consolidated push or two pushes per firm config)
- Client submits old feedback while new just opened in another tab — independent flows, no interference
- Stale local draft for old period — preserved separately by period_id keying
- Operational signal snapshots: each invitation has its own snapshot at its own gate 2 moment

**Invariants Enforced:** INV-FB-2: One invitation per period per client, INV-FB-22: Invitations independent; no implicit cascade or skip, INV-FB-19: Quiet hours and reminder caps apply per invitation, INV-AUDIT-1: Both lifecycles audited independently

**Acceptance Criteria:**
- Given prior pending feedback, when new period reaches complete, then both invitations exist concurrently
- Given client submits new feedback first, when prior is opened, then prior form still works normally
- Given firm auto-expire policy on, when prior period archives, then prior invitation auto-closes and cannot be submitted

**Test Cases:**
- Unit: Invitation create logic does not modify prior pending rows
- Integration: Submit new period, verify prior remains active
- E2E: Two pending feedbacks across two periods; submit out of order
- Reliability: Concurrent submits to both endpoints succeed independently
- Audit: Two distinct audit trails recorded


### UC-CL-FB-15: Restrict Submission Based on Owner vs Staff Sub-Role
**Actor:** Client (client_owner or client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Firm has per-client opt-in policy defining who may submit feedback (default: client_owner only; configurable to allow client_staff)
- Logged-in user has a defined sub_role

**Main Flow:**
1. On form load, backend evaluates (firm policy, sub_role) tuple
2. If sub_role permitted, form renders normally with submit enabled when valid
3. If sub_role NOT permitted, backend returns 403 with reason code 'sub_role_blocked'
4. UI displays: 'Only the business owner can submit feedback. Please ask the owner to log in.'
5. Staff sees pending card with read-only/disabled CTA
6. Owner login proceeds normally and can submit

**Alternate Flows:**
- Firm policy changes from owner-only to all — staff can now submit on next form load
- Owner is on leave (P2) — firm may grant a one-period override (admin action)
- Single-user client (owner only) — never affected

**Edge Cases:**
- Sub_role missing from user record — treated as most-restrictive (blocked) until set
- Owner submits while staff has form open — staff form returns 409 on submit attempt
- Concurrent owner and staff attempts — first valid write wins, second gets 409
- Audit log captures sub_role at moment of submission, even if user later changes role

**Invariants Enforced:** INV-RBAC-1: Sub-role gates enforced server-side, never just client-side, INV-FB-15: Attribution includes sub_role at submission time, INV-AUDIT-1: Permission denial logged

**Acceptance Criteria:**
- Given firm policy is owner-only, when staff opens form, then 403 returned and UI explains
- Given firm policy allows all, when staff submits, then submission persists with sub_role='client_staff'
- Given owner submits after staff was blocked, when stored, then attribution reflects owner correctly

**Test Cases:**
- Unit: Permission check returns deny when sub_role not in firm allowlist
- Integration: 403 returned with stable error code; client UI maps code to copy
- E2E: Switch policy on the fly, verify behavior changes on next load
- Security: Client-side bypass attempt (manual API call) is rejected by server
- Audit: Denial logged with reason


### UC-CL-FB-16: Submit With Expired Session (Reauth and Resume)
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Form completed
- Session/access token expired at moment of submit

**Main Flow:**
1. Client taps Submit
2. Backend returns 401
3. Client app detects 401, preserves local draft AND submission_id
4. App routes to reauth (password or biometric per device)
5. On successful reauth, app restores form state and auto-retries submit with same submission_id
6. Backend persists submission; confirmation shows

**Alternate Flows:**
- Refresh token also expired — full re-login required; draft preserved
- Biometric available — quick reauth without typing
- User cancels reauth — returns to form, draft intact, submit available later

**Edge Cases:**
- Reauth as different user (rare) — submission_id rejected; show 'logged in as different user' message
- Network drops during reauth — retry both steps
- Period archives during reauth gap — submit returns 409; UI explains
- Token refresh storm (multiple concurrent calls) — single refresh call, others wait

**Invariants Enforced:** INV-AUTH-1: All writes require valid session, INV-FB-14: Idempotency across reauth retries, INV-PRIVACY-1: No draft sent before submit

**Acceptance Criteria:**
- Given expired session, when submit fires, then 401 triggers reauth flow and draft is preserved
- Given reauth succeeds, when retry fires, then submission persists exactly once
- Given reauth as different user, when retry attempted, then submission rejected with clear message

**Test Cases:**
- Unit: 401 handler preserves form state
- Integration: Mock expired token, verify reauth and single resulting record
- E2E: Force token expiry, complete reauth, verify confirmation
- Security: Different user reauth cannot inherit prior submission_id


### UC-CL-FB-17: Use Accessible Rating Controls (Screen Reader and Large Tap)
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Form loaded on mobile
- Screen reader (VoiceOver / TalkBack) may or may not be active

**Main Flow:**
1. Each rating control rendered with role='radiogroup' and 5 'radio' children with aria-label='Rate X'
2. Each tap target measures >= 44x44pt with sufficient spacing
3. When client uses screen reader, focus moves through controls in logical order: Quality group, Service group, App group, prompts, freeform, Submit
4. Selection announced as 'Quality, 4 of 5'
5. Swipe gesture supported as alternative input
6. Sufficient color contrast (WCAG AA 4.5:1 for text, 3:1 for UI components)
7. Reduced motion respects prefers-reduced-motion media query

**Alternate Flows:**
- User has system text size increased — layout adapts without truncating critical content
- User has high-contrast mode — icons and stars remain perceivable
- User has switch control — controls are switch-navigable in linear order

**Edge Cases:**
- VoiceOver double-tap to activate — works without firing other gestures
- TalkBack swipe gestures (left/right) — navigate between controls
- Custom rating UI must mirror native radio semantics — automated axe check enforces
- Reduced transparency — backgrounds become solid
- RTL languages — radio group order mirrors

**Invariants Enforced:** INV-A11Y-1: Tap target >= 44x44pt, INV-A11Y-2: WCAG 2.1 AA compliance, INV-A11Y-3: Screen reader semantics correct for all interactive controls, INV-A11Y-4: Reduced-motion preference honored

**Acceptance Criteria:**
- Given screen reader active, when client navigates form, then every control is reachable and announced clearly
- Given large text size, when form renders, then no critical content is truncated
- Given prefers-reduced-motion, when transitions fire, then no parallax/large animations occur

**Test Cases:**
- Automated: axe-core scan returns zero critical violations
- Manual: VoiceOver on iOS Safari — navigate and submit full form
- Manual: TalkBack on Android Chrome — same
- Manual: 200% text size — verify no clipping
- Manual: High contrast mode — verify perceivability
- Unit: prefers-reduced-motion media query handled in CSS


### UC-CL-FB-18: Handle Period Regression During Active Feedback Session
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client has form open with partial input
- Accountant reopens the period (state moves from 'complete' back to 'processed') — guarded but allowed per spec

**Main Flow:**
1. Server invalidates the FeedbackInvitation (status='paused') when period regresses
2. Push or in-app banner notifies the client: 'Your accountant is updating this period — feedback paused'
3. If client tries to submit, backend returns 409 with code 'period_regressed'
4. UI shows the explanation and disables submit
5. When period returns to 'complete', invitation reactivates; client receives new notification
6. Local draft preserved across pause/resume

**Alternate Flows:**
- Period regression then archived without re-completing — invitation closed, draft discarded
- Client offline during regression — local submit queued; will receive 409 on replay
- Multiple regressions — each pause/resume cycle handled gracefully

**Edge Cases:**
- Regression occurs between form open and submit tap — submit fails fast; UI updates
- Push during quiet hours — held until next allowed window
- Backend race: regression and submit cross-collide — last-write wins per period state guard
- Re-completion triggers new signal evaluation snapshot; auto-prompts may differ when invitation resumes

**Invariants Enforced:** INV-PERIOD-1: State machine monotonic except guarded regressions, INV-FB-23: Pause invitation on regression; resume on re-complete, INV-FB-17: Draft remains client-local across pause, INV-AUDIT-1: Pause/resume audited

**Acceptance Criteria:**
- Given period regresses, when client submits, then 409 returned with clear UI message
- Given period re-completes, when client revisits, then form is active again with potentially updated prompts
- Given pause/resume cycle, when audit reviewed, then both transitions logged

**Test Cases:**
- Unit: Submission state guard rejects submit when invitation.status != 'pending'
- Integration: Simulate regression, attempt submit, verify 409
- E2E: Full cycle pause → resume → submit
- Audit: Both pause and resume recorded


### UC-CL-FB-19: Install PWA and Enable Notifications During Feedback Onboarding
**Actor:** Client (client_owner) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Client opens App C in browser without PWA installed
- Pending feedback invitation exists

**Main Flow:**
1. Browser fires beforeinstallprompt event; app captures it
2. On home screen, gentle banner: 'Install ProBooks for faster access and reminders'
3. Client taps 'Install'
4. Browser prompts; client confirms; app installs to home screen
5. On first launch from icon, app requests Notification permission with context: 'Get notified when your feedback is ready'
6. Client grants; service worker registers and stores push subscription server-side
7. Future Gate-2 events trigger pushes per UC-CL-FB-01

**Alternate Flows:**
- Client declines install — no future banner for N days
- Client declines notifications — app continues with email fallback
- Client uses Safari (limited install on iOS) — app shows Add-to-Home-Screen instructions
- Already installed — banner suppressed

**Edge Cases:**
- Push subscription expires (server-side detected via 410 from FCM/APNS) — app re-subscribes on next open
- Permission revoked in OS settings — app detects on next launch and shows re-enable hint
- Multiple devices — each registers its own token; notifications dispatched to all
- Private browsing mode — install/notification options disabled gracefully

**Invariants Enforced:** INV-PWA-2: PWA installable per Web App Manifest standards, INV-NOTIF-1: Push subscription stored server-side per device, scoped to client_user_id, INV-PRIVACY-3: Notification permission optional; never blocks feedback submission

**Acceptance Criteria:**
- Given install banner shown, when client installs, then app icon appears on home screen
- Given notification permission granted, when push fires, then notification delivered to that device
- Given permission denied, when feedback ready, then email fallback used

**Test Cases:**
- Unit: Manifest contains required icons, name, start_url, display=standalone
- Integration: Service worker registers and stores subscription server-side
- E2E: Install on Chrome Android, grant push, trigger Gate 2, verify push
- Manual: Safari iOS Add-to-Home-Screen flow documented
- Reliability: Expired subscription re-registers on next open
- Accessibility: Install banner is dismissible via keyboard and has proper labels


### UC-CL-FB-20: Recover From Server Error During Submission
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Form completed
- Backend or upstream service experiencing transient failure

**Main Flow:**
1. Client taps Submit
2. Backend returns 5xx
3. Client app shows 'Something went wrong — try again' with retry CTA
4. Local state preserved with submission_id
5. Client taps retry; request resent with same submission_id
6. Backend recovers and writes record once
7. Confirmation screen displayed

**Alternate Flows:**
- Persistent failure — exponential backoff with jitter; max 3 auto-retries; then manual
- 5xx then success in auto-retry — no user action required; confirmation displays
- 5xx then 409 (record already written despite earlier error) — confirmation displayed from existing record

**Edge Cases:**
- Server wrote record then returned 5xx (lost ack) — idempotent retry fetches same record
- Client closes app during retry loop — service worker continues background sync
- Different 5xx codes mapped to same user-friendly message; details in error log only
- Server returns 429 (rate limit) — backoff doubled and message updates to 'Busy, retrying...'

**Invariants Enforced:** INV-FB-14: Idempotency via submission_id, INV-RESILIENCE-1: No data loss on transient backend failure, INV-AUDIT-1: All retry attempts logged (server-side)

**Acceptance Criteria:**
- Given 5xx, when retry fires with same key, then exactly one record results
- Given persistent failure, when auto-retries exhaust, then manual retry CTA appears
- Given record-then-error, when client retries, then confirmation shown without duplicate

**Test Cases:**
- Unit: Retry logic uses exponential backoff with cap
- Integration: Inject 5xx, then 200; verify idempotent single write
- Integration: Inject 5xx then 409 (existing record); verify confirmation
- E2E: Chaos test with random failures; result is always single record or clear failure UI
- Observability: Each retry emits a metric and a structured log line


### UC-CL-FB-21: Prevent Operational Signal Leakage to Client
**Actor:** Client (client_owner) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Form loaded with auto-prompts
- Operational signals exist server-side and triggered prompts

**Main Flow:**
1. Backend selects up to N auto-prompts from registry
2. Each prompt sent to client contains ONLY soft-copy template and prompt_id (opaque to client)
3. Underlying signal_id, raw metric values, thresholds, and staff identifiers are stored server-side but NEVER serialized in client response
4. Client renders prompts as plain questions; rating-signal linkage is established by submission_id and prompt_id on backend post-submit

**Alternate Flows:**
- Firm operator edits soft-copy template — change deploys via registry; existing form load uses snapshot
- Signal removed from registry between form load and submit — prompt response stored with snapshot reference for traceability

**Edge Cases:**
- Developer inadvertently logs signal value client-side — caught by lint rule banning specific keys in client bundles
- Network sniffing — client API response audited to contain no metric values (contract test)
- Confidence percentages must never appear — also enforced by output filter in serializer
- Staff names must not appear in any client-bound payload

**Invariants Enforced:** INV-CLIENT-1: Operational signals not visible to client, INV-CLIENT-2: Confidence percentages not visible to client, INV-CLIENT-3: Staff names not visible to client, INV-FB-6: Soft copy only, INV-FB-8: Rating-signal linkage stored server-side

**Acceptance Criteria:**
- Given form load, when response inspected, then no raw signal values, thresholds, or staff names present
- Given submission, when stored, then signal linkage persisted server-side via prompt_id mapping
- Given operator edit to copy, when next form loads, then updated copy used; in-flight forms unaffected

**Test Cases:**
- Contract: Schema validation rejects any client-bound field named like 'rawValue', 'threshold', 'staffName', 'confidence'
- Unit: Serializer strips internal-only fields
- Integration: Inspect API response with tripped signals; assert no leakage
- Security: Penetration test — attempt to enumerate signal_ids via prompt_id; opaque mapping prevents
- Security: Audit log captures linkage for compliance


### UC-CL-FB-22: Audit and Observe Client Feedback Activity
**Actor:** Client (client_owner) — observed by system | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Client interacts with feedback flow at any stage

**Main Flow:**
1. Each significant event emits an append-only audit entry: feedback.invitation_created, feedback.form_loaded, feedback.submitted, feedback.viewed, feedback.reminder_sent, feedback.permission_denied
2. Entries include: tenant_id, client_user_id, sub_role, period_id, event, server timestamp, optional metadata (no PII beyond what is required)
3. Metrics emitted to observability stack: counters for invitations, submissions, skip rates, response times, error rates
4. Operator scorecard joins subjective ratings with operational signals on firm-side dashboards (not client-side)

**Alternate Flows:**
- Audit pipeline degraded — events buffered locally on server with at-least-once delivery
- PII scrubber redacts freeform content if firm enables strict mode for observability sampling

**Edge Cases:**
- Audit table grows large — partitioned by tenant_id and time
- Tampering attempt — append-only constraints + hash chaining prevent retroactive edits
- Permanent deletion attempt of financial-linked entries — denied per INV-AUDIT-1

**Invariants Enforced:** INV-AUDIT-1: Append-only; immutable, INV-TENANT-1: Audit rows scoped to tenant, INV-DATA-RESIDENCY-1: Stored in ca-central-1, INV-PRIVACY-4: PII handling per firm policy

**Acceptance Criteria:**
- Given any feedback event, when fired, then exactly one audit entry exists and cannot be modified
- Given a deletion attempt on audit, when run, then operation is denied
- Given metrics scraped, when dashboards render, then counters match audit counts within reconciliation tolerance

**Test Cases:**
- Unit: Audit writer rejects updates and deletes
- Integration: Each lifecycle event produces expected audit entry
- Security: Attempt direct DB UPDATE/DELETE on audit table — fails due to triggers/permissions
- Compliance: Data residency check confirms storage region
- Observability: Smoke test for each metric and structured log


### UC-CL-FB-23: Comply With Data Residency and PIPEDA Requirements
**Actor:** Client (client_owner) — system invariant | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- All feedback storage and processing must occur in ca-central-1

**Main Flow:**
1. Submission API hits regional endpoint in ca-central-1
2. Database writes occur in ca-central-1 cluster
3. Notification dispatch uses Canadian endpoints where supported; push providers documented for compliance
4. Backups and replicas remain within Canada region
5. PIPEDA logs maintained for audit

**Alternate Flows:**
- DR failover within Canada region — secondary AZ in ca-central-1; never cross-region
- User accesses from outside Canada — data still stored in Canada; egress logged

**Edge Cases:**
- Third-party push provider region — vetted and contractually bound to PIPEDA equivalence
- Logs and analytics pipelines must also remain in region
- DSR (Data Subject Request): client can request export/deletion of their feedback within retention rules; financial-linked records cannot be hard-deleted (immutable per spec)

**Invariants Enforced:** INV-DATA-RESIDENCY-1: ca-central-1 storage, INV-AUDIT-1: No permanent deletes of financial data, INV-PRIVACY-5: PIPEDA compliance documented

**Acceptance Criteria:**
- Given any feedback write, when inspected via cloud provider tooling, then resource region is ca-central-1
- Given DSR for export, when processed, then complete client feedback bundle delivered
- Given DSR for deletion on financial-linked records, when processed, then access redacted but underlying records preserved per audit invariant

**Test Cases:**
- Compliance: Infrastructure-as-code review verifies region pinning
- Compliance: Push provider DPA on file
- Security: Penetration test confirms no cross-region replicas
- Integration: DSR export script runs against test tenant
- Audit: PIPEDA control checklist signed off


## Client (Staff / In-house Bookkeeper) — client_staff sub-role (mobile)

### UC-CL-ST-01: Accept staff invitation from owner and complete first-time onboarding
**Actor:** Client (client_staff sub-role) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Firm has enabled client_staff sub-role feature flag for the tenant
- Client owner has sent an invite via mobile/web Client Portal to a staff email
- Invite token is unexpired (TTL e.g. 7 days), unrevoked, single-use
- Staff has received the invite email/SMS link on a mobile device

**Main Flow:**
1. Staff taps invite deep link; PWA opens to /invite/accept?token=...
2. Frontend POSTs token to /api/client/invites/validate; backend verifies tenant_id, expiry, revocation, single-use
3. Backend returns invite metadata (firm name, client business name, owner display name, scope of permissions)
4. Staff sees onboarding screen with firm + business identity and 'Accept & Continue' CTA
5. Staff sets password (or completes SSO/OAuth handshake if firm enables it) and accepts privacy/PIPEDA terms
6. Backend creates user row with role=client, sub_role=client_staff, tenant_id, client_id, attaches to client account, marks invite consumed
7. Backend writes audit log: invite_accepted with invite_id, accepted_by_user_id, ip, ua
8. Frontend stores JWT/refresh token in secure storage, prompts for biometric unlock opt-in
9. Staff is routed to client dashboard showing current quarter status (same surface as owner)
10. PWA shows 'Add to Home Screen' install prompt if not installed

**Alternate Flows:**
- If token expired → show 'Invite expired, ask owner to resend' with deep link back to owner email
- If token already consumed → show 'This invite has already been used' (do not leak which user used it)
- If token revoked by owner → show 'Invite was cancelled by your business owner'
- If staff email already exists as a different role on a different tenant → block and instruct to use different email (no cross-tenant linking)
- If firm has disabled client_staff sub-role after invite was sent → show 'Staff access is not available for your business; contact your accountant'
- If SSO is enforced by firm and staff email domain doesn't match → block with explanatory message

**Edge Cases:**
- Mobile deep link opens in in-app browser (Gmail/Outlook webview) — must detect and prompt to open in external browser/PWA
- Token tampered in URL (signature mismatch) → 401, generic error, log security event
- Race: owner revokes invite between validate and accept calls → backend rejects accept with 410 Gone
- Two staff accept same token concurrently → DB unique constraint on invite_id+consumed=true ensures only one succeeds
- Network drops mid-acceptance after user row created but before JWT issued → retry login produces same user, no duplicate
- Timezone: invite expiry shown in staff's local TZ but stored UTC; ensure expiry comparison uses UTC server clock
- Clipboard manager prefills password field with stale value → enforce minimum complexity and confirm field
- Biometric opt-in denied → fallback to PIN/password unlock for PWA

**Invariants Enforced:** INV-TENANT-1 (every row carries tenant_id; RLS backstop), INV-AUDIT-1 (append-only audit log of invite_accepted), INV-AUTH-1 (single-use, signed, expiring invite tokens), INV-RESIDENCY-1 (user provisioned in ca-central-1)

**Acceptance Criteria:**
- Given a valid invite token, when staff completes acceptance, then a client_staff user is created scoped to the correct tenant_id and client_id
- Given an expired token, when staff opens the link, then no user row is created and a clear error is shown
- Given a revoked invite, when staff tries to accept, then the request returns 410 and an audit event invite_accept_rejected is written
- Given acceptance succeeds, when staff lands on dashboard, then they see the same current-quarter surface as owner with attribution=client_staff for any subsequent actions
- Given a consumed token, when re-used, then acceptance fails without leaking identity of the original consumer

**Test Cases:**
- Unit: invite token validator rejects expired/revoked/tampered tokens with distinct error codes
- Unit: user creation service enforces sub_role=client_staff and prevents role escalation via payload tampering
- Integration: POST /invites/accept produces audit row and consumed=true atomically (transaction)
- E2E (mobile Safari + Chrome): full happy path from email tap to dashboard render
- E2E: in-app webview detection redirects to external browser before PWA install
- Security: replay of consumed token returns 410 and triggers rate-limit on IP
- Security: invite token entropy >= 128 bits; not guessable
- Accessibility: invite screen passes WCAG 2.1 AA contrast and screen-reader labels for all CTAs
- Performance: validate endpoint p95 < 300ms


### UC-CL-ST-02: Authenticate to mobile PWA with biometric unlock as client_staff
**Actor:** Client (client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Staff has previously onboarded and opted into biometric unlock
- Device supports WebAuthn (Face ID / Touch ID / Android biometric)
- Refresh token not expired

**Main Flow:**
1. Staff opens PWA; app detects existing session credential
2. PWA invokes WebAuthn navigator.credentials.get() with stored credentialId
3. OS prompts biometric; on success returns assertion
4. Frontend POSTs assertion to /api/auth/webauthn/verify; backend verifies signature, counter, returns access token
5. Staff lands on dashboard with sub_role=client_staff context loaded

**Alternate Flows:**
- If biometric fails 3x → fallback to password
- If refresh token expired → full re-login flow with email + password
- If device changed (no stored credentialId) → password login; offer to enroll new device
- If owner has disabled staff access since last login → 403 with 'access revoked' message

**Edge Cases:**
- Counter regression in WebAuthn assertion (possible cloned authenticator) → reject and force password
- User backgrounded app during biometric prompt → resume cleanly without double-prompt
- PWA installed on multiple devices → each has its own credential; revoking one device doesn't kill others
- Clock skew between device and server during token exchange → tolerate within 60s
- Airplane mode → show offline banner; queue auth attempt

**Invariants Enforced:** INV-AUTH-2 (WebAuthn counter validation), INV-TENANT-1 (token scoped to tenant_id and sub_role), INV-AUDIT-1 (login event logged with sub_role)

**Acceptance Criteria:**
- Given enrolled biometric, when staff opens PWA, then unlock completes in < 2 seconds on modern devices
- Given revoked access, when staff biometric succeeds locally, then backend returns 403 and staff is logged out
- Given counter regression, when assertion verified, then login is denied and security alert raised

**Test Cases:**
- Unit: WebAuthn verifier rejects counter <= stored counter
- Integration: revoked staff user cannot exchange refresh token for access token
- E2E iOS Safari: biometric prompt flow
- E2E Android Chrome: biometric prompt flow
- Security: stolen refresh token from another device fails origin binding check
- Accessibility: fallback password path is keyboard-only navigable


### UC-CL-ST-03: View current quarter dashboard with staff attribution context
**Actor:** Client (client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Authenticated as client_staff
- Client account has at least one period in any state
- Firm has configured filing frequency

**Main Flow:**
1. GET /api/client/periods/current returns period state, flags count (open/red/yellow), document checklist progress, gate1/gate2 status
2. Frontend renders the same dashboard as owner, but action attribution badges read 'as Staff'
3. If current period state ∈ {open, processing, processed}, numbers hidden behind Gate 1 messaging
4. If gate1 passed (all flags cleared + processed), draft numbers card shown (net of HST; HST broken into 105/108/109)
5. If gate2 passed (accountant marked complete), Excel download CTA enabled; otherwise disabled with tooltip 'waiting for your accountant'
6. Confidence % is never rendered; flag colors reflect source only (yellow=system, red=accountant)

**Alternate Flows:**
- If no period yet exists (new client) → empty state with 'Your accountant will set up your first period'
- If period archived → redirect to archive surface
- If owner has restricted staff view of P&L (firm policy) → numbers card hidden with 'View restricted by owner' note

**Edge Cases:**
- Period boundary crossover at midnight America/Toronto while staff is viewing → soft refresh banner 'New period started'
- Concurrent owner action changes flag count → live refresh via SSE/poll within 30s
- Slow network → skeleton loaders; never render stale numbers from cache after gate revocation
- RLS misconfig should never let staff see other client's data — defensive query test
- Confidence field accidentally serialized → contract test fails the build

**Invariants Enforced:** INV-GATE-1 (numbers only after all flags cleared + processed), INV-GATE-2 (Excel only after explicit complete), INV-CONF-1 (confidence never sent to client), INV-HST-1 (numbers net of HST; HST broken out), INV-TENANT-1

**Acceptance Criteria:**
- Given period state=processing, when staff loads dashboard, then numbers card is not rendered and gate1 messaging is shown
- Given gate1 satisfied, when staff loads dashboard, then draft numbers are visible labeled DRAFT
- Given gate2 not satisfied, when staff taps Excel, then download is blocked with tooltip
- Given any rendered flag, when inspected, then no confidence value is present in the DOM or network payload

**Test Cases:**
- Unit: numbers serializer strips confidence field for client role
- Integration: gate1 evaluator returns false if any flag.status != cleared
- Contract: schema test asserts response excludes confidence keys for client role
- E2E: state transitions update dashboard within 30s of backend event
- Security (RLS): forged client_id in query rejected by Postgres policy
- Accessibility: dashboard uses semantic landmarks; screen reader announces gate status


### UC-CL-ST-04: Upload supporting document as client_staff
**Actor:** Client (client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Period state ∈ {open}
- aiLocked=false on target document slot
- Staff has upload permission (not restricted by owner)
- Mobile camera/storage permissions granted

**Main Flow:**
1. Staff taps 'Upload' on dashboard; picks 'Camera', 'Photo Library', or 'File'
2. PWA captures/picks file; client-side validates MIME (pdf/jpg/png/heic), size (< 25MB), and orientation
3. PWA requests presigned S3 (ca-central-1) PUT URL with content-type and sha256
4. PWA uploads to S3 with progress; on success POSTs metadata to /api/client/documents
5. Backend validates tenant_id, client_id, period_id, aiLocked=false, virus scans (async), persists row with uploaded_by=staff_user_id, sub_role=client_staff
6. Audit log entry: document_uploaded with sub_role attribution
7. Dashboard checklist count increments; thumbnail appears with 'Uploaded by [Staff Name]' label

**Alternate Flows:**
- If aiLocked=true → upload blocked with 'Documents are locked while your accountant processes this period'
- If owner restricts staff uploads (firm allows owner to toggle) → 403 with explanation
- If virus scan fails async → row marked quarantined; UI shows red banner; not counted toward checklist
- If file is HEIC and backend doesn't support → client-side convert to JPEG before upload

**Edge Cases:**
- Network drop mid-upload → resumable multipart with checksum; retry continues from last part
- Duplicate upload (same sha256) → backend dedupes; UI shows 'already uploaded' toast, no double-count
- Concurrent upload by owner of same file → both rows persist (different upload events) but checklist dedupes on sha256
- Rapid double-tap upload button → idempotency key prevents duplicate POSTs
- Camera capture rotated 90° on iOS → EXIF orientation respected on backend render
- Very large multi-page PDF (>25MB) → reject with size error before S3 upload
- Storage permission revoked mid-flow → graceful error, no crash
- Offline: queue upload in IndexedDB; replay when online (PWA background sync)
- Browser refresh mid-upload → resumable upload picks up state from IndexedDB
- Clock skew: client-side timestamp ignored; backend uploaded_at is canonical

**Invariants Enforced:** INV-DOC-LOCK-1 (no client uploads after aiLocked), INV-TENANT-1, INV-AUDIT-1 (sub_role attribution captured), INV-RESIDENCY-1 (S3 bucket ca-central-1), INV-DOC-IMMUT-1 (uploaded files immutable on storage)

**Acceptance Criteria:**
- Given period.aiLocked=false, when staff uploads valid file, then document row has uploaded_by_sub_role=client_staff and audit log has matching entry
- Given period.aiLocked=true, when staff attempts upload, then 423 Locked returned and no S3 object created
- Given network drop, when connection restored, then upload resumes without duplicating the document
- Given two clients in different tenants, when staff upload, then no cross-tenant visibility (RLS test)

**Test Cases:**
- Unit: presign endpoint enforces region=ca-central-1 and tenant-prefixed key
- Unit: MIME and size validators reject invalid inputs
- Integration: idempotency key dedupes rapid double-POST
- Integration: aiLocked=true blocks upload at API layer
- E2E mobile: camera capture upload happy path on iOS and Android
- E2E: offline upload queued and replayed
- Security: presigned URL cannot be reused after upload (single-use enforced)
- Security: cross-tenant key tampering rejected
- Performance: 10MB upload p95 < 8s on 4G
- Accessibility: file input accessible via VoiceOver/TalkBack


### UC-CL-ST-05: Answer a system-raised (yellow) flag with text response
**Actor:** Client (client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Open flag of source=system (yellow) exists
- Flag is not locked to owner-only by firm/owner policy
- Period state ∈ {open, processing, processed}

**Main Flow:**
1. Staff taps flag from dashboard or flags list; sees flag prompt copy (firm-configured)
2. Staff types response in textarea; character counter shown
3. Staff taps 'Submit Answer'; POST /api/client/flags/{id}/answer with { text, idempotencyKey }
4. Backend verifies flag still open, staff has answer permission, persists answer with answered_by_user_id, sub_role=client_staff, answered_at
5. Audit log: flag_answered with sub_role
6. Flag UI updates to 'Answered — pending accountant review'; dashboard flag count decrements pending-from-client

**Alternate Flows:**
- If flag is owner-only (firm policy or owner restriction) → CTA disabled with 'Only the owner can answer this flag'
- If flag was closed by accountant between load and submit → 409 conflict; UI refreshes and shows resolved state
- If owner answered same flag concurrently → first-write-wins; second submitter sees 409 with owner's answer
- If flag requires receipt upload (typed as 'receipt-required') → route to UC-CL-ST-06 instead

**Edge Cases:**
- Empty answer text → client-side validation rejects
- 10,000-char answer → client-side cap (e.g. 4000) enforced; backend re-validates
- Unicode / emoji / RTL text → stored as UTF-8; rendered correctly
- Browser refresh after typing → draft persisted in IndexedDB; restored on return
- Session expires mid-submit → silent token refresh; if fails, save draft and prompt re-login
- Rapid double-tap submit → idempotency key dedupes
- Offline submit → queue in outbox; replay on reconnect with original timestamp metadata
- XSS attempt in answer text → backend sanitizes for storage; frontend renders as text only

**Invariants Enforced:** INV-FLAG-COLOR-1 (color reflects source, not confidence), INV-AUDIT-1 (sub_role attribution), INV-CONF-1 (no confidence shown to client), INV-TENANT-1

**Acceptance Criteria:**
- Given an open yellow flag, when staff submits valid answer, then flag.answered_by_sub_role=client_staff and audit log captures it
- Given owner-only restriction, when staff opens flag, then submit CTA is disabled with explanation
- Given concurrent owner submit, when staff submits, then 409 returned and UI shows owner's answer
- Given browser refresh mid-typing, when staff returns, then draft is restored

**Test Cases:**
- Unit: answer validator enforces length and non-empty
- Integration: concurrent submit returns 409 to loser
- E2E: full submit happy path on mobile
- E2E: offline submit queued and replayed with correct sub_role
- Security: XSS payload stored sanitized, rendered as text
- Accessibility: textarea labeled, error messages announced to screen reader


### UC-CL-ST-06: Upload receipt(s) in response to a receipt-required flag (double-write)
**Actor:** Client (client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Open flag of type receipt-required exists
- Period not aiLocked
- Staff has answer permission

**Main Flow:**
1. Staff taps flag; sees prompt and 'Upload Receipt' CTA
2. Camera/picker flow as UC-CL-ST-04
3. On upload success, backend executes transactional double-write: document row + checklist count increment + flag.answered_by entry with sub_role=client_staff
4. Audit log records flag_answered_with_receipt with document_id reference
5. Flag state moves to 'answered'; dashboard checklist and flag counts update atomically

**Alternate Flows:**
- Multiple receipts for one flag → user can add several before submitting; double-write executes per receipt or as batch with single audit event
- Mistaken upload → user can remove uploaded receipt before final submit; after submit, only accountant can void

**Edge Cases:**
- Double-write partial failure (document persisted but checklist increment failed) → backend transaction rolls back; UI sees error
- Owner uploads receipt for same flag concurrently → both receipts attach; flag answered_at = first; both audit rows persist with distinct sub_roles
- Receipt count drift if any path bypasses transaction → integration test prevents
- Network drop after document uploaded but before flag answer recorded → retry idempotent; flag eventually resolves
- Receipt for wrong period → backend rejects on period_id mismatch

**Invariants Enforced:** INV-FLAG-RECEIPT-1 (double-write transactional), INV-AUDIT-1, INV-DOC-LOCK-1, INV-TENANT-1

**Acceptance Criteria:**
- Given a receipt-required flag, when staff uploads receipt, then transaction creates document + increments checklist + records flag answer atomically
- Given partial failure, when transaction aborts, then no orphan rows exist
- Given concurrent owner upload, when both succeed, then both receipts persist with correct sub_role attribution

**Test Cases:**
- Unit: double-write transaction wrapper rolls back on any failure
- Integration: simulated failure mid-write produces no drift
- E2E: end-to-end mobile flow including thumbnail render
- Concurrency: two simultaneous receipt uploads from owner and staff attach both
- Audit: both sub_role attributions present in audit log


### UC-CL-ST-07: Submit 'Not Found' attestation for missing document or receipt
**Actor:** Client (client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Flag or checklist item supports attestation
- Firm policy allows client_staff to sign attestations (configurable, default may be owner-only)
- No prior attestation exists for that item (write-once)

**Main Flow:**
1. Staff taps 'Mark as Not Found' on a flag or checklist item
2. Modal displays exact attestation copy (firm-configured) including legal language
3. Staff checks 'I confirm…' box and taps 'Sign Attestation'
4. POST /api/client/attestations with { itemId, type, attestationText, idempotencyKey }
5. Backend verifies: not previously attested, firm policy allows staff signature, persists immutable row with attested_by_user_id, sub_role=client_staff, attested_at, ip, user_agent, attestation_text_hash
6. Backend creates the corresponding transaction record (still recorded with attestation reference) per invariant
7. Audit log: attestation_signed (immutable, append-only)
8. Flag/checklist item shown as 'Attested — Not Found by [Staff Name]'

**Alternate Flows:**
- If firm policy = owner-only attestations → staff sees 'Only the business owner can sign this attestation' and CTA is disabled; UI explains why
- If owner has signed already → show owner's attestation; staff cannot re-sign
- If accountant has voided original need → CTA hidden

**Edge Cases:**
- Attempted edit/delete of attestation post-write → 403 (write-once enforced)
- Network drop mid-submit → idempotency key prevents duplicate
- Clock skew → attested_at uses server clock, not client
- Attestation text changed by firm between modal render and submit → backend compares hash; if mismatch, 409 with 'attestation text updated, please review again'
- Race: owner attests concurrently → first-write-wins, loser gets 409 with attester identity (within tenant only)
- Audit log write fails after attestation persisted → outbox pattern retries; never silently dropped

**Invariants Enforced:** INV-ATTEST-1 (write-once, attributed, timestamped), INV-ATTEST-2 (transaction still recorded), INV-AUDIT-2 (attestations immutable, no permanent delete), INV-TENANT-1

**Acceptance Criteria:**
- Given firm allows staff attestations, when staff signs, then attestation row is immutable with sub_role=client_staff
- Given firm restricts to owner, when staff opens modal, then signing is blocked at both UI and API layers
- Given an already-attested item, when staff retries, then 409 returned with existing attester identity
- Given attestation copy mutated between render and submit, when hash mismatches, then submit is rejected and staff must re-read

**Test Cases:**
- Unit: attestation service enforces write-once via DB unique constraint
- Integration: firm policy owner-only blocks staff at API regardless of UI state
- Security: any UPDATE/DELETE on attestation row by application code rejected by DB trigger
- E2E: full mobile attestation flow with text hash verification
- Audit: attested_by sub_role visible in audit log and downstream firm scorecard


### UC-CL-ST-08: View list of all open flags assigned to client with filtering
**Actor:** Client (client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Authenticated as client_staff
- At least one flag exists in current or past unfiled period

**Main Flow:**
1. Staff navigates to 'Flags' tab
2. GET /api/client/flags?status=open&periodId=current returns paginated list
3. List displays: prompt copy, color (yellow=system, red=accountant), age, who-must-answer (any/owner-only/answered-by)
4. Staff can filter by status (open/answered/resolved), color, type (text/receipt), and assignee constraint
5. Tapping a flag opens detail view (UC-CL-ST-05 or UC-CL-ST-06)

**Alternate Flows:**
- Empty state → 'No open flags — nice work!'
- Owner-only flags appear in list but with disabled CTA and visual hint

**Edge Cases:**
- Very long lists (100+) → virtual scrolling; pagination cursor
- Filter combination yields zero → friendly empty state
- Concurrent owner resolves a flag → live update removes it from list within poll interval
- Confidence field never serialized regardless of filter
- Search with special characters / SQL injection attempts → parameterized queries

**Invariants Enforced:** INV-CONF-1, INV-FLAG-COLOR-1, INV-TENANT-1

**Acceptance Criteria:**
- Given 50 flags, when staff loads list, then first page renders in < 1s on 4G
- Given owner-only flags, when listed, then CTA is disabled with explanatory tooltip
- Given no confidence values, when payload inspected, then none are present

**Test Cases:**
- Unit: filter validator rejects unknown filter values
- Integration: pagination cursor stable across concurrent updates
- E2E: filter combinations render correctly
- Performance: 500-flag list renders without jank (virtual scroll)
- Accessibility: list is screen-reader navigable with proper headings


### UC-CL-ST-09: View draft numbers (Gate 1 unlock) without confidence indicators
**Actor:** Client (client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Period processed=true
- All flags resolved (status ∈ {answered, cleared})
- Gate 2 may be open or closed

**Main Flow:**
1. Dashboard detects gate1=true; shows DRAFT numbers card
2. Numbers shown net of HST; HST broken into line 105 (collected), 108 (ITCs), 109 (net tax)
3. P&L summary visible; tap to expand category breakdowns
4. Banner: 'These numbers are draft until your accountant marks the period complete'

**Alternate Flows:**
- If owner has restricted staff view of P&L (firm setting) → card hidden with explanation
- If a new flag is raised after gate1 → numbers re-hidden, banner notifies

**Edge Cases:**
- Network glitch returns stale numbers from cache after gate revoked → ETag/If-Modified-Since refreshes
- Mid-render gate revocation → re-evaluate on server; do not render stale draft
- Currency formatting in en-CA locale (CAD, $1,234.56)
- Decimal precision: rounding to 2dp using banker's rounding consistent server-side

**Invariants Enforced:** INV-GATE-1, INV-CONF-1, INV-HST-1

**Acceptance Criteria:**
- Given gate1=true, when staff loads dashboard, then DRAFT numbers card is visible
- Given a new red flag is raised, when staff polls/refreshes, then numbers are re-hidden
- Given any rendered value, when DOM inspected, then no confidence percentages are present

**Test Cases:**
- Unit: gate1 evaluator handles flag re-opening correctly
- Integration: serializer omits confidence for client role
- E2E: gate1 transitions show/hide numbers correctly
- Accessibility: numbers card uses semantic table markup


### UC-CL-ST-10: Download period Excel (Gate 2 unlock) and observe download attribution
**Actor:** Client (client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Gate 2 satisfied (accountant explicitly marked period complete) OR period is a past period
- Excel is period-scoped (no date picker)
- Staff has download permission (not restricted)

**Main Flow:**
1. Staff taps 'Download Excel' on current or past period card
2. GET /api/client/periods/{id}/excel signs a short-lived URL (e.g. 5 min) and returns
3. Backend records audit event: excel_downloaded with downloaded_by_user_id, sub_role=client_staff, period_id, ip, ua
4. Mobile downloads file via system handler (iOS Files / Android Downloads)

**Alternate Flows:**
- Gate 2 not met for current period → CTA disabled with 'Waiting for your accountant to mark complete'
- Past periods always downloadable regardless of current gate state
- Owner restricts staff downloads → 403 with explanation

**Edge Cases:**
- URL replay after expiry → 410
- User shares URL externally → URL signed and short-lived; still recommend treating as sensitive
- Multiple rapid downloads → idempotent; each logged
- Excel file regenerated upstream while URL in flight → snapshot version pinned at URL generation
- iOS Safari downloads to Files; large file streaming pipeline must not buffer in mobile RAM

**Invariants Enforced:** INV-GATE-2, INV-EXCEL-1 (period-scoped, no date picker), INV-AUDIT-1, INV-TENANT-1

**Acceptance Criteria:**
- Given gate2=false on current period, when staff taps download, then 423 returned and UI shows disabled CTA
- Given gate2=true, when staff downloads, then audit log captures sub_role=client_staff
- Given past period, when staff downloads, then download succeeds regardless of current gate state

**Test Cases:**
- Unit: signed URL TTL enforcement
- Integration: audit row written before URL returned
- E2E mobile: download lands in Files/Downloads on iOS and Android
- Security: URL replay after expiry rejected
- Performance: large workbook stream test


### UC-CL-ST-11: View past periods archive (P&L history) read-only
**Actor:** Client (client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- At least one past period exists in state ∈ {filed, archived}
- Authenticated as client_staff

**Main Flow:**
1. Staff opens 'Archive' tab; sees list of past periods with summary P&L
2. Tap a period → detail view: P&L, HST breakdown, filed-return PDFs, Excel re-download
3. All data read-only; no edit affordances

**Alternate Flows:**
- Empty state → 'No filed periods yet'
- If a period was archived without filed PDFs → PDFs section hidden

**Edge Cases:**
- Very long history (5+ years) → paginate by year
- Timezone consistency: period labels in America/Toronto regardless of staff location
- Filed PDF too large to render inline on mobile → fallback to native viewer/download

**Invariants Enforced:** INV-EXCEL-1 (past always downloadable), INV-FILED-1 (filed PDFs immutable), INV-TENANT-1

**Acceptance Criteria:**
- Given an archived period, when staff views, then no edit CTAs are present
- Given a filed PDF, when opened, then rendered read-only with no download-block

**Test Cases:**
- Unit: archive route blocks any mutation verbs
- Integration: filed PDF served with correct content-disposition
- E2E: archive list and detail render on mobile
- Accessibility: PDF download alternative for screen reader users


### UC-CL-ST-12: View filed HST and T2 return PDFs uploaded by accountant
**Actor:** Client (client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Period state ∈ {filed, archived}
- Accountant has uploaded at least one filed PDF

**Main Flow:**
1. From past period detail, staff sees PDFs grouped by type: 'HST Return' and 'T2 Return'
2. Tap PDF → opens in inline PDF viewer or native handler
3. Download CTA records audit event filed_pdf_viewed/downloaded with sub_role=client_staff

**Alternate Flows:**
- If only HST filed, T2 section is empty/hidden
- If accountant has not yet uploaded → 'Filed return pending upload by your accountant'

**Edge Cases:**
- PDF corrupted → backend integrity check; UI shows 'Unable to open; contact accountant'
- PDF very large (>50MB) → stream download, don't load in memory
- Multiple amended filings — show version history with timestamps

**Invariants Enforced:** INV-FILED-1 (immutable, never app-generated), INV-AUDIT-1, INV-TENANT-1

**Acceptance Criteria:**
- Given filed PDFs exist, when staff opens, then audit log captures view event
- Given no PDFs, when section opened, then helpful empty state shown

**Test Cases:**
- Unit: integrity check verifies PDF hash matches upload
- Integration: audit row written on view
- E2E: inline viewer works on iOS Safari and Android Chrome
- Performance: streaming large PDF does not OOM


### UC-CL-ST-13: Submit quarterly feedback as staff with attribution
**Actor:** Client (client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Period state = complete or later (Gate 2 satisfied)
- Firm policy allows staff to submit feedback (configurable; default may allow both owner and staff to each submit independently)
- Staff has not yet submitted feedback for this period

**Main Flow:**
1. Banner appears: 'Share feedback for this quarter'
2. Staff taps; form shows 3 base ratings (Quality, Service, App) + up to 2 dynamic auto-prompts when operational signals crossed firm-set thresholds
3. Each auto-prompt is stored with linkage to the operational signal that triggered it (e.g. signal=turnaround_above_threshold → 'How did our turnaround time feel?')
4. Soft copy (no hard required submit) — staff can skip optional comment
5. Submit POSTs { ratings[], optionalComments[], promptLinkages[], idempotencyKey } to /api/client/feedback
6. Backend persists with submitted_by_user_id, sub_role=client_staff, period_id, signal_linkages
7. Audit log: feedback_submitted with sub_role

**Alternate Flows:**
- Firm restricts feedback to owner only → CTA hidden for staff; explanatory message
- Owner already submitted → staff can still submit independent feedback if firm policy allows multiple submissions; firm-side scorecard aggregates with attribution
- If firm policy = one submission per client → first-write-wins; staff sees 'Owner has already submitted this quarter's feedback'

**Edge Cases:**
- Configurable cap of auto-prompts = 0 → only 3 base ratings shown
- More than 2 signals crossed thresholds → only top 2 (by config priority) prompted
- Threshold edited by firm after eligibility computed → snapshot prompts at first render; do not change mid-flow
- Browser refresh mid-form → draft saved locally; restored
- Submit retried after success → idempotency key dedupes
- Star rating tap on mobile must have ≥44px target
- Localization: French/English copy
- Signal linkage must store BOTH rating value and the signal that triggered the prompt for later firm-side join

**Invariants Enforced:** INV-FEEDBACK-1 (3 base + ≤2 configurable auto-prompts), INV-FEEDBACK-2 (rating ↔ signal linkage stored), INV-SIGNAL-PRIV-1 (operational signals never shown to client even when used to trigger prompt), INV-AUDIT-1, INV-TENANT-1

**Acceptance Criteria:**
- Given gate2 satisfied, when staff opens feedback, then exactly 3 base + ≤firmCap auto-prompts are shown
- Given a triggered prompt, when staff rates, then signal_id is persisted with the rating
- Given firm restricts to owner, when staff loads page, then CTA is hidden
- Given feedback submitted, when audit log reviewed, then sub_role=client_staff present
- Given signal=turnaround crossed, when prompt shown, then prompt text never reveals the operational metric value

**Test Cases:**
- Unit: prompt selector caps at firm-configured max
- Unit: signal linkage persisted with rating
- Integration: idempotent submit
- Privacy: response payload to client never includes raw operational signal values
- E2E: feedback form on mobile with 5-star tap target check
- Accessibility: star ratings keyboard-navigable; ratings announced
- i18n: French copy renders without overflow on small screens


### UC-CL-ST-14: View 'who did what' activity feed within client account
**Actor:** Client (client_staff) | **Priority:** P2 | **Platform:** mobile

**Preconditions:**
- Authenticated as client_staff
- At least one client-side action has occurred

**Main Flow:**
1. Staff opens 'Activity' tab
2. GET /api/client/activity returns paginated list of client-side actions: uploads, flag answers, attestations, feedback, downloads
3. Each row shows actor display name and role badge ('Owner' / 'Staff') with timestamp

**Alternate Flows:**
- Owner-only view of activity (firm policy) → staff sees only own actions

**Edge Cases:**
- Display names redacted if staff removed → show 'Removed staff'
- No accountant or operator activity surfaced here (privacy boundary)
- Confidence/operational signals never shown
- Pagination cursor stable under concurrent inserts

**Invariants Enforced:** INV-AUDIT-1 (read-only view of own-side audit), INV-CONF-1, INV-SIGNAL-PRIV-1, INV-TENANT-1

**Acceptance Criteria:**
- Given multiple actors, when staff opens feed, then role badges clearly differentiate owner vs staff
- Given accountant actions, when activity loaded, then they are excluded from client feed
- Given confidence or signal values, when payload inspected, then none present

**Test Cases:**
- Unit: activity query filters to client-side events only
- Integration: redacted staff name handled gracefully
- E2E: pagination works under concurrent writes
- Accessibility: list announces actor and action


### UC-CL-ST-15: Receive push/in-app notifications scoped to staff permissions
**Actor:** Client (client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Staff granted notification permission on device
- PWA service worker registered
- Staff is not owner-only-restricted from notification topics

**Main Flow:**
1. On first dashboard load, PWA requests notification permission
2. Subscription registered to /api/client/push/subscribe with device token, sub_role=client_staff
3. When events occur (new flag raised, accountant marked period complete, feedback prompt available), backend filters by recipient eligibility (sub_role permissions, owner-only flags excluded)
4. Push delivered with action deep link; tap routes to context

**Alternate Flows:**
- Owner-only flag raised → only owner notified; staff suppressed
- Notification permission denied → fallback to in-app inbox badge

**Edge Cases:**
- Token rotation on iOS → re-subscribe automatically
- Multiple devices per staff user → broadcast to all
- Staff revoked between event and delivery → backend filters by current user status; delivery suppressed
- Silent push for background sync → respects platform quotas
- Deep link to a now-archived flag → graceful 'this flag is no longer active' screen
- Notification content must not include confidence or signal values

**Invariants Enforced:** INV-NOTIF-1 (recipient eligibility check at send time), INV-CONF-1, INV-SIGNAL-PRIV-1, INV-TENANT-1

**Acceptance Criteria:**
- Given owner-only flag, when raised, then staff does not receive notification
- Given revoked staff, when event fires, then no notification sent
- Given multiple devices, when event fires, then all eligible devices receive

**Test Cases:**
- Unit: recipient eligibility filter respects owner-only and revocation
- Integration: token rotation re-registers
- E2E mobile: receive and tap notification on iOS and Android PWA
- Privacy: notification body excludes operational signals and confidence
- Performance: fan-out queue handles burst without dropping


### UC-CL-ST-16: Owner restricts or revokes staff access; staff session terminates gracefully
**Actor:** Client (client_owner initiates; client_staff affected) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- Owner has staff member(s) attached to the client account
- Owner is authenticated

**Main Flow:**
1. Owner opens 'Team' settings; sees list of staff with last-active timestamps
2. Owner taps 'Revoke' on a staff row; confirms
3. DELETE /api/client/staff/{id} sets user.status=revoked, revoked_at, revoked_by
4. Backend invalidates all refresh tokens; access tokens reject on next call
5. Audit log: staff_revoked
6. Staff's next API call returns 401/403; PWA shows 'Your access has been removed by the business owner — contact them for details' and logs out

**Alternate Flows:**
- Owner can restrict (instead of revoke): toggle granular permissions (upload / answer flags / attest / download / feedback)
- Revocation can be reversed only by owner re-inviting (no soft-undo to avoid audit gaps)

**Edge Cases:**
- Staff has active uploads in flight → S3 PUTs complete; metadata POST then rejected; document orphan cleanup job sweeps within TTL
- Staff actively typing flag answer → on submit, 403; draft preserved locally but unsubmittable
- Race: owner revokes while staff signs attestation → attestation transaction rolls back; staff sees 'access revoked'
- Owner cannot revoke self via this surface (separate owner-transfer flow)
- Background push tokens cleared on revocation
- Audit log of past staff actions remains intact (revocation does not erase history)

**Invariants Enforced:** INV-AUTH-3 (revocation effective immediately), INV-AUDIT-1 (revocation logged; past actions retained), INV-AUDIT-2 (no permanent deletes of financial data), INV-TENANT-1

**Acceptance Criteria:**
- Given owner revokes staff, when staff makes next API call, then 401/403 returned within 60s of revocation
- Given revoked staff, when they re-login, then login is blocked with revocation message
- Given past staff actions, when revoked, then audit log retains them with sub_role attribution
- Given owner restricts a permission, when staff retries that action, then 403 with permission name

**Test Cases:**
- Unit: refresh token invalidation list checked on every issue
- Integration: revocation propagates to push subscriptions
- E2E: revocation flow from owner mobile, staff observes logout within 60s
- Security: revoked staff cannot replay old access tokens after expiry
- Audit: prior staff actions remain queryable with sub_role intact


### UC-CL-ST-17: Concurrent edit conflict between owner and staff on same flag
**Actor:** Client (client_staff) | **Priority:** P0 | **Platform:** mobile

**Preconditions:**
- An open flag exists
- Both owner and staff have answer permission for it
- Both attempt to submit answers within a short window

**Main Flow:**
1. Staff submits answer; backend uses optimistic concurrency check via flag.version or DB row lock
2. If staff submission is first to acquire lock → succeeds, flag.answered_by_sub_role=client_staff
3. Owner's subsequent submit returns 409 with current state (winner's answer text + attributor sub_role)
4. Owner UI shows merge/override modal: 'Staff has already answered. View their answer / Append a comment'
5. If staff is second → staff sees same 409 with owner's answer; can append a comment routed to accountant as a separate note

**Alternate Flows:**
- If accountant resolved the flag concurrently → both client-side submits get 410 Gone with resolved state
- If firm policy = owner-supersedes-staff → staff submit blocked when owner is mid-answer (owner holds soft lock); after 5 min idle, lock released

**Edge Cases:**
- Network partition splits views → both sides retry; deterministic resolution via version vector
- Both submit identical content → second deduplicated based on hash; no double audit
- Lost update protection: never overwrite a newer winner with a stale loser
- Staff offline submits, owner online submits → on staff reconnect, staff's queued submit gets 409 and stored as appended comment (with timestamp of original attempt)
- Audit log preserves both attempt records for traceability

**Invariants Enforced:** INV-CONC-1 (optimistic concurrency on flag answers), INV-AUDIT-1 (both attempts logged), INV-FLAG-COLOR-1, INV-TENANT-1

**Acceptance Criteria:**
- Given concurrent submits, when one wins, then loser receives 409 with winner's identity (within tenant)
- Given accountant resolution mid-flight, when client submits, then 410 returned
- Given queued offline submit losing to online winner, when reconciled, then staff submit stored as appended comment with original timestamp

**Test Cases:**
- Unit: optimistic version check rejects stale write
- Integration: simulated concurrent POSTs produce exactly one winner
- Chaos: network partition test maintains consistency
- E2E: owner-staff race on mobile produces correct UI on both sides
- Audit: both attempts visible with sub_role attribution


### UC-CL-ST-18: Concurrent owner-staff document upload deduplication and dual attribution
**Actor:** Client (client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Period open, not aiLocked
- Both owner and staff have upload permission

**Main Flow:**
1. Staff uploads file A (sha256=X) while owner uploads file B (sha256=X) within seconds
2. Backend persists both document rows but checklist dedupes on sha256 (one increment)
3. Both rows carry distinct uploaded_by_user_id and sub_role for audit
4. Activity feed shows both events

**Alternate Flows:**
- If exact same file twice by same user → idempotency-key dedupes both row and event
- If different files for same checklist slot → both attach; checklist count increments per distinct sha256

**Edge Cases:**
- Slot-based slots (e.g. 'bank statement Q1') accept only one canonical; second attempt warns 'replace existing?' — replace flow only allowed before aiLocked
- Replace flow logs both original and replacement with full provenance
- Concurrent replace by both actors → last-write-wins on the slot, with audit trail of all attempts
- Storage quota near limit → 507; UI prompts to contact accountant

**Invariants Enforced:** INV-DOC-LOCK-1, INV-DOC-IMMUT-1 (post-upload, no edit; replace creates new row, original retained), INV-AUDIT-1, INV-TENANT-1

**Acceptance Criteria:**
- Given two uploads same sha256, when both persist, then checklist counts once and audit logs both
- Given slot-based replacement, when staff replaces, then original is retained in storage with archived flag

**Test Cases:**
- Unit: checklist deduper keyed on sha256
- Integration: concurrent upload race produces two doc rows, one increment
- Storage: replaced file retained per immutability invariant
- E2E: owner and staff upload from two devices, both visible in activity


### UC-CL-ST-19: Recover from session expiry mid-action without data loss
**Actor:** Client (client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Staff is mid-action (typing answer, picking file, filling feedback)
- Access token expires; refresh token may also expire

**Main Flow:**
1. Frontend interceptor detects 401 on next API call
2. Attempts silent refresh; if successful, retries original request transparently
3. If refresh fails (refresh expired or revoked), draft is persisted to IndexedDB with stable key (e.g. flagId + userId)
4. User redirected to login with banner 'You were signed out — your draft has been saved'
5. After re-login, draft is restored automatically on returning to the surface

**Alternate Flows:**
- If user was revoked during expiry → login fails; draft preserved locally but greyed out with 'access removed'
- If user has multiple drafts → list view shows them on next login

**Edge Cases:**
- Drafts older than 7 days auto-purged
- Draft for an item that no longer exists (flag resolved by accountant) → show 'draft no longer applicable' option to discard
- PII in drafts encrypted at rest in IndexedDB via WebCrypto with device-scoped key
- Refresh token rotated on use; old refresh invalid
- Clock skew: TTL computed server-side; client never trusts own clock for expiry

**Invariants Enforced:** INV-AUTH-4 (refresh rotation), INV-DRAFT-1 (encrypted at rest, device-scoped, TTL'd), INV-TENANT-1

**Acceptance Criteria:**
- Given mid-typing expiry, when silent refresh succeeds, then user sees no interruption
- Given full expiry, when re-login completes, then draft is restored on the same surface
- Given revocation, when re-login fails, then drafts are not transmitted to backend

**Test Cases:**
- Unit: interceptor retry logic
- Integration: refresh rotation invalidates previous refresh
- Security: IndexedDB encryption key not extractable
- E2E: expiry mid-typing restores draft after login
- Edge: draft TTL purge job


### UC-CL-ST-20: Install PWA on mobile and use offline-friendly surfaces
**Actor:** Client (client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Browser supports PWA installation (Chrome/Edge/Android; iOS Safari A2HS)
- Manifest and service worker registered

**Main Flow:**
1. On first eligible visit, PWA shows install prompt (deferred until after onboarding)
2. Staff installs to home screen
3. Service worker caches shell (HTML/CSS/JS), fonts, and read-only assets
4. When offline, staff can view last-loaded dashboard summary, draft flags they were typing, and queued uploads
5. Mutations queued in IndexedDB outbox; replay on reconnect with original timestamps

**Alternate Flows:**
- iOS Safari requires manual 'Add to Home Screen' — show illustrated instructions
- User declines install prompt → don't re-prompt for 14 days

**Edge Cases:**
- Stale shell after deploy → service worker update strategy: skipWaiting with user prompt to refresh
- Offline queue grows large → cap size with warning
- Background sync API unavailable on iOS → replay on next foreground
- Conflicting offline edits across devices → server resolves via UC-CL-ST-17 rules
- Service worker bug breaking auth → kill-switch endpoint to force unregister

**Invariants Enforced:** INV-PWA-1 (offline-safe queue, replay semantics), INV-TENANT-1, INV-AUDIT-1 (queued actions audited with original timestamp)

**Acceptance Criteria:**
- Given installed PWA, when offline, then dashboard last-known state is viewable
- Given queued mutation, when reconnected, then replay produces correct audit attribution with original timestamp metadata
- Given stale shell, when new deploy detected, then user is prompted to refresh

**Test Cases:**
- Unit: service worker cache strategy correctness
- Integration: outbox replay handles success and conflict paths
- E2E iOS: A2HS flow
- E2E Android: install prompt flow
- Performance: cache size monitored
- Accessibility: install prompt does not trap focus


### UC-CL-ST-21: Search and filter documents and flags within a period
**Actor:** Client (client_staff) | **Priority:** P2 | **Platform:** mobile

**Preconditions:**
- Period has multiple documents and/or flags

**Main Flow:**
1. Staff taps search; types query
2. Frontend debounces input (250ms); GET /api/client/search?q=&periodId= returns matched documents (filename, type) and flags (prompt text, status)
3. Results show source and color; tap routes to detail

**Alternate Flows:**
- Empty query → recent items
- No results → friendly empty state with suggested filters

**Edge Cases:**
- Special characters and injection attempts → parameterized; sanitized
- Unicode normalization (NFC) for matching
- Search excludes confidence and operational signals
- Very rapid keystrokes → debounced and last-wins
- Large result sets → paginated; mobile-friendly chunking

**Invariants Enforced:** INV-CONF-1, INV-SIGNAL-PRIV-1, INV-TENANT-1

**Acceptance Criteria:**
- Given a query, when results returned, then no confidence or operational signals appear
- Given high typing rate, when search runs, then only final query result is rendered

**Test Cases:**
- Unit: debounce logic
- Integration: parameterized search prevents injection
- E2E: search on mobile keyboard with autocorrect
- Performance: 1000-item index search < 300ms p95


### UC-CL-ST-22: View staff-specific account profile and update display name / locale
**Actor:** Client (client_staff) | **Priority:** P2 | **Platform:** mobile

**Preconditions:**
- Authenticated as client_staff

**Main Flow:**
1. Staff opens 'Profile' from menu
2. Sees: display name, email (read-only), role badge 'Staff', firm/client linkage (read-only), locale (en-CA / fr-CA)
3. Staff edits display name; PATCH /api/client/me persists; audit log: profile_updated
4. Staff changes locale; UI reloads strings

**Alternate Flows:**
- Staff cannot change email (security boundary)
- Staff cannot self-elevate role (UI disabled and backend enforces)

**Edge Cases:**
- Display name with unsafe HTML → sanitized for display
- Display name uniqueness not required, but profanity filter optional per firm
- Locale change persisted server-side and applied immediately
- PWA manifest theme respects locale where relevant
- Concurrent updates from two devices → last-write-wins; both audited

**Invariants Enforced:** INV-AUTH-5 (no self role-elevation), INV-AUDIT-1, INV-TENANT-1

**Acceptance Criteria:**
- Given valid display name change, when saved, then profile reflects update and audit row exists
- Given role-elevation attempt via payload tamper, when sent, then 403 returned
- Given locale change, when reloaded, then UI strings switch to selected locale

**Test Cases:**
- Unit: profile validator strips role fields
- Integration: tamper attempt rejected
- E2E: locale switch mobile
- Accessibility: form labels and error messages
- i18n: French strings render without truncation


### UC-CL-ST-23: Bulk upload multiple receipts from camera burst or photo library
**Actor:** Client (client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- Period open and not aiLocked
- Staff has upload permission

**Main Flow:**
1. Staff selects up to N (e.g. 20) images from library or burst-captures
2. PWA shows queue with thumbnails and progress per item
3. Uploads proceed in parallel (concurrency capped, e.g. 3) with per-item retry
4. Each item completes its own metadata POST with shared batch_id for grouping in activity
5. On all complete, activity feed shows 'Staff uploaded N documents'

**Alternate Flows:**
- Some items fail → user can retry only failed items
- User cancels batch mid-flight → in-flight items finish; queued items discarded
- Mixed types (PDFs + images) allowed within cap

**Edge Cases:**
- Memory pressure on mobile → throttle concurrency
- Battery saver mode → reduce concurrency further
- Network downgrade 4G → 3G → adaptive chunk size
- Background tab → uploads continue if PWA grants
- OS kill mid-batch → outbox resumes on relaunch
- Duplicate detection across batch keyed on sha256

**Invariants Enforced:** INV-DOC-LOCK-1, INV-AUDIT-1 (batch attributed to sub_role=client_staff), INV-RESIDENCY-1

**Acceptance Criteria:**
- Given N selected images, when batch starts, then concurrency-capped uploads proceed and partial failures retryable
- Given duplicates, when batch processed, then checklist dedupes
- Given OS kill, when relaunched, then resumes via outbox

**Test Cases:**
- Unit: concurrency limiter
- Integration: batch_id grouping
- E2E mobile: 20-image library pick
- Resilience: kill mid-batch and relaunch
- Performance: total throughput targets


### UC-CL-ST-24: Accessibility — screen reader and reduced-motion navigation
**Actor:** Client (client_staff) | **Priority:** P1 | **Platform:** mobile

**Preconditions:**
- VoiceOver (iOS) or TalkBack (Android) enabled, or prefers-reduced-motion: reduce

**Main Flow:**
1. All interactive elements have ARIA labels and roles
2. Live regions announce state changes (gate1/2 transitions, flag count changes, upload progress)
3. Touch targets ≥ 44x44 px
4. Reduced motion disables non-essential animations; keeps state-change indicators
5. Color is not the sole conveyor of meaning (flag colors paired with text label 'System' / 'Accountant')

**Alternate Flows:**
- High-contrast mode supported via system
- Dynamic type (iOS) and font scaling (Android) respected up to 200%

**Edge Cases:**
- Long announcements truncated → polite live region prevents queue overflow
- Modal traps focus correctly
- Custom controls (star rating) keyboard-operable
- Locale changes update aria-language attribute

**Invariants Enforced:** INV-A11Y-1 (WCAG 2.1 AA conformance), INV-CONF-1 (no confidence even via aria-labels)

**Acceptance Criteria:**
- Given screen reader, when staff navigates, then all controls announced with role and state
- Given color-blind user, when reading flags, then text label clarifies source
- Given dynamic type 200%, when layout renders, then no clipped text

**Test Cases:**
- Automated: axe-core scan with zero serious/critical issues
- Manual VoiceOver: full onboarding flow
- Manual TalkBack: full flag answer flow
- Manual reduced-motion: gate transitions
- Manual dynamic type: dashboard at 200%


### UC-CL-ST-25: Observability — emit and verify staff-side telemetry without leaking financials
**Actor:** Client (client_staff) | **Priority:** P2 | **Platform:** mobile

**Preconditions:**
- Telemetry SDK initialized with tenant + sub_role tags
- Opt-in or jurisdictional defaults respected (PIPEDA)

**Main Flow:**
1. PWA emits anonymized events: page_view, flag_answer_submitted, upload_started/completed/failed, attestation_signed, feedback_submitted, gate1_unlocked_seen, gate2_unlocked_seen
2. Server-side enrichments add tenant_id, sub_role=client_staff
3. PII (names, file contents, financial values, confidence) explicitly excluded from event payloads
4. Errors captured with breadcrumbs; PII scrubbed via allow-list

**Alternate Flows:**
- User opts out → telemetry SDK disabled; essential error capture still allowed (minimal, hashed)

**Edge Cases:**
- SDK init fails → app continues; errors not blocking
- Network failures → events queued with cap; oldest dropped
- Cross-tenant contamination prevented by SDK scope reset on logout/switch
- Confidence and operational signals never logged
- Filed PDF content never serialized to logs

**Invariants Enforced:** INV-PRIV-1 (no PII/financials in telemetry), INV-CONF-1, INV-SIGNAL-PRIV-1, INV-RESIDENCY-1 (telemetry endpoint in ca-central-1), INV-TENANT-1

**Acceptance Criteria:**
- Given any event, when inspected, then no PII or financial values are present
- Given opt-out, when events fire, then non-essential events suppressed
- Given user logout, when next user logs in, then SDK context is reset

**Test Cases:**
- Unit: scrubber removes PII fields from payloads
- Integration: telemetry endpoint resides in ca-central-1
- Privacy: contract test asserts event allow-list
- Security: tenant context reset on logout
- Performance: telemetry does not block main thread


## Cross-user-type (Platform Operator, Firm Admin, Accountant, Client) (cross-platform)

### UC-X-01: Client uploads document triggering AI processing pipeline visible to accountant
**Actor:** Client (client_owner or client_staff) -> System -> Accountant | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Tenant is active (not suspended)
- Client account provisioned, linked to firm + active period
- Period is in 'open' state
- Client authenticated on Client Portal (PWA)
- aiLocked = false for the period

**Main Flow:**
1. Client opens Client Portal PWA, navigates to current quarter upload area
2. Client selects/captures document (image, PDF, receipt)
3. PWA validates file size/type client-side, shows upload progress
4. Backend receives multipart upload, stores in S3 (ca-central-1) with tenant_id prefix
5. Backend creates document record with tenant_id, period_id, status='uploaded'
6. Backend enqueues AI processing job (BullMQ/SQS) with document_id
7. Worker pulls job, calls AI extraction service (e.g., Textract + LLM), respecting RLS tenant context
8. Worker writes extracted fields, confidence scores, vendor, amount, HST split to transactions table
9. Worker sets aiLocked=true on document (immutable for client thereafter)
10. If confidence < firm threshold OR ambiguous classification, system raises a yellow flag
11. Period transitions to 'processing' on first successful extraction
12. Accountant on Firm Workspace sees real-time count badge increase via WebSocket/SSE
13. Document appears in accountant's queue with extracted data + flag list

**Alternate Flows:**
- If file >25MB, PWA chunked upload via tus protocol; resume on flaky connection
- If aiLocked=true (processing started), upload is blocked with explanatory toast
- If AI extraction fails 3x, system raises red flag and marks document 'needs_manual'
- If duplicate hash detected (same file already uploaded), surface dedupe prompt before persisting
- If client offline, PWA queues upload in IndexedDB; service worker retries on reconnect
- If client uploads after Gate 2 (period complete), upload is rejected with state-violation error

**Edge Cases:**
- Client uploads 50 photos in rapid succession - rate limiter caps at 10/min, queues rest
- Browser refresh mid-upload - PWA recovers via service worker resume token
- Image rotated/EXIF-skewed - extraction normalizes orientation before OCR
- PDF is password-protected - extraction fails gracefully, raises red flag
- Client takes photo of monitor (screen photo) - low-confidence flag raised
- Two devices upload same file simultaneously - DB unique constraint on (tenant_id, period_id, file_hash) wins one
- Client uploads to wrong period boundary at midnight EST - server-side period derivation overrides client-side guess
- Session expires mid-upload - upload completes via refresh token; if refresh fails, file retained in browser for retry
- AI worker dies mid-extraction - job retries with idempotency key; partial transactions cleaned up
- Confidence shown to client (REGRESSION) - automated test fails

**Invariants Enforced:** INV-TENANT-1, INV-DOC-LOCK-1, INV-CONF-HIDDEN-1, INV-FLAG-COLOR-1, INV-RESIDENCY-1, INV-AUDIT-1

**Acceptance Criteria:**
- Given period is open, when client uploads valid PDF, then aiLocked transitions to true after worker picks up job and document becomes immutable to client
- Given confidence < threshold, when extraction finishes, then a yellow (system) flag is created and visible in accountant queue within 5s
- Given accountant is viewing period, when new document arrives, then UI updates without manual refresh (WebSocket push)
- Then confidence score is NEVER returned in any client-facing API response (verified by contract test)
- Then audit log records upload event with actor_id, tenant_id, ip, user_agent, timestamp

**Test Cases:**
- Unit: extractor confidence threshold logic with boundary values (0.59, 0.60, 0.61)
- Integration: upload -> worker -> flag creation -> WebSocket broadcast within 5s
- E2E (Playwright + PWA): client uploads on mobile Safari, accountant on desktop Chrome sees flag
- Security: client A cannot read client B's document via direct S3 URL guess (RLS + signed URL test)
- Security: API contract snapshot test asserts no 'confidence' key in /client/transactions
- Performance: 100 concurrent uploads from 10 clients - p95 extraction queue lag < 30s
- Accessibility: upload button has aria-label, focus trap on modal, screen reader announces progress
- PWA: airplane-mode upload queued in IndexedDB, replays on reconnect (Workbox test)
- Chaos: kill AI worker mid-job, verify retry + no duplicate transactions


### UC-X-02: Accountant raises red flag, client receives push + answers, accountant sees answer
**Actor:** Accountant -> Client (cross-app via notification) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Period in 'processing' or 'processed' state
- Accountant authenticated in Firm Workspace with permission flag_raise
- Client has push notifications enabled (or email fallback configured)
- Tenant active

**Main Flow:**
1. Accountant reviews transaction in Firm Workspace, clicks 'Raise Flag'
2. Accountant selects flag type (missing receipt, vendor unclear, personal vs business, HST status, other), writes question text
3. Backend creates flag record with color=red (source=accountant), state=open, target=client
4. Backend writes audit entry; backend emits domain event flag.created
5. Notification service fans out: Web Push (FCM/APNs via PWA), in-app badge, email digest if push fails after 10min
6. Client receives push on phone, taps notification, deep-links into specific flag in Client Portal
7. Client reads question, types answer in text area, optionally attaches photo/receipt
8. If client attaches receipt, system double-writes: creates new transaction AND increments checklist count atomically
9. Backend stores answer, flag state -> answered, emits flag.answered event
10. Accountant in Firm Workspace sees real-time badge update; flag moves to 'pending review' lane
11. Accountant reviews answer, clicks 'Resolve' (or raises follow-up); flag state -> closed
12. If receipt attached, accountant verifies vendor/amount, can edit before resolving
13. Audit log records each transition with actor + timestamp

**Alternate Flows:**
- If client doesn't answer in 48h, system sends reminder push; firm-configurable
- If client cannot find document, client uses 'Not found' attestation - write-once, attributed, timestamped; transaction still recorded with 'no_receipt' marker
- If accountant raises follow-up flag, original flag stays linked as parent for audit trail
- If client provides ambiguous answer, accountant can reopen flag with comment; state goes answered -> open again with version increment
- If notifications disabled, email fallback fires immediately

**Edge Cases:**
- Client mid-typing answer when accountant edits flag question - optimistic concurrency: version mismatch -> show 'question changed' banner, preserve draft
- Client double-taps Submit - idempotency key on POST prevents duplicate answer
- Push fails on iOS due to revoked permission - in-app red dot on next visit; email fallback after 10min
- Client answers from PWA in airplane mode - queued via Background Sync API, sent on reconnect
- Accountant raises flag, then tenant gets suspended - flag persists but notifications paused; client sees read-only banner
- Browser refresh on client mid-draft - draft persisted to IndexedDB, restored on return
- Time-zone mismatch: accountant in Toronto, client traveling in Europe - all timestamps stored UTC, displayed in user-locale
- Notification arrives after period archived - deep link shows read-only archived view
- Accountant raises 50 flags at once - bulk API endpoint; client sees grouped notification 'You have 50 questions'
- Client answers, then accountant marks period processed (UC-X-04) - answer still accepted if not yet closed

**Invariants Enforced:** INV-FLAG-COLOR-1, INV-ATTEST-1, INV-RECEIPT-DOUBLE-WRITE-1, INV-AUDIT-1, INV-CONF-HIDDEN-1

**Acceptance Criteria:**
- Given accountant raises flag, when saved, then flag.color = 'red' in DB regardless of any UI selection
- When client answers, then accountant sees update without page refresh within 3s
- Given client clicks Not Found, then attestation row written once with actor_id, ts, ip, and any subsequent click is rejected (409)
- Then receipt upload from a flag creates exactly one transaction AND exactly one checklist increment (verified in single DB transaction)
- Then no API response containing flag exposes a 'confidence' field

**Test Cases:**
- Unit: flag color resolver always returns 'red' for accountant source
- Integration: flag-raise -> notification -> answer -> resolve, full lifecycle in <10s
- E2E: Playwright cross-browser, FCM push delivered to PWA installed on Android emulator
- Race: simultaneous answer + accountant resolve - last-write-wins with audit trail of both
- Security: client A cannot answer client B's flag (RLS + auth filter test)
- Security: client cannot raise own flag via API (RBAC test on POST /flags)
- Accessibility: flag answer form keyboard-only, screen reader announces character count
- PWA: offline answer queues via Background Sync, replays with same idempotency key
- Manual: install PWA on iOS, verify push works on real device (APNs cert validation)
- Load: 1000 concurrent answer submissions across tenants - no cross-tenant leakage in audit log


### UC-X-03: Concurrency: client mid-answer when accountant marks period processed
**Actor:** Client + Accountant (race condition) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Period in 'processing' state
- At least one open flag exists and client has draft in progress
- All other flags resolved
- Both users authenticated, online

**Main Flow:**
1. Client is typing answer to last open flag in Client Portal
2. Accountant in Firm Workspace mistakenly clicks 'Mark Processed' assuming flags clear
3. Backend validates pre-condition: count(open_flags WHERE period_id=X) MUST equal 0
4. Validation fails (1 flag still open); request returns 409 Conflict with reason 'open_flags_remaining'
5. Accountant UI shows toast 'Cannot mark processed: 1 flag still open (Client is responding)'
6. Client finishes typing, submits answer; flag state -> answered
7. Accountant reviews and resolves flag; flag state -> closed
8. Accountant clicks 'Mark Processed' again; validation passes
9. Period transitions processing -> processed
10. Gate 1 check runs: all flags closed AND period processed -> client sees DRAFT numbers unlock

**Alternate Flows:**
- If accountant force-overrides via 'Resolve without answer' (sub-permission), flag closes with auto-attestation; period can proceed
- If accountant marks processed via bulk action across multiple clients, each is validated independently; partial success returned
- If client submits answer at exact same millisecond as accountant click, DB row lock on period serializes; whichever transaction starts first wins, other gets 409 + retry hint

**Edge Cases:**
- Client submits, accountant marks processed in <50ms - both commit; flag answered + closed by system? No - accountant must explicitly close, but processed can advance only when CLOSED, so flow self-corrects via 409 retry
- Network partition: client thinks answer sent, server didn't receive - PWA retry via Background Sync
- Accountant's clock skewed - all timestamps server-side, never trust client clock
- Optimistic UI shows 'processed' on accountant screen, then server rejects - UI rolls back with banner
- Three accountants in same firm both click Mark Processed - DB advisory lock on period_id ensures one wins
- Client refreshes during answer - draft restored from IndexedDB
- Period state machine attempts illegal transition (processing -> complete skipping processed) - rejected at guard

**Invariants Enforced:** INV-PERIOD-FSM-1, INV-GATE1-1, INV-AUDIT-1, INV-OPTIMISTIC-LOCK-1

**Acceptance Criteria:**
- Given any open flag exists, when accountant calls mark-processed API, then response is 409 and period stays in 'processing'
- When validation fails, then audit log records the rejected attempt with reason
- Given all flags closed, when accountant marks processed, then Gate 1 fires and client portal numbers panel switches from 'pending' to 'DRAFT'
- Then DRAFT watermark renders on client numbers screen (visual + accessibility label)

**Test Cases:**
- Integration: concurrent POST /periods/:id/mark-processed and POST /flags/:id/answer with controlled ordering - asserts state machine invariant
- Property test (fast-check): randomize event ordering, FSM never enters illegal state
- E2E: two browser contexts (accountant + client) drive concurrent flow; client sees toast when flag closes server-side
- Unit: period FSM guard rejects processed when open_flags > 0
- Security: client cannot trigger mark-processed via crafted request
- Accessibility: error toast announced via aria-live=assertive


### UC-X-04: Gate 1 fires: numbers unlock on client portal after all flags cleared + period processed
**Actor:** System -> Client (triggered by Accountant action) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Period transitions to 'processed'
- All flags in closed state
- Client has active session OR will see on next portal load

**Main Flow:**
1. Backend domain event period.processed fires
2. Gate 1 evaluator runs: closed_flag_count == total_flag_count AND period.state == 'processed'
3. If true, set period.draftVisible = true
4. Push event to client via WebSocket / SSE
5. Client Portal numbers tab transitions from skeleton/locked state to DRAFT numbers screen
6. DRAFT watermark overlay rendered on P&L summary
7. Numbers shown net of HST; HST broken out: line 105 (collected), 108 (ITCs), 109 (net tax)
8. Excel download button remains LOCKED (gated by Gate 2)
9. Feedback CTA remains hidden (gated by Gate 2)
10. Audit log records gate1_fired event

**Alternate Flows:**
- If client offline, gate fires server-side; on next portal load, numbers visible
- If accountant reopens a flag after Gate 1 (rare), gate reverts: draftVisible=false, banner 'Numbers temporarily hidden while accountant reviews'
- If period rolled back from processed -> processing (admin override), gate reverts and numbers re-lock

**Edge Cases:**
- Client viewing numbers when gate reverts - UI hides numbers gracefully with explanation banner, doesn't crash
- Client took screenshot of DRAFT numbers - allowed; watermark visible in screenshot
- Client tries to download Excel via API direct call - 403 with reason 'gate2_locked'
- P&L contains negative net tax (refund position) - displays as 'CRA owes you $X' with proper sign
- Multi-currency vendor - all converted to CAD at transaction date FX rate; rate stored for audit
- HST not registered for this client - line 105/108/109 hidden, replaced with 'HST: Not registered' label
- Period with zero transactions - empty state 'No activity this period' but P&L still shows $0 lines
- Browser zoom 400% / mobile rotated - numbers remain readable, no horizontal scroll on critical totals
- Screen reader user - all numbers announced with currency context

**Invariants Enforced:** INV-GATE1-1, INV-GATE2-1, INV-CONF-HIDDEN-1, INV-HST-BREAKOUT-1, INV-NET-OF-HST-1

**Acceptance Criteria:**
- Given all flags closed and period processed, then within 3s client portal shows DRAFT numbers
- Given Gate 1 fired, when client calls /excel endpoint, then 403 with 'gate2_locked'
- Then HST line 105 + 108 + 109 displayed for HST-registered clients only
- Then numbers displayed are NET of HST (verified against transaction sum minus HST collected)
- Then NO confidence field in any client API response (snapshot test)

**Test Cases:**
- Unit: Gate1 evaluator with truth table of (flags_state, period_state)
- Integration: state transition triggers WebSocket push, client SDK receives event
- E2E: complete flow from upload to Gate 1 fire, assert DRAFT visible + Excel locked
- Security: penetration test on /excel endpoint with valid client JWT but gate2_locked
- Accessibility: WCAG AA contrast on DRAFT watermark, screen reader reads watermark text
- Visual regression: numbers screen snapshot across breakpoints (320, 768, 1024px)


### UC-X-05: Accountant attempts Gate 2 (mark complete) with open flags - denial path
**Actor:** Accountant -> System (denial) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Period in 'processed' state
- At least one flag still open (state != closed)
- Accountant authenticated with permission period_complete

**Main Flow:**
1. Accountant clicks 'Mark Complete' on period dashboard
2. Backend pre-condition check: ALL flags must be closed AND period must be 'processed'
3. Open flag count > 0; request rejected with 409 + structured error 'open_flags_remaining'
4. Frontend shows modal listing open flags with deep-links to resolve each
5. Audit log records attempted_mark_complete_blocked event
6. Accountant must resolve each flag (UC-X-02) before retry

**Alternate Flows:**
- If accountant has override permission (firm-configurable), can bulk-resolve with reason; each resolution audited
- If flags are answered but not yet closed by accountant, modal shows 'Review and close 3 answers' shortcut

**Edge Cases:**
- Accountant clicks rapidly 5x - idempotent endpoint returns same 409 each time, no duplicate audit entries
- Flags closed by another accountant in same firm between click and server call - server re-checks; succeeds gracefully
- Period was processed by AI re-run mid-click - state may have regressed; FSM guard catches it
- Browser tab in background when click fires - request queued; on focus, result shown
- Accountant tries via API directly - same 409, no UI bypass possible

**Invariants Enforced:** INV-PERIOD-FSM-1, INV-GATE2-1, INV-AUDIT-1

**Acceptance Criteria:**
- Given any open flag exists, when accountant calls /periods/:id/mark-complete, then HTTP 409 with code 'open_flags_remaining' and list of flag IDs
- Then period.state remains 'processed'
- Then audit_log has entry with action='mark_complete_blocked' and reason

**Test Cases:**
- Unit: FSM guard rejects complete when any flag.state != 'closed'
- Integration: API contract test for error shape
- E2E: accountant sees modal with deep-link to each open flag
- Security: tamper JWT to claim different firm - 403 not 409
- Accessibility: error modal traps focus, escape key closes, screen reader announces error


### UC-X-06: Gate 2 unlocks: Excel + feedback available to client after accountant marks complete
**Actor:** Accountant -> Client | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Period in 'processed' state
- All flags closed
- Accountant clicks 'Mark Complete' - explicit manual switch (not automatic)

**Main Flow:**
1. Accountant clicks 'Mark Complete' on period; confirmation modal shows numbers summary
2. Accountant confirms; backend FSM transitions processed -> complete
3. Backend sets period.gate2 = true
4. Backend generates period-scoped Excel snapshot, signs it, stores in S3 with periodId key
5. Notification fanned to client: push + email + in-app
6. Client opens portal; Excel download button enables; feedback CTA appears
7. Client downloads Excel - signed URL with 15min TTL
8. Client sees feedback form with 3 base ratings (Quality, Service, App) and up to 2 auto-prompts if signals crossed firm-set thresholds
9. Audit log records gate2_fired and Excel generation

**Alternate Flows:**
- If signals did NOT cross thresholds, only 3 base ratings shown; no auto-prompts
- If feedback cap configured to 0 auto-prompts, only base 3 always shown
- If accountant later corrects a transaction post-Gate2, Excel is regenerated and old signed URL invalidated
- If client downloaded Excel before correction, they get notification 'Updated version available'

**Edge Cases:**
- Accountant marks complete with no transactions - Excel still generated with empty period; feedback still solicited
- Excel generation takes >30s - async job; client sees 'Generating...' state, push when ready
- Client clicks Excel before async job done - 202 Accepted with retry-after
- Date picker attempted on Excel - NOT PRESENT in UI; API rejects any date range params (period-scoped only)
- Client downloads Excel after period archived - still allowed (past periods always downloadable per invariant)
- Large file (>10MB Excel with thousands of txns) - streamed download, progress bar on PWA
- Excel includes HST breakout matching on-screen numbers (line 105/108/109)
- Client on slow 3G - download resumable via HTTP range
- Accountant marks complete twice (idempotent) - second call returns 200 with same gate2 timestamp
- Filing-period selection: client did NOT and CANNOT select filing period; system-derived from frequency configured by accountant

**Invariants Enforced:** INV-GATE2-1, INV-EXCEL-PERIOD-SCOPE-1, INV-CLIENT-NO-PERIOD-PICK-1, INV-HST-BREAKOUT-1, INV-PAST-PERIOD-DOWNLOAD-1, INV-AUDIT-1

**Acceptance Criteria:**
- Given period marked complete, then Excel download API returns signed URL within 30s
- Given Excel downloaded, when opened, then totals match on-screen DRAFT numbers exactly
- Then any /excel call with date params returns 400 'date_picker_not_supported'
- Then feedback form contains exactly 3 base ratings + N auto-prompts where N <= firm.cap and signals crossed thresholds
- Then audit log records each download with signed-URL ID and client IP

**Test Cases:**
- Unit: Excel generator produces deterministic output (golden file test)
- Integration: generation -> S3 -> signed URL -> client download under 30s
- E2E: Playwright drives accountant mark-complete, client downloads and validates header rows
- Security: signed URL expires after 15min; tampering with URL signature fails
- Security: client cannot generate Excel for another client (RLS)
- Performance: 10,000-row Excel generation < 15s p95
- Accessibility: download button has aria-label including period name; feedback form keyboard-navigable
- PWA: download works while installed standalone on iOS Safari


### UC-X-07: Client submits feedback; ratings join operational signals on firm scorecard
**Actor:** Client -> System -> Firm Admin (via scorecard) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Gate 2 fired
- Client has not already submitted feedback for this period (write-once per period)
- Operational signals captured silently during period: turnaround, flag reply lag, low-confidence %, corrections, re-uploads

**Main Flow:**
1. Client sees feedback form with 3 base ratings + up to 2 auto-prompts
2. Auto-prompts appear ONLY when corresponding firm-set signal threshold was crossed; soft copy framing
3. Client rates each (e.g., 1-5 stars or NPS-style); optionally adds free-text comment
4. Client submits; backend validates one-per-period uniqueness
5. Backend persists feedback with linkage: each rating ↔ triggering signal ID (where applicable)
6. Backend joins ratings + silent signals into scorecard fact table for firm-side analytics
7. Audit log records feedback submission
8. Firm Admin opens Firm Workspace scorecard; sees aggregate ratings + signal correlations
9. Drill-down shows per-client, per-period detail (anonymized at aggregate level if firm config requires)

**Alternate Flows:**
- If client closes form without submit, draft saved locally; reminder sent 24h later
- If client submits then notices typo, edit allowed within 1h grace window; afterwards immutable (audit trail of edit)
- If thresholds not crossed, no auto-prompts shown - 3 base ratings only
- If firm changed thresholds mid-period (see UC-X-09), prompts use snapshot of thresholds AT GATE 2 TIME, not current

**Edge Cases:**
- Client tries to submit twice via double-click - idempotency key prevents duplicate
- Client submits via crafted API call with extra ratings beyond cap - rejected at schema validation
- Free-text contains PII or profanity - stored as-is; firm admin sees flag if profanity filter triggers
- Auto-prompt linkage missing (signal deleted) - foreign key constraint prevents orphan; uses snapshot
- Client never submits - period archived after 30 days; scorecard shows 'no feedback' state
- Client submits 5-star with 'TERRIBLE' comment - stored verbatim, flagged for review in scorecard
- Scorecard read while accountant still working another client - read-only consistent snapshot, no contention
- Operational signal NEVER displayed to client (verified)
- Free-text supports emoji + RTL languages; stored as UTF-8mb4

**Invariants Enforced:** INV-FEEDBACK-WRITE-ONCE-1, INV-FEEDBACK-CAP-1, INV-SIGNAL-HIDDEN-CLIENT-1, INV-RATING-SIGNAL-LINK-1, INV-AUDIT-1, INV-CONF-HIDDEN-1

**Acceptance Criteria:**
- Given Gate 2 fired, when client opens feedback, then exactly 3 base ratings show plus N auto-prompts where N <= firm.cap
- Given client submits, then subsequent submit attempts return 409 (after grace window)
- Then each rating row has a nullable signal_id linking to operational signal that triggered the auto-prompt
- Then no API response to client contains operational signal values
- Then firm scorecard joins ratings + signals via stored linkage

**Test Cases:**
- Unit: auto-prompt selector with various signal-threshold combinations
- Integration: feedback submission + signal join produces correct scorecard row
- E2E: client submits feedback, firm admin sees within 60s on scorecard
- Security: client cannot read other clients' feedback; firm admin scoped to own firm
- Security: client API never returns signals (contract snapshot)
- Property test: rating count never exceeds 3 + cap
- Accessibility: rating widget keyboard-operable, screen reader announces current rating
- i18n: bidirectional text rendering correct


### UC-X-08: Accountant uploads filed return PDF before marking complete - blocked
**Actor:** Accountant -> System (denial) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Period in 'processed' or earlier state (not yet 'complete')
- Accountant authenticated with upload_filed_pdf permission

**Main Flow:**
1. Accountant attempts to upload filed HST PDF on a period not yet complete
2. Backend FSM guard: filed PDF allowed only when state is 'complete' (transitioning to 'filed')
3. Request rejected 409 with reason 'period_must_be_complete'
4. UI surfaces hint: 'Mark Complete first, then upload filed PDFs'
5. Audit log records blocked attempt

**Alternate Flows:**
- Once accountant marks complete (UC-X-06), upload allowed; period transitions complete -> filed
- HST PDF and T2 PDF uploaded separately and grouped under period; never app-generated

**Edge Cases:**
- Accountant uploads via drag-drop multiple PDFs - each validated independently
- PDF is corrupt - rejected with 422
- PDF >50MB - rejected with size error; firm can configure but hard cap 100MB
- Accountant tries to delete a previously uploaded filed PDF - rejected (immutable per invariant)
- Accountant uploads wrong PDF - can upload new version; old version retained, audit shows replacement
- Accountant tries to upload an app-generated PDF (regression) - allowed but flagged in audit (no synthetic detection at MVP)
- Period reverts state due to admin override - filed PDFs already uploaded remain attached but archived for audit

**Invariants Enforced:** INV-PERIOD-FSM-1, INV-FILED-PDF-IMMUTABLE-1, INV-FILED-PDF-NOT-GENERATED-1, INV-AUDIT-1

**Acceptance Criteria:**
- Given period state != 'complete', when accountant POSTs filed PDF, then 409 'period_must_be_complete'
- Given uploaded filed PDF, when accountant tries DELETE, then 403 'immutable'
- Then HST and T2 PDFs stored under separate groupings linked to period

**Test Cases:**
- Unit: FSM guard for upload-filed-pdf
- Integration: full flow complete -> filed with grouped PDFs
- E2E: accountant tries premature upload, sees hint, fixes flow
- Security: client cannot upload filed PDF (RBAC)
- Security: malware scan integration on PDF upload
- Performance: 50MB upload <60s on 50Mbps connection


### UC-X-09: Firm Admin changes thresholds mid-period - retroactive policy resolution
**Actor:** Firm Admin -> System (affects Accountant + Client downstream) | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Firm Admin authenticated with permission firm_config_edit
- At least one period is currently in 'open' or 'processing' state
- Threshold being changed (e.g., low-confidence %, turnaround SLA, auto-prompt threshold)

**Main Flow:**
1. Firm Admin opens Firm Settings -> Thresholds in Firm Workspace
2. Changes a threshold value (e.g., lowers confidence cutoff from 70% to 60%)
3. Backend validates value within allowed range
4. Backend writes new threshold with effective_from = now() and version increment
5. Policy: NEW thresholds apply ONLY to periods entering processing AFTER change; existing in-flight periods use threshold SNAPSHOT taken at period start
6. For auto-prompt thresholds at feedback time, snapshot is taken at Gate 2 fire time
7. Banner shown to admin: 'Changes apply to new periods only; in-flight periods use prior thresholds'
8. Audit log records who/what/when
9. Accountants in firm see updated thresholds for new work; existing work unchanged

**Alternate Flows:**
- If firm admin opts 'Apply retroactively to in-flight' (explicit toggle with warning), system recomputes flags on in-flight periods - heavy operation, queued as background job
- Retroactive apply requires elevated permission + reason logged
- Threshold change while a flag is being raised - flag uses threshold at raise time (versioned)

**Edge Cases:**
- Two firm admins change same threshold simultaneously - last-write wins with optimistic lock; second admin sees conflict
- Threshold change while accountant marks processed - mark uses old threshold for that period's flag generation
- Threshold change while client is mid-feedback - feedback prompts use Gate 2 snapshot (immune to change)
- Threshold set to invalid value (negative %, >100%) - validation rejects
- Threshold change effective in future timezone boundary - server time used, not admin's local time
- Firm has no periods in flight - change applies immediately to next period created
- Period reopen scenario (rare) - uses threshold at REOPEN time, audit notes both versions

**Invariants Enforced:** INV-THRESHOLD-VERSION-1, INV-PERIOD-SNAPSHOT-1, INV-AUDIT-1, INV-FIRM-SCOPED-CONFIG-1

**Acceptance Criteria:**
- Given threshold change, when accountant views in-flight period, then prior threshold still applies
- Given threshold change, when new period created, then new threshold applies
- Given retroactive toggle ON with reason, then recompute job queued and audit notes reason
- Then audit log shows old value, new value, actor, timestamp, reason

**Test Cases:**
- Unit: threshold resolver with effective_from logic
- Integration: change threshold, create new period, assert new value; check in-flight unchanged
- E2E: firm admin changes, accountant sees banner
- Property test: threshold version monotonic
- Security: only firm admin can edit thresholds (RBAC)
- Accessibility: threshold form labels, help text, error messages screen-reader friendly


### UC-X-10: Platform Operator suspends tenant mid-period - downstream effects
**Actor:** Platform Operator -> System (affects Firm Admin, Accountant, Client) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Operator authenticated in Platform Admin Console
- Tenant currently active with in-flight periods
- Suspension reason provided (billing, compliance, manual)

**Main Flow:**
1. Operator opens tenant detail in Platform Admin Console (App A)
2. Clicks 'Suspend tenant'; modal requires reason + confirmation
3. Backend sets tenant.status = 'suspended', records suspension event
4. Operator NEVER reads financial data during this (write-only to status)
5. All Firm Workspace + Client Portal sessions for this tenant receive WebSocket suspension event
6. Firm Workspace UI shows banner 'Account suspended - read-only access'
7. Client Portal shows 'Service temporarily unavailable - contact your firm' (or firm-customized message)
8. All write APIs for tenant return 423 Locked with reason
9. Read APIs still work (firm can review prior work) UNLESS suspension type is 'compliance' which blocks reads too
10. In-flight period state frozen; no state transitions allowed
11. Notifications paused (no new pushes/emails sent until reactivated)
12. Audit log records suspension; cross-tenant isolation maintained

**Alternate Flows:**
- If suspension type 'billing_grace', soft warning, 7-day countdown before hard suspend
- Operator can reactivate; banner clears; state machine resumes; any queued background work re-enqueued
- If client submits during suspension via stale form, request rejected 423; data not lost (preserved in PWA IndexedDB)
- Hard delete of tenant requires explicit data-export step first (compliance)

**Edge Cases:**
- Accountant mid-typing answer when suspension fires - WebSocket disconnect; on reconnect, sees banner; draft preserved
- Client mid-upload when suspended - upload returns 423; PWA queues for retry
- Operator accidentally suspends wrong tenant - immediate reactivate; audit shows both events
- Suspension during AI extraction job - job completes (idempotent) but flag-creation deferred until reactivation
- Filed-return PDFs remain accessible for read in 'billing' suspension (legal requirement)
- Operator attempts to view financial data during suspension - UI doesn't expose it; backend API enforces operator scope
- Multiple operators in race - last write wins on tenant.status
- Data residency maintained even during suspension (ca-central-1)

**Invariants Enforced:** INV-OPERATOR-NO-FIN-DATA-1, INV-TENANT-1, INV-RESIDENCY-1, INV-AUDIT-1, INV-NO-PERMANENT-DELETE-1

**Acceptance Criteria:**
- Given tenant suspended, when any user calls write API, then 423 Locked with reason
- Given suspension, then operator cannot read any transaction/document via API (RBAC test)
- Given reactivation, then state machine resumes and queued events replay
- Then audit log records suspension + reactivation
- Then notifications cease during suspension

**Test Cases:**
- Unit: tenant.status guard on all write paths
- Integration: suspension event broadcasts to all active sessions in <5s
- E2E: operator suspends, accountant + client see banners in real time
- Security: operator JWT cannot fetch transactions endpoint (penetration test)
- Security: cross-tenant isolation maintained during partial suspensions
- Chaos: suspend mid-AI-job, verify clean resumption on reactivation
- Accessibility: suspension banner uses aria-live, color contrast WCAG AA


### UC-X-11: Firm Admin reads scorecard while Accountant still working a client (concurrent read/write)
**Actor:** Firm Admin (read) + Accountant (write) - concurrent | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Firm Admin authenticated with scorecard_read permission
- Accountant actively working on at least one client in same firm
- Scorecard data includes ratings + operational signals

**Main Flow:**
1. Firm Admin opens Firm Workspace Scorecard view
2. Backend serves consistent-read snapshot (read-replica or repeatable-read transaction)
3. Scorecard shows: per-client KPIs, aggregate ratings, signal correlations, accountant performance distributions
4. Real-time updates via SSE; new feedback submissions appear within 60s
5. Accountant concurrently raises flag / answers / marks processed; signals update silently
6. Updated signals appear in firm admin's view on next refresh / live tick
7. Audit log records scorecard view (compliance: who saw what when)

**Alternate Flows:**
- If firm admin filters by date range, results scoped accordingly
- If firm admin drills into a single client, full period history shown; respects firm scope
- If accountant marks a flag closed during admin's drill-down, the drill-down view live-updates
- If signals haven't crossed thresholds, scorecard shows them but doesn't highlight

**Edge Cases:**
- Admin loads scorecard with 10,000 clients - paginated + lazy loaded; p95 first paint < 2s
- Admin sorts by 'avg rating desc' - DB index ensures fast sort
- Admin searches client by name - full-text + fuzzy matching
- Concurrent edit: admin opens client config while accountant marks period processed - independent operations, no contention
- Admin exports scorecard CSV - generated server-side, signed URL; respects firm scope
- Signal values change mid-render - stale-while-revalidate pattern
- Empty firm (no clients yet) - empty state with onboarding CTA
- Operator should NEVER see this view (RBAC negative test)

**Invariants Enforced:** INV-FIRM-SCOPED-DATA-1, INV-OPERATOR-NO-FIN-DATA-1, INV-SIGNAL-LINK-RATING-1, INV-AUDIT-1, INV-TENANT-1

**Acceptance Criteria:**
- Given scorecard open, then signals reflect events up to within 60s
- Given concurrent accountant writes, then scorecard reads do not block writes (or vice versa)
- Given firm admin role, when fetching another firm's scorecard, then 403
- Then operator role cannot reach this endpoint (404 to obfuscate)

**Test Cases:**
- Integration: scorecard reads under concurrent writes maintain consistency (repeatable-read test)
- E2E: admin opens scorecard, accountant updates a flag, admin sees update via SSE
- Performance: scorecard with 1000 clients, 1 year of data, p95 paint < 2s
- Security: cross-firm access blocked
- Accessibility: data table has proper headers, sortable columns announced
- Visual: signal heatmap renders correctly across breakpoints


### UC-X-12: Period archival: post-filed transition + read-only access across all actors
**Actor:** Accountant -> System -> Client + Firm Admin (downstream) | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Period in 'filed' state
- Configurable archive delay elapsed (default 90 days after filing)
- Or accountant manually archives

**Main Flow:**
1. Cron / accountant action triggers archive on filed period
2. Backend FSM transitions filed -> archived
3. Period marked read-only across all apps
4. Client Portal: archived period still downloadable (Excel + filed PDFs); upload disabled
5. Firm Workspace: shows in archive section; reopen requires elevated permission + reason
6. Audit log records archival
7. Documents/transactions retained per retention policy (PIPEDA compliant); never permanently deleted

**Alternate Flows:**
- Accountant requests reopen (rare) - requires firm admin approval; transitions archived -> filed with audit trail
- Bulk archive across multiple filed periods - background job, progress tracked
- Operator-level retention purge request - requires legal review path; not automatic

**Edge Cases:**
- Client tries to upload to archived period - 423 with state-violation
- Filed PDF immutable post-archive (already enforced)
- Excel still downloadable from archive (per invariant)
- Feedback already submitted - read-only in archive
- Archived period during tenant suspension - inaccessible until reactivation
- Client deleted (offboarded) but archive retained for compliance period
- Search archived periods by year/quarter - dedicated archive search UI

**Invariants Enforced:** INV-PERIOD-FSM-1, INV-PAST-PERIOD-DOWNLOAD-1, INV-FILED-PDF-IMMUTABLE-1, INV-NO-PERMANENT-DELETE-1, INV-RESIDENCY-1

**Acceptance Criteria:**
- Given period archived, when client requests Excel, then download succeeds with same content as Gate2 snapshot
- Given archived, when client/accountant attempts write, then 423
- Given reopen with reason, then archive state reverts with full audit trail

**Test Cases:**
- Integration: archive transition, downstream API behavior
- E2E: archived period read-only across all three apps
- Security: client cannot bypass archive lock
- Retention test: data retained for compliance period despite archive


### UC-X-13: Client submits 'Not Found' attestation on flag - write-once across portals
**Actor:** Client -> System -> Accountant | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Open flag of type 'missing receipt' or similar
- Client authenticated, has answer permission

**Main Flow:**
1. Client opens flag in Client Portal
2. Cannot find receipt; clicks 'I cannot find this receipt'
3. Modal: explains attestation is legally binding, write-once, recorded with name/timestamp/IP
4. Client confirms; backend writes attestation row (one per flag, unique constraint)
5. Transaction associated with flag is still recorded but marked 'no_receipt'
6. Flag state -> answered (with attestation flag)
7. Accountant sees attestation in flag detail; can resolve
8. Audit log + immutable attestation entry created

**Alternate Flows:**
- Client later finds receipt - cannot replace attestation; must upload via separate path, accountant attaches
- Client tries to attest twice on same flag - 409 with existing attestation reference
- Attestation includes optional reason; field configurable per firm

**Edge Cases:**
- Two devices submit attestation simultaneously - DB unique constraint, one wins, other gets 409
- Client offline - attestation queued in PWA, replayed with idempotency key
- Network glitch causes duplicate submit - idempotency prevents
- Attestation must be attributed to authenticated client; service account cannot attest
- Browser refresh during modal - confirmation lost, must re-confirm (intentional to prevent accidental attestation)
- Client_staff sub-role attesting - permission must be granted by client_owner
- Attestation deleted attempt - 403 immutable
- Cross-app: accountant attempting to attest on client's behalf - blocked (must be client)

**Invariants Enforced:** INV-ATTEST-1, INV-AUDIT-1, INV-NO-PERMANENT-DELETE-1, INV-RBAC-1

**Acceptance Criteria:**
- Given attestation submitted, when second submit attempted, then 409
- Then transaction still exists, marked 'no_receipt'
- Then attestation row immutable (UPDATE/DELETE rejected at DB)
- Then attribution includes actor_id, timestamp, ip stored
- Then audit log entry references attestation ID

**Test Cases:**
- Unit: attestation guard rejects second write
- Integration: attestation + transaction state remain consistent
- E2E: client attests on mobile, accountant sees on desktop
- Security: client_staff blocked if firm config disallows attestation by sub-role
- Security: accountant API cannot create attestation
- Accessibility: attestation modal has high contrast, requires deliberate confirmation


### UC-X-14: Bulk flag resolution by Accountant - notifications consolidated to Client
**Actor:** Accountant -> Client (bulk) | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Multiple flags answered by client awaiting accountant review
- Accountant has bulk_resolve permission

**Main Flow:**
1. Accountant filters answered flags in Firm Workspace
2. Selects multiple via checkboxes or 'select all'
3. Clicks 'Resolve Selected' with optional batch comment
4. Backend processes in single transaction (or chunked if >100); each flag closed with audit entry per flag
5. Single consolidated notification fired to client (not N individual)
6. Client sees 'X flags resolved by [accountant name]' in portal
7. Audit log has individual entries per flag + bulk action correlation ID

**Alternate Flows:**
- If subset of selected flags has open answers from other clients, only matching subset resolved; rest skipped with reason
- Partial failure: 95 succeed, 5 fail - response includes per-flag status
- Bulk operation across periods - allowed but each period state checked independently

**Edge Cases:**
- Accountant selects 5000 flags - chunked processing, progress bar, cancellable
- Mid-bulk, client adds new flag - excluded from batch (snapshot at start)
- Bulk action on archived period - rejected
- Notification dedup if accountant runs bulk twice in 1min - second notification suppressed
- Bulk action triggers Gate 1 fire mid-batch - Gate evaluates on each flag close; client sees draft when last closes

**Invariants Enforced:** INV-FLAG-COLOR-1, INV-AUDIT-1, INV-GATE1-1

**Acceptance Criteria:**
- Given bulk resolve of N flags, when complete, then N audit entries with same correlation ID
- Then single notification sent to client per recipient, not N
- Given last flag closes, then Gate 1 evaluator fires once

**Test Cases:**
- Integration: bulk resolve of 100 flags within 5s
- E2E: accountant bulk-resolves, client gets 1 push
- Property: each flag in batch ends closed or has explicit error
- Performance: 1000-flag batch < 30s
- Accessibility: bulk select keyboard-friendly, screen reader announces count


### UC-X-15: Per-client opt-in toggle: Firm Admin enables/disables features cascading to client experience
**Actor:** Firm Admin -> System -> Client | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Firm Admin authenticated, viewing per-client config
- Client exists, may be active mid-period

**Main Flow:**
1. Firm Admin toggles a per-client opt-in (e.g., 'auto-prompts in feedback', 'show benchmarks')
2. Backend writes config with effective_from
3. Affects new periods immediately; in-flight periods snapshot prior config
4. If toggle relates to currently visible UI (e.g., benchmark widget), client sees change on next portal load
5. Audit log records who/what/when

**Alternate Flows:**
- Bulk apply across multiple clients - background job
- Disabling a feature mid-flow does NOT delete prior data; just hides UI

**Edge Cases:**
- Toggle changes during client active session - WebSocket pushes config update; UI re-renders gracefully
- Toggle for feedback auto-prompts changes after Gate 2 - feedback already uses snapshot, unaffected
- Two admins toggle same client simultaneously - last write wins with optimistic lock

**Invariants Enforced:** INV-PER-CLIENT-OPTIN-1, INV-PERIOD-SNAPSHOT-1, INV-AUDIT-1

**Acceptance Criteria:**
- Given opt-in changed, when client loads portal, then feature reflects new state
- Given in-flight period, when toggle changes, then current period uses snapshot
- Then audit log captures change with reason if required by firm

**Test Cases:**
- Integration: toggle + client experience reflects change
- E2E: admin toggles, client portal re-renders within 5s on SSE
- Security: only firm admin can toggle (RBAC)
- Accessibility: toggle has visible focus, screen reader announces state


### UC-X-16: Cross-app session lifecycle: accountant impersonates client view (read-only) for support
**Actor:** Accountant (with impersonate permission) -> reads Client view | **Priority:** P2 | **Platform:** cross-platform

**Preconditions:**
- Accountant has impersonate_client_view permission
- Client account exists, tenant active

**Main Flow:**
1. Accountant clicks 'View as client' in Firm Workspace client detail
2. Backend issues short-lived impersonation token (15min) with read-only scope
3. Accountant sees Client Portal as client would, including DRAFT numbers, flags, Excel CTA
4. Banner persistent: 'Impersonating [client name] - read-only'
5. Cannot perform any write actions (no answer, no upload, no attestation, no feedback submit)
6. Audit log records every page accessed during impersonation
7. Session expires at 15min; can be extended with re-authentication

**Alternate Flows:**
- Operator cannot impersonate (forbidden by INV-OPERATOR-NO-FIN-DATA-1)
- Firm Admin can impersonate with higher permission gate
- Impersonation banner shown to client if they're concurrent - not by default for support reasons (firm config)

**Edge Cases:**
- Accountant impersonating + client logs in concurrently - both sessions valid; impersonation visible in client's session log
- Impersonation across browser tabs - each tab separate impersonation context
- Impersonation expires mid-view - session ends, redirected to firm workspace
- Tenant suspension during impersonation - session terminated immediately
- Impersonation actions logged separately with original accountant ID + impersonated client ID
- Screenshot of impersonation - banner present in screenshot, hard to misuse

**Invariants Enforced:** INV-OPERATOR-NO-FIN-DATA-1, INV-AUDIT-1, INV-IMPERSONATE-RO-1, INV-RBAC-1

**Acceptance Criteria:**
- Given impersonation active, when accountant attempts write, then 403 'impersonation_read_only'
- Given impersonation, then all reads logged with impersonator + target
- Then operator role denied attempt (403)

**Test Cases:**
- Integration: write paths blocked under impersonation token
- E2E: accountant impersonates, sees DRAFT numbers, tries upload, blocked
- Security: token cannot be exchanged for write scope
- Audit verification: every page view recorded


### UC-X-17: Accountant re-uploads / corrects transaction post-Gate2: numbers reflow, client notified
**Actor:** Accountant -> Client | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Period in 'complete' or 'filed' state (post Gate 2)
- Accountant has correction permission

**Main Flow:**
1. Accountant identifies error post-completion, edits transaction (vendor/amount/HST/category)
2. Backend records correction with prior + new values; original NOT deleted
3. Excel regenerated; old signed URL invalidated; new version stored
4. Client notified: 'Your filing data was updated. New Excel available.'
5. On-screen DRAFT numbers refresh for client
6. Correction is counted as 'operational signal' increment (corrections)
7. Audit log immutable
8. If period already filed, correction logged but filed PDF unchanged (immutable per invariant)

**Alternate Flows:**
- If correction crosses materiality threshold, firm policy may require accountant to write a 'reason' before save
- Correction during archival - reopen path required first

**Edge Cases:**
- Correction reverts a prior correction - both retained in history
- Correction triggers HST recalc; line 105/108/109 update; client sees recalculated values
- Bulk corrections - chunked, progress bar
- Correction during client feedback submission - feedback uses Gate 2 snapshot; not affected
- Filed PDF reflects pre-correction values - acceptable; user warned
- Client offline during notification - message queued via push

**Invariants Enforced:** INV-NO-PERMANENT-DELETE-1, INV-FILED-PDF-IMMUTABLE-1, INV-AUDIT-1, INV-HST-BREAKOUT-1, INV-SIGNAL-CORRECTIONS-1

**Acceptance Criteria:**
- Given correction post-Gate2, then Excel regenerated and old URL invalidated
- Then prior values retained in history table
- Then correction increments operational signal
- Then notification sent to client

**Test Cases:**
- Integration: correction flow + Excel regen + URL invalidation
- E2E: accountant edits, client sees updated Excel CTA
- Audit: prior + new values visible
- Security: client cannot trigger correction


### UC-X-18: Accountant marks period complete; turnaround signal computed and feedback auto-prompt triggers
**Actor:** Accountant -> System -> Client | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Period transitioning processed -> complete
- Turnaround SLA configured (e.g., 7 days from period end)
- Auto-prompt threshold configured (e.g., trigger if turnaround > SLA)

**Main Flow:**
1. Accountant marks complete (UC-X-06)
2. Backend computes turnaround_days = complete_ts - period_end
3. If turnaround_days > firm SLA, set signal 'turnaround_slow' = true on period
4. When client opens feedback form (Gate 2 unlocked), auto-prompt 'How was the turnaround time?' appears (soft copy, framed neutrally)
5. If client submits low rating on auto-prompt, signal+rating link stored
6. Firm scorecard shows turnaround distribution and rating correlation

**Alternate Flows:**
- If turnaround within SLA, no auto-prompt for turnaround (one of 2 cap slots saved)
- If both turnaround AND low-confidence signals trigger, both auto-prompts shown (up to cap)
- Cap=0 means only 3 base ratings

**Edge Cases:**
- Period_end on weekend / holiday - SLA computed via business-day calendar per firm config
- Period end in different timezone - server uses period.timezone (firm-set) for calculation
- Auto-prompt soft copy localized per client language
- Signal computed even when period reopened/recompleted - latest values used; audit shows history
- Client never opens feedback - signals recorded silently; scorecard shows signal without rating linkage

**Invariants Enforced:** INV-SIGNAL-HIDDEN-CLIENT-1, INV-FEEDBACK-CAP-1, INV-RATING-SIGNAL-LINK-1, INV-AUDIT-1

**Acceptance Criteria:**
- Given turnaround > SLA, when client opens feedback, then turnaround auto-prompt visible
- Then total prompts <= 3 + cap
- Then signal value NEVER exposed in client API

**Test Cases:**
- Unit: turnaround calculator with timezone + business days
- Integration: signal -> auto-prompt selection
- E2E: client sees prompt only when threshold crossed
- Security: client API response contract excludes signals


### UC-X-19: Push notification preferences and consent across user types - PWA installability
**Actor:** Client + Accountant + Firm Admin (each manages own) | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- User authenticated
- Browser supports Push API (or fallback to email)

**Main Flow:**
1. User opens preferences in respective app
2. Toggles notification channels (push, email, in-app) per event type (flag raised, period complete, etc.)
3. Browser prompt for push permission (first time)
4. Service worker registers subscription; backend stores per-user, per-device
5. PWA installable: manifest.json with proper icons, theme color, scope
6. On notification event, fan-out respects per-user preferences
7. Quiet hours (firm or user configurable) suppress push during off-hours

**Alternate Flows:**
- If push permission denied, falls back to email + in-app
- If user uninstalls PWA, subscription invalidated server-side on 410 from push gateway
- Firm Admin can set default notification policy; users can override unless locked

**Edge Cases:**
- User on iOS Safari pre-iOS 16.4 - PWA push not supported, falls back to email
- User on multiple devices - each registered separately; notification sent to all unless deduplicated
- Push token expires - silent refresh on next portal open
- Notification arrives during do-not-disturb - shown silently
- Notification contains sensitive content - title generic ('New activity'), detail behind auth
- User logs out - subscription paused; reactivated on login
- PWA installability test: manifest valid, service worker registered, HTTPS, icons present, Lighthouse install score 100

**Invariants Enforced:** INV-NOTIF-CONSENT-1, INV-PIPEDA-CONSENT-1, INV-AUDIT-1

**Acceptance Criteria:**
- Given push denied, when event fires, then email fallback within 10min
- Then PWA passes Lighthouse PWA audit (installability 100)
- Then notification title contains no PII
- Then quiet hours respected per user TZ

**Test Cases:**
- E2E: install PWA on Android, push received
- E2E: install PWA on iOS 16.4+ Safari, push received
- Lighthouse: PWA audit
- Unit: notification preferences resolver
- Security: notification payload contains no financial data


### UC-X-20: Multi-tenant data isolation under cross-actor flows - hard RLS backstop
**Actor:** All actors (system-wide enforcement) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Multiple tenants exist
- Users across firms attempt cross-tenant access via crafted requests

**Main Flow:**
1. Every request authenticated; JWT carries user_id + tenant_id
2. Application layer sets Postgres session var (e.g., SET app.tenant_id = X) for each request
3. RLS policies on every financial table reference current_setting('app.tenant_id')
4. Application also filters by tenant_id in queries (defense in depth)
5. Cross-tenant query returns zero rows; never errors that leak existence
6. Audit log includes tenant_id; cross-tenant attempts logged with security flag

**Alternate Flows:**
- Operator role queries are scoped to platform metadata only; no tenant_id required but no financial tables accessible
- Background jobs run with explicit tenant context; mis-context fails fast

**Edge Cases:**
- JWT tampered to claim different tenant - signature verification fails
- Race: user switches firm membership mid-request - request continues with original tenant context
- Cross-tenant SSRF attempts - URL allowlist enforced
- Cross-tenant via shared resource (e.g., document hash collision) - hash-based dedup scoped per tenant
- Backup/restore preserves tenant_id; never mixed across restores

**Invariants Enforced:** INV-TENANT-1, INV-OPERATOR-NO-FIN-DATA-1, INV-AUDIT-1, INV-RESIDENCY-1

**Acceptance Criteria:**
- Given user from tenant A, when querying tenant B's resource, then empty result (404 if direct ID lookup)
- Given RLS disabled (regression), then test suite fails
- Then audit log has tenant_id for every event

**Test Cases:**
- Security: penetration test crafted requests across tenants
- Unit: RLS policy unit tests
- Integration: app-level + RLS double-filter test
- Chaos: drop app filter, RLS still blocks (verifies backstop)
- Property test: fuzz tenant_ids across many endpoints


### UC-X-21: End-to-end happy path across all actors and apps
**Actor:** Platform Operator -> Firm Admin -> Accountant -> Client (full lifecycle) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Clean staging environment
- Test users provisioned per role

**Main Flow:**
1. 1. Operator provisions tenant in App A (Platform Admin Console)
2. 2. Firm Admin logs into App B (Firm Workspace), configures: accountants, thresholds, prompt copy/cap, per-client opt-ins, benchmarks, scorecard rules
3. 3. Firm Admin onboards a Client (creates client account, sets reporting frequency = quarterly)
4. 4. Client receives invite, logs into App C (Client Portal PWA), installs PWA on phone
5. 5. New period opens (system-derived from frequency)
6. 6. Client uploads documents over the quarter (UC-X-01)
7. 7. AI extracts; some yellow flags raised (low-confidence)
8. 8. Accountant reviews, resolves easy flags, raises a red flag (UC-X-02)
9. 9. Client receives push, answers red flag with receipt attached (UC-X-02)
10. 10. Receipt double-writes (transaction + checklist count)
11. 11. Accountant resolves all flags, marks period processed (UC-X-03/04)
12. 12. Gate 1 fires; client sees DRAFT numbers (no confidence visible)
13. 13. Accountant reviews DRAFT, marks period complete (UC-X-06)
14. 14. Gate 2 fires; Excel + feedback unlock for client
15. 15. Client downloads Excel, reviews, submits feedback (UC-X-07)
16. 16. Auto-prompts triggered for crossed signals; ratings linked
17. 17. Accountant uploads filed HST + T2 PDFs (UC-X-08); period -> filed
18. 18. Firm Admin reads scorecard (UC-X-11); sees ratings + signals
19. 19. After 90 days, period archives (UC-X-12); read-only across all apps
20. 20. Operator never accessed financial data throughout (audit verifies)

**Alternate Flows:**
- If Client uses 'Not found' attestation (UC-X-13)
- If accountant corrects post-Gate2 (UC-X-17)
- If operator suspends mid-period (UC-X-10)

**Edge Cases:**
- Daylight saving transition during period - timezone math correct
- Period straddles year boundary - fiscal year handled
- Client offboarded post-archive - data retained per PIPEDA
- Accountant leaves firm - in-flight work reassigned

**Invariants Enforced:** INV-TENANT-1, INV-OPERATOR-NO-FIN-DATA-1, INV-PERIOD-FSM-1, INV-GATE1-1, INV-GATE2-1, INV-DOC-LOCK-1, INV-RECEIPT-DOUBLE-WRITE-1, INV-ATTEST-1, INV-NET-OF-HST-1, INV-HST-BREAKOUT-1, INV-CONF-HIDDEN-1, INV-FLAG-COLOR-1, INV-EXCEL-PERIOD-SCOPE-1, INV-PAST-PERIOD-DOWNLOAD-1, INV-FILED-PDF-IMMUTABLE-1, INV-FILED-PDF-NOT-GENERATED-1, INV-FEEDBACK-CAP-1, INV-RATING-SIGNAL-LINK-1, INV-SIGNAL-HIDDEN-CLIENT-1, INV-AUDIT-1, INV-NO-PERMANENT-DELETE-1, INV-RESIDENCY-1

**Acceptance Criteria:**
- Given full E2E run, when complete, then all invariants asserted true
- Then audit log contains expected events in order
- Then operator can read tenant metadata but no financial rows
- Then client never sees confidence or signal values

**Test Cases:**
- E2E (Playwright + Detox or PWA flow): full lifecycle script across all 3 apps
- Performance: full lifecycle p95 < 24h simulated time (with seeded fast clock)
- Security: penetration test along happy path
- Audit: log replayable to reconstruct state
- Accessibility: WCAG AA across all critical screens
- Data residency: verify all writes hit ca-central-1


### UC-X-22: Cross-app real-time sync: WebSocket / SSE delivery + reconnect resilience
**Actor:** System (cross-actor visibility) | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Users connected on at least two apps for same tenant
- Backend pub/sub bus operational

**Main Flow:**
1. Events (flag.created, period.processed, gate.fired, etc.) published to internal bus
2. Per-tenant channel; subscribers filtered by tenant_id + role + resource scope
3. WebSocket/SSE pushes to connected clients with debouncing
4. Reconnect logic: exponential backoff; on reconnect, fetch missed events via since-cursor

**Alternate Flows:**
- If WebSocket blocked (corporate firewall), falls back to SSE then long-polling

**Edge Cases:**
- 10k concurrent connections per region - autoscale group handles
- Reconnect storm after outage - jitter + capacity caps
- Cross-tenant subscription attempt - rejected at handshake
- Heartbeat lost - client disconnects, reconnects
- Message order important - per-tenant FIFO guarantee at consumer

**Invariants Enforced:** INV-TENANT-1, INV-AUDIT-1

**Acceptance Criteria:**
- Given event published, then connected clients receive within 3s p95
- Given disconnect, when reconnect, then missed events delivered via cursor
- Then no cross-tenant message leakage

**Test Cases:**
- Load: 10k concurrent connections
- Chaos: kill pubsub, verify graceful degradation
- Security: cross-tenant subscribe rejected
- Integration: missed-event replay


### UC-X-23: Audit log read by Firm Admin for compliance; cross-actor visibility
**Actor:** Firm Admin -> System (read audit) | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Firm Admin authenticated with audit_read permission
- Append-only audit log populated

**Main Flow:**
1. Firm Admin opens audit view in Firm Workspace
2. Filters by actor, resource, period, action, date range
3. Backend serves paginated immutable entries
4. Export available as signed CSV / PDF
5. Operator actions visible only as metadata (tenant lifecycle); no financial details

**Alternate Flows:**
- Bulk export of full audit - background job, signed URL
- Audit search by free text (e.g., client name)

**Edge Cases:**
- Audit log corruption attempt - immutable enforced at DB (no UPDATE/DELETE grants); periodic hash chain verification
- Operator audit cross-firm - operator role views own actions only; cannot read tenant audit
- Firm Admin reading during accountant active work - read-only, no contention
- Audit log purge requests - rejected (no permanent deletes per invariant)

**Invariants Enforced:** INV-AUDIT-1, INV-NO-PERMANENT-DELETE-1, INV-TENANT-1

**Acceptance Criteria:**
- Given audit query, then results in pagination cursor
- Then UPDATE/DELETE on audit table rejected at DB role
- Then operator can't read firm audit
- Then hash chain verifies integrity

**Test Cases:**
- Integration: audit search across actors
- Security: DB permissions test (no UPDATE/DELETE on audit table for any role)
- Hash-chain verifier unit test


### UC-X-24: Onboarding empty states across actors - cross-app first-run experience
**Actor:** All actors (first-time use) | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Newly provisioned tenant / firm / client
- No data exists yet

**Main Flow:**
1. Firm Admin first login -> guided wizard: add accountants, set frequencies, configure thresholds (with sensible defaults), benchmarks
2. Accountant first login -> empty dashboard with 'No clients yet' state + CTA
3. Client first login on PWA -> install prompt + welcome modal explaining the upload-answer-review cycle
4. Each empty state has clear next action and link to docs

**Alternate Flows:**
- Skipping wizard sets safe defaults; admin can revisit
- Sample data toggle for demos (clearly marked, never billable)

**Edge Cases:**
- Client invited but never logs in - reminder cadence; admin can re-send invite
- Wizard interrupted mid-flow - resumes from last step
- Default thresholds documented; firm can later tune

**Invariants Enforced:** INV-AUDIT-1, INV-PIPEDA-CONSENT-1

**Acceptance Criteria:**
- Given empty firm, when admin logs in, then wizard appears or can be reopened
- Given empty client, when client logs in, then welcome modal appears once
- Then PWA install prompt shown on first compatible visit

**Test Cases:**
- E2E: first-run flow each role
- Accessibility: wizard keyboard-navigable
- PWA: install prompt on Android Chrome
- i18n: empty state copy localized


### UC-X-25: Error recovery: cross-app retry, idempotency, and reconciliation
**Actor:** All actors (system-wide) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Any in-flight operation
- Network/service instability possible

**Main Flow:**
1. Every state-changing endpoint requires Idempotency-Key header (client-generated UUID)
2. Backend deduplicates by key within 24h window
3. PWA queues writes when offline via Background Sync; retries with same idempotency key
4. Backend reconciliation job runs nightly: detects orphaned uploads, stuck periods, missed notifications
5. Operator dashboard surfaces reconciliation anomalies

**Alternate Flows:**
- User retries due to perceived failure though server succeeded - idempotency returns same response
- Server restart mid-transaction - transaction either committed or rolled back, never half (Postgres ACID)

**Edge Cases:**
- Stuck job in queue - DLQ + alerting
- Notification delivery failure - retry with backoff, then email fallback, then accountant alert
- PWA service worker stale - skipWaiting + clientsClaim on update
- User clears browser data - PWA queues lost; backend reconciler detects
- Clock skew on client - server-side timestamps authoritative
- Partial Excel generation failure - regenerate with backoff

**Invariants Enforced:** INV-IDEMPOTENCY-1, INV-AUDIT-1, INV-NO-PERMANENT-DELETE-1

**Acceptance Criteria:**
- Given same idempotency key twice, when called within 24h, then same response returned without side effects
- Then DLQ alerting fires within 5min of stuck job
- Then nightly reconciliation produces report

**Test Cases:**
- Integration: duplicate request with same idempotency key
- Chaos: kill API mid-request, verify recovery
- Property test: idempotency key uniqueness across calls
- PWA: offline write replays correctly on reconnect


## All user types (Platform Operator, Firm Admin, Accountant, Client) (cross-platform)

### UC-EDGE-01: Recover from AI extraction failure with retry and Textract fallback
**Actor:** System (backend) + Accountant | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Period is in 'processing' state
- Document was uploaded and aiLocked=true
- Primary AI provider (e.g., Claude/GPT vision) configured for tenant
- Textract fallback configured at platform level

**Main Flow:**
1. Backend job picks up document for extraction
2. Primary AI call attempted with 30s timeout
3. On transient failure (5xx, timeout), retry with exponential backoff (3 attempts: 2s, 8s, 30s)
4. If all primary attempts fail, mark provider_attempt as 'failed' and enqueue Textract fallback job
5. Textract processes document; confidence scores normalized to internal schema
6. On Textract success, transaction recorded with provenance='textract_fallback'
7. If Textract also fails, document moved to 'manual_entry_queue' visible to Accountant in Firm Workspace
8. Accountant sees badge 'Needs manual entry' on document tile; clicks to open manual entry form
9. Accountant enters fields; submission writes transaction with provenance='manual_entry'
10. Audit log captures every attempt with provider, latency, error code, timestamp

**Alternate Flows:**
- If primary returns 4xx (e.g., unsupported MIME), skip retries and route directly to Textract
- If document is a password-protected PDF, both AI and Textract fail predictably; system flags as 'locked_pdf' and asks Accountant to request unlocked copy from client (creates yellow flag)
- If Textract is unavailable in ca-central-1 at moment of call, queue is paused and admin notified; documents queued without breaking the period

**Edge Cases:**
- AI provider returns malformed JSON: parser catches, treats as failure, triggers retry
- Partial response (truncated): treated as failure
- Rate-limit (429) from primary: backoff respects Retry-After header
- Document is 0 bytes after upload (storage corruption): caught at job pickup, moved to error state with reason 'empty_file'
- Two concurrent extraction jobs for same document (race): idempotency key prevents double-write
- Manual entry race: optimistic lock on transaction row prevents overwriting a concurrently-saved AI result

**Invariants Enforced:** INV-DOC-AILOCK, INV-TXN-PROVENANCE, INV-AUDIT-APPEND-ONLY, INV-CONFIDENCE-INTERNAL-ONLY

**Acceptance Criteria:**
- Given primary AI fails 3 times, When job runs, Then Textract is invoked exactly once
- Given both providers fail, When Accountant opens document, Then 'Needs manual entry' state is visible
- Given manual entry is submitted, Then provenance='manual_entry' is recorded and audit log contains accountant_id
- Given confidence from any source, Then it is never serialized in client-facing API responses

**Test Cases:**
- Unit: Retry policy honors Retry-After header from 429
- Unit: JSON parser rejects truncated AI response and marks attempt failed
- Integration: Mock primary AI to fail 3x; assert Textract job enqueued; assert transaction written with correct provenance
- Integration: Mock both providers to fail; assert document appears in manual_entry_queue endpoint
- E2E: Accountant submits manual entry; verify transaction shows in period and audit trail records actor
- Security: Confirm confidence field is stripped from /portal/* responses (regex grep on response bodies)
- Performance: Under 100 concurrent docs, queue depth stays bounded and Textract fallback rate < 10% per SLO


### UC-EDGE-02: Reject corrupted, oversized, or malicious file uploads
**Actor:** Client (client_owner | client_staff), Accountant | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- User authenticated to App B or App C
- Period is in 'open' state OR document is being added by Accountant
- MIME allowlist and size cap configured at platform level (defaults: 25MB; PDF/JPG/PNG/HEIC)

**Main Flow:**
1. User selects file in upload dialog (App C: native picker; App B: drag-drop or picker)
2. Client-side pre-flight: size check, MIME sniff (first 4KB magic bytes)
3. If fails pre-flight, show inline error and abort
4. Browser POSTs multipart/form-data to /uploads with pre-signed URL (S3 direct upload)
5. On upload complete, backend receives webhook from S3 with object key and size
6. Backend runs deep validation: re-sniff MIME server-side, run virus scan (ClamAV/cloud), parse defensively (PDF.js / image lib in sandboxed worker)
7. If validation passes, document row created (status='ready_for_ai')
8. If validation fails, S3 object deleted, error returned, user sees actionable message

**Alternate Flows:**
- Oversized: client sees 'File exceeds 25MB' before upload starts; can split or compress
- Wrong MIME: client sees 'Only PDF/JPG/PNG/HEIC accepted'
- Virus detected: object quarantined to forensic bucket, audit log entry, user told 'File failed safety check'; security@nugeninfo.com alerted
- PDF parse bomb (e.g., zip bomb embedded): sandboxed parser kills process at memory limit; treated as malicious
- HEIC from iOS: server-side transcode to JPEG for downstream OCR

**Edge Cases:**
- User loses network mid-upload: resumable upload protocol (S3 multipart) allows retry from last part
- Duplicate filename in same period: filename appended with timestamp; content-hash dedupe (see UC-EDGE-03)
- User rapidly double-clicks upload: idempotency key on client prevents double POST
- MIME spoof: filename .pdf but bytes are .exe; server-side magic-byte check rejects
- Filename contains path traversal (../../): sanitized to leaf name before storage
- Unicode/RTL filename: stored as UTF-8, displayed safely (no homograph attacks)
- Quota exceeded for tenant (storage): graceful rejection with retry-after

**Invariants Enforced:** INV-DOC-MIME-ALLOWLIST, INV-DOC-SIZE-CAP, INV-TENANT-ISOLATION, INV-AUDIT-APPEND-ONLY

**Acceptance Criteria:**
- Given a 30MB PDF, When upload attempted, Then client sees error without bytes leaving device
- Given a .exe renamed to .pdf, When uploaded, Then server rejects within 2 seconds and audit log records 'mime_mismatch'
- Given virus-laden file, When scanned, Then file is quarantined and never reaches AI pipeline
- Given upload succeeds, Then document row has tenant_id matching uploader's tenant

**Test Cases:**
- Unit: Magic-byte sniffer correctly identifies PDF, JPEG, PNG, HEIC, and rejects executables
- Unit: Filename sanitizer strips path traversal sequences
- Integration: Upload EICAR test virus file; assert quarantine and alert
- Integration: Upload 24.9MB file (pass) and 25.1MB file (fail) at boundary
- Integration: Upload PDF zip bomb; assert parser sandbox kills and rejects
- E2E (App C mobile PWA): Pause network during upload, resume; verify file completes
- Security: Pen-test with malformed PDF (PDFium fuzzing corpus)
- Security: Verify cross-tenant access is impossible (RLS test)


### UC-EDGE-03: Deduplicate document uploads via content-hash idempotency
**Actor:** Client, Accountant | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- User uploading document to a period
- Period in 'open' or 'processing' state (before aiLocked or by accountant)
- SHA-256 hash computed client-side and sent as header

**Main Flow:**
1. Client computes SHA-256 of file bytes
2. Client sends Idempotency-Key (request UUID) + Content-SHA256 header with upload
3. Backend checks (tenant_id, period_id, content_sha256) for existing record
4. If found, return existing document_id with 200 OK and flag duplicate=true; do NOT re-store
5. Client UI shows 'This document is already uploaded' with link to existing entry
6. Audit log records duplicate attempt with actor_id and source (flag context vs. general upload)

**Alternate Flows:**
- Same hash across periods: not deduped (different period); allowed
- Same hash across clients within firm: not deduped (different client); allowed
- Hash matches but file is uploaded via flag-response context: dedupe still applies, but flag counter increments only on first attach (no double-count)
- Client retries due to network error with same Idempotency-Key: returns same document_id, no duplicate row

**Edge Cases:**
- Client lies about hash (sends wrong SHA): server recomputes; mismatch triggers re-upload request
- Two concurrent uploads of same file from two devices: row-level lock on (tenant_id, period_id, sha) ensures one wins
- File modified by 1 byte: different hash, treated as new document (correct)
- Zero-byte file: rejected before hash check
- Very large file hash on mobile: chunked hashing to avoid UI freeze

**Invariants Enforced:** INV-DOC-IDEMPOTENCY, INV-FLAG-RECEIPT-DOUBLE-WRITE, INV-AUDIT-APPEND-ONLY

**Acceptance Criteria:**
- Given identical file uploaded twice, When second upload arrives, Then no new row created and existing document_id returned
- Given duplicate via flag context, Then checklist count does not double-increment
- Given concurrent identical uploads, Then exactly one document row exists post-conflict

**Test Cases:**
- Unit: Hash mismatch between header and bytes triggers 400
- Integration: POST same file twice; assert 200 + duplicate=true on second
- Integration: Two parallel uploads with same hash; assert exactly one row (DB constraint)
- E2E: Client uploads receipt for flag, then re-uploads same receipt; assert checklist count = 1, not 2
- Performance: SHA-256 of 25MB file completes within 1.5s on median mobile device


### UC-EDGE-04: Salvage partial OCR results and surface low-confidence fields
**Actor:** System + Accountant | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Document extraction completed but some fields below firm-set confidence threshold
- Period in 'processing' state

**Main Flow:**
1. Extraction returns structured result with per-field confidence
2. Backend writes transaction with all fields populated where available
3. Fields below threshold marked low_confidence=true (internal only)
4. System auto-raises yellow flag for each low-confidence field group (e.g., 'Confirm vendor name on Invoice #1234')
5. Accountant sees flag in workspace; can accept AI value, edit, or mark 'not found' if document is genuinely missing data
6. On accept/edit, low_confidence cleared; transaction marked accountant_reviewed=true
7. Period cannot advance to 'processed' until all low-confidence flags cleared (or accountant explicitly overrides with reason)

**Alternate Flows:**
- OCR returns no fields (full failure): treated as UC-EDGE-01 manual entry path
- OCR returns ONLY confidence ≥ threshold: no yellow flag raised; period flows normally
- Accountant marks 'not found' on a required field: write-once attestation recorded, transaction kept with null field

**Edge Cases:**
- Confidence threshold changed by Firm Admin mid-processing: applies only to new extractions; in-flight unaffected
- Same document re-extracted (retry): new attempt may have different confidence; latest wins, audit trail keeps both
- Numeric field with 99% confidence but value is implausible (e.g., $1M receipt): plausibility check raises separate flag
- Multi-line item invoice: each line item gets independent confidence; partial accept supported

**Invariants Enforced:** INV-CONFIDENCE-INTERNAL-ONLY, INV-FLAG-COLOR-SOURCE, INV-NOT-FOUND-ATTESTATION, INV-TXN-PROVENANCE

**Acceptance Criteria:**
- Given low-confidence field, When period viewed, Then yellow (system) flag visible to Accountant
- Given accountant clears flag, Then transaction reflects edit and audit log captures change
- Given confidence value, Then it is never in client-facing API response or UI

**Test Cases:**
- Unit: Confidence threshold filter correctly classifies fields
- Integration: Extraction returns mixed confidence; assert exactly N yellow flags raised
- Integration: Accountant edits low-confidence field; verify red flag NOT raised (red = accountant-initiated investigation, not edit)
- E2E: Client portal API call; assert no 'confidence' key anywhere in response
- Security: API fuzzing for confidence leakage


### UC-EDGE-05: Recover from browser crash or refresh mid-flag-answer
**Actor:** Client (client_owner | client_staff) | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Client is on App C answering a flag (text response, file upload, or 'not found' attestation)
- Authenticated session active

**Main Flow:**
1. Client opens flag detail screen
2. Client begins typing response or selecting file
3. Client-side autosave debounces input to IndexedDB every 2s (PWA service worker)
4. Browser crashes or page reloaded
5. Client returns to flag; UI detects draft in IndexedDB and prompts 'Restore your in-progress response?'
6. On restore, fields are repopulated
7. Client submits; server-side idempotency key prevents double-submit if a partial PUT occurred pre-crash

**Alternate Flows:**
- Client clicks 'Discard draft': IndexedDB entry removed
- Draft is for a flag that has since been resolved by another client_staff user: draft offered but submit returns 409 with explanation
- Draft exists but flag was withdrawn by Accountant: draft discarded with notice

**Edge Cases:**
- IndexedDB quota exceeded: oldest drafts evicted, with warning
- Multiple tabs open with same flag: last-write-wins on local draft, with cross-tab BroadcastChannel sync
- File partially selected then crash: file reference cannot be restored (browser security), so user re-attaches; text restored
- Client on another device after crash: draft is local-only, not synced (avoid security risk of cloud-stored unsigned drafts)
- Service worker not registered (first visit, edge browser): autosave falls back to sessionStorage with reduced reliability

**Invariants Enforced:** INV-FLAG-IDEMPOTENCY, INV-FLAG-NOT-FOUND-WRITE-ONCE, INV-CLIENT-SUBROLE-RBAC

**Acceptance Criteria:**
- Given crash mid-answer, When client returns within 24h, Then draft is offered for restoration
- Given restore + submit, Then exactly one flag response is recorded
- Given flag resolved elsewhere, Then submit returns 409 and draft is cleared

**Test Cases:**
- Unit: Debounced autosave fires at 2s interval
- Integration: Simulate page reload; assert IndexedDB draft survives
- E2E (PWA): Kill tab, reopen, restore draft, submit; assert single API call
- E2E: Two tabs editing same flag; assert cross-tab sync via BroadcastChannel
- Accessibility: Restore prompt is screen-reader announced and keyboard-dismissable


### UC-EDGE-06: Handle session expiry mid-action with graceful re-auth
**Actor:** All authenticated users (Operator, Firm Admin, Accountant, Client) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- User session about to expire (JWT TTL e.g., 60min access, 14d refresh)
- User in middle of an action (form fill, upload, flag answer)

**Main Flow:**
1. Frontend interceptor catches 401 from API call
2. Refresh token call attempted silently
3. On success, original request replayed with new access token; user sees no interruption
4. On refresh failure (refresh expired or revoked), in-progress form state captured to localStorage (with PII masked for sensitive forms)
5. User redirected to login with returnTo=current_path
6. After successful re-auth, user lands on same page; form state restored

**Alternate Flows:**
- Refresh token revoked due to password change: full logout, draft preserved only for non-sensitive forms
- Refresh blocked due to tenant suspension (UC-EDGE-09): user sees explicit suspension page, not login
- Multiple tabs: refresh in one tab updates token across tabs via storage event
- MFA required for re-auth (Operator/Firm Admin): MFA challenge presented inline

**Edge Cases:**
- Clock skew on client (e.g., wrong device time): server computes expiry, not client; resilient
- Refresh race (two API calls trigger refresh simultaneously): single-flight pattern ensures one refresh call
- User idle for >14d: hard logout, no restore (security)
- Session expires during file upload to S3 pre-signed URL: pre-signed URL has own expiry; if both expire, upload aborts cleanly with retry prompt
- Operator console requires step-up MFA every 4h for sensitive actions (suspend tenant): handled separately

**Invariants Enforced:** INV-AUTH-JWT-ROTATION, INV-RBAC-ENFORCED, INV-TENANT-ISOLATION, INV-OPERATOR-NO-FINANCIAL-READ

**Acceptance Criteria:**
- Given access token expires during typing, When user clicks submit, Then refresh happens transparently and submit succeeds
- Given refresh fails, Then user is redirected to login with returnTo
- Given re-auth succeeds, Then user returns to same page with form state restored

**Test Cases:**
- Unit: 401 interceptor triggers exactly one refresh call (single-flight)
- Integration: Expired access token + valid refresh; assert seamless retry
- Integration: Expired refresh; assert redirect with returnTo
- E2E: User session expires during multi-step form; assert state restored after re-auth
- Security: Confirm sensitive fields (SSN/HST#) are NOT persisted to localStorage
- Security: Verify CSRF token rotates with refresh


### UC-EDGE-07: Resolve concurrent edits by two accountants on same client period
**Actor:** Accountant (two staff members) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Two accountants from same firm have App B open on same client's same period
- Period in 'processing' or 'processed' state

**Main Flow:**
1. Accountant A opens transaction T1 for edit; UI shows 'Accountant B is viewing this client' presence indicator
2. Backend uses optimistic concurrency via row version (ETag/updated_at)
3. Accountant A submits edit with If-Match header containing version
4. Server validates version; on match, applies edit and increments version
5. Server publishes WebSocket event 'transaction.updated' to all subscribers in tenant
6. Accountant B's UI receives event; if B was viewing T1, shows toast 'A just updated this; refresh?'
7. Accountant B refreshes or sees diff overlay

**Alternate Flows:**
- Accountant B already had T1 in edit mode and submits with stale version: server returns 409 Conflict with current state; B sees merge UI showing A's changes vs B's pending changes
- Both edit different fields on same transaction (e.g., amount vs. category): merge UI auto-resolves non-overlapping fields
- Conflict on flag status (A marks resolved, B marks resolved with different note): first-write wins; second sees toast 'Flag already resolved by A'
- Period state transition race (A clicks 'mark processed', B clicks 'mark processed'): state machine guard ensures one succeeds, one sees 'already processed'

**Edge Cases:**
- WebSocket disconnect: UI polls every 30s as fallback
- Accountant goes offline (laptop closes) with uncommitted edits: edits stay local; on reconnect, conflict detection runs
- Same accountant logged in twice (two devices): treated as two distinct sessions; presence indicator shows '(2 sessions)'
- Lock starvation: presence is advisory; no hard locks (avoid deadlock)
- Bulk action by one accountant while another is editing single row: bulk action uses row-version per item; partial success reported

**Invariants Enforced:** INV-MONOTONIC-STATE-MACHINE, INV-OPTIMISTIC-LOCKING, INV-AUDIT-APPEND-ONLY, INV-TENANT-ISOLATION

**Acceptance Criteria:**
- Given two accountants editing same transaction, When both submit, Then exactly one succeeds and the other sees 409 with merge view
- Given period state transition race, Then only one transition occurs and audit log shows actor
- Given presence indicator, Then it updates within 5s of remote user joining

**Test Cases:**
- Unit: Version increment on update
- Integration: Two parallel PATCHes with same ETag; assert one 200, one 409
- E2E: Two browsers logged in as different accountants; edit same row; assert merge UI on second
- E2E: State transition race; assert idempotent behavior
- Performance: Presence indicator scales to 20 concurrent accountants on same client


### UC-EDGE-08: Handle network partition and queue offline mutations on mobile PWA
**Actor:** Client (App C, PWA) | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- App C installed as PWA on iOS/Android
- Service worker registered
- User is in middle of uploading docs or answering flags

**Main Flow:**
1. Client performs action while online (e.g., upload, flag answer)
2. Network drops (subway, airplane mode)
3. Service worker intercepts failed fetch and queues request in IndexedDB outbox with idempotency key
4. UI shows 'Offline — your changes are saved and will sync when you reconnect' banner
5. User continues using read-only views (cached period data)
6. When network returns, background sync flushes outbox in order
7. On each success, UI updates and banner becomes 'Synced just now'

**Alternate Flows:**
- Conflict on replay (e.g., flag resolved by accountant in meantime): outbox item moved to 'requires attention'; user sees notification
- User uploads file while offline: file bytes stored in IndexedDB up to 50MB quota; flushed on reconnect
- User explicitly cancels offline action: outbox entry removed
- Period state changed server-side while offline (e.g., advanced to 'filed'): replay rejected with explanation; user sees diff

**Edge Cases:**
- IndexedDB quota hit: oldest non-critical drafts evicted; user warned
- User uninstalls PWA with pending outbox: data lost (documented)
- Background sync API not supported (iOS Safari historically limited): fallback to flush-on-visibility
- Multiple devices online simultaneously: each has own outbox; server idempotency dedupes
- Slow/flaky network (not full partition): exponential backoff prevents thundering herd

**Invariants Enforced:** INV-FLAG-IDEMPOTENCY, INV-DOC-IDEMPOTENCY, INV-MONOTONIC-STATE-MACHINE, INV-CLIENT-NO-PERIOD-SELECTION

**Acceptance Criteria:**
- Given network drop, When user submits flag answer, Then it queues locally without error
- Given network restored, Then outbox flushes in FIFO and UI reflects server state
- Given conflict on replay, Then user is shown actionable resolution UI

**Test Cases:**
- Unit: Outbox serialization round-trip
- Integration: Toggle navigator.onLine; assert queue/flush lifecycle
- E2E: Airplane mode test on real device; submit 3 actions; reconnect; assert all 3 sync exactly once
- E2E: Replay conflict scenario; assert user notification
- Performance: Outbox of 50 items flushes within 30s on 4G
- Accessibility: Offline banner is role='status' and announced by screen reader


### UC-EDGE-09: Tenant suspension impact on in-flight periods
**Actor:** Platform Operator (suspending), All firm users (impacted) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Tenant has periods in various states (open, processing, processed, complete, filed)
- Platform Operator decides to suspend (non-payment, breach, support hold)

**Main Flow:**
1. Operator opens App A, selects tenant, clicks 'Suspend' with required reason
2. MFA step-up challenge presented
3. On confirm, tenant.status set to 'suspended'; effective_at timestamp recorded
4. Background job runs:
5.   - All firm user sessions invalidated within 60s
6.   - In-flight extraction jobs paused (not killed; preserved for resume)
7.   - WebSocket subscribers disconnected with reason='tenant_suspended'
8. Firm users attempting access see read-only suspension page with billing/support contact
9. Client portal users see 'Your accounting firm is temporarily unavailable; data is safe' page
10. Audit log captures suspension with operator_id, reason, effective_at

**Alternate Flows:**
- Suspension lifted: jobs resume from checkpoint; sessions require re-login
- Suspension during a period transition (e.g., mid 'mark complete'): transition either fully committed or fully rolled back (transactional)
- Suspension during client upload: upload completes (already in S3), but processing paused; client sees 'Uploaded — pending firm reactivation'
- Hard delete vs. suspend: suspend is reversible (90d window); hard delete is separate flow with legal hold check

**Edge Cases:**
- Filed period during suspension: PDFs and immutable records remain readable to CRA/internal audit
- Operator self-locks (suspends own access by mistake): impossible (operator and tenant are separate)
- Suspension just before filing deadline: notification SLO to firm before suspension (where compliant)
- Cross-tenant data leakage during suspension: RLS hard-stop still applies
- Two operators try to suspend same tenant simultaneously: idempotent; one succeeds, other sees current state

**Invariants Enforced:** INV-OPERATOR-NO-FINANCIAL-READ, INV-TENANT-ISOLATION, INV-DATA-RESIDENCY, INV-AUDIT-APPEND-ONLY, INV-IMMUTABLE-FILED-RETURNS

**Acceptance Criteria:**
- Given suspension, When firm user makes any API call, Then 403 with suspension reason is returned
- Given suspension, Then operator console shows financial data is NEVER readable (only metadata)
- Given lift, Then in-flight jobs resume without data loss

**Test Cases:**
- Integration: Suspend tenant; assert all sessions invalidated within SLO
- Integration: Resume tenant; assert paused jobs continue
- Security: Operator suspension flow does not leak financial data (assert response shape)
- E2E: Client portal during suspension shows friendly page
- Audit: Log entry includes operator_id, reason, MFA assertion id


### UC-EDGE-10: Handle plan downgrade mid-period (feature gating without data loss)
**Actor:** Platform Operator (or Firm Admin via self-serve), affected Firm users | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Tenant on higher plan with feature X enabled (e.g., multi-currency, advanced benchmarks)
- Downgrade scheduled or immediate to lower plan that excludes feature X
- In-flight period uses feature X

**Main Flow:**
1. Downgrade requested via App A (Operator) or self-serve (Firm Admin) with effective date
2. Pre-flight check identifies in-flight usage of soon-to-be-disabled features
3. Warning shown: 'X is in use on N periods. After downgrade, feature becomes read-only for in-flight periods.'
4. On confirm, plan.effective_at set in future or now
5. Grandfather rule: in-flight periods retain feature X in read-only mode until they reach 'archived' state
6. New periods created after downgrade lack feature X
7. Banner appears in Firm Workspace for impacted periods explaining grandfathering

**Alternate Flows:**
- User cancels downgrade: no change
- Plan upgrade (opposite direction): feature unlocked immediately for all periods including in-flight
- Downgrade triggers loss of seats (e.g., from 10 to 5 accountants): admin must deactivate users before downgrade can commit
- Tenant exceeds new plan limits post-downgrade (e.g., too many clients): soft-block creation of new clients; existing clients remain

**Edge Cases:**
- Feature flag toggled atomically: no half-state where API allows write but UI hides control
- Cached UI on accountant's browser still shows feature: 401/403 enforced server-side regardless
- Plan change mid-WebSocket subscription: server pushes feature.disabled event; UI re-renders
- Billing race: downgrade applied but invoice still on old plan; prorated correctly
- Downgrade applied while a transaction is being authored using feature X: write succeeds if started pre-downgrade; subsequent reads still allowed

**Invariants Enforced:** INV-FEATURE-GATING-SERVER-ENFORCED, INV-TENANT-ISOLATION, INV-AUDIT-APPEND-ONLY, INV-NO-PERMANENT-DELETE-FINANCIAL

**Acceptance Criteria:**
- Given downgrade, When new period created, Then feature X is unavailable
- Given downgrade, Then in-flight periods retain feature X as read-only until archived
- Given attempted use of disabled feature, Then server returns 402 (payment required) or 403 with upgrade prompt

**Test Cases:**
- Integration: Schedule downgrade; assert pre-flight enumerates impacted periods
- Integration: After downgrade, attempt to use feature X; assert 403
- E2E: Firm admin downgrades; banner appears on impacted periods
- Audit: Plan change events logged with actor and reason


### UC-EDGE-11: Reopen filed period for correction with heavy audit
**Actor:** Accountant (firm staff) with optional Firm Admin approval | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Period in 'filed' or 'archived' state
- Accountant identifies correction need (CRA reassessment, late-discovered receipt)
- Firm policy may require dual-control (Firm Admin co-sign)

**Main Flow:**
1. Accountant opens filed period; clicks 'Request reopen' with mandatory reason
2. If firm policy requires approval, Firm Admin receives request; reviews and approves with MFA
3. On approval, system creates a NEW period_revision (v2); v1 remains immutable
4. Period state set back to 'processed' (skipping 'open'/'processing' to avoid re-uploads; doc set preserved)
5. Banner shown across Firm Workspace AND Client Portal: 'Period reopened for correction — original filing remains on record'
6. Accountant makes corrections; state machine still guards transitions
7. On re-mark complete, new Excel generated with version suffix (e.g., Q2-2026-v2.xlsx)
8. Accountant uploads amended/refiled PDF; system stores it linked to v2 alongside v1
9. Audit log captures every step with dual-signature (if applicable)

**Alternate Flows:**
- Reopen denied by Firm Admin: requester notified with reason
- Reopen for periods older than retention window (e.g., 7+ years): blocked with legal note
- Multiple reopens (v3, v4): each is a new revision; chain preserved
- Reopen during client feedback window: feedback for original v1 preserved; v2 gets its own feedback window (configurable)
- Client uploads new docs against reopened period: allowed since state is 'processed'; doc set version-tagged

**Edge Cases:**
- Reopen of an archived period older than 90d: requires Operator-level approval (configurable)
- Reopen reason field contains PII: stored encrypted; redacted in operator console
- Concurrent reopen requests by two accountants: first wins; second sees 'already reopened'
- Filed PDF replaced (not added): NOT allowed; immutability enforced; only NEW PDF added under v2
- Reopen triggers downstream recompute (KPIs, benchmarks): handled async with versioning

**Invariants Enforced:** INV-MONOTONIC-STATE-MACHINE, INV-IMMUTABLE-FILED-RETURNS, INV-AUDIT-APPEND-ONLY, INV-NO-PERMANENT-DELETE-FINANCIAL, INV-PERIOD-REVISION-CHAIN

**Acceptance Criteria:**
- Given reopen request, When approved, Then period_revision v2 created and v1 frozen
- Given reopen, Then client sees banner explaining status
- Given v2 completion, Then both v1 and v2 PDFs are queryable

**Test Cases:**
- Integration: Reopen flow; assert v1 untouched and v2 created
- Integration: Attempt to overwrite v1 PDF; assert 409
- E2E: Dual-control reopen with two firm users; verify MFA captured
- Audit: Log entries form a complete chain v1 -> reopen -> v2 -> file
- Security: Reopen RBAC enforced — accountant cannot self-approve where policy requires firm admin


### UC-EDGE-12: Process PIPEDA client deletion request with CRA retention carve-out
**Actor:** Client (client_owner) or Firm Admin on client's behalf | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Client requests data deletion (App C settings, or via firm)
- Client has historical financial data under CRA retention obligations (typically 6 years post-tax-year)

**Main Flow:**
1. Client clicks 'Request data deletion' in App C; reads PIPEDA + CRA retention notice
2. Client confirms intent; identity re-verified (password + email OTP)
3. Request creates a 'deletion_request' record; Firm Admin notified
4. System computes retention boundary: CRA-mandated records (filed returns, supporting docs, transaction ledger) are TAGGED 'legal_hold' and NOT deleted
5. Non-essential data eligible for erasure: profile PII, login records, feedback ratings, marketing preferences, in-app messages, drafts, optional metadata
6. Firm Admin reviews and approves with MFA; 30d cooling-off period unless client opts out
7. On execution, eligible records are erased (cryptographic erasure of encryption keys for at-rest data where applicable, plus row delete)
8. Retained records remain accessible to firm and CRA-required exports; client portal access is REVOKED
9. Client receives confirmation email listing what was erased vs. retained, with retention end date

**Alternate Flows:**
- Active period in-flight: deletion request blocked until period reaches 'filed'; user told why
- Client requests partial deletion (e.g., delete feedback only): supported via granular options
- Firm Admin denies (e.g., active dispute): client notified with appeal path
- Client withdraws request during cooling-off: nothing erased
- Client is the sole client_owner and firm wants to retain access: firm must export retained records before access cutover

**Edge Cases:**
- Backups: cryptographic erasure ensures deleted PII is unrecoverable even from backups
- Audit logs reference client: actor references replaced with hashed pseudonym; logs themselves retained
- Feedback ratings: if linked to operational signals used for firm scorecard, anonymized rather than deleted (aggregates preserved)
- Client has unpaid invoices to firm: deletion does not waive debt; financial records retained
- Cross-border data subject (e.g., dual-resident): PIPEDA applies; data residency unchanged (ca-central-1)

**Invariants Enforced:** INV-DATA-RESIDENCY, INV-IMMUTABLE-FILED-RETURNS, INV-AUDIT-APPEND-ONLY, INV-NO-PERMANENT-DELETE-FINANCIAL, INV-PIPEDA-COMPLIANCE, INV-CRA-RETENTION

**Acceptance Criteria:**
- Given deletion request, When executed, Then non-retained data is erased and confirmation sent
- Given retained data, Then CRA records remain accessible to firm for full retention window
- Given audit logs, Then they retain integrity without exposing erased PII

**Test Cases:**
- Integration: Submit deletion; assert classification of records (deletable vs. retained)
- Integration: Verify cryptographic erasure invalidates backup access
- E2E: Client flow from request -> confirm -> execute -> notification
- Security: Attempt to access deleted profile after execution; assert 404 and no PII in response
- Compliance: Retention end-date calculator matches CRA rules for HST/T2


### UC-EDGE-13: Export full tenant data for offboarding
**Actor:** Platform Operator OR Firm Admin (self-serve) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Tenant requests offboarding (cancellation, migration)
- Tenant is in good standing or paid up to date

**Main Flow:**
1. Firm Admin clicks 'Export all firm data' in App B (or Operator initiates in App A)
2. Pre-flight estimates size and time (e.g., 14GB, 2h)
3. Export job kicked off in background
4. Job collects: all clients, periods (per version), transactions, documents (original files), flags + responses, attestations, filed PDFs, audit logs, feedback, scorecard data, user list (no passwords), firm configuration
5. Output structured as ZIP per client folder, manifest.json describing schema, CSV + JSON dual format, README explaining structure
6. On completion, signed download URL emailed to Firm Admin; valid for 7 days; password-protected ZIP
7. Download tracked in audit log with IP, agent, partial-download tolerance

**Alternate Flows:**
- Operator-initiated export (e.g., legal request): Firm Admin notified UNLESS legal hold prohibits notification (rare)
- Tenant requests scheduled monthly export (backup ritual): supported via App B settings
- Export of suspended tenant: still possible for offboarding, gated by Operator approval

**Edge Cases:**
- Export larger than 50GB: split into multipart download with manifest
- Tenant has active in-flight periods: export warns 'data is a snapshot; in-flight periods may change'
- Concurrent imports/exports: serialized to prevent inconsistent snapshots
- Tenant attempts repeated exports as a DoS: rate-limited to 1 export per 24h per tenant
- Mid-export tenant suspension: job completes if started before suspension; otherwise blocked
- Time zone of timestamps in export: ISO-8601 with UTC + firm time zone field

**Invariants Enforced:** INV-DATA-RESIDENCY, INV-TENANT-ISOLATION, INV-AUDIT-APPEND-ONLY, INV-PIPEDA-COMPLIANCE

**Acceptance Criteria:**
- Given export request, When completed, Then ZIP contains all required entities per manifest
- Given download link, Then it expires in 7 days and is single-tenant-scoped
- Given export, Then no cross-tenant data leaks (verified via tenant_id check on every row)

**Test Cases:**
- Integration: Trigger export on tenant with 10 clients; assert ZIP structure matches manifest
- Security: Attempt to use download link from different IP/user; verify still works (signed URL) but audit captures
- Security: Inspect ZIP for cross-tenant data leakage (assert all tenant_id fields match)
- Performance: Export of 5GB completes within 2h SLO
- E2E: Firm admin downloads, extracts, verifies key files present


### UC-EDGE-14: Restore from backup after data corruption or accidental loss
**Actor:** Platform Operator (executes), Firm Admin (notified) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Backup system runs PITR (point-in-time recovery) every 5min snapshots and daily full backups
- Incident detected: data corruption, partial loss, or ransomware-style attack
- Approval chain: Operator + on-call engineer + Director-level sign-off

**Main Flow:**
1. Incident declared; tenant(s) impacted identified
2. Affected tenants notified within SLO (status page + email)
3. Operator opens restore console (App A internal); selects tenant + target timestamp
4. Pre-flight estimates RTO/RPO; lists data overlap with current state
5. Restore performed to isolated staging cluster; integrity verified (row counts, checksums on filed PDFs)
6. Read-only verification window for firm (10–60 min)
7. Operator promotes staging to production for tenant; old data archived to cold storage (NOT deleted) for forensics
8. Audit log captures full chain; post-mortem mandated

**Alternate Flows:**
- Partial restore (single client, single period): supported with finer-grained checkpoints
- Restore for cross-tenant incident: per-tenant restore loops to maintain isolation
- Restore conflict with newer data created post-incident: presented to firm; merge required
- Filed PDFs corrupted: restored from immutable object-lock S3 bucket (separate retention policy)

**Edge Cases:**
- Audit logs themselves corrupted: restored from append-only WORM storage
- Restore creates ID collisions with in-flight writes: writes paused during restore window
- Backup older than data residency policy edge: restoring still within ca-central-1
- Restore that crosses a schema migration boundary: migrations replayed against restored data
- Tenant rejects restore (prefers to lose data than overwrite recent work): supported with formal acknowledgment

**Invariants Enforced:** INV-DATA-RESIDENCY, INV-TENANT-ISOLATION, INV-IMMUTABLE-FILED-RETURNS, INV-AUDIT-APPEND-ONLY, INV-NO-PERMANENT-DELETE-FINANCIAL

**Acceptance Criteria:**
- Given backup, When restored to timestamp T, Then row counts and checksums match expected for T
- Given filed PDFs, Then they are restored byte-identical (object-lock proven)
- Given restore, Then tenant isolation is preserved (RLS still applies)

**Test Cases:**
- DR drill: Quarterly tabletop + live restore on staging tenant; measure RTO/RPO
- Integration: Simulate corruption; restore; verify integrity
- Security: Restored data cannot be cross-tenant accessed
- Audit: Restore actions logged with operator and approver chain


### UC-EDGE-15: Failover between AWS availability zones within ca-central-1
**Actor:** System (automated) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Multi-AZ deployment in ca-central-1 (a, b, d)
- Active-active app tier; primary-replica DB with synchronous replicas in alt AZ
- Health checks running every 10s

**Main Flow:**
1. AZ-a fails (or degraded)
2. Health checker detects unhealthy nodes within 30s
3. Load balancer drains AZ-a traffic to AZ-b/d
4. DB primary in AZ-a is promoted to replica in AZ-b automatically (RDS Multi-AZ)
5. Background jobs failover via SQS retry semantics
6. WebSocket connections drop; clients auto-reconnect (max 60s)
7. Brief in-flight request failures handled by client-side retry
8. Status page updated to 'degraded' then 'recovered'

**Alternate Flows:**
- Full region failure (ca-central-1 unavailable): NO automatic failover out of region (data residency); manual decision required by Operator; documented
- Partial degradation (one service): scoped failover (e.g., only AI extraction throttled)
- Network partition between AZs (split-brain): DB favors primary; minority AZ goes read-only

**Edge Cases:**
- Failover during a state transition: idempotency keys ensure no double-write
- S3 bucket access: same region; multi-AZ inherent
- Time skew across AZs: NTP enforced; tolerated up to 50ms
- Failover during file upload: pre-signed URL points to S3 directly (AZ-agnostic)
- Reconnection storm: WebSocket gateway uses jittered backoff

**Invariants Enforced:** INV-DATA-RESIDENCY, INV-TENANT-ISOLATION, INV-MONOTONIC-STATE-MACHINE, INV-AUDIT-APPEND-ONLY

**Acceptance Criteria:**
- Given AZ failure, When detected, Then traffic shifts within 60s with <0.1% error rate increase
- Given DB failover, Then no committed writes lost (synchronous replication)
- Given failover, Then no data leaves ca-central-1

**Test Cases:**
- Chaos engineering: Kill AZ-a node group; assert failover SLOs
- Integration: AZ network partition simulation; verify split-brain prevention
- DR drill: Quarterly game day exercise
- Compliance: Audit confirms no cross-region failover path is enabled by default


### UC-EDGE-16: Handle time zone boundaries for period start/end (firm time vs UTC)
**Actor:** System + Firm Admin (configures firm tz), Accountant, Client | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- Firm Admin has set firm timezone (e.g., America/Toronto)
- Client may be in different tz (e.g., America/Vancouver, America/Halifax)
- Periods are quarterly/monthly/annual with start/end dates

**Main Flow:**
1. Period boundaries stored as DATE (no tz) representing firm-local fiscal date
2. All timestamps (created_at, etc.) stored as UTC TIMESTAMPTZ
3. When client sees 'Q2 2026: April 1 — June 30', the date is firm-local; client may be in different tz but the fiscal window is the firm's
4. Upload deadline is computed as 'firm-local end-of-day' + grace period; client UI displays in client's tz with a note 'Deadline 2026-07-01 12:00 PM (your time) — your firm closes Q2 at 11:59 PM Toronto'
5. Period state transitions enforced against firm tz (e.g., 'mark complete' allowed only after period end in firm tz)

**Alternate Flows:**
- Firm changes tz mid-period: pinned to original tz for active period; new tz applies from next period
- Client travels mid-quarter: their UI tz follows browser; firm tz unchanged
- Period boundary on weekend/holiday: deadline shifted per firm config (next business day, or strict calendar)

**Edge Cases:**
- DST transition during a period: tz-aware library used; no off-by-one hour
- Leap year (Feb 29): supported; Q1 has 91 days in leap year
- Year-end period straddling midnight: stored explicitly as start_date and end_date inclusive
- Comparison of timestamps for state machine guards: always UTC under the hood; tz conversion only at presentation
- Multiple offices for one firm (rare): single firm_tz; offices can display localized but boundary is firm_tz

**Invariants Enforced:** INV-PERIOD-FIRM-TZ-BOUNDARY, INV-TIMESTAMPS-UTC-STORAGE, INV-CLIENT-NO-PERIOD-SELECTION, INV-MONOTONIC-STATE-MACHINE

**Acceptance Criteria:**
- Given firm tz=America/Toronto and period Q2 2026, Then period.end is 2026-06-30 23:59:59 in Toronto, 2026-07-01 03:59:59 UTC
- Given DST transition, Then no period gains or loses an hour incorrectly
- Given client in different tz, Then deadline displayed in both client tz and firm tz with clarity

**Test Cases:**
- Unit: Period boundary computation across DST (March/November) in Toronto
- Unit: Leap year period day count
- Integration: Mark-complete attempted before firm-tz end-of-period; assert blocked
- E2E: Client in Vancouver views Toronto firm's Q2; verify dual-tz display
- Property test: Generate random tz pairs; assert no off-by-one errors


### UC-EDGE-17: Handle DST transitions for scheduled jobs and reminders
**Actor:** System (cron/scheduler), Client (receives reminders) | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Reminder system schedules emails/notifications relative to period deadlines
- Scheduler operates in UTC; reminders fire at firm-local times

**Main Flow:**
1. Firm Admin configures reminder cadence (e.g., '7 days before period end at 9:00 AM firm time')
2. Scheduler computes UTC offset using IANA tz database for each occurrence (not stored as static offset)
3. Reminders queued in UTC absolute time
4. On DST transition day, scheduler recalculates remaining occurrences to honor 9:00 AM firm-local

**Alternate Flows:**
- User-specific reminder (client tz): scheduler honors client tz on send
- Reminder originally scheduled in 'fall back' overlap hour (1:00 AM-2:00 AM repeats): convention is to fire only once, at the first instance

**Edge Cases:**
- Reminder scheduled for non-existent local time (e.g., 2:30 AM during spring forward): system shifts to 3:30 AM (next valid moment) and logs adjustment
- Northern territories with no DST (Yukon, Saskatchewan): IANA tz handles correctly
- Firm Admin in different tz than firm: configuration UI shows firm tz, not admin tz
- Reminder rescheduled after edit: old occurrence cancelled by job_version key
- Tz database update (lib upgrade): regression tests on known historical dates

**Invariants Enforced:** INV-TIMESTAMPS-UTC-STORAGE, INV-PERIOD-FIRM-TZ-BOUNDARY, INV-AUDIT-APPEND-ONLY

**Acceptance Criteria:**
- Given DST start, When 9:00 AM firm-local on transition day, Then reminder fires within ±5 min of intended local time
- Given non-existent local time, Then reminder fires at next valid local time
- Given DST end overlap, Then reminder fires once, not twice

**Test Cases:**
- Unit: Scheduler returns correct UTC for 9:00 AM Toronto on March/November DST dates 2026-2030
- Unit: Non-existent local time produces shifted instant
- Integration: End-to-end reminder fires; assert delivery within window


### UC-EDGE-18: Handle period scheme changes (e.g., quarterly to monthly mid-year)
**Actor:** Firm Admin (configures), Accountant (operates), Client (observes) | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Client's filing frequency changes mid-year (e.g., HST threshold crossed; CRA changes assigned frequency)
- Accountant updates filing frequency in App B

**Main Flow:**
1. Accountant opens client config; changes frequency from quarterly to monthly with effective date
2. System checks for overlapping unfiled periods
3. If a quarter is partially complete (e.g., July uploaded under quarterly, but switch effective Aug 1): system computes a 'transition period' (July as a 1-month standalone)
4. Stub period created if needed (e.g., Jul 1-31 as standalone monthly to bridge to monthly cadence)
5. Client UI explains 'Your filing frequency changed; your next period is shorter than usual'
6. Audit log captures change with effective date, reason, actor
7. CRA reference (if applicable, e.g., CRA letter confirming new frequency) attached to firm-side record

**Alternate Flows:**
- Change effective at next fiscal year: simpler; no stub needed; new scheme starts Jan 1
- Change reversed (monthly back to quarterly): reverse stub may be needed; same flow
- Change effective mid-period: blocked unless period is in 'open'; otherwise must wait or reopen

**Edge Cases:**
- Stub period with too few transactions (zero): allowed (zero-activity period); still must be filed
- Stub period with fiscal year boundary crossing: respects year boundary first
- Filed periods unaffected: immutability preserved
- Switching from monthly to annual: stub computed similarly; client notified of long gap
- Concurrent change attempts by two accountants: state guard ensures one wins
- Frequency change while filing in progress: blocked with explanation

**Invariants Enforced:** INV-CLIENT-NO-PERIOD-SELECTION, INV-MONOTONIC-STATE-MACHINE, INV-PERIOD-REVISION-CHAIN, INV-AUDIT-APPEND-ONLY, INV-IMMUTABLE-FILED-RETURNS

**Acceptance Criteria:**
- Given mid-year frequency change, Then a stub period bridges old and new cadence
- Given filed periods, Then they remain immutable through the change
- Given client view, Then they see clear messaging about the change

**Test Cases:**
- Unit: Stub period computation for various effective dates and frequency pairs
- Integration: Change frequency; verify next period created correctly
- E2E: Accountant changes frequency; client sees explanation banner
- Audit: Frequency change event logged with full context


### UC-EDGE-19: Detect and resolve duplicate transactions across documents
**Actor:** System + Accountant | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Multiple documents uploaded covering overlapping periods (e.g., bank statement + receipts)
- AI extraction produces transactions with potential duplicates

**Main Flow:**
1. After extraction, deduplication engine runs against (date ± 3 days, amount, vendor fuzzy match)
2. Suspected duplicates linked with confidence score (internal)
3. Yellow flag raised: 'Possible duplicate: receipt $123.45 from Acme on Apr 5 also appears in bank statement Apr 6'
4. Accountant reviews; chooses 'merge', 'keep both', or 'split into related'
5. On merge, primary transaction retained with provenance updated; secondary marked superseded (not deleted)

**Alternate Flows:**
- Auto-merge with high confidence (configurable threshold): silent merge; logged but no flag
- Manual creation of transaction that duplicates existing: warned at submission time
- Receipt is a refund matching original purchase: marked 'related' not duplicate

**Edge Cases:**
- Same vendor, same amount, same date — but legitimate twin (e.g., two coffees): accountant decision
- Currency mismatch (FX): not duplicate unless converted equal within tolerance
- Rounding ($123.45 vs $123.46): tolerance window configurable
- Bank fee + matching receipt: treated as expected linkage, not duplicate

**Invariants Enforced:** INV-TXN-PROVENANCE, INV-NO-PERMANENT-DELETE-FINANCIAL, INV-AUDIT-APPEND-ONLY

**Acceptance Criteria:**
- Given suspected duplicate, When flagged, Then accountant has merge/keep/split options
- Given merge, Then primary retained and secondary marked superseded with link
- Given audit, Then merge actions are reconstructable

**Test Cases:**
- Unit: Fuzzy match scoring for vendor names
- Integration: Upload bank stmt + receipt; assert duplicate flag
- E2E: Accountant merges duplicates; verify period totals unchanged
- Property test: Merge then unmerge restores both rows logically


### UC-EDGE-20: Recover from rapid double-tap on critical action buttons
**Actor:** All users (client, accountant, firm admin, operator) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- User clicks an action that triggers a non-idempotent server call (e.g., 'Mark complete', 'Submit feedback', 'File HST')
- Click happens twice within 500ms (touch latency, accidental double-tap)

**Main Flow:**
1. Button click triggers UI loading state and disables button immediately (CSS pointer-events:none + aria-disabled)
2. Client sends request with Idempotency-Key (UUID generated on first click)
3. Server checks key in cache (Redis); if found, returns cached prior response
4. On success, button re-enables only after server confirms or 5s timeout

**Alternate Flows:**
- User clicks then immediately navigates away: idempotency key still honors single execution; result not shown but persisted
- Client clicks idempotently-handled endpoint multiple times across sessions: each session has own key; server may receive distinct keys but business logic guards (e.g., state machine refuses second 'mark complete')
- Keyboard Enter spam (accessibility): same protection applies

**Edge Cases:**
- Network latency makes first request seem hung: 'submitting' indicator persists; click still disabled
- Client cancels mid-flight (browser stop): server may complete; client poll on return reconciles state
- Idempotency cache expires (24h) and client retries: state machine guards prevent harm
- Operator destructive action (suspend tenant): in addition to idempotency, confirmation modal + MFA prevents reflexive double-tap

**Invariants Enforced:** INV-IDEMPOTENCY-CRITICAL-ACTIONS, INV-MONOTONIC-STATE-MACHINE, INV-AUDIT-APPEND-ONLY

**Acceptance Criteria:**
- Given double-tap, When server receives both, Then only one effect occurs
- Given button click, Then it visibly disables within 100ms
- Given accessibility, Then aria-disabled is set and screen readers announce state

**Test Cases:**
- E2E: Programmatic double-click within 200ms; assert single state change
- Unit: Idempotency middleware returns cached response on duplicate key
- Accessibility: Keyboard Enter twice; assert single action and announcement
- Performance: Click-to-disable latency < 100ms


### UC-EDGE-21: Enforce permission denial paths with helpful explanations
**Actor:** All users (attempting unauthorized actions) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- RBAC matrix defined; user attempts action outside permitted scope

**Main Flow:**
1. User invokes action (e.g., Client tries to view another firm; Accountant tries to access App A; Operator tries to read transactions)
2. Server-side guard checks RBAC + tenant context + RLS
3. On denial, server returns 403 with stable error code and safe message
4. UI shows actionable explanation (not generic 'access denied')
5. Audit log captures attempt with actor, target, decision, policy reason

**Alternate Flows:**
- User has role but tenant mismatch: 404 (not 403) to avoid leaking existence of resource
- User had access then lost it (role change mid-session): existing tabs receive 403 on next call; redirected to allowed area
- Accountant denied write but allowed read on certain client (granular per-client RBAC): UI shows read-only badge

**Edge Cases:**
- Operator attempts to read firm transactions: hard-blocked at policy level; logged as security event
- Client_staff attempts client_owner-only action (e.g., submit feedback): denial with explanation
- Firm Admin attempts to modify another firm's data: 404 (cross-tenant isolation)
- API token with limited scopes used for out-of-scope endpoint: 403 with scope hint
- Session role and JWT scopes mismatch: server uses JWT as source of truth; logs anomaly

**Invariants Enforced:** INV-RBAC-ENFORCED, INV-TENANT-ISOLATION, INV-OPERATOR-NO-FINANCIAL-READ, INV-AUDIT-APPEND-ONLY

**Acceptance Criteria:**
- Given unauthorized action, Then 403 (or 404 for cross-tenant) returned with stable code
- Given UI, Then explanation is human-readable and actionable
- Given audit, Then every denial is logged with policy id

**Test Cases:**
- Integration: Matrix-test RBAC across all role/action combinations
- Security: Pen-test attempting privilege escalation (e.g., JWT tampering)
- E2E: Each role hits forbidden endpoint; assert correct UI message
- Audit: Denial events queryable with reason


### UC-EDGE-22: Handle malformed inputs across all forms (numbers, dates, currency)
**Actor:** All users (form inputs) | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Forms accept numeric, date, currency, text inputs across apps

**Main Flow:**
1. Input validated client-side with locale-aware parser (e.g., 'fr-CA' comma decimal vs 'en-CA' dot decimal)
2. On submit, server re-validates with strict JSON Schema + business rules
3. On invalid, server returns 422 with field-level errors
4. UI shows per-field error messages with screen-reader announcements

**Alternate Flows:**
- Paste from spreadsheet with formatting ('$1,234.56'): client normalizes to numeric
- Date entered as DD/MM vs MM/DD: client uses locale; ambiguous dates trigger explicit picker
- Negative amounts where positive required: blocked at field level
- Currency mismatch: pickers explicit; default to CAD; flagged if other currency selected

**Edge Cases:**
- Unicode injection (RTL override, zero-width chars): sanitized server-side
- Extremely large numbers (overflow): rejected with explicit max
- Scientific notation in number field: parsed correctly if locale supports
- Empty optional fields vs. explicitly null: distinguished
- Form bots filling 10k chars in 'name' field: input maxlength + server-side cap
- Emoji in text fields: allowed (UTF-8), rendered safely

**Invariants Enforced:** INV-INPUT-VALIDATION-SERVER-SIDE, INV-AUDIT-APPEND-ONLY, INV-TENANT-ISOLATION

**Acceptance Criteria:**
- Given invalid input, Then client shows inline error before submit
- Given submit with invalid input, Then server returns 422 with field error map
- Given screen reader, Then errors announced via aria-live

**Test Cases:**
- Unit: Locale parsers for fr-CA, en-CA, en-US
- Property test: Fuzz numeric inputs; assert no overflow or NaN persisted
- Security: XSS payload in text fields; assert sanitization
- Accessibility: aria-invalid and aria-describedby properly set


### UC-EDGE-23: Surface observability via audit log search and export
**Actor:** Firm Admin, Platform Operator | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- Audit logs accumulated across system events
- User has audit-read permission

**Main Flow:**
1. User opens 'Audit log' view in respective app
2. Filters available: actor, action, target type, date range, tenant (Operator only sees metadata, never financial details)
3. Results paginated with 100 per page; full-text search backed by indexed fields
4. Each row expandable to show JSON payload (redacted PII for Operator)
5. Export to CSV/JSON available; rate-limited

**Alternate Flows:**
- Compliance officer needs immutable copy: signed export with hash chain
- Operator queries cross-tenant trends: only metadata aggregates, not individual entries
- Audit log shows reopen action: linked to period revision for traceability

**Edge Cases:**
- Very high cardinality (e.g., millions of upload events): pre-aggregated indices for performance
- Audit search itself logged (recursive but bounded)
- Append-only enforced: even admins cannot delete entries; immutability cryptographically attested
- Time zone display: user-selectable (firm tz vs UTC)
- Search across reopened/superseded entities: linked via revision chain

**Invariants Enforced:** INV-AUDIT-APPEND-ONLY, INV-OPERATOR-NO-FINANCIAL-READ, INV-TENANT-ISOLATION, INV-PIPEDA-COMPLIANCE

**Acceptance Criteria:**
- Given audit query, Then results return within 2s for 30d range
- Given Operator query, Then no financial values appear in payload
- Given export, Then signed and reproducible

**Test Cases:**
- Integration: Pre-populate 1M audit events; assert search SLO
- Security: Assert PII redaction in Operator view
- E2E: Firm Admin exports audit log; verify signature
- Compliance: Hash chain verification for append-only


### UC-EDGE-24: Handle empty states and first-time onboarding gracefully
**Actor:** All users (first login or empty data) | **Priority:** P1 | **Platform:** cross-platform

**Preconditions:**
- User logs in to fresh tenant/account
- No clients, periods, transactions, or documents yet

**Main Flow:**
1. Each app's main views detect empty state
2. Empty state component renders with illustration, primary CTA, and link to docs
3. App A (Operator): 'No tenants yet — provision your first firm'
4. App B (Firm Admin): 'No clients yet — invite your first client or import from CSV'
5. App B (Accountant): 'No periods assigned to you yet — see all firm clients'
6. App C (Client): 'Welcome! Your firm has set up your first period — upload documents to get started'
7. CTAs trigger respective creation flows

**Alternate Flows:**
- Account with hidden empty state (deactivated client): explicit message instead of generic empty
- Onboarding checklist (progressive disclosure): shown until 80% complete
- Skip onboarding (advanced users): preferences persisted per user

**Edge Cases:**
- Tenant has data but user has no permissions: 'No items you can view' (not 'no items exist')
- Filtered empty (e.g., no results for filter): distinguish from no-data-at-all empty
- Mobile vs desktop layout: empty states adapt; CTAs always tappable (min 48x48 touch target)
- Slow first-load: skeleton -> empty state with smooth transition, no flicker

**Invariants Enforced:** INV-RBAC-ENFORCED, INV-TENANT-ISOLATION

**Acceptance Criteria:**
- Given empty state, Then CTA is obvious and accessible
- Given filtered empty, Then user can clear filter quickly
- Given mobile, Then touch targets meet WCAG

**Test Cases:**
- E2E: New tenant onboarding flow end-to-end
- E2E: Filtered empty differs from absolute empty
- Accessibility: Screen reader announces empty state; keyboard navigation works
- Visual regression: Empty state on dark mode


### UC-EDGE-25: Maintain performance under scale and detect regressions
**Actor:** System (SLO monitoring), Platform Operator (alerts) | **Priority:** P0 | **Platform:** cross-platform

**Preconditions:**
- SLOs defined: p95 API < 400ms, upload p95 < 3s for 5MB, AI extraction p95 < 60s, page load p95 < 2.5s LCP
- RUM + synthetic monitoring + APM (e.g., Datadog/OpenTelemetry) configured

**Main Flow:**
1. Each request emits tracing spans (trace-id, tenant-id, user-role)
2. Metrics aggregated per endpoint, per tenant percentile
3. Alerts fire on SLO burn-rate (fast burn: 2% in 1h; slow burn: 5% in 6h)
4. On alert, Operator opens APM; identifies hot endpoint or tenant; triages
5. Common mitigations: per-tenant rate limit, query plan check, scale-out

**Alternate Flows:**
- Noisy neighbor: per-tenant quota tightened
- Bulk operation by one tenant degrades others: separate background queue; lower priority
- AI provider degradation: alert + auto-failover (UC-EDGE-01)

**Edge Cases:**
- Mass upload from one client: rate-limited per client, not per tenant, to avoid starvation
- Slow query on archived period: read replica + materialized view
- Memory leak: APM heap monitoring; rolling restart of nodes
- Spike on tax deadline week: auto-scale group rules
- Synthetic vs RUM disagreement: investigated for geographic gaps

**Invariants Enforced:** INV-TENANT-ISOLATION, INV-AUDIT-APPEND-ONLY, INV-DATA-RESIDENCY

**Acceptance Criteria:**
- Given SLO breach, Then alert fires within 5 min
- Given mitigation, Then SLO recovers within 30 min
- Given dashboards, Then per-tenant percentiles visible

**Test Cases:**
- Load test: Simulate 10k concurrent uploads; assert no degradation > 10%
- Chaos: Inject latency in AI provider; assert circuit breaker engages
- Synthetic: Hourly canary across all 3 apps in ca-central-1
- Regression: Performance budget enforced in CI for bundle size and LCP


---

## 5. Delivery phases

16 phases. Each phase is independently shippable with a concrete test gate. Constraint: one user type + one platform per phase. Phase 0 is the only exception (backend infrastructure with no user-facing platform — see STANDARDS §28 for why it's allowed).

**Phase summary (full detail below):**

| # | Phase | User type | Platform | Effort |
|---|---|---|---|---|
| 0 | Backend Spine | (backend — no user) | — | 6 wk, 4 eng |
| 1 | Platform Admin: Auth, Dashboard, Tenant Lifecycle | Platform Operator | web | 5 wk, 3 eng |
| 2 | Platform Admin: Billing, Entitlements, Plan Catalog | Platform Operator | web | 4 wk, 3 eng |
| 3 | Platform Admin: Observability, Compliance, Incident | Platform Operator | web | 5 wk, 3 eng |
| 4 | Firm Workspace: Auth, RBAC, Branding | Firm Admin | web | 4 wk, 3 eng |
| 5 | Firm Workspace: Team, Seats, Client CRUD | Firm Admin | web | 6 wk, 4 eng |
| 6 | Firm Workspace: Policy Configuration | Firm Admin | web | 5 wk, 3 eng |
| 7 | Accountant: Dashboard, Client Setup, Engagement | Accountant | web | 5 wk, 4 eng |
| 8 | Accountant: AI Pipeline, FSM, Filing | Accountant | web | 8 wk, 5 eng |
| 9 | Accountant: Flags & Inbox | Accountant | web | 6 wk, 4 eng |
| 10 | Client Portal: PWA Shell, Upload Pipeline | Client Owner | mobile | 10 wk, 5 eng |
| 11 | Client Portal: Flag Inbox, Not-Found Attestation | Client Owner | mobile | 8 wk, 4 eng |
| 12 | Client Portal: Dashboard, Gates, Archive, Downloads | Client Owner | mobile | 7 wk, 4 eng |
| 13 | Client Portal: Quarterly Feedback | Client Owner | mobile | 5 wk, 3 eng |
| 14 | Client Portal: Staff Sub-Role Permission Model | Client Staff | mobile | 6 wk, 4 eng |
| 15 | Firm Workspace: Firm-Side Scorecard, Reports | Firm Admin | web | 5 wk, 3 eng |

**Total:** ~95 weeks of work across phases (calendar time is shorter with parallelization after Phase 1).

---


### Phase 0: Backend Spine: Multi-Tenant Foundation, RBAC, Audit, Data Model
**User Type:** Backend Infrastructure (no end user) | **Platform:** web | **Effort:** 6 weeks, 4 engineers (2 backend, 1 infra, 1 security)

**Scope:** Foundational backend infrastructure shared by all three apps: NestJS service skeleton, Postgres schema with tenant_id on every row, Postgres RLS policies as hard backstop, RBAC matrix (operator/firm_admin/accountant/client_owner/client_staff), append-only audit log with hash chaining, JWT auth with refresh rotation, idempotency middleware, AWS ca-central-1 infrastructure (RDS Multi-AZ, S3 with KMS, Redis, SQS/BullMQ, ElastiCache), data residency enforcement, observability stack (OpenTelemetry/Datadog), CI/CD pipelines, secrets management. No user-facing UI ships in this phase; it exposes the contracts for every subsequent phase.

**Use Cases Included:** INV-TEN-1, INV-TEN-2, INV-RBAC-1, INV-AUDIT-1, INV-RES-1, INV-SEC-1, INV-IDEMPOTENCY-1, Cross-cutting from UC-X-20, UC-X-25, UC-EDGE-09, UC-EDGE-13, UC-EDGE-14, UC-EDGE-15, UC-EDGE-23

**Invariants:** INV-TENANT-1 (tenant_id on every row), INV-TENANT-2 (Postgres RLS backstop), INV-RBAC-1 (server-side role enforcement), INV-AUDIT-1 (append-only audit), INV-AUDIT-IMMUT (no UPDATE/DELETE on audit table), INV-RES-CA (ca-central-1 data residency), INV-AUTH-1 (JWT rotation; refresh token security), INV-IDEMPOTENCY-1 (idempotency keys on all mutations), INV-OPERATOR-NO-FIN-DATA (operator cannot read financial tables)

**Dependencies:** None

**Exit Criteria:**
- [ ] All 4 role types can authenticate via test harness; JWT carries tenant_id + role + sub_role claims
- [ ] Cross-tenant query attempted via test returns zero rows (RLS verified)
- [ ] Audit log INSERT works; UPDATE/DELETE rejected at DB-trigger level
- [ ] Idempotency middleware deduplicates POSTs within 24h window
- [ ] All RDS, S3, Redis resources pinned to ca-central-1; IaC review signed off
- [ ] OpenTelemetry traces flowing; per-tenant metric dimensions available
- [ ] Disaster recovery runbook documented; backup/restore drill completed on staging
- [ ] Operator role test confirms zero read access to financial tables (policy + RLS dual block)
- [ ] Hash-chain integrity verifier passes for audit log

**Test Strategy:**
- **Unit:** JWT claim builder excludes financial scopes for operator role; RLS policy unit tests for every financial table; Idempotency cache key derivation deterministic; Hash-chain verifier rejects tampered audit entry
- **Integration:** Cross-tenant query blocked at DB even when app filter removed (defense in depth); Audit INSERT atomic with parent action transaction; Refresh token rotation invalidates prior token; Operator-role token receives 403 on any financial endpoint stub
- **E2E:** End-to-end auth flow for each role via test client; assert correct scope and tenant isolation
- **Manual UAT:** Security review of IaC for ca-central-1 pinning; Penetration test on auth/refresh endpoints; Compliance checklist: PIPEDA controls signed off
- **Security:** JWT tampering test (signature, claim modification); Cross-tenant RLS penetration test; Operator privilege escalation attempt blocked; Audit log tamper detection via hash chain; Refresh token replay rejected
- **Performance:** Auth endpoint p95 < 200ms; Audit write does not block parent transaction > 5ms; RLS overhead measured < 10% on representative queries; Multi-AZ failover RTO < 60s on synthetic test

**Rollback Plan:** N/A


### Phase 1: Platform Admin Console: Operator Auth, Dashboard, Tenant Lifecycle
**User Type:** Platform Operator (Nugen internal) | **Platform:** web | **Effort:** 5 weeks, 3 engineers (2 full-stack, 1 frontend)

**Scope:** App A core: operator MFA login with WebAuthn/TOTP, session management with idle timeout, platform dashboard with tenant inventory (counts, recent activity, SLA snapshot, no firm financial data), tenant provisioning wizard (creates tenant + subscription + region pin + first-admin invite), tenant suspension/reactivation/soft-delete/restore with audit, first firm-admin invite flow with single-use tokens, search/filter/sort tenants with saved views.

**Use Cases Included:** UC-OP-01, UC-OP-02, UC-OP-03, UC-OP-04, UC-OP-05, UC-OP-06, UC-OP-07, UC-OP-11, UC-OP-12, UC-OP-13, UC-OP-25

**Invariants:** INV-TEN-ISO (tenant isolation), INV-TEN-3 (operator never reads firm financial data), INV-TEN-LIFECYCLE (suspend/restore/delete state machine), INV-SEC-AUTH (MFA mandatory for operator), INV-AUDIT-APPEND, INV-RES-CA, INV-DATA-RETAIN (90-day soft-delete window)

**Dependencies:** 0

**Exit Criteria:**
- [ ] Operator can log in with MFA, view dashboard, and see only tenant metadata (zero financial data in DOM or network responses)
- [ ] Provision a tenant end-to-end; first firm admin receives invite email within 5s
- [ ] Suspend tenant terminates active firm/client sessions within 60s; in-flight jobs pause at checkpoint
- [ ] Soft-delete tenant respects 90-day cron with legal-hold check; restore reverts to suspended state
- [ ] Tenant detail page passes pen-test for cross-tenant data access
- [ ] Session expires at 15min idle with warning at 25min; refresh token rotation works across tabs
- [ ] Audit log captures every operator action with IP, UA, geo

**Test Strategy:**
- **Unit:** Tenant FSM rejects invalid transitions (e.g., reactivate from deleted); CRA business number validator; Idempotency on wizard submission prevents double-create; Last-Owner check (UC-OP-14 deferred but used elsewhere)
- **Integration:** Tenant creation atomic with subscription + region pin + invite enqueue; Suspension invalidates JWTs via deny-list within 60s; Hard-delete cron respects legal_hold flag; RLS active on new tenant immediately
- **E2E:** Operator login → dashboard → provision tenant → see in inventory within 3s; Suspend → firm user sees 'tenant suspended' page → reactivate → firm login works; Search/filter URL-shareable view loads identically for second operator
- **Manual UAT:** UAT: Operator creates 5 test tenants, verifies inventory, suspends/restores one; Security review of operator console for financial data leakage; Compliance review of PIPEDA acknowledgment flow
- **Security:** Operator JWT cannot fetch /api/tenants/:id/transactions (403); MFA brute-force lockout after 3 attempts; Session fixation: session ID rotates post-auth; Tenant_id in payload ignored; server-generated only
- **Performance:** Dashboard with 1000 tenants: first paint < 2s, interactive < 4s; Search p95 < 500ms with 10k tenants; Tenant provisioning end-to-end < 5s

**Rollback Plan:** N/A


### Phase 2: Platform Admin Console: Billing, Entitlements, Plan Catalog, Operator Users
**User Type:** Platform Operator (Nugen internal) | **Platform:** web | **Effort:** 4 weeks, 3 engineers

**Scope:** App A billing and configuration depth: subscription plan changes via Stripe with proration, per-tenant entitlements and feature flags, global platform feature flags with percentage rollout and sticky hashing, plan/SKU catalog management with grandfathering, operator user CRUD with role hierarchy (Owner/Senior/Standard/ReadOnly/Support) and last-owner protection.

**Use Cases Included:** UC-OP-08, UC-OP-09, UC-OP-10, UC-OP-14, UC-OP-24

**Invariants:** INV-BILL-AUDIT, INV-ENT-CAPS (entitlement enforcement), INV-PLATFORM-LAST-OWNER, INV-AUDIT-APPEND, INV-TEN-3

**Dependencies:** 1

**Exit Criteria:**
- [ ] Plan change persists in DB and Stripe atomically; rollback on Stripe failure
- [ ] Entitlement caps enforced server-side on firm side (verified via stub firm API)
- [ ] Feature flag toggle propagates across NestJS nodes < 5s
- [ ] Global flag 25% rollout produces ~25% of tenants in bucket with sticky hashing
- [ ] Last Owner cannot be deleted or downgraded
- [ ] Plan SKU deprecation prevents new assignments; existing grandfathered

**Test Strategy:**
- **Unit:** Sticky hash deterministic per tenant_id; Entitlement enforcement: downgrade blocked if usage exceeds new cap; Targeting rule evaluator (AND/OR composition); Last-Owner invariant blocks demotion
- **Integration:** Stripe webhook reflects plan change; entitlement cache invalidated; Cache invalidation propagates across nodes via pub-sub; Plan SKU deprecation prevents new tenant assignment
- **E2E:** Operator changes plan → firm admin can no longer exceed new caps; Toggle flag → firm user sees feature on refresh; Invite operator → accept → permissions enforced
- **Manual UAT:** UAT: Finance team validates proration math for monthly/annual upgrades and downgrades; Security review of Stripe webhook signature validation
- **Security:** Non-senior operator cannot edit global flags (403); Privilege escalation Standard → Owner blocked; Stripe webhook signature tampering rejected
- **Performance:** Flag evaluation p95 < 5ms with cache hit; Plan change Stripe roundtrip < 3s p95

**Rollback Plan:** N/A


### Phase 3: Platform Admin Console: Observability, Compliance, Incident Response, Bulk Ops
**User Type:** Platform Operator (Nugen internal) | **Platform:** web | **Effort:** 5 weeks, 3 engineers

**Scope:** App A operations toolset: audit log query/export with sanitization, observability dashboard (uptime, latency, queue health, residency status), queue health and failed-job recovery, data residency compliance checks with PDF evidence export, SLA dashboard and per-tenant SLA reports, capacity planning and per-tenant cost attribution, incident response workflow, PIPEDA/SOC2 compliance reports, bulk operations on tenants with MFA step-up, scheduled tasks.

**Use Cases Included:** UC-OP-15, UC-OP-16, UC-OP-17, UC-OP-18, UC-OP-19, UC-OP-20, UC-OP-21, UC-OP-22, UC-OP-23

**Invariants:** INV-AUDIT-APPEND, INV-AUDIT-IMMUT, INV-RES-CA, INV-OBSV-AGG-ONLY (aggregate only; no per-transaction data), INV-JOB-IDEMPOTENT, INV-TEN-3

**Dependencies:** 1

**Exit Criteria:**
- [ ] Audit log query returns sanitized payloads (no financial fields)
- [ ] Observability dashboard renders all widgets < 4s; alerts fire within 60s of threshold breach
- [ ] Residency check report exportable as PDF with evidence per resource
- [ ] Bulk job of 100 tenants completes with per-tenant audit entries and retry-failed-only option
- [ ] Compliance report (PIPEDA) generates with hash for tamper detection
- [ ] Incident declared SEV1 pages on-call within 30s

**Test Strategy:**
- **Unit:** DTO sanitizer strips financial fields from audit event payloads; Region matcher validates ARN region segment; SLA percentage calc with partial periods; Sanitizer redacts dollar values and account numbers from queue payloads
- **Integration:** Audit log append-only enforced at DB; Residency scan triggers RED on synthetic out-of-region resource; Retry mechanism honors max retries; no infinite loop; Status page API integration mock for incidents
- **E2E:** Operator runs residency scan → exports PDF with evidence; Bulk suspend 10 tenants → 10 audit events present; Declare → update → resolve incident; full timeline immutable
- **Manual UAT:** UAT: Compliance officer validates PIPEDA evidence pack content; Quarterly DR drill: full restore from backup
- **Security:** Audit log UPDATE/DELETE rejected by trigger; Queue payload viewer redacts financial values; Operator without ops.queue → 403
- **Performance:** 100k-row audit export streams without OOM; Observability dashboard widgets parallelize and render < 4s

**Rollback Plan:** N/A


### Phase 4: Firm Workspace Foundation: Auth, RBAC Gates, Branding, Empty States
**User Type:** Firm Admin / Partner | **Platform:** web | **Effort:** 4 weeks, 3 engineers

**Scope:** App B foundation for firm-admin role: MFA-enforced login, session lifecycle with silent refresh and draft preservation, permission-denied paths with 403/404 distinction (cross-tenant becomes 404), first-time firm onboarding wizard (branding, defaults, templates, invite team, invite first client), firm branding management (logo, colors with WCAG AA, display name), audit-log read for firm-scoped events.

**Use Cases Included:** UC-FA-01, UC-FA-11, UC-FA-24, UC-FA-25

**Invariants:** INV-SEC-1 (MFA for firm admin), INV-RBAC-1 (server-side authorization is source of truth), INV-TEN-1, INV-AUDIT-1, INV-A11Y-1 (color contrast WCAG AA)

**Dependencies:** 0, 1

**Exit Criteria:**
- [ ] Firm admin completes onboarding wizard in < 90s on happy path; resumable mid-flow
- [ ] Logo virus scan + MIME sniff rejects polyglot files
- [ ] Color picker enforces WCAG AA contrast; rejects sub-threshold combos
- [ ] Accountant role attempting admin route sees 403 with no data leak
- [ ] Cross-tenant URL tampering returns 404 (not 403) to prevent enumeration
- [ ] Session draft preserved across re-auth on sensitive forms (PII masked)

**Test Strategy:**
- **Unit:** WizardStateMachine reducer transitions forward only on valid step; Contrast checker against WCAG AA formula; Sanitization strips inline SVG scripts
- **Integration:** POST /onboarding/step persists partial state; Logo upload virus scan + S3 put + CDN invalidation; Magic link tokens single-use, HMAC-signed; replay returns 401
- **E2E:** Full wizard happy path with audit assertion; Branding flows through to client portal + emails (verified via Mailpit); Accountant logs in, hits /settings/team, sees 403
- **Manual UAT:** UAT: Two firm admins complete onboarding using French and English; Visual review of branding across client portal, emails, PDFs
- **Security:** MFA bypass attempts blocked; Polyglot logo file rejected; Token replay test; CSP forbids inline scripts in SVG
- **Performance:** Wizard initial paint < 1.5s on cold start (p95); Logo upload + CDN invalidation < 10s

**Rollback Plan:** N/A


### Phase 5: Firm Workspace: Team Management, Plan Seats, Client CRUD, Bulk Ops
**User Type:** Firm Admin / Partner | **Platform:** web | **Effort:** 6 weeks, 4 engineers (3 full-stack, 1 frontend)

**Scope:** App B people/clients management: invite and manage accountants with RBAC role assignment (last-admin protection, seat enforcement), plan seat entitlements view and upgrade request flow, invite first client (multi-step modal with HST/T2 setup), assign/transfer client between accountants with reason capture, document checklist template CRUD with versioning, search/filter/sort clients with saved views, bulk operations across clients (reassign, tag, opt-out).

**Use Cases Included:** UC-FA-02, UC-FA-10, UC-FA-12, UC-FA-14, UC-FA-15, UC-FA-21, UC-FA-22, UC-FA-23

**Invariants:** INV-RBAC-1, INV-RBAC-2 (only assigned accountants write to client), INV-BILL-1 (seat enforcement against plan), INV-CLI-2 (client config snapshotted at creation), INV-LIFE-2 (filing frequency set by firm, not client), INV-CFG-2 (versioned templates), INV-CLI-1 (client never sees internal accountant changes)

**Dependencies:** 4

**Exit Criteria:**
- [ ] Invite accountant; accept flow lands them in workspace with MFA enrolled
- [ ] Cannot demote last firm admin (422 with clear reason)
- [ ] Seat exhaustion blocks invite with upgrade CTA
- [ ] Create client atomically with first period in 'open' state
- [ ] Transfer client between accountants; previous loses write, gains read-only
- [ ] Bulk reassign 100 clients with per-row audit linked to batch_id
- [ ] Checklist template edit creates new version; in-flight periods use snapshot

**Test Strategy:**
- **Unit:** RoleChangeGuard rejects demotion when last-admin invariant breaks; BN format validator (BN9 + RT/RC); Template version increment on edit; Seat counter logic at boundary of 0/limit
- **Integration:** Invite endpoint enforces seat limit via SELECT FOR UPDATE; Client creation atomic; rollback on any sub-step failure; Transfer endpoint locks both accountants and client row; Bulk idempotency on retry
- **E2E:** Invite → accept → MFA → access workspace; Create client → invite → client first login flow; Transfer client with active flags; flags reassigned to new accountant; Bulk reassign 10 clients; verify all moved and audited
- **Manual UAT:** UAT: Firm admin onboards 5 accountants and 20 clients with mixed templates
- **Security:** Cross-tenant template access blocked; Magic link token rotation on resend; Bulk action re-evaluates permission per item if role changes mid-job
- **Performance:** Team list with 500 accountants renders < 200ms (virtualized); Client search across 10k clients p95 < 300ms; 1000-row bulk completes < 2 minutes

**Rollback Plan:** N/A


### Phase 6: Firm Workspace: Policy Configuration (Thresholds, Prompts, Benchmarks, Display, Retention, Integrations)
**User Type:** Firm Admin / Partner | **Platform:** web | **Effort:** 5 weeks, 3 engineers

**Scope:** App B configuration depth: per-signal auto-prompt thresholds with versioned config and impact preview, extra-prompt cap (0-5), soft-tone prompt copy editor with tone classifier and EN/FR enforcement, industry benchmarks (NAICS-based), line-number sub-labels toggle, per-client opt-in for auto-prompts, confidence threshold override (80-99.9%), CRA login workflow assistance integration (no credentials stored), accounting software export mappings (QuickBooks/Xero), retention policies within CRA rules, filed-return archive structure (HST/T2 grouping). This phase ships the firm's full policy surface that drives downstream accountant + client behavior.

**Use Cases Included:** UC-FA-03, UC-FA-04, UC-FA-05, UC-FA-06, UC-FA-07, UC-FA-08, UC-FA-09, UC-FA-17, UC-FA-18, UC-FA-19, UC-FA-20

**Invariants:** INV-CFG-2 (versioned config; immutable per version), INV-FB-1 (auto-prompts capped; base ratings always required), INV-FB-3 (soft-tone copy enforced), INV-FB-4 (per-client opt-in overrides firm default), INV-AI-1 (confidence never visible to client), INV-FLAG-1 (flag color = source), INV-HST-1 (HST broken out in data regardless of display), INV-SEC-3 (no CRA credentials stored), INV-RET-1 (CRA 6-year minimum retention), INV-FIL-1 (filed PDFs immutable), INV-FIL-2 (HST/T2 grouped separately), INV-RPT-1 (benchmarks never exposed to client)

**Dependencies:** 5

**Exit Criteria:**
- [ ] Threshold change writes new version; in-flight periods use prior snapshot
- [ ] Prompt copy tone-rejected if shouting/blame language detected; both EN/FR required
- [ ] Benchmark override never appears in client portal API
- [ ] Confidence threshold change applies to new periods only; mid-processing uses snapshot
- [ ] Retention < 6 years rejected with CRA explanation
- [ ] CRA integration form blocks pasted credentials at client-side detector
- [ ] Export mapping preview renders sample period file correctly

**Test Strategy:**
- **Unit:** ThresholdSchema bounds and type coercion; Tone classifier deterministic on golden inputs; Cap clamp function clamps to plan max; Retention bounds reject < 6 and > 10 years
- **Integration:** PATCH with optimistic concurrency; 409 on stale version; Sanitization strips script tags before tone classifier runs; GET /reports/client/:id for accountant returns benchmarks; client API omits; Processing job snapshots threshold at start
- **E2E:** Change threshold → complete a period → auto-prompts fire per new value; Edit prompt copy → client portal renders new copy on next feedback; Per-client opt-out → client sees only 3 base ratings
- **Manual UAT:** UAT: Firm admin tunes thresholds and previews impact retrospectively; Compliance: Verify retention policy aligns with CRA documentation
- **Security:** Non-admin user receives 403 on threshold PATCH; Client API never returns confidence or benchmark fields (snapshot test); CRA credential pattern detector blocks all forms
- **Performance:** Preview impact query returns < 2s for 10k periods; Industry list with 500 benchmarks renders < 300ms

**Rollback Plan:** N/A


### Phase 7: Firm Workspace: Accountant Core Workflow (Login, Dashboard, Client Setup, Engagement Config)
**User Type:** Accountant | **Platform:** web | **Effort:** 5 weeks, 4 engineers

**Scope:** App B accountant-role surface for daily setup work: login + dashboard landing, view/filter assigned clients with statuses and deadlines, create new client with engagement setup (filing frequency, period scheme derived not free-typed), invite client owner and optionally client_staff, configure per-client opt-ins inherited from firm defaults, onboarding empty states, permission denial handling, calendar/deadline view.

**Use Cases Included:** UC-AC-01, UC-AC-02, UC-AC-03, UC-AC-04, UC-AC-05, UC-AC-20, UC-AC-22, UC-AC-23

**Invariants:** INV-TENANT-1, INV-RBAC-2 (accountant sees only assigned clients), INV-PERIOD-1 (period scheme system-derived), INV-CONFIG-1 (firm-locked settings cannot be overridden per-client), INV-CHECKLIST-1, INV-RBAC-3 (client sub-roles enforced)

**Dependencies:** 6

**Exit Criteria:**
- [ ] Accountant lands on dashboard showing only assigned clients within 1.5s p95 for 50 clients
- [ ] Create client + first period atomically in 'open' state
- [ ] Client owner invite token signed + single-use; cross-tenant rejected
- [ ] Calendar exports ICS that imports correctly into Google/Outlook with TZ
- [ ] Cross-tenant access via URL tampering → 404
- [ ] Accountant role downgrade reflects on next request (UI re-evaluates)

**Test Strategy:**
- **Unit:** Period derivation from frequency + FYE for monthly/quarterly/annual; Filter builder generates correct SQL predicates; Setting inheritance resolver (firm default → per-client override); Deadline derivation per CRA rules
- **Integration:** Idempotency key prevents duplicate client on retry; RLS policy filters clients by accountant assignment; Version-based optimistic concurrency on settings; Invite token signed + single-use + tenant-scoped
- **E2E:** Login → dashboard renders assigned clients only; Create client → first period appears in 'open' state; Invite → client first login → reaches portal; Toggle setting → reflected in next period rendering
- **Manual UAT:** UAT: Accountant creates 10 clients with mixed frequencies; verifies dashboard accuracy
- **Security:** Tampering subdomain returns 403 not 404 within tenant; Cross-tenant BN duplicate check stays within tenant scope; Brute-force triggers lockout
- **Performance:** Dashboard load with 50 clients < 1.5s p95; Search 500 accountants < 200ms; Calendar with 100 clients × 4 events < 2s

**Rollback Plan:** N/A


### Phase 8: Firm Workspace: Accountant Processing Pipeline (AI Trigger, Ledger Review, State Machine, Filing)
**User Type:** Accountant | **Platform:** web | **Effort:** 8 weeks, 5 engineers (3 backend, 1 ML/AI integration, 1 frontend)

**Scope:** App B accountant operational core: trigger AI processing with handoff boundary (aiLocked), review extracted ledger lines with confidence colors (internal) and corrections (silent operational signal), mark period processed with HST summary (105/108/109), mark period complete (Gate 2 explicit manual switch), upload filed HST/T2 PDFs (immutable, never app-generated), reopen filed period with reason + optional firm admin co-sign, export accountant working file with confidence column (accountant-only). Includes AI fallback (UC-EDGE-01), corrupted file rejection (UC-EDGE-02), dedup (UC-EDGE-03), low-confidence salvage (UC-EDGE-04), concurrent edits (UC-EDGE-07), duplicate transactions (UC-EDGE-19), and Gate 2 denial path (UC-X-05/X-08).

**Use Cases Included:** UC-AC-06, UC-AC-07, UC-AC-11, UC-AC-12, UC-AC-13, UC-AC-14, UC-AC-17, UC-X-05, UC-X-08, UC-EDGE-01, UC-EDGE-02, UC-EDGE-03, UC-EDGE-04, UC-EDGE-07, UC-EDGE-19

**Invariants:** INV-PERIOD-2 (state monotonic; guarded transitions), INV-DOC-1 (aiLocked after processing starts), INV-GATE-1 (numbers gated on flags cleared + processed), INV-GATE-2 (Excel + feedback gated on explicit complete), INV-HST-1 (net of HST; 105/108/109 broken out), INV-FILED-1 (filed PDFs immutable; never app-generated), INV-SIGNAL-1 (corrections recorded silently), INV-CLIENT-VIS-1 (confidence stays accountant-side), INV-DATA-RESIDENCY-1 (ca-central-1), INV-OPTIMISTIC-LOCKING, INV-DOC-IDEMPOTENCY

**Dependencies:** 7

**Exit Criteria:**
- [ ] Trigger processing: state→processing AND docs.aiLocked=true atomically; client uploads blocked
- [ ] AI fallback chain: primary → retry → Textract → manual entry; provenance recorded
- [ ] Mark processed blocked when open flags exist (422 with flag list)
- [ ] Mark complete blocked when not all flags closed (422)
- [ ] Upload filed PDF requires state=complete; immutable after upload
- [ ] Reopen requires reason; original PDF retained; amendment chain visible
- [ ] Confidence field stripped from all client-facing responses (snapshot test passes)
- [ ] Concurrent edits resolved by version conflict with merge UI
- [ ] Duplicate transactions flagged with merge/keep/split affordance

**Test Strategy:**
- **Unit:** State machine guard rejects skip and reverse; HST summary computation (positive/negative/zero/refund); Confidence threshold predicate at boundaries (0.59, 0.60, 0.61); Fuzzy match scoring for vendor duplicate detection; Magic-byte sniffer for upload validation
- **Integration:** Outbox enqueues AI job after commit; Primary AI fails 3x → Textract job enqueued exactly once; Mark processed atomic with HST summary persist + Gate 1 evaluation; Filed PDF stored in ca-central-1 with object lock + KMS; Concurrent PATCH with same ETag: one 200, one 409; EICAR test virus quarantined
- **E2E:** Trigger processing → docs locked on client portal in real time; Process → mark processed → all flags closed → Gate 1 fires on client; Mark complete → filed PDFs uploaded → state=filed; Reopen → amend → re-file: original immutable, new revision created; Two accountants edit same row → merge UI on second
- **Manual UAT:** UAT: Accountant processes 5 representative client periods end-to-end; Compliance: Filed PDF immutability + object-lock verification
- **Security:** Client API never returns confidence (regex grep on response bodies); Accountant from another firm cannot trigger processing via API tampering; Filed PDF replace attempt blocked (403); PDF sandbox kills parse bomb at memory limit
- **Performance:** Trigger processing API responds < 3s (async work); 5000-line ledger virtualized table renders smoothly; HST summary < 500ms for 5000 lines; 25MB filed PDF upload < 60s on 50Mbps

**Rollback Plan:** N/A


### Phase 9: Firm Workspace: Accountant Flags & Inbox (Raise, Reply, Defer Resolution, Bulk)
**User Type:** Accountant | **Platform:** web | **Effort:** 6 weeks, 4 engineers

**Scope:** App B accountant flag lifecycle: raise red flag (accountant-sourced, color=red) with required answer type, answer client-deferred flag ('Let my accountant choose') with not-found attestation on behalf, reply to client flag explanation with double-write verification, personal inbox/queue across clients with snooze, search across clients/periods/flags/documents, bulk-process multiple clients with eligibility filtering, audit log inspection for own actions, view operational signals dashboard (own clients, read-only), concurrent multi-user scenarios. Includes bulk flag resolution (UC-X-14).

**Use Cases Included:** UC-AC-08, UC-AC-09, UC-AC-10, UC-AC-15, UC-AC-16, UC-AC-18, UC-AC-19, UC-AC-21, UC-AC-24, UC-AC-25, UC-X-14

**Invariants:** INV-FLAG-1 (red=accountant, yellow=system), INV-ATTEST-1 (not-found write-once, attributed, timestamped), INV-SIGNAL-1 (corrections silently captured), INV-SIGNAL-2 (flag reply lag captured silently), INV-DOC-2 (receipt double-write transaction + checklist), INV-GATE-1 (Gate 1 re-evaluates on flag state change), INV-CONCURRENCY-1, INV-RBAC-2

**Dependencies:** 8

**Exit Criteria:**
- [ ] Accountant raises red flag → client sees red badge + notification within 3s
- [ ] Defer flag resolution by accountant produces immutable attestation with author=accountant_id
- [ ] Receipt double-write atomic: transaction + checklist count both increment exactly once
- [ ] Flag reply lag signal recorded silently; never returned to client
- [ ] Inbox 100+ flags paginate with snooze affordance
- [ ] Bulk resolve 100 flags within 5s with single consolidated client notification
- [ ] Operational signals dashboard scoped to own clients; client API returns 403 for same endpoints

**Test Strategy:**
- **Unit:** Color derivation = source (not confidence); Attestation write-once enforcement at DB; Reply lag computation; Median/percentile computations for signals
- **Integration:** Gate 1 recalculation on flag state change; Double-write transactional; Bulk resolve produces correlation ID + per-flag audit entries; Snooze with TZ-aware expiry
- **E2E:** Raise flag → client sees red badge + notification; Defer → accountant resolves → client portal updates; Bulk resolve 100 flags → client gets 1 push; Snooze → wait → re-appears
- **Manual UAT:** UAT: Accountant handles a quarter's worth of mixed flag types across 10 clients
- **Security:** Client cannot reach signal endpoints (403); Cross-tenant search blocked; Cannot edit prior attestation; XSS attempts in flag copy escaped on save and render
- **Performance:** Inbox sync via SSE < 10s; Search across 10k docs < 500ms p95; 1000-flag batch < 30s; Operational signal dashboard with 10 clients < 2s

**Rollback Plan:** N/A


### Phase 10: Client Portal: PWA Shell, Auth, Onboarding, Document Upload Pipeline
**User Type:** Client (Owner) | **Platform:** mobile | **Effort:** 10 weeks, 5 engineers (2 mobile/PWA, 2 backend, 1 QA mobile specialist)

**Scope:** App C MVP for upload flow: install PWA on iOS/Android with proper manifest + service worker, accept invitation with onboarding tour, view guided upload checklist for current period (system-derived; no date picker), upload to typed slots via file picker / camera capture / multi-page scan, catch-all 'Other documents' drop zone, reorder pages, delete before AI lock, observe banner state change when accountant locks period, retry on poor connectivity with multipart resume, queue uploads while offline with service worker outbox and background sync, foreground-resume, X-of-N tile, camera permission denial paths, file type/size rejection, EXIF/HEIC stripping client-side, preview document, search/filter checklist for large lists, bulk upload, push notifications, session expiry with silent re-auth, browser refresh recovery, client_staff sub-role parity, observability/audit. Includes session expiry (UC-EDGE-06), offline queue (UC-EDGE-08), corrupted file rejection (UC-EDGE-02), idempotency (UC-EDGE-03), double-tap (UC-EDGE-20), malformed inputs (UC-EDGE-22), empty states (UC-EDGE-24).

**Use Cases Included:** UC-CL-UP-01, UC-CL-UP-02, UC-CL-UP-03, UC-CL-UP-04, UC-CL-UP-05, UC-CL-UP-06, UC-CL-UP-07, UC-CL-UP-08, UC-CL-UP-09, UC-CL-UP-10, UC-CL-UP-11, UC-CL-UP-12, UC-CL-UP-13, UC-CL-UP-14, UC-CL-UP-15, UC-CL-UP-16, UC-CL-UP-17, UC-CL-UP-18, UC-CL-UP-19, UC-CL-UP-20, UC-CL-UP-21, UC-CL-UP-22, UC-CL-UP-23, UC-CL-UP-24, UC-CL-UP-25, UC-X-01, UC-EDGE-02, UC-EDGE-03, UC-EDGE-06, UC-EDGE-08, UC-EDGE-20, UC-EDGE-22, UC-EDGE-24

**Invariants:** INV-DOC-1 (aiLocked: client uploads blocked after processing starts), INV-PERIOD-1 (client never picks period), INV-NO-DATEPICKER-1 (no date picker in client UI), INV-PRIV-1 (EXIF GPS stripped), INV-RES-1 (uploads to ca-central-1 only), INV-AUDIT-1 (every upload audited), INV-CONF-1 (confidence never sent to client), INV-AUTH-2 (RBAC sub-role enforcement), INV-PWA-1 (installability + offline-safe queue), INV-RETAIN-1 (soft-delete only; no permanent deletes)

**Dependencies:** 8

**Exit Criteria:**
- [ ] PWA passes Lighthouse PWA audit (installability >=90)
- [ ] Upload HEIC: stored object is JPEG with no GPS tags
- [ ] Period lock: client UI banner transitions within 30s; in-flight upload not silently attached
- [ ] Offline queue: drains 50 items in < 90s on 4G after reconnect
- [ ] Multi-page scan: page order preserved end-to-end
- [ ] Delete before aiLock removes document; after aiLock, Delete UI absent
- [ ] Cross-tenant in queue: rejected on user logout/switch
- [ ] client_staff sub-role uploads with audit attribution 'client_staff'
- [ ] No date picker anywhere in client UI (automated DOM audit)

**Test Strategy:**
- **Unit:** HEIC→JPEG conversion preserves orientation; strips GPS tags; Client-side size guard rejects >25MB before presign; Outbox queue FIFO with dedupe by flagId; Banner state machine pure function; Tile selector pure function for X/N counts
- **Integration:** Presign returns short-lived URL scoped to tenant + client + period prefix; Server defense rejects upload with GPS metadata; Service worker fetch handler intercepts mutations only; BroadcastChannel ensures only one tab uploads; Web Push end-to-end on Android (VAPID)
- **E2E:** Install on Chrome Android, verify standalone launch; iOS Safari instructional A2HS card visible; Pick PDF → slot transitions to Received → audit log row; Airplane mode: capture 3 files, go online, all upload exactly once; Scan 5 pages, reorder 3→1, upload, accountant view shows correct order; Camera permission denied → fallback to file picker; Period lock mid-upload: in-flight upload not silently attached
- **Manual UAT:** Mobile device farm: real-device testing on iOS Safari, Android Chrome, Edge Mobile; UAT: Client uploads a quarter of mixed receipts/statements
- **Security:** Tampering tenant_id in presign request returns 403; Uploaded EXE renamed .pdf rejected via magic-byte check; Polyglot file flagged by AV scan; Operator role tested against audit endpoints — 403 on financial reads; Presigned URL cannot be reused after upload (single-use)
- **Performance:** 10 MB upload < 8s on 4G simulated; Checklist with 40 slots renders < 200ms p95 on mid-tier Android; PDF assembly for 10-page scan < 5s on mid-tier Android; HEIC conversion < 3s for 12 MP image

**Rollback Plan:** N/A


### Phase 11: Client Portal: Flag Inbox, Answering Flows, Real-time Updates, Not-Found Attestation
**User Type:** Client (Owner) | **Platform:** mobile | **Effort:** 8 weeks, 4 engineers (2 mobile/PWA, 2 backend)

**Scope:** App C flag lifecycle for client: view open flags list with mirrored count on home tile, answer Category flag with chip selection, answer Explain flag with freeform text + draft preservation, upload receipt to answer Receipt flag (transactional double-write), submit 'Not Found' attestation (immutable), preview source documents via lightbox preserving scroll, change/reopen previously cleared flag (re-locks Gate 1), receive real-time updates via WebSocket/SSE when accountant raises new flag, push notifications, offline submission with outbox sync, view answered (cleared) flags with filter, recovery paths (network error, session expiry mid-action, concurrent staff/owner edits), throttle double-taps, reject malformed inputs, statement-with-row-highlighted thumbnails, performance with virtualized lists, Gate 1 unlock verification, logout cleanup. Includes accountant-initiated flag (UC-X-02) reception side, gate state transitions (UC-X-03/04), browser crash recovery (UC-EDGE-05), permission denial (UC-EDGE-21), not-found attestation (UC-X-13).

**Use Cases Included:** UC-CL-FL-01, UC-CL-FL-02, UC-CL-FL-03, UC-CL-FL-04, UC-CL-FL-05, UC-CL-FL-06, UC-CL-FL-07, UC-CL-FL-08, UC-CL-FL-09, UC-CL-FL-10, UC-CL-FL-11, UC-CL-FL-12, UC-CL-FL-13, UC-CL-FL-14, UC-CL-FL-15, UC-CL-FL-16, UC-CL-FL-17, UC-CL-FL-18, UC-CL-FL-19, UC-CL-FL-20, UC-CL-FL-21, UC-CL-FL-22, UC-CL-FL-23, UC-CL-FL-24, UC-CL-FL-25, UC-X-02, UC-X-13, UC-EDGE-05, UC-EDGE-21

**Invariants:** INV-FLAG-1 (color = source: yellow=system, red=accountant), INV-RECEIPT-1 (double-write transaction + checklist count), INV-ATTEST-1 (write-once, attributed, timestamped), INV-ATTEST-2 (transaction still recorded after not-found), INV-GATE-1 (numbers re-lock when flag reopens), INV-CONF-1 (no confidence shown to client), INV-AUDIT-1, INV-XSS-1 (output encoding), INV-REALTIME-1 (WebSocket at-least-once with idempotency), INV-FIN-IMMUT (no permanent deletes of financial data)

**Dependencies:** 9, 10

**Exit Criteria:**
- [ ] Open count badge matches list count exactly; updates < 2s on flag.created event
- [ ] Category answer with chip → green cleared state; audit log entry CLIENT_ANSWERED_CATEGORY
- [ ] Receipt upload performs atomic double-write (transaction + checklist count)
- [ ] Not-found attestation immutable: second attempt returns 422; UPDATE blocked at DB
- [ ] Reopen flag → Gate 1 re-locks; numbers screen shows pending
- [ ] Real-time flag.created event delivered within 2s to client room
- [ ] Offline answer queues in outbox; sync on reconnect with idempotency
- [ ] Concurrent owner/staff edits resolved via optimistic concurrency
- [ ] No confidence percentage in any response (contract test passes)

**Test Strategy:**
- **Unit:** Count selector returns COUNT WHERE status=open AND client_id=session; Sanitizer strips script tags from explain text; Attestation entity has no UPDATE method exposed; Reopen guard rejects if flag.status != answered
- **Integration:** Cross-tenant flagId returns 403; Double-write transactional: failure on checklist rolls back document attachment; Idempotency middleware returns cached response on duplicate key; WebSocket subscription scoped to tenant:client room; Background sync replays outbox in FIFO with idempotency; DB trigger prevents UPDATE/DELETE on audit_log and attestation tables
- **E2E:** Tap chip → submit → green cleared + count decrement; Offline submit → outbox → reconnect → sync to single backend write; Upload receipt → atomic double-write verified end-to-end; Not-found attest → second attempt 422 → DB row immutable; Reopen → Gate 1 re-locks → numbers screen shows pending; Multi-window: accountant raises flag → client sees within 2s; Lightbox: scroll restoration to exact Y position
- **Manual UAT:** VoiceOver on iOS, TalkBack on Android: full flag answering flows; UAT: Client answers 20 mixed flags including not-found
- **Security:** Fuzz with XSS, SQL injection, polyglot file in pasted content; Verify presigned URL TTL < 15min and scoped to single object key; Cross-tenant WebSocket subscribe rejected; Notification body contains no financial details or vendor names by default
- **Performance:** Flag list TTI under 2s on 3G fast with 50 flags; WebSocket badge update render < 100ms after event; 500-flag list virtualized scroll at 60fps on mid-tier Android; Receipt 4MB upload + double-write < 10s on LTE

**Rollback Plan:** N/A


### Phase 12: Client Portal: Current-Quarter Dashboard, Gate Visualization, Archive, Excel & PDF Downloads
**User Type:** Client (Owner) | **Platform:** mobile | **Effort:** 7 weeks, 4 engineers (2 mobile/PWA, 2 backend)

**Scope:** App C numbers and history surface: 'Where this quarter stands' card with locked/pending/processed states (heading always visible per INV-DISP-1), DRAFT numbers (Gate 1) with HST 105/108/109 net-of-HST display, drill-into-detail view (one tap deeper), Excel download (Gate 2 unlock) from home and detail, browse historical period archive (label + status only, no numbers on row), filed-quarter detail with P&L + grouped HST/T2 PDFs, share via system share sheet, cached filed returns offline (read-only), HST refund vs payable edge values, no-date-picker audit, no-confidence audit, pull-to-refresh and live updates, permission denial for client_staff, error recovery for failed downloads, first-time onboarding empty state, audit and observability touchpoints. Includes Gate 1 fire (UC-X-04) reception, Gate 2 unlock + download (UC-X-06), period regression (UC-EDGE-18 reception side, time zone handling UC-EDGE-16).

**Use Cases Included:** UC-CL-DB-01, UC-CL-DB-02, UC-CL-DB-03, UC-CL-DB-04, UC-CL-DB-05, UC-CL-DB-06, UC-CL-DB-07, UC-CL-DB-08, UC-CL-DB-09, UC-CL-DB-10, UC-CL-DB-11, UC-CL-DB-12, UC-CL-DB-13, UC-CL-DB-14, UC-CL-DB-15, UC-CL-DB-16, UC-CL-DB-17, UC-CL-DB-18, UC-CL-DB-19, UC-CL-DB-20, UC-CL-DB-21, UC-CL-DB-22, UC-CL-DB-23, UC-CL-DB-24, UC-CL-DB-25, UC-X-04, UC-X-06, UC-EDGE-16

**Invariants:** INV-DISP-1 ('Where this quarter stands' heading always visible), INV-DISP-4 (archive rows label-only; numbers one tap deeper), INV-GATE-1 (numbers unlock visualization), INV-GATE-2 (Excel + feedback gating), INV-DRAFT-1 (DRAFT tag prominent until Gate 2), INV-HST-NET-1 (numbers net of HST), INV-HST-LINES-1 (lines 105/108/109 displayed), INV-EXCEL-SCOPE-1 (period-scoped only; no date range), INV-FILED-PDF-1 (immutable filed PDFs grouped HST vs T2), INV-NO-DATEPICKER-1, INV-CONF-1, INV-PAST-PERIOD-DOWNLOAD-1 (past periods always downloadable)

**Dependencies:** 11

**Exit Criteria:**
- [ ] Locked state: heading present even on network failure
- [ ] Gate 1 unlock: DRAFT tag visible; HST lines correct vs backend
- [ ] Gate 2 unlock: Excel download succeeds with correct period scope; audit log records source
- [ ] Past periods downloadable regardless of current gate state
- [ ] Archive rows: zero monetary figures (automated DOM audit)
- [ ] No date picker anywhere (automated DOM/route audit)
- [ ] Confidence never present in any client payload (snapshot test)
- [ ] Cached filed PDFs viewable offline; downloads gracefully degrade
- [ ] Pull-to-refresh debounced; SSE live-updates state transitions

**Test Strategy:**
- **Unit:** stateMachine.canShowNumbers(period) returns false unless processed && noOpenFlags; hstHeadlineMapper covers positive/negative/zero/null; Filename builder sanitizes special characters; Read-only selector returns true for state in [complete, filed, archived]
- **Integration:** POST /periods/:id/excel returns 403 when gate2=false even if URL is known; Signed URL TTL=300s; request after expiry returns 401 with auto-retry; Past period download bypasses Gate 2 check; WebSocket gate1.unlocked event renders DRAFT within 2s; Period state regression UI handles gracefully
- **E2E:** Login with locked period → heading 'Where this quarter stands' visible, lock icon present; All flags cleared + processed → DRAFT numbers visible within 2s; Gate 2 → Excel download lands in Files (iOS) / Downloads (Android); Archive: 10 archived periods → 10 rows, no $ symbols in row text; Filed PDF: tap → inline viewer with Share button; Offline: cached filed period viewable; Excel disabled with copy; DOM audit: spider all client routes; assert no date picker components
- **Manual UAT:** Mobile device farm: real-device on iOS Safari, Android Chrome; UAT: Client navigates 4 quarters of history; verifies content + downloads; Visual review: DRAFT watermark across all states + zoom levels
- **Security:** Snapshot every client API response → assert confidencePct undefined; Cross-tenant period download attempt → 403; Filed PDF cross-tenant URL guess → 403 (signed URLs scoped); Operator role cannot fetch client periods or financial data (regression)
- **Performance:** Home heading renders < 1.5s on 3G throttle; Lighthouse PWA score >= 90 on Mobile; Filed period detail loads < 2s on 4G; 200-archived-periods scroll at 60fps (virtualization)

**Rollback Plan:** N/A


### Phase 13: Client Portal: Quarterly Feedback with Signal-Linked Auto-Prompts
**User Type:** Client (Owner) | **Platform:** mobile | **Effort:** 5 weeks, 3 engineers (2 mobile/PWA, 1 backend)

**Scope:** App C feedback collection: Gate-2 feedback availability notification, view feedback intro card on home, open feedback form (3 base ratings + up to N auto-prompts based on firm-set signal thresholds), provide three base ratings (Quality/Service/App), answer auto-prompt follow-ups with rating-signal linkage stored, optional freeform comment with draft preservation, edit ratings pre-submit, submit completed feedback with idempotency, handle offline submission with background sync, view confirmation state (immutable), skip and resume later, light reminder notifications respecting quiet hours, view multiple pending feedbacks (backlog), handle period regression during active feedback session (UC-CL-FB-18), restrict submission per sub-role (owner-only vs staff), session expiry with reauth and resume, accessibility, server error recovery, prevent operational signal leakage to client, audit and observability, PIPEDA residency compliance.

**Use Cases Included:** UC-CL-FB-01, UC-CL-FB-02, UC-CL-FB-03, UC-CL-FB-04, UC-CL-FB-05, UC-CL-FB-06, UC-CL-FB-07, UC-CL-FB-08, UC-CL-FB-09, UC-CL-FB-10, UC-CL-FB-11, UC-CL-FB-12, UC-CL-FB-13, UC-CL-FB-14, UC-CL-FB-15, UC-CL-FB-16, UC-CL-FB-17, UC-CL-FB-18, UC-CL-FB-19, UC-CL-FB-20, UC-CL-FB-21, UC-CL-FB-22, UC-CL-FB-23, UC-X-07

**Invariants:** INV-FB-1 (one invitation per period per client; one submission per invitation), INV-FB-2 (3 base ratings + ≤ firm cap auto-prompts), INV-FB-3 (only at Gate 2), INV-FB-6 (soft copy; no staff names or raw metrics), INV-FB-8 (rating-signal linkage stored server-side), INV-FB-13 (submission immutable post-write), INV-FB-14 (idempotent submission via submission_id), INV-FB-15 (attribution to client_user_id and sub_role), INV-CLIENT-1 (operational signals not visible to client), INV-DATA-RESIDENCY-1 (ca-central-1)

**Dependencies:** 12

**Exit Criteria:**
- [ ] Gate 2 transition → exactly one push notification within 60s
- [ ] Form load returns 3 base + ≤firmCap auto-prompts; never more
- [ ] Cap=0 → only 3 base ratings shown; auto-prompts hidden entirely
- [ ] Submit success: exactly one record; retry with same submission_id returns same record
- [ ] Concurrent submissions from two devices: exactly one persists
- [ ] Operational signal raw values never present in any client-facing payload (contract test)
- [ ] Period regression mid-form: pause invitation; resume on re-complete with new snapshot
- [ ] Offline submit queues; replays on reconnect with idempotency

**Test Strategy:**
- **Unit:** Auto-prompt selector picks top-N by firm priority when more than cap tripped; Soft copy template substitution rejects raw metric or staff name placeholders; Submit disabled state derives from (qualityRating && serviceRating && appRating); Idempotency check uses composite (tenant_id, period_id, client_user_id, submission_id)
- **Integration:** Form endpoint returns 409 when period not complete; Submission persists rating ↔ signal_id mapping; Schema validation rejects fields named rawValue, threshold, staffName, confidence; Reminder eligibility excludes submitted and archived invitations; Audit writer rejects updates and deletes
- **E2E:** Trigger threshold breach, complete period, verify expected prompt copy renders; Skip both prompts, submit succeeds, backend records skip with linkage; Offline: submit, go online, verify single backend write; Multi-period backlog: 3 pending, submit one, list updates to 2; Period regression: pause invitation → resume → submit; Owner-only policy: staff sees 403 UI; owner submits successfully
- **Manual UAT:** UAT: Real clients submit feedback for completed periods; Firm scorecard verifies rating-signal linkage joins
- **Security:** Attempt to enumerate signal_ids via prompt_id; opaque mapping prevents; Cross-tenant submission attempt → 403; Penetration test: confirm no signal raw values appear in any response; Staff role cannot bypass owner-only policy via direct API call
- **Performance:** P95 submission < 500ms; Notification fan-out for 10k complete-transitions/min within SLA; Form load p95 < 1s on 4G

**Rollback Plan:** N/A


### Phase 14: Client Portal: Staff Sub-Role Permission Model & Multi-User Scenarios
**User Type:** Client (Staff / In-house Bookkeeper) | **Platform:** mobile | **Effort:** 6 weeks, 4 engineers (2 mobile/PWA, 2 backend)

**Scope:** App C client_staff sub-role surface: accept staff invitation from owner with onboarding, authenticate with biometric/WebAuthn, view dashboard with sub-role attribution context, upload as staff with attribution, answer flags with sub-role attribution, upload receipt with double-write under staff identity, submit 'Not Found' attestation with firm-configurable owner-only/allow-both policy, view flag list with owner-only restrictions surfaced, view DRAFT numbers respecting owner-side firm restrictions, download Excel with attribution, view archive read-only, view filed PDFs, submit feedback per firm policy, view 'who did what' activity feed, notifications scoped to staff permissions, owner restricts/revokes staff access with session termination, concurrent owner/staff edit conflict resolution (UC-CL-ST-17/18), session expiry recovery with draft preservation, PWA install + offline outbox parity, search/filter, profile self-edit (no role elevation), bulk upload, accessibility, observability without leaking financials.

**Use Cases Included:** UC-CL-ST-01, UC-CL-ST-02, UC-CL-ST-03, UC-CL-ST-04, UC-CL-ST-05, UC-CL-ST-06, UC-CL-ST-07, UC-CL-ST-08, UC-CL-ST-09, UC-CL-ST-10, UC-CL-ST-11, UC-CL-ST-12, UC-CL-ST-13, UC-CL-ST-14, UC-CL-ST-15, UC-CL-ST-16, UC-CL-ST-17, UC-CL-ST-18, UC-CL-ST-19, UC-CL-ST-20, UC-CL-ST-21, UC-CL-ST-22, UC-CL-ST-23, UC-CL-ST-24, UC-CL-ST-25

**Invariants:** INV-AUTH-2 (WebAuthn counter validation), INV-AUTH-3 (revocation effective immediately), INV-AUTH-5 (no self role-elevation), INV-RBAC-3 (client sub-roles enforced server-side), INV-CONC-1 (optimistic concurrency on flag answers), INV-AUDIT-1 (sub_role attribution captured), INV-FLAG-RECEIPT-1 (double-write transactional), INV-NOTIF-1 (recipient eligibility check at send time), INV-DRAFT-1 (encrypted at rest, device-scoped, TTL'd), INV-CONF-1, INV-SIGNAL-PRIV-1

**Dependencies:** 13

**Exit Criteria:**
- [ ] Staff invite token single-use; replay returns 410
- [ ] All staff actions audited with sub_role=client_staff attribution
- [ ] Owner-only flag does not deliver push to staff; staff inbox CTA disabled
- [ ] Owner revokes staff: next API call returns 401/403 within 60s; sessions terminated
- [ ] Concurrent owner/staff flag submission: first wins; second gets 409 with current state
- [ ] Concurrent receipt uploads from owner + staff: checklist dedupes on sha256; both audited with distinct sub_roles
- [ ] Firm policy owner-only attestation: staff blocked at both UI and API
- [ ] Role-elevation attempt via payload tamper: 403

**Test Strategy:**
- **Unit:** Invite token validator rejects expired/revoked/tampered; User creation service prevents role escalation; WebAuthn verifier rejects counter regression; Recipient eligibility filter respects owner-only and revocation
- **Integration:** Revoked staff cannot exchange refresh token for access token; Permission check denies when sub_role not in firm allowlist; Concurrent submit returns 409 to loser; Concurrent upload race: two doc rows, one checklist increment; Profile tamper attempt rejected
- **E2E:** Invite → onboard → MFA → biometric → dashboard with staff attribution; Owner revokes mid-session: staff sees logout within 60s; Owner-staff race on flag answer: correct UI on both sides; Bulk upload 20 images: per-item retry; resume after kill; Switch firm policy on the fly: behavior changes on next load
- **Manual UAT:** UAT: Owner + staff working same client period; verify attribution and policy enforcement
- **Security:** Replay of consumed invite token returns 410; Client-side bypass attempt (manual API call) rejected by server; Drafts encrypted in IndexedDB via SubtleCrypto; key not extractable; Logout clears IndexedDB drafts; revoked subscription removed; Telemetry contract test asserts no PII or financial values in event allow-list
- **Performance:** Biometric unlock < 2s on modern devices; 20-image library pick concurrency-capped uploads adapt to 4G→3G; 1000-item index search < 300ms p95; Revocation propagates to push subscriptions

**Rollback Plan:** N/A


### Phase 15: Firm Workspace: Firm-Side Scorecard, Reports, Operational Signal Aggregation
**User Type:** Firm Admin / Partner | **Platform:** web | **Effort:** 5 weeks, 3 engineers (2 full-stack, 1 data engineer)

**Scope:** App B analytics + reporting surface: firm-side scorecard (objective signals × subjective ratings) with overview / by-accountant / by-client / by-industry tabs and drill-downs, firm-wide reports (throughput, aging, accountant workload, client revenue mix, HST owed by period) with deep-linkable filters and CSV/PDF/Excel exports, view firm-wide audit log with hash chain verification and CSV export. This phase ships after the data-producing phases (8/9/13) so signals have data to join.

**Use Cases Included:** UC-FA-13, UC-FA-16, UC-X-11

**Invariants:** INV-RPT-2 (firm-side reports include subjective + objective), INV-OPS-1 (operational signals never shown to client), INV-AUD-2 (report exports audit-logged), INV-AUDIT-IMMUT (no UPDATE/DELETE on audit table), INV-FIRM-SCOPED-DATA-1, INV-OPERATOR-NO-FIN-DATA-1, INV-TENANT-1

**Dependencies:** 9, 13

**Exit Criteria:**
- [ ] Scorecard joins ratings + signals via stored linkage; correlations rendered
- [ ] Drill-down to single client shows full period history within firm scope
- [ ] Reports deep-linkable via URL; CSV export contains both rating and signal columns
- [ ] Audit log search returns p95 < 1s on 100k entries
- [ ] Client API cannot reach scorecard endpoints (403)
- [ ] Operator role cannot reach firm scorecard or reports (404)
- [ ] Large export (100k rows) handled async with email link
- [ ] Hash chain integrity verifier passes; tamper attempt rejected

**Test Strategy:**
- **Unit:** Aggregation pipeline with multiple filters; Sort comparator orders by period_end_date desc; Hash chain verifier rejects tampered audit entry; Filter query builder handles all combinations
- **Integration:** Scorecard endpoint enforces tenant scoping via RLS; Scorecard reads under concurrent writes maintain consistency; Report query stable cursor across concurrent insertions; Audit log append-only enforced at DB role level
- **E2E:** Complete period with feedback → scorecard updates within 60s; Apply filter → reload URL → state preserved; Export report CSV → file contains correct columns; no cross-tenant data; Audit log search with date range and actor filter
- **Manual UAT:** UAT: Firm admin reviews quarterly scorecard for 20 clients with feedback + signals
- **Security:** Cross-firm access blocked; Operator JWT cannot fetch scorecard (404 not 403 to prevent enumeration); CSV export whitelist excludes sensitive PII columns; Audit tamper attempt via direct SQL → blocked by trigger
- **Performance:** Scorecard with 5k periods renders < 2s with virtualized rows; 10k-period report renders < 3s with pagination; 100k-row export streams without OOM

**Rollback Plan:** N/A


---

## 6. Sequencing rationale

The sequencing follows a strict de-risk-first principle aligned with the spec's invariants.

Phase 0 (Backend Spine) is the only no-user-facing phase, mandated by the constraint allowance. It locks in the non-negotiable contracts — multi-tenant RLS, append-only audit, operator-cannot-read-financial-data, idempotency, JWT rotation, and ca-central-1 residency — before any UI ships. Every subsequent phase depends on these primitives; building them once correctly prevents cross-cutting refactors later.

Phases 1-3 (Platform Operator, web) come next because the operator provisions tenants — nothing else can exist without that capability. They are split into three phases by capability surface (lifecycle, billing/entitlements, observability/compliance) so each can ship and bake independently. Phase 1 unblocks tenant creation; the rest can follow in parallel work streams once Phase 1 lands.

Phases 4-6 (Firm Admin, web) follow because the firm-admin role configures the policy surface (thresholds, prompts, benchmarks, retention, integrations) that drives all downstream behavior in accountant and client apps. Phase 4 is the foundation (auth, branding, onboarding), Phase 5 is people/clients management (needed to assign work), and Phase 6 is the full policy surface (needed before accountants can produce signals and clients can receive prompts). Splitting firm admin into 3 phases keeps each scope independently testable.

Phases 7-9 (Accountant, web) ship the operational engine. Phase 7 is dashboard + client setup (enables work assignment), Phase 8 is the AI processing pipeline + state machine + filing (the heaviest single phase, justified by its tight transactional invariants and AI fallback complexity — splitting it would create unship­pable half-states around the FSM and Gate transitions), Phase 9 is flag inbox + bulk ops (depends on flags existing from Phase 8).

Phases 10-14 (Client mobile PWA) are deliberately broken into five phases per the explicit instruction to break client work down:
- Phase 10: Upload pipeline + PWA shell (the first client-facing surface; depends on accountant processing existing in Phase 8 to validate the aiLock boundary)
- Phase 11: Flag answering (depends on accountant raising flags in Phase 9)
- Phase 12: Dashboard, gates, archive, downloads (depends on flag flow because Gate 1 unlock is observable here)
- Phase 13: Feedback (depends on Gate 2 which exists once dashboard ships)
- Phase 14: Staff sub-role (separate user type per constraint #1; ships last because it overlays permission constraints onto all prior client surfaces)

Phase 15 (Firm scorecard) ships last on the firm side because it joins ratings (Phase 13) with operational signals (Phases 8+9). Shipping it earlier would produce empty dashboards.

Cross-cutting use cases (UC-X-*) and edge cases (UC-EDGE-*) are folded into the phase of the initiating user type — e.g., UC-X-02 (flag raise + answer) splits into Phase 9 (accountant raise side) and Phase 11 (client answer side). UC-EDGE-09 (tenant suspension) lives in Phase 1 where the operator initiates it but its enforcement is part of the spine (Phase 0). UC-EDGE-12 (PIPEDA deletion) is included in Phase 3 as part of compliance reports, with retention enforcement coming from Phase 0's audit invariants.

Each phase has explicit exit criteria, dual-track testing (unit → integration → e2e → manual UAT → security → performance, with a11y called out for UI phases), and a rollback plan implicit in the FSM-guarded state machine (no permanent deletes; soft state reversal). Total span: ~95 weeks of work across the phases, with several phases parallelizable after the operator console MVP lands in Phase 1.

---

## 7. Open decisions

Per `SPEC.md` §10 — must be resolved with the firm before Phase 0 starts:

1. **Client login model** — single login per client OR Owner + in-house Bookkeeper (`client_staff` sub-role)? *(Phase 14 conditional on enabling staff.)*
2. **Line-number sub-labels (105/108/109)** — client-visible OR accountant-only by default?
3. **Scorecard visibility to accountants** — can accountants see their own scorecard, or partners only? *(Affects Phase 15.)*
4. **Residency** — is `ca-central-1` contractually required per firm or a default?
5. **Multi-firm now vs later** — multi-tenant from day one (current assumption) OR single-firm first? *(Affects Phase 0 scope.)*
6. **Who initiates AI takeover** — accountant action, scheduled, or "all docs received" trigger? *(Sets where the document-lock boundary fires; affects Phase 8 + Phase 10.)*

---

## 8. Appendix

### 8.1 Use case ID prefixes

| Prefix | Slice |
|---|---|
| UC-OP | Platform Operator (web) |
| UC-FA | Firm Admin / Partner (web) |
| UC-AC | Accountant (web) |
| UC-CL-UP | Client Owner — uploads (mobile) |
| UC-CL-FL | Client Owner — flags (mobile) |
| UC-CL-DB | Client Owner — dashboard / export (mobile) |
| UC-CL-FB | Client Owner — feedback (mobile) |
| UC-CL-ST | Client Staff (mobile) |
| UC-X | Cross-user-type interactions |
| UC-EDGE | Edge cases & error recovery |

### 8.2 Invariant coverage

Every use case in §4 cites the INV-XXX-N codes it enforces or depends on. The full invariant catalogue lives in `SPEC.md` §4 (organised by category: TEN, AUTH, RBAC, GATE, FIN, DISP, DOC, CONF, FLAG, ATT, FB, SIG, EXP, ARCH, CFG, AUDIT, BILL).

Tests in each phase MUST include explicit invariant tests (`STANDARDS.md` §19.3 item 5).

### 8.3 Phase entry/exit protocol

Per `STANDARDS.md` §28:

**Entry (start of phase):**
1. Read `STANDARDS.md` end-to-end.
2. Read relevant PRD §4 use cases + §5 phase detail.
3. Read `PROGRESS.md`.
4. Confirm dependencies satisfied.
5. Update `PROGRESS.md` — move phase from NEXT to RUNNING.

**Exit (end of phase):**
1. All exit criteria met.
2. All 8 test obligations satisfied (`STANDARDS.md` §19.3).
3. Security review per `STANDARDS.md` §18.5.
4. PR template completed (`STANDARDS.md` §24).
5. Update `PROGRESS.md` — move phase from RUNNING to DONE; append changelog row.
6. Demo the phase to the user.
7. Get user sign-off before moving to next phase.

### 8.4 Where the documents live

- `PRD.md` — this file. What to build.
- `SPEC.md` — the invariants source (user-provided).
- `STANDARDS.md` — how to build it. Mandatory pre-read for every agent.
- `PROGRESS.md` — current state. Updated at every phase boundary.
- `docs/adr/NNNN-*.md` — architecture decision records (created as needed).
- `docs/runbooks/<incident>.md` — operational runbooks (created as needed).

### 8.5 Generation provenance

This PRD was generated 2026-06-01 by a 11-agent parallel workflow (10 use-case-expansion agents + 1 phase-synthesis agent). Each agent received the same invariant context and a structured JSON schema, ensuring uniformity. Raw output archived at `.build/prd-workflow-output.json`.

---

*End of PRD v1.0.*
