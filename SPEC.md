# ProBooks — Complete Platform Workflow & Invariants Specification
**Document type:** Engineering workflow + invariant specification
**Scope:** Multi-firm SaaS bookkeeping/HST portal (Canadian accounting context — CRA, HST, T2)
**Source of truth:** `IT-NOTE-bookkeeping-portal.md` (behaviour rules) + this document (operational workflow, invariants, SaaS architecture)
**Status:** Specification — for build planning

---

## 0. How to read this document
This specification has three interlocking parts:
1. **Operational workflow in phases** (§3) — the life of a filing period from tenant provisioning through filing and feedback, phase by phase, with the actors, triggers, state transitions, and the invariants that hold *at each phase*.
2. **Invariants** (§4) — the rules that must hold at all times, organised by category and by user type. These are the contract the build must never violate. They are numbered so they can be referenced from tickets, tests, and code review.
3. **Cross-cutting platform concerns** (§5–§8) — multi-tenancy, security, scalability, flexibility — the "make it SaaS" layer.

A **delivery roadmap** (§9) closes the document, sequencing the build into shippable phases.

> **Terminology note.** "Phase" is used in two senses, kept deliberately distinct: **operational phases** (the runtime lifecycle of a period — §3) and **delivery phases** (the build/release sequence — §9). They are not the same thing.

---

## 1. User types (actors)

The platform is multi-firm SaaS. There are **four** distinct principal types, spanning **three applications** on **one shared backend**.

| # | User type | Application | Trust zone | Core responsibility |
|---|-----------|-------------|------------|---------------------|
| 1 | **Platform Operator** (Nugen internal) | Platform Admin Console | Internal / privileged | Provision firms (tenants), manage subscriptions/billing, global config, platform health. Never touches a firm's financial data. |
| 2 | **Firm Admin / Partner** | Firm Workspace (elevated role) | Firm-internal | Configure the firm: accountants, auto-prompt thresholds, prompt copy/cap, per-client opt-ins, benchmarks, scorecard access. |
| 3 | **Accountant** (firm staff) | Firm Workspace (operational role) | Firm-internal | Per-client operational work: period config, processing, raising/answering flags, marking complete, uploading filed PDFs. |
| 4 | **Client** (business owner; optionally an in-house bookkeeper) | Client Portal (mobile PWA) | External / untrusted | Upload documents, answer flags, view current quarter, download Excel, read P&L/archive, submit quarterly feedback. |

**Application mapping**
- **App A — Platform Admin Console** (Operator only). Tenant lifecycle, billing, global flags, observability.
- **App B — Firm Workspace** (Firm Admin + Accountant, separated by RBAC roles inside one app). Desktop-first, dense operational tooling, all-day use.
- **App C — Client Portal** (Client). Mobile-first PWA, calm/glanceable, low-frequency (once per filing period).
- **Shared backend** (NestJS) + **AI document pipeline service** (headless; no user type of its own).

> **Client sub-roles (assumption to confirm):** a single client business may have more than one login — e.g. an *Owner* and an in-house *Bookkeeper*. The portal therefore carries a light two-role model (`client_owner`, `client_staff`). Attestations and feedback are attributable to the specific login, which matters for the §10.3 liability artifact. If the firm confirms one-login-per-client, `client_staff` is simply unused.

---

## 2. Tenancy & data model spine (SaaS foundation)

The isolation hierarchy is the backbone every invariant and flow hangs from:

```
Platform
  └── Tenant (= Firm)               ← isolation boundary; all firm data scoped here
        ├── Firm Users (admins, accountants)
        ├── Client (a business serviced by the firm)
        │     ├── Client Users (owner, staff)
        │     ├── Engagement config (filing frequency, period scheme, checklist template, opt-ins)
        │     └── Period (the unit of work — quarterly/monthly/annual)
        │           ├── Documents (uploaded; typed; counted)
        │           ├── Extractions (AI output + per-line confidence)   ← may live in document store
        │           ├── Ledger lines (net-of-HST figures)
        │           ├── Flags (system/accountant; answer-typed)
        │           ├── Attestations (e.g. "Not found" receipt)
        │           ├── HST summary (105/108/109 → net tax → payable/refund)
        │           ├── Period status (lifecycle state — see §3)
        │           ├── Excel workbook (gated artifact)
        │           ├── Filed-return PDFs (HST + T2; accountant-uploaded)
        │           ├── Feedback submission (ratings + auto-prompt answers + linked signals)
        │           └── Operational signals (turnaround, lag, confidence %, corrections, re-uploads)
        └── Firm settings (thresholds, prompt copy/cap, benchmarks, feature flags)
```

**Every** persisted row carries a `tenant_id` (firm) and, where applicable, a `client_id`. This is the spine for the isolation invariants in §4.1.

---

## 3. Operational workflow — phase by phase

Each phase below lists: **trigger**, **actor(s)**, **what happens**, **state transition**, and **phase-local invariants** (full invariant catalogue in §4).

### Phase 0 — Platform & Tenant Provisioning
- **Trigger:** Nugen sells/onboards a new accounting firm.
- **Actor:** Platform Operator.
- **What happens:** Operator provisions a new **Tenant (Firm)**: creates the tenant record, subscription/plan, region pin (`ca-central-1`), and the **first Firm Admin invite**. The Operator never sets the firm admin's password — an invite/SSO flow lets the firm admin establish their own credentials.
- **State transition:** `tenant: none → provisioned → active`.
- **Phase invariants:** INV-TEN-1, INV-TEN-2, INV-AUTH-1, INV-AUTH-4, INV-BILL-1.

