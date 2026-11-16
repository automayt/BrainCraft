#!/usr/bin/env bash
# A certificate for running BrainCraft over HTTPS on a home network (see docs/HTTPS.md).
#
#   bash scripts/home-cert.sh <folder> <address> [more addresses…]
#   bash scripts/home-cert.sh E:/BrainCraft-certs 192.168.1.99 my-computer my-computer.local
#
# It makes, in <folder>:
#   cert.pem, key.pem     the server's certificate and key: BRAINCRAFT_TLS_CERT and BRAINCRAFT_TLS_KEY
#   root.pem              a root certificate of your own. A device told to trust it shows the lock
#                         with no warning; one that isn't shows a warning to click through once.
#   root-key.pem          the root's key. Keep it to yourself: it signs certificates those devices
#                         will believe (only for home-network names and addresses, see below).
#
# localhost and 127.0.0.1 are always included. Run it again to renew the server's certificate, or
# when the computer's address changes: the root is kept, so devices that trust it need nothing more.
# The server picks up the new certificate within the hour, or at once when restarted.
#
# Needs OpenSSL (it comes with Git for Windows: run this from Git Bash).
set -euo pipefail
# Git Bash would turn "/CN=…" into a Windows path.
export MSYS_NO_PATHCONV=1

dir=${1:-}
[ -n "$dir" ] && [ $# -ge 2 ] || { echo "Usage: bash scripts/home-cert.sh <folder> <address> [more addresses…]" >&2; exit 1; }
shift
command -v openssl >/dev/null || { echo "OpenSSL isn't installed. On Windows it comes with Git: run this from Git Bash." >&2; exit 1; }

is_ip() { [[ $1 =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; }
names="DNS:localhost,IP:127.0.0.1"
own=""
for a in "$@"; do
  if is_ip "$a"; then names="$names,IP:$a"; else names="$names,DNS:$a"; own="$own,permitted;DNS:$a"; fi
done

mkdir -p "$dir"
cd "$dir"

if [ ! -f root.pem ] || [ ! -f root-key.pem ]; then
  # The root only ever vouches for home-network addresses and names: the private address ranges,
  # localhost, names ending in .local, .lan, .home.arpa or .internal, and the names given here.
  # So a device that trusts it trusts nothing about the rest of the internet.
  openssl ecparam -genkey -name prime256v1 -noout -out root-key.pem
  openssl req -x509 -new -key root-key.pem -sha256 -days 3650 -subj "/O=BrainCraft/CN=BrainCraft home certificates" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "nameConstraints=critical,permitted;IP:127.0.0.0/255.0.0.0,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0,permitted;IP:169.254.0.0/255.255.0.0,permitted;DNS:localhost,permitted;DNS:local,permitted;DNS:lan,permitted;DNS:home.arpa,permitted;DNS:internal$own" \
    -out root.pem
  echo "Made a new root certificate: $(pwd)/root.pem"
fi

openssl ecparam -genkey -name prime256v1 -noout -out key.new.pem
openssl req -new -key key.new.pem -subj "/O=BrainCraft/CN=BrainCraft server" -out server.csr
printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$names" > server.ext
# 825 days: the longest some devices accept from a root of your own.
openssl x509 -req -in server.csr -CA root.pem -CAkey root-key.pem -CAcreateserial -days 825 -sha256 -extfile server.ext -out server.pem 2>/dev/null
rm -f server.csr server.ext root.srl

if ! openssl verify -CAfile root.pem server.pem >/dev/null 2>&1; then
  rm -f server.pem key.new.pem
  echo "The root certificate here doesn't cover one of: $*" >&2
  echo "It vouches for private addresses, localhost, names ending in .local, .lan, .home.arpa or .internal, and the names it was made with." >&2
  echo "To use another name, delete root.pem and root-key.pem in $(pwd) and run this again (devices then need to trust the new root)." >&2
  exit 1
fi

# The key first, then the certificate with its root after it: the server reads them as a pair.
mv -f key.new.pem key.pem
cat server.pem root.pem > cert.pem
rm -f server.pem

echo "Made the server's certificate for: ${names//,/ }"
echo "  until $(openssl x509 -in cert.pem -noout -enddate | cut -d= -f2)"
echo "Set, where the server starts:"
echo "  BRAINCRAFT_TLS_CERT=$(pwd)/cert.pem"
echo "  BRAINCRAFT_TLS_KEY=$(pwd)/key.pem"
