import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(path.join(RAIZ, '.env'));
} catch {
  // sem .env: usa variáveis de ambiente / padrões
}

const env = process.env;
const num = (v, padrao) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : padrao;
};
const centavos = (v, padrao) => Math.round(num(v, padrao) * 100);

export const config = {
  producao: env.NODE_ENV === 'production',
  porta: num(env.PORTA, 3000),
  nomeSistema: env.NOME_SISTEMA || 'Consulta Rating',
  publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
  dataDir: path.resolve(RAIZ, env.DATA_DIR || 'data'),

  precoConsultaCentavos: centavos(env.PRECO_CONSULTA, 19.9),
  recargaMinCentavos: centavos(env.RECARGA_MIN, 20),
  recargaMaxCentavos: centavos(env.RECARGA_MAX, 2000),
  retencaoDias: num(env.RETENCAO_DIAS, 90),

  ksi: {
    modo: (env.KSI_MODO || 'simulado').toLowerCase(),
    baseUrl: (env.KSI_BASE_URL || 'https://apiksiconsultas.com.br').replace(/\/+$/, ''),
    login: env.KSI_LOGIN || '',
    senha: env.KSI_SENHA || '',
    authPrefix: env.KSI_AUTH_PREFIX || '',
    timeoutMs: num(env.KSI_TIMEOUT_MS, 120000),
    tokenTtlMin: num(env.KSI_TOKEN_TTL_MIN, 30),
  },

  pagamento: {
    modo: (env.PAGAMENTO_MODO || 'simulado').toLowerCase(),
    mpAccessToken: env.MP_ACCESS_TOKEN || '',
    mpWebhookSecret: env.MP_WEBHOOK_SECRET || '',
    pixExpiraMin: num(env.PIX_EXPIRA_MIN, 30),
  },
};

// ---- validações de inicialização ----
const erros = [];
if (!['simulado', 'real'].includes(config.ksi.modo)) erros.push('KSI_MODO deve ser "simulado" ou "real".');
if (config.ksi.modo === 'real' && (!config.ksi.login || !config.ksi.senha)) {
  erros.push('KSI_MODO=real exige KSI_LOGIN e KSI_SENHA.');
}
if (!['simulado', 'mercadopago'].includes(config.pagamento.modo)) {
  erros.push('PAGAMENTO_MODO deve ser "simulado" ou "mercadopago".');
}
if (config.pagamento.modo === 'mercadopago' && !config.pagamento.mpAccessToken) {
  erros.push('PAGAMENTO_MODO=mercadopago exige MP_ACCESS_TOKEN.');
}
if (config.producao && config.pagamento.modo === 'simulado') {
  erros.push('PAGAMENTO_MODO=simulado não é permitido em produção (qualquer usuário poderia se creditar).');
}
if (config.producao && config.ksi.modo === 'simulado') {
  erros.push('KSI_MODO=simulado não é permitido em produção.');
}
if (config.recargaMinCentavos <= 0 || config.recargaMaxCentavos < config.recargaMinCentavos) {
  erros.push('RECARGA_MIN/RECARGA_MAX inválidos.');
}
if (erros.length) {
  console.error('Configuração inválida:\n - ' + erros.join('\n - '));
  process.exit(1);
}
