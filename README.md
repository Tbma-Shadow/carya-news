# 行能资讯 · Carya News

Fork of [clairdelunesolace/energy-news-webapp](https://github.com/clairdelunesolace/energy-news-webapp), based on commit 2351713a7e861c91477b20f4b3113dcb37f79247. The upstream Java implementation remains in backend/ for reference; production uses worker/ and D1.

## Production

- Website: https://news.caryaenergy.com (external DNS CNAME to carya-news.pages.dev required).
- Pages fallback: https://carya-news.pages.dev.
- Scheduled Worker: carya-news, with the same code and D1 database as Pages.
- Database: carya-news. Migrations are in migrations/.
- Sign-in: shared account, username carya; password is configured as a Cloudflare secret and is never included in this repository.

The website uses the Carya cream, brown, green, amber and coral palette, shared logo, and a transparent SVG newspaper favicon. Tools navigation links back to tools.caryaenergy.com.

## Runtime and features

Pages runs the React frontend and same-origin authenticated APIs. A separate Worker runs scheduled tasks against the same D1 database. This allows an externally managed DNS zone, matching the other Carya Pages sites.

Shared watchlists and keywords, article filtering and pagination, RSS ingestion, duplicate detection, article extraction, DeepL translation, daily snapshots, Groq analysis, authentication and CSRF protection have Workers implementations. APIs retain the frontend routes and DTOs. The old database is not imported: this deployment starts a new D1 database. No upstream user data is present in the source repository.

RSS mode searches the configured feeds, not the entire web. Brave and GNews remain optional alternatives. DeepL and Groq require their respective secrets; missing providers return an explicit unavailable response and do not generate sample translations or analyses.

Schedules use UTC cron values corresponding to Shanghai time: keyword refresh at 08:00, previous-day briefs at 08:10, RSS sync at 20:00. Daily brief boundaries are midnight to midnight in Asia/Shanghai. Job summaries are retained in job_runs for 30 days.

Cloudflare request limits require bounded work: at most 20 keywords per manual discovery run, 50 results per keyword, and 20 records per maintenance backfill. RSS reads at most 100 entries from each feed. Sources may block automated access. This migration's AI guard rejects references outside the snapshot, altered monetary amounts and missing uncertainty qualifiers; its global uncertainty check is deliberately conservative. External-provider calls need live acceptance after keys are configured.

## Development

Use Node.js 24.

    npm ci
    npm ci --prefix frontend
    npm test
    npm test --prefix frontend
    npm run build
    npx wrangler d1 migrations apply carya-news --local
    npx wrangler dev

Create an ignored .dev.vars containing ADMIN_USERNAME and ADMIN_PASSWORD for local sign-in. Do not put credentials in frontend environment variables.

## Deployment

    npm run build
    npx wrangler d1 migrations apply carya-news --remote
    npx wrangler deploy
    node scripts/build-pages.mjs
    cd pages-deploy
    ../node_modules/.bin/wrangler pages deploy ../pages --project-name carya-news --branch main --no-bundle

On Windows, scripts/deploy-api.mjs can deploy the prebuilt Worker using the same Cloudflare asset-upload API when esbuild cannot traverse the sandbox's parent directories. It uses CLOUDFLARE_API_TOKEN or the Wrangler OAuth configuration under XDG_CONFIG_HOME; it does not contain credentials.

The Pages project needs the DB binding and the same provider variables and secrets as the Worker. Configure ADMIN_USERNAME and ADMIN_PASSWORD on both. Optional secrets: BRAVE_SEARCH_API_KEY, GNEWS_API_KEY, DEEPL_API_KEY, GROQ_API_KEY. NEWS_DISCOVERY_PROVIDER accepts rss, brave, gnews or none. Set the provider and scheduler flags in both environments when changing modes.

Optional GitHub Actions templates are in docs/workflows/. Move them to .github/workflows/ with a GitHub credential that permits workflow changes to enable CI. The deployment template requires a repository secret named CLOUDFLARE_API_TOKEN with Workers, Pages and D1 permissions. The initial upload was performed from the authenticated local session.

The local checkout was reconstructed from the verified upstream commit and tree as a shallow checkout because the supplied Git runtime lacks its HTTPS transport helper. The GitHub fork retains the upstream history. A regular Git installation can fetch --unshallow from origin.
