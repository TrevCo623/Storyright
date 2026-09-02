# Deploying Storyright

Storyright is a Next.js 14 app using Supabase (Postgres, Auth, Storage) and the
Anthropic API, deployed to Netlify. This walks through going from this
codebase to a live `*.netlify.app` URL.

Run all commands below from your own Terminal on your Mac, inside this
`storyright-app` folder — not from inside Claude. (If you see a stray, empty
`.git` folder already here, delete it first via Finder; it's leftover from a
sandboxed attempt that couldn't fully clean up after itself, and `git init`
below will complain if it's partially there.)

## 1. Supabase project

1. In the [Supabase dashboard](https://supabase.com/dashboard), create a new project (any region close to you is fine).
2. Open **SQL Editor**, paste the full contents of `supabase/migrations/0001_init.sql`, and run it. This creates every table (`profiles`, `subjects`, `sections`, `entries`, `suggestion_feedback`, `past_work_samples`, `advice_threads`), row-level security policies, the `past-work` Storage bucket, and the trigger that auto-creates a `profiles` row on signup.
3. Go to **Project Settings → API** and copy three values — you'll need them in step 4 below:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key (click reveal) → `SUPABASE_SERVICE_ROLE_KEY` — keep this one secret, never put it in `NEXT_PUBLIC_*`

## 2. Google OAuth

1. In [Google Cloud Console](https://console.cloud.google.com/), open **APIs & Services → Credentials** (create a project first if you don't have one for this).
2. Create an **OAuth client ID** of type "Web application."
3. In the Supabase dashboard, go to **Authentication → Providers → Google**, toggle it on, and note the **Callback URL** it shows you (looks like `https://<project-ref>.supabase.co/auth/v1/callback`).
4. Back in Google Cloud Console, add that exact URL to **Authorized redirect URIs** on the OAuth client, save, then copy the Client ID and Client Secret into the Supabase Google provider fields and save there too.
5. Still in Supabase, go to **Authentication → URL Configuration** and set:
   - **Site URL**: your eventual Netlify URL (placeholder for now, e.g. `https://storyright.netlify.app` — you'll confirm the real one in step 5)
   - **Additional Redirect URLs**: add both `http://localhost:3000/auth/callback` (for local dev) and `https://storyright.netlify.app/auth/callback` (swap in your real subdomain once you know it)

## 3. Anthropic API key

Grab a key from the [Anthropic Console](https://console.anthropic.com/settings/keys) → `ANTHROPIC_API_KEY`. This powers Review, the onboarding style fingerprint, and highlight-to-ask advice — all called server-side only, never exposed to the browser.

## 4. Push to git

```bash
git init
git add -A
git commit -m "Storyright Phase 1 MVP"
```

Create an empty repo on GitHub (or GitLab), then:

```bash
git remote add origin <your-repo-url>
git branch -M main
git push -u origin main
```

## 5. Netlify

1. In the [Netlify dashboard](https://app.netlify.com/), **Add new site → Import an existing project**, connect the repo you just pushed.
2. Netlify will read `netlify.toml` automatically (`npm run build`, `@netlify/plugin-nextjs`) — you shouldn't need to touch the build settings.
3. Before the first deploy, go to **Site configuration → Environment variables** and add all five:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`
   - `NEXT_PUBLIC_SITE_URL` — set to `http://localhost:3000` for now, you'll fix this next
4. Deploy. Netlify assigns you a `*.netlify.app` subdomain (or pick a custom one for free under Site configuration → Site details → Change site name).

## 6. Wire up the real URL

Once you have your real `https://<your-site>.netlify.app`:

1. Netlify → Environment variables → update `NEXT_PUBLIC_SITE_URL` to that URL, then trigger a redeploy (Deploys → Trigger deploy).
2. Supabase → Authentication → URL Configuration → update **Site URL** and **Additional Redirect URLs** to use the real subdomain instead of the placeholder (`https://<your-site>.netlify.app/auth/callback`).

## 7. Verify

Visit the site, click **Continue with Google**, confirm it lands you on `/onboarding` for a first-time login (or straight into `/subjects` afterward). Create a project, write a paragraph, hit **Review**, and confirm suggestions come back — that exercises the full chain (auth, DB, and the Anthropic API key) in one pass.
