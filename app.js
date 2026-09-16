(() => {
  const cfg = window.APP_CONFIG;
  if (!cfg?.supabaseUrl || !cfg?.supabasePublishableKey || !window.supabase) {
    document.getElementById('app').innerHTML = '<main class="auth-wrap"><div class="card auth-card"><h1>Configuração incompleta</h1><p>Revise config.js.</p></div></main>';
    return;
  }
  // Capture callback errors before the SDK consumes the URL fragment.
  const authReturn = new URLSearchParams(location.hash.slice(1));
  window.APP_AUTH_RETURN = {
    error: authReturn.get('error_code') || authReturn.get('error'),
    type: authReturn.get('type')
  };
  // Share one Auth client with the confirmation screen to avoid session races.
  const sb = window.APP_SUPABASE = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
  const app = document.getElementById('app');
  const toast = document.getElementById('toast');
  const money = (v) => Number(v || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const dt = (v) => v ? new Date(v).toLocaleString('pt-BR') : '—';
  const statusClass = (s='') => /ATIV|PAGO|LIQUIDADO|CONCLUID/.test(s) ? 'good' : /PEND|ATRAS|AGUARD|PROCESS/.test(s) ? 'warn' : /INAD|FALH|CANCEL|SUSP|BLOQUE/.test(s) ? 'bad' : '';
  const showToast = (msg,type='ok') => { toast.className=`toast show ${type}`; toast.textContent=msg; clearTimeout(showToast.t); showToast.t=setTimeout(()=>toast.className='toast',3800); };
  const esc = (s='') => String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const rpc = async (name,args={}) => { const {data,error}=await sb.rpc(name,args); if(error) throw error; return data; };
  const refFromUrl = new URLSearchParams(location.search).get('ref') || '';
  let session=null, dashboard=null, adminData=null, activeTab='inicio';
  let pixCharge=null, pixPollTimer=null;

  async function boot(){
    const {data}=await sb.auth.getSession(); session=data.session;
    sb.auth.onAuthStateChange((_event,s)=>{ session=s; if(!s){ pixCharge=null; clearTimeout(pixPollTimer); activeTab='inicio'; renderAuth(); } });
    if(session){ await finishPendingProfile(); await loadDashboard(); } else renderAuth();
  }

  function renderAuth(mode='login'){
    app.innerHTML=`<main class="auth-wrap"><section class="card auth-card">
      <div class="brand"><div class="brand-mark">2×1</div><div><h1>${esc(cfg.appName)}</h1><div class="muted small">Benefícios digitais + progressão gamificada</div></div></div>
      <div class="tabs"><button class="tab ${mode==='login'?'active':''}" id="tLogin">Entrar</button><button class="tab ${mode==='signup'?'active':''}" id="tSignup">Criar conta</button></div>
      ${mode==='login'?`<form id="loginForm" class="grid"><div class="field"><label>E-mail</label><input name="email" type="email" required autocomplete="email"></div><div class="field"><label>Senha</label><input name="password" type="password" required autocomplete="current-password"></div><button class="btn btn-primary">Entrar</button></form>`:
      `<form id="signupForm" class="grid"><div class="grid grid-2"><div class="field"><label>Nome completo</label><input name="nome" required></div><div class="field"><label>WhatsApp</label><input name="whatsapp" required placeholder="+55..."></div></div><div class="field"><label>Código de indicação (opcional)</label><input name="ref" value="${esc(refFromUrl)}"><div id="refHint" class="small muted"></div></div><div class="field"><label>E-mail</label><input name="email" type="email" required autocomplete="email"></div><div class="field"><label>Senha</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div><button class="btn btn-primary">Criar conta</button></form>`}
      <div class="divider"></div><p class="small muted">A mensalidade é de R$49,90. Recompensas dos tabuleiros dependem da atividade global e da liquidez do pool; não há garantia de prazo ou retorno.</p>
    </section></main>`;
    document.getElementById('tLogin').onclick=()=>renderAuth('login'); document.getElementById('tSignup').onclick=()=>renderAuth('signup');
    if(mode==='login') document.getElementById('loginForm').onsubmit=login; else { document.getElementById('signupForm').onsubmit=signup; const ri=document.querySelector('[name=ref]'); ri.addEventListener('blur',()=>checkRef(ri.value)); if(ri.value) checkRef(ri.value); }
  }
  async function checkRef(code){ const hint=document.getElementById('refHint'); if(!hint||!code.trim()) return; try{ const d=await rpc('consultar_indicador',{p_codigo:code.trim()}); hint.textContent=d?.encontrado?`Indicador: ${d.nome}`:'Código não encontrado'; }catch(e){hint.textContent='Não foi possível validar agora';} }
  async function login(e){ e.preventDefault(); const f=new FormData(e.target); try{ const {data,error}=await sb.auth.signInWithPassword({email:f.get('email'),password:f.get('password')}); if(error) throw error; session=data.session; await finishPendingProfile(); await loadDashboard(); }catch(err){showToast(err.message,'error');} }
  async function signup(e){ e.preventDefault(); const f=new FormData(e.target); const profile={nome:f.get('nome'),whatsapp:f.get('whatsapp'),ref:f.get('ref')||null}; try{ if(profile.ref){const chk=await rpc('consultar_indicador',{p_codigo:profile.ref}); if(!chk?.encontrado) throw new Error('Código de indicação inválido');} const {data,error}=await sb.auth.signUp({email:f.get('email'),password:f.get('password'),options:{emailRedirectTo:cfg.siteUrl || new URL('./',location.href).href}}); if(error) throw error; localStorage.setItem('pendingProfile',JSON.stringify(profile)); if(data.session){session=data.session; await finishPendingProfile(); await loadDashboard();} else {showToast('Conta criada. Confirme seu e-mail e depois entre.'); renderAuth('login');} }catch(err){showToast(err.message,'error');} }
  async function finishPendingProfile(){ const raw=localStorage.getItem('pendingProfile'); if(!raw||!session) return; try{const p=JSON.parse(raw); await rpc('completar_cadastro',{p_nome:p.nome,p_telefone_whatsapp:p.whatsapp,p_codigo_patrocinador:p.ref||null}); localStorage.removeItem('pendingProfile');}catch(e){ if(!/idempot/i.test(e.message)) console.warn(e); } }
  async function loadDashboard(){ try{dashboard=await rpc('meu_dashboard'); if(!dashboard?.cadastro_completo){return renderCompleteProfile();} try{adminData=await rpc('admin_dashboard');}catch{adminData=null;} renderApp();}catch(e){showToast(e.message,'error');} }
  function renderCompleteProfile(){ app.innerHTML=`<main class="auth-wrap"><section class="card auth-card"><h1>Complete seu cadastro</h1><form id="completeForm" class="grid"><div class="field"><label>Nome</label><input name="nome" required></div><div class="field"><label>WhatsApp</label><input name="whatsapp" required></div><div class="field"><label>Código do indicador</label><input name="ref" value="${esc(refFromUrl)}"></div><button class="btn btn-primary">Concluir</button></form></section></main>`; document.getElementById('completeForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await rpc('completar_cadastro',{p_nome:f.get('nome'),p_telefone_whatsapp:f.get('whatsapp'),p_codigo_patrocinador:f.get('ref')||null});await loadDashboard();}catch(err){showToast(err.message,'error')}}; }

  function renderApp(){
    clearTimeout(pixPollTimer);
    const u=dashboard.usuario, a=dashboard.assinatura, s=dashboard.saldos;
    const nav=['inicio','tabuleiros','mensalidade','indicacoes','pix']; if(adminData) nav.push('admin');
    app.innerHTML=`<main class="shell"><header class="topbar"><div class="brand"><div class="brand-mark">2×1</div><div><h1>${esc(cfg.appName)}</h1><div class="muted small">Olá, ${esc(u.nome)}</div></div></div><div class="actions"><span class="badge ${statusClass(u.status)}">${esc(u.status)}</span><button class="btn btn-secondary" id="logout">Sair</button></div></header>
      <nav class="nav">${nav.map(n=>`<button class="tab ${activeTab===n?'active':''}" data-tab="${n}">${({inicio:'Resumo',tabuleiros:'Tabuleiros',mensalidade:'Mensalidade',indicacoes:'Indicações',pix:'PIX & Saques',admin:'Admin'})[n]}</button>`).join('')}</nav><div id="view"></div></main>`;
    document.getElementById('logout').onclick=async()=>{await sb.auth.signOut();}; document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{activeTab=b.dataset.tab;renderApp();});
    const view=document.getElementById('view'); if(activeTab==='inicio') view.innerHTML=homeView(u,a,s); if(activeTab==='tabuleiros') view.innerHTML=boardsView(); if(activeTab==='mensalidade'){view.innerHTML=billingView(a);bindBilling();} if(activeTab==='indicacoes'){view.innerHTML=refView(u);bindRef();} if(activeTab==='pix'){view.innerHTML=pixView();bindPix();} if(activeTab==='admin'&&adminData){view.innerHTML=adminView();bindAdmin();}
  }
  function homeView(u,a,s){const g=dashboard.ganhos||{};return `<section class="section"><div class="hero"><div><div class="muted small">PAINEL DO MEMBRO</div><h2>${esc(u.nome)}</h2></div><span class="badge ${statusClass(a.status)}">Assinatura ${esc(a.status)}</span></div><div class="grid grid-4"><div class="stat"><div class="label">Saldo disponível</div><div class="value">${money(s.disponivel)}</div></div><div class="stat"><div class="label">Bloqueado</div><div class="value">${money(s.bloqueado)}</div></div><div class="stat"><div class="label">Indicações diretas</div><div class="value">${dashboard.indicacoes_diretas||0}</div></div><div class="stat"><div class="label">Próximo vencimento</div><div class="value" style="font-size:18px">${dt(a.proximo_vencimento)}</div></div></div><div class="section grid grid-3"><div class="stat"><div class="label">Ganhos Tabuleiros</div><div class="value">${money(g.tabuleiros)}</div></div><div class="stat"><div class="label">Ganhos Unilevel</div><div class="value">${money(g.unilevel)}</div></div><div class="stat"><div class="label">Fidelidade</div><div class="value">${money(g.fidelidade)}</div></div></div><div class="section notice"><strong>Como funciona:</strong> a renovação mensal mantém os benefícios ativos e alimenta os pools. Ela não cria nova Bronze. Reentrada acontece somente após a conclusão do Diamante.</div></section>`}
  function boardsView(){const names={1:'Bronze',2:'Prata',3:'Ouro',4:'Platina',5:'Diamante'};const rows=dashboard.tabuleiros||[];return `<section class="section card"><div class="section-head"><h2>Meus Tabuleiros</h2><span class="muted small">FIFO global por fase</span></div>${rows.length?`<div class="grid">${rows.map(p=>`<div class="phase"><div class="phase-num">${p.fase}</div><div><strong>${names[p.fase]||'Fase '+p.fase}</strong> <span class="badge ${statusClass(p.status)}">${esc(p.status)}</span><div class="progress"><span style="width:${Math.min(100,(Number(p.apoios)||0)*50)}%"></span></div><div class="muted small">Apoios: ${p.apoios}/2 · posição estimada na fila: ${p.posicao_fila}</div></div><div class="nowrap">#${p.ordem_fila}</div></div>`).join('')}</div>`:'<div class="empty">Nenhuma posição criada ainda.</div>'}</section>`}
  function billingView(a){
    const active = a.status === 'ATIVA' && new Date(a.proximo_vencimento) > new Date();
    return `<section class="section grid grid-2"><div class="card">
      <h2>Mensalidade</h2><p class="muted">Valor mensal: <strong>R$49,90</strong></p>
      <p>Status: <span class="badge ${statusClass(a.status)}">${esc(a.status)}</span></p>
      <p>Vencimento: ${dt(a.proximo_vencimento)}<br><span class="muted small">Tolerância até ${dt(a.tolerancia_ate)}</span></p>
      ${active ? '<div class="notice">Sua mensalidade está em dia.</div>' : `<form id="chargeForm" class="grid">
        <div class="field"><label for="billingDocument">CPF ou CNPJ do titular</label>
        <input id="billingDocument" name="cpf_cnpj" maxlength="18" autocomplete="off" required placeholder="CPF ou CNPJ">
        <span class="small muted">Seu documento, nome e e-mail serão usados pelo Asaas para emitir a cobrança.</span></div>
        <button id="charge" class="btn btn-primary">Gerar PIX de R$49,90</button></form>`}
      <div id="chargeResult" class="section" aria-live="polite"></div>
    </div><div class="card"><h2>Rateio da mensalidade</h2><div class="table-wrap">
      <table class="billing-breakdown"><tbody><tr><td>Tabuleiros</td><td>R$30,00</td></tr><tr><td>Unilevel</td><td>R$7,00</td></tr><tr><td>Fidelidade</td><td>R$3,00</td></tr><tr><td>Operação</td><td>R$9,90</td></tr></tbody></table>
    </div><p class="small muted">A assinatura é ativada após a confirmação do recebimento pelo Asaas.</p></div></section>`;
  }
  async function paymentRequest(body){
    if(!cfg.paymentAdapterUrl) throw new Error('O pagamento PIX ainda não está disponível.');
    const {data,error}=await sb.auth.getSession();
    if(error || !data.session) throw new Error('Entre novamente na sua conta para continuar.');
    const response=await fetch(cfg.paymentAdapterUrl,{
      method:'POST', headers:{'content-type':'application/json','authorization':`Bearer ${data.session.access_token}`,'apikey':cfg.supabasePublishableKey},
      body:JSON.stringify(body)
    });
    let out; try{out=await response.json();}catch{throw new Error('Não foi possível acessar o serviço de pagamento.');}
    if(!response.ok) throw new Error(out.error || 'Não foi possível preparar seu PIX agora.');
    return out;
  }
  async function paymentConfirmed(){
    pixCharge=null; clearTimeout(pixPollTimer);
    showToast('Pagamento recebido! Sua assinatura está ativa.');
    await loadDashboard();
  }
  function renderPixCharge(){
    const el=document.getElementById('chargeResult');
    if(!el || !pixCharge) return;
    const form=document.getElementById('chargeForm'); if(form) form.hidden=true;
    const code=pixCharge.pix_copy_paste;
    const image=pixCharge.qr_code_base64;
    const validImage=typeof image==='string' && image.length<500000 && /^[A-Za-z0-9+/=\r\n]+$/.test(image);
    el.innerHTML=`<div class="pix-payment">
      <h3>Mensalidade de R$49,90</h3>
      ${code ? `<p>Escaneie o QR Code ou copie o código para pagar no aplicativo do seu banco.</p>
        ${validImage?`<img class="pix-qr" src="data:image/png;base64,${esc(image)}" alt="QR Code PIX da mensalidade de R$49,90">`:''}
        <label class="small" for="pixCopyCode">PIX Copia e Cola</label>
        <textarea id="pixCopyCode" class="pix-code" readonly rows="3">${esc(code)}</textarea>
        <button class="btn btn-primary" type="button" id="copyPix">Copiar código PIX</button>`:
        '<p>O Asaas está processando seu pagamento. Aguarde a confirmação do recebimento.</p>'}
      <p id="pixPaymentStatus" class="small muted" role="status">Aguardando confirmação do pagamento.</p>
      <button class="btn btn-secondary" type="button" id="checkPix">Já paguei — verificar</button>
    </div>`;
    document.getElementById('copyPix')?.addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(code);showToast('Código PIX copiado.');}
      catch{const field=document.getElementById('pixCopyCode');field.focus();field.select();showToast('Selecione e copie o código acima.');}
    });
    document.getElementById('checkPix').onclick=async e=>{
      const b=e.currentTarget;b.disabled=true;
      const id=pixCharge.pagamento_id,userId=session?.user?.id;
      try{
        const result=await paymentRequest({action:'status',pagamento_id:id});
        if(session?.user?.id!==userId || pixCharge?.pagamento_id!==id) return;
        if(result.paid) return await paymentConfirmed();
        const status=document.getElementById('pixPaymentStatus');
        if(status) status.textContent='O recebimento ainda não foi confirmado pelo Asaas. Aguarde alguns instantes.';
      }catch(error){showToast(error.message,'error');}finally{b.disabled=false;}
    };
    pollPixPayment(pixCharge.pagamento_id, session?.user?.id);
  }
  function pollPixPayment(id,userId,attempt=0){
    clearTimeout(pixPollTimer);
    if(attempt>=75) return;
    pixPollTimer=setTimeout(async()=>{
      if(activeTab!=='mensalidade' || pixCharge?.pagamento_id!==id || session?.user?.id!==userId) return;
      try{
        const {data,error}=await sb.from('pagamentos').select('status').eq('id',id).maybeSingle();
        if(activeTab!=='mensalidade' || pixCharge?.pagamento_id!==id || session?.user?.id!==userId) return;
        if(!error && data?.status==='CONFIRMADO') return await paymentConfirmed();
      }catch{}
      pollPixPayment(id,userId,attempt+1);
    },8000);
  }
  function bindBilling(){
    const form=document.getElementById('chargeForm');
    if(form) form.onsubmit=async e=>{
      e.preventDefault();const button=document.getElementById('charge');button.disabled=true;button.textContent='Preparando PIX...';
      const userId=session?.user?.id;
      try{
        const out=await paymentRequest({action:'create',cpf_cnpj:new FormData(form).get('cpf_cnpj')});
        if(session?.user?.id!==userId) return;
        if(out.paid) return await paymentConfirmed();
        if(out.already_active){showToast('Sua mensalidade já está em dia.');return await loadDashboard();}
        pixCharge=out;form.reset();renderPixCharge();
      }catch(error){showToast(error.message,'error');}
      finally{button.disabled=false;button.textContent='Gerar PIX de R$49,90';}
    };
    if(pixCharge && form) renderPixCharge();
  }
  function refView(u){const link=`${location.origin}${location.pathname}?ref=${encodeURIComponent(u.codigo_indicacao)}`;return `<section class="section grid grid-2"><div class="card"><h2>Seu código</h2><div class="codebox"><code>${esc(u.codigo_indicacao)}</code><button class="btn btn-secondary" data-copy="${esc(u.codigo_indicacao)}">Copiar</button></div><p class="muted small">Genealogia permanente. Avanço no tabuleiro não altera patrocinador.</p></div><div class="card"><h2>Seu link</h2><div class="codebox"><code style="font-size:12px;word-break:break-all">${esc(link)}</code><button class="btn btn-secondary" data-copy="${esc(link)}">Copiar</button></div><p>Indicações diretas: <strong>${dashboard.indicacoes_diretas||0}</strong></p></div></section>`}
  function bindRef(){document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{await navigator.clipboard.writeText(b.dataset.copy);showToast('Copiado!')})}
  function pixView(){const saques=dashboard.saques||[];return `<section class="section grid grid-2"><div class="card"><h2>Chave PIX</h2><form id="pixForm" class="grid"><div class="field"><label>Tipo</label><select name="tipo"><option>CPF</option><option>CNPJ</option><option>EMAIL</option><option>TELEFONE</option><option>ALEATORIA</option></select></div><div class="field"><label>Chave</label><input name="chave" required></div><button class="btn btn-primary">Salvar chave ativa</button></form><div id="pixCurrent" class="small muted" style="margin-top:12px"></div></div><div class="card"><h2>Solicitar saque</h2><form id="withdrawForm" class="grid"><div class="field"><label>Valor (R$)</label><input name="valor" type="number" step="0.01" min="0.01" required></div><button class="btn btn-primary">Solicitar</button></form><p class="muted small">O valor sai do saldo disponível e fica bloqueado até o PSP confirmar ou falhar.</p></div></section><section class="section card"><h2>Últimos saques</h2>${saques.length?`<div class="table-wrap"><table><thead><tr><th>Data</th><th>Valor</th><th>Status</th></tr></thead><tbody>${saques.map(s=>`<tr><td>${dt(s.solicitado_em)}</td><td>${money(s.valor)}</td><td><span class="badge ${statusClass(s.status)}">${esc(s.status)}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Nenhum saque solicitado.</div>'}</section>`}
  async function getActivePix(){const {data,error}=await sb.from('chaves_pix').select('id,tipo,chave,ativa').eq('ativa',true).maybeSingle();if(error)throw error;return data}
  function bindPix(){const cur=document.getElementById('pixCurrent');getActivePix().then(p=>cur.textContent=p?`Ativa: ${p.tipo} · ${p.chave}`:'Nenhuma chave ativa').catch(()=>{});document.getElementById('pixForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await rpc('cadastrar_chave_pix',{p_tipo:f.get('tipo'),p_chave:f.get('chave')});showToast('Chave PIX salva');await loadDashboard()}catch(err){showToast(err.message,'error')}};document.getElementById('withdrawForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{const p=await getActivePix();if(!p)throw new Error('Cadastre uma chave PIX ativa primeiro');await rpc('solicitar_saque',{p_valor:Number(f.get('valor')),p_chave_pix_id:p.id,p_chave_idempotencia:crypto.randomUUID()});showToast('Saque solicitado');await loadDashboard()}catch(err){showToast(err.message,'error')}}}
  function adminView(){const a=adminData,u=a.usuarios||{},f=a.financeiro||{};return `<section class="section"><div class="card admin-accent"><div class="section-head"><h2>Administração</h2><span class="badge">Acesso restrito</span></div><div class="grid grid-4"><div class="stat"><div class="label">Usuários</div><div class="value">${u.total||0}</div></div><div class="stat"><div class="label">Ativos</div><div class="value">${u.ativos||0}</div></div><div class="stat"><div class="label">Inadimplentes</div><div class="value">${u.inadimplentes||0}</div></div><div class="stat"><div class="label">Saques pendentes</div><div class="value">${a.saques_pendentes||0}</div></div></div><div class="section grid grid-3"><div class="stat"><div class="label">Pool Tabuleiros</div><div class="value">${money(f.tabuleiros_disponivel)}</div><div class="small muted">Reservado: ${money(f.tabuleiros_reservado)}</div></div><div class="stat"><div class="label">Pool Unilevel</div><div class="value">${money(f.unilevel)}</div><div class="small muted">Reserva: ${money(f.reserva_unilevel)}</div></div><div class="stat"><div class="label">Fidelidade</div><div class="value">${money(f.fidelidade)}</div></div></div></div></section><section class="section card admin-accent"><h2>Correção auditada de patrocinador</h2><form id="sponsorFix" class="grid grid-3"><div class="field"><label>UUID do usuário</label><input name="usuario" required></div><div class="field"><label>UUID novo patrocinador</label><input name="pat" placeholder="vazio para remover"></div><div class="field"><label>Motivo</label><input name="motivo" required></div><button class="btn btn-primary">Aplicar correção</button></form><p class="small muted">Toda alteração gera histórico + auditoria administrativa.</p></section>`}
  function bindAdmin(){document.getElementById('sponsorFix').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await rpc('admin_corrigir_patrocinador',{p_usuario_id:f.get('usuario'),p_novo_patrocinador_id:f.get('pat')||null,p_motivo:f.get('motivo')});showToast('Patrocinador corrigido e auditado');adminData=await rpc('admin_dashboard');renderApp()}catch(err){showToast(err.message,'error')}}}
  boot();
})();
