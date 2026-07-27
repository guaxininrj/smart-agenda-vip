// Mercado Pago chama essa URL sozinho toda vez que um pagamento muda de status.
// É assim que o sistema "detecta" o pagamento automaticamente, sem o barbeiro
// precisar avisar nada. Precisa ser cadastrada no painel do Mercado Pago
// (Developers > sua aplicação > Webhooks) apontando pra:
//   https://barberbook-smartlink.vercel.app/api/mp-webhook

import crypto from 'crypto';
import { ativarAssinaturaSeForPlano } from './_lib/planos.js';
import { confirmarPedidoSeForPedido } from './_lib/pedidos.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;

const HEADERS_SERVICO = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json'
};

// Confere se a notificação realmente veio do Mercado Pago (e não de alguém
// tentando forjar um "pagamento aprovado" na marra). Formato oficial:
// https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/notifications/webhooks#editor_5
function assinaturaValida(req) {
  if (!MP_WEBHOOK_SECRET) return true; // sem segredo configurado ainda, não bloqueia
  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  if (!xSignature || !xRequestId) return false;

  const partes = {};
  String(xSignature).split(',').forEach((par) => {
    const [chave, valor] = par.split('=');
    if (chave && valor) partes[chave.trim()] = valor.trim();
  });
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) return false;

  const dataId = String(req.query['data.id'] || req.query.id || '').toLowerCase();
  const manifesto = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const hash = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifesto).digest('hex');
  return hash === v1;
}

export default async function handler(req, res) {
  // Mercado Pago espera 200 rápido; qualquer coisa fora do esperado a gente
  // só ignora sem dar erro, pra ele não ficar re-tentando à toa.
  try {
    if (!assinaturaValida(req)) {
      return res.status(401).json({ erro: 'assinatura inválida' });
    }

    const corpo = req.body || {};
    const tipo = corpo.type || corpo.topic || req.query.type || req.query.topic;
    const paymentId = (corpo.data && corpo.data.id) || req.query.id || req.query['data.id'];
    const mpUserId = corpo.user_id || req.query.user_id;

    if (tipo !== 'payment' || !paymentId || !mpUserId) {
      return res.status(200).json({ ok: true });
    }

    const barbeiroResp = await fetch(
      `${SUPABASE_URL}/rest/v1/barbeiros?mp_user_id=eq.${mpUserId}&select=id,mp_access_token`,
      { headers: HEADERS_SERVICO }
    );
    const [barbeiro] = await barbeiroResp.json();
    if (!barbeiro || !barbeiro.mp_access_token) return res.status(200).json({ ok: true });

    const pagamentoResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${barbeiro.mp_access_token}` }
    });
    if (!pagamentoResp.ok) return res.status(200).json({ ok: true });
    const pagamento = await pagamentoResp.json();

    if (pagamento.status !== 'approved' || !pagamento.external_reference) {
      return res.status(200).json({ ok: true });
    }

    const cobrancaId = pagamento.external_reference;
    await fetch(`${SUPABASE_URL}/rest/v1/cobrancas?id=eq.${cobrancaId}`, {
      method: 'PATCH',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'pago',
        mp_payment_id: String(paymentId),
        pago_em: new Date().toISOString()
      })
    });

    // se essa cobrança era de um agendamento especifico, marca ele como pago tambem
    const cobranca = await (
      await fetch(`${SUPABASE_URL}/rest/v1/cobrancas?id=eq.${cobrancaId}&select=agendamento_id`, {
        headers: HEADERS_SERVICO
      })
    ).json();
    if (cobranca[0] && cobranca[0].agendamento_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/agendamentos?id=eq.${cobranca[0].agendamento_id}`, {
        method: 'PATCH',
        headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
        body: JSON.stringify({ pago: true })
      });
    }

    await ativarAssinaturaSeForPlano(SUPABASE_URL, HEADERS_SERVICO, cobrancaId);
    await confirmarPedidoSeForPedido(SUPABASE_URL, HEADERS_SERVICO, cobrancaId);

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: true });
  }
}
