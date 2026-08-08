/**
 * Nessclusive — Instagram feed mirror.
 *
 * Pulls the most recent posts from Instagram, mirrors their images into Shopify
 * Files, and writes [{id, src, permalink}] into the shop metafield
 * ness.instagram_feed. The theme renders that metafield server-side, so the
 * storefront never calls Instagram: no client fetch, no CORS, no layout shift.
 *
 * Uses the **Instagram API with Instagram Login** surface — host
 * graph.instagram.com, the /me/media shortcut, and grant_type=ig_refresh_token.
 * That triple requires a token carrying `instagram_business_basic`. A token
 * minted through Facebook Login will 400 on every call; see README step 1.
 *
 * Design constraints, each of which cost a bug in review:
 *
 * 1. Instagram's media_url is a signed, expiring CDN link that Meta says not to
 *    store, so bytes are copied into Shopify Files and the permanent Shopify
 *    URL is what the theme renders.
 *
 * 2. A Shopify file id must reach KV before anything else can throw. Uploading
 *    a file and losing its id leaks it permanently — nothing here enumerates
 *    Shopify Files, so such a leak never self-corrects. This is the unbounded
 *    growth the whole id-keyed design exists to prevent.
 *
 * 3. Deletion is irreversible, so it only runs on a response we trust. A
 *    partial Instagram response is not grounds for destroying mirrored files.
 *
 * 4. Silence is the dangerous failure. A dead cron or an unrefreshed token
 *    looks like nothing at all until the strip is weeks stale, so both are
 *    surfaced through /health and the alert webhook.
 */

const IG_API = 'https://graph.instagram.com';

/* Long-lived tokens last 60 days and are refreshable after 24 hours. Weekly
   refresh leaves eight weeks of slack. */
const TOKEN_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/* If a refresh has not succeeded in this long, something is wrong and there is
   still time to fix it by hand. */
const TOKEN_STALE_ALERT_MS = 14 * 24 * 60 * 60 * 1000;
/* /health reports unhealthy if no run has succeeded in this long — three missed
   hourly runs. */
const RUN_STALE_MS = 3 * 60 * 60 * 1000;

/* Each upload costs ~4 subrequests plus one per readiness poll. The Workers
   free plan allows 50 per invocation, and the alert is the *last* subrequest a
   failing run makes — so exhausting the budget also silences the alert. Two
   uploads per run keeps the worst case near 20 and spreads a cold start over a
   few hours. */
const MAX_UPLOADS_PER_RUN = 2;

const KV_TOKEN = 'ig_token';
const KV_TOKEN_REFRESHED_AT = 'ig_token_refreshed_at';
const KV_MIRRORED = 'mirrored_posts';
const KV_LAST_SUCCESS = 'last_success_at';
const KV_LOCK = 'run_lock';

export default {
  /* Returned rather than passed to waitUntil: waitUntil resolves the scheduled
     event immediately, so Cloudflare records every run as a success and
     `wrangler tail` shows nothing regardless of what happened. */
  async scheduled(event, env) {
    return run(env, 'cron');
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      const state = await readState(env);
      const runAge = state.lastSuccess ? Date.now() - state.lastSuccess : null;
      const tokenAge = state.refreshedAt ? Date.now() - state.refreshedAt : null;
      const healthy = runAge !== null && runAge < RUN_STALE_MS;
      return json(
        {
          ok: healthy,
          mirroredPosts: Object.keys(state.mirrored).length,
          lastSuccessAt: state.lastSuccess ? new Date(state.lastSuccess).toISOString() : null,
          tokenRefreshedAt: state.refreshedAt ? new Date(state.refreshedAt).toISOString() : null,
          tokenStale: tokenAge === null || tokenAge > TOKEN_STALE_ALERT_MS,
        },
        healthy ? 200 : 503,
      );
    }

    if (url.pathname === '/sync' && request.method === 'POST') {
      const auth = request.headers.get('authorization') || '';
      if (!env.SYNC_SECRET || auth !== `Bearer ${env.SYNC_SECRET}`) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      try {
        return json({ ok: true, ...(await run(env, 'manual')) });
      } catch (error) {
        return json({ ok: false, error: String(error && error.message) }, 500);
      }
    }

    return json({ ok: false, error: 'not found' }, 404);
  },
};

