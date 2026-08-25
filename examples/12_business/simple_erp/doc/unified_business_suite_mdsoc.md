# Unified Business Suite — Full Feature Catalog & MDSOC Architecture on Simple

*A competitive feature blueprint and an architecture grounded in Multi-Dimensional Separation of Concerns (MDSOC), realized on the Simple language/toolchain (github.com/ormastes/simple).*

---

## 0. Strategic thesis (read this first)

### 0.1 What incumbents actually got wrong

Every "all-in-one" suite markets a single source of truth, but each one is built around **one dominant decomposition axis** and then pays for it forever:

- **SAP / NetSuite** decompose by *module* (FI, CO, MM, SD…). Cross-module facts are reconciled by batch jobs and posting runs.
- **Rippling** decomposes by *employee* — its celebrated "employee graph" is a single keyed dimension. It's excellent until the concern you care about is *money*, *a customer*, *a jurisdiction*, or *a project* rather than a person.
- **Odoo** decomposes by *app*, sharing one Postgres schema, but enforces cross-app consistency in Python application code, not in the data model.

This is the exact failure MDSOC was invented to name: **most systems support only one "dominant" kind of modularization, and once decomposed, expensive invasive refactoring is needed to re-modularize.** A business is inherently *multi-dimensional* — the same `Invoice` is simultaneously a ledger event, a tax obligation, a customer-relationship artifact, a revenue-recognition schedule, a cash-flow forecast input, and a permission-scoped document. Forcing it into one owner module is the root cause of "sync hell."

### 0.2 The architectural bet

> **Model the business as overlapping concern dimensions composed at compile/commit time, not as modules synchronized at runtime.**

MDSOC lets you decompose along *multiple arbitrary dimensions simultaneously*, allow those concerns to overlap and interact, and compose them with explicit merge/override/combine rules — with on-demand re-modularization when requirements change. That is precisely the "Unified Data Core / No-Sync" promise in your draft, but stated as a *language and composition* property rather than a database trick.

Simple is unusual in that **MDSOC is a first-class language concept** (virtual capsules + manifests + architecture-aware repo structure) rather than a bolted-on framework like IBM's Hyper/J was for Java. That is the single biggest reason to build on it.

### 0.3 The leapfrog (why now, not just parity)

The 2026 market has pivoted from "AI copilot" to **agentic execution** — SAP's Autonomous Suite ships 50+ (heading to 200+) domain agents that *act* inside finance/HR/supply-chain processes; Gartner expects ~40% of enterprise apps to embed task-specific agents by end of 2026. The industry's own warning is the opening: *"A dashboard built on inconsistent data may mislead a user; an agent built on inconsistent data takes the wrong action."*

That reframes data integrity from a hygiene concern into a **safety** concern, and it is where Simple's stack is structurally ahead:

| Agentic-era requirement | Incumbent answer | Simple-native answer |
|---|---|---|
| One consistent state for agents to reason over | Knowledge Graph layered *over* synced systems | Composed MDSOC core — no sync to be inconsistent |
| Agents must not take illegal actions | RBAC + audit logging after the fact | **Capability/effect system** + **AOP-woven** pre-checks at compile time |
| Provable business invariants (debits=credits, no negative stock) | Tests, hope | **Lean 4 formal verification** layer for the critical subset |
| Unit/currency correctness | Convention | **Unit types & nominal IDs** (`newunit`) — wrong-currency math is a *compile error* |
| Auditable, deterministic execution | Vendor logs | Verification-native workflow (SPipe BDD, SDoctest, traceability) baked into the toolchain |

The pitch is therefore not "another Odoo." It is: **the first business suite where the data core is a composition (not a sync), and where agent actions are capability-bounded and formally verifiable.** Incumbents cannot copy that without rewriting their foundations.

---

## 1. Full feature catalog (module by module)

Scope note: a credible "beat SAP/NetSuite/Rippling/Odoo" suite needs far more than the four modules in the draft. Below are **14 modules + the cross-cutting dimension layer**. For each: who it displaces, the comprehensive feature set, and the *unified-core edge* that incumbents can't match.

---

### Module 1 — Human Capital (HRIS / HCM / Global Payroll)
*Displaces: Rippling, Workday, Deel, Gusto, BambooHR, Paychex.*

