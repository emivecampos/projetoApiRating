'use strict';

/* =========================================================
   Utilidades
   ========================================================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = { config: null, usuario: null, recargaAtual: null, pollTimer: null, ultimaConsulta: null };

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const vazio = (v) => v === null || v === undefined || v === '';
const v = (x) => (vazio(x) ? '—' : esc(x));
const arr = (x) => (Array.isArray(x) ? x : []);

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCentavos = (c) => fmtBRL.format((c || 0) / 100);
/** Aceita número (650) ou string com ponto decimal ("120000.00"). */
function brl(x) {
  if (vazio(x)) return '—';
  const n = typeof x === 'number' ? x : Number(String(x).replace(',', '.'));
  return Number.isFinite(n) ? fmtBRL.format(n) : esc(x);
}
/** 0.91 -> "91%" ; "28%" -> "28%" */
function pct(x) {
  if (vazio(x)) return '—';
  if (typeof x === 'number') return `${Math.round(x * 1000) / 10}%`.replace('.', ',');
  return esc(x);
}
/** "2023-11-10" -> "10/11/2023" */
function data(x) {
  if (vazio(x)) return '—';
  const m = String(x).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : esc(x);
}
function dataHoraSql(x) {
  if (!x) return '—';
  const d = new Date(String(x).replace(' ', 'T') + 'Z');
  return isNaN(d) ? esc(x) : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
const rotulo = (x) => (vazio(x) ? '—' : esc(String(x).replace(/_/g, ' ')));

/** Tom visual para textos de classificação. */
function tom(x) {
  const s = String(x ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!s) return '';
  if (/(MUITO ALTO|ALTO|CRITIC|PESSIM|RUIM|IRREGULAR|SUSPENS|CANCELAD|BAIXAD|INAPT|NULA|REPROV|^BAIXA$|^[DE]$)/.test(s)) return 'bad';
  if (/(MEDIO|MODERAD|REGULAR_PENDENTE|ATENCAO|^C$|PENDENTE)/.test(s)) return 'warn';
  if (/(BAIXO|OTIMO|BOM|EXCELENTE|ALTA|REGULAR|ATIVA|SEM_OCORRENCIAS|SEM OCORRENCIAS|NAO UTILIZADO|APROVADO|^A$|^B$)/.test(s)) return 'ok';
  return '';
}
const badge = (x, t = tom(x)) => (vazio(x) ? '—' : `<span class="badge ${t ? 'badge--' + t : ''}">${rotulo(x)}</span>`);

async function api(caminho, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(caminho, opts);
  let dados = null;
  try { dados = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    const e = new Error(dados?.erro || `Erro ${res.status}`);
    e.status = res.status;
    e.dados = dados;
    if (res.status === 401 && state.usuario && !caminho.startsWith('/api/login')) mostrarAuth();
    throw e;
  }
  return dados;
}

let toastTimer;
function toast(msg, ruim = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (ruim ? ' bad' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

/* =========================================================
   Inicialização / navegação
   ========================================================= */
async function iniciar() {
  state.config = await api('/api/config');
  const c = state.config;
  document.title = c.nomeSistema;
  $('#brand-nome').textContent = c.nomeSistema;
  $('#preco-auth').textContent = brlCentavos(c.precoConsultaCentavos);
  $('#preco-app').textContent = brlCentavos(c.precoConsultaCentavos);

  const avisos = [];
  if (c.ksiSimulado) avisos.push('API KSI em modo SIMULADO (dados fictícios)');
  if (c.pagamentoSimulado) avisos.push('pagamento PIX em modo SIMULADO');
  if (avisos.length) {
    $('#aviso-dev').textContent = 'Ambiente de teste: ' + avisos.join(' · ') + '.';
    $('#aviso-dev').hidden = false;
  }

  try {
    const { usuario } = await api('/api/me');
    mostrarApp(usuario);
  } catch {
    mostrarAuth();
  }
}

function mostrarAuth() {
  state.usuario = null;
  $('#view-auth').hidden = false;
  $('#view-app').hidden = true;
  $('#topbar-acoes').hidden = true;
}

function mostrarApp(usuario) {
  state.usuario = usuario;
  $('#view-auth').hidden = true;
  $('#view-app').hidden = false;
  $('#topbar-acoes').hidden = false;
  atualizarSaldo(usuario.saldoCentavos);
  carregarHistorico();
}

function atualizarSaldo(centavos) {
  if (state.usuario) state.usuario.saldoCentavos = centavos;
  const preco = state.config.precoConsultaCentavos;
  $('#saldo-topo').textContent = brlCentavos(centavos);
  $('#saldo-grande').textContent = brlCentavos(centavos);
  $('#consultas-disp').textContent = Math.floor(centavos / preco);
  const btn = $('#btn-consultar');
  if (centavos < preco) {
    btn.textContent = `Recarregar para consultar (${brlCentavos(preco)})`;
    btn.dataset.semSaldo = '1';
    $('#hint-saldo').textContent = `Seu saldo é insuficiente. Cada consulta custa ${brlCentavos(preco)}.`;
  } else {
    btn.textContent = `Consultar · ${brlCentavos(preco)}`;
    delete btn.dataset.semSaldo;
    $('#hint-saldo').textContent = 'O valor só é cobrado se o relatório for entregue.';
  }
}

/* =========================================================
   Login / cadastro
   ========================================================= */
$$('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    $('#form-login').hidden = tab.dataset.tab !== 'login';
    $('#form-cadastro').hidden = tab.dataset.tab !== 'cadastro';
  })
);

function ligarFormAuth(form, rota) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = $('[data-erro]', form);
    const btn = $('button[type=submit]', form);
    erro.textContent = '';
    btn.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      const { usuario } = await api(rota, { method: 'POST', body });
      form.reset();
      mostrarApp(usuario);
      if (rota === '/api/cadastro') abrirRecarga();
    } catch (err) {
      erro.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
ligarFormAuth($('#form-login'), '/api/login');
ligarFormAuth($('#form-cadastro'), '/api/cadastro');

$('#btn-sair').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* ignora */ }
  $('#resultado').innerHTML = '';
  mostrarAuth();
});

