# POTKO

Real-time restaurant ordering and kitchen app for 3–5 restaurants. Waiters take orders on a phone or
tablet, the kitchen sees them instantly, and the manager keeps control of cancels and discounts.

- `app/` — the Expo (React Native) app. One codebase for phone, tablet and web.
- `server/` — Node.js: Express for login and data, `ws` for live events, PostgreSQL for storage.

## What each role can do

| Role | Screens |
|---|---|
| **Waiter** | New order (dine-in with table lock, delivery, in-car takeaway), menu with name/code search, order status (edit, remove, add more, replace an unavailable dish, request a cancel), Ready tab, Given Orders, bill with discount and payment |
| **Chef** | Kitchen board (New / Preparing / Done), order detail: accept, deny items with a reason, start preparing, tick each dish ready, mark all ready |
| **Manager** | Dashboard, live and past orders with full history, tables, approvals inbox with PIN, counter payments, menu and out-of-stock, staff list and login codes, daily report, settings |
| **Admin** | Everything a manager has, plus adding and changing staff, discount limits, restaurant settings, one-time login codes on/off, the audit log |

## The rules the server enforces

These are checked on the server for every action, so a modified or out-of-date app cannot get round them.

- **One waiter per table.** Taking a table is one atomic database update; a table locked without an order is freed after 5 idle minutes.
- **Edit lock.** A waiter can edit or remove a dish only while it is Sent or Accepted. Once the chef starts preparing it, it is locked.
- **Cancel after cooking starts** needs a manager or admin, who approves with their PIN.
- **Discount limit.** Each waiter has a limit (default 3%). Above it, a manager approves with their PIN.
- **Closing.** A bill can be closed and paid only when every dish is delivered, removed, unavailable or cancelled, and no approval is pending.
- **Prices** are always recalculated by the server from the menu. Dishes that were not served are never charged.
- **Roles and restaurants.** Every request is checked against the signed-in person's role and restaurant. Deactivating someone, or changing their role, signs them out at once.
- **Audit log.** Every order, edit, removal, unavailable item, cancel, discount, approval and payment is recorded with who and when.

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

The server listens on port 4000. `http://localhost:4000/health` should answer `{"ok":true}`.

**Demo logins** (one admin, one manager, one chef, two waiters) are listed at the top of
[`server/sql/seed.sql`](server/sql/seed.sql).

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
2. Create the tables only, with no demo data:
   ```bash
   npm run db:schema
   ```
3. Add the restaurant and its first admin (the PIN is optional and can be set later in Settings):
   ```bash
   npm run restaurant:add -- "Street Feast Mall Road" "Priya" "A-201" "a-strong-password" 4321
   ```
4. Sign in as that admin and set things up in the app: **Tables**, then **Menu** (categories first, then dishes),
   then **Staff**. Managers and admins set their own approval PIN under **Settings**.

Run step 3 again for each further restaurant. Staff IDs are unique across all restaurants, and each
restaurant only ever sees its own data.

## Deploy (free)

1. **Database — Neon.** Create a project and set it up as above.
2. **Server — Render.** Push this repository to GitHub, then on Render choose *New → Blueprint* and pick the
   repository: [`render.yaml`](render.yaml) describes the service. Paste the Neon connection string when asked for
   `DATABASE_URL`. (By hand: a *Web Service* with root directory `server`, build `npm install --omit=dev`,
   start `node src/index.js`, health check `/health`, and the variables `DATABASE_URL` and `JWT_SECRET`.)
3. **App.** In `app/.env` point the app at Render, then run `npx expo start`:
   ```
   EXPO_PUBLIC_API_URL=https://YOUR-SERVICE.onrender.com
   ```
