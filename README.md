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

O campo `paymentAdapterUrl` está vazio de propósito. O banco gera a cobrança interna e possui a RPC de confirmação do gateway, mas o QR Code/PIX depende do PSP escolhido e das credenciais comerciais dessa conta.

### Confirmação de e-mail no GitHub Pages

O campo `siteUrl` em `config.js` é enviado em `emailRedirectTo` no cadastro e no reenvio. Isso também funciona quando a pessoa abre `index.html` ou chega por um link de indicação.

No projeto Supabase `tabuleiros`, abra [Authentication → URL Configuration](https://supabase.com/dashboard/project/iscoxpsizfxjpkbojykc/auth/url-configuration) e salve:

| Campo | Valor |
| --- | --- |
| Site URL | `https://fernandosilva012020-ai.github.io/clube-beneficios-app/` |
| Redirect URLs | `https://fernandosilva012020-ai.github.io/clube-beneficios-app/` |

Mantenha **Confirm email** ativado em Authentication → Sign In / Providers → Email. No template de confirmação, o botão deve usar `{{ .ConfirmationURL }}` para validar a conta antes de retornar à aplicação. Não use apenas o endereço do site como link do botão.

Essas configurações são do serviço hospedado: alterar `config.js` não altera os campos no painel do Supabase. Na verificação de 16/09/2026, a confirmação estava ativada, mas o redirecionamento do servidor ainda retornava `http://localhost:3000`.

Após salvar, solicite um novo e-mail no botão **Reenviar e-mail**. Links anteriores podem manter o endereço antigo. Valide o cadastro com um endereço que você controla, abra o link e confira a entrada no painel; links expirados exibem uma mensagem na aplicação.

Para enviar confirmações aos clientes, configure [SMTP próprio](https://supabase.com/docs/guides/auth/auth-smtp). O serviço padrão envia apenas para membros autorizados da equipe do projeto e possui limite reduzido de envio. As URLs corretas não removem essa restrição.

## Fluxos implementados na interface

- cadastro/login Supabase Auth;
- indicação por `?ref=CODIGO`;
- conclusão do perfil e assinatura pendente;
- geração de cobrança mensal de R$49,90;
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

1. Escolher/conectar PSP para cobrança PIX e transferências.
2. Implementar o adapter descrito em `docs/GATEWAY_ADAPTER.md`.
3. Configurar URL do site em Auth > URL Configuration e os redirects de e-mail.
4. Configurar SMTP próprio para e-mails transacionais em produção.
5. Hospedar esta pasta em HTTPS (Cloudflare Pages, Netlify, Vercel static, etc.).
6. Fazer revisão jurídica/contábil/fiscal antes de lançamento comercial.
