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

# ---------------------------------------------------------------------------
# E o COMPACTO, que é o arquivo que a pessoa realmente cola.
# ---------------------------------------------------------------------------
# O bloco acima só olhava o INSTALAR.sql legível. O compacto é gerado à parte,
# por outro script — e ficou defasado sem nada avisar quando a migration de
# `painel_cidades` entrou. O estrago é pior que no legível: quem instala do
# compacto não recebe a função, a consulta falha em silêncio e o cartão de
# Cidades aparece VAZIO. Lê como "sem dado", não como "não instalado", e
# ninguém vai procurar no lugar certo.
#
# A checagem é por NOME DE OBJETO e não por linha: o compacto tem um comando
# por linha, então comparar linha inteira nunca casaria.
COMPACTO="$RAIZ/supabase/INSTALAR-COMPACTO.sql"
ausentes=()

for f in "$RAIZ"/supabase/migrations/*.sql; do
  while IFS= read -r objeto; do
    if ! grep -Fq "$objeto" "$COMPACTO"; then
      ausentes+=("$objeto  ($(basename "$f" .sql))")
    fi
  done < <(
    grep -ioE '(create table (if not exists )?|create or replace function |create index (if not exists )?)[a-z0-9_.]+' "$f" \
      | sed -E 's/^.*(create table (if not exists )?|create or replace function |create index (if not exists )?)//I' \
      | sort -u
  )
done

if (( ${#ausentes[@]} > 0 )); then
  echo "INSTALAR-COMPACTO.sql está defasado — objetos que faltam:" >&2
  printf '  - %s\n' "${ausentes[@]}" >&2
  echo "" >&2
  echo "Regere com: python3 supabase/tests/gerar-compacto.py" >&2
  exit 1
fi

echo "  ok · INSTALAR-COMPACTO.sql tem todos os objetos"
