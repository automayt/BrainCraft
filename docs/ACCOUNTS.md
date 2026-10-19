# Accounts, groups and single sign-on

By default a BrainCraft server shares boards by secret link: whoever has the
edit or view link gets in. For a team or a larger group, turn on **accounts**:
people sign in, admins manage who's who, groups carry permissions, and every
board has an owner and a list of who may view, edit or manage it.

```sh
BRAINCRAFT_ACCOUNTS=1 BRAINCRAFT_PUBLIC_URL=https://boards.example.org node dist/braincraft-server.mjs
```

With accounts on, the secret share links stop working: only signed-in people
with access can open a board. Servers without `BRAINCRAFT_ACCOUNTS` keep
sharing by link, unchanged.

## The first admin

Either:

- set `BRAINCRAFT_ADMINS=you@example.org,other@example.org`: those people are
  admins however they sign in (password or single sign-on), and can't be
  demoted from the app; or
- open the new server in a browser: the first visitor gets a **Set up this
  server** screen and creates the admin account (with `BRAINCRAFT_ADMINS` set,
  only one of those emails may).

## Roles, groups and permissions

- **Admins** can do everything: manage people and groups, open and hand over
  any board.
- **Users** can do what their groups allow.
- **Groups** are lists of people with permissions attached, so adding someone
  is just putting them in the right groups:

| Permission | Lets members |
| --- | --- |
| Make boards | start new boards and wikis on the server (they own them) |
| Share boards | give other people and groups access to boards they manage |
| Use the AI assistant | use the server's AI (see [AI.md](AI.md)) |
| See everyone | find people and groups by name when sharing (otherwise only an exact email finds someone) |

Everyone signed in is in the built-in **Everyone** group, which starts with
*Make boards* and *Use the AI assistant*; change it to suit. A person's
permissions are their groups' together.

Manage all of this from the account button (top right) → **People and
groups…**: add people (they get a one-time link to choose a password, valid
for a week, which you send them; no mail server needed), set roles, put people
in groups, turn accounts off, and make groups with checkboxes for their
permissions.

## Board access

- Whoever makes a board **owns** it and can manage it.
- **Share** on a board becomes **Access**: add people or groups with **Can
  view**, **Can edit** or **Can manage** (manage: change who has access, delete
  it from the server). Adding people needs *Share boards*.
- The owner (or an admin) can hand a board to someone else.
- Boards made before accounts were turned on have no owner: only admins see
  them, under **People and groups… → Boards without an owner**, and can give
  each one an owner. A board whose owner was removed goes back to admins the
  same way.
- "Your boards" lists the boards on the server you can open, with who owns
  them and what you can do. Each browser keeps a copy of the boards it has
  opened, for working offline; it syncs when back online. Those copies stay in
  that browser after signing out, so on a shared computer, clear the site's
  data (or use a private window).
- Names in live sessions are the accounts' names, so you can trust who's who.

## The activity log

**People and groups… → Activity** lists what happened on the server, newest
first, with who did it, when, and from which address:

- **People and groups:** the server's setup, people added, changed (role,
  groups, turned off or on), given a set-your-password link or removed;
  groups made, changed (permissions, members, provider groups) or removed;
  someone made an admin by `BRAINCRAFT_ADMINS`; the log being downloaded.
- **Sign-ins:** with a password or single sign-on, sign-outs, failed tries
  (wrong password, an unknown email, a turned-off account, a provider
  refusing), and accounts made or linked by single sign-on.
- **Board access:** who has a board (people and groups added, removed or
  given another level), boards handed over or deleted, and **an admin opening
  a board that isn't shared with them** (noted once an hour per board).
- **Passwords and API tokens:** passwords changed or chosen from a link, API
  tokens made or revoked.

Changes show what they were before and after. Filter by kind, by "only what
admins did", or by words (a name, an email, a board), and **Download all** for
the whole log as JSON lines. Only admins can see it. Passwords, links and
tokens are never written to it; a failed sign-in notes the email only when
what was typed is one.

The log is `BRAINCRAFT_DATA/accounts/audit.jsonl`, only ever added to. Each
entry includes a hash of the one before it, so if the file is edited or
entries are cut out, the Activity tab says from which entry on it no longer
matches. Past 10 MB the file is set aside as `audit-<number>.jsonl` and a new
one continues; nothing is deleted, so archive old files as your rules require.
For a copy the server can't touch, ship the file to your log system (it's one
JSON object per line).

## Single sign-on (OpenID Connect)

BrainCraft speaks OpenID Connect, which nearly every identity provider offers:
Microsoft Entra ID, Okta, Google Workspace, Keycloak, Authentik, Auth0,
JumpCloud and others. People click **Sign in with …** and come back signed in.
Accounts are made on first sign-in; an account an admin made earlier is linked
by its verified email.

| Setting | Meaning |
| --- | --- |
| `BRAINCRAFT_OIDC_ISSUER` | The provider's issuer URL (its `/.well-known/openid-configuration` must be reachable from the server). |
| `BRAINCRAFT_OIDC_CLIENT_ID` | The client (application) id you registered. |
| `BRAINCRAFT_OIDC_CLIENT_SECRET` | Its secret (a confidential web application). |
| `BRAINCRAFT_OIDC_NAME` | The button's words, e.g. `Sign in with Okta`. |
| `BRAINCRAFT_OIDC_SCOPES` | Optional; default `openid email profile`. Add what your provider needs for groups (e.g. `groups`). |
| `BRAINCRAFT_OIDC_GROUPS_CLAIM` | Optional; the claim holding group names, default `groups`. |
| `BRAINCRAFT_OIDC_ALLOWED_DOMAINS` | Optional; only these email domains may sign in, comma-separated. |
| `BRAINCRAFT_PUBLIC_URL` | The server's public address; the redirect URI is `<this>/api/auth/sso/callback`. |

