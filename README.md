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
