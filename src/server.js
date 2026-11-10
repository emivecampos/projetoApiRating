import path from 'node:path';
import express from 'express';
import { config, RAIZ } from './config.js';
import { db, tx, lancar } from './db.js';
import { hashSenha, verificarSenha, criarSessao, encerrarSessao, exigirLogin, limitador } from './auth.js';
import { somenteDigitos, cpfValido, cnpjValido, mascararDocumento, emailValido } from './validacao.js';
import { consultarRatingBancario, ErroKsi } from './ksi.js';
import {
  criarRecarga,
  obterRecarga,
  aprovarRecarga,
  sincronizarComProvedor,
  processarWebhook,
  expirarRecargasVencidas,
} from './pagamentos.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Cabeçalhos de segurança
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

app.use(express.json({ limit: '20kb' }));

// Proteção CSRF: toda escrita na API precisa ser JSON (formulários de outros sites não conseguem enviar)
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && !req.path.startsWith('/webhooks/') && !req.is('application/json')) {
    return res.status(415).json({ erro: 'Content-Type deve ser application/json.' });
  }
  next();
});

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const usuarioPublico = (u) => ({ id: u.id, nome: u.nome, email: u.email, saldoCentavos: u.saldo_centavos });

// ---------------- Config pública ----------------
app.get('/api/config', (req, res) => {
  res.json({
    nomeSistema: config.nomeSistema,
    precoConsultaCentavos: config.precoConsultaCentavos,
    recargaMinCentavos: config.recargaMinCentavos,
    recargaMaxCentavos: config.recargaMaxCentavos,
    pagamentoSimulado: config.pagamento.modo === 'simulado',
    ksiSimulado: config.ksi.modo === 'simulado',
    retencaoDias: config.retencaoDias,
  });
});

// ---------------- Conta ----------------
const limiteAuth = limitador({ janelaMs: 15 * 60000, max: 10 });

app.post('/api/cadastro', limiteAuth, (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  if (nome.length < 2) return res.status(400).json({ erro: 'Informe seu nome.' });
  if (!emailValido(email)) return res.status(400).json({ erro: 'E-mail inválido.' });
  if (senha.length < 8) return res.status(400).json({ erro: 'A senha deve ter pelo menos 8 caracteres.' });
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
    return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
  }
  const { lastInsertRowid } = db
    .prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
    .run(nome, email, hashSenha(senha));
  criarSessao(res, Number(lastInsertRowid));
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(lastInsertRowid);
  res.status(201).json({ usuario: usuarioPublico(u) });
});

app.post('/api/login', limiteAuth, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!u || !verificarSenha(senha, u.senha_hash)) {
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  }
  criarSessao(res, u.id);
  res.json({ usuario: usuarioPublico(u) });
});

app.post('/api/logout', (req, res) => {
  encerrarSessao(req, res);
  res.json({ ok: true });
});

app.get('/api/me', exigirLogin, (req, res) => res.json({ usuario: usuarioPublico(req.usuario) }));

app.get('/api/extrato', exigirLogin, (req, res) => {
  const itens = db
    .prepare(
      `SELECT id, tipo, valor_centavos, descricao, criado_em FROM movimentacoes
        WHERE usuario_id = ? ORDER BY id DESC LIMIT 50`
    )
    .all(req.usuario.id);
  res.json({ itens });
});

// ---------------- Recargas ----------------
app.post(
  '/api/recargas',
  exigirLogin,
  h(async (req, res) => {
    const valorCentavos = Math.round(Number(req.body?.valor) * 100);
    if (!Number.isFinite(valorCentavos) || valorCentavos < config.recargaMinCentavos || valorCentavos > config.recargaMaxCentavos) {
      return res.status(400).json({
        erro: `Valor deve estar entre R$ ${(config.recargaMinCentavos / 100).toFixed(2)} e R$ ${(config.recargaMaxCentavos / 100).toFixed(2)}.`,
      });
    }
    const recarga = await criarRecarga(req.usuario, valorCentavos);
    res.status(201).json({ recarga: recargaPublica(recarga) });
  })
);

app.get(
  '/api/recargas/:id',
  exigirLogin,
  h(async (req, res) => {
    let recarga = obterRecarga(req.params.id, req.usuario.id);
    if (!recarga) return res.status(404).json({ erro: 'Recarga não encontrada.' });
    if (recarga.status === 'pendente') {
      try {
        await sincronizarComProvedor(recarga);
      } catch (e) {
        console.warn('Falha ao sincronizar recarga', recarga.id, e.message);
      }
      expirarRecargasVencidas();
      recarga = obterRecarga(req.params.id, req.usuario.id);
    }
    const saldo = db.prepare('SELECT saldo_centavos FROM usuarios WHERE id = ?').get(req.usuario.id).saldo_centavos;
    res.json({ recarga: recargaPublica(recarga), saldoCentavos: saldo });
  })
);

