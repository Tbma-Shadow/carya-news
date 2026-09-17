# 行能资讯 · Carya News

Fork of [clairdelunesolace/energy-news-webapp](https://github.com/clairdelunesolace/energy-news-webapp), based on commit 2351713a7e861c91477b20f4b3113dcb37f79247. The upstream Java implementation remains in backend/ for reference; production uses worker/ and D1.

## Production

- Website: https://news.caryaenergy.com (external DNS CNAME to carya-news.pages.dev required).
- Pages fallback: https://carya-news.pages.dev.
- Scheduled Worker: carya-news, with the same code and D1 database as Pages.
- Database: carya-news. Migrations are in migrations/.
- Sign-in: shared access passphrase only, matching the tools directory; the passphrase is configured as a Cloudflare secret and is never included in this repository.

The website uses the Carya cream, brown, green, amber and coral palette, shared logo, and a transparent SVG newspaper favicon. Tools navigation links back to tools.caryaenergy.com.

## Runtime and features

Pages runs the React frontend and same-origin authenticated APIs. A separate Worker runs scheduled tasks against the same D1 database. This allows an externally managed DNS zone, matching the other Carya Pages sites.

Shared watchlists and keywords, bilingual article lists and details, RSS ingestion, URL deduplication, article extraction, weekly summaries, authentication and CSRF protection run on Workers. Existing article DTOs are preserved. `/weekly-briefs` and `/api/weekly-briefs` replace daily generation; the old page redirects and the daily generation API returns 410. Historical daily snapshots remain readable. No upstream user data was imported.

Codex searches public English and Chinese news every weekday at 09:00 Asia/Shanghai and imports verified articles through the authenticated `/api/discovery/import` endpoint. This local scheduled task needs the computer on and Codex running; it uses Codex usage without another search API key. RSS mode supplements this with pv magazine and Canary Media. Brave and GNews remain optional alternatives. Cloudflare Workers AI provides translation and Chinese weekly summaries (`@cf/qwen/qwen3-30b-a3b-fp8`) through an AI binding on both deployments. No new API key or subscription is required. DeepL remains an optional legacy provider when no AI binding exists.

Schedules use UTC cron values corresponding to Shanghai time: keyword refresh daily at 08:00 (yesterday and today, 20 results per keyword), RSS sync daily at 20:00, translation retries hourly at minute 20. Weekly summaries run Mondays at 09:30 for the previous Monday 00:00 through Sunday 23:59:59 Shanghai time. Monday 10:30 and 11:30 retry incomplete summaries; a successful summary is reused. Daily generation is disabled. Job summaries remain in job_runs for 30 days.

RSS checks at most 100 entries per source. Evening ingestion keeps a headline or description that contains one strong storage phrase or at least three weak related phrases. Morning discovery uses case-insensitive substring matches against configured keywords; it does not search article bodies. URLs are normalized and deduplicated. Similar events from different publishers remain separate articles; the weekly model can group them with citations. Adding or changing a keyword also matches stored articles. A source may block extraction, and an RSS feed may omit older items: this is not a complete historical news archive.

Translations are cached in D1 by model, language pair and text hash. New articles get Chinese metadata first; a separate queue fills bodies and retries failures, preserving original text. Each invocation reserves a conservative neuron budget before contacting AI; successful usage is reconciled when the provider reports neurons. The application stops at 8,000 neurons per UTC day and retries later, leaving headroom below Cloudflare's 10,000 daily free allowance. This is an application budget, not an account-wide billing cap: other applications share that allowance. No automatic paid-provider fallback is enabled. Source: https://developers.cloudflare.com/workers-ai/platform/pricing/ . Machine translations may need correction, and the English original remains available.

Weekly summaries cover up to 40 matched articles and use only their original headlines and descriptions. The summary records article citations and validates references, monetary values and uncertainty language. When generation or validation fails, the article list is saved with a pending status; it is never presented as a completed summary. A failed manual refresh preserves an existing successful summary.

Cloudflare request limits require bounded work: at most 20 keywords per manual discovery run, 50 results per keyword, and 20 records per maintenance backfill. RSS reads at most 100 entries from each feed. Sources may block automated access. This migration's AI guard rejects references outside the snapshot, altered monetary amounts and missing uncertainty qualifiers; weekly uncertainty checks apply to each cited event, so a neutral report heading does not invalidate a qualified summary.

## Development

Use Node.js 24.

    npm ci
    npm ci --prefix frontend
    npm test
    npm test --prefix frontend
    npm run build
    npx wrangler d1 migrations apply carya-news --local
    npx wrangler dev

Create an ignored .dev.vars containing ADMIN_PASSWORD for local sign-in. Do not put credentials in frontend environment variables.

## Deployment

    npm run build
    npx wrangler d1 migrations apply carya-news --remote
    npx wrangler deploy
    node scripts/build-pages.mjs
    cd pages-deploy
    ../node_modules/.bin/wrangler pages deploy ../pages --project-name carya-news --branch main --no-bundle

On Windows, scripts/deploy-api.mjs can deploy the prebuilt Worker using the same Cloudflare asset-upload API when esbuild cannot traverse the sandbox's parent directories. It uses CLOUDFLARE_API_TOKEN or the Wrangler OAuth configuration under XDG_CONFIG_HOME; it does not contain credentials.

The Pages project needs DB and AI bindings and the same provider variables and secrets as the Worker. `scripts/build-pages.mjs` writes its generated deployment configuration. Apply migrations 0002 and 0003 before deploying this version. Configure ADMIN_PASSWORD on both. ADMIN_USERNAME is no longer used. Optional secrets: BRAVE_SEARCH_API_KEY, GNEWS_API_KEY, DEEPL_API_KEY, GROQ_API_KEY. NEWS_DISCOVERY_PROVIDER accepts rss, brave, gnews or none. Set WEEKLY_BRIEF_SCHEDULER_ENABLED=true and DAILY_BRIEF_SCHEDULER_ENABLED=false in both deployments.

Optional GitHub Actions templates are in docs/workflows/. Move them to .github/workflows/ with a GitHub credential that permits workflow changes to enable CI. The deployment template requires a repository secret named CLOUDFLARE_API_TOKEN with Workers, Pages and D1 permissions. The initial upload was performed from the authenticated local session.

The local checkout was reconstructed from the verified upstream commit and tree as a shallow checkout because the supplied Git runtime lacks its HTTPS transport helper. The GitHub fork retains the upstream history. A regular Git installation can fetch --unshallow from origin.

Search import details, editorial checks, retries, source limits and the separation between web search and local article filtering are documented in [docs/news-ingestion.md](docs/news-ingestion.md). Imported Chinese metadata is retained while missing article bodies enter the hourly extraction and translation queues.