/* =========================================================
   Documento: máscara + detecção PF/PJ + validação
   ========================================================= */
const digitos = (s) => String(s).replace(/\D/g, '');
function cpfValido(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== +c[t]) return false;
  }
  return true;
}
function cnpjValido(c) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n) => {
    const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < n; i++) s += +c[i] * p[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === +c[12] && dv(13) === +c[13];
}
function mascarar(d) {
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d.slice(0, 14).replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

const inputDoc = $('#input-documento');
inputDoc.addEventListener('input', () => {
  const d = digitos(inputDoc.value).slice(0, 14);
  inputDoc.value = mascarar(d);
  const info = $('#tipo-detectado');
  info.className = 'tipo-detectado';
  if (d.length === 11) {
    const ok = cpfValido(d);
    info.textContent = ok ? '✓ Pessoa Física (CPF)' : 'CPF inválido — confira os dígitos';
    info.classList.add(ok ? 'ok' : 'bad');
  } else if (d.length === 14) {
    const ok = cnpjValido(d);
    info.textContent = ok ? '✓ Pessoa Jurídica (CNPJ)' : 'CNPJ inválido — confira os dígitos';
    info.classList.add(ok ? 'ok' : 'bad');
  } else {
    info.textContent = d.length ? `${d.length} dígitos — CPF tem 11, CNPJ tem 14` : 'Digite um CPF ou CNPJ';
  }
});

/* =========================================================
   Consulta
   ========================================================= */
$('#form-consulta').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const erro = $('[data-erro]', form);
  const btn = $('#btn-consultar');
  erro.textContent = '';

  if (btn.dataset.semSaldo) return abrirRecarga();

  const doc = digitos(inputDoc.value);
  if (!((doc.length === 11 && cpfValido(doc)) || (doc.length === 14 && cnpjValido(doc)))) {
    erro.textContent = 'Informe um CPF ou CNPJ válido.';
    return inputDoc.focus();
  }
  if (!$('#input-aceite').checked) {
    erro.textContent = 'Confirme a finalidade legítima da consulta.';
    return;
  }

  btn.disabled = true;
  $('#carregando').hidden = false;
  $('#resultado').innerHTML = '';
  $('#carregando').scrollIntoView({ behavior: 'smooth', block: 'center' });

  try {
    const { consulta, saldoCentavos } = await api('/api/consultas', { method: 'POST', body: { documento: doc, aceite: true } });
    atualizarSaldo(saldoCentavos);
    exibirRelatorio(consulta);
    inputDoc.value = '';
    inputDoc.dispatchEvent(new Event('input'));
    toast('Consulta concluída.');
  } catch (err) {
    if (err.dados?.saldoCentavos !== undefined) atualizarSaldo(err.dados.saldoCentavos);
    if (err.dados?.codigo === 'SALDO_INSUFICIENTE') {
      erro.textContent = err.message;
      abrirRecarga();
    } else {
      $('#resultado').innerHTML = `<div class="erro-box"><strong>Não foi possível concluir a consulta.</strong><br>${esc(err.message)}${
        err.dados?.logQuery ? `<br><small>Protocolo: ${esc(err.dados.logQuery)}</small>` : ''
      }</div>`;
    }
  } finally {
    btn.disabled = false;
    $('#carregando').hidden = true;
    carregarHistorico();
  }
});

/* =========================================================
   Histórico / extrato
   ========================================================= */
