# Changelog

## 2.0.3 — 2026-10-23

The client's rule for waiters who do not take payment: they never see an amount, and when the guests
are done they close the table; the manager makes the bill and takes the money. Checked in the app on
this laptop: closing, the manager's bill, Reopen, the new-guests case, payment, and a paying waiter.

### Waiters who do not take payment ("Close Table Only")
- **They never see an amount**: no dish prices on the menu or orders, no items total, no bill. The
  server no longer sends them any (orders, tables, menu, payments, the amounts on their own requests,
  and the answers to their own actions). The "Sees prices" switch only matters for waiters who take payment.
- A table's order offers only **Add Items** and, once every dish is served, **Close Table** (Close Order for
  takeaway and delivery). Closing sends the bill to the manager's Payments, frees the table at once for the
  next guests, and locks the order.
- "No Access" waiters get Add Items only; a manager closes their tables.
- Waiters who take payment: unchanged (Bill & Payment).

### Manager: Reopen Table
- A closed table's bill says who closed it and when, and **Reopen Table** takes the place of Edit Order. It
  puts the order back on its table, unlocked, so the waiter can add dishes; its bill leaves Payments until
  the table is closed again. Only while the bill is unpaid and the table is still free: no guests seated and
  no newer order since the closing (otherwise the bill says why). After payment, extra dishes go on a new
  order, so a paid bill never changes.
- Payments marks these bills "Table closed". Paying one finishes its order at once and never touches the
  table, which may already hold new guests.

### Server
- Migration 007: `orders.handed_over_at`, `handed_over_by`. New live actions `order.handover`, `order.reopen`.
- A waiter's `bills.view` follows their payment permission, and without it `prices.view` is off as well.
- Tests: `server/test/close-table.test.js` (7). All 92 server tests pass.

## 2.0.2 — 2026-10-22

The two fixes of the developer brief: the menu import puts every dish in its category, and a table split
keeps the seated party together. Backtested on 2.0.0, 2.0.1 and this version with the same scenarios.
The online server now stays awake during opening hours, and there is a public demo link.

### Menu import (categories created, dishes missing)
- Root causes found and fixed:
  - **Deleted dishes kept their Item IDs** (the unique index covered deleted rows, while the import only
    looks at the menu as it is): importing a file again after deleting its dishes created the categories and
    failed every dish ("That code or name is already used"). Item IDs now belong to dishes on the menu only
    (migration 006); nothing else changes.
  - **A plain "Name" heading** in a file started from Add Category was read as the category, and the real
    Category column was dropped: categories named after dishes, no dishes. "Name" beside a Category column
    is now the dish.
  - **A new category was created even when all its dishes failed** (no price, a bad Item ID). It is now
    created together with its dishes, as one unit, only when at least one of them is saved; otherwise it is
    left out with the reason (preview and import agree).
  - **Item IDs like 1, 2, 3 or ITM_001 were refused.** Item and Category IDs are now 1 to 12 letters,
    digits, hyphens or underscores, in the file, the dish form and the category form.
  - (2.0.0 only, fixed in 2.0.1: Add Category › Import read the category columns only.)
- The import runs one at a time per restaurant, so two imports cannot both create the same category; names
  match whatever the capitals and extra spaces; a category written with and without its Category ID is one.
