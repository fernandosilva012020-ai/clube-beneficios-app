const LIVE_PROJECT = 'iscoxpsizfxjpkbojykc';
const PRICE = 49.90;
const PREFIX = 'clube-beneficios:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PaymentError extends Error {
  constructor(status, code, message, definitive = false) {
    super(message);
    Object.assign(this, { status, code, definitive });
  }
}
const fail = (status, code, message) => { throw new PaymentError(status, code, message); };
const reference = id => `${PREFIX}${id}`;
const isClaim = id => typeof id === 'string' && id.startsWith('creating:');
const documentNumber = value => String(value || '').replace(/[.\-/\s]/g, '').toUpperCase();
const validDocument = value => /^\d{11}$/.test(value) || /^[A-Z0-9]{12}\d{2}$/.test(value);
const isPrice = value => ['number', 'string'].includes(typeof value) && Number(value) === PRICE;

export function readConfig(get) {
  return {
    supabaseUrl: get('SUPABASE_URL') || '',
    serviceKey: get('SUPABASE_SERVICE_ROLE_KEY') || '',
    apiKey: get('ASAAS_API_KEY') || '',
    webhookToken: get('ASAAS_WEBHOOK_TOKEN') || '',
    enabled: get('ASAAS_ENABLED') === 'true',
    environment: get('ASAAS_ENVIRONMENT') || 'production',
    siteOrigin: 'https://fernandosilva012020-ai.github.io',
  };
}

function configured(config) {
  const production = config.environment === 'production';
  const sandbox = config.environment === 'sandbox';
  const keyPrefix = production ? '$aact_prod_' : '$aact_hmlg_';
  if (!config.enabled || !config.apiKey.startsWith(keyPrefix) ||
      !/^[^\s]{32,255}$/.test(config.webhookToken) || config.webhookToken === config.apiKey ||
      !config.supabaseUrl || !config.serviceKey || (!production && !sandbox) ||
      (sandbox && config.supabaseUrl.includes(LIVE_PROJECT))) {
    fail(503, 'PAYMENTS_UNAVAILABLE', 'O pagamento PIX ainda não está disponível. Tente novamente mais tarde.');
  }
}

async function sameSecret(a, b) {
  const hash = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  const left = new Uint8Array(x), right = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function bodyJSON(request, max = 8192) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    fail(415, 'JSON_REQUIRED', 'Envie os dados em JSON.');
  }
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'INVALID_BODY', 'Dados da solicitação ausentes.');
  let length = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE', 'Solicitação muito grande.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { fail(400, 'INVALID_JSON', 'Não foi possível ler os dados enviados.'); }
}

function verifyPayment(payment, remote) {
  if (!remote || !/^pay_[A-Za-z0-9_-]+$/.test(remote.id || '') ||
      remote.externalReference !== reference(payment.id) || remote.billingType !== 'PIX' ||
      !isPrice(remote.value) || !isPrice(payment.valor) || remote.deleted ||
      (remote.refunds && remote.refunds.length > 0)) {
    fail(409, 'PAYMENT_MISMATCH', 'A cobrança precisa ser conferida pelo suporte.');
  }
}

