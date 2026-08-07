#!/usr/bin/env bash
# Cut a release tag from the version changesets already wrote.
#
#   ./scripts/tag-release.sh desktop   -> v<apps/desktop version>
#   ./scripts/tag-release.sh server    -> server-v<apps/web version>
#
# The tag is derived from package.json rather than typed, because the two
# must agree and nothing else enforces it:
#
#   - electron-builder names its GitHub release from apps/desktop's version,
#     NOT from the pushed tag. A tag that disagrees produces a build that
#     signs and notarizes correctly and then uploads nothing (the release it
#     wants already exists, or a second one appears alongside).
#   - electron-updater only considers releases whose tag is valid semver, so
#     the desktop tag can't carry a prefix. The server takes `server-` instead
#     (see .github/workflows/publish-images.yaml).
set -euo pipefail

cd "$(dirname "$0")/.."

target="${1:-}"
case "$target" in
  desktop) pkg="apps/desktop/package.json"; prefix="v" ;;
  server)  pkg="apps/web/package.json";     prefix="server-v" ;;
  *) echo "usage: $0 desktop|server" >&2; exit 2 ;;
esac

version="$(node -p "require('./$pkg').version")"
tag="${prefix}${version}"

if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Working tree is dirty — commit the version bump first." >&2
  echo "  Run: pnpm changeset version && git commit -am 'chore: version packages'" >&2
  exit 1
fi

# Releases are cut from dev; tagging elsewhere builds something that was
# never deployed to the dev environment.
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "dev" ]; then
  echo "! On '$branch', not 'dev'." >&2
  printf "  Tag anyway? [y/N] " >&2
  read -r reply
  [ "$reply" = "y" ] || exit 1
fi

if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "✗ Tag $tag already exists." >&2
  echo "  Add a changeset and run 'pnpm changeset version' to bump first." >&2
  exit 1
fi

# A published release under this tag means electron-builder will refuse to
# attach assets to it — catch that here rather than after a 15-minute
# signing and notarization run.
if gh release view "$tag" >/dev/null 2>&1; then
  echo "✗ A GitHub release already exists for $tag." >&2
  exit 1
fi

echo "Tagging $tag ($target @ $version) on $branch"
git tag -a "$tag" -m "$target $version"
git push origin "$tag"
echo "✓ Pushed $tag — watch: gh run watch"
