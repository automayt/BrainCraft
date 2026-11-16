# HTTPS

Run BrainCraft over HTTPS whenever anyone signs in to it from another device.
Without it, passwords and session cookies cross the network in plain text,
single sign-on providers (Google, Microsoft and most others) refuse to send
people back to it, and browsers hold back features such as the clipboard and
the microphone.

**The microphone is the one people notice.** A browser only lets a page hear
you when the page is HTTPS, or is on the same computer (`localhost`). So
talking to the assistant, Flowstate and MeetingNotes work at
`http://localhost:8080` and nowhere else until the server is HTTPS: at
`http://192.168.1.99:8080`, or at the computer's name, the browser refuses
before BrainCraft can ask. A name is no better than a number here; what counts
is the `https://`.

There are two ways to get it. **Use a proxy** (Caddy, Cloudflare Tunnel or
Tailscale) if you can: it gets and renews the certificate for you. Or **let
BrainCraft serve HTTPS itself** with a certificate you provide.

Whichever you pick, tell BrainCraft its public address, so links, cookies and
the single sign-on redirect use it:

```sh
BRAINCRAFT_PUBLIC_URL=https://boards.example.org
```

At home, where the same server is reached at several addresses (`localhost`
on the computer itself, `192.168.1.99` and its name from the others) and there
is no single sign-on, leave it unset: BrainCraft then goes by the address each
request came to, and all of them work. Set to one address, the others can
open boards but not join live sessions.

## Behind a proxy

BrainCraft keeps listening on plain HTTP on this machine, and the proxy faces
the network. Also set `BRAINCRAFT_TRUST_PROXY=1`, so BrainCraft believes the
proxy about each visitor's address (for rate limits and the activity log) and
about the request having been HTTPS. Only set it when everything reaches
BrainCraft through the proxy, and keep BrainCraft on `HOST=127.0.0.1` so
nothing can go around it.

### Caddy (a domain name pointing at you)