export function createHandlers({ config, repo, asaas, now = () => new Date(), randomId = () => crypto.randomUUID() }) {
  const cors = {
    'Access-Control-Allow-Origin': config.siteOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
  const errorResponse = (error, headers = {}) => json({
    error: error instanceof PaymentError ? error.message : 'Não foi possível concluir agora. Tente novamente em instantes.',
    code: error instanceof PaymentError ? error.code : 'PAYMENT_SERVICE_ERROR',
  }, error instanceof PaymentError ? error.status : 503, headers);

  async function ownedPayment(id, userId) {
    if (!UUID.test(id || '')) fail(400, 'INVALID_PAYMENT', 'Cobrança inválida.');
    const payment = await repo.getPayment(id);
    if (!payment || payment.usuario_id !== userId) fail(404, 'PAYMENT_NOT_FOUND', 'Cobrança não encontrada.');
    return payment;
  }

  async function reconcile(payment, remote, eventId = null) {
    verifyPayment(payment, remote);
    if (payment.gateway !== 'ASAAS' ||
        (payment.gateway_pagamento_id !== remote.id && !isClaim(payment.gateway_pagamento_id))) {
      fail(409, 'PAYMENT_MAPPING_MISMATCH', 'A identificação da cobrança precisa ser conferida pelo suporte.');
    }
    if (payment.gateway_pagamento_id !== remote.id) {
      const updated = await repo.attach(payment.id, payment.gateway_pagamento_id, remote.id);
      if (!updated) {
        payment = await repo.getPayment(payment.id);
        if (payment?.gateway_pagamento_id !== remote.id) fail(409, 'PAYMENT_IN_PROGRESS', 'Cobrança em processamento. Tente novamente.');
      }
    }
    // CONFIRMED may still be under precautionary hold. Only settled PIX activates membership.
    if (remote.status !== 'RECEIVED') return false;
    if (!['PENDENTE', 'CONFIRMADO'].includes(payment.status)) fail(409, 'PAYMENT_NOT_PAYABLE', 'Esta cobrança não está disponível para confirmação.');
    await repo.settle(payment.id, remote.id, {
      gateway_event_id: eventId, event: 'PAYMENT_RECEIVED', payment_id: remote.id,
      value: remote.value, net_value: remote.netValue ?? null, status: remote.status,
      external_reference: remote.externalReference, received_date: remote.paymentDate ?? null,
    });
    return true;
  }

  async function existingRemote(payment) {
    if (payment.gateway !== 'ASAAS') fail(409, 'OTHER_GATEWAY', 'Esta cobrança está vinculada a outro serviço.');
    if (isClaim(payment.gateway_pagamento_id)) {
      const rows = await asaas.findPayments(reference(payment.id));
      if (rows.length !== 1) fail(409, 'PAYMENT_IN_PROGRESS', 'A emissão do PIX está em processamento. Aguarde e tente novamente.');
      return rows[0];
    }
    if (!/^pay_[A-Za-z0-9_-]+$/.test(payment.gateway_pagamento_id || '')) fail(409, 'INVALID_MAPPING', 'Cobrança indisponível. Entre em contato com o suporte.');
    return asaas.getPayment(payment.gateway_pagamento_id);
  }

  async function paymentResult(payment, remote) {
    const paid = await reconcile(payment, remote);
    if (paid) return { pagamento_id: payment.id, paid: true, status: 'CONFIRMADO', value: PRICE };
    if (!['PENDING', 'OVERDUE', 'CONFIRMED'].includes(remote.status)) {
      fail(409, 'PAYMENT_CLOSED', 'Esta cobrança não está disponível para pagamento. Entre em contato com o suporte.');
    }
    if (remote.status === 'CONFIRMED') return { pagamento_id: payment.id, paid: false, processing: true, value: PRICE };
    const qr = await asaas.getQr(remote.id);
    if (!qr.payload || typeof qr.payload !== 'string') fail(503, 'QR_UNAVAILABLE', 'O PIX está sendo preparado. Tente novamente.');
    return { pagamento_id: payment.id, paid: false, value: PRICE, pix_copy_paste: qr.payload,
      qr_code_base64: /^[A-Za-z0-9+/=\r\n]+$/.test(qr.encodedImage || '') ? qr.encodedImage : null,
      expiration_date: qr.expirationDate || null };
  }

  async function createPix(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405, cors);
    try {
      const origin = request.headers.get('origin');
      if (origin && origin !== config.siteOrigin) fail(403, 'INVALID_ORIGIN', 'Origem não permitida.');
      const authorization = request.headers.get('authorization') || '';
      if (!/^Bearer \S+$/i.test(authorization)) fail(401, 'LOGIN_REQUIRED', 'Entre na sua conta para pagar.');
      const user = await repo.authenticate(authorization);
      if (!user?.id || !UUID.test(user.id) || !user.email_confirmed_at) fail(401, 'LOGIN_REQUIRED', 'Entre com uma conta de e-mail confirmado.');
      configured(config);
      const body = await bodyJSON(request);
      if (body.action === 'status') {
        const payment = await ownedPayment(body.pagamento_id, user.id);
        const remote = await existingRemote(payment);
        const paid = await reconcile(payment, remote);
        return json({ pagamento_id: payment.id, paid, status: paid ? 'CONFIRMADO' : remote.status }, 200, cors);
      }
      if (body.action && body.action !== 'create') fail(400, 'INVALID_ACTION', 'Ação inválida.');
      const [profile, subscription] = await Promise.all([repo.getProfile(user.id), repo.getSubscription(user.id)]);
      if (!profile || !subscription) fail(409, 'PROFILE_REQUIRED', 'Complete seu cadastro antes de pagar.');
      if (['CANCELADO', 'SUSPENSO'].includes(profile.status) || ['CANCELADA', 'SUSPENSA'].includes(subscription.status)) {
        fail(403, 'ACCOUNT_UNAVAILABLE', 'Sua conta precisa ser verificada pelo suporte.');
      }
      if (subscription.status === 'ATIVA' && new Date(subscription.proximo_vencimento) > now()) {
        return json({ already_active: true, next_due: subscription.proximo_vencimento }, 200, cors);
      }
      const document = documentNumber(body.cpf_cnpj);
      if (!validDocument(document)) fail(400, 'INVALID_DOCUMENT', 'Informe um CPF ou CNPJ válido do titular da cobrança.');
      // The same membership due date always gets the same local payment, even across tabs.
      const key = `asaas:${user.id}:${subscription.id}:${subscription.proximo_vencimento}`;
      const { pagamento_id } = await repo.createPayment(authorization, key);
      let payment = await ownedPayment(pagamento_id, user.id);
      if (!isPrice(payment.valor)) fail(409, 'INVALID_AMOUNT', 'Valor da mensalidade inconsistente.');
      if (payment.gateway_pagamento_id) return json(await paymentResult(payment, await existingRemote(payment)), 200, cors);
      if (payment.status !== 'PENDENTE' || payment.gateway) fail(409, 'PAYMENT_UNAVAILABLE', 'Esta cobrança não está disponível.');
      const claim = `creating:${randomId()}`;
      if (!await repo.claim(payment.id, claim)) {
        payment = await ownedPayment(payment.id, user.id);
        return json(await paymentResult(payment, await existingRemote(payment)), 200, cors);
      }
      payment = { ...payment, gateway: 'ASAAS', gateway_pagamento_id: claim };
      let submitted = false, created = false;
      try {
        const found = await asaas.findPayments(reference(payment.id));
        if (found.length > 1) fail(409, 'DUPLICATE_REMOTE', 'A cobrança precisa ser conferida pelo suporte.');
        let remote = found[0];
        if (!remote) {
          const customerReference = `${PREFIX}user:${user.id}`;
          const customers = await asaas.findCustomers(customerReference);
          if (customers.length > 1) fail(409, 'DUPLICATE_CUSTOMER', 'O cadastro de cobrança precisa ser conferido pelo suporte.');
          let customer = customers[0];
          if (customer && documentNumber(customer.cpfCnpj) !== document) fail(409, 'DOCUMENT_MISMATCH', 'Use o CPF ou CNPJ informado na sua primeira cobrança.');
          if (!customer) customer = await asaas.createCustomer({ name: profile.nome, cpfCnpj: document,
            email: profile.email, externalReference: customerReference, notificationDisabled: true });
          if (!/^cus_[A-Za-z0-9_-]+$/.test(customer.id || '')) fail(503, 'CUSTOMER_UNAVAILABLE', 'Não foi possível preparar o cadastro de cobrança.');
          submitted = true;
          remote = await asaas.createPayment({ customer: customer.id, billingType: 'PIX', value: PRICE,
            dueDate: now().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
            description: 'Mensalidade - Clube de Benefícios', externalReference: reference(payment.id),
            interest: { value: 0 }, fine: { value: 0 }, discount: { value: 0 } });
          created = true;
        }
        return json(await paymentResult(payment, remote), 200, cors);
      } catch (error) {
        // A lost POST response is ambiguous: preserve the claim and reconcile on retry.
        // Never send a second charge after a timeout or a server error.
        if (!submitted || (!created && error.definitive)) await repo.releaseClaim(payment.id, claim);
        throw error;
      }
    } catch (error) { return errorResponse(error, cors); }
  }

  async function webhook(request) {
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    try {
      const token = request.headers.get('asaas-access-token') || '';
      if (!config.webhookToken || token.length > 255 || !await sameSecret(token, config.webhookToken)) {
        fail(401, 'INVALID_WEBHOOK_TOKEN', 'Autenticação inválida.');
      }
      configured(config);
      const event = await bodyJSON(request, 65536);
      if (event.event !== 'PAYMENT_RECEIVED') return json({ received: true, ignored: true });
      if (typeof event.id !== 'string' || !event.id || event.id.length > 255 ||
          !/^pay_[A-Za-z0-9_-]+$/.test(event.payment?.id || '')) fail(400, 'INVALID_EVENT', 'Evento inválido.');
      // Always retrieve the payment from Asaas. Never trust the webhook's value or status alone.
      const remote = await asaas.getPayment(event.payment.id);
      if (typeof remote.externalReference !== 'string' || !remote.externalReference.startsWith(PREFIX)) {
        return json({ received: true, ignored: true });
      }
      const id = remote.externalReference.slice(PREFIX.length);
      if (!UUID.test(id)) fail(400, 'INVALID_REFERENCE', 'Referência inválida.');
      const payment = await repo.getPayment(id);
      if (!payment) fail(404, 'PAYMENT_NOT_FOUND', 'Cobrança não encontrada.');
      const paid = await reconcile(payment, remote, event.id);
      return json({ received: true, processed: paid });
    } catch (error) { return errorResponse(error); }
  }
  return { createPix, webhook };
}

