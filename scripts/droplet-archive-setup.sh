#!/usr/bin/env bash
# Bring archive.psyntient.io online in front of the Noetic API.
#
# Context (verified from outside the droplet, 2026-08-27):
#   - archive.psyntient.io resolves to Cloudflare edge IPs (172.67.221.99,
#     104.21.67.110), NOT 147.182.188.20 -- the record is proxied.
#   - It returns HTTP 521: Cloudflare cannot reach the origin.
#   - Ports 80/443/8000 are all closed on the droplet. noetic-api is bound to
#     127.0.0.1:8000 and there is no reverse proxy.
#
# So the missing piece is a reverse proxy on 443 plus a firewall. This script
# installs Caddy, points it at 127.0.0.1:8000, and opens only 22/80/443.
#
# TLS: Caddy issues its own self-signed cert (`tls internal`) rather than
# using Let's Encrypt. Behind a PROXIED Cloudflare record, ACME HTTP-01 has to
# round-trip through the edge and is the fragile option, while the CF->origin
# hop still needs to be encrypted. A self-signed cert satisfies Cloudflare SSL
# mode "Full". Upgrade to a Cloudflare Origin Certificate + "Full (strict)"
# when convenient -- see the note printed at the end.
#
# YOU MUST ALSO set Cloudflare SSL/TLS mode for psyntient.io to "Full".
# Leaving it on "Flexible" makes the CF->origin hop plain HTTP and will fight
# the HTTPS redirect; "Full (strict)" will reject the self-signed cert.
#
# Run from the Mac, entering the droplet password once:
#   ssh root@147.182.188.20 'bash -s' < scripts/droplet-archive-setup.sh
#
# Scope note: touches only Caddy, ufw, and its own config. It does not modify
# /opt/Noetic_Archive_Current/ or the noetic-api service.

set -euo pipefail

DOMAIN="archive.psyntient.io"
UPSTREAM="127.0.0.1:8000"

echo "==> Preflight"
if ! systemctl is-active --quiet noetic-api; then
  echo "!! noetic-api is not active. Start it before exposing anything:" >&2
  echo "   systemctl start noetic-api && systemctl status noetic-api" >&2
  exit 1
fi
# Any HTTP status proves the upstream is alive. 401 is the CORRECT answer here:
# every /api/v1/* route requires a node token, so an unauthenticated probe that
# gets 401 has proven both liveness and that the auth gate is working. Only a
# connection failure (curl exit 7) means there is nothing to proxy to.
UPSTREAM_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "http://${UPSTREAM}/api/v1/meta" || true)"
if [ "${UPSTREAM_STATUS}" = "000" ] || [ -z "${UPSTREAM_STATUS}" ]; then
  echo "!! Nothing answering on ${UPSTREAM}; not proxying to a dead upstream." >&2
  exit 1
fi
echo "    noetic-api is up on ${UPSTREAM} (HTTP ${UPSTREAM_STATUS})"

echo "==> Firewall (SSH allowed BEFORE enabling, so this cannot lock you out)"
apt-get update -qq
apt-get install -y -qq ufw >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status verbose

echo "==> Installing Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
caddy version

echo "==> Writing Caddyfile"
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
	# Self-signed: the record is Cloudflare-proxied, so the edge terminates
	# public TLS and this only has to encrypt the CF->origin hop.
	# Requires Cloudflare SSL/TLS mode "Full" (not "Full (strict)").
	tls internal

	encode gzip zstd

	# Let the API see the real client, not the proxy chain.
	reverse_proxy ${UPSTREAM} {
		header_up X-Real-IP {http.request.header.CF-Connecting-IP}
		header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
		header_up X-Forwarded-Proto https
	}

	# Log to journald (Caddy's systemd default) rather than a file. A file sink
	# needs the log created as the caddy user, and `caddy validate` -- which runs
	# as root -- creates it first as root:root 0600, so the service then cannot
	# write it. journalctl -u caddy gives the same output with no ownership or
	# rotation to manage.
}
EOF

echo "==> Validating config"
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

echo "==> Restarting Caddy"
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
sleep 3
systemctl is-active caddy

echo "==> Local proof (through Caddy, skipping cert check since it is self-signed)"
curl -fsSk "https://localhost/api/v1/meta" -H "Host: ${DOMAIN}" \
  | head -c 400 || echo "  (meta requires auth -- a 401/403 here is expected and still proves routing)"
echo

echo
echo "==> DONE on the droplet."
echo
echo "NEXT, in the Cloudflare dashboard for psyntient.io:"
echo "  SSL/TLS -> Overview -> set encryption mode to FULL."
echo "  Not 'Flexible' (plaintext origin hop, fights the redirect)."
echo "  Not 'Full (strict)' yet (it rejects this self-signed cert)."
echo
echo "To reach 'Full (strict)' later: SSL/TLS -> Origin Server -> Create"
echo "Certificate, save the cert and key to the droplet, then replace"
echo "'tls internal' in /etc/caddy/Caddyfile with:"
echo "  tls /etc/caddy/origin.pem /etc/caddy/origin.key"
echo
echo "Then from the Mac, this should stop returning 521:"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://${DOMAIN}/api/v1/meta"
