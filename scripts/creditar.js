// Crédito/débito manual (suporte/ajustes). Uso: npm run creditar -- email@cliente.com 50.00 "motivo"
import { db, tx, lancar } from '../src/db.js';

const [email, valor, motivo = 'Ajuste manual'] = process.argv.slice(2);
const centavos = Math.round(Number(valor) * 100);
if (!email || !Number.isFinite(centavos) || centavos === 0) {
  console.error('Uso: npm run creditar -- <email> <valor> ["motivo"]   (valor negativo debita)');
  process.exit(1);
}
const u = db.prepare('SELECT id, saldo_centavos FROM usuarios WHERE email = ?').get(email.toLowerCase());
if (!u) {
  console.error('Usuário não encontrado.');
  process.exit(1);
}
tx(() => lancar(u.id, 'ajuste', centavos, motivo));
const novo = db.prepare('SELECT saldo_centavos FROM usuarios WHERE id = ?').get(u.id).saldo_centavos;
console.log(`Saldo de ${email}: R$ ${(u.saldo_centavos / 100).toFixed(2)} -> R$ ${(novo / 100).toFixed(2)}`);
