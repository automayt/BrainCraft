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
- **Group admins** look after one or more groups: they add people to them and
  take them out, without being admins (see below).
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

Manage all of this from the account button (top right) → **Admin…**: add
people (they get a one-time link to choose a password, valid
for a week, which you send them; no mail server needed), set roles, put people
in groups, turn accounts off, and make groups with checkboxes for their
permissions.

### Group admins

Make someone a group admin when they should add people to their own team
without seeing the rest of the server. In **Admin… → Groups**, pick them under
**Group admins** on each group they look after. They then have **Group admin…**
in their account menu, where they:

- see the groups they run (and what each may do) and the people in them; only
  those groups show, never anyone's other groups;
- add people: a new account gets a set-your-password link to send, and someone
  who already has an account just joins (by exact email);
- move people between their groups, or take them out of them;
- make password links for, and turn off or on, accounts **they made
  themselves** that are only in groups they run. Someone they added by email
  (who had an account already), anyone also in another group, an admin or
  another group admin is looked after by an admin, so nobody's account can
  be taken over this way. Emails listed in `BRAINCRAFT_ADMINS` can't be set up
  by a group admin at all.

They can't make or remove groups, change what a group may do, choose group
admins, remove accounts, or open the rest of the admin screen, and they see
only the boards shared with them. Everything they do is in the activity log as
"(group admin)". The Everyone group has no group admins.

## Board access

- Whoever makes a board **owns** it and can manage it.
- **Share** on a board becomes **Access**: add people or groups with **Can
  view**, **Can edit** or **Can manage** (manage: change who has access, delete
  it from the server). Adding people needs *Share boards*.
- The owner (or an admin) can hand a board to someone else.
- A deleted board can be put back for 90 days, by whoever managed it or an
  admin: **Your boards → Recently deleted** (see [BACKUPS.md](BACKUPS.md)).
- Boards made before accounts were turned on have no owner: only admins see
  them, under **Admin… → Boards without an owner**, and can give
  each one an owner. A board whose owner was removed goes back to admins the
  same way.
- "Your boards" lists the boards on the server you can open, with who owns
  them and what you can do. Each browser keeps a copy of the boards it has
  opened, for working offline; it syncs when back online. Those copies stay in
  that browser after signing out, so on a shared computer, clear the site's
  data (or use a private window).
- Names in live sessions are the accounts' names, so you can trust who's who.

## Mentions

Type **@** in a comment, a description or a wiki page and pick someone: the
list offers the people who can open that board (and anyone there now). The
mention is tied to their account, so it still finds them after a name change.

- **Mentions of you…** in the account menu lists every comment, description
  and page that mentions you, on the boards and wikis you can open, newest
  first; the account button shows how many are new. Picking one opens the
  board at that object's comments, or the wiki at that page.
