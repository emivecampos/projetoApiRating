import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';

const COOKIE = 'sid';
const SESSAO_DIAS = 7;

export function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verificarSenha(senha, armazenado) {
  const [alg, saltB64, hashB64] = String(armazenado).split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const esperado = Buffer.from(hashB64, 'base64');
  const obtido = crypto.scryptSync(senha, Buffer.from(saltB64, 'base64'), esperado.length);
  return crypto.timingSafeEqual(esperado, obtido);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function criarSessao(res, usuarioId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expira = Date.now() + SESSAO_DIAS * 86400000;
  db.prepare('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)').run(sha256(token), usuarioId, expira);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.producao,
    maxAge: SESSAO_DIAS * 86400000,
    path: '/',
  });
}

function lerCookie(req) {
  const header = req.headers.cookie || '';
  for (const parte of header.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function encerrarSessao(req, res) {
  const token = lerCookie(req);
  if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

export function exigirLogin(req, res, next) {
  const token = lerCookie(req);
  if (token) {
    const s = db
      .prepare(
        `SELECT u.id, u.nome, u.email, u.saldo_centavos
           FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
          WHERE s.token_hash = ? AND s.expira_em > ?`
      )
      .get(sha256(token), Date.now());
    if (s) {
      req.usuario = s;
      return next();
    }
  }
  res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
}

/** Limitador simples em memória (por chave), p/ login e cadastro. */
export function limitador({ janelaMs, max }) {
  const mapa = new Map();
  return (req, res, next) => {
    const chave = req.ip;
    const agora = Date.now();
    const item = mapa.get(chave);
    if (!item || item.reinicia < agora) {
      mapa.set(chave, { n: 1, reinicia: agora + janelaMs });
      return next();
    }
    if (++item.n > max) {
      return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    }
    next();
  };
}
