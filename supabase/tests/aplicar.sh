#!/usr/bin/env bash
# Aplica as migrations num Postgres limpo e roda as asserções de segurança.
#
#   local: ./supabase/tests/aplicar.sh          (socket em /tmp, porta 55432)
#   CI:    PGHOST=localhost PGPORT=5432 ... ./supabase/tests/aplicar.sh
set -euo pipefail

DB=rrtrack_test
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Sem PGHOST definido, assume o cluster local de desenvolvimento.
if [[ -z "${PGHOST:-}" ]]; then
  export PGHOST=/tmp
  export PGPORT="${PGPORT:-55432}"
  export PGUSER="${PGUSER:-postgres}"
fi

PSQL=(psql -v ON_ERROR_STOP=1)

"${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;" -c "create database $DB;"
"${PSQL[@]}" -q -d "$DB" -c \
  "alter database $DB set app.settings.encryption_key = 'chave-de-teste-com-mais-de-32-caracteres-ok';"
"${PSQL[@]}" -q -d "$DB" -f "$RAIZ/supabase/tests/00_ambiente_supabase.sql" >/dev/null

echo "── migrations ──"
for f in "$RAIZ"/supabase/migrations/*.sql; do
  printf '  %s ... ' "$(basename "$f")"
  "${PSQL[@]}" -q -d "$DB" -f "$f" >/dev/null && echo "ok"
done

echo "── asserções de segurança ──"
# psql não devolve status de erro para NOTICE, então capturamos a saída e
# procuramos por ERROR nós mesmos: uma asserção quebrada tem que reprovar o CI.
saida="$("${PSQL[@]}" -d "$DB" -f "$RAIZ/supabase/tests/01_seguranca.sql" 2>&1)" || {
  echo "$saida" | sed 's/^/  /'
  exit 1
}
echo "$saida" | grep -E "NOTICE|ERROR" | sed -E 's/^[^:]*:[0-9]+: //' | sed 's/^/  /'

if echo "$saida" | grep -q "ERROR"; then
  echo "asserção de segurança falhou" >&2
  exit 1
fi
