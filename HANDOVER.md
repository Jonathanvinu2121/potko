# POTKO — Developer Handover

**Version 2.0.3 · 23 October 2026.** This is the complete picture for whoever takes POTKO over: what it is,
what has been built and how, where everything lives, what is weak or missing, how it scales, what to do next,
and which decisions must be kept. Read it first. Then use [`README.md`](README.md) for the detailed rules and the
commands to run, and [`CHANGELOG.md`](CHANGELOG.md) for what changed in each version.

No password, PIN, connection string, setup code or private link is written here. The repository is
**public**, so keep it that way.

---

## Contents

1. [What POTKO is](#1-what-potko-is)
2. [Current state at a glance](#2-current-state-at-a-glance)
3. [Accounts, services and secrets](#3-accounts-services-and-secrets)
4. [History: how it got here](#4-history-how-it-got-here)
5. [Architecture: how it is built](#5-architecture-how-it-is-built)
6. [Data model](#6-data-model)
7. [Roles and permissions](#7-roles-and-permissions)
8. [How each part works](#8-how-each-part-works)
9. [Operations runbook](#9-operations-runbook)
10. [Testing and quality](#10-testing-and-quality)
11. [Limitations and known issues](#11-limitations-and-known-issues)
12. [Capacity and scaling](#12-capacity-and-scaling)
13. [Security review](#13-security-review)
14. [What to do next: must, should, could](#14-what-to-do-next-must-should-could)
15. [Decisions to keep](#15-decisions-to-keep)
16. [Engineering conventions](#16-engineering-conventions)
17. [Open items and pending decisions](#17-open-items-and-pending-decisions)
18. [Glossary](#18-glossary)

---

## 1. What POTKO is

A restaurant point of sale with kitchen order tickets (POS + KOT) for a small group of restaurants (designed for
3 to 5 restaurants on one server). Waiters take orders on Android phones or tablets. Each kitchen sees its own
tickets the moment they are sent. The manager runs the floor, settles bills, approves sensitive requests with a
4-digit PIN, and manages the menu, staff, tables and reports.

It is built for Indian restaurants: rupees, GST shown as CGST + SGST, India time by default, and UPI, Paytm and
PhonePe as payment names.

**Five roles:** Admin, Manager, Cashier, Waiter, Chef. One app serves all of them; what a person sees depends on
their role and permissions (see [section 7](#7-roles-and-permissions)).

**Who uses it today:** one client restaurant is on a trial of the online server (they set up their restaurant
themselves with the first-run set-up). A public demo with sample data is used to show the product.

---

## 2. Current state at a glance

| Item | State |
|---|---|
| Version | **2.0.3** (Android versionCode 5), git tag `v2.0.3`, commit `e0a662c` |
| Online server (the client's) | `https://potko-server.onrender.com` on Render, free plan, Singapore. `/health` shows the version |
| Database | Neon PostgreSQL, free plan, Singapore (project "Potko") |
| Public demo | `https://potko-demo.onrender.com`: its own in-memory database with sample data and one-tap sign-in |
| Android app | `release/POTKO-2.0.3.apk`, built on the development laptop, installed by hand (not in git, not in a store) |
| Source code | `github.com/Jonathanvinu2121/potko` (**public**). Branch `main` = the client's server, branch `demo` = the demo (identical today) |
| Tests | 92 server tests, all passing. The app has no automated tests |
| Client documentation | "POTKO Client Guide", a document in the owner's Claude account (install, set-up, daily use) |
| Keep-awake | The client's server stays awake 09:00 to 23:30 India time (free-plan workaround, [section 8.13](#813-keep-awake-on-the-free-plan)) |

---

## 3. Accounts, services and secrets

### Accounts (held by the project owner)

| Service | What is there | Notes |
|---|---|---|
| GitHub | Repository `Jonathanvinu2121/potko` | **Public.** GitHub Actions is enabled for one scheduled job (the morning wake-up) |
| Render | Workspace "Apex", Blueprint "Potko_mark1" made from [`render.yaml`](render.yaml): services `potko-server` and `potko-demo` | A push to `main` that changes `server/` redeploys `potko-server`; a push to `demo` redeploys `potko-demo` |
| Neon | Project "Potko", AWS Asia Pacific (Singapore) | An older, unused Neon project in Ohio may also exist |
| Claude | The client guide document | Update it with every release |
| Expo / EAS | Not used | Builds are made locally (see [section 9.6](#96-build-the-android-app-apk)) |
| Google Play / Apple | Not used | No store listing; no iOS build |

### Secrets: names and where they live (values are never written down here)

| Secret | Where | What it does |
|---|---|---|
| `DATABASE_URL` | Render › potko-server › Environment; on the laptop in `server/.env.online` (git-ignored) | Neon connection string |
| `JWT_SECRET` | Render (generated) | Signs sign-in tokens. Changing it signs everybody out |
| `SETUP_CODE` | Render (generated) | Typed once by the client on the first-run "Set up your restaurant" screen. The owner reads it in Render › Environment |
| `KEEP_AWAKE_HOURS` | Render (optional; default `09:00-23:30`) | Opening hours for keep-awake; `off` switches it off |
| Demo logins and the demo approval PIN | Top comment of [`server/sql/seed.sql`](server/sql/seed.sql) (public) | **Demo data only.** Never load the seed on a real restaurant's database |
| Local settings | `server/.env`, `app/.env` (git-ignored; templates in `*.env.example`) | Local database address, a local `JWT_SECRET`, `DEV_LOGIN` |

### On the development laptop only (git-ignored)

| Folder | What it holds |
|---|---|
| `release/` | Built APKs (`POTKO-1.0.0.apk` … `POTKO-2.0.3.apk`) |
| `app/android/` | The generated Android project (made again by `expo prebuild`) |
| `.gradle-home/` | Gradle's cache and the low-memory build settings |
| `.avd/` | The Android emulator (virtual phone "potko") |
| `.tools/` | `cloudflared` (temporary public links for testing) and small scripts that serve and share a test build |
| `backups/` | JSON copies of the online database taken on 16 Oct 2026 before it was emptied for the client (old test data). Keep private or delete |
| `spec/` | The client's specification, design sheets, Figma exports and WhatsApp screenshots. **Not in git on purpose** (client material, and the repository is public). Hand it over separately |
| `.claude/skills/` | Third-party design guidance used while building the screens. Not part of the product |

---

## 4. History: how it got here

| Version | Date | What it brought |
|---|---|---|
| 1.0.0 | 2026-10-07 | First test deployment on Render + Neon: waiter ordering, kitchen board, manager approvals |
| 2.0.0 | 2026-10-16 | The POS + KOT rebuild from a 21-section specification and the Figma "finals" design. Manager workspace (Overview, Tables, Payments & Approvals, More). Floors, dining areas and tables with split, merge, join and transfer. Kitchens with Accept, then Start preparing, then Ready. Menu with portions, add-ons, open price, tax and import. Staff with roles and per-person permissions. GST billing, approvals with a PIN, audit log, reports, first-run set-up for the client |
| 2.0.1 | 2026-10-16 | The client's own combined menu file (Item ID, Category ID), Staff ID everywhere, a page-by-page consistency pass |
| 2.0.2 | 2026-10-22 | The developer brief's two fixes (menu import left categories without dishes; a split broke up a seated party), the server kept awake during opening hours, the public demo |
| 2.0.3 | 2026-10-23 | The client's rule: a waiter who does not take payment never sees an amount and gets only Add Items or Close Table; the manager can reopen a closed table |

How requirements arrived: a written specification and design sheets (9 Oct), the Figma design (the "finals" section
is the design to follow; the owner has the link), several review rounds of phone screenshots with notes from the
owner, a developer brief (21 Oct) and client feedback over WhatsApp (22 Oct). **Where the owner's decisions differ
from the specification, the owner's decisions win.** They are listed in [section 15](#15-decisions-to-keep).

An early product brief listed ten features. Where each stands today:

| Feature | State |
|---|---|
| Order taking (dine-in, delivery, takeaway) | Built |
| Kitchen tickets (KOT) per kitchen | Built (on screen; not printed) |
| Flow-controlled kitchen display | Built (Accept → Preparing → Ready → Served) |
| Revenue protection (locks, approvals, audit) | Built |
| GST billing | Built (one configurable rate, per-dish override) |
| Table management | Built (areas, layout, split, merge, join, transfer) |
| Offline-first on the local network | **Not built.** The app needs the server; there is no offline queue |
| Dynamic UPI QR (Razorpay) | **Not built.** A UPI ID can be shown; payments are confirmed by staff |
| Hindi / Punjabi | **Not built.** English only |
| WhatsApp support with response times | **Not built** (a support process, not software). The client guide's support contact is still empty |

---

## 5. Architecture: how it is built

```
  Android app (Expo / React Native)          Web build (only for the public demo)
        │ REST: sign-in, loading, set-up, uploads
        │ WebSocket /ws?token=…: live actions and events
        ▼
  Node.js server: Express 5 + ws 8, one process            (Render)
        │ pg, a pool of 5 connections
        ▼
  PostgreSQL                                               (Neon)
```

**The rules of the system**

- **The server is the only source of truth.** Every change goes app → server (permissions and business rules are
  checked, inside one database transaction) → database → broadcast to every connected screen that may see it.
  Hiding a button in the app is never the security.
- **Live actions** travel over the WebSocket as `{ type, payload, id }`. The server answers each with an `ack`.
  A repeated `id` from the same person runs once (remembered for 10 minutes), so a double tap or a retry never
  doubles an order or a payment.
- **After every reconnect** the app calls `GET /sync` and redraws everything from the server's answer. There is
  no offline mode: while disconnected the app says so and its buttons wait.
- **What each person receives** is decided in one place, [`server/src/scope.js`](server/src/scope.js): a waiter
  gets only their dining areas, tables and orders; a chef only their kitchens' dishes; anyone who may not see
  prices gets no dish prices; a waiter who does not take payment gets no amount at all.
- **Money** is computed in one place, [`server/src/bill.js`](server/src/bill.js), in paise. Prices, add-ons and
  tax are copied onto each order line when it is ordered, so later menu or tax changes never alter a bill.
- **An order's status follows from its dishes** (`deriveOrderStatus` in [`server/src/orders.js`](server/src/orders.js)),
  except the states set by billing and the floor: paid, closed, cancelled, merged.
- **The database upgrades itself.** On every start the server applies any migration in `server/sql/migrations/`
  it has not run yet, each in one transaction. The server refuses to start on a database it does not understand.

**Technology**

| Part | What is used |
|---|---|
| App | Expo SDK 57, React Native 0.86, React 19.2, Expo Router (file-based screens), zustand (state), AsyncStorage, expo-print / expo-sharing (bills), expo-document-picker (menu files), expo-image-picker + expo-image-manipulator (pictures), Inter font, Material Community Icons |
| Server | Node.js 20 or newer (Render runs 22), Express 5, ws 8, pg 8, bcryptjs (passwords and PINs), jsonwebtoken, read-excel-file / write-excel-file (menu import and its template) |
| Database | PostgreSQL. Locally, in the tests and in the demo: PGlite (PostgreSQL compiled to WebAssembly) with pglite-socket |
| Hosting | Render (server and demo), Neon (database), GitHub Actions (morning wake-up) |

**Code layout** (more detail in README › Where things are)

```
app/app/            screens (Expo Router): (auth), (waiter), (chef), (manager)
app/src/screens/    screens shared by waiter and manager: BillScreen, SplitTable, MergeTable, TransferTable
app/src/components/ the building blocks (Button, Chip, Card, BottomSheet, TableGraphic, FloorPlan, …)
app/src/store/      auth (with permissions), live (floors, areas, tables, orders, approvals), menu, draft, staff, settings, toast
app/src/lib/        api.js (REST), ws.js (live connection), orders.js (how an order is read), prices.js, format.js, …
app/src/theme/      tokens.js: every colour, radius and font size
app/scripts/        build-apk.js
server/src/         index.js (start), auth.js, permissions.js, scope.js, bill.js, orders.js, tables.js, settings.js,
                    importer.js, keep-awake.js, demo.js, routes/ (REST), ws/ (live actions)
server/sql/         schema.sql (version 1), migrations/002–007, seed.sql (demo data)
server/test/        the tests
server/demo-web/    the web build served by the public demo
.github/workflows/  wake-server.yml (morning wake-up)
```

---

## 6. Data model

All data belongs to a restaurant (`restaurant_id` on every row, and every query is filtered by it). Staff IDs are
unique across all restaurants.

| Table | Holds |
|---|---|
| `restaurants` | Name, `settings` (tax, service charge, round off, payment methods, discount presets, time zone, business-day start, service hours, devices), `profile` (address, GSTIN, bill footer, logo), order and KOT counters |
| `users` | Name, Staff ID (`login_id`), role, password hash, PIN hash, `permissions` (per-person overrides), `access` (a waiter's areas and tables), `payment_access` (take / close / none), discount limit, active, deleted |
| `sessions`, `login_otps` | Sign-in sessions the server can end; one-time codes for roles that need them |
| `floors`, `dining_areas`, `tables` | The floor. A table has seats, layout position and status, the waiter holding it (`locked_by`), a parent (`parent_table_id`, for split parts) and `joined_to_id` (joined tables) |
| `kitchen_terminals`, `user_terminals` | Kitchens and the chefs assigned to them |
| `categories`, `menu_items`, `addon_links` | The menu. `code` is the Category ID / Item ID; portions (`sizes`), add-ons (`modifier_groups`), tax, kitchens, open price; Goes Well With links |
| `orders` | Type, table, waiter, guests, status, the bill's amounts as last worked out, discount, `bill_requested_at`, `at_counter`, `handed_over_at` (2.0.3: the waiter closed the table), payments total, paid and closed times |
| `order_items` | One line: dish name, portion, add-ons, quantity, unit price and tax copied at order time, status, kitchen(s), KOT, timestamps |
| `kots` | Numbered kitchen tickets, one per kitchen per send |
| `payments` | Payments and refunds: method, amount, status (successful / failed), reference, cash received and change |
| `approvals` | Discount, cancel, void and refund requests with their decision |
| `audit_logs` | Who did what, as which role, old and new values, reason. **A database trigger refuses any change or deletion** |
| `images` | Pictures, stored in the database (at most 400 KB each) |
| `imports` | Menu import history |
| `schema_migrations` | Which migrations have run |

**Statuses**

| Thing | Statuses |
|---|---|
| A dish (`order_items.status`) | `sent` → `accepted` → `preparing` → `ready` → `delivered` (served); also `unavailable` (the chef denied it), `removed`, `cancelled` |
| An order (`orders.status`) | Worked out from its dishes: `new`, `accepted`, `preparing`, `partly_ready`, `ready`, `delivered`. Set by actions: `paid` (table still seated), `closed`, `cancelled`, `merged`. Plus `handed_over_at`: closed by its waiter, bill at the counter |
| A table (`tables.status`) | `free`, `occupied` (being seated), `order_placed`, `preparing`, `ready`, `all_delivered`, `needs_payment` (bill requested), `paid`, `split` |

**Migrations**: `schema.sql` is version 1 (restaurants, users, one-time codes, tables, menu, orders, approvals,
audit log). `002_pos_manager` is the large version 2 change (dining areas, kitchens and their chefs, sessions,
KOTs, payments, images, imports, the audit trigger, and many new columns). Then `003` floors, join and split;
`004` the design's fields; `005` Category IDs; `006` Item IDs held only by dishes on the menu; `007` the Close
Table handover.

---

## 7. Roles and permissions

Each role starts from a preset ([`server/src/permissions.js`](server/src/permissions.js)). An admin can switch single
permissions on or off for one person. Every REST route and live action checks them on the server.

| Permission | Admin | Manager | Cashier | Waiter | Chef |
|---|:-:|:-:|:-:|:-:|:-:|
| See the Overview, every order and the floor | ✓ | ✓ | orders only | — | — |
| Manage any order (add items, split, merge, transfer, close) | ✓ | ✓ | — | own orders | — |
| Take payments | ✓ | ✓ | ✓ | if "Can take payment" | — |
| See prices / see bills | ✓ | ✓ | ✓ | see below | — |
| Approve requests with the PIN, refund | ✓ | ✓ | — | — | — |
| Tables, menu, staff (below manager), reports | ✓ | ✓ | — | — | — |
| Managers and admins, settings, audit log | ✓ | — | — | — | — |

**A waiter's payment permission** has three levels, set by a manager:

| Level | Bill | Amounts | When every dish is served |
|---|---|---|---|
| Can take payment | Sees it, takes the money | Sees bills; dish prices follow their "Sees prices" switch | **Bill & Payment** |
| Close table only | Never sees it | Never sees any amount | **Close Table** (the bill goes to the counter, the table is free) |
| No access | Never sees it | Never sees any amount | Nothing; a manager closes the table |

**Hierarchy:** a person sees and manages only the roles below their own; an admin sees everyone and is the only
one who can switch a manager's access off. A role change, deactivation or password reset signs the person out at once.

---

## 8. How each part works

### 8.1 Sign-in, sessions and tokens
- Sign-in is role + Staff ID + password ([`server/src/routes/auth.js`](server/src/routes/auth.js)). An email also works as the ID.
- A sign-in creates a row in `sessions`; the token (JWT, 12 hours) carries the session id, so the server can end one
  device or all of them. Every live action re-checks that the session is still valid (cached for 30 seconds).
- Five wrong passwords lock that sign-in for 1 minute, then 5, then 15. The same lock protects the approval PIN.
  These counters are kept in the server's memory, so a restart clears them.
- Roles listed in the restaurant setting `otp_roles` also need a one-time code, given to them by a manager (no SMS or email).
- **Developer mode** (`DEV_LOGIN=1` in `server/.env`): the first screen lists the people for one-tap sign-in. It is
  refused on any hosted server and through any tunnel, except the public demo's in-memory database.

### 8.2 First-run set-up and new restaurants
- An empty server shows **Set up your restaurant** in the app: restaurant name, `SETUP_CODE`, the admin's name,
  Staff ID, password and approval PIN. Once a restaurant exists the screen never appears again.
- The admin's Overview then shows **Getting started** (tables, menu, waiters, kitchens and chefs).
- Further restaurants on the same server: `npm run restaurant:add` (see README › Setting up a real restaurant).

### 8.3 The floor: areas, tables, locking
- Dining areas hold tables with a drawn layout. Floors exist in the database but the app shows them only when a
  restaurant has more than one.
- **One waiter per table.** Taking a table is one atomic `UPDATE`; a table taken without an order is freed after 5
  idle minutes by a sweep that runs every 30 seconds and skips the database when nothing is waiting.
- **Split** divides a table by seats into parts (T4 → T4.1, T4.2, at most 12). The seated party stays together on
  the first part with exactly its seats; only free seats make more parts. **Merge** puts parts back together;
  **join** pushes whole tables together for one party; **transfer** moves a party to a free table at any time.
  All in [`server/src/ws/floor.js`](server/src/ws/floor.js).

### 8.4 Ordering
- Dine-in needs the waiter to hold the table. Each line is resolved against the menu **on the server** (price,
  portion, add-ons, tax), so the app cannot set a price (except an open-price dish, where the waiter types it).
- Each send makes one numbered KOT per kitchen. A dish can show at several kitchens.
- A waiter may edit or remove a dish until the kitchen starts preparing it. After that, taking it off needs a
  manager's approval: a cancel (still cooking or ready) or a void (already served).

### 8.5 Kitchen
- The chef's board has three tabs: **New orders** (Accept, or Deny dishes they cannot make, which tells the waiter),
  **Preparing** (Start preparing, tick each dish ready or All ready) and **Done**. Everything happens on the board.
- A chef sees only their own kitchens' dishes and can switch their dishes off when one runs out (My dishes).

### 8.6 Bills, payments and refunds
- The bill ([`server/src/bill.js`](server/src/bill.js)): items total → discount (percent or fixed, with a reason;
  above the person's limit it waits for a manager) → service charge (dine-in only, optional) → tax per rate
  (added on top or included, shown as CGST + SGST halves) → round off → total. Dishes not served are never charged.
- A bill can be paid only when every dish is served or dead and no request is waiting for a manager. Payments
  can be split across methods; a failed attempt is recorded and changes nothing; the same payment sent twice is
  recorded once.
- A paid dine-in table stays **Paid** until someone taps Close Table (the guests have left). A paid bill never
  changes; money goes back only as a refund, approved with a PIN.
- Print and share use the device's own print dialog and share sheet (PDF). There is no direct printer link.

### 8.7 Close Table without payment (2.0.3)
- For a waiter set to "Close table only": once every dish is served, their order offers **Add Items** or **Close
  Table** (Close Order for takeaway and delivery).
- `order.handover` ([`server/src/ws/billing.js`](server/src/ws/billing.js)) marks the order `handed_over_at`, asks
  for the bill (it appears in the manager's Payments, marked "Table closed"), and frees the table at once. From
  then on the order is locked for everyone: no items added, edited or removed.
- `order.reopen` (managers): puts the order back on its table, unlocked, and takes it out of Payments until it is
  closed again. Allowed only while the bill is unpaid **and** the table is still free: nobody seated and no newer
  order on that table since the closing. Otherwise the bill screen says why and the button is disabled.
- Paying a closed table finishes its order at once and never touches the table (it may hold new guests).
- Limits of this first version: a closed order that sat on joined tables comes back on its main table only; one
  that sat on a split part that has since been put away cannot be reopened.

### 8.8 Approvals and the PIN
- Discount above a limit, cancel, void and refund create an approval request. A manager or admin decides with
  their own 4-digit PIN, checked on the server (bcrypt hash, the lock in 8.1). Every decision is audited.

### 8.9 Menu and menu import
- Categories, then dishes, each dragged into order and switched on and off (asked first). A dish has an Item ID,
  portions, add-ons, open price, tax, its kitchens and Goes Well With.
- **Import** ([`server/src/importer.js`](server/src/importer.js), [`server/src/routes/import.js`](server/src/routes/import.js)):
  the client's template (Excel with a "Menu Import" and a "Read Me" sheet, or CSV), at most 5 MB and 2,000 rows.
  Every row is checked and previewed first; then the import runs as one transaction, one at a time per restaurant.
  A new category is created only together with at least one saved dish. The column list is in README › Importing the menu.

### 8.10 Pictures
- Stored in the `images` table, at most 400 KB each; the app shrinks them before uploading.

### 8.11 Reports and the business day
- Reports (Overview, Sales, Menu, Orders, Staff, and one person's numbers) are worked out from the orders when asked.
- "Today" is the restaurant's business day: from `day_start` (default 05:00) in its time zone (default Asia/Kolkata).

### 8.12 Audit log
- `audit()` in [`server/src/orders.js`](server/src/orders.js) is called for every sensitive action. A trigger in the
  database (migration 002) refuses to update or delete any audit row.

### 8.13 Keep-awake on the free plan
- Render's free plan puts the server to sleep after 15 minutes without a request or WebSocket message; the next
  phone then waits about a minute. An open app pings every 25 seconds, which keeps the server awake.
- Within `KEEP_AWAKE_HOURS` (default 09:00–23:30 India time) the server also requests its own `/health` every 5
  minutes ([`server/src/keep-awake.js`](server/src/keep-awake.js)). `/health` never touches the database, so the
  database can still sleep.
- A sleeping server cannot wake itself: [`.github/workflows/wake-server.yml`](.github/workflows/wake-server.yml)
  wakes it at 08:52 and 09:07 India time. **When the opening hours change, change both** (the Render variable and
  the two times in the workflow, which are in UTC).
- Off on a laptop and on the demo. **Switch it off once the server is on a paid plan** (`KEEP_AWAKE_HOURS=off`, and
  disable the workflow), because paid services never sleep.

### 8.14 The public demo
- [`server/src/demo.js`](server/src/demo.js) runs the same server on an in-memory database (PGlite) filled from
  `seed.sql`, and serves the web build (`server/demo-web`) from the same address with one-tap sign-in. It never
  reads `DATABASE_URL`, so it cannot reach a restaurant's data. Everything resets whenever the service restarts.
- The database is prepared at build time (`npm run demo:snapshot` writes `demo-db.tgz`), so a start takes about
  half a second.
- In the demo data, Maya takes payment and Amit is "Close table only", so both waiter flows can be shown.

---

## 9. Operations runbook

All commands are for Git Bash on Windows (the development laptop) unless said otherwise.

### 9.1 Run it locally
```bash
cd server && npm run db:local      # local PostgreSQL (PGlite) on port 5433, data in server/.pgdata
cd server && node src/index.js     # API on port 4000 (applies migrations at start)
cd app && npx expo start --web     # the app in a browser (or the "potko-web" preview on port 8081)
```
`server/.env` needs `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres`, a long random
`JWT_SECRET`, and `DEV_LOGIN=1` for one-tap sign-in. The local database holds the owner's own test data; test on
free tables and close what you open.

If the local database refuses every connection after a crash, restart `db:local`, then the API. A database folder
damaged by a hard kill can only be rebuilt (delete `server/.pgdata`; it is recreated from the seed).

### 9.2 Tests
```bash
cd server && npm test     # about 15 seconds, 92 tests
```
Run them after every server change and before every release.

### 9.3 Deploy the server
- Push to `main`. Render rebuilds `potko-server` when anything under `server/` changed, applies new migrations at
  start, and switches over when `/health` answers. Check: `https://potko-server.onrender.com/health` shows the new
  `version` (from `server/package.json`).
- Rollback: Render can roll back to recent deploys (Render dashboard › the service › Events). Migrations only go
  forward; so far every migration adds tables or columns, which older code ignores.

### 9.4 Release checklist (server and app always go together)
1. Change the code; `npm test` passes.
2. Bump the version: `app/app.json` (`version` and `android.versionCode` + 1) and `npm version X.Y.Z --no-git-tag-version`
   in `server/`. Write the `CHANGELOG.md` entry.
3. If app code changed, rebuild the demo's web app (9.5).
4. Commit on `main`, tag `vX.Y.Z`, push `main` and the tag. Wait for `/health` to show the version.
5. Move `demo` to the same commit and push it (`git branch -f demo main && git push origin demo`); check the demo.
6. Build the APK (9.6), check it, give it to the restaurant to install on **every** phone.
7. Update the client guide.

### 9.5 Update the public demo
```bash
cd app && EXPO_PUBLIC_API_URL=same-origin NODE_ENV=production npx expo export --platform web --output-dir ../server/demo-web --clear
```
Commit `server/demo-web` and push the `demo` branch. Use `--clear`, or the build can keep an old address.

### 9.6 Build the Android app (APK)
```bash
cd app
CI=1 npx expo prebuild --platform android --no-install   # after a version bump, an icon change or a new native package
git checkout -- package.json                              # prebuild rewrites the android/ios scripts; put them back
npm run apk -- https://potko-server.onrender.com           # → release/POTKO-<version>.apk
```
- Needs the Android SDK and **JDK 21** (the laptop's default JDK 24 is refused; the script picks JDK 21). Gradle
  downloads hang over IPv6 on some networks: the script sets `-Djava.net.preferIPv4Stack=true`.
- A full build takes 20 to 30 minutes on the laptop (7.3 GB of memory). **Never run the emulator during a build**:
  the C++ step then runs out of memory. A stopped build resumes where it stopped.
- `npm run apk` only runs prebuild when `app/android` is missing, and the Android version number comes from the
  last prebuild. **Never edit `app/android` by hand** (it is generated from `app.json`; see `app/AGENTS.md`).
- Check a new APK: `aapt2 dump badging` (version name and code), `apksigner verify --print-certs` (same certificate
  as the last release, or phones must uninstall first), and that the built-in address is the right server.
- The APK is signed with the standard Android **debug** key (see [section 13](#13-security-review)). Package name
  `com.potko.app`.

### 9.7 Set up or reset a restaurant's database
- A new restaurant on an empty database: `npm run db:schema`, give the client the `SETUP_CODE`, they use the app's
  first-run screen. Never run `db:setup` (it loads the demo data) on a real restaurant.
- `npm run db:clear -- --yes` empties a database (asks no questions after `--yes`; take a backup first).
- Run any script against the online database by passing `DATABASE_URL` for that one command. Never print it.

### 9.8 Change the opening hours (keep-awake)
Render › potko-server › Environment › `KEEP_AWAKE_HOURS` (for example `10:00-23:00`; `18:00-02:00` runs past
midnight; `off` stops it). Then move the two cron times in `.github/workflows/wake-server.yml` to just before
the new opening time (cron is in UTC; India is UTC+5:30).

### 9.9 Backups
**Nothing is backed up automatically today.** Until that changes, take a copy before any risky change (a release
with a migration, a clear) with `pg_dump` against the online database, and look up Neon's own restore window
for the plan in use. See [section 14](#14-what-to-do-next-must-should-could).

### 9.10 Logs and monitoring
Server logs are in the Render dashboard (service › Logs). There is no error tracking or uptime alerting yet.
`/health` answers `{ ok, version, keepAwake: { hours, lastPing } }` and is safe to poll (no database access).

### 9.11 Sharing a test build from the laptop
`.tools/` holds `cloudflared` for a temporary public link to the laptop's server and web build (see README and the
scripts there). These links die with the laptop session; use the public demo for anything lasting.

---

## 10. Testing and quality

**Server tests** (`server/test/`, Node's built-in test runner). Each test file starts the real server on a free port
against a throwaway in-memory PostgreSQL (PGlite) with every migration and the demo data, signs people in, and
drives it through REST and live WebSocket actions, exactly like the app.

| File | Covers |
|---|---|
| `api.test.js` | Permissions and the staff hierarchy, table access and locking, KOT routing, the kitchen flow, add-ons, discounts and approvals, the PIN lock, payments, merge, join and transfer, floors, paid bills staying fixed, open price, sessions, reports, developer sign-in, the audit log |
| `bill.test.js` | The bill arithmetic: discounts, service charge, tax included or added, round off |
| `importer.test.js`, `menu-import.test.js` | Reading menu files; importing into new and existing categories (the brief's cases) |
| `split.test.js` | Splitting with a seated party, re-cuts, bill splits |
| `setup.test.js` | First-run set-up with the setup code |
| `keep-awake.test.js` | Opening hours, past midnight, where keep-awake stays off |
| `close-table.test.js` | 2.0.3: no amounts for a "Close table only" waiter, Close Table, Reopen and its limits, paying a closed table |

**The app has no automated tests.** Screens were checked by hand in the browser preview and on the Android
emulator at every release. Recommended additions: component tests for the order and bill screens, and an
end-to-end smoke test (Maestro or Detox) for "seat, order, cook, serve, bill, pay, close".

**Release checks used so far** (scripts that are not in the repository; worth adding under `server/scripts/`):
11 checks against the demo (page, same-origin API, sign-in, import preview, split rule), 7 checks of the 2.0.3
flow on the demo, and a load test (many waiters sending orders at the same second).

---

## 11. Limitations and known issues

**Hosting**
- The free Render plan: 0.1 CPU and 512 MB, sleeps after 15 minutes without use (the keep-awake covers opening
  hours), may restart at any time (the phones reconnect by themselves).
- All free services of a Render workspace share **750 running hours a month**; if they run out, Render suspends
  every free service until the 1st, the client's server included. The client's server uses about 460 hours with the
  keep-awake. A phone or tablet left open on POTKO overnight also keeps the server awake, and so does every visit to
  the demo. Two services awake around the clock would exceed the limit.
- Neon free: 1 GB of storage, 100 compute-hours a month, 5 GB of data out. The database sleeps after 5 idle
  minutes (pings do not touch it).

**Product**
- **No offline mode.** Without internet, nothing can be ordered.
- **No push notifications.** Alerts (sound, vibration, banners) work only while the app is open.
- **No printer integration.** No kitchen ticket printing, no thermal bill printer; the device's print dialog only.
- **No payment gateway.** UPI, card and wallets are confirmed by the staff member; no dynamic QR.
- **No SMS, email or WhatsApp.** New logins, reset passwords and one-time codes are passed on by a manager.
- **English only.**
- **Android only** in practice. iOS has never been built (it needs an Apple developer account); the web build is
  used only for the demo.
- **Manual app updates.** Each release means installing a new APK on every phone; there is no store listing and
  no over-the-air update.
- **One tax rate per restaurant** (with per-dish overrides), shown as CGST + SGST. The bill format and GSTIN
  printing have not been checked by an accountant.
- A dish marked ready by mistake cannot be un-marked from the kitchen board. Custom report dates are typed as
  year-month-day.

**Known issues to tell the client**
- **Install 2.0.3 on every phone.** The 2.0.3 server no longer sends amounts to "Close table only" waiters; on an
  older app those waiters would see ₹0 on a bill screen.
- **Close Table frees the table at once**, so a waiter should close it when the guests are leaving, not while
  they are still eating.
- Wrong-password and PIN locks, the duplicate-action memory and who is online live in the server's memory and
  reset on a restart.

---

## 12. Capacity and scaling

**Measured** on the free plan (the demo: 0.1 CPU, database on the same machine):

| Load | Result |
|---|---|
| One order | Confirmed in about 0.3 s |
| 5 orders sent at the same second | About 1.2 s each |
| 15 orders at the same second | About 4 s each (9 s from cold) |
| Sustained | About 50 complete orders a minute (seat, order, cook, serve, bill, pay, close) |
| Storage | About 5.5 KB per complete order: 1 GB holds roughly 190,000 orders |

A single restaurant's busiest hour is far below this. The weak points are sleeping, the shared free hours, and
0.1 CPU when many phones reconnect at once.

**Stages**

| Stage | When | What to change |
|---|---|---|
| 1. First paying restaurant | Now, before the restaurant depends on it | Move `potko-server` to Render Starter (about $7 a month as of October 2026: 0.5 CPU, never sleeps). Set `KEEP_AWAKE_HOURS=off` and disable the wake workflow. Add backups and uptime monitoring. Sign the APK with a private release key |
| 2. 3–5 restaurants (the design target) | As restaurants are added | A bigger instance if CPU is the limit (Render Standard, 1 CPU / 2 GB). Neon's paid plan for an always-on database, more storage and longer restore history. Watch slow queries (`pg_stat_statements`) and add indexes. Over-the-air updates for JavaScript-only changes. Crash reporting |
| 3. Tens of restaurants | Growth | More than one server process (see below), pictures in object storage with a CDN instead of the database, reports pre-aggregated per day, rate limiting on REST |
| 4. Beyond | Expansion | Several regions, store distribution (Play Store, App Store), per-country tax and currency |

**What must change before running more than one server process.** Today the server keeps some state in memory,
which only works with one process:

| State | Where | Replace with |
|---|---|---|
| Open WebSocket connections and the broadcast (`emit`, `toEach`) | `server/src/ws/events.js` | A shared message bus (for example Redis pub/sub), so an action on one process reaches screens connected to another |
| Duplicate-action memory (`recent`) | `server/src/ws/events.js` | Redis with a 10-minute expiry, or a database table |
| Wrong-try locks | `server/src/auth.js` (`attempts`) | Redis or a database table |
| Who is online | `server/src/ws/events.js` | Redis |
| Stale-lock sweep | `server/src/ws/tables.js` | Safe to run on every process (plain SQL), or run it on one |

Everything else is already shared through PostgreSQL, and every query is scoped by `restaurant_id`, so
restaurants can later be moved to separate databases if needed. The pool is 5 connections per process; use Neon's
connection pooler when there are several processes.

---

## 13. Security review

**In place**
- Every rule and permission is checked on the server; screens receive only what their user may see (`scope.js`).
- Passwords and PINs are bcrypt hashes. Sign-in and the PIN lock after 5 wrong tries.
- Sessions can be ended per device or for everyone; deactivating someone signs them out at once.
- Money is computed on the server from the menu; paid bills never change; the audit log cannot be altered.
- Uploads are limited (JSON 100 KB, menu files and pictures 8 MB per request, pictures 400 KB, menu files 5 MB).
- Developer sign-in is refused on hosted servers (except the in-memory demo) and through tunnels.

**Risks, with what to do**

| Risk | Recommendation |
|---|---|
| The repository is public: anyone can read the code and the demo logins | Make it private if that is not intended (GitHub › Settings › Change visibility). The wake workflow then uses about 60 of the 2,000 free Actions minutes a month |
| The APK is signed with the public Android debug key. Anyone could build an "update" with the same signature | Create a private release keystore, keep it safe (losing it means every phone must uninstall and reinstall), and sign every release with it. The switch itself needs one uninstall on every phone |
| CORS allows every origin (`app.use(cors())`) | Restrict it to the demo's address; the Android app does not need CORS |
| The sign-in token travels in the WebSocket address (`/ws?token=`) and can appear in proxy logs | Send it in the first message instead, or use a short-lived ticket |
| No rate limiting except sign-in and PIN | Add a per-IP and per-user limit on REST |
| No automated backups or restore drill | Nightly `pg_dump` to private storage, and a tested restore |
| Wrong-try counters reset on restart | Keep them in the database or Redis (see section 12) |
| `SETUP_CODE` is still in Render after set-up (harmless: the server refuses set-up once a restaurant exists) | Remove it from Render once the client has set up, as tidiness |
| Dependencies age | `npm audit` and Expo SDK upgrades on a schedule |

---

## 14. What to do next: must, should, could

**Must, before a restaurant depends on POTKO**
1. Paid Render plan for `potko-server`; switch keep-awake off.
2. Automated daily backups and one tested restore.
3. Uptime monitoring with alerts, and error tracking on the server (for example Sentry).
4. A private release keystore for the APK.
5. Decide the repository's visibility.
6. An accountant checks the GST bill (rate, GSTIN, what is printed).
7. Fill in the support contact in the client guide.
8. Install the current APK on every phone.

**Should, next versions**
1. **Offline ordering**: queue orders on the device and send them when the connection is back (the server's
   duplicate-action protection already makes retries safe).
2. **Printing**: kitchen tickets per kitchen and bills on thermal printers (ESC/POS over network or Bluetooth).
3. **Push notifications** (Firebase) for ready dishes, bill requests and approvals when the app is in the background.
4. **Over-the-air updates** (EAS Update) so JavaScript-only changes do not need a new APK; Play Store internal testing.
5. **Payment gateway**: dynamic UPI QR with automatic confirmation (Razorpay or similar).
6. **App tests**: component tests and an end-to-end smoke test; put the release check scripts in the repository.
7. Close Table refinements: reopen onto joined tables and split parts (see 8.7).
8. Pictures in object storage when the database grows.

**Could, later**
- Hindi and Punjabi screens; reservations; inventory and stock; customer records and loyalty; iOS; per-country tax
  and currency; pre-aggregated reports and exports for accounting.

---

## 15. Decisions to keep

These came from the owner and the client and override the original specification. Do not undo them without the owner.

**Waiters and tables**
- Tap a table to open it (a free table: guests, then the menu; a busy one: its order with Add Items). Hold a table
  for its operations only (Split, Merge, Transfer; Separate and Close when they apply). Same for waiter and manager.
- After Send to Kitchen the waiter returns to the New Order page.
- A split keeps the seated party together on the first part; only free seats make further parts.
- Transfer works at any time, not only after payment.
- Guests are counted when seating a table.
- **Payment permission has three levels.** "Close table only" waiters never see an amount and get only Add Items or
  Close Table; the manager makes the bill and can reopen a closed table while it is still free (2.0.3).
- Floors are hidden unless a restaurant already has more than one; set-up is "Add Dining Area" only.

**Kitchen**
- Accept first: New orders (Deny or Accept) → Preparing (Start preparing, tick ready) → Done, all on the board.
- Kitchens (More › Kitchens) is the one place to assign dishes and chefs to a kitchen. The screens say **kitchen**,
  never "terminal" (except the import file's "Kitchen Terminals" column).

**Menu and staff**
- The import format is the client's own template (Item ID, Category ID, `Name:Price|…` lists).
- Item and Category IDs are 1 to 12 letters, digits, hyphens or underscores; a deleted dish frees its Item ID.
- Staff sign in with a **Staff ID**. Managers see and manage only roles below them.
- Add Item and Add Category ask first: Add Manually or Import from File.

**Design**
- The Figma "finals" section is the design. Colours are fixed (no colour picker); appearance means theme, text
  size and density in Settings.
- One word for one thing; long names wrap instead of being cut; item counts are quantities; every on/off switch
  asks first; no Edit buttons in headers; one step row in multi-step forms; chip rows never stretch.

**Security and money**
- Approvals use the 4-digit Manager PIN only. Prices and tax come from the server; paid bills never change.

---

## 16. Engineering conventions

- **Server first.** Put every rule in the server and test it there; the app only reflects it.
- **Money** only through `bill.js`; store snapshots on order lines; never recompute an old bill from today's menu.
- **Statuses** of orders come from their dishes; do not set them by hand.
- **Migrations**: a new numbered file for every database change; never edit one that has run anywhere. Keep them
  additive where possible, so a rollback of the code still works.
- **What a screen receives** is decided in `scope.js`, never by hiding things in the app alone.
- **Theme**: colours, radii and font sizes only from `app/src/theme/tokens.js` via `useTheme()`.
- **Expo**: install packages with `npx expo install`; never edit `app/android` (generated); check the Expo
  SDK 57 documentation rather than memory (see `app/AGENTS.md`).
- **Words on screen**: short, plain, and the same word everywhere for the same thing.
- **Commits** describe the change in plain words; version tags `vX.Y.Z`; the CHANGELOG is written for the owner.
- **Release** server and app together, after the tests pass, and update the client guide.

---

## 17. Open items and pending decisions

| Item | Owner | State |
|---|---|---|
| Hosting plan (free with keep-awake, or Render Starter) | Owner | Free plan with keep-awake (option B) chosen on 22 Oct; Starter recommended before real dependence |
| Repository visibility | Owner | Public today |
| Release keystore | Developer | Not created; APKs use the debug key |
| Backups and monitoring | Developer | None yet |
| Support contact in the client guide | Owner | Empty |
| Accountant check of the GST bill | Owner / client | Not done |
| Installing 2.0.3 on the client's phones | Client | To do |
| Reopen onto joined tables and split parts | Developer | Not built (8.7) |
| Offline mode, printers, push, payment gateway, languages | Owner to prioritise | Not built |

---

## 18. Glossary

| Term | Meaning |
|---|---|
| KOT | Kitchen order ticket: the list of dishes one kitchen must cook for one send |
| Kitchen (terminal) | A kitchen station with its own board (Main Kitchen, Tandoor). "Terminal" is the database word |
| Dining area / floor | Groups of tables (Main Hall, Garden). Floors group dining areas |
| Split / merge / join / transfer | Divide a table by seats / put parts back together / push whole tables together for one party / move a party to another table |
| Bill requested / at the counter | The waiter asked for the bill; it waits in Payments for whoever takes payments |
| Close Table (handover) | A "Close table only" waiter finishes the table: bill to the counter, table free, order locked (2.0.3) |
| Reopen | A manager puts a closed table's order back on its table (2.0.3) |
| Void / cancel | Taking off a dish that was served / that the kitchen already started (both need a manager) |
| Staff ID | The sign-in name of a person (for example W-104) |
| Setup code | The one-time code the client types to create their restaurant on an empty server |
| Approval PIN | A manager's or admin's 4-digit code for approvals |
| Business day | The restaurant's day for reports, starting at `day_start` |
| Keep-awake | The free-plan workaround that keeps the server from sleeping during opening hours |