[Caddy](https://caddyserver.com) gets a certificate from Let's Encrypt and
renews it on its own. With ports 80 and 443 forwarded to this computer and
`boards.example.org` pointing at your address, a `Caddyfile`:

```
boards.example.org {
	reverse_proxy 127.0.0.1:8080
}
```

Then `caddy run`. Live sessions (WebSockets) pass through without anything
more.

### Cloudflare Tunnel (no ports to open)

With your domain on Cloudflare, [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
connects out to Cloudflare and serves your board at a name of yours over
HTTPS. Nothing on your router changes.

```sh
cloudflared tunnel login
cloudflared tunnel create braincraft
cloudflared tunnel route dns braincraft boards.example.org
cloudflared tunnel run --url http://127.0.0.1:8080 braincraft
```

### Tailscale (only your devices)

If everyone who uses BrainCraft is on your [Tailscale](https://tailscale.com)
network, it can serve it over HTTPS at the computer's tailnet name, reachable
only from your devices:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8080
```

The address is `https://<computer>.<your-tailnet>.ts.net`; use it as
`BRAINCRAFT_PUBLIC_URL`.

### nginx

Pass WebSocket upgrades along for live sessions:

```nginx
server {
    listen 443 ssl;
    server_name boards.example.org;
    ssl_certificate     /etc/letsencrypt/live/boards.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/boards.example.org/privkey.pem;
    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 1h;
    }
}
```

## BrainCraft serving HTTPS itself

Give it a certificate and its private key, as PEM files:

```sh
BRAINCRAFT_TLS_CERT=/path/to/fullchain.pem
BRAINCRAFT_TLS_KEY=/path/to/privkey.pem
BRAINCRAFT_PUBLIC_URL=https://boards.example.org:8080
```

The server then speaks only HTTPS on its port, marks cookies Secure, and checks
the certificate file every hour: a renewed certificate is picked up without a
restart. Don't set `BRAINCRAFT_TRUST_PROXY` in this case. To serve on the usual
port, set `PORT=443` (which may need administrator rights) or forward 443 to it
on your router.

Where the certificate comes from:

- **A domain name:** [certbot](https://certbot.eff.org) or any ACME client gets
  a free one from Let's Encrypt (for example with a DNS challenge, so no web
  server is needed).
- **At home, on your network only:** make a certificate of your own.
  `scripts/home-cert.sh` does it with OpenSSL, which comes with Git (on
  Windows, run it from Git Bash). Give it a folder outside the BrainCraft
  folder, then every address and name the computer is reached by:

  ```sh
  bash scripts/home-cert.sh E:/BrainCraft-certs 192.168.1.99 my-computer my-computer.local
  ```

  It writes `cert.pem` and `key.pem` for the server (`localhost` is always
  included), and `root.pem`, a root certificate of your own that signed them.
  See [Trusting your own root](#trusting-your-own-root) for what devices make
  of it. Run it again to renew the certificate (it lasts 825 days) or when
  the computer's address changes: the root is kept, so devices that trust it
  need nothing more, and the server picks the new certificate up within the
  hour.

  [mkcert](https://github.com/FiloSottile/mkcert) does the same and installs
  its root on the computer for you: `mkcert -install`, then
  `mkcert 192.168.1.99 my-computer localhost`.

  Single sign-on providers usually don't accept a private address like this,
  so for sign-in with Google or Microsoft use a domain name (any of the proxy
  options above).
- **Tailscale:** `tailscale cert <computer>.<your-tailnet>.ts.net` writes a
  real certificate for the tailnet name.

### Trusting your own root

A certificate you made yourself is as good as any for keeping the connection
private, but a browser has no reason to believe it's really your server, so it
shows a warning first.

- **Without doing anything:** choose **Advanced**, then **Proceed** (Chrome,
  Edge) or **Accept the Risk and Continue** (Firefox), once on each device.
  The page is HTTPS from then on, and the microphone can be allowed. The
  address bar goes on saying "Not secure".
- **To have the lock and no warning:** tell the device to trust `root.pem`,
  once. It's the device's own setting, so it's yours to do:
  - Windows: `certutil -user -addstore Root E:\BrainCraft-certs\root.pem`
    (Chrome and Edge go by this; Firefox does too unless it's been told not
    to use the system's certificates).
  - macOS: open `root.pem` in Keychain Access, then set it to **Always
    Trust**.
  - iPhone and iPad: send yourself the file and open it to install the
    profile, then turn it on under Settings → General → About → Certificate
    Trust Settings.
  - Android: Settings → Security → Install a certificate → CA certificate.

The root made by `scripts/home-cert.sh` can only vouch for home-network
addresses and names: the private address ranges, `localhost`, names ending in
`.local`, `.lan`, `.home.arpa` or `.internal`, and the names it was made with.
A device that trusts it trusts nothing about the rest of the internet through
it. Even so, keep `root-key.pem` to yourself.

## On this Windows computer

The **Redeploy BrainCraft** batch file on the Desktop sets the server's
settings near the top. With a certificate from `scripts/home-cert.sh`:

```bat
set "BRAINCRAFT_TLS_CERT=E:\BrainCraft-certs\cert.pem"
set "BRAINCRAFT_TLS_KEY=E:\BrainCraft-certs\key.pem"
```

`BRAINCRAFT_PUBLIC_URL` stays unset, so `https://localhost:8080` on the
computer itself and `https://192.168.1.99:8080` from the others both work.
The server then answers only HTTPS on its port: `http://` addresses stop
working, bookmarks included.

Keep the certificate files outside the BrainCraft folder, so a pull or a
rebuild never touches them.

## Checking it

- `https://<your address>/api/health` answers, and the browser shows a lock.
- Signing in sets a cookie marked **Secure** (the browser's developer tools,
  Application → Cookies).
- A live session connects (two browsers on the same board see each other).
- With single sign-on, the admin screen's **Sign-in** tab shows the redirect
  address starting with `https://`.
