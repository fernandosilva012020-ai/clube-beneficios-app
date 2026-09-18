# Prosperidade Digital

Reconstrução inicial do projeto que ficou incompleto no Work.

## O que já existe nesta base

- Landing page responsiva em estilo premium escuro/dourado.
- Modal de login/cadastro em modo demonstração.
- Área do membro demonstrativa com:
  - visão geral;
  - cursos;
  - ferramentas;
  - hub de IAs;
  - rede de indicações;
  - comissões;
  - assinatura.
- `config.example.js` sem segredos.
- `supabase/schema.sql` com modelo inicial de:
  - perfis e patrocinador;
  - planos e assinaturas;
  - cursos/ferramentas/IAs;
  - progresso;
  - regras de comissão configuráveis;
  - eventos de comissão;
  - RLS básica.

## O que não foi inventado

Preço da assinatura, quantidade de níveis, percentuais de comissão e regras de elegibilidade ficaram sem valores fixos. Esses pontos devem ser definidos pelo dono do negócio antes de habilitar pagamentos ou cálculo de remuneração.

## Rodar localmente

Abra `index.html` diretamente ou execute um servidor local:

```bash
python -m http.server 8080
```

Depois acesse `http://localhost:8080`.

## Próxima integração técnica

1. Criar um projeto Supabase separado do projeto antigo.
2. Aplicar e revisar `supabase/schema.sql`.
3. Implementar cadastro real e captura do código `?ref=`.
4. Implementar painel administrativo para conteúdo, plano e regras de comissão.
5. Conectar o provedor de pagamento escolhido.
6. Processar pagamentos e comissões somente no backend/webhook.
7. Fazer testes de RLS e revisão jurídica/contábil antes do lançamento.