- Repeated rows of a dish are counted once and reported; a header-only file is refused with a reason.
- **The result says what was saved**: rows read, dishes imported, new categories created and existing ones
  reused (by name), dishes updated, duplicates skipped, rows not imported with their reasons ("Import
  finished with problems" when any row was left out). The preview names the existing categories reused.

### Table split (seated guests)
- **The party already seated stays together** on the first part with exactly its seats; only the free seats
  make further parts. 4 seats with 2 guests: 2 + 2 or 2 + 1 + 1, never four parts; 6 seats with 2 guests:
  2 to 5 parts; 3 of 4 seated: 3 + 1 only; a full table cannot be split (the hold menu says so).
- Root cause: the split screen limited the parts to the number of guests and divided the guests between the
  parts (4 seats, 2 guests: only "2 parts", one person each), while the server checked capacity only (it
  accepted four parts). Both now use the same rule, and the server refuses anything else, including the
  older app's divided party.
- Each choice shows its seats (2+1+1) and the chosen one is drawn seat by seat before you confirm; the
  party's table is fixed and the free seats can be moved between the new tables. An order with no guest
  count asks for it first.
- The order, its dishes, tickets, prices, discount and payments stay exactly as they were. Splitting the
  bill (moving dishes to another part) keeps its own rules. A re-cut keeps each party's seats.
- The success screen names each new table again (T1.1, T1.2…), which 2.0.0 and 2.0.1 left blank.

### Public demo link
- A demo anyone can open, apart from the client's server: the `potko-demo` service on Render (`render.yaml`),
  from the `demo` branch. The server runs with its own in-memory database filled with the demo restaurant
  (it never reads `DATABASE_URL`; the data starts afresh on every restart) and serves the web app from the
  same address, with one-tap sign-in. See README, Public demo.
- Developer sign-in stays off on every hosted server except that in-memory demo (tested).

### Online server awake during opening hours
- Render's free plan puts the server to sleep after 15 minutes without use, and the next phone waits about a
  minute. During opening hours (`KEEP_AWAKE_HOURS` on Render, default `09:00-23:30` India time) the server
  now asks its own address for `/health` every 5 minutes, so it does not fall asleep between orders. Outside
  them it sleeps as before, which keeps the workspace inside Render's 750 free hours a month (about 460 used).
- A GitHub job (`.github/workflows/wake-server.yml`) wakes it at 08:52 and 09:07, before the first phone.
- Never on a laptop or the public demo; `KEEP_AWAKE_HOURS=off` stops it. `/health` now shows the version, the
  hours and the time of the last keep-awake request.

### Tests
- `server/test/menu-import.test.js` (10) and `server/test/split.test.js` (9): the brief's cases;
  `server/test/keep-awake.test.js` (5): the hours, past midnight, and where it stays off. All 85 server
  tests pass.

## 2.0.1 — 2026-10-16

The client's combined menu file is read exactly as written, staff sign in with a Staff ID everywhere, and a
page-by-page pass at phone width. Checked end to end on an empty server: set-up, the client's own file
(6 categories, 9 dishes, 3 new kitchens), tables, staff, an order through the kitchen, bill, payment, close.

### Menu import
- **One file, one import.** The template is the client's own (`POTKO_Menu_Import_Template`: a **Menu Import**
  sheet of 17 columns and a **Read Me** sheet). Add Category and "+ Add" both import categories and dishes.
- **Category ID** (e.g. `CAT-001`) on categories: in the file, on the category form, on the lists. A new ID
  or name creates the category; an existing one is reused, never duplicated (migration 005).
- **Item ID** replaces "Item Code" in the app and the file (`ITM-001`); still optional (one is made).
- Portions and add-ons as `Regular:220|Large:320` (no spaces needed); a single portion is a plain price;
  without a Base Price the first portion's price is used.
- **Kitchen Terminals** not set up yet are created by the import (listed in the preview) instead of refusing
  the row. **Suggested Item IDs** become Goes Well With links once every dish is in.
- The preview shows categories with their IDs and descriptions, dishes, inactive dishes, and new kitchens;
  importing the same file again changes nothing.

### Staff ID
- The staff form asks for a **Staff ID** (an email still works), the staff list shows each person's Staff ID
  next to their role, and every message says Staff ID.

### Consistency pass
- Long names wrap to two lines instead of being cut: page titles, dish and category names, the kitchen line,
  Overview alerts, the Payments queue, a chef's kitchens, report labels and the staff report.