// Apenas em PAGAMENTO_MODO=simulado (bloqueado em produção pelo config.js)
app.post('/api/recargas/:id/simular-pagamento', exigirLogin, (req, res) => {
  if (config.pagamento.modo !== 'simulado') return res.status(404).json({ erro: 'Não disponível.' });
  const recarga = obterRecarga(req.params.id, req.usuario.id);
  if (!recarga) return res.status(404).json({ erro: 'Recarga não encontrada.' });
  if (recarga.status !== 'pendente') return res.status(409).json({ erro: `Recarga ${recarga.status}.` });
  aprovarRecarga(recarga.id);
  res.json({ ok: true });
});

app.post(
  '/api/webhooks/mercadopago',
  h(async (req, res) => {
    try {
      await processarWebhook(req);
      res.sendStatus(200);
    } catch (e) {
      console.warn('Webhook Mercado Pago:', e.message);
      res.sendStatus(e.status || 500);
    }
  })
);

function recargaPublica(r) {
  return {
    id: r.id,
    valorCentavos: r.valor_centavos,
    status: r.status,
    pixCopiaCola: r.pix_copia_cola,
    pixQrBase64: r.pix_qr_base64,
    expiraEm: r.expira_em,
    simulado: r.provedor === 'simulado',
  };
}

// ---------------- Consultas ----------------
const consultasEmAndamento = new Set();

