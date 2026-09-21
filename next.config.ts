import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // TypeScript 7 traz o compilador nativo em Go e deixou de expor a API
  // programática (a "Strada") que o backend padrão do Next usa para invocar o
  // checker. Esta flag faz o build chamar o CLI do tsc. Sem ela, `next build`
  // falha com o TS 7 instalado.
  experimental: {
    useTypeScriptCli: true,
  },

  // Nunca deixar um erro de tipo passar para produção.
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
