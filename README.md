# POTKO

Restaurant POS and kitchen (KOT) app for 3–5 restaurants. Waiters take orders on a phone or tablet, each
kitchen terminal sees its own tickets instantly, and the manager runs the floor, settles bills and approves
sensitive requests with a PIN.

- `app/` — the Expo (React Native) app. One codebase for phone, tablet and web.
- `server/` — Node.js: Express for login and data, `ws` for live events, PostgreSQL for storage.
- `spec/` — the product specification and design sheets this version was built from.

## What each role can do

| Role | Screens |
|---|---|
| **Waiter** | New order (dine-in with table lock, delivery, in-car takeaway), the tables of their own dining areas, menu with name/code search, portions and paid add-ons, order status as tags (edit, remove, add more, replace an unavailable dish, request a cancel or void), the Tables screen (tap a free table to seat guests, tap a busy one to open its order and add items; hold a table for its operations: split, merge, transfer at any time, separate, close), Ready tab, Given Orders narrowed by floor and dining area, bill with discount and payment (or "send bill to counter" when they may not take payments or see bills) |
| **Chef** | One kitchen board for the kitchens they are assigned to, in three sections: **New orders** (Deny or **Accept**), **Preparing** (accepted tickets: **Start preparing**, then tick each dish ready, All ready) and **Done**. Everything is done on the board, so the chef never has to open a ticket; a ticket can still be opened on its own for a closer look and a prep time. **My dishes** switches their own dishes off when one runs out |
| **Cashier** | Signs in at the manager desk and gets Tables and Payments: the payment queue, bill review, discounts within their limit, split payments, print and share the bill |
| **Manager** | Four places: **Overview** (service running now, today's numbers, what needs attention), **Tables** (floor view of one dining area at a time, and list view of any mix of dining areas ticked in the picker; tap a busy table for its order, hold it for split, merge and transfer; order detail with status tags and full history), **Payments & Approvals** (payment queue, bill, approvals with a 4-digit PIN), **More** (Tables, Kitchens, Menu, Staff, Reports, Settings). A manager sees and manages only the roles below manager |
| **Admin** | Everything a manager has, plus managers and admins (including switching a manager's access off), per-person permissions (among them who may see prices and bills), restaurant profile, tax and billing, printers, service hours and the audit log |

Under **More**:

- **Tables** — the dining areas (Main Hall, Garden, Rooftop), built like the menu's categories: search,
  switch on and off (asked first), drag into order. Inside an area its layout (drag tables into place) and
  its table list (drag into order, switch each table on and off). (The database also has a floor above the dining areas. The app has no "add
  floor": a restaurant that already has several floors sees its areas grouped by floor, everyone else sees
  dining areas only.)
- **Kitchens** — each kitchen (terminal) with the dishes it cooks and the chefs who work there: add a
  kitchen, tick its dishes one by one or a category at a time, assign its chefs. A dish is usually cooked
  at one kitchen and may be shown at several; a dish no kitchen was given is cooked at the default one.
- **Menu** — categories, then their dishes (both dragged into order and switched on and off, asked first).
  A dish has an Item ID, portions, add-ons, open price, tax, its kitchens and **Goes Well With** (dishes the
  waiter is offered with it). Add Category and "+ Add" in a category both ask **Add Manually** or **Import
  from File**; see [Importing the menu](#importing-the-menu).
- **Staff** — who is online; a profile with Overview, Role & Access and Activity; add or edit in steps
  (details, then by role: a waiter's dining areas, tables, payment permission and price visibility, a chef's
  kitchens); switch access off and on, reset password, log out of all devices, delete. A manager does this for waiters, chefs and cashiers; an admin for managers too.
- **Reports** — Today, 7 days, 30 days, 3 months, 1 year or custom dates; Overview, Sales, Menu, Orders and
  Staff, with one person's own numbers.
- **Settings** — Restaurant Profile, Appearance (theme, text size, density; the colours are fixed), Manager
  PIN, Account & Security, POS & Devices, System Preferences. Waiters and chefs have a short Settings page of
  their own in the account menu.

Every inner screen shows a breadcrumb trail under its title (More › Staff › Maya), each step a link back.

## The rules the server enforces

These are checked on the server for every action, so a modified or out-of-date app cannot get round them.

- **Permissions.** Each role has a set of permissions and an admin can switch single ones on or off per
  person. Every route and live action checks them. Hiding a button in the app is never the authorization.
- **One waiter per table**, and only tables they are assigned: taking a table is one atomic database update;
  a table locked without an order is freed after 5 idle minutes.
- **Kitchen tickets.** Every dish goes to its kitchen terminal (or the default one). Each send makes one
  numbered KOT per terminal, and a chef can only act on the dishes of their own terminals.
- **Edit lock.** A waiter can edit or remove a dish only until the kitchen starts preparing it. After that,
  taking it off needs an approved cancel (still cooking or ready) or void (already served).
- **Money.** Prices, add-ons and tax always come from the menu on the server and are saved on each order line,
  so a bill never changes when the menu or the tax rate changes later. Bills are added up in paise:
  discount (percent or fixed, with a reason), optional service charge, tax per rate (included in the price
  or added on top, shown as CGST + SGST), round off. Dishes that were not served are never charged.
- **Discount limit.** Each waiter and cashier has a limit. Above it the discount waits as a request and is
  not on the bill until a manager approves it.
- **Approvals** (discount, cancellation, void, refund) need the approver's own 4-digit PIN, checked on the server.
  Five wrong tries lock the PIN, for longer each time. Every decision is recorded with who and why.
- **Payment.** A bill is paid only when every dish is served, removed, unavailable or cancelled and nothing
  is waiting for approval. A failed attempt changes nothing, parts by different methods add up, and the same
  payment sent twice is recorded once. A paid bill cannot be changed; money goes back only as a refund.
- **Tables.**
  - *Split* divides a table by seats into parts (T4 with 6 seats becomes T4.1 with 4 and T4.2 with 2; the
    seats always add up). The party already seated stays together on the first part with exactly its seats,
    and only the free seats make further parts: 4 seats with 2 guests can be 2 + 2 or 2 + 1 + 1, never four
    parts; 6 seats with 2 guests, 2 to 5 parts; a table its guests fill cannot be split. Nobody seated: 2
    parts up to the seats. The order, its tickets, discount and payments stay with the party, unchanged.
    Dishes can be moved to another part to give it a bill of its own (splitting the bill, not the seating);
    the bills then add up exactly to the original. A split can be re-cut (a part with guests keeps at least
    their seats), a part guests leave is free again, and when every part is free the table is whole again.
  - *Merge* brings parts back together. *Join* pushes whole tables of one dining area together for one party
    (T3 + T4), with one order and one bill, until that bill is closed or the tables are separated. A paid bill
    is never folded into another.
  - *Transfer* moves a party to a free table at any time; the order and its kitchen tickets go along and the
    kitchen is told. A paid table stays "Paid" until someone closes it.
  - The floor shows all of this as drawings: tables with their chairs, a split table cut into its parts,
    joined tables fused into one.
- **Hierarchy.** A person sees and manages only the roles below their own; an admin sees everyone.
- **Only what is assigned reaches a device** (`server/src/scope.js`). A waiter is sent only their own dining
  areas, tables and orders; a chef only the dishes of their kitchen terminals (and a menu of just those
  dishes, which they may switch off when one runs out). Without "may see prices" the dish prices are taken
  out of everything sent; the bill total stays, so a waiter who takes payments can still collect it. A
  waiter who does not take payment is sent no amount at all: no dish prices, no bill, no payments.
- **A dish can show at several kitchens.** Usually one; a dish ticked at several terminals (in the dish form
  or under More, Kitchens) shows on every one of them, and any of those chefs can start it.
- **Payment permission** for a waiter has three levels: take payment, close the table only (a manager or
  cashier takes the money), or no access (neither). A manager sets it, and price visibility, for waiters and
  cashiers; every other permission is the admin's. Only a waiter who takes payment sees prices and bills.
- **Close Table** (a waiter who closes the table only): when every dish is served, the waiter's order offers
  Add Items or Close Table. Closing sends the bill to Payments, frees the table at once for the next guests
  and locks the order (`order.handover`). A manager can reopen it on its table (`order.reopen`) while the
  bill is unpaid and the table is still free: no guests seated and no newer order since the closing. Paying
  a closed table finishes its order without touching the table.
- **Open price.** A dish marked "Open Price" has no menu price; the waiter types it in when ordering.
- **Sessions.** Signing in creates a session the server can end: log out one device or all, a password
  reset, a role change or deactivation sign the person out at once.
- **Audit log.** Sign-ins, credential and PIN changes, staff and permission changes, areas, tables and layout,
  menu edits and imports, orders, approvals, payments, refunds and printed bills are recorded with who, their
  role, when, old and new values and the reason. Records cannot be changed or deleted.

## Run it on your machine

You need Node.js 20 or newer.

### 1. Server

```bash
cd server
npm install
cp .env.example .env
```

**With no database account yet** (quickest): put `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres`
and any long random `JWT_SECRET` in `server/.env`, then run these in two terminals. The first creates the tables
and demo data by itself the first time; its data lives in `server/.pgdata`.

```bash
npm run db:local
```

```bash
npm run dev
```

**With a Neon database:** put the Neon connection string in `DATABASE_URL`, then:

```bash
npm run db:setup
npm run dev
```

The server listens on port 4000. `http://localhost:4000/health` should answer `{"ok":true,...}` with the version.

**Demo logins** (an admin, a manager, a cashier, two chefs and two waiters, with three floors, four dining
areas and four kitchen terminals) are listed at the top of [`server/sql/seed.sql`](server/sql/seed.sql).

**Developer mode** (testing only): put `DEV_LOGIN=1` in `server/.env` and the app's first screen lists the
people of the test server; tap one to sign in without an ID and password. The server refuses this when it is
hosted (`NODE_ENV=production`, or on Render) and for any request that arrives through a tunnel or proxy, so
it only works on the computer (or the local network) the test server runs on.

**Tests:** `npm test` in `server/` runs the business rules against the real server on a throwaway database:
permissions and the staff hierarchy, table access, KOT routing, a kitchen's dishes, the kitchen flow (accept,
start, ready), add-ons, discounts and approvals, the PIN lock, payments, split (a seated party stays together:
`test/split.test.js`), merge, join and transfer, floors, paid bills staying fixed, menu import into existing
and new categories (`test/menu-import.test.js`), first-run set-up, staff sessions, reports, developer sign-in
and the audit log.

**Upgrading:** changes to the database are in `server/sql/migrations/`. The server applies the ones it has not
run yet every time it starts (each exactly once, existing data is kept); `npm run db:migrate` does the same
by hand. Update the server and the app together: the screens of an older app do not match the new server.

### 2. App

```bash
cd app
npm install
cp .env.example .env
npx expo start
```

- **Phone:** install Expo Go and scan the QR code. On a phone, `localhost` means the phone itself, so in
  `app/.env` replace `localhost` with your laptop's Wi-Fi IP address (for example `http://192.168.1.20:4000`),
  then restart Expo. Or leave the file alone and tap **Server** on the app's first screen.
- **Browser:** `npx expo start --web`
- **Phone on a different network:** `npx expo start --tunnel` (the server must then be reachable from the
  internet, e.g. deployed on Render).

## Setting up a real restaurant

Do **not** use the demo data for a real restaurant: its logins and PIN are public in this repository.

1. Create an empty Neon database and put its connection string in `server/.env`.
2. Create the tables only, with no demo data (or, on a database that already has data, empty it and start
   again: `npm run db:clear -- --yes`):
   ```bash
   npm run db:schema
   ```
3. **The client sets up the restaurant themselves.** Give the server a setup code (`SETUP_CODE`; on Render it
   is generated for you, see Environment). The first person to open the app sees **Set up your restaurant**:
   restaurant name, the setup code, their name, Staff ID, password and 4-digit approval PIN. They become the
   admin and are signed in; the set-up screen never shows again. (Without a setup code the screen says the
   server is not ready.) Or add the restaurant from the command line instead:
   ```bash
   npm run restaurant:add -- "Street Feast Mall Road" "Priya" "A-201" "a-strong-password" 4321
   ```
4. The admin's Overview shows **Getting started** (tables, menu, waiters, kitchens and their chefs), ticking
   itself as each is done. Everything is under **More**: **Settings** (restaurant profile, tax and billing),
   **Tables** (dining areas and their tables), **Menu** (categories, then dishes, or import them from Excel
   or CSV), **Kitchens** (each kitchen's dishes), then **Staff** (each waiter's areas, each chef's kitchens). Managers and admins set their own 4-digit approval PIN under **Settings, Manager PIN**.

Run step 3 again for each further restaurant. Staff IDs are unique across all restaurants, and each
restaurant only ever sees its own data.

## Deploy (free)

1. **Database — Neon.** Create a project and set it up as above.
2. **Server — Render.** Push this repository to GitHub, then on Render choose *New → Blueprint* and pick the
   repository: [`render.yaml`](render.yaml) describes the service. Paste the Neon connection string when asked for
   `DATABASE_URL`. Render generates `JWT_SECRET` and `SETUP_CODE`. (By hand: a *Web Service* with root directory
   `server`, build `npm install --omit=dev`, start `node src/index.js`, health check `/health`, and the
   variables `DATABASE_URL`, `JWT_SECRET` and `SETUP_CODE`.)
3. **App.** In `app/.env` point the app at Render, then run `npx expo start`:
   ```
   EXPO_PUBLIC_API_URL=https://YOUR-SERVICE.onrender.com
   ```
4. **Installable Android app.** `npm run apk -- https://YOUR-SERVICE.onrender.com` (see
   [Building the Android app](#building-the-android-app-apk)). The web build is `npx expo export --platform web`.

### Public demo

A link anyone can open to try POTKO, apart from the client's server: the `potko-demo` service in
[`render.yaml`](render.yaml), deployed from the `demo` branch. It runs `node --expose-gc src/demo.js`:

- the server with a database of its own **in memory**, filled with the demo restaurant (`sql/seed.sql`). It never
  reads `DATABASE_URL`, so it cannot reach a restaurant's data; everything starts afresh whenever the service
  restarts (on the free plan, after 15 minutes without visitors; the first visit after that takes about a minute);
- the web app from the same address (`server/demo-web`, built with
  `EXPO_PUBLIC_API_URL=same-origin npx expo export --platform web --output-dir ../server/demo-web` in `app/`);
- one-tap sign-in (developer mode), which a hosted server allows only for this in-memory demo.

The build (`npm install && npm run demo:snapshot`) saves the demo database as `demo-db.tgz`, so each start
loads it in about half a second instead of building it again (about 3 s here, far more on the free plan's tenth
of a CPU); without the file it is built at start. To update the demo: rebuild `server/demo-web` on the `demo`
branch and push; Render deploys it. It needs about 350 MB of memory (the in-memory database takes about 300 MB),
inside the free plan's 512 MB.

Free-plan limits to know about:

- Render's free service (0.1 CPU, 512 MB) sleeps after 15 minutes without a request or WebSocket message, and
  the next phone then waits about a minute. The app pings every 25 seconds while it is open, which keeps it
  awake. Render may also restart a free service at any time (the phones reconnect by themselves).
- **Opening hours.** The client's server also keeps itself awake between orders during opening hours: every
  5 minutes it asks its own address for `/health` ([`server/src/keep-awake.js`](server/src/keep-awake.js)).
  The hours are `KEEP_AWAKE_HOURS` in the service's Environment on Render (default `09:00-23:30`, India time;
  `18:00-02:00` runs past midnight; `off` stops it). A sleeping server cannot wake itself, so a GitHub job
  ([`.github/workflows/wake-server.yml`](.github/workflows/wake-server.yml)) wakes it at 08:52 and 09:07: move
  those times when the hours change. Outside the hours it sleeps 15 minutes after the last phone goes quiet,
  about 460 of the 750 free hours a month. `/health` shows the hours and the last keep-awake request. The demo
  is never kept awake. GitHub switches scheduled jobs off in a public repository after 60 days without a
  commit (it sends an email; switch it back on under Actions).
- All free services of a Render workspace share **750 running hours a month**; one service awake around the
  clock uses about 744. If they run out, Render suspends every free service until the 1st. So never keep two
  free services (for example the client's server and the demo) awake around the clock.
- Neon's free database sleeps after 5 minutes without a query (the app's pings do not touch it), and allows
  1 GB of storage, 100 compute-hours a month (about 400 hours awake at the smallest size) and 5 GB of data out.
  A complete order takes about 5.5 KB, so 1 GB holds roughly 190,000 orders.
- Measured on the free plan (the public demo, database on the same machine): an order is confirmed in about
  0.3 s; 15 waiters sending at the same second wait about 4 s each; about 50 complete orders a minute.
- Do not use Render's free PostgreSQL: it expires after 30 days.
- Before a restaurant depends on it, move the server to a paid Render plan ($7 a month at 0.5 CPU, never
  sleeps, outside the free hours).

## Importing the menu

One file holds the whole menu, and both buttons import all of it: **More › Menu › Add Category › Import from
File** and **"+ Add" › Import from File** inside a category. The import page gives the template
(`POTKO_Menu_Import_Template`: Excel with a **Menu Import** sheet and a **Read Me** sheet, or CSV). One row
per dish:

| Column | What to enter |
|---|---|
| Item ID | 1 to 12 letters, digits, hyphens or underscores, e.g. `ITM-001` or `101`. Matches the dish when the file is imported again. Empty: one is made |
| Item Name, Category Name | Required. A plain "Name" heading beside a Category column is the dish's name |
| Category ID | Optional, e.g. `CAT-001`. A new ID or name creates the category; an existing one is reused, never duplicated (names match whatever the capitals and spaces) |
| Item Description, Category Description | Optional |
| Item Type (Veg/Non-veg) | Veg or Non-veg |
| Base Price (INR) | A number; not needed with portions or an open price |
| Open Price? (Yes/No) | Yes: the waiter types the price when ordering |
| Tax Mode (Restaurant/Custom/None) | Custom uses Custom Tax Rate (%), added or included as the restaurant's tax setting says |
| Item Status (Active/Inactive), Display Order (1 = First) | Optional |
| Kitchen Terminals | `Main Kitchen\|Tandoor`. A kitchen not set up yet is created (and listed before importing) |
| Portions and Prices, Add-ons and Prices | `Regular:220\|Large:320` (no spaces needed). One portion is a plain price |
| Suggested Item IDs (for Go Well With) | `ITM-004\|ITM-005`: on the menu already or further down the file |

Every row is checked and shown first (new categories, the existing ones that are reused, dishes and new
kitchens, with any problem); then "add new only" or "also update matching" (by Item ID, else by category and
name; categories by Category ID, else name). The import is one transaction, one at a time per restaurant:

- A new category is created together with its dishes, and only if at least one of them can be saved (or the
  file lists it with no dishes), so no category is left empty because its dishes failed.
- A dish with no price (no Base Price, no portions, Open Price not Yes) is left out with the reason.
- A row that repeats a dish is counted once and said so; the same file imported again changes nothing.
- A deleted dish no longer holds its Item ID, so a file can be imported again after its dishes were deleted.
- The result counts what was saved: rows read, dishes imported, new categories created and existing ones
  reused (by name), dishes updated, duplicates skipped, rows not imported with their reasons. Problems are in
  a downloadable error report.

Older files (one row per portion, `Name|Price` lists, "Item Code") are still read.

## How it fits together

Every change follows the same path: app → server (checks role and rules) → database → broadcast to every
connected screen. The server is the only source of truth, and there is no offline ordering: while
disconnected the app shows a red "Reconnecting…" banner and blocks sending.

- **REST** is used for login, loading data and set-up (`/auth/login`, `/me`, `/sync`, `/menu`, `/menu/import`,
  `/areas`, `/tables`, `/terminals`, `/users`, `/orders`, `/overview`, `/approvals`, `/reports/*`, `/restaurant`,
  `/images`, `/audit`, …).
- **WebSocket** (`/ws?token=JWT`) carries live actions and events as JSON `{ type, payload, id }`. The server
  answers every action with `{ type: "ack", id, ok, ... }` and runs a repeated `id` only once.
  - App → server: `table.lock`, `table.release`, `order.create`, `order.addItems`, `item.edit`, `item.remove`,
    `chef.start`, `chef.deny`, `chef.itemReady`, `chef.allReady`, `waiter.deliver`,
    `discount.apply`, `approval.request`, `approval.decide`, `bill.request`, `payment.add`, `payment.refund`,
    `order.close`, `table.split`, `table.merge`, `table.unjoin`, `table.transfer`, `ping`.
  - Server → apps: `table.updated`, `tables.changed`, `floor.updated`, `order.created`, `order.updated`
    (carries every dish, so there is no separate item event), `chef.denied`, `ready.count`,
    `approval.requested`, `approval.decided`, `staff.presence`, `me.updated`, `menu.updated`,
    `restaurant.updated`, `overview.changed`, `pong`.
- After every reconnect the app calls `GET /sync` and redraws from the server's answer.
- Rows are returned as they are in the database (`snake_case`, see `server/sql/schema.sql`).
  Requests and WebSocket payloads sent by the app use `camelCase` (`tableId`, `orderId`).

### Where things are

```
app/
  app/                  screens (Expo Router)
    (auth)/             role.js (with developer mode), login.js (with one-time code), customise.js (a waiter's or chef's Settings)
    (waiter)/           bottom bar with 3 tabs
      new-order/        order type → details or tables → menu → preview; split, merge and transfer from the tables
      given-orders/     the list, one order's status, bill, split, merge, transfer
      ready.js          dishes ready to deliver
    (chef)/             kitchen board (everything happens here) and kitchen/[id] (one ticket, large)
    (manager)/          four tabs, used by manager, admin and cashier
      overview.js
      orders/           floor and list, one order, add items, split, merge, transfer
      payments/         payment queue and approvals, bill/[id], approval/[id]
      more/             tables/ (dining areas, tables), kitchens/ (and [id]: a kitchen's dishes), menu/ (items,
                        import), staff/, reports/ (and staff/[id]: one person's numbers), settings/
  src/screens/          screens shared by the waiter and the manager: BillScreen, SplitTable, MergeTable,
                        TransferTable
  src/theme/tokens.js   every colour, radius and font size — screens never hardcode these
  src/components/       Button, Chip, Card, TextField, BottomSheet, ItemSheet, TableGraphic (a table drawn with its
                        chairs), TableCard, TableSheet, FloorPlan, AreaPicker, KitchenTicket, OrderTags, PinSheet,
                        BillSummary, OrderLines, Charts, Forms, Lists, Feedback, Picture, …
  src/store/            auth (with permissions), settings (look and sound), menu, draft (dishes being chosen),
                        live (floors, areas, tables, terminals, orders, approvals), staff, toast
  src/lib/              api.js (REST), ws.js (live connection), server.js (the server's address), orders.js,
                        units.js (tables as the floor shows them), seating.js, kitchen.js, crumbs.js, prices.js,
                        access.js, receipt.js, reports.js, files.js, audit.js, format.js
  scripts/build-apk.js  builds the installable Android app (npm run apk)
server/
  src/index.js          Express + ws in one service; applies new migrations at start
  src/auth.js           tokens, sessions, the wrong-try limiter
  src/permissions.js    what each role may do, and per-person changes to it
  src/settings.js       restaurant settings with their defaults, and the business day and time zone
  src/bill.js           the bill: discount, service charge, tax, round off (one place, in paise)
  src/orders.js         shared order query, the status-from-items rule, the audit-log helper
  src/importer.js       reading, checking and matching menu files (CSV and Excel)
  src/routes/           auth, me, sync, menu, import, floor (areas, tables, terminals), users, orders,
                        reports, images, manage (restaurant, overview, history, approvals, audit)
  src/ws/events.js      live connection, rooms, presence, duplicate-action protection
  src/ws/orders.js      order.create, order.addItems, item.edit, item.remove, waiter.deliver
  src/ws/tables.js      table.lock, table.release and the 5-minute stale-lock sweep
  src/ws/floor.js       table.split (by seats), table.merge (parts, or joining whole tables), table.unjoin, table.transfer
  src/ws/chef.js        chef.start, chef.deny, chef.itemReady, chef.allReady
  src/ws/billing.js     discounts, approvals with the PIN, bill.request, payments, refunds, order.close
  src/ws/publish.js     sends a change to every screen that should see it
  src/scripts/          db.js (schema / migrate / setup / reset), local-db.js, add-restaurant.js, sql.js
  sql/schema.sql        the first version's tables; sql/migrations/ everything since; sql/seed.sql demo data
  test/                 the tests (npm test)
```

## What it does not do yet

- **No payment gateway.** UPI, card and other payments are confirmed by the person taking them, with an
  optional reference number. Nothing is charged by the app, and no card details are stored.
- **Printing** uses the device's own print dialog (any printer set up on the phone, tablet or computer) and
  the bill can be shared as a PDF. There is no direct link to a thermal printer, and kitchen tickets are
  shown on the kitchen screens, not printed.
- **No SMS or email.** A new person's login, a reset password and a one-time login code are told to them by
  a manager.
- **Approvals use the Manager PIN only.** There is no one-time code as a substitute.
- **Hidden amounts are left out of what the server sends.** Dish prices (and, for a waiter who does not take
  payment, every bill amount) are taken out of the orders, tables, menu, requests and split or merge previews
  sent to that person, and out of the answers to their own actions.
- **A dish marked ready by mistake** cannot be un-marked from the kitchen board.
- **Alerts are in-app only** (toast, sound, vibration). There are no push notifications when the app is closed.
- **Tax** is one configurable GST rate (with a rate per dish where needed), shown as CGST + SGST. Check the
  rate, the GSTIN and what is printed on bills with an accountant before real use.
- **Dates in a custom report range** are typed as year-month-day.

## Trying the Android app on this laptop

Expo Go is a phone app, so on a laptop it runs inside an Android emulator. A virtual phone is defined in
`.avd/` (not committed). With the server running, start it and open POTKO in it like this (Git Bash):

```bash
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk" ANDROID_AVD_HOME="C:/Projects/POTKO/.avd"
"$ANDROID_HOME/emulator/emulator.exe" -avd potko &
"$ANDROID_HOME/platform-tools/adb.exe" wait-for-device reverse tcp:4000 tcp:4000
cd app && PATH="$PATH:$ANDROID_HOME/platform-tools" npx expo start --android
```

`adb reverse` lets the virtual phone reach the server on `localhost:4000`, so `app/.env` needs no change.

## Building the Android app (APK)

An APK is the file an Android phone installs. It is built on this machine with:

```bash
cd app
npm run apk
```

The finished file is `release/POTKO-<version>.apk`. Send it to a phone (WhatsApp, Drive, a cable), open it
there and allow "install unknown apps" when Android asks. Needs the Android SDK and JDK 17 or 21; the first
build downloads about 1.5 GB of build tools and takes a while, later ones a few minutes.

**Which server the app talks to.** The address is put into the app when it is built:

- `npm run apk` uses this laptop's current Wi-Fi address (`http://<laptop>:4000`). The phone must be on the same
  Wi-Fi, the server must be running here, and Windows must allow Node.js through its firewall on private
  networks (it asks the first time).
- `npm run apk -- https://YOUR-SERVICE.onrender.com` uses the deployed server, from anywhere.

Either way the address can be changed on the phone without a new build: on the first screen tap **Server**,
type the address and choose *Check and save*. The app only saves an address where a POTKO server answers.

**After changing the icon, the launch screen or `app/app.json`, or adding a package with native code**
(this version added file picking, printing, sharing and picture picking), bring the Android project up to date
before building, then put the two run scripts in `app/package.json` back to `expo start --android` and
`expo start --ios` (the command rewrites them):

```bash
cd app
npx expo prebuild --platform android
```

**On a laptop with little memory** (8 GB or less) close the Android emulator and other heavy programs
while it builds; otherwise the C++ step can stop with "out of memory". A stopped build carries on from
where it was when you run `npm run apk` again.

The logo files are in `brand/` (SVG and PNG, with and without the name).

This APK is signed with a development key: right for testing and for handing to a restaurant directly, not
accepted by the Play Store. The package name is `com.potko.app` (`app/app.json`); settle it before a store
release, because it cannot change afterwards.
