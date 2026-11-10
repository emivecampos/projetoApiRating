# Consulta Rating — sistema de consultas (API KSI Rating Bancário V2)

O cliente cria uma conta, recarrega saldo via PIX e faz a consulta por CPF ou CNPJ. O relatório completo aparece na mesma página, assim que a API KSI responde.

## Como rodar

Requisito: Node.js 22.13 ou superior (o banco usa o `node:sqlite` nativo, sem compilação).

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm start                 # http://localhost:3000
```

Sem configurar nada, o sistema sobe em **modo simulado**: a KSI devolve a resposta de exemplo da documentação e a recarga tem um botão "Simular pagamento". Assim dá para testar o fluxo inteiro sem credenciais.

## Colocar em produção

No `.env`:

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` (bloqueia os modos simulados) |
| `KSI_MODO` | `real` |
| `KSI_LOGIN` / `KSI_SENHA` | credenciais enviadas pela KSI |
| `PAGAMENTO_MODO` | `mercadopago` |
| `MP_ACCESS_TOKEN` | Access Token de produção do Mercado Pago (conta com chave PIX cadastrada) |
| `MP_WEBHOOK_SECRET` | assinatura secreta do webhook (painel MP → Webhooks) |
| `PUBLIC_URL` | URL pública HTTPS, ex.: `https://consultas.suaempresa.com.br` |
| `PRECO_CONSULTA` | preço cobrado por consulta |

No painel do Mercado Pago, aponte o webhook (evento *Pagamentos*) para `PUBLIC_URL/api/webhooks/mercadopago`. Mesmo sem webhook, a página verifica o status a cada 4 s e credita o saldo quando o PIX for pago.

Rode atrás de um proxy HTTPS (Nginx, Caddy, Cloudflare etc.).

## Como funciona

- **Credenciais KSI só no servidor.** O navegador fala apenas com o backend. O token KSI fica em cache na memória e é renovado sozinho se a KSI recusá-lo (401/403). Senha e token nunca vão para os logs.
- **Cobrança justa.** O valor é reservado do saldo de forma atômica antes da chamada. Se a resposta não for `HTTP 200` com `baseDisponivel = true` (critério da seção 08 da documentação), ou se houver timeout ou erro de rede, o valor volta ao saldo na hora.
- **Recarga idempotente.** O crédito do PIX entra uma única vez, mesmo que chegue webhook e polling ao mesmo tempo. O status é sempre conferido na API do Mercado Pago (o corpo do webhook não é tomado como verdade), e o valor pago tem que bater com o da recarga.
- **LGPD.** O cliente precisa declarar a finalidade legítima antes de consultar. O CPF fica mascarado no histórico, e o relatório completo é apagado após `RETENCAO_DIAS`.
- **Extrato.** Recargas, consultas e estornos ficam registrados em `movimentacoes`.

## Ajuste manual de saldo (suporte)

```bash
npm run creditar -- cliente@email.com 50.00 "Cortesia"
npm run creditar -- cliente@email.com -19.90 "Correção"
```

## Pendências com o suporte KSI (seção 09 da documentação)

Validade do token, uso de prefixo no header `Authorization` (`KSI_AUTH_PREFIX`), rate limit, timeout recomendado (`KSI_TIMEOUT_MS`), política de retentativas e ambiente de homologação. O sistema **não** repete automaticamente uma consulta que falhou, como a documentação recomenda.

## Estrutura

```
src/server.js            rotas da API e regras de saldo/estorno
src/ksi.js               cliente da API KSI (login + consulta)
src/pagamentos.js        PIX Mercado Pago / simulado, webhook
src/db.js                SQLite (data/consultas.db)
src/auth.js              contas, sessões (cookie HttpOnly), rate limit
src/exemplo-resposta.js  resposta de exemplo (modo simulado)
public/                  página única (HTML/CSS/JS, sem build)
scripts/creditar.js      ajuste manual de saldo
```
