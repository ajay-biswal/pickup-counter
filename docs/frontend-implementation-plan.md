# Frontend implementation plan — Pickup Counter

## Goals
Build a polished, responsive customer kiosk UI around the existing NestJS API without weakening the stock/payment contract.

## Existing API contract (verified from repository)
- GET /products → [{ id, name, pricePaise, availableUnits }]
- POST /orders → { id, status, totalPaise, expiresAt, expiresInSeconds, items }
- GET /orders/:id → { id, status, totalPaise, expiresAt }
- POST /payments/webhook is server-only; do not call it directly from the browser because the HMAC secret must never be exposed client-side.
- POST /orders/:id/pickup-claim is a locker endpoint; no need to expose as a customer action in the first UI.
- API currently listens on port 3000 by default. CORS and API base URL need to be configured for local development/production.

## UX scope
1. Catalog landing page with branded top bar, availability/status labels, product cards, price in INR formatted from integer paise, stock-aware quantity controls.
2. Persistent cart summary with line quantities and integer-paise totals; clear empty/loading/error states.
3. Checkout confirmation creates a hold, disables repeated submission, and handles stock conflicts from the server.
4. Payment screen with order ID, amount, QR/UPI-like demo state and 120-second countdown. Clearly label payment as simulated; no real payment provider is integrated.
5. Poll GET /orders/:id with cleanup/backoff and stop on PAID, EXPIRED, or NEEDS_REVIEW. Use server-provided expiresInSeconds at receipt time + performance.now() to avoid depending on the user's wall clock.
6. In the demo, provide a development-only “Simulate payment” action via a server-side webhook-sender endpoint/script, not by shipping PAYMENT_WEBHOOK_SECRET to the browser. If no safe UI bridge exists, document the terminal command instead.
7. Accessible semantics, keyboard-friendly controls, responsive layout, visible focus, reduced-motion respect, informative error messages.

## Structure
- src/features/catalog/ ProductCard and catalog view
- src/features/cart/ CartPanel
- src/features/checkout/ Checkout/PaymentStatus
- src/lib/api.ts typed REST helpers
- src/lib/money.ts paise formatting
- src/types/api.ts shared API contracts
- App.tsx orchestration; avoid large components
- Built-in React state/Context or reducer first; only add state/query dependencies if complexity warrants it.
- Lucide React for consistent icons; keep dependency surface small; no shadcn installation needed initially.

## Technical concerns to check
- Add Vite proxy for /api -> backend or configure VITE_API_BASE_URL; keep fetch logic centralized.
- Configure NestJS CORS or provide reverse proxy.
- Root package scripts and compose currently don't launch the full stack (docker-compose only defines PostgreSQL); fix one-command startup after frontend flow is implemented.
- Need an order-status unit/integration test already exists for expiration; preserve.
- Use no live checkout or real UPI credentials; clearly communicate simulation.