- **`{{tasks @me}}`** in a wiki page lists the unticked checklist items that
  mention whoever is reading it (`{{tasks @Sam Lee}}`: Sam Lee's), so
  "- [ ] Book the train @Sam" is an assignment.
- Mentioning someone doesn't give them access: share the board with them
  first (the list only offers people who can open it). Hidden brainstorm notes
  stay hidden in the list.
- Without accounts, **@** still offers the names of people here now and
  people who've written on the board; a mention of your name is marked.

## The app's name

**Admin… → Branding** names the app for everyone on this server: the browser
tab, the top of the app, the sign-in screen, and wherever the app talks about
itself (the guide, help, exported wiki pages). Everyone sees the new name the
next time they open the app; leave it empty for the usual name. Without
accounts, set `BRAINCRAFT_APP_NAME` on the server instead (it's also the name
admins go back to). Renaming is noted in the activity log.

## Announcements

**Admin… → Announcement** puts one line at the top of the app for everyone
signed in: planned maintenance, a new feature, a deadline. Each person sees it
until they close it, and a changed announcement shows again. **Take it down**
removes it for everyone. Setting and removing it are noted in the activity log.

## Usage

**Admin… → Usage** shows how the server is used, for the last 7, 30 or 90 days
or a year:

- people active today, this week and this month, out of how many accounts;
- day by day: people active, changes, boards opened and made, API changes,
  assistant requests (by provider), speech-to-text clips, form answers,
  exports, link previews and sign-ins, as a chart and as **Download as CSV**;
- the busiest boards (most changes) and the biggest ones on disk;
- which features the boards use: how many boards use each one and how much
  of it there is. This is counted from what's on the boards, so it includes
  everything made before counting started.

The counts are kept in `BRAINCRAFT_DATA/usage.json` for 400 days. They are
numbers only, plus which accounts were active on each day, so each person is
counted once. Nothing anyone wrote or asked the assistant is kept there.

## The activity log

**Admin… → Activity** lists what happened on the server, newest
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
- **Settings:** the app renamed (see below).

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

## Wikis

A wiki is a board like any other: its owner and its **Access** list decide
who reads it (view), writes in it (edit) and manages it (manage), in the app,
in live sessions, through the API and for exports.

**Protected pages:** someone who manages a wiki can protect a page (page menu
**⋯ → Protect page…**). Then only people who manage the wiki can change that
page or the pages under it, or add pages there; everyone else who can edit
reads it, with a note saying why. The server refuses anyone else's changes to
it, live or through the API (403). On a server without accounts nobody
"manages", so protection there is a guard in the app that anyone who can edit
may lift.

## Single sign-on (OpenID Connect)

BrainCraft speaks OpenID Connect, which nearly every identity provider offers:
Microsoft Entra ID, Okta, Google Workspace, Keycloak, Authentik, Auth0,
JumpCloud and others. People click **Sign in with …** and come back signed in.
Accounts are made on first sign-in; an account an admin made earlier is linked
by its verified email.

**It needs HTTPS** (except on `localhost`): providers only send people back to
an `https://` address. See [HTTPS.md](HTTPS.md) first.

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
names under *Add people from single sign-on*. People whose sign-in carries one of
those names are in the group, updated at each sign-in. Groups an admin set by
hand stay as they are.

Provider notes:

- **Microsoft Entra ID:** issuer `https://login.microsoftonline.com/<tenant id>/v2.0`.
  Register an app (Web platform, the redirect URI above), create a client
  secret. For groups, add the *groups* claim in Token configuration; Entra
  sends group **object ids**, so list those ids in BrainCraft's groups.
  Entra often doesn't say an email is verified. Accounts are still made from
  it (tied to the Microsoft identity, not the email), but linking to an
  account an admin made, `BRAINCRAFT_OIDC_ALLOWED_DOMAINS` and
  `BRAINCRAFT_ADMINS` only trust a verified email. For those, add the
  optional claim `xms_edov` (email domain owner verified) in Token
  configuration, or let people sign in first and then give them roles and
  groups in **Admin…**.
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

### Step by step: sign in with Google

1. In [Google Cloud Console](https://console.cloud.google.com), make (or
   pick) a project.
2. **APIs & Services → OAuth consent screen:** choose *Internal* if everyone
   is in your Google Workspace, otherwise *External* (then add the people as
   test users, or publish the app). Give it a name and your support email.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   type *Web application*; under *Authorized redirect URIs* add
   `https://<your server>/api/auth/sso/callback` (copy it from People and
   groups → **Sign-in**). Create, and copy the client ID and secret.
4. Start BrainCraft with:

   ```sh
   BRAINCRAFT_ACCOUNTS=1
   BRAINCRAFT_PUBLIC_URL=https://<your server>
   BRAINCRAFT_OIDC_ISSUER=https://accounts.google.com
   BRAINCRAFT_OIDC_CLIENT_ID=<client id>.apps.googleusercontent.com
   BRAINCRAFT_OIDC_CLIENT_SECRET=<client secret>
   BRAINCRAFT_OIDC_NAME=Sign in with Google
   ```

   Add `BRAINCRAFT_OIDC_ALLOWED_DOMAINS=yourcompany.com` to let only your
   domain in (any Google account can sign in otherwise; they get the
   Everyone group's permissions).
5. The sign-in screen now has **Sign in with Google**. Google confirms
   emails, so someone you added earlier is linked to their Google sign-in
   the first time, and anyone in `BRAINCRAFT_ADMINS` is an admin.

### Step by step: sign in with Microsoft (Entra ID, Microsoft 365)

1. In the [Microsoft Entra admin center](https://entra.microsoft.com):
   **Identity → Applications → App registrations → New registration.** Name
   it BrainCraft; *Accounts in this organizational directory only*; redirect
   URI platform *Web*, address `https://<your server>/api/auth/sso/callback`.
2. On its **Overview**, copy the *Application (client) ID* and the *Directory
   (tenant) ID*.
3. **Certificates & secrets → New client secret;** copy its *Value* (shown
   once). Note when it expires: sign-in stops working then until you make a
   new one.
4. Optional, for groups: **Token configuration → Add groups claim** (security
   groups). Entra sends group ids, so put those ids in BrainCraft groups'
   *Add people from single sign-on*.
5. Start BrainCraft with:

   ```sh
   BRAINCRAFT_ACCOUNTS=1
   BRAINCRAFT_PUBLIC_URL=https://<your server>
   BRAINCRAFT_OIDC_ISSUER=https://login.microsoftonline.com/<tenant id>/v2.0
   BRAINCRAFT_OIDC_CLIENT_ID=<application id>
   BRAINCRAFT_OIDC_CLIENT_SECRET=<secret value>
   BRAINCRAFT_OIDC_NAME=Sign in with Microsoft
   ```

### On this Windows computer

The **Redeploy BrainCraft** batch file on the Desktop sets the server's
settings near the top; the sign-in ones are there, commented out with `rem`.
Fill them in, remove the `rem`, and run it. Keep the client secret out of the
BrainCraft folder (the batch file is outside it), and never commit it.

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
