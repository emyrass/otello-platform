# Otello

Otello leases RPC access to agents. A provider publishes an offer. An agent requests a duration, a rate, an allowance, and a spending cap. The provider approves or rejects. Approval signs an agreement with ECDSA P-256. When the start time arrives, the server issues a credential. Every call is checked on the server before it is forwarded. Access stops when the lease expires, the allowance is exhausted, the spending cap is reached, or the lease is revoked.

The workspace starts empty. Numbers on the pages are counts and sums of records in that workspace. Example desks live in a separate view and are labeled as examples.

## Run

```bash
npm install
npm run dev
```

The app listens on [http://127.0.0.1:47281](http://127.0.0.1:47281). The same process serves the interface and the API. On this machine, accounts and the ledger are stored in `data/otello.sqlite`.

## Deploy on Vercel

Vercel does not keep a SQLite file. The API runs as a serverless function and stores accounts, sessions, and ledgers in hosted Postgres or Turso.

In the Vercel project, open Storage and create a Postgres database. Vercel sets `POSTGRES_URL`. Redeploy. The live site uses that database.

Turso works the same way. Set both of these environment variables, then redeploy:

```bash
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-token
```

If neither database is configured, the site says the ledger database is not configured instead of pretending a local file is durable.

```bash
npm test
npm run build
npm run preview
```

## Use it

1. Create an account.
2. Register a provider and an agent. They belong to that account.
3. Publish an RPC offer. Add an endpoint URL if calls should be forwarded. Without one, the server refuses the call and does not send it.
4. Request a lease, then approve it from the provider portal. The signature reads Verified only after the check passes.
5. Submit a batch from the usage console. Accepted calls that were forwarded are metered in integer micro-USD. At $0.20 per 1,000 requests, 2,500 accepted requests cost $0.50.
6. A refused batch, including one the endpoint rejects, does not change the allowance or the accrued amount.
7. Revoke a lease or let it expire. Later calls are denied.

Open Examples in the footer to walk the same lifecycle against labeled sample records. Reset examples replaces that view only. It does not write into the workspace.

## Layout

| Module | Responsibility |
| --- | --- |
| `src/lib/engine.ts` | Requests, approval, revocation, usage, offers |
| `src/lib/policy.ts` | The single gate for an RPC batch |
| `src/lib/reconcile.ts` | Activation, expiry, and exhaustion as time passes |
| `src/lib/crypto.ts` | Canonical agreements, ECDSA sign and verify |
| `server/` | Accounts, the ledger, and the RPC forwarder |
| `api/` | Vercel serverless entry for the same API |

Uptime is not measured, so the product shows it as unavailable. Latency is the median of forwarded calls, and only after an endpoint has answered. Accrued amounts come from accepted usage. No payment rail is connected, so nothing is marked paid.