async function carregarHistorico() {
  const el = $('#historico');
  try {
    const { itens } = await api('/api/consultas');
    if (!itens.length) {
      el.innerHTML = '<p class="vazio">Nenhuma consulta ainda.</p>';
      return;
    }
    el.innerHTML = `<table>
      <thead><tr><th>Data</th><th>Documento</th><th>Nome</th><th>Risco</th><th>Status</th><th class="num">Valor</th></tr></thead>
      <tbody>${itens
        .map((c) => {
          const status =
            c.status === 'concluida' ? badge('Concluída', 'ok') : c.status === 'falhou' ? badge('Estornada', 'bad') : badge('Processando', 'warn');
          const clicavel = c.status === 'concluida' && c.disponivel;
          return `<tr class="${clicavel ? 'linha-click' : ''}" ${clicavel ? `data-id="${c.id}" title="Abrir relatório"` : ''}>
            <td>${dataHoraSql(c.criado_em)}</td>
            <td><code>${v(c.documento_mascarado)}</code> <small class="muted">${c.tipo_pessoa === '0' ? 'PF' : 'PJ'}</small></td>
            <td>${v(c.nome_consultado)}</td>
            <td>${c.classificacao_risco ? badge(c.classificacao_risco) : '—'}</td>
            <td>${status}${c.status === 'concluida' && !c.disponivel ? ' <small class="muted">expirado</small>' : ''}</td>
            <td class="num">${c.status === 'falhou' ? '<s>' + brlCentavos(c.valor_centavos) + '</s>' : brlCentavos(c.valor_centavos)}</td>
          </tr>`;
        })
        .join('')}</tbody></table>`;
  } catch (err) {
    el.innerHTML = `<p class="vazio">${esc(err.message)}</p>`;
  }
}

$('#historico').addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  try {
    const { consulta } = await api(`/api/consultas/${tr.dataset.id}`);
    exibirRelatorio(consulta);
  } catch (err) {
    toast(err.message, true);
  }
});
$('#btn-atualizar-hist').addEventListener('click', carregarHistorico);

$('#btn-extrato').addEventListener('click', async () => {
  const dlg = $('#dlg-extrato');
  $('#extrato').innerHTML = '<p class="vazio">Carregando…</p>';
  dlg.showModal();
  try {
    const { itens } = await api('/api/extrato');
    $('#extrato').innerHTML = itens.length
      ? `<table><thead><tr><th>Data</th><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>${itens
          .map(
            (m) => `<tr><td>${dataHoraSql(m.criado_em)}</td><td>${esc(m.descricao)}</td>
            <td class="num" style="color:var(--${m.valor_centavos >= 0 ? 'ok' : 'bad'})">${m.valor_centavos >= 0 ? '+' : '−'} ${brlCentavos(Math.abs(m.valor_centavos))}</td></tr>`
          )
          .join('')}</tbody></table>`
      : '<p class="vazio">Sem movimentações.</p>';
  } catch (err) {
    $('#extrato').innerHTML = `<p class="vazio">${esc(err.message)}</p>`;
  }
});

/* =========================================================
   Recarga PIX
   ========================================================= */
const VALORES_RAPIDOS = [20, 50, 100, 200, 500, 1000];

function abrirRecarga() {
  const c = state.config;
  const preco = c.precoConsultaCentavos;
  const min = c.recargaMinCentavos / 100;
  const max = c.recargaMaxCentavos / 100;
  const valores = VALORES_RAPIDOS.filter((x) => x >= min && x <= max);

  $('#valores-rapidos').innerHTML = valores
    .map((x) => `<button type="button" class="valor-btn" data-valor="${x}">${fmtBRL.format(x)}<small>${Math.floor((x * 100) / preco)} consulta(s)</small></button>`)
    .join('');
  $('#input-valor').min = min;
  $('#input-valor').max = max;
  $('#input-valor').value = '';
  $('#recarga-limites').textContent = `Mínimo ${fmtBRL.format(min)} · máximo ${fmtBRL.format(max)}`;
  $('#recarga-erro').textContent = '';
  const padrao = valores.find((x) => x * 100 >= preco * 2) ?? valores[0];
  if (padrao) selecionarValor(padrao);

  mostrarPasso(1);
  $('#dlg-recarga').showModal();
}

function selecionarValor(x) {
  $('#input-valor').value = x;
  $$('.valor-btn').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.valor) === Number(x)));
}

function mostrarPasso(n) {
  [1, 2, 3].forEach((i) => ($(`#recarga-passo${i}`).hidden = i !== n));
}

$('#valores-rapidos').addEventListener('click', (e) => {
  const b = e.target.closest('.valor-btn');
  if (b) selecionarValor(b.dataset.valor);
});
$('#input-valor').addEventListener('input', (e) => selecionarValor(e.target.value));
$('#btn-recarregar').addEventListener('click', abrirRecarga);
$('#btn-recarregar-topo').addEventListener('click', abrirRecarga);

