#!/usr/bin/env bash
# Glass Lab — publie le jeu sur la branche gh-pages (GitHub Pages). Lancé par .github/workflows/pages.yml,
# depuis la racine du dépôt extrait au commit à publier, une fois les tests passés.
#
# Variables (fournies par GitHub Actions) :
#   GITHUB_SHA         commit à publier
#   GITHUB_REF_NAME    branche ou étiquette d'origine (affichée dans la fiche de publication)
#   GITHUB_REF_TYPE    branch | tag
#   GITHUB_EVENT_NAME  push | workflow_dispatch
#   REMOTE             dépôt où pousser gh-pages (URL avec jeton)
#   DRY_RUN=1          construit le site sans le pousser (essais en local)
#
# Règles :
#   1. Jamais de retour en arrière : un envoi sur une branche dont le commit est déjà en ligne, ou plus
#      ancien que celui en ligne, ne republie rien (ex. création de `main` sur un ancien commit).
#      Une étiquette `publication-*` ou un lancement manuel (« Run workflow ») republient toujours.
#   2. La version du service worker devient le commit publié : chaque publication remplace le cache hors
#      ligne des téléphones, sans dépendre d'une modification à la main de sw.js.
#   3. publication.txt (commit, origine, date) est publié avec le site : l'accueil affiche la version.
set -euo pipefail

sha="${GITHUB_SHA:?GITHUB_SHA manquant}"
short="${sha:0:7}"
ref="${GITHUB_REF_NAME:-local}"
remote="${REMOTE:?REMOTE manquant}"

# 1. Version déjà en ligne identique ou plus récente : rien à publier
if [ "${GITHUB_EVENT_NAME:-push}" = "push" ] && [ "${GITHUB_REF_TYPE:-branch}" = "branch" ]; then
  if git fetch -q "$remote" gh-pages 2>/dev/null; then
    last=$(git show FETCH_HEAD:publication.txt 2>/dev/null | awk 'NR == 1 { print $1 }' || true)
    if [ -n "$last" ] && git cat-file -e "${last}^{commit}" 2>/dev/null && git merge-base --is-ancestor "$sha" "$last"; then
      echo "En ligne : ${last:0:7}, identique ou plus récent que ${short} (${ref}) : rien à publier."
      exit 0
    fi
  fi
fi

# 2. Site : fichiers du jeu, service worker à la version du commit, fiche de publication
site=$(mktemp -d)
cp -r index.html style.css manifest.webmanifest sw.js icons src vendor "$site/"
touch "$site/.nojekyll"
sed -i "s/^const VERSION = '[^']*';/const VERSION = 'glasslab-${short}';/" "$site/sw.js"
grep -q "^const VERSION = 'glasslab-${short}';" "$site/sw.js" || { echo "sw.js : VERSION introuvable" >&2; exit 1; }
printf '%s %s %s\n' "$sha" "$ref" "$(date -u +%Y-%m-%dT%H:%MZ)" > "$site/publication.txt"

cd "$site"
git init -q
git checkout -q -b gh-pages
git add -A
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -qm "Publication de ${short} (${ref})"
if [ "${DRY_RUN:-}" = "1" ]; then
  echo "Essai : site construit dans $site, rien n'est poussé."
  exit 0
fi
git push -q -f "$remote" gh-pages
echo "Publié : ${short} (${ref})."
