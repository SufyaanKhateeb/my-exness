# Exness Clone Architecture

## 1. Overview
This document defines a basic architecture for a trading platform clone using a modern stack. It is intended as a mind map of features, data flow, and implementation decisions.

Target app shape:
- User registration and login
- Portfolio/dashboard
- Market price feed and charts
- Trade simulation (buy/sell orders)
- Realtime updates for prices and orders
- Admin or account settings area

Tech stack recommendation:
- Frontend: `Next.js` with `shadcn/ui` and Tailwind CSS
- Backend / data layer: `SpacetimeDB`
- Realtime: built-in SpacetimeDB realtime subscriptions
- Optional: `Redis`/PubSub only if you need separate cache or external message streaming

## 2. High-level components

### 2.1 Frontend
- Pages and app shell with Next.js `app` router
- UI components from `shadcn/ui`
- Authentication pages: login, signup, password reset
- Trading dashboard: order entry, positions, account balance
- Market view: price list, charts, symbol search
- Notifications and realtime updates

### 2.2 Backend / Database
- Use SpacetimeDB as the primary database and logic host
- Tables for users, accounts, instruments, orders, positions, trades, market events
- Reducers / stored procedures for business rules and transaction logic
- Permissions for row-level access and secure operations
- Realtime subscriptions for client sync

### 2.3 Realtime layer
- SpacetimeDB can publish updates automatically to subscribed clients
- Use subscription queries for:
  - live price ticks
  - order status updates
  - portfolio value changes
  - trade fills
- No separate Redis / pub/sub is required unless you have additional microservices or external price sources

## 3. Authentication design

### 3.1 User model
- `user` table fields:
  - `id`
  - `email`
  - `password_hash`
  - `name`
  - `role` (user/admin)
  - `created_at`
  - `last_login`

### 3.2 Auth flow
- Registration:
  - user submits email + password
  - backend validates input and creates user record
  - hash password using bcrypt or secure algorithm
  - optionally send verification email (optional assignment feature)
- Login:
  - validate email and password
  - issue JWT or session token
  - store token in secure cookie or local storage
- Session management:
  - use JWT with `HttpOnly` cookie for security
  - refresh token flow if needed
  - protect server-side routes with auth middleware

### 3.3 Authorization
- Protect routes and API calls by user identity
- Use SpacetimeDB permission rules to ensure users can only access their own orders and portfolio
- Role-based access for admin-like operations if needed

## 4. Trading system architecture

### 4.1 Core entities
- `instrument` / `symbol`
  - ticker, name, asset class, pip size, leverage settings
- `price_tick`
  - symbol, bid, ask, timestamp
- `order`
  - id, user_id, symbol, side, quantity, type, status, price, created_at
- `position`
  - user_id, symbol, open_quantity, avg_price, unrealized_pnl
- `trade`
  - executed fills: order_id, price, qty, side, timestamp
- `account`
  - user_id, balance, equity, margin_used, margin_available

### 4.2 Trading flows
- Market data feed:
  - ingest price updates into SpacetimeDB or simulate prices inside app
  - publish updates to frontend subscriptions
- Order placement:
  - frontend sends order request to backend reducer
  - validate order size, user balance, instrument rules
  - insert order record and adjust account margin/reserve
- Execution logic:
  - simple simulation: fill orders immediately at current market price
  - record trade fill and update position
  - update order status to `filled` or `rejected`
- Position management:
  - calculate unrealized PnL from last price
  - update account equity and margin values
- Closing positions:
  - support closing via opposite order or explicit close request
  - generate trade record and update position quantity

### 4.3 Order types
- Basic assignment version:
  - market orders only
- Extended features:
  - limit orders
  - stop orders
  - take-profit / stop-loss

## 5. Realtime synchronization

### 5.1 When to use pub/sub
- SpacetimeDB already provides realtime subscription capabilities for database queries
- Use pub/sub only when:
  - you need external price streams not managed in SpacetimeDB
  - you have separate services that must communicate asynchronously
  - you want caching or aggregation outside the database
- For this assignment, SpacetimeDB realtime should be enough

### 5.2 Client subscription patterns
- Subscribe to price list for displayed symbols
- Subscribe to current user orders and positions
- Subscribe to account summary / equity updates
- Use optimistic updates for UI responsiveness

## 6. Implementation plan

### 6.1 Phase 1: Setup
- scaffold Next.js app
- integrate Tailwind and `shadcn/ui`
- install SpacetimeDB and create project config
- define core database schema

### 6.2 Phase 2: Auth and user flow
- build signup/login UI
- implement backend auth logic
- protect pages and API routes
- add user profile page

### 6.3 Phase 3: Market data and dashboard
- define instruments and price feed simulation
- build market list UI
- implement chart or price widget
- subscribe to realtime prices

### 6.4 Phase 4: Trading operations
- build order entry form
- implement order reducer and validation
- update account and position state
- show trade history and open orders

### 6.5 Phase 5: polish and demo
- add responsive layout
- add notification toast for fills/errors
- refine UI using `shadcn/ui`
- write README or demo script

## 7. Deployment
- Frontend: Vercel (recommended for Next.js)
- Backend/DB: SpacetimeDB managed service or local dev environment
- Use environment variables for secrets
- Ensure auth cookies and API endpoints are secure

## 8. Notes / tradeoffs
- SpacetimeDB is a strong fit for realtime and embedded logic, but it is newer than Postgres/Supabase.
- If you want a simpler implementation path, you can replace SpacetimeDB with Supabase/Postgres and use Redis only for caching.
- Keep the trading simulation lightweight: focus on main flows rather than full market microstructure.

## 9. Recommended file structure
```
/app
  /components
  /dashboard
  /auth
  layout.tsx
  page.tsx
/lib
  spacetimedb.ts
  auth.ts
/data
  schema.ts
  market.ts
/db
  tables.ts
  reducers.ts
  subscriptions.ts
/public
  /assets
```

## 10. Summary
- Use `Next.js + shadcn/ui` for frontend.
- Use `SpacetimeDB` for the database, realtime sync, and server-side logic.
- Implement auth with JWT/secure cookies and SpacetimeDB permission rules.
- Model trading as orders, positions, trades, and accounts.
- Use SpacetimeDB realtime subscriptions; do not add Redis pub/sub unless your architecture needs an external message bus.

Natural next steps:

Add an order book and fake bid/ask depth per market.
Add portfolio, positions, and order reducers so the terminal can simulate trading.