$('#btn-gerar-pix').addEventListener('click', async () => {
  const btn = $('#btn-gerar-pix');
  const valor = Number($('#input-valor').value);
  $('#recarga-erro').textContent = '';
  btn.disabled = true;
  btn.textContent = 'Gerando PIX…';
  try {
    const { recarga } = await api('/api/recargas', { method: 'POST', body: { valor } });
    state.recargaAtual = recarga;
    exibirPix(recarga);
    iniciarPolling();
  } catch (err) {
    $('#recarga-erro').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Gerar PIX';
  }
});

function exibirPix(r) {
  $('#pix-valor').textContent = brlCentavos(r.valorCentavos);
  $('#pix-qr').innerHTML = r.pixQrBase64
    ? `<img alt="QR Code PIX" src="data:image/png;base64,${esc(r.pixQrBase64)}">`
    : '<div class="pix__qr-sim">QR Code simulado<br>(modo de teste)</div>';
  $('#pix-copia').value = r.pixCopiaCola || '';
  $('#pix-expira').textContent = r.expiraEm ? `Válido até ${new Date(r.expiraEm).toLocaleTimeString('pt-BR', { timeStyle: 'short' })}` : '';
  $('#pix-status').innerHTML = '<span class="dot"></span> Aguardando pagamento…';
  $('#btn-simular').hidden = !r.simulado;
  mostrarPasso(2);
}

$('#btn-copiar').addEventListener('click', async () => {
  const txt = $('#pix-copia').value;
  try {
    await navigator.clipboard.writeText(txt);
  } catch {
    $('#pix-copia').select();
    document.execCommand('copy');
  }
  toast('Código PIX copiado.');
});

$('#btn-simular').addEventListener('click', async () => {
  if (!state.recargaAtual) return;
  try {
    await api(`/api/recargas/${state.recargaAtual.id}/simular-pagamento`, { method: 'POST' });
    verificarRecarga();
  } catch (err) {
    toast(err.message, true);
  }
});

function iniciarPolling() {
  pararPolling();
  state.pollTimer = setInterval(verificarRecarga, 4000);
}
function pararPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function verificarRecarga() {
  const r = state.recargaAtual;
  if (!r) return pararPolling();
  try {
    const { recarga, saldoCentavos } = await api(`/api/recargas/${r.id}`);
    if (recarga.status === 'aprovada') {
      pararPolling();
      state.recargaAtual = null;
      atualizarSaldo(saldoCentavos);
      $('#recarga-sucesso-txt').textContent = `${brlCentavos(recarga.valorCentavos)} adicionados. Novo saldo: ${brlCentavos(saldoCentavos)}.`;
      mostrarPasso(3);
      if (!$('#dlg-recarga').open) toast('Recarga confirmada! Saldo atualizado.');
    } else if (recarga.status === 'expirada' || recarga.status === 'cancelada') {
      pararPolling();
      state.recargaAtual = null;
      $('#pix-status').textContent = recarga.status === 'expirada' ? 'PIX expirado. Gere um novo.' : 'Pagamento cancelado.';
    }
  } catch {
    /* tenta de novo no próximo ciclo */
  }
}

// Fechar dialogs (o polling continua em segundo plano se houver PIX pendente)
$$('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-fechar]') || e.target === dlg) {
      dlg.close();
      if (dlg.id === 'dlg-recarga' && !$('#recarga-passo3').hidden) inputDoc.focus();
    }
  });
});

/* =========================================================
   Relatório
   ========================================================= */
