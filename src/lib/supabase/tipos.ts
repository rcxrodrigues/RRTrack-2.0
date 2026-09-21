/**
 * Contrato mínimo do banco para o supabase-js.
 *
 * Não geramos os tipos do Supabase CLI (exigiria o CLI conectado ao projeto
 * no fluxo de build). Sem nenhum tipo, porém, a inferência do supabase-js
 * degenera e um `.insert()` com objeto passa a ser recusado.
 *
 * Este contrato diz o suficiente: as tabelas aceitam e devolvem objetos, e as
 * funções recebem e devolvem valores. As garantias de verdade — quais colunas
 * existem, quem pode ler o quê — moram no banco, em RLS e grants, não aqui.
 *
 * Quando valer a pena, trocar por `supabase gen types typescript` e o
 * compilador passa a conhecer coluna por coluna.
 */
export type LinhaGenerica = Record<string, unknown>;

export type Database = {
  public: {
    Tables: Record<
      string,
      {
        Row: LinhaGenerica;
        Insert: LinhaGenerica;
        Update: LinhaGenerica;
        Relationships: [];
      }
    >;
    Views: Record<string, never>;
    Functions: Record<string, { Args: LinhaGenerica; Returns: unknown }>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
