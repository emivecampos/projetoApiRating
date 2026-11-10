// Recarga de saldo via PIX (Mercado Pago) ou modo simulado para desenvolvimento.
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, tx, lancar } from './db.js';

const MP = 'https://api.mercadopago.com';
const { pagamento } = config;

async function mp(caminho, opcoes = {}) {
  const resp = await fetch(MP + caminho, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${pagamento.mpAccessToken}`,
      'Content-Type': 'application/json',
      ...(opcoes.headers || {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const e = new Error(`Mercado Pago HTTP ${resp.status}: ${json?.message || 'erro'}`);
    e.status = resp.status;
    throw e;
  }
  return json;
}

/** Cria a cobrança PIX e registra a recarga como pendente. */
export async function criarRecarga(usuario, valorCentavos) {
  const id = crypto.randomUUID();
  const expira = new Date(Date.now() + pagamento.pixExpiraMin * 60000);
  const expiraIso = expira.toISOString();

  let dados;
  if (pagamento.modo === 'simulado') {
    dados = {
      provedorId: `SIM-${id.slice(0, 8)}`,
      copiaCola: `00020126SIMULADO-${id}-NAO-PAGUE-5204000053039865405${(valorCentavos / 100).toFixed(2)}6304ABCD`,
      qrBase64: null,
    };
  } else {
    const body = {
      transaction_amount: valorCentavos / 100,
      description: `Recarga de créditos - ${config.nomeSistema}`,
      payment_method_id: 'pix',
      external_reference: id,
      date_of_expiration: expiraIso.replace('Z', '-00:00'),
      payer: { email: usuario.email },
    };
    if (config.publicUrl.startsWith('https://')) {
      body.notification_url = `${config.publicUrl}/api/webhooks/mercadopago`;
    }
    const p = await mp('/v1/payments', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': id },
      body: JSON.stringify(body),
    });
    const t = p.point_of_interaction?.transaction_data || {};
    dados = { provedorId: String(p.id), copiaCola: t.qr_code || null, qrBase64: t.qr_code_base64 || null };
  }

  db.prepare(
    `INSERT INTO recargas (id, usuario_id, valor_centavos, status, provedor, provedor_id, pix_copia_cola, pix_qr_base64, expira_em)
     VALUES (?, ?, ?, 'pendente', ?, ?, ?, ?, ?)`
  ).run(id, usuario.id, valorCentavos, pagamento.modo, dados.provedorId, dados.copiaCola, dados.qrBase64, expiraIso);

  return obterRecarga(id, usuario.id);
}

export function obterRecarga(id, usuarioId) {
  return db
    .prepare(
      `SELECT id, valor_centavos, status, pix_copia_cola, pix_qr_base64, expira_em, criado_em, aprovado_em, provedor, provedor_id
         FROM recargas WHERE id = ? AND usuario_id = ?`
    )
    .get(id, usuarioId);
}

/** Credita a recarga uma única vez (idempotente). */
export function aprovarRecarga(id) {
  return tx(() => {
    const r = db
      .prepare(
        `UPDATE recargas SET status = 'aprovada', aprovado_em = datetime('now')
          WHERE id = ? AND status <> 'aprovada'
          RETURNING usuario_id, valor_centavos`
      )
      .get(id);
    if (!r) return false;
    lancar(r.usuario_id, 'recarga', r.valor_centavos, 'Recarga via PIX', id);
    return true;
  });
}

/** Consulta o status no Mercado Pago e aplica. Nunca confia no corpo do webhook. */
export async function sincronizarComProvedor(recarga) {
  if (recarga.provedor !== 'mercadopago' || recarga.status !== 'pendente') return;
  const p = await mp(`/v1/payments/${encodeURIComponent(recarga.provedor_id)}`);
  const valorConfere = Math.round(Number(p.transaction_amount) * 100) === recarga.valor_centavos;
  if (p.status === 'approved' && p.external_reference === recarga.id && valorConfere) {
    aprovarRecarga(recarga.id);
  } else if (['cancelled', 'rejected', 'expired'].includes(p.status)) {
    db.prepare(`UPDATE recargas SET status = 'cancelada' WHERE id = ? AND status = 'pendente'`).run(recarga.id);
  }
}

/** Valida a assinatura x-signature do webhook do Mercado Pago (quando configurada). */
export function assinaturaWebhookValida(req, dataId) {
  if (!pagamento.mpWebhookSecret) return true;
  const sig = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '');
  const partes = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=')));
  if (!partes.ts || !partes.v1) return false;
  const manifesto = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', pagamento.mpWebhookSecret).update(manifesto).digest('hex');
  const a = Buffer.from(esperado);
  const b = Buffer.from(partes.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function processarWebhook(req) {
  const dataId = req.query['data.id'] || req.body?.data?.id;
  const tipo = req.query.type || req.body?.type;
  if (tipo !== 'payment' || !dataId) return;
  if (!assinaturaWebhookValida(req, dataId)) throw Object.assign(new Error('assinatura inválida'), { status: 401 });
  const recarga = db
    .prepare(`SELECT id, valor_centavos, status, provedor, provedor_id FROM recargas WHERE provedor_id = ?`)
    .get(String(dataId));
  if (recarga) await sincronizarComProvedor(recarga);
}

export function expirarRecargasVencidas() {
  db.prepare(
    `UPDATE recargas SET status = 'expirada'
      WHERE status = 'pendente' AND provedor = 'simulado' AND expira_em < ?`
  ).run(new Date().toISOString());
}
