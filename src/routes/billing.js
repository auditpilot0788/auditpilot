/**
 * AuditPilot — Billing Routes
 *
 * POST /api/billing/create-checkout-session   Start a Stripe Checkout flow
 * POST /api/billing/webhook                   Receive Stripe webhook events
 * POST /api/billing/cancel-subscription       Cancel at period end
 * GET  /api/billing/portal                    Open Stripe Customer Portal
 *
 * NOTE: The webhook route requires express.raw() middleware, which must be
 * mounted in server.js BEFORE express.json() — see server.js for details.
 */

const express           = require('express');
const stripe            = require('../lib/stripe');
const { query }         = require('../db/connection');
const { requireAuth }   = require('../middleware/auth');

const router = express.Router();

const PRICE_IDS = {
  starter: process.env.STRIPE_STARTER_PRICE_ID,
  agency:  process.env.STRIPE_AGENCY_PRICE_ID
};

// ── POST /api/billing/create-checkout-session ─────────────────────────────────

router.post('/create-checkout-session', requireAuth, async (req, res) => {
  const { plan } = req.body;

  if (!plan || !PRICE_IDS[plan]) {
    return res.status(400).json({ error: 'Invalid plan. Choose "starter" or "agency".' });
  }

  const priceId = PRICE_IDS[plan];
  if (!priceId) {
    return res.status(500).json({ error: `Price ID for plan "${plan}" is not configured.` });
  }

  try {
    // ── Get or create Stripe customer ────────────────────────────────────────
    const subResult = await query(
      `SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 LIMIT 1`,
      [req.user.sub]
    );

    let stripeCustomerId = subResult.rows[0]?.stripe_customer_id || null;

    if (!stripeCustomerId) {
      const userResult = await query(
        'SELECT email, full_name FROM users WHERE id = $1',
        [req.user.sub]
      );
      const user = userResult.rows[0];

      const customer = await stripe.customers.create({
        email: user.email,
        name:  user.full_name || undefined,
        metadata: { userId: req.user.sub }
      });
      stripeCustomerId = customer.id;

      // Persist so future sessions reuse the same customer
      await query(
        `UPDATE subscriptions SET stripe_customer_id = $1 WHERE user_id = $2`,
        [stripeCustomerId, req.user.sub]
      );
    }

    // ── Create Checkout Session ──────────────────────────────────────────────
    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      customer:             stripeCustomerId,
      client_reference_id:  req.user.sub,
      line_items: [{
        price:    priceId,
        quantity: 1
      }],
      success_url: `${appUrl}/dashboard?upgraded=true`,
      cancel_url:  `${appUrl}/pricing`,
      metadata: {
        userId: req.user.sub,
        plan
      },
      subscription_data: {
        metadata: { userId: req.user.sub, plan }
      }
    });

    return res.json({ checkoutUrl: session.url });

  } catch (err) {
    console.error('[billing] create-checkout-session error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session. Please try again.' });
  }
});

// ── POST /api/billing/webhook ─────────────────────────────────────────────────
// req.body is a raw Buffer here — express.raw() is applied in server.js
// BEFORE express.json() for this specific path.

