# Maintainer: Natalie Spiva <natalie@acreetionos.org>
pkgname=muse-ai-webapp
pkgver=0.1.0
pkgrel=1
pkgdesc="Web app for Meta's Muse driven through a Firefox/Gecko (geckodriver) backend"
arch=('x86_64')
url="https://github.com/spivanatalie64/muse-ai-webapp"
license=('MIT')
depends=('nodejs' 'firefox' 'geckodriver')
makedepends=('pnpm' 'git')
# Profile/session data is stored per-user (MUSE_PROFILE_DIR), not in the package.
options=('!strip' '!debug')
source=("git+${url}.git#commit=HEAD")
sha256sums=('SKIP')

pkgver() {
  cd "$srcdir/$pkgname"
  # Prefer a tag like v0.1.0 if present, else commit count + short hash.
  if git describe --tags --abbrev=0 >/dev/null 2>&1; then
    git describe --tags --long | sed 's/^v//;s/-\([^-]*-g[^-]*\)$/_r\1/;s/-/./g'
  else
    printf "0.1.0.r%s.g%s" "$(git rev-list --count HEAD)" "$(git rev-parse --short HEAD)"
  fi
}

prepare() {
  cd "$srcdir/$pkgname"
  # Reproducible-ish install; network required during build to fetch deps.
  pnpm install --frozen-lockfile
}

build() {
  cd "$srcdir/$pkgname"
  pnpm build
}

package() {
  cd "$srcdir/$pkgname"

  install -dm755 "$pkgdir/usr/share/$pkgname"
  install -dm755 "$pkgdir/usr/bin"

  # Next.js standalone output: server + traced deps.
  cp -a .next/standalone/. "$pkgdir/usr/share/$pkgname/"

  # Static assets and public files must sit alongside the standalone server.
  install -dm755 "$pkgdir/usr/share/$pkgname/.next"
  cp -a .next/static "$pkgdir/usr/share/$pkgname/.next/static"
  if [ -d public ]; then
    cp -a public "$pkgdir/usr/share/$pkgname/public"
  fi

  # Launcher: runs the standalone Next server (Gecko backend driven via geckodriver).
  cat > "$pkgdir/usr/bin/$pkgname" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
# Muse webapp (Firefox/Gecko backend). Configure via env:
#   MUSE_HEADED=1                 headed Firefox for interactive sign-in
#   MUSE_PROFILE_DIR=...          persistent Firefox profile (keeps login)
#   MUSE_FIREFOX_BINARY=...       defaults to /usr/lib/firefox/firefox
#   MUSE_GECKODRIVER=...         autodetected if unset
#   PORT=3000 HOSTNAME=0.0.0.0    server bind
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-127.0.0.1}"
cd /usr/share/muse-ai-webapp
exec node server.js "$@"
EOF
  chmod 755 "$pkgdir/usr/bin/$pkgname"

  install -Dm644 LICENSE "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
  install -Dm644 README.md "$pkgdir/usr/share/doc/$pkgname/README.md"
  install -Dm644 docs/architecture.md "$pkgdir/usr/share/doc/$pkgname/architecture.md"
}
