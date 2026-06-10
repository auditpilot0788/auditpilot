# AuditPilot — Setup & Deployment

## Environment Variables

Copy `.env.example` to `.env` and fill in every value before starting.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string. Railway injects this automatically when you add a PostgreSQL service. |
| `JWT_SECRET` | Yes | At least 32 random characters. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | No | Token lifetime. Default: `7d` |
| `NODE_ENV` | Yes | Set to `production` on Railway (enables SSL for DB). Use `development` locally. |
| `STRIPE_SECRET_KEY` | Yes | From [Stripe Dashboard → API keys](https://dashboard.stripe.com/apikeys). Use `sk_test_...` for testing. |
| `STRIPE_WEBHOOK_SECRET` | Yes | From Stripe Dashboard → Webhooks → your endpoint → Signing secret. |
| `STRIPE_STARTER_PRICE_ID` | Yes | Price ID for the Starter plan (e.g. `price_...`). |
| `STRIPE_AGENCY_PRICE_ID` | Yes | Price ID for the Agency plan (e.g. `price_...`). |
| `APP_URL` | Yes | Base URL for Stripe redirects. Local: `http://localhost:3000`. Production: your Railway URL. |
| `PORT` | No | Port to listen on. Railway sets this automatically. Default: `3000`. |

---

## Local Development

```bash
# 1. Install dependencies (also installs Playwright's Chromium browser)
npm install

# 2. Copy and fill in environment variables
cp .env.example .env

# 3. Run database migrations
npm run db:migrate

# 4. Start the dev server (auto-restarts on file changes)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Railway Deployment

### 1. Create the project

1. Go to [railway.app](https://railway.app) and click **New Project**.
2. Choose **Deploy from GitHub repo** and select this repository.

### 2. Add a PostgreSQL database

1. In your Railway project, click **+ New** → **Database** → **Add PostgreSQL**.
2. Railway automatically injects `DATABASE_URL` into your app's environment.

### 3. Set environment variables

In Railway → your app service → **Variables**, add:

```
JWT_SECRET=<generate with the command above>
JWT_EXPIRES_IN=7d
NODE_ENV=production
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_AGENCY_PRICE_ID=price_...
APP_URL=https://<your-railway-domain>.up.railway.app
```

### 4. Run database migrations

Option A — via Railway CLI:
```bash
railway run npm run db:migrate
```

Option B — add a one-time "Deploy command" in Railway settings:
```
npm run db:migrate && npm start
```
Switch it back to `npm start` after the first deploy.

### 5. Configure Stripe webhook

1. In [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks), click **Add endpoint**.
2. Set the URL to: `https://<your-railway-domain>.up.railway.app/api/billing/webhook`
3. Select these events:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
4. Copy the **Signing secret** and set it as `STRIPE_WEBHOOK_SECRET` in Railway.

### 6. Deploy

Push to the `main` branch — Railway deploys automatically.

---

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start production server |
| `npm run dev` | Start dev server with auto-reload (nodemon) |
| `npm run db:migrate` | Run database migrations |
