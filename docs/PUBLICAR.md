# Publicar — o passo a passo, na ordem que funciona

A ordem importa: cada passo depende do anterior. Tudo que **só você pode
fazer** está marcado com 🔴.

---

## 1 · Banco 🔴

No SQL Editor do Supabase, cole **`supabase/INSTALAR-COMPACTO.sql`**.

> Não use o `INSTALAR.sql`: o editor do Supabase envia só as **100 primeiras
> linhas**, e o script longo chega cortado. O erro que aparece é o sintoma
> (um bloco `$$` "não terminado", porque o fechamento ficou fora do corte) e
> não a causa. O compacto tem o mesmo conteúdo em ~25 linhas.

No fim ele imprime `TUDO CERTO`. Se não imprimir, pare aqui.

Depois, ainda no Supabase:

- **Database → Extensions →** habilite **`pg_cron`**, e rode de novo a última
  migration (`20260925140000_retencao.sql`) para o agendamento existir.
- **Authentication → Providers → Email →** *Enable signup* **desligado**.
- **Authentication → Users →** crie o seu usuário à mão.

## 2 · Vercel 🔴

Três variáveis, e **só** três:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY        ← NUNCA com prefixo NEXT_PUBLIC_
```

> Token da Meta, `api_secret` do GA4 e token de webhook **não** entram aqui.
> Eles são cadastrados pelo painel e ficam no cofre do Supabase.

## 3 · DNS 🔴

No Cloudflare, registro `track` apontando para a Vercel, **nuvem cinza (DNS
only)**.

> Com a nuvem laranja a Vercel passa a ver o IP do Cloudflare, os cabeçalhos
> `x-vercel-ip-*` deixam de valer, e vai o **IP errado para a Conversions
> API** — o que degrada o match na Meta. Não é só o mapa do painel que sofre.
>
> O `src/lib/geo.ts` lê os dois conjuntos de cabeçalhos, então nada quebra se
> um dia mudar. Mas o recomendado é cinza.

## 4 · Entrar e configurar o painel 🔴

Entre por link mágico e preencha **Configuração**:

| aba | o que |
|---|---|
| Geral | moeda, **fuso**, origens permitidas, domínios do checkout, token do webhook |
| Meta | pixel(s) + token da CAPI |
| GA4 | measurement id + `api_secret` |
| Meta Ads | `ad_account_id` + token de leitura |

**Domínio do checkout com o nome do parâmetro**, uma linha por checkout:

```
seguro.minhaloja.com|metadata[trck_user_id]      ← Yampi
```

Cada plataforma tem o seu, e mandar o errado **não dá erro**: o checkout
ignora, a venda entra e chega sem atribuição.

Use o botão **Testar conexão** em cada conta antes de seguir.

## 5 · Snippet na loja 🔴

Cole antes de `</head>` em todas as páginas:

```html
<script src="https://track.SEUDOMINIO.com/t.js" async></script>
```

## 6 · Webhook no checkout 🔴

Copie a URL pronta em **Configuração → Geral** (já vem com o token) e cadastre
**em UMA camada só — a do checkout**.

> Com checkout **e** gateway apontando para cá, a mesma venda entra duas
> vezes com ids diferentes e vira **duas conversões na Meta**. Existe uma rede
> de segurança (`acharDuplicataDeOutraCamada`), mas ela exige quatro coisas
> batendo — não conte com ela.

---

## 7 · A venda de teste — o passo que responde tudo

Faça **uma compra real** e vá em **Eventos**. Confira, nesta ordem:

1. **O webhook chegou?** Se não, o token ou a URL estão errados.
2. **O badge está verde?**
   - 🟡 amarelo → nenhum adaptador reconheceu. Me mande o payload.
   - 🔴 vermelho → reconheci e faltou cadastro. A mensagem diz o quê.
3. **O `trck_user_id` veio?** Abra a linha e procure. Se não veio, a ponte não
   atravessou — volte ao passo 5 do item 4.
4. **A venda aparece em Faturamento**, com status `aprovada`?
5. **Chegou na Meta?** Events Manager → Test Events, com o
   `test_event_code` preenchido em Configuração.

> **Tire o `test_event_code` depois.** Esquecido preenchido em produção, ele
> manda **toda** conversão para Test Events, onde ela não conta: o otimizador
> da Meta para de aprender e a campanha morre sem ninguém entender por quê.

### O teste de trinta segundos que ninguém faz

Clique em comprar na loja e **olhe a barra de endereços** do checkout. O
parâmetro está lá?

```
…/checkout?metadata[trck_user_id]=a1b2c3…
```

Se não estiver, o botão de compra é um **redirecionamento por JavaScript** e
o snippet não teve link para marcar. Sem isso, toda venda chega órfã — e é o
tipo de coisa que só se descobre semanas depois, olhando um ROAS que não
fecha.

---

## 8 · Na primeira semana, olhe estes três

| onde | o quê |
|---|---|
| Visão geral → **Atribuição** | quantas vendas não casaram. Crescendo, o ROAS por campanha está ficando cego |
| Campanhas → **Receita fora de campanha** | UTM que não bate com campanha nenhuma. Quase sempre é a macro do anúncio |
| Eventos → badges | 🔴 vermelho é venda possivelmente perdida esperando cadastro |

---

## O que ainda depende de você

- [ ] **Escolher o checkout.** Yampi, Adoorei ou Zedy — e a resposta que mais
      pesa está em `docs/gateways/adoorei.md`: ela é a única sem saco de
      metadados documentado.
- [ ] **Se for Yampi: os aliases de status da sua loja**
      (`GET /{alias}/checkout/statuses`). Ela **não tem evento de estorno** —
      o alias é o único caminho. Sem ele, estorno passa despercebido e o
      faturamento fica inflado.
- [ ] **Se for MillionsPay: três listas** (os 8 status, os 9 eventos
      `charge.*`, os 20 campos da raiz do `charge`). Ver
      `docs/gateways/millionspay.md`.
- [ ] **As fórmulas de HMAC** da Yampi e da MillionsPay, se um dia quiser
      ligar a verificação de assinatura. As duas docs se contradizem; resolve
      no primeiro postback real. Hoje quem autentica é o token, e funciona.
