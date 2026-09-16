import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers, createServices, readConfig, PaymentError } from '../supabase/functions/_shared/asaas.mjs';

const USER = '11111111-1111-4111-8111-111111111111';
const PAYMENT = '22222222-2222-4222-8222-222222222222';
const SUB = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'test-webhook-token-0123456789abcdef0123456789';
const SITE = 'https://fernandosilva012020-ai.github.io';
const NOW = new Date('2026-09-16T12:00:00Z');

function setup(overrides = {}) {
  const config = { supabaseUrl: 'https://iscoxpsizfxjpkbojykc.supabase.co', serviceKey: 'server-only',
    apiKey: '$aact_prod_test', webhookToken: TOKEN, enabled: true, environment: 'production', siteOrigin: SITE, ...overrides };
  const state = { keys: [], createCount: 0, rpcCount: 0, activations: 0, settled: new Set(), remote: [],
    user: { id: USER, email_confirmed_at: NOW.toISOString() },
    profile: { id: USER, nome: 'Pessoa de teste', email: 'test@example.invalid', status: 'PENDENTE' },
    subscription: { id: SUB, status: 'PENDENTE', proximo_vencimento: '2026-09-16T00:00:00Z' },
    payment: { id: PAYMENT, usuario_id: USER, assinatura_id: SUB, valor: 49.9, status: 'PENDENTE', gateway: null, gateway_pagamento_id: null } };
  const repo = {
    authenticate: async auth => auth === 'Bearer test-jwt' ? state.user : null,
    getProfile: async () => state.profile,
    getSubscription: async () => ({ ...state.subscription }),
    getPayment: async id => id === PAYMENT ? { ...state.payment } : null,
    createPayment: async (_auth, key) => { state.keys.push(key); state.rpcCount++; return { pagamento_id: PAYMENT }; },
    claim: async (_id, claim) => {
      if (state.payment.gateway || state.payment.gateway_pagamento_id) return false;
      Object.assign(state.payment, { gateway: 'ASAAS', gateway_pagamento_id: claim }); return true;
    },
    attach: async (_id, previous, remoteId) => {
      if (state.payment.gateway_pagamento_id !== previous) return false;
      state.payment.gateway_pagamento_id = remoteId; return true;
    },
    releaseClaim: async (_id, claim) => {
      if (state.payment.gateway_pagamento_id === claim) Object.assign(state.payment, { gateway: null, gateway_pagamento_id: null });
    },
    settle: async (id, remoteId, payload) => {
      assert.equal(id, PAYMENT); assert.equal(remoteId, 'pay_test');
      assert.equal(payload.status, 'RECEIVED');
      if (!state.settled.has(id)) { state.activations++; state.settled.add(id); }
      state.payment.status = 'CONFIRMADO';
    },
  };
  const asaas = {
    findPayments: async ref => state.remote.filter(p => p.externalReference === ref),
    getPayment: async id => ({ ...state.remote.find(p => p.id === id) }),
    findCustomers: async () => [],
    createCustomer: async body => { assert.equal(body.notificationDisabled, true); return { id: 'cus_test' }; },
    createPayment: async body => {
      state.createCount++; state.createBody = body;
      const payment = { ...body, id: 'pay_test', status: 'PENDING', netValue: 48.91 };
      state.remote.push(payment); return payment;
    },
    getQr: async () => ({ payload: '000201-test-pix', encodedImage: 'YQ==', expirationDate: '2026-09-17 23:59:59' }),
  };
  const handler = createHandlers({ config, repo, asaas, now: () => NOW, randomId: () => 'test-lock' });
  const charge = (body = { cpf_cnpj: '12345678909' }, headers = {}) => handler.createPix(new Request('https://test.invalid/pix', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-jwt', Origin: SITE, ...headers }, body: JSON.stringify(body),
  }));
  const hook = (body = { id: 'evt_test', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_test' } }, token = TOKEN) => handler.webhook(new Request('https://test.invalid/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'asaas-access-token': token }, body: JSON.stringify(body),
  }));
  return { config, state, repo, asaas, handler, charge, hook };
}

