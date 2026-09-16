# Configurar mensalidade PIX no Asaas

A integração está preparada para cobrar R$49,90 e ativar a assinatura após confirmar o recebimento. A publicação do código não habilita cobranças: faltam os secrets do Asaas e a configuração do webhook. Os testes automatizados usam simulações; ainda é necessário validar a conta Asaas e um pagamento completo.

## 1. Salvar a chave no Supabase

Abra o Asaas pelo navegador com um usuário administrador. Em [Integrações → Chaves de API](https://www.asaas.com/customerApiAccessToken/index), crie uma chave com o nome `clube-beneficios-app`. A chave de produção começa com `$aact_prod_` e aparece apenas ao ser criada. Copie diretamente para o Supabase, sem enviar por conversa, e-mail ou colocar no GitHub. Consulte a [autenticação oficial do Asaas](https://docs.asaas.com/docs/authentication-2).

No projeto `tabuleiros`, abra [Edge Functions → Secrets](https://supabase.com/dashboard/project/iscoxpsizfxjpkbojykc/functions/secrets). Salve:

| Name | Value |
| --- | --- |
| `ASAAS_API_KEY` | A chave de API de produção do Asaas |
| `ASAAS_ENVIRONMENT` | `production` |
| `ASAAS_ENABLED` | `false` por enquanto |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são disponibilizados pelo ambiente hospedado; não copie a chave administrativa para o frontend. [Documentação de secrets](https://supabase.com/docs/guides/functions/secrets).

## 2. Configurar a confirmação automática

No Asaas, abra **Menu do usuário → Integrações → Webhooks → Criar Webhook**. Preencha:

| Campo | Valor |
| --- | --- |
| Nome | `Clube de Benefícios - Mensalidades` |
| URL | `https://iscoxpsizfxjpkbojykc.supabase.co/functions/v1/asaas-webhook` |
| E-mail | Seu e-mail para alertas de falha |
| Versão da API | `3` |
| Tipo de envio | `SEQUENTIALLY` / sequencial |
| Evento | `PAYMENT_RECEIVED` |
| Habilitado | Sim |
| Fila interrompida | Não |
| Token de autenticação | Use **Gerar token** |

Copie o token gerado para um novo secret no Supabase com o nome `ASAAS_WEBHOOK_TOKEN`. Esse token é diferente da chave de API, tem entre 32 e 255 caracteres e não contém espaços. Salve o webhook. [Instruções oficiais do Asaas](https://docs.asaas.com/docs/criar-novo-webhook-pela-aplicacao-web).

O endpoint do webhook tem `verify_jwt = false` porque o Asaas usa `asaas-access-token`. O código verifica esse token antes de processar qualquer evento e consulta a cobrança na API do Asaas antes de confirmar o pagamento. A função `asaas-create-pix` mantém `verify_jwt = true` e valida a sessão do cliente.

## 3. Habilitar e conferir o fluxo

Cadastre uma chave PIX na conta Asaas e confira se ela pode receber cobranças. A [documentação de PIX](https://docs.asaas.com/docs/cobrancas-via-pix) recomenda uma chave cadastrada para evitar limitações do QR Code.

Depois de salvar ambos os secrets e o webhook, altere `ASAAS_ENABLED` para `true` no Supabase. Para pausar a integração, volte para `false`.

No site, entre com uma conta com e-mail confirmado e assinatura pendente. Abra **Mensalidade**, informe o CPF/CNPJ do titular e toque em **Gerar PIX de R$49,90**. Deve aparecer o QR Code e o PIX Copia e Cola. Clicar novamente ou recarregar deve recuperar a mesma cobrança do vencimento atual.

Este projeto usa produção: pagar o QR Code movimenta dinheiro real. Quando o responsável decidir fazer a validação, confira no Asaas o recebimento, a entrega do webhook com resposta HTTP 200 e a mudança da assinatura para `ATIVA` no site. A tela consulta o status local por até dez minutos; **Já paguei — verificar** também confere diretamente no servidor.

`CONFIRMED` pode representar uma retenção cautelar do PIX. A ativação aguarda `RECEIVED`, conforme o comportamento descrito na [API de cobranças](https://docs.asaas.com/reference/criar-nova-cobranca).

Para testar sem dinheiro real, use uma conta Asaas Sandbox e um projeto Supabase separado com o mesmo esquema. Configure `ASAAS_ENVIRONMENT=sandbox` e uma chave `$aact_hmlg_...` nesse ambiente separado. O código bloqueia Sandbox no projeto de produção para impedir que pagamentos fictícios ativem saldos reais.

## Funcionamento e manutenção

- O servidor fixa o valor em R$49,90 e associa a cobrança ao usuário autenticado. Não recebe valor, usuário ou status de pagamento definidos pelo navegador.
- O vencimento da assinatura determina a chave de idempotência local. Um UPDATE condicional permite uma única emissão externa por cobrança, inclusive com solicitações concorrentes.
- A referência externa é `clube-beneficios:<pagamento_id>`. O cliente Asaas usa `clube-beneficios:user:<usuario_id>`. O CPF/CNPJ é enviado ao Asaas e não é salvo em uma nova coluna no Supabase, no navegador ou no payload de auditoria desta integração.
- A confirmação reutiliza `confirmar_pagamento_gateway`, restrita ao servidor, e suas rotinas de ativação e rateio. Eventos repetidos usam a mesma chave de recebimento para evitar novo crédito.
- As tarifas do Asaas não mudam o rateio bruto já existente de R$49,90. O valor líquido retornado pelo gateway é registrado para conciliação; não há abatimento automático da tarifa no rateio.
- Saques, estornos após a ativação e reversão de comissões exigem um fluxo específico, ainda não implementado aqui. A confirmação rejeita cobranças que já apresentam estorno; isso não desfaz uma ativação anterior. Acompanhe estornos também no painel do Asaas.

### Emissão interrompida

Se o POST de criação perder a resposta, o registro conserva `gateway_pagamento_id=creating:<identificador>`. Novas tentativas consultam a referência externa e recuperam a cobrança, sem repetir o POST.

Se continuar “em processamento” e nenhuma cobrança for localizada, o suporte deve conferir a referência e os logs no Asaas antes de liberar o registro. Não remova a marca de processamento apenas pelo tempo decorrido: a cobrança pode ter sido criada mesmo com timeout.

### Falhas de confirmação

Confira os logs do webhook no Asaas e das Edge Functions no Supabase. HTTP 401 no webhook indica token ausente/incorreto; HTTP 503 pode indicar configuração incompleta ou serviço indisponível. HTTP 409 exige conciliação da cobrança. Após corrigir, reenvie o evento pela ferramenta do Asaas ou use a verificação de pagamento no site.

Não marque um pagamento como confirmado diretamente na tabela: a RPC aplica a ativação e o rateio de forma idempotente. Nunca use a chave de serviço no navegador.

## Publicar alterações futuras

O GitHub Pages serve o frontend. As Edge Functions precisam ser publicadas separadamente, incluindo `functions/_shared/asaas.mjs`:

```bash
supabase functions deploy asaas-create-pix --project-ref iscoxpsizfxjpkbojykc
supabase functions deploy asaas-webhook --project-ref iscoxpsizfxjpkbojykc
```

O arquivo `supabase/config.toml` conserva as opções de autenticação das duas funções. Rode `node --test tests/*.test.mjs` antes de publicar. Não inclua arquivos `.env` no Git.
