# Clube de Benefícios & Tabuleiros 2x1 — Frontend

SPA estática conectada ao Supabase do projeto `tabuleiros`.

## Rodar localmente

Como é uma SPA sem build, sirva a pasta por HTTP (não abra com `file://`):

```bash
python3 -m http.server 8080
```

Acesse `http://localhost:8080`.

## Configuração

`config.js` já aponta para o projeto Supabase e usa **publishable key**, que é própria para frontend. Nunca coloque `service_role`/secret key no navegador.

O campo `paymentAdapterUrl` aponta para a Edge Function `asaas-create-pix`. A integração gera PIX de R$49,90 e confirma o recebimento no servidor. Ela permanece desativada até configurar as credenciais e o webhook conforme [Configurar Asaas](docs/ASAAS_SETUP.md).

### Confirmação de e-mail no GitHub Pages

O campo `siteUrl` em `config.js` é enviado em `emailRedirectTo` no cadastro e no reenvio. Isso também funciona quando a pessoa abre `index.html` ou chega por um link de indicação.

No projeto Supabase `tabuleiros`, abra [Authentication → URL Configuration](https://supabase.com/dashboard/project/iscoxpsizfxjpkbojykc/auth/url-configuration) e salve:

| Campo | Valor |
| --- | --- |
| Site URL | `https://fernandosilva012020-ai.github.io/clube-beneficios-app/` |
| Redirect URLs | `https://fernandosilva012020-ai.github.io/clube-beneficios-app/` |

Mantenha **Confirm email** ativado em Authentication → Sign In / Providers → Email. No template de confirmação, o botão deve usar `{{ .ConfirmationURL }}` para validar a conta antes de retornar à aplicação. Não use apenas o endereço do site como link do botão.

Essas configurações são do serviço hospedado: alterar `config.js` não altera os campos no painel do Supabase. Em 16/09/2026, após o ajuste no painel, o redirecionamento para o GitHub Pages foi verificado e o responsável relatou que o recebimento e a confirmação por e-mail estavam funcionando.

Após salvar, solicite um novo e-mail no botão **Reenviar e-mail**. Links anteriores podem manter o endereço antigo. Valide o cadastro com um endereço que você controla, abra o link e confira a entrada no painel; links expirados exibem uma mensagem na aplicação.

Para enviar confirmações aos clientes, configure [SMTP próprio](https://supabase.com/docs/guides/auth/auth-smtp). O serviço padrão envia apenas para membros autorizados da equipe do projeto e possui limite reduzido de envio. As URLs corretas não removem essa restrição.

## Fluxos implementados na interface

- cadastro/login Supabase Auth;
- indicação por `?ref=CODIGO`;
- conclusão do perfil e assinatura pendente;
- cobrança mensal de R$49,90 por PIX Asaas, com QR Code e Copia e Cola (depende da configuração das credenciais);
- dashboard com saldos, assinatura e ganhos;
- tabuleiros Bronze → Diamante e posição estimada na fila;
- código/link de indicação;
- cadastro de chave PIX;
- solicitação de saque com bloqueio de saldo;
- painel administrativo (somente usuários marcados em `administradores`);
- correção auditada de patrocinador.

## Tornar o primeiro usuário administrador

Depois que o usuário tiver criado o perfil, execute com privilégios administrativos no SQL Editor:

```sql
select public.definir_administrador('<UUID_DO_USUARIO>', true);
```

## Produção

O frontend é publicado no [GitHub Pages](https://fernandosilva012020-ai.github.io/clube-beneficios-app/). As funções de pagamento são publicadas separadamente no Supabase.

1. Configurar o Asaas e validar o recebimento conforme [ASAAS_SETUP.md](docs/ASAAS_SETUP.md).
2. Implementar transferências/saques e o tratamento contábil de estornos; esta integração cobre recebimento de mensalidades.
3. Acompanhar a entrega dos webhooks e dos e-mails transacionais.

## Verificação local

Com Node.js 22 ou superior, sem dependências adicionais:

```bash
node --test tests/*.test.mjs
```

Os testes usam serviços simulados; não criam cobranças reais nem substituem a validação na conta Asaas.
