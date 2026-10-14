# 4 Horseman Security — company server and website

One small Node.js program (no dependencies, Node 18+) that runs:

- **The website**: home page, sign-up with a $29.99/month Stripe subscription, log in, and an account and billing page for company administrators.
- **The web app** at `/app/`: the same app as on Android, in a browser.
- **The API** the Android app and web app use to sync accounts, sites, shifts, guard tours, reports and messages.

## How companies work

- Each subscriber gets a **separate company** with its own administrator, sites, officers, reports and messages. Companies can't see each other's data.
- Everyone signs in with a **company code**, their **badge number** and **PIN**. A new company's administrator is badge **1000**, with the PIN chosen at sign-up.
- Your own company (code `HORSEMAN`) is the **owner company**. It is never billed and never deleted. Its administrator PIN can always be reset with the `ADMIN_PIN` variable.
- Limits per company: 2 sites, 20 guard-tour locations per site, 25 officers per site (50 in total).

## Subscriptions (Stripe)

1. Sign-up collects the company name, the administrator's name, email and PIN, then sends the buyer to **Stripe Checkout**. Card details never reach this server.
2. When payment succeeds, the company is created and the success page shows its company code. If the buyer closes the page early, the server finishes the setup automatically within 15 minutes.
3. On the account page, administrators can update their card (Stripe billing portal), cancel (access continues to the end of the paid month), or undo a cancellation.
4. Every 15 minutes the server checks each subscription with Stripe. When a subscription has **ended** (cancelled, or Stripe stopped retrying a failed payment), that company and all of its data are **deleted**.

The server creates the Stripe product and the $29.99/month price itself on first use. The only setup is one variable.

### Turn on payments

In Railway → your service → **Variables**, add:

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | Your Stripe secret key from dashboard.stripe.com → Developers → API keys. Start with the **test** key (`sk_test_…`) and switch to the live key (`sk_live_…`) when you're ready to take real payments. |

For the "Update payment method" button, open Stripe → Settings → Billing → **Customer portal** once and click **Save** (once in test mode and once in live mode).

## Other variables

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_PIN` | — | Owner-company administrator PIN. Applied on first start and whenever this value changes. |
| `PRICE_CENTS` | `2999` | Monthly price in cents. |
| `OWNER_COMPANY_CODE` | `HORSEMAN` | Sign-in code for the owner company. |
| `OWNER_COMPANY_NAME` | `4 Horseman Security` | Owner company name. |
| `PUBLIC_URL` | worked out per request | Public address of the site (used for Stripe return links). |
| `MAX_SITES` / `MAX_PER_SITE` / `MAX_OFFICERS` / `MAX_CHECKPOINTS` | 2 / 25 / 50 / 20 | Limits per company. |
| `DATA_DIR` | Railway volume | Where data is stored. Keep the volume attached at `/data`. |

## Files

```
server.js      the server, API and Stripe billing
web/           the website (home, signup, success, login, account, terms, privacy)
app/           the web app (copy of the Android app's www folder)
Dockerfile     how Railway builds it
```

When the Android app's `www` files change, copy them into `app/` so the web app matches.