### Phase 1 — Firm Onboarding & Configuration
- **Trigger:** Firm Admin accepts invite and signs in.
- **Actor:** Firm Admin / Partner.
- **What happens:**
  - Invites accountants (firm staff), assigns roles.
  - Sets **firm-level settings**: auto-prompt **thresholds** per signal, the **extra-prompt cap** (default 2), **prompt copy** (soft tone), **benchmarks**, and the **line-number sub-label toggle** (§5 of the IT note) default for the firm.
  - Configures defaults for client opt-in to auto-prompts.
- **State transition:** `firm: active → configured` (firm can operate even with default settings; "configured" is informational).
- **Phase invariants:** INV-CFG-1..4, INV-AUTH-2, INV-RBAC-1, INV-FB-7.

### Phase 2 — Client Onboarding & Engagement Setup
- **Trigger:** Firm takes on a client / starts an engagement.
- **Actor:** Accountant (and/or Firm Admin).
- **What happens:**
  - Creates the **Client** record and invites the client user(s) (client sets own password — never provisioned by the firm).
  - Sets the **filing frequency & period scheme** (e.g. quarterly Jan–Mar). The client never selects this (§4 of IT note).
  - Defines the **document checklist template** for this client (§9.2) — the expected document types specific to that business.
  - Sets per-client **opt-in to auto-prompts** and any client-specific threshold overrides allowed by firm policy.
- **State transition:** `client: created → engaged`. First **Period** is derived by the system from the period scheme.
- **Phase invariants:** INV-PER-1, INV-CFG-5, INV-DOC-1, INV-AUTH-3, INV-FB-7.

### Phase 3 — Period Opening
- **Trigger:** System derives the current due period from the engagement's period scheme (calendar-driven).
- **Actor:** System (automatic); surfaced to Client.
- **What happens:** The app presents, for the one open period only: the **guided upload checklist** (progress "X of N") and the **flags list** (initially may be empty until extraction). Home tiles mirror the upload count and the open-flag count. The current-quarter card ("Where this quarter stands") renders in **Locked** state (heading + "Available once your flags are cleared." — no numbers).
- **State transition:** `period: derived → open`.
- **Phase invariants:** INV-PER-1, INV-PER-2, INV-GATE-1, INV-DISP-1, INV-DISP-3.

### Phase 4 — Document Collection
- **Trigger:** Period open; client opens "Upload documents."
- **Actor:** Client.
- **What happens:** Client fulfils the checklist — typed slots show green check + count + "received"; outstanding show amber "still needed." A **catch-all drop zone** accepts anything unclassified. Files are **deletable** by the client; banner reads "you can still add or remove files until we start." Home upload tile mirrors the count.
- **State transition:** stays `period: open`; `documents: collecting`.
- **Phase invariants:** INV-DOC-2, INV-DOC-3, INV-DOC-5, INV-DISP-2.

### Phase 5 — AI Takeover & Extraction
- **Trigger:** Processing kicks off (firm-initiated or scheduled handoff) → the prototype's `aiLocked` state.
- **Actor:** AI pipeline service (system); boundary set by firm/accountant policy.
- **What happens:**
  - **Delete lock engages:** all client delete options disappear; banner switches to "Processing started — files are now locked." (§9.3 handoff boundary.)
  - Documents are OCR'd/extracted (Claude API + Textract fallback). Each extracted line gets a **confidence score**. Figures are computed **net of HST**.
  - **Flags are generated:** low-confidence/ambiguous items become **yellow system flags**. (Accountant may later add **red** flags — Phase 6.)
  - Operational signals begin recording (turnaround clock starts at docs-in).
- **State transition:** `period: open → processing`; `documents: locked`.
- **Phase invariants:** INV-DOC-4, INV-FLAG-1, INV-FLAG-2, INV-FIN-1, INV-CONF-1, INV-SIG-1.

