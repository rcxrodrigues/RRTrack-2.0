#!/usr/bin/env python3
"""
Gera supabase/INSTALAR-COMPACTO.sql — um comando por linha.

Motivo: o SQL Editor do Supabase corta o script na linha 100. O instalador
legível tem 869 linhas, então 88% dele nunca chegava ao banco, e o erro que
aparecia ("unterminated dollar-quoted string") era só o sintoma.

SQL não precisa de quebras de linha. Colapsando cada comando numa linha só,
o arquivo inteiro cabe bem abaixo do limite — e roda idêntico.

O parser respeita strings, dollar-quoting e comentários, para nunca cortar
no meio de um bloco nem apagar um `--` que esteja dentro de um texto.
"""
import pathlib
import re
import sys


def separar_statements(sql: str) -> list[str]:
    """Divide por ';' de topo, ignorando os que estão dentro de string,
    comentário ou bloco dollar-quoted."""
    statements: list[str] = []
    atual: list[str] = []
    i, n = 0, len(sql)

    while i < n:
        c = sql[i]

        # comentário de linha
        if sql.startswith('--', i):
            fim = sql.find('\n', i)
            fim = n if fim == -1 else fim
            atual.append(sql[i:fim])
            i = fim
            continue

        # string literal
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":  # '' escapado
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            atual.append(sql[i:j])
            i = j
            continue

        # bloco dollar-quoted: $tag$ ... $tag$
        if c == '$':
            m = re.match(r'\$[A-Za-z_0-9]*\$', sql[i:])
            if m:
                tag = m.group(0)
                fim = sql.find(tag, i + len(tag))
                if fim == -1:
                    raise SystemExit(f'bloco {tag} sem fechamento')
                fim += len(tag)
                atual.append(sql[i:fim])
                i = fim
                continue

        if c == ';':
            atual.append(';')
            statements.append(''.join(atual))
            atual = []
            i += 1
            continue

        atual.append(c)
        i += 1

    resto = ''.join(atual).strip()
    if resto:
        statements.append(resto)
    return statements


def sem_comentarios_de_linha(corpo: str) -> str:
    """Tira os comentários `--` respeitando strings.

    Indispensável antes de colapsar um corpo de função numa linha só: um
    `-- nota` que antes terminava na quebra de linha passaria a comentar
    todo o resto do comando.
    """
    saida: list[str] = []
    i, n = 0, len(corpo)

    while i < n:
        if corpo.startswith('--', i):
            fim = corpo.find('\n', i)
            if fim == -1:
                break
            i = fim
            continue

        if corpo[i] == "'":
            j = i + 1
            while j < n:
                if corpo[j] == "'":
                    if j + 1 < n and corpo[j + 1] == "'":
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            saida.append(corpo[i:j])
            i = j
            continue

        saida.append(corpo[i])
        i += 1

    return ''.join(saida)


def compactar(stmt: str) -> str:
    """Uma linha só: tira comentários de fora dos blocos e junta o espaço.
    O que está dentro de $tag$ é preservado byte a byte — mexer ali mudaria
    o corpo da função."""
    saida: list[str] = []
    i, n = 0, len(stmt)

    while i < n:
        if stmt.startswith('--', i):
            fim = stmt.find('\n', i)
            i = n if fim == -1 else fim          # descarta o comentário
            continue

        if stmt[i] == "'":
            j = i + 1
            while j < n:
                if stmt[j] == "'":
                    if j + 1 < n and stmt[j + 1] == "'":
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            saida.append(stmt[i:j])
            i = j
            continue

        if stmt[i] == '$':
            m = re.match(r'\$[A-Za-z_0-9]*\$', stmt[i:])
            if m:
                tag = m.group(0)
                fim = stmt.find(tag, i + len(tag))
                if fim != -1:
                    fim += len(tag)
                    corpo = stmt[i:fim]
                    # Os comentários saem ANTES de colapsar, senão o primeiro
                    # `--` comentaria todo o resto da função.
                    corpo = sem_comentarios_de_linha(corpo)
                    saida.append(re.sub(r'\s*\n\s*', ' ', corpo))
                    i = fim
                    continue

        saida.append(stmt[i])
        i += 1

    return re.sub(r'\s+', ' ', ''.join(saida)).strip()


def main() -> None:
    raiz = pathlib.Path(__file__).resolve().parents[2]
    origem = raiz / 'supabase' / 'INSTALAR.sql'
    destino = raiz / 'supabase' / 'INSTALAR-COMPACTO.sql'

    sql = origem.read_text()
    linhas = [
        '-- RRTrack 2.0 - INSTALACAO DO BANCO (versao compacta)',
        '-- O SQL Editor do Supabase corta o script na linha 100; esta versao cabe.',
        '-- Mesmo conteudo de INSTALAR.sql, sem as quebras de linha. Cole tudo e rode.',
        '',
    ]

    # Comandos curtos (grants, índices, alter table) viajam juntos na mesma
    # linha: o Postgres aceita vários por linha, e assim sobra margem.
    LIMITE_LINHA = 1800
    buffer = ''

    for stmt in separar_statements(sql):
        compacto = compactar(stmt)
        if not compacto or compacto == ';':
            continue

        # Bloco grande (função, do $$) ocupa a linha inteira, sozinho.
        if len(compacto) > LIMITE_LINHA // 2:
            if buffer:
                linhas.append(buffer)
                buffer = ''
            linhas.append(compacto)
            continue

        if buffer and len(buffer) + len(compacto) + 1 > LIMITE_LINHA:
            linhas.append(buffer)
            buffer = compacto
        else:
            buffer = f'{buffer} {compacto}'.strip()

    if buffer:
        linhas.append(buffer)

    destino.write_text('\n'.join(linhas) + '\n')

    total = len(linhas) + 1
    print(f'gerado: supabase/INSTALAR-COMPACTO.sql')
    print(f'  {origem.name}: {sql.count(chr(10)) + 1} linhas')
    print(f'  compacto:      {total} linhas')

    if total >= 100:
        print(f'  AINDA PASSA DE 100 LINHAS ({total}) — precisa dividir em partes', file=sys.stderr)
        sys.exit(1)
    print(f'  margem:        {100 - total} linhas abaixo do limite do editor')


if __name__ == '__main__':
    main()
