# Testing Safepay Subscriptions in Sandbox — Step-by-Step

**Purpose:** confirm whether Safepay's "Subscriptions" product can actually charge a card automatically on a recurring schedule, before we build the real PKR 5,000/month doctor subscription billing on top of it. This project has treated that as an unverified marketing claim since the original gateway research (2026-09-13) — this is the real test.

**Who does what:** you run every step below in your own Safepay sandbox account (getsafepay.com/dashboard) — Claude can't log into your account or run these steps for you. Once you've gone through it, report back what actually happened (especially the two flagged unknowns below) and the billing mechanism gets built for real from there.

**Sourcing note:** every step below comes directly from Safepay's own published documentation (Help Scout knowledge base and developer docs), fetched and read on 2026-09-14 — not from Claude's general knowledge, since payment-gateway specifics change and shouldn't be guessed. Two things are flagged as genuinely unconfirmed by their own docs — see Step 0.

---

## Step 0 — Before you start: email Safepay support with two questions

Their docs don't say either of these outright, and it's worth ruling them out before you spend time testing:

1. **"Does the Subscriptions feature need to be enabled on my sandbox account before I can create a plan?"**
2. **"What's the shortest billing interval I can use to actually see a renewal charge fire in sandbox, without waiting a real month?"** (Their dashboard offers a "Daily" interval option — it's reasonable to expect that renews after 24 hours, but their docs never confirm this is meant for testing, so don't assume it and then be confused if it doesn't fire.)

**Contact:** support@getsafepay.com, or Live Chat from your dashboard (bottom-right chat icon once logged in), 9am–5pm weekdays.

You can still do Steps 1–3 below while waiting for a reply — just keep their answer in mind when you get to Step 4 (waiting for a renewal).

---

## Step 1 — Create a test plan

1. Log into your Safepay sandbox dashboard.
2. Go to the **Subscriptions** tab, then the **Plans** sub-tab.
3. Click **Create Plan** (top right).
4. Fill in the form:
   - **Plan Name:** something obvious for testing, e.g. `TEST - Doctor Subscription`
   - **Price:** you can use the real PKR 5,000 figure, or a small test amount like PKR 10 — either works the same way in sandbox, and a small amount means less to think about if it accidentally charges more than once during testing.
   - **Currency:** PKR
   - **Interval:** for a real plan this would be Monthly, but for **testing** specifically, use **Daily** — this is what lets you actually see a renewal within a day or two rather than waiting a real month (see the caveat in Step 0 above — daily-for-testing is Claude's reasonable read of the option, not something Safepay's docs explicitly confirm is meant for testing).
   - **Interval Count:** 1
   - **Number of Billing Cycles:** 0 (means "keep renewing indefinitely" — fine for a test you'll cancel yourself)
   - **Type:** Recurring
   - Leave Trial Period blank (you want the first charge to happen immediately, not after a delay)
5. Click **Create Plan**.

## Step 2 — Subscribe to it yourself, as if you were a doctor paying the fee

Safepay's docs are explicit that a subscription **cannot be created through the API alone** — someone has to go through the actual checkout/subscribe flow. So for this test, you play the role of the subscribing doctor:

1. From the Plans list, find your test plan and get its subscribe/checkout link (the dashboard surfaces this once the plan exists).
2. Open that link. You'll be asked to log in or sign up on Safepay's checkout screen (a separate account from your merchant dashboard login — use a test email you don't mind seeing charge confirmation emails on).
3. Click **Add Card** and enter this test card, which Safepay explicitly publishes for sandbox testing and will not charge a real card:
   - **Card number:** `5200 0000 0000 1096`
   - **Expiry:** `03/28`
   - **CVV:** `111`
   - (Don't reuse this exact card + email combination more than 7–8 times in one day — Safepay's docs mention a daily limit on the same dummy card/email pair.)
4. Select that card, review the plan's terms screen, and confirm.
5. You should see an immediate charge — the docs say the first charge happens instantly for a non-trial plan.

## Step 3 — Confirm the first charge landed correctly

Back in your merchant dashboard:

1. Go to **Subscriptions** → find your test subscription → open its detail page. Confirm it shows status **Active**, the right price, and a start date.
2. Go to the **Transactions** view under that subscription. Confirm one transaction shows status **COMPLETE**.
3. **This is the important part for us:** check whether your webhook endpoint received a call. If your app's webhook route (`/api/payments/webhook`) is deployed and its URL is registered in your Safepay dashboard, check your server logs (or Supabase logs) for an incoming request with `"type":"subscription.payment.succeeded"` in the body. If nothing arrived, that's worth reporting back — it may mean the webhook needs to be registered specifically for subscription events, not just one-time payments.

## Step 4 — Wait for the renewal (this is the real test)

Because you set the interval to Daily, a second charge should fire automatically about 24 hours after the first one — with no button to click, no manual "renew now" action. Safepay's docs don't describe any way to fast-forward this, so this genuinely means waiting a day.

1. Check back the next day (or two, to be safe).
2. Look at the subscription's Transactions view again — do you now see a **second** COMPLETE transaction?
3. Check your webhook logs again for a second `subscription.payment.succeeded` call.

**If a second charge fired on its own:** that's the confirmation we need — Safepay's recurring billing genuinely works, and the PKR 5,000/month doctor subscription can be built on top of it with confidence.

**If nothing fired:** don't assume it's broken — go back to Safepay support with what you tried (plan settings, how long you waited) and ask them directly why. This is exactly the kind of "marketing claim vs. real behavior" gap this project has run into before with other providers (Daily.co, the payment webhook's exact field names), and it gets resolved by asking the provider, not guessing.

## Step 5 — Clean up and report back

1. From the subscription's detail page, click **Cancel** so it stops charging your test card.
2. Come back and tell me:
   - Did the first charge succeed? Did the webhook fire?
   - Did a renewal charge happen on its own after ~24 hours? Did that webhook fire too?
   - What did Safepay support say to the two questions in Step 0?

Once I have that, I'll build the actual PKR 5,000/month billing either as real automatic recurring charges (if this all worked) or as the manual admin-tracked fallback we discussed (if it didn't) — not before, since building it on an unverified assumption is exactly what this test is meant to avoid.

---

## Reference: what's confirmed vs. still unconfirmed about Safepay Subscriptions

**Confirmed directly from Safepay's own documentation (2026-09-14):**
- A real "Subscriptions" feature exists with a dashboard UI (Plans tab, Subscriptions tab, Transactions view) — not just an API.
- Plans are created in the dashboard; subscribers can only be enrolled through the actual checkout flow, never the API alone.
- Once subscribed, charges are meant to happen automatically on the plan's interval — no manual "charge now" step.
- Webhook event names exist for this: `subscription.created`, `subscription.payment.succeeded`, `subscription.payment.failed`, `subscription.canceled`, `subscription.paused`, `subscription.resumed`, `subscription.ended`.
- The test card `5200 0000 0000 1096` / `03/28` / `111` is Safepay's own published dummy card for sandbox testing.

**Not confirmed anywhere in their docs — genuinely open questions, which is why Step 0 exists:**
- Whether Subscriptions needs to be specifically enabled on a sandbox account.
- Whether a Daily interval is actually intended/supported as a way to test renewals quickly, or whether it behaves differently from a real Monthly plan in some untested way.
- Exact settlement timing and whether a failed renewal (e.g. an expired test card) behaves the way their docs describe, since none of this was tested against a real account — only read from documentation.