### Phase 6 — Flag Resolution
- **Trigger:** Flags exist (system-generated and/or accountant-raised).
- **Actors:** Client (answers); Accountant (raises red flags, replies to questions, can answer on client's behalf via "Let my accountant choose").
- **What happens:**
  - **Three answer types:** *Category* (fixed list + "Let my accountant choose" escape hatch), *Explain* (freeform), *Receipt* (upload **or** "Not found"). A receipt flag may also require a category.
  - **"Not found" attestation:** transaction is still recorded on the client's explicit, **timestamped, attributed** instruction (§10.3 liability artifact). Never silently dropped.
  - **Receipt double-write:** a receipt uploaded from a flag attaches to the transaction **and** increments the upload checklist's document count (§10.4).
  - **Source-document preview:** each flag shows a blurred/cropped thumbnail adapting to type (receipt / statement-with-row-highlighted / invoice); tap opens full lightbox.
  - Answered flags collapse to green "cleared" with a "Change" reopen option. Open count drops; home tile mirrors it.
  - **Flag reply lag** (accountant side) is recorded as an operational signal.
- **State transition:** flags `open → answered → cleared`; period stays `processing` until count hits zero.
- **Gate event:** when **open-flag count = 0**, the §1 window-3 gate is *eligible* to unlock (still requires processing complete — see Phase 7).
- **Phase invariants:** INV-FLAG-3..8, INV-ATT-1..3, INV-DOC-6, INV-SIG-2, INV-GATE-2.

### Phase 7 — Processing Complete (numbers unlock)
- **Trigger:** All flags cleared **and** accountant/system finishes processing the period.
- **Actor:** Accountant (processing) + System (computes HST summary).
- **What happens:** The current-quarter card transitions to show **on-screen AI-calculated numbers** (HST summary: sales by status, line 105 collected, line 108 ITCs, line 109 net tax → payable/refund headline). Tagged **"Draft — not yet filed,"** outcome described as *estimated*. These are working-draft figures.
- **State transition:** `period: processing → processed`. Card: `Locked/Pending → Processed`.
- **Critical sequencing:** clearing flags alone moves card to **Pending** ("Pending — with your accountant. Numbers appear once processed."), **not** to numbers. Numbers require **both** (flags cleared) **and** (processed).
- **Phase invariants:** INV-GATE-3..5, INV-DISP-4, INV-DISP-5, INV-FIN-2..5, INV-CONF-2.

### Phase 8 — Accountant Sign-off (Excel + feedback unlock) — the second gate
- **Trigger:** Accountant **explicitly marks the period "complete / ready for printout."** This is a **separate manual switch** from "processed."
- **Actor:** Accountant.
- **What happens:**
  - **Excel download unlocks** for the current period (period-scoped: monthly/quarterly/yearly per the client's filing frequency + annual roll-up; no custom range, no date picker).
  - The **quarterly feedback prompt** is surfaced (once per period). Feedback tile flips to "your [period] review is ready."
  - Until this switch, Excel shows the locked state: "Excel not ready yet — these are AI-calculated figures…"; no file downloadable.
- **State transition:** `period: processed → complete`.
- **Phase invariants:** INV-GATE-6..8, INV-EXP-1..5, INV-FB-1.

### Phase 9 — Feedback Capture
- **Trigger:** Period marked complete (Phase 8). Once per filing period.
- **Actor:** Client (rates); System (computes which auto-prompts to append).
- **What happens:**
  - **Three base ratings** (1–5): Quality of work, Service & communication, the ProBooks app. Plus optional freeform "anything else?".
  - **Auto-prompt engine:** system reads the period's operational signals; each that crosses its firm-set threshold appends one **soft, non-accusatory** prompt **bound to that signal**. **Capped at 2** extra prompts (configurable); if 3 cross, the two highest-priority surface. If none cross, only the three base ratings show.
  - Submission stores ratings **plus** the triggering signal + its value (the linkage that powers the scorecard). Submit gated on all three base ratings; extra prompts optional.
- **State transition:** `feedback: pending → submitted` (for the period). Period itself unaffected.
- **Phase invariants:** INV-FB-2..9, INV-SIG-3, INV-SIG-4.

### Phase 10 — Filing & Archive
- **Trigger:** Accountant files the return with CRA (outside the app) and records it.
- **Actor:** Accountant.
- **What happens:**
  - Period transitions to **"Last quarter, filed,"** now showing **actual filed figures** tagged with filing date; outcome described as *remitted to CRA* / *refunded by CRA* (not estimated).
  - Accountant uploads the **filed-return PDF(s)** (HST and/or T2) into the **archive** (HST and T2 grouped separately). These are copies of what was actually filed — not app-generated.
  - Period's Excel becomes **always-downloadable** (complete by definition). Front-face shows label + status only (no numbers); numbers live on the detail page.
- **State transition:** `period: complete → filed → archived`. A new period is derived (back to Phase 3).
- **Phase invariants:** INV-FIN-6..8, INV-EXP-6, INV-EXP-7, INV-ARCH-1..3, INV-DISP-6.

### Phase 11 — Firm-side Scorecard & Analytics (separate build)
- **Trigger:** Feedback submitted + operational signals recorded across periods.
- **Actor:** Firm Admin / Partner (read); System (joins streams).
- **What happens:** The firm-side scorecard joins **objective signals** (turnaround, flag lag, confidence %, corrections, re-uploads — recorded silently, never shown to client) with the client's **subjective ratings**, per accountant / per client / per period. Surfaces the valuable mismatches (slow-but-high-rating = good comms; fast-but-low-rating = inspect the file).
- **State transition:** none (analytics layer).
- **Phase invariants:** INV-SIG-5, INV-SIG-6, INV-RBAC-2, INV-TEN-3.

### End-to-end gate chain (the spine of every flow)

```
Phase 3   period open  ── client uploads + answers flags
Phase 5   AI takeover  ── docs LOCKED, extraction, system flags raised
Phase 6   flags → 0    ── (eligible, not sufficient)
Phase 7   processed    ── on-screen DRAFT numbers visible        [GATE 1 fully open]
Phase 8   marked complete ── Excel unlocks + feedback prompt     [GATE 2 — separate manual switch]
Phase 9   feedback     ── ratings + threshold-crossed auto-prompts
Phase 10  filed        ── actual figures; moves to "last quarter" + archive
```

---

## 4. Invariants

Invariants are rules that must hold **at all times**, regardless of how the system is reached. They are the contract enforced in code (NestJS guards/service transitions), at the database (constraints, RLS), and verified in tests. Each is numbered for reference from tickets and test names.

> **Enforcement legend:** `[DB]` enforce at database level · `[SVC]` enforce in service/domain layer · `[GUARD]` enforce in request guard/interceptor · `[UI]` enforce in UI (never the *only* layer for anything security- or money-relevant) · `[JOB]` enforce in pipeline/worker.

### 4.1 Tenancy & isolation — `INV-TEN`
- **INV-TEN-1** `[DB][SVC]` Every persisted row belongs to exactly one tenant (firm). No query may return rows across tenant boundaries. (Postgres row-level security as the hard backstop; tenant scope injected in every repository call.)
- **INV-TEN-2** `[GUARD]` A firm user can only ever access data within their own tenant. A client user can only access data within their own client, within their tenant. Cross-tenant and cross-client access is impossible, not merely hidden.
- **INV-TEN-3** `[SVC]` The Platform Operator can manage tenant lifecycle and billing metadata but **cannot read a tenant's financial data** (documents, ledger, HST figures, ratings). Operator access is structurally separated from firm data.
- **INV-TEN-4** `[DB]` Deleting/suspending a tenant never cascades into another tenant's data; tenant data is logically partitioned by `tenant_id`.
- **INV-TEN-5** `[JOB]` Background jobs (extraction, Excel gen, signal computation) always execute within a single tenant+client+period context and never mix data across them.

### 4.2 Identity, auth & account creation — `INV-AUTH`
- **INV-AUTH-1** `[SVC]` The application never creates user accounts or sets passwords on a user's behalf. Invited users (firm or client) establish their own credentials via invite/SSO/passwordless flows.
- **INV-AUTH-2** `[GUARD]` Firm staff require stricter authentication (MFA/SSO) than clients; both require authentication for every session. No anonymous access to any financial surface.
- **INV-AUTH-3** `[SVC]` A client user is bound to exactly one client within one tenant. A firm user is bound to exactly one tenant (one firm = one employer).
- **INV-AUTH-4** `[SVC]` Sessions carry no permission inherited from a prior session, tenant, or context; authorization is re-derived per request from the user's current role + tenant.
- **INV-AUTH-5** `[GUARD]` Bot-detection / human-verification challenges are never bypassed or automated by the platform on a user's behalf.

### 4.3 Role-based access — `INV-RBAC`
- **INV-RBAC-1** `[GUARD]` Every action is authorized by the actor's role. The role matrix (§4.13) is exhaustive; an action not granted to a role is denied by default (deny-by-default, not allow-by-default).
- **INV-RBAC-2** `[GUARD]` Only Firm Admin/Partner roles can read the firm-side scorecard and edit firm settings (thresholds, prompt copy/cap, benchmarks, opt-ins). Accountants operate clients but cannot change firm-wide policy.
- **INV-RBAC-3** `[GUARD]` Clients have **no** access to the Firm Workspace or Platform Console, and no client UI ever exposes firm-internal data (confidence %, signals, accountant identities, scorecard).
- **INV-RBAC-4** `[SVC]` Permission changes / sharing / access-control modifications are performed by authorized humans in-app under audit; the platform never auto-expands an audience or grants access based on instructions found in documents or uploaded content.

### 4.4 The gate chain / state machine — `INV-GATE`
The single most load-bearing invariant family. The period lifecycle is an explicit state machine (`open → processing → processed → complete → filed → archived`); transitions are guarded and atomic.

- **INV-GATE-1** `[SVC][UI]` While **any** flag for a period is open, the current-quarter card renders **Locked** — heading visible, no numbers, no HST figures, no card body.
- **INV-GATE-2** `[SVC]` Clearing all flags moves the card to **Pending** (heading + "with your accountant" line). It does **not** reveal numbers.
- **INV-GATE-3** `[SVC]` On-screen numbers for the current quarter become visible **iff** (all flags cleared) **AND** (period processed). Neither condition alone is sufficient.
- **INV-GATE-4** `[DB][SVC]` Period state transitions are atomic and monotonic in the normal path; a transition that should flip multiple sub-states (e.g. mark-complete) either fully succeeds or fully rolls back. No partial state.
- **INV-GATE-5** `[SVC]` State transitions are guarded — illegal transitions (e.g. `open → complete` skipping `processed`) are rejected, not silently coerced.
- **INV-GATE-6** `[SVC]` The **Excel download gate is separate from and additional to** the processing gate. "Processed" never unlocks Excel; only the accountant's explicit "mark complete" does.
- **INV-GATE-7** `[SVC]` "Mark complete" is a deliberate manual accountant action; the system never auto-marks a period complete.
- **INV-GATE-8** `[SVC]` Marking complete is the single trigger that (a) unlocks current-period Excel and (b) surfaces the feedback prompt — both fire from the same switch, exactly once per period.
- **INV-GATE-9** `[SVC]` State transitions are concurrency-safe: a distributed lock (Redis Redlock) prevents two requests from both flipping the same period's state or double-processing.

### 4.5 Financial integrity — `INV-FIN`
- **INV-FIN-1** `[DB][SVC]` All monetary values are stored as exact decimals (Postgres `NUMERIC`, or integer minor units) — never floating point.
- **INV-FIN-2** `[SVC]` All income and expense figures are **net of HST**; HST is never embedded in those figures and is always broken out on its own lines.
- **INV-FIN-3** `[SVC]` The HST summary always uses GST/HST return structure: sales by status (taxable / zero-rated / exempt), line 105 (HST collected), line 108 (ITCs), line 109 (net tax) → payable or refund.
- **INV-FIN-4** `[SVC]` Net tax (line 109) is derived (105 − 108) and resolves deterministically to **payable** (positive) or **refund** (negative); the outcome is the headline figure.
- **INV-FIN-5** `[SVC]` Current-quarter figures are tagged **Draft / estimated**; the outcome is described as due/refundable *on filing*, never as remitted/refunded.
- **INV-FIN-6** `[SVC]` Once filed, a period shows **actual filed figures** tagged with the filing date; outcome described as remitted to / refunded by CRA. Filed figures are immutable.
- **INV-FIN-7** `[SVC]` Sales-by-status shows all three lines on the detail page even when zero (it reflects the return structure). The compact current-quarter card may show total sales net of HST only.
- **INV-FIN-8** `[SVC]` Period figures are reproducible from their underlying ledger lines + extractions; totals are never stored as the sole source of a number that can't be re-derived.

### 4.6 Display rules — `INV-DISP`
- **INV-DISP-1** `[UI]` The "Where this quarter stands" heading is visible in all three states (Locked/Pending/Processed); the section never disappears entirely.
- **INV-DISP-2** `[UI]` Home-screen tiles mirror live counts (open-flag count, "X of N documents in") without requiring the client to open the underlying page.
- **INV-DISP-3** `[UI]` Numbers appear on a **front face** only for the **current quarter**. No sales/expense/HST amount for any other period renders on the home screen.
- **INV-DISP-4** `[UI]` "Done" tiles (filed/historical) show **label + status only** (e.g. "Oct–Dec 2024 · filed Jan 28"); all figures live one level deeper on the detail screen.
- **INV-DISP-5** `[UI]` The current quarter is the only place a figure appears without a tap.
- **INV-DISP-6** `[UI]` Confidence percentages are **never** shown to the client anywhere in the portal (this is why the flag colour model and the confidence colour model can coexist — see INV-FLAG-7).

### 4.7 Document lifecycle — `INV-DOC`
- **INV-DOC-1** `[SVC]` The upload checklist (expected document types) is defined **per client at setup** by the firm. The client never edits the list; they only fulfil it.
- **INV-DOC-2** `[UI]` The upload page **is** the guided checklist — never a blank drop zone. A catch-all drop zone is always present so a client is never blocked by an unclassifiable file.
- **INV-DOC-3** `[SVC]` Files are deletable by the client **only until AI processing begins**. Before takeover: delete available + "you can still add or remove files" banner.
- **INV-DOC-4** `[SVC][JOB]` Once processing starts (`aiLocked`), **all** client delete options are removed and files are immutable to the client; banner switches to "Processing started — files are now locked." This boundary is one-way.
- **INV-DOC-5** `[SVC]` Document submission is never deleted permanently by the platform on the client's casual action; the delete-before-lock action is the only client-side removal, and even then is audited.
- **INV-DOC-6** `[SVC]` A receipt uploaded from a flag writes to **two** places atomically: the specific transaction record **and** the upload checklist's document count for the matching type (double-write — one upload, counted in both).

### 4.8 Confidence model — `INV-CONF`
- **INV-CONF-1** `[JOB][SVC]` Every AI-extracted line carries a confidence score; the score is data, persisted, and queryable (it feeds both the colour model used firm-side and the "low-confidence line items %" signal).
- **INV-CONF-2** `[SVC]` The confidence threshold (default 97.5%) that separates "high" from "low" is configuration, not a hardcoded constant.

### 4.9 Flags — `INV-FLAG`
- **INV-FLAG-1** `[JOB]` System flags (yellow) are AI-generated for low-confidence/ambiguous items. Accountant flags (red) are human-raised. Every flag records its source.
- **INV-FLAG-2** `[SVC]` Flag colour on the flags screen encodes **source/stakes** (yellow = system, red = accountant), **not** confidence. This is intentionally different from the confidence-based colour model elsewhere and must not be "normalised." (They never collide because confidence % is never shown to the client — INV-DISP-6.)
- **INV-FLAG-3** `[SVC]` Flags support exactly three answer types: **Category** (fixed list + "Let my accountant choose" escape hatch), **Explain** (freeform), **Receipt** (upload or "Not found"). A Receipt flag may additionally require a Category; the build asks for category only when not already known.
- **INV-FLAG-4** `[SVC]` "Let my accountant choose" is always available on a Category flag — the client can always defer rather than guess.
- **INV-FLAG-5** `[SVC]` Answered flags collapse to a green "cleared" state showing the answer, always with a "Change" option to reopen.
- **INV-FLAG-6** `[SVC]` The open-flag count drops as flags are answered and is mirrored on the home tile in real time. At zero, an "all clear" confirmation shows and the §1 gate becomes eligible.
- **INV-FLAG-7** `[UI]` Each flag shows a source-document preview adapting to type: receipt flags → receipt; bank/credit-card flags → statement **with the transaction's row highlighted**; invoice flags → invoice. Preview is a blurred/cropped thumbnail with a type tag; tap opens full lightbox over the flags page, dismiss returns the client to the same spot.
- **INV-FLAG-8** `[SVC]` Reopening a cleared flag (via "Change") re-increments the open count and re-locks any gate that depended on zero open flags, consistently.

### 4.10 Attestations (liability artifacts) — `INV-ATT`
- **INV-ATT-1** `[DB][SVC]` When a client taps "Not found" on a receipt flag, the transaction is **still recorded** on the client's explicit instruction — never silently dropped.
- **INV-ATT-2** `[DB]` The attestation is captured as an immutable, append-only record: client identity + timestamp + the instruction ("record it anyway, no receipt") + the transaction reference. Write-once; never updated or deleted.
- **INV-ATT-3** `[SVC]` The transaction is marked `client-instructed-without-receipt` so it is distinguishable in any future CRA audit; the no-documentation decision is attributed to the client's documented say-so, not a firm guess.

### 4.11 Feedback engine — `INV-FB`
- **INV-FB-1** `[SVC]` The feedback prompt is surfaced **once per filing period**, triggered by the same "mark complete" switch that unlocks Excel.
- **INV-FB-2** `[UI]` The client always sees exactly **three base ratings** (Quality, Service & communication, the app) on a 1–5 scale, plus an optional freeform box. No raw operational numbers, turnaround days, or accountant names are ever shown.
- **INV-FB-3** `[SVC]` Submission is gated on all three base ratings being given; auto-prompts are optional.
- **INV-FB-4** `[SVC]` Auto-prompts are appended **only** when a period's operational signal crosses its firm-set threshold. If none cross, only the three base ratings show — no nagging.
- **INV-FB-5** `[SVC]` Auto-prompts are **capped** (default 2, configurable). If more signals cross than the cap, only the highest-priority surface; the rest are held back.
- **INV-FB-6** `[UI]` Auto-prompt copy is **soft and never accusatory** — it rates the client's *experience of the service*, never grades an employee, and never names staff or exposes raw metrics.
- **INV-FB-7** `[DB][SVC]` Firm settings govern the engine: per-signal thresholds, the cap, prompt copy, and per-client opt-in. None are hardcoded; thresholds derive from firm benchmarks.
- **INV-FB-8** `[DB]` Each submitted auto-prompt rating is stored **with its triggering signal and that signal's value** — the linkage that makes the scorecard meaningful.
- **INV-FB-9** `[SVC]` The feedback engine is not a complaint box; it is a quarterly low-effort rating + early-warning signal. A client never grades staff directly.

### 4.12 Operational signals & scorecard — `INV-SIG`
- **INV-SIG-1** `[JOB]` Operational signals (turnaround docs-in→complete, worst flag reply lag, low-confidence %, corrections after first pass, client re-uploads) are recorded **silently** throughout the period.
- **INV-SIG-2** `[JOB]` The turnaround clock starts at docs-in and stops at "mark complete"; flag reply lag measures the accountant's response time.
- **INV-SIG-3** `[SVC]` Signals are **never displayed to the client** in any form.
- **INV-SIG-4** `[SVC]` The objective signal stream and the subjective rating stream are kept **separate**; they are joined only on the firm side. The client is never the instrument that grades staff.
- **INV-SIG-5** `[GUARD]` The scorecard (objective × subjective, per accountant/client/period) is visible only to Firm Admin/Partner roles.
- **INV-SIG-6** `[SVC]` Threshold definitions for "slow," "too many low-confidence," etc. are firm settings, configurable, never hardcoded.

### 4.13 Export, archive & period scope — `INV-EXP` / `INV-ARCH`
- **INV-EXP-1** `[SVC]` Current-period Excel is locked until accountant sign-off (INV-GATE-6); locked state shows the explanatory message and no downloadable file exists in that state.
- **INV-EXP-2** `[SVC]` Filed/closed periods' Excel is **always** downloadable (complete by definition). The sign-off gate applies only to the in-progress period.
- **INV-EXP-3** `[SVC]` Download scope is **period-scoped only**: monthly, quarterly, yearly. **No date picker, no custom range.**
- **INV-EXP-4** `[SVC]` The client sees only scopes matching their own filing frequency, **plus** a year-end annual roll-up. (Quarterly filer → quarters + annual; monthly filer → months + annual. Monthly never shown to a quarterly filer.)
- **INV-EXP-5** `[UI]` The Excel control appears in three places consistently gated: home "Download Excel" section, current-quarter detail (below HST summary), filed-quarter detail (always available, alongside "Download filed HST return").
- **INV-EXP-6** `[SVC]` Excel working files (download section) and filed-return PDFs (archive) are **distinct** and never conflated.
- **INV-EXP-7** `[SVC]` Files are served via signed, expiring URLs; no document identifier or client data ever appears in a query string.
- **INV-ARCH-1** `[SVC]` The filed-returns archive holds **accountant-uploaded PDF copies** of what was actually filed — never app-generated.
- **INV-ARCH-2** `[SVC]` Archive groups HST returns (per filing frequency) and corporate T2 returns (annual) **separately**.
- **INV-ARCH-3** `[SVC]` Filed returns are retained per CRA retention rules; archived records are immutable.

### 4.14 Configuration / flexibility — `INV-CFG`
- **INV-CFG-1** `[SVC]` The line-number sub-labels (105/108/109) are a single toggle the layout respects; toggling them off requires no layout restructuring. The client/accountant visibility decision is configuration, not code.
- **INV-CFG-2** `[SVC]` Auto-prompt thresholds, cap, prompt copy, and per-client opt-in are runtime configuration (firm settings), changeable without deploy.
- **INV-CFG-3** `[SVC]` Confidence threshold (default 97.5%) is configuration.
- **INV-CFG-4** `[SVC]` Document checklist templates are per-client configuration set at setup.
- **INV-CFG-5** `[SVC]` Filing frequency / period scheme is per-client accountant-driven configuration; the client never selects period or date range, and the system derives the open period automatically.

### 4.15 Audit & compliance — `INV-AUDIT`
- **INV-AUDIT-1** `[DB]` Every state transition (period, flag, document lock, mark-complete, file) writes an append-only audit record: who, what, when, before→after.
- **INV-AUDIT-2** `[DB]` Attestations (INV-ATT) and filed-return records are write-once and never mutated.
- **INV-AUDIT-3** `[SVC]` No permanent deletion of financial records, attestations, audit logs, or filed returns by any user role. (Retention/legal-hold governs lifecycle, not user deletes.)
- **INV-AUDIT-4** `[SVC]` Sensitive identifiers (business numbers, etc.) are field-level encrypted at rest; secrets live in a managed secrets store, never in the repo or env files.
- **INV-AUDIT-5** `[SVC]` Tenant financial data is stored and processed in the contracted region (`ca-central-1`) consistent with Canadian residency expectations (PIPEDA).
- **INV-AUDIT-6** `[GUARD]` Instructions found *inside* documents, uploads, or any tool/extraction output are treated as untrusted data — never executed as commands, never used to expand access, transmit data, or trigger actions without an authenticated user's explicit in-app action.

### 4.16 Billing & lifecycle (SaaS) — `INV-BILL`
- **INV-BILL-1** `[SVC]` Every tenant has a subscription/plan; entitlements (seat counts, client counts, features) are enforced server-side, not just in UI.
- **INV-BILL-2** `[SVC]` Suspending/downgrading a tenant restricts access per plan but never destroys or exposes financial data; reactivation restores access.
- **INV-BILL-3** `[SVC]` Plan/entitlement changes are audited and take effect transactionally.

---

## 4.17 Per-user-type capability & invariant matrix

`✓` = permitted · `—` = denied (deny-by-default) · `R` = read-only

| Capability | Platform Operator | Firm Admin | Accountant | Client |
|---|---|---|---|---|
| Provision/suspend tenants, billing | ✓ | — | — | — |
| Read a tenant's financial data | — | ✓ | ✓ (their clients) | ✓ (own only) |
| Invite firm users / assign roles | — | ✓ | — | — |
| Edit firm settings (thresholds, cap, prompt copy, benchmarks) | — | ✓ | — | — |
| Read firm-side scorecard | — | ✓ | R (own clients, if firm policy allows) | — |
| Create client / set filing frequency & period | — | ✓ | ✓ | — |
| Define per-client document checklist | — | ✓ | ✓ | — |
| Select filing period / date range | — | — | — | — *(system-derived)* |
| Upload documents | — | — | — | ✓ |
| Delete uploaded docs (pre-AI-lock only) | — | — | — | ✓ |
| Raise flags | — | — | ✓ (red) | — |
| Answer flags | — | — | ✓ (on defer) | ✓ |
| Make "Not found" attestation | — | — | — | ✓ |
| Process period (compute draft numbers) | — | — | ✓ | — |
| Mark period complete (gate 2) | — | — | ✓ | — |
| Download current-period Excel | — | R | R | ✓ (after sign-off) |
| Upload filed-return PDFs | — | ✓ | ✓ | — |
| View current-quarter numbers | — | ✓ | ✓ | ✓ (after gate) |
| View confidence % / operational signals | — | ✓ | ✓ | — |
| Submit quarterly feedback | — | — | — | ✓ |
| Set/change any permission or sharing | governed, audited | governed, audited | — | — |
| Permanently delete financial records | — | — | — | — |

> The relevant invariants enforce each row (e.g. "select filing period = —" ↔ INV-CFG-5; "view confidence % — for client" ↔ INV-DISP-6; "scorecard" ↔ INV-RBAC-2/INV-SIG-5).

---

## 5. Scalability (multi-firm SaaS)

The platform must scale across firms, clients, and the document/AI workload independently.

- **Stateless application tier.** App B (Firm Workspace) and App C (Client Portal) backends are stateless NestJS services behind a load balancer (ECS Fargate, autoscaled on CPU/queue depth). Horizontal scale-out is the default lever.
- **Tenant-partitioned data.** All data carries `tenant_id`; this enables, in order of need: (1) shared Postgres with row-level security for most tenants, (2) read replicas for reporting load, (3) per-tenant schema or DB sharding for large firms if a single tenant outgrows the shared instance. Design for (1), keep the door open to (3).
- **Workload isolation.** The AI document pipeline is a **separate worker fleet** (BullMQ on Redis) scaled independently of the request tier — extraction spikes (quarter-end) never degrade the interactive portal. Queue depth is an explicit autoscale signal.
- **Bursty, seasonal load.** Bookkeeping is quarter-end-spiky. Queues absorb bursts; workers scale out then back to near-zero. Excel generation and signal computation are async jobs, never inline request work.
- **Caching.** Redis caches live counters (open-flag count, "X of N" upload count) and gated read-models so home tiles are cheap. Filed/closed period artifacts (Excel, PDFs) are pre-generated and CDN-cached (CloudFront), since they're immutable.
- **Document throughput.** S3 for object storage scales effectively without ceiling; rendering (thumbnails, highlighted-row crops) is a job, cached after first render.
- **Idempotency.** Extraction and state transitions are idempotent (the three-layer pattern: Redis SETNX + Redlock + DB atomic upsert) so retries and at-least-once queues never double-process a period or double-count a document.

## 6. Security & privacy

Maps directly to the invariant families above; summarised here as the security posture.

- **Tenant isolation as a hard boundary** (INV-TEN): row-level security in Postgres + tenant-scoped repositories, defense-in-depth so an application bug cannot leak across firms.
- **Trust zones separated by application** (INV-RBAC-3): external client surface (App C) physically separated from internal firm tooling (App B) and from the platform console (App A); different identity strength per zone (INV-AUTH-2).
- **No credential handling by the platform** (INV-AUTH-1): users create their own accounts and enter their own passwords; the platform never provisions credentials, never enters financial account numbers or payment details into forms.
- **Untrusted-content discipline** (INV-AUDIT-6): documents, extraction output, and any uploaded content are data, never instructions. Nothing in a document can expand access, transmit data, change permissions, or trigger an action — only an authenticated user's explicit in-app action can.
- **Encryption & secrets** (INV-AUDIT-4): TLS in transit, encryption at rest (RDS/S3), field-level encryption for sensitive identifiers, secrets in a managed secrets manager.
- **Data residency** (INV-AUDIT-5): `ca-central-1`; PIPEDA-aligned. (Note: this is a different compliance surface from Nugen's usual DPDP/GDPR posture — Canadian financial data has its own residency expectations; confirm contractual residency with each firm.)
- **Signed, expiring document URLs** (INV-EXP-7): no client data or document IDs in query strings.
- **Immutable audit & no destructive deletes** (INV-AUDIT-1/2/3): append-only audit, write-once attestations and filed returns, no permanent deletion of financial records by any role.
- **Least privilege everywhere** (INV-RBAC-1): deny-by-default; every action authorized against the §4.17 matrix.

## 7. Flexibility & configurability

The spec is explicit that several behaviours must be tunable without code changes. These map to `INV-CFG`:

- **Line-number sub-labels (105/108/109)** — single toggle, layout respects it, no restructuring to turn off (open product decision in §5 of the IT note).
- **Auto-prompt engine** — per-signal thresholds, cap, prompt copy, per-client opt-in: all firm settings, editable at runtime.
- **Confidence threshold** (97.5% default) — configuration.
- **Document checklist** — per-client template defined at setup; differs by business type.
- **Filing frequency / period scheme** — per-client, accountant-driven; the system derives the open period.
- **Firm benchmarks** — thresholds derive from each firm's own benchmarks, so the system's "chattiness" is firm-tunable.

Implementation: a feature-flag/settings service (flags table + admin UI; or a managed flag tool with a UI for firm-editable copy). Firm settings are tenant-scoped config rows; client-level overrides allowed only where firm policy permits.

## 8. Observability & operability

- **Pipeline metrics** — extraction latency, confidence distribution, queue depth, job retries (these double as both ops signals and inputs to the feedback engine's signals).
- **Gate-chain metrics** — count of periods in each state; alert on periods stuck (e.g. processed-but-not-complete beyond an SLA, or open flags aging past threshold).
- **Error tracking** — Sentry; distributed tracing (OpenTelemetry) across request tier and worker fleet.
- **Audit queryability** — the append-only audit log is queryable for support and compliance.

---

## 9. Delivery roadmap (build/release phases)

Distinct from the operational phases in §3. Each delivery phase is independently shippable and de-risks the next.

> **Note:** This §9 is the spec's original delivery suggestion. The authoritative, expanded delivery roadmap is in [`PRD.md`](PRD.md) §5 — 16 phases honoring the one-user-type / one-platform constraint.

### Delivery Phase 1 — Tenancy, identity & the spine
Tenant/firm provisioning (App A minimal), firm + client user invite/auth flows, RBAC skeleton, the data spine (§2) with `tenant_id` + RLS, audit log foundation. **Exit:** a firm can be provisioned, users can sign in to the right app with the right role, isolation is enforced. Invariants live: TEN, AUTH, RBAC, AUDIT-1/4/5.

### Delivery Phase 2 — Engagement setup & document collection
Client setup (filing frequency, period scheme, checklist template), period derivation, the guided upload checklist (App C), delete-until-lock, home tiles. **Exit:** a client can be set up and can upload documents for an auto-derived period; catch-all works; counts mirror. Invariants: PER, DOC-1/2/3/5, CFG-4/5, DISP-2.

### Delivery Phase 3 — AI pipeline, extraction & the gate chain core
Extraction service (Claude API + Textract fallback), confidence scoring, `aiLocked` handoff (DOC-4), system-flag generation, the period state machine with guarded atomic transitions, the Locked/Pending/Processed card. **Exit:** the gate chain works end to end up to draft numbers. Invariants: GATE-1..5/9, DOC-4/6, CONF, FLAG-1/2, FIN-1/2/3/4, DISP-1/3/4/5/6, SIG-1/2.

### Delivery Phase 4 — Flags, attestations & previews
Full flag UX (three answer types, escape hatch, change/reopen, clear state), source-document preview + lightbox with highlighted statement rows, receipt double-write, the "Not found" attestation (append-only, attributed). **Exit:** flags genuinely gate window 3; attestation is a durable liability artifact. Invariants: FLAG-3..8, ATT, DOC-6, AUDIT-2.

### Delivery Phase 5 — Sign-off, Excel, detail pages & archive
Mark-complete second gate, ExcelJS period-scoped generation (monthly/quarterly/yearly + annual roll-up), gated download in all three locations, current/filed detail pages, income & expense statement + balance-sheet support, filed-returns archive (HST/T2 separate, accountant-uploaded PDFs). **Exit:** a full period can be processed, signed off, downloaded, filed, archived. Invariants: GATE-6/7/8, EXP, ARCH, FIN-5/6/7/8, DISP-6.

### Delivery Phase 6 — Feedback engine
Three base ratings, the auto-prompt engine (threshold-crossing, cap, soft copy, signal linkage), firm settings for thresholds/cap/copy/opt-in, once-per-period trigger from mark-complete. **Exit:** feedback surfaces correctly and stores rating↔signal linkage. Invariants: FB, SIG-3/4/6, CFG-2.

### Delivery Phase 7 — Firm-side scorecard & analytics
Objective × subjective join, per accountant/client/period, mismatch surfacing, restricted to Firm Admin/Partner. **Exit:** the scorecard the whole feedback design exists to feed. Invariants: SIG-5/6, RBAC-2, TEN-3.

### Delivery Phase 8 — SaaS hardening & scale
Billing/entitlements (BILL), autoscaling + queue-depth scaling, read replicas/sharding readiness, CDN-cached immutable artifacts, full observability, feature-flag service for all CFG items, residency/compliance sign-off. **Exit:** production multi-firm SaaS. Invariants: BILL, CFG-1/3, AUDIT-3/6, all scalability items.

---

## 10. Open decisions to confirm with the firm

1. **Client login model** — single login per client, or owner + in-house bookkeeper (drives the `client_staff` sub-role).
2. **Line-number sub-labels** — client-visible or accountant-only by default (build toggles either way per INV-CFG-1).
3. **Scorecard visibility to accountants** — can an accountant see their own scorecard, or partners only?
4. **Residency** — is `ca-central-1` contractually required per firm, or a default?
5. **Multi-firm now vs. later** — this spec assumes multi-tenant SaaS from day one. If the first deployment is single-firm, Delivery Phase 1's tenancy can be simplified but the spine should still carry `tenant_id` so the SaaS path stays open without a rewrite.
6. **Who initiates AI takeover** — accountant action, scheduled, or "all docs received" trigger (sets where the §9.3 boundary fires).

---

*End of specification.*