app.post(
  '/api/consultas',
  exigirLogin,
  h(async (req, res) => {
    const usuarioId = req.usuario.id;
    const documento = somenteDigitos(req.body?.documento);
    const tipoPessoa = documento.length === 11 ? '0' : documento.length === 14 ? '1' : null;

    if (req.body?.aceite !== true) {
      return res.status(400).json({ erro: 'Confirme a finalidade legítima da consulta (LGPD).' });
    }
    if (!tipoPessoa) return res.status(400).json({ erro: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).' });
    if (tipoPessoa === '0' && !cpfValido(documento)) return res.status(400).json({ erro: 'CPF inválido.' });
    if (tipoPessoa === '1' && !cnpjValido(documento)) return res.status(400).json({ erro: 'CNPJ inválido.' });
    if (consultasEmAndamento.has(usuarioId)) {
      return res.status(409).json({ erro: 'Já existe uma consulta em andamento. Aguarde a conclusão.' });
    }

    const preco = config.precoConsultaCentavos;
    const mascarado = mascararDocumento(documento);

    // 1) Reserva o valor (débito atômico) antes de chamar a API
    const consultaId = tx(() => {
        const { saldo_centavos } = db.prepare('SELECT saldo_centavos FROM usuarios WHERE id = ?').get(usuarioId);
        if (saldo_centavos < preco) return null;
        const { lastInsertRowid } = db
          .prepare(
            `INSERT INTO consultas (usuario_id, tipo_pessoa, documento_mascarado, valor_centavos, status)
             VALUES (?, ?, ?, ?, 'processando')`
          )
          .run(usuarioId, tipoPessoa, mascarado, preco);
        const id = Number(lastInsertRowid);
        lancar(usuarioId, 'consulta', -preco, `Consulta Rating Bancário — ${mascarado}`, String(id));
        return id;
      });
    if (!consultaId) {
      return res.status(402).json({ erro: 'Saldo insuficiente. Faça uma recarga para consultar.', codigo: 'SALDO_INSUFICIENTE' });
    }

    consultasEmAndamento.add(usuarioId);
    try {
      // 2) Chama a API KSI (síncrona)
      let resultado;
      try {
        resultado = await consultarRatingBancario(tipoPessoa, documento);
      } catch (e) {
        console.warn(`[consulta ${consultaId}] erro de comunicação com a KSI: ${e.name} ${e.message}`);
        const erro =
          e.name === 'TimeoutError'
            ? 'O serviço de consulta demorou demais para responder.'
            : e instanceof ErroKsi
            ? 'Serviço de consulta temporariamente indisponível.'
            : 'Não foi possível conectar ao serviço de consulta.';
        resultado = { ok: false, httpStatus: e.httpStatus ?? null, json: null, logQuery: null, erro };
      }

      // 3a) Falha: estorna integralmente
      if (!resultado.ok) {
        const motivo =
          resultado.erro ||
          (resultado.httpStatus === 200 && resultado.json?.baseDisponivel === false
            ? 'Base de dados indisponível no momento.'
            : `A consulta não pôde ser concluída (HTTP ${resultado.httpStatus ?? '—'}).`);
        tx(() => {
          db.prepare(
            `UPDATE consultas SET status = 'falhou', erro = ?, http_status = ?, log_query = ? WHERE id = ?`
          ).run(motivo, resultado.httpStatus, resultado.logQuery, consultaId);
          lancar(usuarioId, 'estorno', preco, `Estorno — consulta ${mascarado} não concluída`, String(consultaId));
        });
        console.warn(`[consulta ${consultaId}] falhou: HTTP ${resultado.httpStatus} logQuery=${resultado.logQuery ?? '-'}`);
        return res.status(502).json({
          erro: `${motivo} O valor foi estornado ao seu saldo.`,
          logQuery: resultado.logQuery,
          saldoCentavos: saldoDe(usuarioId),
        });
      }

      // 3b) Sucesso
      const rel = resultado.json?.relatorioRatingBancario?.relatorioRatingBancario || {};
      const cad = (tipoPessoa === '0' ? rel.cadastraispf : rel.cadastraispj) || {};
      db.prepare(
        `UPDATE consultas SET status = 'concluida', http_status = ?, log_query = ?, resultado_json = ?,
                nome_consultado = ?, classificacao_risco = ? WHERE id = ?`
      ).run(200, resultado.logQuery, JSON.stringify(resultado.json), cad.nome ?? null, rel.classificacaoRisco ?? null, consultaId);
      console.info(`[consulta ${consultaId}] concluída logQuery=${resultado.logQuery ?? '-'}`);

      res.json({ consulta: consultaCompleta(consultaId, usuarioId), saldoCentavos: saldoDe(usuarioId) });
    } finally {
      consultasEmAndamento.delete(usuarioId);
    }
  })
);

app.get('/api/consultas', exigirLogin, (req, res) => {
  const itens = db
    .prepare(
      `SELECT id, tipo_pessoa, documento_mascarado, valor_centavos, status, nome_consultado, classificacao_risco,
              erro, criado_em, (resultado_json IS NOT NULL) AS disponivel
         FROM consultas WHERE usuario_id = ? ORDER BY id DESC LIMIT 50`
    )
    .all(req.usuario.id);
  res.json({ itens });
});

app.get('/api/consultas/:id', exigirLogin, (req, res) => {
  const c = consultaCompleta(Number(req.params.id), req.usuario.id);
  if (!c) return res.status(404).json({ erro: 'Consulta não encontrada.' });
  if (!c.resultado) return res.status(410).json({ erro: 'Relatório não está mais disponível (prazo de retenção expirado).' });
  res.json({ consulta: c });
});

function consultaCompleta(id, usuarioId) {
  const c = db
    .prepare(
      `SELECT id, tipo_pessoa, documento_mascarado, valor_centavos, status, log_query, resultado_json, criado_em
         FROM consultas WHERE id = ? AND usuario_id = ?`
    )
    .get(id, usuarioId);
  if (!c) return null;
  return {
    id: c.id,
    tipoPessoa: c.tipo_pessoa,
    documentoMascarado: c.documento_mascarado,
    valorCentavos: c.valor_centavos,
    status: c.status,
    logQuery: c.log_query,
    criadoEm: c.criado_em,
    resultado: c.resultado_json ? JSON.parse(c.resultado_json) : null,
  };
}

const saldoDe = (id) => db.prepare('SELECT saldo_centavos FROM usuarios WHERE id = ?').get(id).saldo_centavos;

// ---------------- Front-end ----------------
app.use(express.static(path.join(RAIZ, 'public'), { index: 'index.html' }));

app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

app.use((err, req, res, next) => {
  console.error('Erro:', err.message);
  if (res.headersSent) return next(err);
  res.status(err.status && err.status < 500 ? err.status : 500).json({ erro: 'Erro interno. Tente novamente.' });
});

// ---------------- Manutenção (retenção LGPD) ----------------
function manutencao() {
  db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now());
  db.prepare(`UPDATE consultas SET resultado_json = NULL WHERE resultado_json IS NOT NULL AND criado_em < datetime('now', ?)`).run(
    `-${config.retencaoDias} days`
  );
  // Consultas que ficaram "processando" por queda do servidor: estorna
  const presas = db
    .prepare(`SELECT id, usuario_id, valor_centavos, documento_mascarado FROM consultas WHERE status = 'processando' AND criado_em < datetime('now', '-15 minutes')`)
    .all();
  for (const c of presas) {
    tx(() => {
      const r = db.prepare(`UPDATE consultas SET status = 'falhou', erro = 'Interrompida' WHERE id = ? AND status = 'processando'`).run(c.id);
      if (r.changes) lancar(c.usuario_id, 'estorno', c.valor_centavos, `Estorno — consulta ${c.documento_mascarado} interrompida`, String(c.id));
    });
  }
  expirarRecargasVencidas();
}
manutencao();
setInterval(manutencao, 10 * 60000).unref();

app.listen(config.porta, () => {
  console.log(`${config.nomeSistema} rodando em http://localhost:${config.porta}`);
  console.log(`  KSI: ${config.ksi.modo} | Pagamento: ${config.pagamento.modo} | Preço: R$ ${(config.precoConsultaCentavos / 100).toFixed(2)}`);
});
