# App Health Checker

A small board that probes the apps you choose, from outside those apps.

The first run watches the ecommerce apps below. After you save Settings, that list is yours: add an external app and its row appears on the board. `STATUS_SECRET` stays in the environment and is not part of the settings pane.

| Seeded app | Check |
| --- | --- |
| Platform API | `GET /health` on port 3000, then `GET /health/ready` for Postgres, Redis, and the worker |
| Storefront | `GET /api/health` and a homepage curl of `/` on port 3001 |
| POS | `GET /api/health` and a homepage curl of `/` on port 3002 |
| Console | `GET /api/health` and a homepage curl of `/` on port 3003 |
| Academy | `GET /api/health` and a homepage curl of `/` on port 3004 |

The page and `GET /api/status` show status, latency, version, and a 24-hour uptime bar. They do not include connection strings or driver errors.

Checks also run on a timer while this process is up, including when the board has no open browser. **Settings** on the board chooses the interval, the apps and URLs, and when email is sent. A homepage URL is an extra GET of the public page: any HTTP success counts as up, and the HTML is ignored. A failed homepage leaves the app degraded while its health URL is still up. Those values are stored in `.status/config.json` and override the environment. The environment seeds the first run, before anything is saved.

A service that matches the chosen rule (down only, or down and degraded) sends one email. A service that stays in that state is reminded on the saved interval. When it leaves that state, one recovery email is sent. A blank SMTP password on save keeps the password already stored. The board never receives the password back.

Alerts stay off until a recipient, an SMTP host, and a from address are saved. See `.env.example`.

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3099. Copy `.env.example` when the apps are not on the local ports.

## Docker

```bash
docker build -t app-health-checker .
docker run --rm -p 3099:3099 \
  -e STATUS_SECRET \
  -e PLATFORM_HEALTH_URL=http://platform:3000/health \
  -e PLATFORM_READY_URL=http://platform:3000/health/ready \
  -v app-health-checker:/usr/src/app/.status \
  app-health-checker
```

Pass the same URL and SMTP variables as `.env.example`. `127.0.0.1` inside the container is the container, so use the other services' hostnames. The `.status` volume keeps saved settings and the 24-hour history. The sign-in cookie is Secure when `NODE_ENV` is production, so serve the board over HTTPS.

The board asks for `STATUS_SECRET` before it shows anything. That value lives in `.env` or `.env.local`. A matching key sets an httpOnly cookie for 8 hours. `GET /api/status` and the settings API use the same cookie. Without `STATUS_SECRET`, the page stays closed.

## Platform worker

The API server calls the worker health port during readiness. The worker opens that port when `index-worker` starts.

Same machine (the default): worker listens on `127.0.0.1:3020`, and the API probes that URL.

Split hosts:

- Worker: `WORKER_HEALTH_HOSTNAME=0.0.0.0` and `WORKER_HEALTH_PORT=3020`
- API: `WORKER_HEALTH_URL=http://worker:3020/health`

`WORKER_HEALTH_DISABLED=true` on the API skips the worker check. Redis is checked only when BullMQ is in use (`USE_BULLMQ=true`, or a non-dev deploy with `REDIS_HOST`).

Put this app on a private network. After the key is accepted, the board answers with up, degraded, or down.
