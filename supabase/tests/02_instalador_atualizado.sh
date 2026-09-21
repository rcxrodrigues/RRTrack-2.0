#!/usr/bin/env bash
# O INSTALAR.sql é a concatenação das migrations. Se alguém mexer numa
# migration e esquecer de regerar o instalador, o arquivo que o usuário cola
# no Supabase fica defasado — e a falha só apareceria em produção.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALADOR="$RAIZ/supabase/INSTALAR.sql"

faltando=()
for f in "$RAIZ"/supabase/migrations/*.sql; do
  nome="$(basename "$f" .sql)"
  if ! grep -q "MIGRATION · $nome" "$INSTALADOR"; then
    faltando+=("$nome")
  fi
  # Confere uma linha marcante de cada migration (a última instrução útil).
  while IFS= read -r linha; do
    if ! grep -Fqx "$linha" "$INSTALADOR"; then
      faltando+=("$nome (conteúdo divergente: ${linha:0:60}…)")
      break
    fi
  done < <(grep -E '^(create table|create policy|create or replace function|grant|revoke)' "$f" | head -40)
done

if (( ${#faltando[@]} > 0 )); then
  echo "INSTALAR.sql está defasado em relação às migrations:" >&2
  printf '  - %s\n' "${faltando[@]}" >&2
  echo "" >&2
  echo "Regere com: supabase/tests/gerar-instalador.sh" >&2
  exit 1
fi

echo "  ok · INSTALAR.sql reflete as migrations"