**Core HR / system of record**
- Single global worker profile spanning FTE, part-time, EOR/contractor, intern, and intercompany transfers, with unified, gap-free employment history.
- Org chart with dotted-line/matrix reporting, positions vs. people (position management), cost-center and legal-entity assignment.
- Custom fields, custom objects, and effective-dated records (every attribute is time-versioned, not overwritten).
- Document management: contracts, I-9/eligibility, certifications with expiry tracking, e-signature inline.
- Self-service + manager-service portals; delegated administration; bulk actions.

**Global payroll**
- Multi-country, multi-currency gross-to-net engine with country-specific tax, social, and statutory benefit rules.
- On-demand/off-cycle runs, retro pay, garnishments, multiple pay schedules, multi-entity consolidation.
- Automated statutory filings and payment files; pay-stub localization; year-end forms.
- Contractor payments and global EOR in the same flow as employees.
- **Edge:** payroll posts to the General Ledger in the same commit, not via a nightly export — there is no "payroll → GL" interface to reconcile.

**Benefits & leave**
- Benefits administration with carrier connections, open enrollment, life-event handling, ACA-style compliance reporting.
- Multi-tier, multi-jurisdiction leave/PTO accrual engine; accrual rules as data, not code.
- Leave balances reconcile live against project schedules (Module 8) so a booked vacation immediately reduces project capacity.

**Talent lifecycle**
- Recruiting/ATS: requisitions, pipelines, structured interviews, scorecards, offer management.
- Onboarding/offboarding orchestration that fans out to IT provisioning (Module 2), payroll setup, and access grants in one workflow.
- Performance: goals/OKRs, review cycles, 360 feedback, calibration, compensation review.
- Learning (LMS): courses, assignments, compliance training, certifications feeding the HR record.
- Headcount planning that writes back into FP&A (Module 13).

**Compliance & analytics**
- Jurisdiction-aware compliance engine (registrations, minimum wage, overtime, classification tests) driven by the *Location/Jurisdiction* dimension.
- Workforce analytics: headcount, attrition, DEI, comp ratios, span of control — built on the same store, no warehouse ETL.

---

### Module 2 — Identity, Devices, Access & Spend (IAM / MDM / UEM / T&E)
*Displaces: Rippling IT, Okta, Jamf, Kandji, Brex, Ramp.*

- **Identity lifecycle:** one employee record drives SSO identity, group membership, and app provisioning/deprovisioning across SaaS apps (SCIM + connectors).
- **Access governance:** role/attribute-based access, access reviews/recertification, just-in-time elevation, separation-of-duties checks (ties to the *Permission* dimension).
- **Device management (MDM/UEM):** zero-touch enrollment, configuration profiles, patch/compliance posture, remote lock/wipe on offboarding.
- **App management:** license inventory, usage-based reclamation, shadow-IT discovery, automated app grants tied to HR lifecycle state.
- **Corporate cards & spend:** issuance, real-time limits/policies, receipt capture, expense reports, reimbursements — posting straight to the ledger.
- **Edge:** "offboard employee" is one event that revokes SSO, wipes the laptop, cancels the card, stops payroll, and closes the GL accruals — because all of these are *concerns composed onto the same worker entity*, not separate systems receiving a webhook.

---

### Module 3 — Finance, Accounting & Continuous Close
*Displaces: NetSuite, SAP S/4HANA Financials, Sage Intacct, QuickBooks, Xero.*

**Ledger core**
- Continuous, real-time General Ledger — every operational event materializes a journal entry at the moment it happens (no batch close window).
- Multi-book / multi-GAAP: maintain local GAAP, IFRS, tax basis, and management books simultaneously from one event stream.
- Multi-entity, multi-currency with automatic intercompany elimination and consolidation; live FX revaluation.
- Dimensional accounting (department, location, project, product, custom) on every line — these *are* the cross-cutting dimensions, not tag fields.

**Transactional finance**
- AR: invoicing, dunning, collections, cash application with ML auto-match.
- AP: bill capture (OCR), 3-way match against POs/receipts (Module 5), approval routing, payment runs.
- Bank feeds with auto-reconciliation (target >99% auto-match) and exception queues.
- Fixed assets & depreciation: multi-method, multi-book, automated posting; lease accounting.
- Revenue recognition (ASC 606 / IFRS 15) with performance-obligation scheduling, driven directly off contracts/projects.