export function createServices(config, fetcher = fetch) {
  async function call(url, options, service) {
    let response;
    try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(7000), redirect: 'error' }); }
    catch { throw new PaymentError(503, 'UPSTREAM_UNAVAILABLE', 'O serviço de pagamento está temporariamente indisponível.'); }
    if (!response.ok) {
      const definitive = [400, 401, 403, 404, 422].includes(response.status);
      // Do not expose upstream bodies: they may contain document numbers or credentials.
      throw new PaymentError(503, `${service}_REQUEST_FAILED`, 'Não foi possível concluir a cobrança. Confira os dados ou tente novamente mais tarde.', definitive);
    }
    try { return await response.json(); }
    catch { throw new PaymentError(503, 'INVALID_UPSTREAM_RESPONSE', 'Não foi possível conferir a cobrança. Tente novamente em instantes.'); }
  }
  const db = (path, method = 'GET', body = null, authorization = `Bearer ${config.serviceKey}`) => call(
    `${config.supabaseUrl}/rest/v1/${path}`, { method,
      headers: { apikey: config.serviceKey, Authorization: authorization, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      ...(body === null ? {} : { body: JSON.stringify(body) }) }, 'DATABASE');
  const rows = data => {
    if (!Array.isArray(data)) fail(503, 'INVALID_UPSTREAM_RESPONSE', 'Não foi possível conferir a cobrança. Tente novamente em instantes.');
    return data;
  };
  const one = async path => rows(await db(path))[0] || null;
  const query = values => new URLSearchParams(values).toString();
  const paymentFields = 'id,usuario_id,assinatura_id,valor,status,gateway,gateway_pagamento_id';
  const repo = {
    async authenticate(authorization) {
      try { return await call(`${config.supabaseUrl}/auth/v1/user`, { headers: { apikey: config.serviceKey, Authorization: authorization } }, 'AUTH'); }
      catch { return null; }
    },
    getProfile: id => one('usuarios?' + query({ id: `eq.${id}`, select: 'id,nome,email,status', limit: 1 })),
    getSubscription: id => one('assinaturas?' + query({ usuario_id: `eq.${id}`, select: 'id,status,proximo_vencimento', limit: 1 })),
    getPayment: id => one('pagamentos?' + query({ id: `eq.${id}`, select: paymentFields, limit: 1 })),
    createPayment: (authorization, key) => db('rpc/criar_cobranca_mensal', 'POST', { p_chave_idempotencia: key }, authorization),
    async claim(id, claim) {
      const rows = await db('pagamentos?' + query({ id: `eq.${id}`, status: 'eq.PENDENTE', gateway: 'is.null', gateway_pagamento_id: 'is.null' }),
        'PATCH', { gateway: 'ASAAS', gateway_pagamento_id: claim });
      return rows?.length === 1;
    },
    async attach(id, previous, remoteId) {
      const rows = await db('pagamentos?' + query({ id: `eq.${id}`, gateway: 'eq.ASAAS', gateway_pagamento_id: `eq.${previous}` }),
        'PATCH', { gateway_pagamento_id: remoteId });
      return rows?.length === 1;
    },
    releaseClaim: (id, claim) => db('pagamentos?' + query({ id: `eq.${id}`, gateway: 'eq.ASAAS', gateway_pagamento_id: `eq.${claim}`, status: 'eq.PENDENTE' }),
      'PATCH', { gateway: null, gateway_pagamento_id: null }),
    settle: (id, remoteId, payload) => db('rpc/confirmar_pagamento_gateway', 'POST', {
      p_pagamento_id: id, p_gateway: 'ASAAS', p_gateway_pagamento_id: remoteId,
      p_evento_externo_id: `asaas:received:${remoteId}`, p_payload: payload,
    }),
  };
  const apiUrl = config.environment === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
  const api = (path, method = 'GET', body = null) => call(`${apiUrl}${path}`, { method,
    headers: { access_token: config.apiKey, 'User-Agent': 'clube-beneficios-app/1.0', 'Content-Type': 'application/json' },
    ...(body === null ? {} : { body: JSON.stringify(body) }) }, 'ASAAS');
  const asaas = {
    findPayments: async externalReference => rows((await api('/payments?' + query({ externalReference, limit: 2 })))?.data),
    getPayment: id => api(`/payments/${encodeURIComponent(id)}`),
    createPayment: body => api('/payments', 'POST', body),
    getQr: id => api(`/payments/${encodeURIComponent(id)}/pixQrCode`),
    findCustomers: async externalReference => rows((await api('/customers?' + query({ externalReference, limit: 2 })))?.data),
    createCustomer: body => api('/customers', 'POST', body),
  };
  return { config, repo, asaas };
}