async function run(env, trigger) {
  /* A manual /sync overlapping the cron would have both runs read pre-write
     state, upload the same post twice, and last-write-wins would drop one file
     id — leaking it. */
  const held = await env.NESS_IG.get(KV_LOCK);
  if (held && Date.now() - parseInt(held, 10) < 5 * 60 * 1000) {
    console.log('run already in progress; skipping');
    return { trigger, skipped: 'locked' };
  }
  await env.NESS_IG.put(KV_LOCK, String(Date.now()), { expirationTtl: 300 });

  try {
    const limit = parseInt(env.POST_LIMIT || '5', 10);
    const state = await readState(env);

    if (state.refreshedAt && Date.now() - state.refreshedAt > TOKEN_STALE_ALERT_MS) {
      /* Deliberately does not throw — the token is still valid, and there is
         time to fix it before day 60. But nothing else would ever say so. */
      await alert(env, new Error('Instagram token has not refreshed in over 14 days'));
    }

    const token = await currentToken(env);
    await maybeRefreshToken(env, token, state.refreshedAt);

    const posts = await fetchRecentPosts(env, token, limit);
    if (!posts.length) {
      throw new Error('Instagram returned no usable posts; metafield left unchanged');
    }

    const shopGid = await shopId(env);

    const entries = [];
    const nextMirrored = {};
    const retire = [];
    let budget = MAX_UPLOADS_PER_RUN;
    let uploaded = 0;

    for (const post of posts) {
      const existing = state.mirrored[post.id];

      if (existing && existing.src) {
        entries.push({ id: post.id, src: existing.src, permalink: post.permalink });
        nextMirrored[post.id] = existing;
        continue;
      }

      /* A previous attempt uploaded a file but never got a URL for it. Retire
         that file — re-uploading without this leaves the first one orphaned,
         and it can never appear in `stale` because the post is still current. */
      if (existing && existing.fileId) retire.push(existing.fileId);

      if (budget <= 0) {
        /* Out of subrequest budget. Serve Instagram's own URL for now; the post
           is not recorded as mirrored, so the next run picks it up. */
        entries.push({ id: post.id, src: post.imageUrl, permalink: post.permalink });
        continue;
      }
      budget--;

      try {
        const mirrored = await mirrorImage(env, post);
        entries.push({ id: post.id, src: mirrored.src, permalink: post.permalink });
        nextMirrored[post.id] = mirrored;
        uploaded++;
      } catch (error) {
        entries.push({ id: post.id, src: post.imageUrl, permalink: post.permalink });
        /* The file may exist in Shopify even though we never got a URL. Record
           the id so the next run can retire it. Without this the file is
           unreachable forever. */
        if (error.fileId) nextMirrored[post.id] = { fileId: error.fileId, src: null };
        console.error(`mirror failed for ${post.id}: ${error.message}`);
      }
    }

    /* Union write, BEFORE anything else can throw. Union rather than
       replacement: writing bare nextMirrored here would drop the file ids of
       posts that rotated out but are still referenced by the current
       metafield. A union can only add ids, so no later failure loses one. */
    await env.NESS_IG.put(KV_MIRRORED, JSON.stringify({ ...state.mirrored, ...nextMirrored }));

    await writeMetafield(env, shopGid, entries);

    /* Deletion is irreversible, so only prune on a response we trust. A partial
       Instagram response — some posts still processing, so filtered out for
       having no media_url — would otherwise destroy the files for every post
       that happened to be missing this hour. */
    let deleted = 0;
    const trustworthy = posts.length >= limit;
    const stale = Object.keys(state.mirrored)
      .filter((id) => !nextMirrored[id])
      .map((id) => state.mirrored[id] && state.mirrored[id].fileId)
      .filter(Boolean);
    const staleFileIds = trustworthy ? stale.concat(retire) : retire;

    if (staleFileIds.length) {
      const gone = await deleteFiles(env, staleFileIds);
      deleted = gone.size;
      /* Keep only ids Shopify did NOT confirm deleted. Retaining the whole
         batch on any failure meant one already-removed file wedged deletion
         permanently: the batch failed forever and state grew every rotation. */
      const merged = { ...state.mirrored, ...nextMirrored };
      for (const id of Object.keys(merged)) {
        const fid = merged[id] && merged[id].fileId;
        const current = nextMirrored[id];
        if (!current && (!fid || gone.has(fid))) delete merged[id];
      }
      await env.NESS_IG.put(KV_MIRRORED, JSON.stringify(merged));
    } else if (trustworthy) {
      await env.NESS_IG.put(KV_MIRRORED, JSON.stringify(nextMirrored));
    }

    await env.NESS_IG.put(KV_LAST_SUCCESS, String(Date.now()));
    const summary = { trigger, posts: entries.length, uploaded, deleted };
    console.log(`sync ok ${JSON.stringify(summary)}`);
    return summary;
  } catch (error) {
    console.error(`sync failed: ${error && error.message}`);
    await alert(env, error);
    throw error;
  } finally {
    await env.NESS_IG.delete(KV_LOCK);
  }
}