4. **Installable Android app.** `npm run apk -- https://YOUR-SERVICE.onrender.com` (see
   [Building the Android app](#building-the-android-app-apk)). The web build is `npx expo export --platform web`.

Free-plan limits to know about:

- Render's free service sleeps after 15 minutes without a request. The app pings every 25 seconds while it is
  open, so it stays awake during service hours, but the first sign-in of the day can take about a minute.
- Neon's free database sleeps after 5 minutes idle (the first query after that is a little slow) and allows
  0.5 GB and 100 compute-hours a month.
- Do not use Render's free PostgreSQL: it expires after 30 days.
- Before a restaurant depends on it, upgrade the Render service so it never sleeps.

## How it fits together

Every change follows the same path: app → server (checks role and rules) → database → broadcast to every
connected screen. The server is the only source of truth, and there is no offline ordering: while
disconnected the app shows a red "Reconnecting…" banner and blocks sending.

- **REST** is used for login and for loading data (`/auth/login`, `/me`, `/sync`, `/menu`, `/users`, `/orders`,
  `/reports/daily`, `/audit`, …).
- **WebSocket** (`/ws?token=JWT`) carries live actions and events as JSON `{ type, payload, id }`. The server
  answers every action with `{ type: "ack", id, ok, ... }` and runs a repeated `id` only once.
  - App → server: `table.lock`, `table.release`, `order.create`, `order.addItems`, `item.edit`, `item.remove`,
    `chef.accept`, `chef.deny`, `chef.start`, `chef.itemReady`, `chef.allReady`, `waiter.deliver`, `table.close`,
    `discount.apply`, `approval.request`, `approval.decide`, `payment.mark`, `ping`.
  - Server → apps: `table.updated`, `order.created`, `order.updated` (carries every dish, so there is no
    separate item event), `chef.denied`, `ready.count`, `approval.requested`, `approval.decided`,
    `menu.updated`, `restaurant.updated`, `pong`.
- After every reconnect the app calls `GET /sync` and redraws from the server's answer.
- Rows are returned as they are in the database (`snake_case`, see `server/sql/schema.sql`).
  Requests and WebSocket payloads sent by the app use `camelCase` (`tableId`, `orderId`).

### Where things are

```
app/
  app/                  screens (Expo Router)
    (auth)/             role.js, login.js (with one-time code), customise.js
    (waiter)/           bottom bar with 3 tabs
      new-order/        order type → details or tables → menu → preview
      given-orders/     the list, one order's status, bill/[id]
      ready.js          dishes ready to deliver
    (chef)/             kitchen board and kitchen/[id] (one order)
    (manager)/          dashboard, orders, tables, approvals, menu, staff, reports, audit, settings, more
                        (sidebar on tablet and desktop, bottom bar on a phone; used by manager and admin)
  src/theme/tokens.js   every colour, radius and font size — screens never hardcode these
  src/components/       Button, Chip, Card, TextField, BottomSheet, ItemSheet, ItemRow, TableCard,
                        PinSheet, DenySheet, ConfirmSheet, ReasonSheet, Toast, AppHeader, …
  src/store/            auth, settings (Customise), menu, draft (dishes being chosen), live (tables,
                        orders, approvals), toast
  src/lib/              api.js (REST), ws.js (live connection), server.js (the server's address), orders.js,
                        kitchen.js, audit.js, format.js
  scripts/build-apk.js  builds the installable Android app (npm run apk)
server/
  src/index.js          Express + ws in one service
  src/auth.js           tokens, role checks, login rate limit
  src/orders.js         shared order query, the status-from-items rule, totals, the audit-log helper
  src/routes/           auth, me, sync, menu, orders, users, manage (restaurant, tables, history, reports, audit)
  src/ws/events.js      live connection, rooms, duplicate-action protection
  src/ws/orders.js      order.create, order.addItems, item.edit, item.remove, waiter.deliver
  src/ws/tables.js      table.lock, table.release and the 5-minute stale-lock sweep
  src/ws/chef.js        chef.accept, chef.deny, chef.start, chef.itemReady, chef.allReady
  src/ws/billing.js     discount.apply, approval.request, approval.decide, table.close, payment.mark
  src/ws/publish.js     sends an order change to every screen that should see it
  src/scripts/          db.js (schema / setup / reset), local-db.js, add-restaurant.js
  sql/schema.sql, sql/seed.sql
```

## Version 1: what it does not do yet

- **Tax** is not calculated or shown.
- **Guest count** per table is not recorded; table cards show seats.
- **Dishes and tables cannot be deleted**, only marked out of stock or renamed, so old bills stay intact.
- **Alerts are in-app only** (toast, sound, vibration). There are no push notifications when the app is closed.
- **A password reset** signs the person's live screens out but does not cancel a login token already issued;
  deactivating them does.
- **Printing** a bill or kitchen ticket is not included.

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

This APK is signed with a development key: right for testing and for handing to a restaurant directly, not
accepted by the Play Store. The package name is `com.potko.app` (`app/app.json`); settle it before a store
release, because it cannot change afterwards.