**Tax**
- Programmable global tax engine: VAT/GST/sales tax determination at transaction time, with rate tables as versioned data and connectors to filing/e-invoicing authorities.
- e-invoicing / continuous transaction controls (CTC) compliance for jurisdictions that mandate it.

**Close, control & reporting**
- "Soft close any day" — financials are always current; period close becomes a *lock + attest* step, not a *compute* step.
- Audit trail on every figure (drill from financial statement → journal → source operational event in one click, because there is one chain).
- Statements, board packs, and regulatory reports generated from the live ledger.
- **Edge:** the close is fast *because there is nothing to reconcile* — the ledger was never a copy of operational truth, it's a *projection* of the same composed entities.

---

### Module 4 — Procurement, Spend & Supply Network
*Displaces: Coupa, SAP Ariba, Ramp procurement, Bill.com, Precoro.*

- Purchase requisitions → approvals → POs, with policy-driven routing and budget checks against live FP&A.
- Vendor master, onboarding, KYC/sanctions screening, vendor portal, performance scoring.
- Contract lifecycle management with obligation tracking and renewal alerts.
- Catalog/punchout, RFQ/RFP and sourcing events, reverse auctions.
- 3-way match (PO ↔ receipt ↔ invoice) feeding AP automatically.
- Spend analytics and budget-vs-commitment-vs-actual in real time (commitments hit the ledger as encumbrances at PO time).

---

### Module 5 — Inventory, Warehouse & Logistics (WMS)
*Displaces: NetSuite WMS, Cin7, Fishbowl, Katana.*

- Multi-warehouse, multi-location, bin/lot/serial tracking; barcode/RFID; mobile scanning.
- Real-time stock with reservations, atomic moves, and **type-level guarantees against negative inventory** (see §2.7).
- Demand forecasting and automated reordering (min/max, reorder point, MRP-driven).
- Landed cost, multiple costing methods (FIFO/LIFO/avg/standard) posting to the ledger live.
- Pick/pack/ship, wave/batch picking, cycle counting, returns (RMA), 3PL/dropship, carrier integration.
- Lot traceability and recall (forward/backward genealogy) via the *traceability* dimension.

---

### Module 6 — Manufacturing / MRP
*Displaces: SAP PP, Odoo MRP, Fishbowl Manufacturing, Katana.*

- Multi-level BOMs, routings, work centers, capacity planning, finite/infinite scheduling.
- Work orders, shop-floor control, MES-style operator terminals, scrap/yield, by-products/co-products.
- MRP run that nets demand against supply across sales, forecasts, inventory, and POs.
- Quality management: inspection plans, non-conformance, CAPA, certificates of analysis.
- Subcontracting, engineering change orders, product lifecycle/version control.
- Real-time WIP valuation and variance analysis posting to the ledger.

---

### Module 7 — CRM & Sales
*Displaces: Salesforce, HubSpot, Pipedrive, Zoho CRM.*

- Lead/contact/account/opportunity management, customizable pipelines, multiple sales processes.
- Quote/CPQ with guided selling, discounting rules/approvals, and quote → order → invoice → revenue with no re-keying.
- Activity capture, email/calendar sync, sequences/cadences, conversation intelligence.
- Forecasting (weighted, AI-assisted), territory and quota management, commissions (which post to payroll/GL).
- Customer 360: every order, invoice, support ticket, and contract on one timeline because they're concerns on the same `Customer` entity.
- Partner/channel management, subscription/contract billing.

---

### Module 8 — Project, Resource & Professional Services Automation (PSA)
*Displaces: Asana, Monday.com, ClickUp, Kantata, Smartsheet, Jira.*

- Adaptive workspaces: the same task data renders as list, Kanban, Gantt, calendar, timeline, or doc-table without forking the model.
- Resource management: skills/capacity/utilization, matrix allocation visualizer, staffing requests, scenario planning.
- Time & expense: auto-drafted timesheets from calendar events, source-control commits, and task activity; billable/non-billable; approvals.
- Project financials: budgets, burn rate, EAC/ETC, margin, WIP — calculated live from task and time updates.
- Billing models: T&M, fixed-fee, milestone, retainer — generating invoices and revenue recognition directly (Module 3).
- Dependencies, baselines, critical path, automations, intake forms, portfolio roll-ups.
- **Edge:** moving a task's hours doesn't *trigger* a billing update — the billable amount *is* a projection of the same data, so margin and forecast change in the same commit.

