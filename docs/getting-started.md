# Getting Started

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [Bun](https://bun.sh) installed (`curl -fsSL https://bun.sh/install | bash`)

---

## 1. Clone and install

```bash
git clone <repo-url>
cd ruin
cd webapp && bun install && cd ..
```

---

## 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

| Variable | What to put |
|---|---|
| `POSTGRES_USER` | any username, e.g. `ruin` |
| `POSTGRES_PASSWORD` | strong password |
| `KEYCLOAK_ADMIN` | admin username for Keycloak UI |
| `KEYCLOAK_ADMIN_PASSWORD` | strong password |
| `NEXTAUTH_SECRET` | run `openssl rand -base64 32` and paste output |
| `NEXTAUTH_URL` | `http://localhost:3000` |
| `KEYCLOAK_CLIENT_SECRET` | leave blank for now — fill after step 4 |

---

## 3. Start infrastructure

```bash
docker compose up -d postgres keycloak
```

Wait ~30 seconds, then check Keycloak is up: http://localhost:8080

---

## 4. Configure Keycloak

1. Open http://localhost:8080 and log in with `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`
2. **Create realm** — top-left dropdown → "Create realm" → name: `ruin` → Create
3. **Create client** — left sidebar → Clients → Create client
   - Client ID: `ruin-web`
   - Client type: OpenID Connect → Next
   - Client authentication: **ON** → Next
   - Valid redirect URIs: `http://localhost:3000/api/auth/callback/keycloak`
   - Valid post-logout redirect URIs: `http://localhost:3000`
   - Save
4. **Copy the secret** — Credentials tab → copy "Client secret"
5. Paste it into `.env` as `KEYCLOAK_CLIENT_SECRET`

---

## 5. Run the web app

```bash
cd webapp && bun dev
```

App is live at http://localhost:3000.  
Auth routes are available at http://localhost:3000/api/auth/signin.

---

## One-liner (after first-time setup)

```bash
docker compose up -d && cd webapp && bun dev
```

---

## Ports reference

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| Keycloak admin | http://localhost:8080 |
| PostgreSQL | localhost:5432 |