router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('[billing] STRIPE_WEBHOOK_SECRET is not set.');
    return res.status(500).send('Webhook secret not configured.');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,                           // raw Buffer
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[billing] Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  try {
    switch (event.type) {

      // ── Payment succeeded — subscription activated or renewed ──────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId  = session.metadata?.userId;
        const plan    = session.metadata?.plan;

        if (!userId || !plan) {
          console.warn('[billing] checkout.session.completed missing metadata');
          break;
        }

        // Retrieve full subscription details from Stripe
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription
        );

        await query(
          `UPDATE subscriptions
             SET plan                    = $1,
                 status                  = 'active',
                 stripe_subscription_id  = $2,
                 current_period_start    = TO_TIMESTAMP($3),
                 current_period_end      = TO_TIMESTAMP($4)
           WHERE user_id = $5`,
          [
            plan,
            subscription.id,
            subscription.current_period_start,
            subscription.current_period_end,
            userId
          ]
        );
        console.log(`[billing] Subscription activated — user ${userId}, plan ${plan}`);
        break;
      }

      // ── Recurring payment succeeded — update period end ────────────────────
      case 'invoice.payment_succeeded': {
        const invoice      = event.data.object;
        const subId        = invoice.subscription;
        if (!subId) break;

        const subscription = await stripe.subscriptions.retrieve(subId);

        await query(
          `UPDATE subscriptions
             SET status               = 'active',
                 current_period_start = TO_TIMESTAMP($1),
                 current_period_end   = TO_TIMESTAMP($2)
           WHERE stripe_subscription_id = $3`,
          [
            subscription.current_period_start,
            subscription.current_period_end,
            subId
          ]
        );
        console.log(`[billing] Invoice paid — subscription ${subId} renewed`);
        break;
      }

      // ── Payment failed — mark as past due ──────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subId   = invoice.subscription;
        if (!subId) break;

        await query(
          `UPDATE subscriptions SET status = 'past_due'
           WHERE stripe_subscription_id = $1`,
          [subId]
        );
        console.log(`[billing] Payment failed — subscription ${subId} marked past_due`);
        break;
      }

      // ── Subscription deleted (cancelled or expired) ────────────────────────
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;

        await query(
          `UPDATE subscriptions
             SET plan   = 'free',
                 status = 'cancelled',
                 stripe_subscription_id = NULL
           WHERE stripe_subscription_id = $1`,
          [subscription.id]
        );
        console.log(`[billing] Subscription ${subscription.id} cancelled — reverted to free`);
        break;
      }

      default:
        // Unhandled event types are silently ignored
        break;
    }
  } catch (err) {
    console.error(`[billing] Error handling event ${event.type}:`, err.message);
    // Still return 200 so Stripe doesn't retry — DB errors shouldn't trigger retries
  }

  // Always acknowledge receipt so Stripe stops retrying
  return res.json({ received: true });
});

// ── POST /api/billing/cancel-subscription ────────────────────────────────────

router.post('/cancel-subscription', requireAuth, async (req, res) => {
  try {
    const subResult = await query(
      `SELECT stripe_subscription_id, current_period_end
         FROM subscriptions
         WHERE user_id = $1 AND status = 'active'`,
      [req.user.sub]
    );

    if (!subResult.rows.length || !subResult.rows[0].stripe_subscription_id) {
      return res.status(404).json({ error: 'No active paid subscription found.' });
    }

    const { stripe_subscription_id, current_period_end } = subResult.rows[0];

    // Cancel at end of billing period — access continues until then
    await stripe.subscriptions.update(stripe_subscription_id, {
      cancel_at_period_end: true
    });

    return res.json({
      success:    true,
      cancelDate: current_period_end
    });

  } catch (err) {
    console.error('[billing] cancel-subscription error:', err.message);
    return res.status(500).json({ error: 'Failed to cancel subscription. Please try again.' });
  }
});

// ── GET /api/billing/portal ───────────────────────────────────────────────────

router.get('/portal', requireAuth, async (req, res) => {
  try {
    const subResult = await query(
      `SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 LIMIT 1`,
      [req.user.sub]
    );

    const customerId = subResult.rows[0]?.stripe_customer_id;
    if (!customerId) {
      return res.status(404).json({ error: 'No billing account found. Please subscribe first.' });
    }

    const appUrl  = process.env.APP_URL || 'http://localhost:3000';
    const session = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${appUrl}/dashboard`
    });

    return res.json({ portalUrl: session.url });

  } catch (err) {
    console.error('[billing] portal error:', err.message);
    return res.status(500).json({ error: 'Failed to open billing portal. Please try again.' });
  }
});

module.exports = router;
