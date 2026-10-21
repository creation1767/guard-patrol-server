# 4 Horseman Security — company server and website

One small Node.js program (no dependencies, Node 18+) that runs:

- **The website**: home page, sign-up with a monthly Stripe subscription (Starter, Pro or Business; Enterprise on request), log in, an administrator dashboard (account & billing, scheduling, payroll, client invoicing, client portal accounts) and a client portal at /client.
- **The web app** at `/app/`: the same app as on Android, in a browser.
- **The API** the Android app and web app use to sync accounts, sites, shifts, guard tours, reports and messages.

## How companies work

- Each subscriber gets a **separate company** with its own administrator, sites, officers, reports and messages. Companies can't see each other's data.
- Everyone signs in with a **company code**, their **badge number** and **PIN**. A new company's administrator is badge **1000**, with the PIN chosen at sign-up.
- Your own company (code `HORSEMAN`) is the **owner company**. It is never billed and never deleted. Its administrator PIN can always be reset with the `ADMIN_PIN` variable.
- Limits per company depend on the plan (see *Plans* below); every plan allows 20 guard-tour locations per site.

## Subscriptions (Stripe)

1. Sign-up collects the company name, the administrator's name, email and PIN, then sends the buyer to **Stripe Checkout**. Card details never reach this server.
2. When payment succeeds, the company is created and the success page shows its company code. If the buyer closes the page early, the server finishes the setup automatically within 15 minutes.
3. On the account page, administrators can update their card (Stripe billing portal), cancel (access continues to the end of the paid month), or undo a cancellation.
4. Every 15 minutes the server checks each subscription with Stripe. When a subscription has **ended** (cancelled, or Stripe stopped retrying a failed payment), that company and all of its data are **deleted**.

The server creates the Stripe products and monthly prices for each plan itself on first use. The only setup is one variable.

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

## Plans (version 2.2)

| Plan | Price / month | Sites | Officers |
|---|---|---|---|
| Starter | $99 (`PRICE_STARTER`, cents) | 1 | 10 |
| Pro | $199 (`PRICE_PRO`) | 2 | 25 |
| Business | $349 (`PRICE_BUSINESS`) | 5 | 50 |
| Enterprise | set per company | set per company | set per company |

- Buyers pick a plan at sign-up. Administrators can switch between Starter, Pro and Business on the dashboard's Overview tab;
  Stripe prorates the difference on the next invoice. A downgrade is refused until the company's sites and officers fit.
- **Enterprise:** the website's `/enterprise` form sends an enquiry. The owner company (`HORSEMAN`) sees enquiries on its
  dashboard (Settings → Enterprise) and can set any company to Enterprise with its own sites, officers and monthly price
  (the customer first signs up on any plan; their Stripe subscription is then moved to the agreed price).
- Companies that subscribed before plans existed keep their old plan ($149.99, 2 sites, 50 officers) until they change plan.

## Version 2.1 additions

- **Missed payments:** a company whose monthly payment fails keeps everything for `GRACE_DAYS` (default 15) days after the
  scheduled payment date; the dashboard shows a warning with a Pay now button. After that it is deleted. In the Stripe Dashboard
  (Billing → Revenue recovery → Retries) set retries to run for at least 15 days and choose *mark the subscription as unpaid* or
  *leave it past due* when retries run out, so a late payment still reactivates the subscription.
- **Administrator dashboard** (website `/account`, administrators only): Overview, Schedule (weekly shift planner with repeat and
  copy-week), Payroll (hours from check-ins × pay rates, weekly/daily overtime, Excel and CSV export; no money is moved),
  Billing (client invoices filled from hours worked, print/PDF, email, sent/paid/void tracking), Clients & portal, Settings.
- **Client portal** (`/client`): a company's clients sign in with the company code, their email and a portal PIN, and see
  reports, check-ins and guard-tour scans for their own sites, their invoices, and send service requests.
- **Languages:** English, Español, Français, Kreyòl ayisyen, Português, العربية (right-to-left), Русский, Deutsch, Filipino —
  website, dashboard, client portal and the app. `i18n.js` translates each page from the dictionaries in `i18n/<lang>.js`.