**Register BrainCraft with your provider** as a web application using the
authorization-code flow, with redirect URI
`https://<your server>/api/auth/sso/callback` (the admin screen's **Sign-in**
tab shows the exact address). BrainCraft uses PKCE, checks `state` and
`nonce`, and verifies the ID token's signature (RS256/384/512, PS256,
ES256/384), issuer, audience and expiry.

**Groups from your provider:** in a BrainCraft group, list the provider's group
names under *Sign-in provider groups*. People whose sign-in carries one of
those names are in the group, updated at each sign-in. Groups an admin set by
hand stay as they are.

Provider notes:

- **Microsoft Entra ID:** issuer `https://login.microsoftonline.com/<tenant id>/v2.0`.
  Register an app (Web platform, the redirect URI above), create a client
  secret. For groups, add the *groups* claim in Token configuration; Entra
  sends group **object ids**, so list those ids in BrainCraft's groups.
  Entra only sends `email_verified` for some accounts; accounts are still
  made from `email`, but linking to an existing account needs it verified.
- **Okta:** issuer `https://<your org>.okta.com` (or a custom authorization
  server's issuer). Create an OIDC Web App; for groups, add a *groups* claim
  to the ID token (filter e.g. `Matches regex .*`) and the `groups` scope.
- **Google Workspace:** issuer `https://accounts.google.com`. Create an OAuth
  client (Web application) in Google Cloud. Google doesn't send groups; limit
  sign-in with `BRAINCRAFT_OIDC_ALLOWED_DOMAINS=yourcompany.com` and put people
  in groups by hand.
- **Keycloak:** issuer `https://<host>/realms/<realm>`. Create a client with
  *Client authentication* on; add a *Group Membership* mapper (claim `groups`,
  full path off) for groups.
- **Authentik:** issuer `https://<host>/application/o/<app slug>/`. Create an
  OAuth2/OpenID provider (confidential); groups come in the `groups` claim.

### Trying it without a provider

`BRAINCRAFT_DEV_IDP=1` serves a pretend provider at `/dev-idp` and points
single sign-on at it. Its sign-in page lets you be anyone, with any groups, so
you can try the whole flow (accounts made on sign-in, linking by email, groups
from the provider) on your own computer. It refuses to start unless
`BRAINCRAFT_PUBLIC_URL` is a localhost address.

```sh
BRAINCRAFT_ACCOUNTS=1 BRAINCRAFT_DEV_IDP=1 BRAINCRAFT_PUBLIC_URL=http://localhost:8080 node dist/braincraft-server.mjs
```

The same pretend provider runs in BrainCraft's tests, which go through the
full flow over HTTP and check that bad tokens are refused (wrong audience or
issuer, expired, forged signature, `alg: none`, a replayed sign-in, a nonce
that doesn't match, a rotated key).

### A real provider in ten minutes (Keycloak in Docker)

```sh
docker run -p 8081:8080 -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin quay.io/keycloak/keycloak start-dev
```

1. Open http://localhost:8081, sign in as admin/admin, create a realm
   `braincraft`.
2. Clients → Create client: id `braincraft`, *Client authentication* on,
   *Standard flow* on, valid redirect URI
   `http://localhost:8080/api/auth/sso/callback`. Copy the secret from the
   Credentials tab.
3. Client scopes → `braincraft-dedicated` → Add mapper → *Group Membership*,
   claim name `groups`, *Full group path* off.
4. Users → add a user with an email (tick *Email verified*), set a password,
   and add them to a group.
5. Start BrainCraft:

   ```sh
   BRAINCRAFT_ACCOUNTS=1 BRAINCRAFT_PUBLIC_URL=http://localhost:8080 \
   BRAINCRAFT_OIDC_ISSUER=http://localhost:8081/realms/braincraft \
   BRAINCRAFT_OIDC_CLIENT_ID=braincraft BRAINCRAFT_OIDC_CLIENT_SECRET=<secret> \
   BRAINCRAFT_OIDC_NAME="Sign in with Keycloak" node dist/braincraft-server.mjs
   ```

## Scripts and AI assistants

From the account button → **API tokens…**, make a token (shown once) and send
it as `Authorization: Bearer bct_…`. It acts as you: the board API
([SERVER.md](SERVER.md)) and the AI routes accept it.

```sh
curl -H "Authorization: Bearer bct_..." https://boards.example.org/api/boards
```

## Security notes

- Passwords are stored as scrypt hashes; sessions are random tokens stored
  only as hashes, in an HttpOnly, SameSite=Lax cookie (Secure behind HTTPS),
  lasting 30 days from last use. Turning an account off signs it out
  everywhere.
- Sign-in attempts are limited per address and per email.
- Requests that change anything must carry an `X-BrainCraft: 1` header, which
  other sites can't send, so they can't act for a signed-in person; live
  sessions only accept the server's own pages.
- The app must be served by the BrainCraft server itself (the usual setup).
  To call the API from other origins with cookies, list them in
  `BRAINCRAFT_ALLOWED_ORIGINS`.
- Behind an HTTPS proxy, set `BRAINCRAFT_PUBLIC_URL` (and
  `BRAINCRAFT_TRUST_PROXY=1`) so cookies are marked Secure and links use the
  right address.
- Accounts live in `BRAINCRAFT_DATA/accounts/` (`users.json`, `groups.json`,
  `sessions.json`, `boards.json`, and the activity log `audit.jsonl`); back
  them up with the boards.