function kv(pares) {
  const itens = pares.filter(([, val]) => val !== undefined);
  if (!itens.length) return '<p class="vazio">Sem informações.</p>';
  return `<dl class="kv">${itens.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${val}</dd></div>`).join('')}</dl>`;
}

function tabela(colunas, linhas, msgVazia = 'Nenhum registro encontrado.') {
  if (!linhas.length) return `<p class="vazio">${esc(msgVazia)}</p>`;
  return `<div class="tabela-wrap"><table><thead><tr>${colunas
    .map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.t)}</th>`)
    .join('')}</tr></thead><tbody>${linhas
    .map((l) => `<tr>${colunas.map((c) => `<td class="${c.num ? 'num' : ''}">${c.f(l)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

function secao(titulo, corpo, { badgeHtml = '', aberta = true } = {}) {
  return `<details class="secao" ${aberta ? 'open' : ''}><summary>${esc(titulo)}${badgeHtml}</summary><div class="secao__corpo">${corpo}</div></details>`;
}

const qtdBadge = (n) => {
  const q = Number(n) || 0;
  return `<span class="badge ${q > 0 ? 'badge--bad' : 'badge--ok'}">${q > 0 ? q + ' ocorrência(s)' : 'Nada consta'}</span>`;
};

function kpi(label, valorHtml, { t = '', sub = '', barra = null } = {}) {
  return `<div class="kpi"><div class="kpi__label">${esc(label)}</div><div class="kpi__valor ${t}">${valorHtml}</div>${
    sub ? `<div class="kpi__sub">${sub}</div>` : ''
  }${barra !== null ? `<div class="barra ${t}"><span style="width:${Math.max(0, Math.min(100, barra))}%"></span></div>` : ''}</div>`;
}

function listaSimples(itens) {
  const l = arr(itens).filter((x) => !vazio(x));
  return l.length ? `<ul class="lista-simples">${l.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '—';
}

function blocoEnderecos(enderecos) {
  return tabela(
    [
      { t: 'Logradouro', f: (e) => `${v(e.logradouro)}${e.numero ? ', ' + esc(e.numero) : ''}${e.complemento ? ' — ' + esc(e.complemento) : ''}` },
      { t: 'Bairro', f: (e) => v(e.bairro) },
      { t: 'Cidade/UF', f: (e) => `${v(e.cidade)}${e.uf ? '/' + esc(e.uf) : ''}` },
      { t: 'CEP', f: (e) => v(e.cep) },
    ],
    arr(enderecos),
    'Nenhum endereço.'
  );
}

function blocoCadastral(cad, pf) {
  if (!cad || typeof cad !== 'object') return '<p class="vazio">Dados cadastrais não retornados.</p>';
  const basicos = pf
    ? [
        ['Nome', v(cad.nome)],
        ['Documento', v(cad.documento)],
        ['Data de nascimento', data(cad.dataNascimento)],
        ['Faixa etária', rotulo(cad.faixa)],
        ['Nome da mãe', v(cad.nomeDaMae)],
        ['RG', v(cad.rg)],
        ['Situação do CPF', badge(cad.situacaoCpf)],
        ['Classe social', v(cad.classeSocial)],
        ['Cliente premium', v(cad.clientePremium)],
      ]
    : [
        ['Razão social', v(cad.nome)],
        ['CNPJ', v(cad.documento)],
        ['Data de abertura', data(cad.dataNascimento)],
        ['Situação', badge(cad.situacao)],
        ['Porte', rotulo(cad.porte)],
        ['Atividade principal', v(cad.atividadePrincipal)],
        ['Capital social', brl(cad.capitalSocial)],
        ['Faturamento presumido', brl(cad.faturamentoPresumido)],
      ];
  const financeiro = [
    ['Score', v(cad.score)],
    ['Pontualidade de pagamento', pct(cad.pontualidadeDePagamento)],
    ['Limite de crédito sugerido', brl(cad.limiteDeCredito)],
    [pf ? 'Renda estimada' : 'Renda/receita estimada', brl(cad.rendaEstimada)],
  ];

  let html = kv(basicos);
  html += `<div class="sub">Indicadores cadastrais</div>${kv(financeiro)}`;
  html += `<div class="sub">Contatos</div>${kv([
    ['E-mails', listaSimples(cad.emails)],
    ['Telefones', listaSimples(cad.telefones)],
  ])}`;
  html += `<div class="sub">Endereços (${arr(cad.enderecos).length})</div>${blocoEnderecos(cad.enderecos)}`;

  if (pf) {
    html += `<div class="sub">Participações societárias (${arr(cad.participacoesSocietaria).length})</div>${tabela(
      [
        { t: 'CNPJ', f: (p) => v(p.cnpj) },
        { t: 'Razão social', f: (p) => v(p.razaoSocial) },
        { t: 'Posição', f: (p) => v(p.posicao) },
        { t: 'Situação', f: (p) => badge(p.situacao) },
      ],
      arr(cad.participacoesSocietaria),
      'Nenhuma participação societária.'
    )}`;
    html += `<div class="sub">Pessoas de contato (${arr(cad.pessoasContatos).length})</div>${tabela(
      [
        { t: 'Nome', f: (p) => v(p.nome) },
        { t: 'Documento', f: (p) => v(p.documento) },
        { t: 'Descrição', f: (p) => v(p.descricaos) },
      ],
      arr(cad.pessoasContatos),
      'Nenhuma pessoa de contato.'
    )}`;
  } else {
    html += `<div class="sub">Quadro societário (${arr(cad.quadroSociatario).length})</div>${tabela(
      [
        { t: 'Nome', f: (p) => v(p.nome) },
        { t: 'Documento', f: (p) => v(p.documento) },
        { t: 'Qualificação', f: (p) => v(p.descricaos) },
      ],
      arr(cad.quadroSociatario),
      'Quadro societário não informado.'
    )}`;
  }
  return html;
}

const colsApontamento = [
  { t: 'Data', f: (r) => data(r.data) },
  { t: 'Contrato', f: (r) => v(r.contrato) },
  { t: 'Informante', f: (r) => v(r.informante) },
  { t: 'Valor', num: true, f: (r) => brl(r.valor) },
];

function blocoOperacoes(ops) {
  return tabela(
    [
      { t: 'Modalidade', f: (o) => `${v(o.modalidade?.descricao)}<br><small class="muted">${v(o.subModalidade?.descricao)}</small>` },
      { t: 'Var. cambial', f: (o) => v(o.variacaoCambial) },
      { t: 'Total', num: true, f: (o) => brl(o.total ?? o.total1) },
      { t: '%', num: true, f: (o) => v(o.percentual) },
      {
        t: 'Vencimentos',
        f: (o) =>
          arr(o.vencimentos).length
            ? arr(o.vencimentos)
                .map(
                  (vc) =>
                    `${v(vc.descricao)}: <b>${brl(vc.valor ?? vc.valor1)}</b> (${v(vc.percentual)})${
                      vc.qtdMeses ? ` · ${esc(vc.qtdMeses)} mês(es)` : ''
                    }${String(vc.restritivo).toUpperCase() === 'SIM' ? ' ' + badge('Restritivo', 'bad') : ''}`
                )
                .join('<br>')
            : '—',
      },
    ],
    arr(ops),
    'Nenhuma operação.'
  );
}

function blocoScr(scr) {
  if (!scr || typeof scr !== 'object') return '<p class="vazio">Dados do SCR não retornados.</p>';
  const cart = scr.carteiraCredito || {};
  let html = kv([
    ['Data-base consultada', v(scr.databaseConsultada)],
    ['Início de relacionamento', data(scr.dataInicioRelacionamento)],
    ['Instituições', v(scr.quantidadeInstituicoes)],
    ['Operações', v(scr.quantidadeOperacoes)],
    ['Operações em discordância', v(scr.quantidadeOperacoesDiscordancia)],
    ['Operações sub judice', v(scr.quantidadeOperacoesSubjudice)],
    ['Score SCR', scr.score ? `${v(scr.score.pontuacao)} ${badge(scr.score.faixa)}` : '—'],
    ['Score SCR (2)', scr.score1 ? `${v(scr.score1.pontuacao)} ${badge(scr.score1.faixa)}` : '—'],
  ]);
  html += `<div class="sub">Carteira de crédito</div>${kv([
    ['Crédito a vencer', brl(cart.creditoAvencer)],
    ['Crédito vencido', Number(cart.creditoVencido) > 0 ? `<span style="color:var(--bad)">${brl(cart.creditoVencido)}</span>` : brl(cart.creditoVencido)],
    ['Prejuízo', Number(cart.prejuizo) > 0 ? `<span style="color:var(--bad)">${brl(cart.prejuizo)}</span>` : brl(cart.prejuizo)],
    ['Limite de crédito', brl(cart.limiteCredito)],
  ])}`;
  html += `<div class="sub">Operações (${arr(scr.operacoes).length})</div>${blocoOperacoes(scr.operacoes)}`;
  if (arr(scr.operacoes1).length) {
    html += `<div class="sub">Operações — detalhamento adicional (${arr(scr.operacoes1).length})</div>${blocoOperacoes(scr.operacoes1)}`;
  }
  return html;
}

function blocoInfoAdicionais(info) {
  info = info || {};
  const alertas = info.informacoesAlertasRestricoes || {};
  const passagens = info.passagensComerciais || {};
  const acoes = info.acoesCiveis || {};
  let html = `<div class="sub">Alertas e restrições ${qtdBadge(alertas.quantidadeOcorrencia ?? arr(alertas.ocorrencias).length)}</div>`;
  html += tabela(
    [
      { t: 'Tipo', f: (o) => `${v(o.descricaoTipoInformacao)}${o.codigoTipoInformacao ? ` <small class="muted">(${esc(o.codigoTipoInformacao)})</small>` : ''}` },
      { t: 'Título', f: (o) => v(o.titulo) },
      { t: 'Observações', f: (o) => v(o.observacoes) },
    ],
    arr(alertas.ocorrencias),
    alertas.statusRetorno?.descricao || 'Nenhum alerta.'
  );
  html += `<div class="sub">Passagens comerciais (consultas anteriores): ${esc(passagens.quantidadeOcorrencia ?? arr(passagens.ocorrencias).length)}</div>`;
  html += tabela(
    [
      { t: 'Data', f: (o) => `${data(o.dataConsulta)} ${v(o.horaConsulta)}` },
      { t: 'Empresa', f: (o) => v(o.clienteConsulta) },
      { t: 'Telefone', f: (o) => v(o.telefoneCliente) },
      { t: 'Cidade/UF', f: (o) => v(o.cidadeUfCliente) },
    ],
    arr(passagens.ocorrencias),
    'Nenhuma passagem registrada.'
  );
  html += `<div class="sub">Ações cíveis ${qtdBadge(acoes.quantidadeOcorrencia ?? arr(acoes.ocorrencias).length)}</div>`;
  html += tabela(
    [
      { t: 'Processo', f: (o) => `<code>${v(o.processo)}</code><br><small class="muted">Distribuído em ${data(o.dataDistribuicao)}</small>` },
      { t: 'Ação', f: (o) => v(o.acao) },
      { t: 'Autor', f: (o) => v(o.autor) },
      { t: 'Requerido', f: (o) => `${v(o.requerido)}<br><small class="muted">${v(o.documento)}</small>` },
      { t: 'Vara / Comarca', f: (o) => `${v(o.vara)}<br><small class="muted">${v(o.comarca)} · ${v(o.origem)}</small>` },
      { t: 'Valor', num: true, f: (o) => brl(o.valor) },
    ],
    arr(acoes.ocorrencias),
    'Nenhuma ação cível.'
  );
  return html;
}

function exibirRelatorio(consulta) {
  state.ultimaConsulta = consulta;
  const raiz = consulta.resultado || {};
  const r = raiz.relatorioRatingBancario?.relatorioRatingBancario || {};
  const pf = consulta.tipoPessoa === '0';
  const cad = (pf ? r.cadastraispf : r.cadastraispj) || {};
  const ia = r.relatorioIA || {};

  const qSerasa = Number(r.quantidadeSerasa ?? arr(r.registrosSerasa).length) || 0;
  const qSpc = Number(r.quantidadeSPC ?? arr(r.registrosSPC).length) || 0;
  const qBv = Number(r.quantidadeBoaVista ?? arr(r.registrosBoaVista).length) || 0;
  const qCh = Number(r.quantidadeChSemFundos ?? arr(r.registrosChSemFundos).length) || 0;
  const qProt = Number(r.qntProtesto ?? arr(r.registrosProtesto).length) || 0;
  const qAcoes = Number(r.informacoesAdicionais?.acoesCiveis?.quantidadeOcorrencia ?? 0) || 0;

  const somaValores = (lista) => arr(lista).reduce((s, x) => s + (Number(x.valor) || 0), 0);

  const alerta = (n, label, valor) =>
    `<div class="alerta ${n > 0 ? 'alerta--bad' : 'alerta--ok'}"><b>${n > 0 ? n : '✓'}</b><span>${esc(label)}${
      n > 0 && valor ? ' · ' + brl(valor) : n > 0 ? '' : ' — nada consta'
    }</span></div>`;

  const capPct = typeof r.capacidadePagemento === 'number' ? r.capacidadePagemento * 100 : null;
  const riscoPct = typeof r.indiceRisco === 'number' ? r.indiceRisco * 100 : null;
  const finPct = typeof r.indiceFinanceiro === 'number' ? r.indiceFinanceiro * 100 : null;
  const tomCap = capPct === null ? '' : capPct >= 70 ? 'ok' : capPct >= 40 ? 'warn' : 'bad';
  const tomRisco = riscoPct === null ? tom(r.risco) : riscoPct <= 30 ? 'ok' : riscoPct <= 60 ? 'warn' : 'bad';
  const tomFin = finPct === null ? '' : finPct >= 70 ? 'ok' : finPct >= 40 ? 'warn' : 'bad';

  const html = `
  <article class="relatorio" id="relatorio">
    <header class="rel-head">
      <div class="rel-head__id">
        <div class="rel-head__eyebrow">Rating Bancário · ${pf ? 'Pessoa Física' : 'Pessoa Jurídica'}</div>
        <h2>${v(cad.nome)}</h2>
        <div class="rel-head__meta">${v(cad.documento || consulta.documentoMascarado)} · Consultado em ${dataHoraSql(consulta.criadoEm)}${
    consulta.logQuery ? ` · Protocolo ${esc(consulta.logQuery)}` : ''
  }</div>
      </div>
      <div class="rel-head__acoes">
        <button class="btn btn--ghost btn--sm" type="button" data-acao="imprimir">Imprimir / PDF</button>
        <button class="btn btn--ghost btn--sm" type="button" data-acao="fechar">Fechar</button>
      </div>
    </header>
    <div class="rel-body">
      <div class="kpis">
        ${kpi('Classificação de risco', badge(r.classificacaoRisco), { sub: `Risco: ${rotulo(r.risco)}` })}
        ${kpi('Índice de risco', pct(r.indiceRisco), { t: tomRisco, barra: riscoPct, sub: 'Quanto menor, melhor' })}
        ${kpi('Capacidade de pagamento', pct(r.capacidadePagemento), { t: tomCap, barra: capPct })}
        ${kpi('Índice financeiro', pct(r.indiceFinanceiro), { t: tomFin, barra: finPct, sub: `Classe financeira: ${v(r.classificacaoFinanceira)}` })}
        ${kpi('Score', v(cad.score), { sub: `Pontualidade: ${pct(cad.pontualidadeDePagamento)}` })}
        ${kpi('Comprometimento de renda', pct(r.comprometimentoRenda))}
      </div>

      ${
        ia.analiseAiConsultado || ia.analiseAi
          ? `<div class="ia"><span class="ia__tag">IA</span><div><strong>Análise por IA</strong> ${
              ia.aprovado === true ? badge('Aprovado', 'ok') : ia.aprovado === false ? badge('Não aprovado', 'bad') : ''
            }<p>${v(ia.analiseAi)}</p></div></div>`
          : ''
      }

      <div class="resumo-alertas">
        ${alerta(qSerasa, 'Serasa', somaValores(r.registrosSerasa))}
        ${alerta(qSpc, 'SPC', somaValores(r.registrosSPC))}
        ${alerta(qBv, 'Boa Vista', somaValores(r.registrosBoaVista))}
        ${alerta(qCh, 'Cheques sem fundo')}
        ${alerta(qProt, 'Protestos', r.valorTotalProtesto)}
        ${alerta(qAcoes, 'Ações cíveis')}
      </div>

      ${secao(
        'Indicadores de crédito',
        kv([
          ['Classificação de risco', badge(r.classificacaoRisco)],
          ['Risco', badge(r.risco)],
          ['Endividamento financeiro', badge(r.endividamentoFinanceiro)],
          ['Crédito emergencial', badge(r.creditoEmergencial)],
          ['Relacionamento com o mercado', badge(r.relacionamentoMercado)],
          ['Recuperação judicial / falência', badge(r.recuperacaoFalencia)],
          ['Comprometimento de renda', pct(r.comprometimentoRenda)],
          ['Classificação financeira', v(r.classificacaoFinanceira)],
          [
            'Restrições sintéticas',
            r.contemRestricoesSinteticas
              ? `${v(r.qntRestricoesSinteticas)} · ${brl(r.valorTotalRestricoesSinteticas)}`
              : r.contemRestricoesSinteticas === false
              ? badge('Nada consta', 'ok')
              : '—',
          ],
        ])
      )}

      ${secao(pf ? 'Dados cadastrais (PF)' : 'Dados cadastrais (PJ)', blocoCadastral(cad, pf))}

      ${secao('Serasa', tabela(colsApontamento, arr(r.registrosSerasa)), { badgeHtml: qtdBadge(qSerasa) })}
      ${secao('SPC', tabela(colsApontamento, arr(r.registrosSPC)), { badgeHtml: qtdBadge(qSpc) })}
      ${secao('Boa Vista', tabela(colsApontamento, arr(r.registrosBoaVista)), { badgeHtml: qtdBadge(qBv) })}
      ${secao(
        'Cheques sem fundo',
        tabela(
          [
            { t: 'Banco', f: (c) => `${v(c.nomeBanco)} <small class="muted">(${v(c.nBanco)})</small>` },
            { t: 'Agência', f: (c) => v(c.agencia) },
            { t: 'Quantidade', num: true, f: (c) => v(c.quantidade) },
          ],
          arr(r.registrosChSemFundos)
        ),
        { badgeHtml: qtdBadge(qCh) }
      )}
      ${secao(
        'Protestos',
        (qProt ? `<p>Total protestado: <b>${brl(r.valorTotalProtesto)}</b></p>` : '') +
          tabela(
            [
              { t: 'Data', f: (p) => data(p.data) },
              { t: 'Cartório', f: (p) => v(p.cartorio) },
              { t: 'Endereço', f: (p) => v(p.endereco) },
              { t: 'Município', f: (p) => v(p.municipio) },
              { t: 'Valor', num: true, f: (p) => brl(p.valor) },
            ],
            arr(r.registrosProtesto)
          ),
        { badgeHtml: qtdBadge(qProt) }
      )}
      ${secao('SCR — Sistema de Informações de Crédito (Bacen)', blocoScr(r.registroScr))}
      ${secao('Informações adicionais', blocoInfoAdicionais(r.informacoesAdicionais))}
      <div class="json-secao">${secao('Resposta completa (JSON)', `<pre class="json-bruto">${esc(JSON.stringify(raiz, null, 2))}</pre>`, { aberta: false })}</div>
    </div>
  </article>`;

  $('#resultado').innerHTML = html;
  $('#relatorio').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#resultado').addEventListener('click', (e) => {
  const acao = e.target.closest('[data-acao]')?.dataset.acao;
  if (acao === 'imprimir') window.print();
  if (acao === 'fechar') $('#resultado').innerHTML = '';
});

// Abre todas as seções ao imprimir
let secoesFechadas = [];
window.addEventListener('beforeprint', () => {
  secoesFechadas = $$('#relatorio details.secao:not([open])');
  secoesFechadas.forEach((d) => d.closest('.json-secao') || d.setAttribute('open', ''));
});
window.addEventListener('afterprint', () => secoesFechadas.forEach((d) => d.removeAttribute('open')));

iniciar().catch((e) => {
  document.body.insertAdjacentHTML('afterbegin', `<div class="erro-box">Falha ao carregar o sistema: ${esc(e.message)}</div>`);
});
