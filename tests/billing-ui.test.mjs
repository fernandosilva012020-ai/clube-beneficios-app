import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const USER = '11111111-1111-4111-8111-111111111111';
const PAYMENT = '22222222-2222-4222-8222-222222222222';

// A small DOM/session harness runs the actual application without external services.
async function browser() {
  const nodes = new Map(), timers = new Map(), requests = [];
  let timerId = 0, authChanged, session = { user: { id: USER }, access_token: 'fresh-user-token' };
  class Element {
    constructor(id) { this.id = id; this.children = []; this.dataset = {}; this.value = ''; this.hidden = false; this.disabled = false; }
    remove() { for (const child of this.children) child.remove(); nodes.delete(this.id); }
    set innerHTML(value) {
      for (const child of this.children) child.remove(); this.children = []; this.html = value;
      for (const match of value.matchAll(/<[a-z][^>]*\b(?:id|data-tab)="([^"]+)"[^>]*>/g)) {
        const tab = match[0].includes('data-tab=');
        const child = new Element(tab ? `tab:${match[1]}` : match[1]);
        if (tab) child.dataset.tab = match[1];
        nodes.set(child.id, child); this.children.push(child);
      }
    }
    get innerHTML() { return this.html || ''; }
    addEventListener(event, fn) { this[`on${event}`] = fn; }
    reset() { const field = nodes.get('billingDocument'); if (field) field.value = ''; }
  }
  nodes.set('app', new Element('app')); nodes.set('toast', new Element('toast'));
  const dashboard = { cadastro_completo: true, usuario: { id: USER, nome: 'Teste', status: 'PENDENTE' },
    assinatura: { status: 'PENDENTE', proximo_vencimento: '2026-09-16T00:00:00Z' }, saldos: {} };
  const state = { dashboard, requests, copied: null, reply: { pagamento_id: PAYMENT, pix_copy_paste: '000201-code', qr_code_base64: 'YQ==' } };
  const sb = {
    auth: { getSession: async () => ({ data: { session } }), onAuthStateChange: fn => { authChanged = fn; },
      signOut: async () => { session = null; authChanged('SIGNED_OUT', null); } },
    rpc: async name => name === 'meu_dashboard' ? { data: structuredClone(dashboard) } : { error: new Error('not admin') },
  };
  const context = vm.createContext({
    window: { APP_CONFIG: { supabaseUrl: 'https://test.invalid', supabasePublishableKey: 'public-key', paymentAdapterUrl: 'https://test.invalid/pix', appName: 'Teste' }, supabase: { createClient: () => sb } },
    document: { getElementById: id => nodes.get(id) || null, querySelectorAll: selector => selector === '[data-tab]' ? [...nodes.values()].filter(n => n.dataset.tab) : [] },
    location: new URL('https://fernandosilva012020-ai.github.io/clube-beneficios-app/'),
    navigator: { clipboard: { writeText: async text => { state.copied = text; } } },
    localStorage: { getItem: () => null }, URL, URLSearchParams, console,
    FormData: class { get(key) { return key === 'cpf_cnpj' ? nodes.get('billingDocument').value : null; } },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => { requests.push({ url, ...options }); return state.fetch ? state.fetch() : new Response(JSON.stringify(state.reply), { status: state.httpStatus || 200 }); },
  });
  new vm.Script(source).runInContext(context);
  await new Promise(resolve => setImmediate(resolve));
  nodes.get('tab:mensalidade').onclick();
  const submit = async () => { nodes.get('billingDocument').value = '12345678909'; return nodes.get('chargeForm').onsubmit({ preventDefault() {} }); };
  return { state, nodes, submit, sb, timers };
}

test('billing creates authenticated PIX, copies its code and refreshes the active membership', async () => {
  const { state, nodes, submit } = await browser();
  await submit();
  assert.deepEqual(JSON.parse(state.requests[0].body), { action: 'create', cpf_cnpj: '12345678909' });
  assert.equal(state.requests[0].headers.authorization, 'Bearer fresh-user-token');
  assert.equal(nodes.get('chargeForm').hidden, true);
  assert.equal(nodes.get('billingDocument').value, '');
  assert.match(nodes.get('chargeResult').innerHTML, /data:image\/png;base64,YQ==/);
  await nodes.get('copyPix').onclick(); assert.equal(state.copied, '000201-code');
  state.reply = { paid: false };
  await nodes.get('checkPix').onclick({ currentTarget: nodes.get('checkPix') });
  assert.match(nodes.get('pixPaymentStatus').textContent, /ainda não foi confirmado/);
  state.reply = { paid: true }; state.dashboard.assinatura = { status: 'ATIVA', proximo_vencimento: '2099-01-01T00:00:00Z' };
  await nodes.get('checkPix').onclick({ currentTarget: nodes.get('checkPix') });
  assert.deepEqual(JSON.parse(state.requests[2].body), { action: 'status', pagamento_id: PAYMENT });
  assert.match(nodes.get('view').innerHTML, /Sua mensalidade está em dia/);
  assert.equal(nodes.has('chargeForm'), false);
});

test('unconfigured payment service shows an error and leaves the form usable', async () => {
  const { state, nodes, submit } = await browser();
  state.httpStatus = 503; state.reply = { error: 'O pagamento PIX ainda não está disponível.' };
  await submit();
  assert.equal(nodes.get('toast').textContent, state.reply.error);
  assert.equal(nodes.get('charge').disabled, false);
  assert.equal(nodes.get('chargeForm').hidden, false);
  assert.equal(nodes.has('copyPix'), false);
});

test('a response received after logout does not display the previous account payment', async () => {
  const { state, nodes, submit, sb } = await browser();
  let complete;
  state.fetch = () => new Promise(resolve => { complete = resolve; });
  const pending = submit(); await new Promise(resolve => setImmediate(resolve));
  await sb.auth.signOut();
  complete(new Response(JSON.stringify(state.reply))); await pending;
  assert.equal(nodes.has('loginForm'), true); assert.equal(nodes.has('copyPix'), false);
});

test('payment display escapes the copy code and rejects an unsafe image value', async () => {
  const { state, nodes, submit } = await browser();
  state.reply.pix_copy_paste = '</textarea><script>alert(1)</script>';
  state.reply.qr_code_base64 = '" onerror="alert(1)';
  await submit();
  assert.match(nodes.get('chargeResult').innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(nodes.get('chargeResult').innerHTML, /<script>|onerror=/);
});