test('missing/invalid user token, unconfirmed email and foreign origin cannot create charges', async () => {
  const f = setup();
  assert.equal((await f.charge({}, { Authorization: '' })).status, 401);
  assert.equal((await f.charge({}, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await f.charge({}, { Origin: 'https://attacker.invalid' })).status, 403);
  f.state.user.email_confirmed_at = null;
  assert.equal((await f.charge()).status, 401);
  assert.equal(f.state.createCount, 0); assert.equal(f.state.rpcCount, 0);
});

test('disabled credentials and sandbox on the live database fail before any charge', async () => {
  for (const config of [{ enabled: false }, { apiKey: '' }, { webhookToken: '' },
    { environment: 'sandbox', apiKey: '$aact_hmlg_test' }, { environment: 'invalid' }]) {
    const f = setup(config);
    assert.equal((await f.charge()).status, 503);
    assert.equal(f.state.rpcCount, 0);
  }
});

test('active membership and suspended account cannot generate another charge', async () => {
  const f = setup();
  f.state.subscription = { id: SUB, status: 'ATIVA', proximo_vencimento: '2026-10-16T00:00:00Z' };
  assert.equal((await (await f.charge()).json()).already_active, true);
  f.state.profile.status = 'SUSPENSO';
  assert.equal((await f.charge()).status, 403);
  assert.equal(f.state.createCount, 0); assert.equal(f.state.rpcCount, 0);
});

test('invalid document rejected before creating a local payment', async () => {
  const f = setup();
  assert.equal((await f.charge({ cpf_cnpj: '<script>' })).status, 400);
  assert.equal(f.state.rpcCount, 0);
});

test('amount comes from server and repeated clicks reuse one PIX', async () => {
  const f = setup();
  const first = await f.charge({ cpf_cnpj: '123.456.789-09', value: 0.01, usuario_id: 'other' });
  assert.equal(first.status, 200);
  const data = await first.json();
  assert.equal(data.value, 49.9); assert.equal(data.pix_copy_paste, '000201-test-pix');
  assert.equal(f.state.createBody.value, 49.9);
  assert.equal(f.state.createBody.externalReference, `clube-beneficios:${PAYMENT}`);
  assert.equal(f.state.createBody.dueDate, '2026-09-16');
  assert.equal((await f.charge()).status, 200);
  assert.equal(f.state.createCount, 1);
  assert.equal(f.state.keys[0], f.state.keys[1]);
  assert.equal(f.state.activations, 0);
});

test('concurrent requests create at most one external charge', async () => {
  const f = setup();
  const responses = await Promise.all([f.charge(), f.charge(), f.charge()]);
  assert.ok(responses.every(r => [200, 409].includes(r.status)));
  assert.equal(f.state.createCount, 1);
});

test('lost response reconciles externalReference without creating a second charge', async () => {
  const f = setup(); const original = f.asaas.createPayment;
  f.asaas.createPayment = async body => { await original(body); throw new PaymentError(503, 'TIMEOUT', 'Timeout'); };
  assert.equal((await f.charge()).status, 503);
  assert.match(f.state.payment.gateway_pagamento_id, /^creating:/);
  assert.equal((await f.charge()).status, 200);
  assert.equal(f.state.createCount, 1);
  assert.equal(f.state.payment.gateway_pagamento_id, 'pay_test');
});

test('ambiguous failure with no remote match remains locked instead of retrying POST', async () => {
  const f = setup();
  f.asaas.createPayment = async () => { f.state.createCount++; throw new PaymentError(503, 'TIMEOUT', 'Timeout'); };
  assert.equal((await f.charge()).status, 503);
  assert.equal((await f.charge()).status, 409);
  assert.equal(f.state.createCount, 1);
});

test('definitive provider rejection permits a corrected retry', async () => {
  const f = setup(); const original = f.asaas.createPayment;
  f.asaas.createPayment = async () => { throw new PaymentError(503, 'ASAAS_REJECTED', 'Rejected', true); };
  assert.equal((await f.charge()).status, 503);
  assert.equal(f.state.payment.gateway_pagamento_id, null);
  f.asaas.createPayment = original;
  assert.equal((await f.charge()).status, 200);
});

test('webhook requires its separate secret and ignores unrelated event types', async () => {
  const f = setup();
  assert.equal((await f.hook(undefined, 'wrong')).status, 401);
  assert.equal((await f.hook({ event: 'PAYMENT_CONFIRMED' })).status, 200);
  assert.equal(f.state.activations, 0);
});

test('webhook trusts the fetched payment, not an incoming paid status', async () => {
  const f = setup(); await f.charge();
  const body = { id: 'evt_fake', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_test', status: 'RECEIVED', value: 49.9 } };
  assert.equal((await f.hook(body)).status, 200);
  assert.equal(f.state.activations, 0);
  f.state.remote[0].status = 'CONFIRMED';
  assert.equal((await f.hook(body)).status, 200);
  assert.equal(f.state.activations, 0);
});

test('wrong value, non-PIX, refund or wrong mapped ID cannot activate', async () => {
  for (const change of [{ value: 1 }, { value: 49.904 }, { billingType: 'BOLETO' }, { refunds: [{}] }]) {
    const f = setup(); await f.charge(); Object.assign(f.state.remote[0], { status: 'RECEIVED' }, change);
    assert.equal((await f.hook()).status, 409); assert.equal(f.state.activations, 0);
  }
  const f = setup(); await f.charge(); f.state.remote[0].status = 'RECEIVED';
  f.state.payment.gateway_pagamento_id = 'pay_other';
  assert.equal((await f.hook()).status, 409); assert.equal(f.state.activations, 0);
});

test('received event activates once and duplicate deliveries are harmless', async () => {
  const f = setup(); await f.charge(); f.state.remote[0].status = 'RECEIVED';
  assert.equal((await f.hook()).status, 200);
  assert.equal((await f.hook()).status, 200);
  assert.equal(f.state.activations, 1); assert.equal(f.state.payment.status, 'CONFIRMADO');
});

test('webhook can reconcile a received payment while its creation response is missing', async () => {
  const f = setup(); await f.charge();
  f.state.payment.gateway_pagamento_id = 'creating:lost-response';
  f.state.remote[0].status = 'RECEIVED';
  assert.equal((await f.hook()).status, 200);
  assert.equal(f.state.activations, 1); assert.equal(f.state.payment.gateway_pagamento_id, 'pay_test');
});

test('status checks enforce payment ownership and can recover a missed webhook', async () => {
  const f = setup(); await f.charge(); f.state.remote[0].status = 'RECEIVED';
  f.state.payment.usuario_id = SUB;
  assert.equal((await f.charge({ action: 'status', pagamento_id: PAYMENT })).status, 404);
  assert.equal(f.state.activations, 0);
  f.state.payment.usuario_id = USER;
  const result = await f.charge({ action: 'status', pagamento_id: PAYMENT });
  assert.equal((await result.json()).paid, true); assert.equal(f.state.activations, 1);
});

test('transport sends secrets only to their own server and locks via conditional UPDATE', async () => {
  const { config } = setup(); const requests = [];
  const services = createServices(config, async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(url.includes('/payments?') ? { data: [] } : [{}]), { status: 200 });
  });
  await services.asaas.findPayments(`clube-beneficios:${PAYMENT}`);
  await services.repo.claim(PAYMENT, 'creating:test');
  assert.ok(requests[0].url.startsWith('https://api.asaas.com/v3/'));
  assert.equal(requests[0].options.headers.access_token, config.apiKey);
  assert.equal(requests[0].options.headers.Authorization, undefined);
  const q = new URL(requests[1].url).searchParams;
  assert.equal(q.get('status'), 'eq.PENDENTE'); assert.equal(q.get('gateway_pagamento_id'), 'is.null');
  assert.equal(requests[1].options.headers.access_token, undefined);
});

test('configuration is disabled by default and never contains hardcoded private credentials', () => {
  const config = readConfig(() => undefined);
  assert.equal(config.enabled, false); assert.equal(config.apiKey, ''); assert.equal(config.webhookToken, '');
});

test('malformed provider responses cannot be mistaken for an empty payment search', async () => {
  const { config } = setup();
  for (const body of ['not-json', 'null', '{}', '{"data":null}', '{"data":{}}']) {
    const { asaas } = createServices(config, async () => new Response(body));
    await assert.rejects(asaas.findPayments('ref'), { code: 'INVALID_UPSTREAM_RESPONSE' });
    await assert.rejects(asaas.findCustomers('ref'), { code: 'INVALID_UPSTREAM_RESPONSE' });
  }
});
