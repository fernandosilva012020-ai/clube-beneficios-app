(() => {
  const dialog = document.getElementById('authDialog');
  const form = document.getElementById('authForm');
  const title = document.getElementById('dialogTitle');
  const subtitle = document.getElementById('dialogSubtitle');
  const submit = document.getElementById('authSubmit');
  const switcher = document.getElementById('dialogSwitch');

  function setMode(mode){
    dialog.dataset.mode = mode;
    if(mode === 'signup'){
      title.textContent = 'Criar conta';
      subtitle.textContent = 'Entre para o clube e monte seu perfil.';
      submit.textContent = 'Criar minha conta';
      switcher.innerHTML = 'Já tem conta? <button type="button" data-switch-auth>Entrar</button>';
    } else {
      title.textContent = 'Entrar';
      subtitle.textContent = 'Acesse sua área de membro.';
      submit.textContent = 'Entrar';
      switcher.innerHTML = 'Ainda não tem conta? <button type="button" data-switch-auth>Criar conta</button>';
    }
    switcher.querySelector('[data-switch-auth]').onclick = () => setMode(mode === 'login' ? 'signup' : 'login');
  }

  function open(mode='login'){
    setMode(mode);
    if(typeof dialog.showModal === 'function') dialog.showModal();
  }

  document.querySelectorAll('[data-open-login]').forEach(el => el.onclick = () => open('login'));
  document.querySelectorAll('[data-open-signup]').forEach(el => el.onclick = () => open('signup'));
  document.querySelector('[data-close-dialog]').onclick = () => dialog.close();
  dialog.addEventListener('click', e => { if(e.target === dialog) dialog.close(); });

  document.querySelectorAll('[data-open-demo]').forEach(el => el.onclick = () => {
    location.href = 'dashboard.html';
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const mode = dialog.dataset.mode || 'login';
    alert(mode === 'signup'
      ? 'Demonstração pronta. A integração real de cadastro será ligada ao Supabase do novo projeto.'
      : 'Demonstração pronta. A autenticação real será ligada ao Supabase do novo projeto.');
  });

  const io = new IntersectionObserver(entries => entries.forEach(entry => {
    if(entry.isIntersecting){ entry.target.classList.add('visible'); io.unobserve(entry.target); }
  }), {threshold:.12});
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
})();
