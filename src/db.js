import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'consultas.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id              INTEGER PRIMARY KEY,
  nome            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  senha_hash      TEXT NOT NULL,
  saldo_centavos  INTEGER NOT NULL DEFAULT 0 CHECK (saldo_centavos >= 0),
  criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash  TEXT PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recargas (
  id              TEXT PRIMARY KEY,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
  valor_centavos  INTEGER NOT NULL,
  status          TEXT NOT NULL,           -- pendente | aprovada | expirada | cancelada
  provedor        TEXT NOT NULL,           -- simulado | mercadopago
  provedor_id     TEXT,
  pix_copia_cola  TEXT,
  pix_qr_base64   TEXT,
  expira_em       TEXT,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
  aprovado_em     TEXT
);
CREATE INDEX IF NOT EXISTS idx_recargas_provedor ON recargas(provedor_id);

CREATE TABLE IF NOT EXISTS consultas (
  id                   INTEGER PRIMARY KEY,
  usuario_id           INTEGER NOT NULL REFERENCES usuarios(id),
  tipo_pessoa          TEXT NOT NULL,
  documento_mascarado  TEXT NOT NULL,
  valor_centavos       INTEGER NOT NULL,
  status               TEXT NOT NULL,      -- processando | concluida | falhou
  nome_consultado      TEXT,
  classificacao_risco  TEXT,
  log_query            TEXT,
  http_status          INTEGER,
  resultado_json       TEXT,
  erro                 TEXT,
  criado_em            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consultas_usuario ON consultas(usuario_id, id DESC);

CREATE TABLE IF NOT EXISTS movimentacoes (
  id              INTEGER PRIMARY KEY,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
  tipo            TEXT NOT NULL,           -- recarga | consulta | estorno | ajuste
  valor_centavos  INTEGER NOT NULL,        -- positivo = crédito, negativo = débito
  descricao       TEXT NOT NULL,
  referencia      TEXT,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mov_usuario ON movimentacoes(usuario_id, id DESC);
`);

/** Executa fn dentro de uma transação (atômica). */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Lança crédito/débito no saldo e registra no extrato (usar dentro de tx). */
export function lancar(usuarioId, tipo, valorCentavos, descricao, referencia = null) {
  db.prepare('UPDATE usuarios SET saldo_centavos = saldo_centavos + ? WHERE id = ?').run(valorCentavos, usuarioId);
  db.prepare(
    'INSERT INTO movimentacoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, ?, ?, ?, ?)'
  ).run(usuarioId, tipo, valorCentavos, descricao, referencia);
}
