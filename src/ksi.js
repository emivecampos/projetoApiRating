// Cliente da API KSI — Rating Bancário V2.
// Credenciais e token ficam SOMENTE no servidor; nunca são logados nem enviados ao navegador.
import { config } from './config.js';
import { gerarRespostaSimulada } from './exemplo-resposta.js';

const { ksi } = config;
let tokenCache = { valor: null, obtidoEm: 0 };
let loginEmAndamento = null;

async function login() {
  const resp = await fetch(`${ksi.baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: ksi.login, password: ksi.senha }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await resp.json().catch(() => null);
  if (resp.status !== 200 || !json?.token) {
    throw new ErroKsi(`Falha na autenticação com a KSI (HTTP ${resp.status}).`, resp.status);
  }
  tokenCache = { valor: json.token, obtidoEm: Date.now() };
  return json.token;
}

async function obterToken(forcarRenovacao = false) {
  const expirado = Date.now() - tokenCache.obtidoEm > ksi.tokenTtlMin * 60000;
  if (!forcarRenovacao && tokenCache.valor && !expirado) return tokenCache.valor;
  // evita vários logins simultâneos
  loginEmAndamento ??= login().finally(() => (loginEmAndamento = null));
  return loginEmAndamento;
}

function chamarConsulta(token, tipoPessoa, documento) {
  return fetch(`${ksi.baseUrl}/consultar/relatorio/ratingbancario/v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${ksi.authPrefix}${token}`,
    },
    body: JSON.stringify({ tipoPessoa, documento }),
    signal: AbortSignal.timeout(ksi.timeoutMs),
  });
}

export class ErroKsi extends Error {
  constructor(msg, httpStatus = null) {
    super(msg);
    this.httpStatus = httpStatus;
  }
}

/**
 * Executa a consulta. Retorna { ok, httpStatus, json, logQuery }.
 * ok = HTTP 200 && baseDisponivel === true (critério da seção 08 da documentação).
 */
export async function consultarRatingBancario(tipoPessoa, documento) {
  if (ksi.modo === 'simulado') {
    await new Promise((r) => setTimeout(r, 1200));
    const json = gerarRespostaSimulada(tipoPessoa, documento);
    return { ok: true, httpStatus: 200, json, logQuery: json.logQuery };
  }

  let token = await obterToken();
  let resp = await chamarConsulta(token, tipoPessoa, documento);

  // Token recusado: a consulta não foi processada, então renovar e repetir uma vez é seguro.
  if (resp.status === 401 || resp.status === 403) {
    token = await obterToken(true);
    resp = await chamarConsulta(token, tipoPessoa, documento);
  }

  const texto = await resp.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    /* corpo não-JSON */
  }

  const logQuery = json?.logQuery ?? json?.relatorioRatingBancario?.logQuery ?? null;
  const ok = resp.status === 200 && json?.baseDisponivel === true;
  return { ok, httpStatus: resp.status, json, logQuery };
}