---

### Module 9 — Communication & Meeting Lifecycle Hub
*Displaces: Slack, Microsoft Teams, Zoom, Calendly.*

- Channels + DMs, but every business object (invoice, candidate, work order, ticket) has a **native contextual thread** attached to the record, not a copy in a separate chat tool.
- Collaborative calendar with multi-party scheduling links and live availability checks against resource capacity (Module 8) and leave (Module 1).
- VoIP/softphone with recording; video meetings with transcription.
- Automated meeting summaries → action items that become tasks linked back to their source object.
- Activity feeds as first-class, queryable, permissioned records (the *Document/Comms* dimension), so "show me every discussion that touched this PO" is a query, not an archaeology dig.

---

### Module 10 — Customer Support, Helpdesk & Field Service
*Displaces: Zendesk, ServiceNow, Intercom, Freshdesk, ServiceTitan.*

- Omnichannel ticketing (email, chat, portal, phone, social), SLAs, escalations, CSAT.
- Knowledge base with deflection, internal + external articles, AI answer drafting grounded in the suite's own data.
- Field service: dispatch, scheduling/route optimization, mobile work orders, parts consumption (decrementing inventory and billing automatically).
- Asset/CMDB and ITSM-style change/incident/problem management for internal IT.
- Full customer/asset context inline because tickets are a concern on the same `Customer`/`Asset` entities as sales and finance.

---

### Module 11 — Marketing, Commerce, Website & POS
*Displaces: HubSpot Marketing, Mailchimp, Shopify, Square.*

- Campaign management, email/SMS automation, journeys, segmentation off the live customer store (no list export).
- Landing pages / website / CMS builder; SEO; forms feeding CRM directly.
- B2C/B2B eCommerce storefront sharing the same product/inventory/pricing as ERP (no catalog sync).
- POS (retail/restaurant) with offline mode, unified with inventory and the ledger.
- Attribution and ROI analytics tied to actual booked revenue, not a marketing-only funnel estimate.

---

### Module 12 — Documents, e-Signature, Forms & Knowledge
*Displaces: DocuSign, Notion, SharePoint, Confluence.*

- Document generation from templates bound to live data (contracts, SOWs, offer letters, POs).
- Native e-signature with audit certificate; signed docs attach to the originating entity.
- Wiki/knowledge spaces, structured docs, and forms — all permissioned by the same access model.
- Versioning, retention policies, and legal hold via the *Audit* dimension.

---

### Module 13 — Analytics, BI & Planning (FP&A + EPM)
*Displaces: Power BI, Tableau, Looker, Anaplan, Workday Adaptive.*

