/**
 * Substituto do pacote `server-only` nos testes.
 *
 * O pacote real lança ao ser importado fora do ambiente de servidor do Next —
 * é essa explosão que impede código com `service_role` de vazar para o
 * bundle do navegador. No Vitest, porém, ela só impediria de testar o que
 * mais precisa de teste.
 *
 * A garantia de verdade continua no build do Next; aqui só precisamos que o
 * import não quebre.
 */
/** Marcador: o pacote real não exporta nada útil, só o efeito de lançar. */
export const ehStubDeTeste = true;
