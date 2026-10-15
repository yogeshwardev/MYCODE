---
name: deployment
description: Ship an app to production - Vercel, Netlify, Cloudflare, Fly.io, Render, Railway, AWS, GCP, Azure, Docker or a VPS - with environment config, builds, domains, monitoring and rollback.
triggers: deploy, deployment, hosting, vercel, netlify, cloudflare, fly.io, render, railway, heroku, production, go live, domain, ssl, docker image, release
---
1. **Pick the target** the project already uses (config files like `vercel.json`, `netlify.toml`, `fly.toml`, `Dockerfile`, CI deploy jobs) or recommend the simplest fit for the stack, and explain the choice in one line.
2. **Make the build reproducible**: pinned runtime version, lockfile install, a production build command that passes locally, and health-check and start commands.
3. **Configuration**: list every environment variable the app needs, provide `.env.example`, and set secrets in the platform's secret store, never in the repo. Separate preview/staging from production.
4. **Deploy safely**: use the platform CLI only after the user confirms the target account and project (deploying is an outward-facing action). Prefer preview deployments first, and run database migrations as a separate, reversible step.
5. **After deploy**: check the live URL (browser tools), health endpoints and logs; set up error tracking and uptime monitoring if missing; and document the rollback (previous deployment or image tag).
6. Write the steps into the README or a `DEPLOY.md` so the team can repeat them.