/* --- Instagram ---------------------------------------------------------- */

async function currentToken(env) {
  const stored = await env.NESS_IG.get(KV_TOKEN);
  return stored || env.IG_TOKEN;
}

async function maybeRefreshToken(env, token, refreshedAt) {
  if (refreshedAt && Date.now() - refreshedAt < TOKEN_REFRESH_INTERVAL_MS) return;

  const res = await fetch(
    `${IG_API}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
  );

  if (!res.ok) {
    console.error(`token refresh failed: ${res.status}`);
    return;
  }
  const body = await res.json();
  if (body && body.access_token) {
    await env.NESS_IG.put(KV_TOKEN, body.access_token);
    await env.NESS_IG.put(KV_TOKEN_REFRESHED_AT, String(Date.now()));
    console.log('token refreshed');
  }
}

async function fetchRecentPosts(env, token, limit) {
  const fields = 'id,media_type,media_url,thumbnail_url,permalink,timestamp';
  /* Over-fetch: posts with no usable still are filtered out below, and asking
     for exactly `limit` would then return too few tiles. */
  const url = `${IG_API}/me/media?fields=${fields}&limit=${limit * 3}&access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url);

  if (res.status === 400 || res.status === 401) {
    /* The stored token is rejected. Clear it so the next run falls back to the
       IG_TOKEN secret — otherwise KV wins forever and re-seeding the secret,
       which is what the README tells the operator to do, has no effect. */
    const body = await res.text();
    if (await env.NESS_IG.get(KV_TOKEN)) {
      await env.NESS_IG.delete(KV_TOKEN);
      await env.NESS_IG.delete(KV_TOKEN_REFRESHED_AT);
      console.error('stored token rejected; cleared KV so the secret is used next run');
    }
    throw new Error(`Instagram auth ${res.status}: ${body.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(`Instagram API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const body = await res.json();

  return ((body && body.data) || [])
    /* CAROUSEL_ALBUM is skipped rather than guessed at: its media_url is not
       reliably a still, and uploading video bytes as contentType IMAGE fails
       in Shopify and leaks the staged file. */
    .filter((item) => item.media_type === 'IMAGE' || item.media_type === 'VIDEO')
    .map((item) => ({
      id: item.id,
      permalink: item.permalink,
      /* VIDEO and REEL put the video file in media_url; the still is in
         thumbnail_url. Getting this backwards renders an <img> pointing at an
         mp4, which only shows up once a reel is posted. */
      imageUrl: item.media_type === 'VIDEO' ? item.thumbnail_url : item.media_url,
    }))
    .filter((p) => p.imageUrl && isInstagramPermalink(p.permalink))
    .slice(0, limit);
}

/* The permalink ends up in an href on the storefront. Anything that is not an
   instagram.com URL is dropped here rather than trusted downstream. */
function isInstagramPermalink(url) {
  return typeof url === 'string' && /^https:\/\/(www\.)?instagram\.com\//.test(url);
}

/* --- Shopify ------------------------------------------------------------ */

async function shopifyGraphQL(env, query, variables, options = {}) {
  const res = await fetch(
    `https://${env.SHOPIFY_SHOP}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  if (!res.ok) {
    throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const body = await res.json();
  if (body.errors) {
    throw new Error(`Shopify GraphQL: ${JSON.stringify(body.errors).slice(0, 300)}`);
  }

  /* userErrors come back with HTTP 200 and no top-level errors, so a mutation
     can "succeed" having done nothing. Deletion opts out: a file that is
     already gone is the outcome we wanted. */
  if (!options.tolerateUserErrors) {
    for (const key of Object.keys(body.data || {})) {
      const errs = body.data[key] && body.data[key].userErrors;
      if (errs && errs.length) {
        throw new Error(`Shopify ${key}: ${JSON.stringify(errs).slice(0, 300)}`);
      }
    }
  }

  return body.data;
}

async function shopId(env) {
  return (await shopifyGraphQL(env, `{ shop { id } }`, {})).shop.id;
}

async function mirrorImage(env, post) {
  const source = await fetch(post.imageUrl);
  if (!source.ok) throw new Error(`image fetch ${source.status}`);

  /* Trust the response, not the platform. An unexpected content type means the
     media_type mapping was wrong, and uploading it as an image would fail in
     Shopify and leak the staged file. */
  const contentType = (source.headers.get('content-type') || '').split(';')[0].trim();
  if (!contentType.startsWith('image/')) {
    throw new Error(`unexpected content type ${contentType || 'unknown'}`);
  }

  const declared = parseInt(source.headers.get('content-length') || '0', 10);
  if (declared > 20 * 1024 * 1024) throw new Error(`image too large (${declared} bytes)`);

  const bytes = await source.arrayBuffer();
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const filename = `instagram-${post.id}.${extension}`;

  const staged = await shopifyGraphQL(
    env,
    `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
       stagedUploadsCreate(input: $input) {
         stagedTargets { url resourceUrl parameters { name value } }
         userErrors { field message }
       }
     }`,
    {
      input: [
        {
          filename,
          mimeType: contentType,
          resource: 'FILE',
          httpMethod: 'POST',
          fileSize: String(bytes.byteLength),
        },
      ],
    },
  );

  const target = staged.stagedUploadsCreate.stagedTargets[0];

  /* Parameters must precede the file, in the order Shopify returned them. */
  const form = new FormData();
  for (const param of target.parameters) form.append(param.name, param.value);
  form.append('file', new Blob([bytes], { type: contentType }), filename);

  const upload = await fetch(target.url, { method: 'POST', body: form });
  if (!upload.ok) throw new Error(`staged upload ${upload.status}`);

  const created = await shopifyGraphQL(
    env,
    `mutation fileCreate($files: [FileCreateInput!]!) {
       fileCreate(files: $files) {
         files { id fileStatus ... on MediaImage { image { url } } }
         userErrors { field message }
       }
     }`,
    { files: [{ originalSource: target.resourceUrl, contentType: 'IMAGE', alt: 'Instagram post' }] },
  );

  const file = created.fileCreate.files[0];

  /* From here the file exists in Shopify. Any failure must carry its id out,
     or it is orphaned with nothing able to find it again. */
  try {
    return { fileId: file.id, src: await waitForFile(env, file.id) };
  } catch (error) {
    error.fileId = file.id;
    throw error;
  }
}

/* Shopify processes uploads asynchronously — fileCreate returns before a URL
   exists. Polling without this writes a null src and renders an empty tile. */
async function waitForFile(env, fileId, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    const data = await shopifyGraphQL(
      env,
      `query fileStatus($id: ID!) {
         node(id: $id) { ... on MediaImage { fileStatus image { url } } }
       }`,
      { id: fileId },
    );
    const node = data.node;
    if (node && node.fileStatus === 'READY' && node.image && node.image.url) return node.image.url;
    if (node && node.fileStatus === 'FAILED') throw new Error('Shopify file processing failed');
    await sleep(1200 * (i + 1));
  }
  throw new Error('Shopify file did not become ready in time');
}

/* Returns the set of ids Shopify confirmed deleted. Tolerates userErrors: an
   id that no longer exists is a success for our purposes, and treating it as
   failure previously wedged the whole batch forever. */
async function deleteFiles(env, fileIds) {
  const data = await shopifyGraphQL(
    env,
    `mutation fileDelete($fileIds: [ID!]!) {
       fileDelete(fileIds: $fileIds) { deletedFileIds userErrors { field message } }
     }`,
    { fileIds },
    { tolerateUserErrors: true },
  );
  const deleted = (data.fileDelete && data.fileDelete.deletedFileIds) || [];
  const errs = (data.fileDelete && data.fileDelete.userErrors) || [];
  if (errs.length) console.error(`fileDelete userErrors: ${JSON.stringify(errs).slice(0, 200)}`);
  return new Set(deleted);
}

async function writeMetafield(env, ownerId, entries) {
  await shopifyGraphQL(
    env,
    `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
       metafieldsSet(metafields: $metafields) {
         metafields { id }
         userErrors { field message }
       }
     }`,
    {
      metafields: [
        {
          ownerId,
          namespace: env.METAFIELD_NAMESPACE,
          key: env.METAFIELD_KEY,
          type: 'json',
          value: JSON.stringify(entries),
        },
      ],
    },
  );
}

/* --- Support ------------------------------------------------------------ */

async function readState(env) {
  const [mirrored, refreshedAt, lastSuccess] = await Promise.all([
    env.NESS_IG.get(KV_MIRRORED),
    env.NESS_IG.get(KV_TOKEN_REFRESHED_AT),
    env.NESS_IG.get(KV_LAST_SUCCESS),
  ]);
  return {
    mirrored: mirrored ? JSON.parse(mirrored) : {},
    refreshedAt: refreshedAt ? parseInt(refreshedAt, 10) : null,
    lastSuccess: lastSuccess ? parseInt(lastSuccess, 10) : null,
  };
}

async function alert(env, error) {
  if (!env.ALERT_WEBHOOK) return;
  try {
    await fetch(env.ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Nessclusive Instagram sync: ${String(error && error.message)}`,
      }),
    });
  } catch (e) {
    console.error('alert delivery failed');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