- Embedded analytics on the operational store — no separate warehouse, no nightly ETL, because the store is already dimensional and event-sourced.
- Self-service pivot/report builder with a query language (compete with Rippling's RQL idea but suite-wide), role-scoped views, calculated fields.
- Planning & budgeting: driver-based models, multi-scenario, rolling forecasts, write-back into operational targets.
- Anomaly detection, variance alerts, and KPI monitoring as standing queries.
- "Metrics layer" defined once and reused across every module's dashboards (semantic consistency by construction).

---

### Module 14 — Platform, Low-Code & Agent Layer (the moat)
*Displaces: Rippling Workflow/App Studio, SAP BTP / Joule Studio, ServiceNow App Engine, Salesforce Flow.*

- **No-code workflow/automation builder** (trigger → condition → action) spanning every module — the cross-module recipe is trivial because there are no module boundaries to cross.
- **App builder / custom objects & dimensions:** customers add new concern dimensions and capsules without forking core.
- **Developer platform:** clean, low-latency API; SDK; the suite itself is extensible in Simple.
- **Agent runtime (MCP-native):** Simple already ships MCP servers and an LSP written in Simple. Business agents are first-class, **capability-scoped** (an "AP clerk" agent literally *cannot* touch payroll because it lacks the effect), with AOP-woven audit on every action and Lean-checked invariants the agent cannot violate.
- **Marketplace** for third-party capsules/dimensions and agents, governed by the same capability model.

---

### The cross-cutting dimension layer (the MDSOC payoff)

These are *not* modules. They are concern dimensions that every module composes against. In incumbents they're re-implemented per module (or synced); here they're defined once and woven everywhere:

| Dimension | What it owns | How it's realized in Simple |
|---|---|---|
| **Identity** | who a party is (person/org/system) | shared capsule; HR, IAM, CRM contribute slices |
| **Money / Ledger** | every value movement | event-sourced ledger projection; unit-typed amounts |
| **Time** | effective-dating, scheduling, accrual | effective-dated records + scheduler actors |
| **Location / Jurisdiction** | tax, compliance, localization | data-driven rule tables keyed to this dimension |
| **Approval / Workflow** | who must consent before an action | AOP `around` advice over state transitions |
| **Permission** | who may see/do what | capability/effect system + access reviews |
| **Audit / Provenance** | immutable trail + traceability | AOP `after` weaving; append-only SDN store |
| **Document / Comms** | discussion + artifacts on any object | contextual threads as queryable records |

---

## 2. Architecture — MDSOC realized on Simple

### 2.1 The model: business-as-composition

Reframe the draft's "Unified Relational Core." The core is **not a god-schema**; it is a *hyperspace* in which entities are assembled from concern slices:

```
                An "Invoice" is not owned by Finance.
                It is composed from contributions across dimensions:

   Identity ──┐
   Money   ───┤
   Time    ───┼──►  Invoice  ◄── one composed entity, one commit,
   Jurisd. ───┤                  zero cross-module sync
   Approval ──┤
   Audit   ───┘
```

Each module declares only the **slice** of an entity it cares about (a *hyperslice*, in MDSOC terms), and the compiler/runtime composes them into the concrete entity (a *hypermodule*) using explicit composition rules. This is the "declarative completeness + composition" idea from the original MDSOC/Hyper/J work — except Simple supports it as language-level capsules and manifests rather than an external weaver.

### 2.2 Capsules & manifests

Simple's **virtual capsules + manifests + architecture-aware repo structure** are the unit of MDSOC decomposition. Map them like this:

- A **capsule** = one concern's contribution to one or more entities (e.g., `finance.invoice_ledger`, `tax.invoice_vat`, `crm.invoice_relationship`).
- A **manifest** declares what a capsule *introduces*, *requires*, and *exports* — the contract that lets the IDE and compiler reason about composition without expanding everything (the same contract-first principle as Simple's parser-friendly macros).
- **Architecture rules** (`forbid`/`allow` pointcuts) enforce dimension boundaries at compile time so, e.g., a presentation capsule can never reach into the ledger directly.

```simple
# manifest: the tax dimension contributes a VAT slice to Invoice
capsule tax.invoice_vat:
    requires entity Invoice has (subtotal: Money, jurisdiction: JurisdictionId)
    intro    field vat_amount: Money
    intro    field vat_breakdown: [VatLine]

    fn compute(inv: Invoice) -> Money:
        rate = rate_table.lookup(inv.jurisdiction, inv.tax_class)
        inv.subtotal * rate            # Money * Rate -> Money, checked by unit types

# architecture rule: jurisdiction logic must never depend on UI
forbid pc{ within(tax.*) & within(ui.*) } "tax dimension cannot depend on presentation"
allow  pc{ within(finance.*) } use ledger "finance may post to the ledger"
```

### 2.3 The "no-sync" core, precisely

Your draft says transactions execute "within a single database transaction boundary." Make that claim *true by construction*:

- The ledger is an **event-sourced projection**, not a second copy. Operational events (ship goods, log an hour, run payroll) are the *only* writes; financial, tax, project, and analytics views are **deterministic projections** of those events.
- Because a projection is a pure function of the event log, there is *nothing to reconcile* — "sync errors" are not handled, they're *impossible*. This is the strongest possible version of "continuous accounting."
- Use Simple's **SDN-backed textual databases** for configuration, rule tables, and metadata (versioned, diff-able, repo-native), and a real OLTP engine (via `nogc_sync_mut` SFFI to Postgres/FoundationDB) for the high-volume event log.

### 2.4 Concurrency & the commit loop

- Model long-running, stateful domains (a payroll run, an MRP run, an order saga) as **waitless stackless coroutine actors** — Simple's actor model gives you isolation without thread-per-entity overhead.
- Use your **two-tree commit event loop** as the transactional spine: stage effects in a working tree, validate invariants (including Lean-checked ones), then atomically promote — giving you saga-like multi-entity commits with a clean rollback story.
- Map workloads to **runtime families** deliberately:

| Workload | Runtime family | Why |
|---|---|---|
| Pure projections, tax math, report rendering | `common` | immutable, trivially parallel, cache-safe |
| Event log writes, DB/FFI, network | `nogc_sync_mut` | predictable latency, no GC pauses on the hot path |
| Actors, async I/O, schedulers, agents | `nogc_async_mut` | concurrency without GC jitter |
| ML forecasting, anomaly detection, GPU | `gc_async_mut` | productivity where pauses are acceptable |
| Edge/POS/handheld scanners | `nogc_async_mut_noalloc` | runs on constrained/embedded targets |

The compiler **enforces family boundaries**, so an analytics module can't accidentally drag GC pauses onto the payment-posting path — a class of production incident that's just *gone*.

### 2.5 Cross-cutting concerns via AOP (not copy-paste)

Audit, permission checks, tax application, and approval gating are textbook cross-cutting concerns. Implement them as **predicate-based AOP advice with compile-time weaving** (Simple's default), so there's zero overhead where no aspect applies and no per-module duplication:

```simple
# audit every state-changing service call, suite-wide, once
on pc{ execution(* services.*.commit(..)) } use audit_write after_success priority 20

# enforce approval before any ledger-affecting mutation above a threshold
on pc{ execution(* ledger.post(..)) & attr(requires_approval) } use approval_gate around priority 90

# permission pre-check woven before every command handler
on pc{ execution(* commands.*(..)) } use capability_check before priority 100
```

This is the literal realization of MDSOC's claim that AOP/MDSOC lets you "specify concerns separately and weave them automatically" — applied to the eight cross-cutting business dimensions.

### 2.6 Multi-tenancy & agent safety via capabilities/effects

- Simple's **capability/effect system** is the tenant- and agent-isolation primitive. A request executes with a capability set scoped to one tenant and one role; code that needs an effect it wasn't granted **won't compile/run**.
- This is what makes the **agent layer safe**: an autonomous "collections agent" is handed `read:AR + write:dunning_email` and *nothing else*. It is structurally incapable of touching payroll or deleting a customer — the guarantee is in the type/effect system, not in a prompt or a policy doc the agent might "reason around."

### 2.7 Money, units, and provable invariants

This is where Simple buys you correctness incumbents fake with conventions:

```simple
# money is a unit type, not a float; currencies are nominal and non-mixable
unit currency(base: Decimal):
    USD = 1.0, EUR = 1.0, KRW = 1.0      # held per-book; cross-rate via explicit FX
newunit AccountId: i64 as acct
newunit TenantId:  i64 as tnt

# wrong-currency arithmetic is a COMPILE error, not a runtime surprise:
# total = 100_USD + 50_EUR            # ✗ rejected by the type checker

# quantities can't go negative at the type level for stock-controlled items
newunit OnHand: NonNeg<i64> as qty
```

Then push the genuinely load-bearing invariants into the **Lean 4 verification layer** Simple ships:
- every journal entry balances (Σ debits = Σ credits) — *proved*, not tested;
- inventory moves preserve conservation (no creation/destruction of units outside documented adjustments);
- a projection is a total function over the event log (no event yields an undefined financial state).

For a system of record, "the ledger provably balances" is a differentiator no SaaS competitor can put on a slide.

### 2.8 The UI / surface layer

- Use Simple's **shared UI contract (Protocol V1)** so web, desktop, TUI, and embedded surfaces are driven by *one* tested contract with stable element IDs and a structured error model — your draft's "Unified User Experience" band, made real and testable across surfaces.
- The adaptive-workspace requirement (list/Kanban/Gantt/table over one model) falls out naturally: views are *projections of the same entity*, exactly like the ledger is a projection — no per-view data fork.
- Honest caveat: today this is a shared *test/HTTP contract*, **not** a full unified rendering layer. A production suite still needs a real web/desktop front end (your prior GUI stack work — multi-backend engine, pure-pipeline vs. shell-bypass — is the right track; treat the shared contract as the API spine beneath it).

### 2.9 Deployment topology & GTM mapping

- **Pointer-type discipline** (GC / unique / shared / weak / handle) lets the same codebase serve a GC'd cloud deployment and a tight self-hosted/edge build — supporting your two-tier GTM (open-source self-hosted core + managed enterprise cloud).
- **SFFI** (proven C/C++ bidirectional interop) is how you integrate the unglamorous-but-mandatory externalities: payment rails, bank feeds, tax-authority e-invoicing endpoints, carrier APIs, identity providers.
- **Phasing maps to runtime families:** ship the cloud suite first (`gc_async_mut`/`nogc_async_mut`), then the edge/POS/handheld targets (`nogc_async_mut_noalloc`) reuse the same domain capsules.

### 2.10 End-to-end sketch: one event, every dimension, one commit

```simple
# A single shipment event composes across dimensions in one transaction.
actor OrderFulfillment:
    fn on_ship(order: OrderId, lines: [ShipLine]) -> Result[Unit, FulfillError]:
        tx = ledger.begin()                       # two-tree working stage
        for ln in lines:
            inventory.decrement(ln.sku, ln.qty)   # OnHand stays NonNeg by type
        rev   = revenue.recognize(order)          # ASC 606 projection slice
        taxes = tax.compute_for(order)            # jurisdiction dimension
        ledger.post(order, rev, taxes)            # Σdr = Σcr  (Lean-verified)
        comms.thread(order).note("shipped")       # comms dimension
        analytics.touch(order)                    # projection, not a copy
        tx.commit()                               # atomic promote; else full rollback
```

No webhook, no cron, no "sync the GL." One event, composed across seven dimensions, committed once. That single function is the entire architectural argument.

---

## 3. Sequencing, honest risks & recommendation

### 3.1 Build order (don't boil the ocean)
1. **Kernel (months, not features):** capsule/manifest runtime conventions, the event log + projection engine, the eight cross-cutting dimensions, capability/effect plumbing, the two-tree commit loop, unit-typed Money + the first Lean invariants (balanced ledger).
2. **Wedge vertical:** **HR + Payroll + Finance** for one or two jurisdictions. This is the most defensible beachhead because (a) it's where Rippling's single-dimension model strains, and (b) "payroll posts to a provably-balanced ledger in one commit" is a crisp, demoable claim.
3. **Adjacent pull:** IAM/Spend (Module 2) and PSA (Module 8) — they share the Identity and Time dimensions you already built, so marginal cost is low.
4. **Platform + agents (Module 14):** open it for third-party capsules once the dimension contracts are stable.
5. **Breadth (CRM, Inventory, MRP, Support, Commerce):** each new module is mostly *new slices on existing dimensions*, which is the whole point.

### 3.2 Risks to name out loud
- **ERP is a moat of drudgery, not just architecture.** Multi-country payroll/tax compliance is thousands of jurisdiction-years of rules that update constantly. Your architecture makes consuming those rules clean, but *someone still has to maintain the rule content*. Plan for rule-content as a product (and likely a partner/marketplace play), not a one-time feature.
- **Pre-1.0 platform under a system-of-record.** Simple is ~v0.9.x and (per the repo) effectively single-maintainer. Betting a company's books on it is a real risk; mitigate by keeping the **event log in a boring, durable store** (Postgres/FoundationDB via SFFI) so Simple is the *logic and composition layer*, and the durability story doesn't depend on Simple's own persistence maturing.
- **Composition is powerful and dangerous.** MDSOC's flexibility (override/merge across dimensions) can become its own kind of spaghetti if composition rules aren't disciplined. Lean on the manifest contracts and `forbid`/`allow` architecture rules from day one; treat an un-declared cross-dimension dependency as a build failure.
- **The UI gap is real.** The shared contract is an API spine, not a finished design system. Budget for a genuine front-end effort.
- **Don't over-index on "no-sync" as marketing.** Buyers don't buy architecture; they buy "payroll is right," "the close is fast," "the audit passed." Lead with those outcomes; the MDSOC/verification story is *why you can promise them*, not the headline.

### 3.3 The one-sentence positioning
> A business suite where the books *provably balance*, every record is *one composition instead of ten synced copies*, and every AI agent is *capability-bounded by the type system* — built on an MDSOC-native language so adding a module means adding a slice, not bolting on another silo.

---

*Sources consulted for the competitive landscape and 2026 agentic-ERP direction include the Simple repository README/architecture notes, the original MDSOC/Hyperspaces/Hyper-J literature (Tarr–Ossher–Harrison–Sutton), Rippling's employee-graph positioning, Odoo's module taxonomy, and SAP's Sapphire 2026 Autonomous Suite / Joule announcements. Competitor capabilities are paraphrased for comparison and may have changed since mid-2026.*
