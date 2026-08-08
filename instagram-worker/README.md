# Instagram feed mirror

Keeps the homepage Instagram strip current without an app, and without the
storefront ever calling Instagram.

```
Cloudflare Worker (hourly cron)
  → Instagram Graph API — five most recent posts
  → new posts only: download image, upload to Shopify Files
  → drop the Files for posts that fell out of the top five
  → write [{id, src, permalink}] to shop metafield  ness.instagram_feed
Theme → sections/ness-instagram.liquid renders that metafield server-side
```

**If this Worker stops running, the storefront does not break.** The strip keeps
rendering whatever was last written to the metafield, and falls back to the five
bundled images (`assets/ness-ig-fallback-*.jpg`) if the metafield is empty. The
failure mode is stale photos, never an empty band.

---

## Why it works this way

**Images are copied into Shopify, not hot-linked.** Instagram's `media_url` is a
signed CDN link that expires; Meta explicitly says not to store it. Copying the
bytes into Shopify Files gives a permanent URL served from the same CDN as the
rest of the site.

**Uploads are keyed on the Instagram post id.** Mirroring on every run would
upload five images an hour — about 44,000 files a year — with nothing deleting
them. A post already mirrored is skipped and posts that drop out have their
files deleted, so a typical run does zero uploads, zero deletes, and the stored
file count stays at five.

**The refreshed token lives in KV, not in a secret.** Worker secrets are
immutable at runtime, so a Worker cannot rewrite its own token. Without KV the
refreshed value would be discarded every invocation and the token would expire
at 60 days.

---

## Setup

Everything below needs accounts only the owner has. None of it can be automated
from the theme repo.

### 1. Instagram / Meta

Requires an Instagram **Business or Creator** account — confirmed present for
@Nessclusive.

1. Create an app at <https://developers.facebook.com>.
2. Add the **Instagram** product and set up **Instagram Login**.
3. Connect the Nessclusive account and generate a **long-lived access token**
   with the **`instagram_business_basic`** scope.

⚠️ **It must be Instagram Login, not Facebook Login.** The two mint different
tokens against different hosts, and they are not interchangeable:

| | Instagram Login — what this Worker uses | Facebook Login |
|---|---|---|
| Host | `graph.instagram.com` | `graph.facebook.com` |
| Media | `/me/media` | `/{ig-user-id}/media` |
| Scope | `instagram_business_basic` | `instagram_basic` |
| Refresh | `grant_type=ig_refresh_token` | `fb_exchange_token` |

A Facebook Login token returns `OAuthException` on the very first call, and the
weekly refresh silently no-ops — so the seed token also dies at day 60.

The token lasts 60 days. The Worker refreshes it weekly, so it only expires if
the Worker has been dead for two months. If the stored token is ever rejected,
the Worker clears it from KV automatically so the next run falls back to the
`IG_TOKEN` secret — re-seed the secret and it recovers on its own.

### 2. Shopify Admin token

Shopify admin → **Settings → Apps and sales channels → Develop apps → Create an
app**, then under **Configuration → Admin API** grant exactly:

- `write_files` — upload and delete the mirrored images
- `write_shop_metafields` (and `read_shop_metafields`) — write the feed

Install it and copy the **Admin API access token** (`shpat_…`).

### 3. Metafield definition

Required. The type must be exactly **JSON** to match what the Worker writes.

Shopify admin → **Settings → Custom data → Shop → Add definition**

| | |
|---|---|
| Namespace and key | `ness.instagram_feed` |
| Type | JSON |

### 4. Deploy

```bash
cd instagram-worker
npm install

npx wrangler kv namespace create NESS_IG      # paste the id into wrangler.toml
npx wrangler secret put IG_TOKEN              # the long-lived Instagram token
npx wrangler secret put SHOPIFY_ADMIN_TOKEN   # shpat_…
npx wrangler secret put ALERT_WEBHOOK         # optional, see below
npx wrangler secret put SYNC_SECRET           # optional, guards POST /sync

npx wrangler deploy
```

### 5. Verify

```bash
# Run the scheduled job once, without waiting for the hour
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=17+*+*+*+*"

# Then confirm the metafield was written
npx wrangler tail
```

The strip should show live posts within a minute. `GET /health` on the deployed
Worker returns how many posts are mirrored and when the token was last
refreshed, without changing anything.

---

## Operating it

**Set `ALERT_WEBHOOK`.** A silent failure here looks like nothing at all — the
strip simply stops updating, and the photos age out over weeks. Any URL that
accepts a JSON POST works; a Slack incoming webhook is the usual choice.

**Bump `SHOPIFY_API_VERSION` yearly.** Shopify supports each version for twelve
months. The four mutations used here have been stable across versions, so this
is normally a one-line change.

**Uploads are capped at two per run.** Each one costs about five subrequests,
and the free plan allows fifty per invocation — with the alert being the *last*
subrequest a failing run makes, so exhausting the budget would also silence the
alert. A cold start therefore fills the strip over the first few hours rather
than in one run. Raise `MAX_UPLOADS_PER_RUN` only on Workers Paid.

**Cost:** inside Cloudflare's free tier. 720 invocations a month, of which a
steady-state run makes about eight subrequests and does no uploads at all.
