(() => {
  const WAIT_KEY = 'awaitingEmailConfirmation';
  const PROFILE_KEY = 'pendingProfile';
  const cfg = window.APP_CONFIG;
  if (!cfg?.supabaseUrl || !cfg?.supabasePublishableKey || !window.supabase) return;

  const sbEmail = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
  const app = document.getElementById('app');
  let rendering = false;

  const esc = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));

  const redirectUrl = () => `${location.origin}${location.pathname}`;

  function setStatus(message, type = 'ok') {
    const el = document.getElementById('confirmEmailStatus');
    if (!el) return;
    el.className = `confirm-email-status show ${type}`;
    el.textContent = message;
  }

  function showConfirmedBanner() {
    if (document.querySelector('.email-confirmed-banner')) return;
    const el = document.createElement('div');
    el.className = 'email-confirmed-banner';
    el.textContent = '✅ E-mail confirmado com sucesso! Bem-vindo ao Clube de Benefícios 2x1.';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5500);
  }

  function renderConfirmEmail(email) {
    if (!app || rendering) return;
    if (document.querySelector('.confirm-email-card')) return;
    rendering = true;
    app.innerHTML = `<main class="confirm-email-screen"><section class="confirm-email-card">
      <div class="confirm-email-icon">✉️</div>
      <div class="confirm-email-kicker">CADASTRO REALIZADO</div>
      <h1>Confirme seu e-mail</h1>
      <p class="confirm-email-lead">Falta só um passo para ativar sua conta no <strong>${esc(cfg.appName || 'Clube de Benefícios 2x1')}</strong>.</p>
      <div class="confirm-email-address"><span>Enviamos o link de confirmação para</span><strong>${esc(email)}</strong></div>
      <div class="confirm-email-steps">
        <div class="confirm-email-step"><b>1</b><p>Abra sua caixa de entrada.</p></div>
        <div class="confirm-email-step"><b>2</b><p>Toque no botão ou link para <strong>confirmar seu e-mail</strong>.</p></div>
        <div class="confirm-email-step"><b>3</b><p>Depois da confirmação, você volta automaticamente para o seu painel.</p></div>
      </div>
      <div class="confirm-email-actions">
        <button class="confirm-email-primary" id="confirmEmailChecked" type="button">Já confirmei meu e-mail</button>
        <button class="confirm-email-secondary" id="confirmEmailResend" type="button">Reenviar e-mail</button>
      </div>
      <div id="confirmEmailStatus" class="confirm-email-status"></div>
      <p class="confirm-email-note">Não encontrou a mensagem? Confira também <strong>Spam</strong>, <strong>Lixo eletrônico</strong> e <strong>Promoções</strong>.</p>
      <button class="confirm-email-link" id="confirmEmailBack" type="button">Voltar para o login</button>
    </section></main>`;
    rendering = false;

    document.getElementById('confirmEmailResend')?.addEventListener('click', async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      button.textContent = 'Reenviando...';
      try {
        const { error } = await sbEmail.auth.resend({
          type: 'signup',
          email,
          options: { emailRedirectTo: redirectUrl() }
        });
        if (error) throw error;
        setStatus('✅ Novo e-mail de confirmação enviado. Confira sua caixa de entrada.', 'ok');
      } catch (error) {
        setStatus(error?.message || 'Não foi possível reenviar agora. Tente novamente em instantes.', 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Reenviar e-mail';
      }
    });

    document.getElementById('confirmEmailChecked')?.addEventListener('click', async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      button.textContent = 'Verificando...';
      try {
        const { data } = await sbEmail.auth.getSession();
        if (data.session?.user?.email_confirmed_at) {
          localStorage.removeItem(WAIT_KEY);
          location.reload();
          return;
        }
        setStatus('Abra o link recebido no e-mail. Ao confirmar, você será redirecionado automaticamente para o site.', 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Já confirmei meu e-mail';
      }
    });

    document.getElementById('confirmEmailBack')?.addEventListener('click', () => {
      localStorage.removeItem(WAIT_KEY);
      location.reload();
    });
  }

  async function validateReferral(code) {
    if (!code) return;
    const { data, error } = await sbEmail.rpc('consultar_indicador', { p_codigo: code });
    if (error) throw error;
    if (!data?.encontrado) throw new Error('Código de indicação inválido');
  }

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== 'signupForm') return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const fd = new FormData(form);
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    const profile = {
      nome: String(fd.get('nome') || '').trim(),
      whatsapp: String(fd.get('whatsapp') || '').trim(),
      ref: String(fd.get('ref') || '').trim() || null
    };
    const button = form.querySelector('button');
    const originalText = button?.textContent || 'Criar conta';

    try {
      if (button) {
        button.disabled = true;
        button.textContent = 'Criando conta...';
      }
      await validateReferral(profile.ref);
      const { data, error } = await sbEmail.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectUrl() }
      });
      if (error) throw error;

      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));

      if (data.session) {
        localStorage.removeItem(WAIT_KEY);
        location.reload();
        return;
      }

      localStorage.setItem(WAIT_KEY, email);
      renderConfirmEmail(email);
    } catch (error) {
      const toast = document.getElementById('toast');
      if (toast) {
        toast.className = 'toast show error';
        toast.textContent = error?.message || 'Não foi possível criar sua conta.';
        setTimeout(() => { toast.className = 'toast'; }, 4500);
      } else {
        alert(error?.message || 'Não foi possível criar sua conta.');
      }
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }, true);

  sbEmail.auth.onAuthStateChange((event, session) => {
    if (session?.user?.email_confirmed_at && localStorage.getItem(WAIT_KEY)) {
      localStorage.removeItem(WAIT_KEY);
      setTimeout(showConfirmedBanner, 700);
    }
  });

  async function restoreConfirmationScreen() {
    const waitingEmail = localStorage.getItem(WAIT_KEY);
    if (!waitingEmail) return;
    const { data } = await sbEmail.auth.getSession();
    if (data.session?.user?.email_confirmed_at) {
      localStorage.removeItem(WAIT_KEY);
      showConfirmedBanner();
      return;
    }
    renderConfirmEmail(waitingEmail);
  }

  const observer = new MutationObserver(() => {
    const waitingEmail = localStorage.getItem(WAIT_KEY);
    if (waitingEmail && !document.querySelector('.confirm-email-card')) {
      queueMicrotask(() => renderConfirmEmail(waitingEmail));
    }
  });
  if (app) observer.observe(app, { childList: true, subtree: true });

  setTimeout(restoreConfirmationScreen, 50);
})();