- Reports: the five tabs fit their labels; the peak value on a chart is never cut.
- Item counts are quantities everywhere (Butter Naan ×2 is 2 items), the waiter's list included.
- Messages, toasts and the audit log say **kitchen** (as the Kitchens page does), not "terminal"; a chef's
  kitchens are listed in kitchen order.
- **Close Table** on the bill screen returns to the list (waiter: Given Orders; manager: Payments) instead of a
  "This order is closed" page.
- Adding a table from inside a dining area does not ask the area again ("Add Table to Main Hall").

## 2.0.0 — 2026-10-16 (client release)

The POS + KOT rebuild of version 1, finished to the "finals" design and the client's review rounds.
Everything below is enforced on the server as well as shown in the app.

### Handover to a client
- **First-run set-up in the app.** A new server starts empty; the first person to open the app sees **Set up
  your restaurant** (restaurant name, setup code, their name, Staff ID, password, approval PIN), becomes the
  admin and is signed in. The setup code (`SETUP_CODE`, generated by Render) keeps strangers out; once a
  restaurant exists the screen never shows again. `npm run restaurant:add` uses the same steps.
- **Getting started** card on the admin's and manager's Overview: tables, menu, waiters, kitchens and their
  chefs, each ticked as it is done; it disappears when everything is done (or is hidden).
- `npm run db:clear -- --yes` empties a database and leaves the tables ready for that set-up.

### Menu
- Categories first, then their dishes; both dragged into order, searched, and switched on and off (asked
  first). Tap a dish for its **Item Preview** (view only; Edit inside the card).
- Dish form in steps, the step row on every step: **Details · Pricing & Tax · Portions · Add-ons · Goes Well
  With · Terminals**. Adding from inside a category does not ask the category again.
- **Item Code** on every dish (2 to 12 letters, digits or hyphens): shown on the dish list and preview, set
  when the dish is added (or made automatically); afterwards only an admin changes it.
- **Goes Well With**: the manager picks the dishes the waiter is offered with a dish.
- **Open price** dishes (the waiter types the price), several kitchens per dish, one simple add-on list.
- **Import from File** in one format for categories and dishes (the client's template, Item Code first):
  Name:Price lists for portions and add-ons, several kitchens, open price, Restaurant/Custom/None tax, Go Well
  With codes, new categories created. Add Category and "+ Add" both ask **Add Manually / Import from File**.

### Tables and service
- Manager's middle tab is **Tables**: Floor View (one dining area) and List View (any mix of dining areas,
  ticked). Tap a busy table to open its order; hold a table for Split, Merge and Transfer. Same rule for the
  waiter, whose order opens inside the Tables tab.
- Seating asks the number of guests; split by number of tables then people per table (dishes stay on the
  first); merge and transfer as select → preview → done; transfer at any time.
- More › Tables: dining areas like menu categories (search, drag, switch with confirmation); inside an area its
  layout and its table list (drag, switch).

### Kitchen
- **Accept → Start preparing → Ready**: New orders (Deny or Accept), Preparing (Start preparing, tick dishes
  ready), Done. Denying some dishes accepts the rest. The waiter sees "accepted".
- A chef sees only their kitchens' dishes and can switch their own dishes off (My dishes).

### Staff and access
- Profile with Overview, Role & Access and Activity; Edit beside the person's details; account actions as
  rows. Role & Access opens each edit step directly; changing the role is a small option at the end.
- Payment permission in three levels (take payment, close table only, no access) and price visibility,
  separate from each other. A manager sets these for waiters and cashiers.
- Everyone receives only what is assigned to them (`server/src/scope.js`): a waiter their areas, tables and
  orders; a chef their kitchens' dishes.

### Payments
- Payments & Approvals with type and area filters; Paytm and PhonePe as payment names.

### Consistency
- One count style on every chip ("All 7"), chip rows never stretch, one switch-confirm sheet, one step row,
  no Edit buttons in headers.

## 1.0.0 — 2026-10-07

First test deployment: waiter ordering, kitchen board, manager approvals, Render + Neon.
