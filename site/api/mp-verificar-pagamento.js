// Confere o status de um pagamento Pix direto na fonte (API do Mercado
// Pago), em vez de confiar só no aviso automático (webhook). O Pix usa a
// API de Orders, cujo evento de notificação é diferente do "Pagamentos"
// tradicional configurado no painel — então esse é o jeito confiável de
// garantir que o sistema não fique achando que ainda tá pendente mesmo
// depois do cliente já ter pago de verdade.

import { ativarAssinaturaSeForPlano } from './_lib/planos.js';
import { confirmarPedidoSeForPedido } from './_lib/pedidos.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HEADERS_SERVICO = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json'
};

async function buscarUm(caminho) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { headers: HEADERS_SERVICO });
  const linhas = await resp.json();
  return Array.isArray(linhas) ? linhas[0] : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'método não permitido' });

  try {
    const { agendamento_id, cobranca_id } = req.body || {};
    if (!agendamento_id && !cobranca_id) {
      return res.status(400).json({ erro: 'agendamento_id ou cobranca_id é obrigatório.' });
    }

    const filtro = cobranca_id ? `id=eq.${cobranca_id}` : `agendamento_id=eq.${agendamento_id}`;
    const cobranca = await buscarUm(
      `cobrancas?${filtro}&order=criado_em.desc&limit=1&select=id,status,metodo,mp_preference_id,barbeiro_id,agendamento_id`
    );
    if (!cobranca) return res.status(200).json({ status: null });
    if (cobranca.status === 'pago' || cobranca.metodo !== 'pix' || !cobranca.mp_preference_id) {
      return res.status(200).json({ status: cobranca.status });
    }

    const barbeiro = await buscarUm(`barbeiros?id=eq.${cobranca.barbeiro_id}&select=mp_access_token`);
    if (!barbeiro || !barbeiro.mp_access_token) return res.status(200).json({ status: cobranca.status });

    const orderResp = await fetch(`https://api.mercadopago.com/v1/orders/${cobranca.mp_preference_id}`, {
      headers: { Authorization: `Bearer ${barbeiro.mp_access_token}` }
    });
    if (!orderResp.ok) return res.status(200).json({ status: cobranca.status });
    const order = await orderResp.json();

    if (order.status !== 'processed') return res.status(200).json({ status: cobranca.status });

    const pagamento = order.transactions && order.transactions.payments && order.transactions.payments[0];
    await fetch(`${SUPABASE_URL}/rest/v1/cobrancas?id=eq.${cobranca.id}`, {
      method: 'PATCH',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'pago',
        mp_payment_id: pagamento ? String(pagamento.id) : null,
        pago_em: new Date().toISOString()
      })
    });
    if (cobranca.agendamento_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/agendamentos?id=eq.${cobranca.agendamento_id}`, {
        method: 'PATCH',
        headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
        body: JSON.stringify({ pago: true })
      });
    }
    await ativarAssinaturaSeForPlano(SUPABASE_URL, HEADERS_SERVICO, cobranca.id);
    await confirmarPedidoSeForPedido(SUPABASE_URL, HEADERS_SERVICO, cobranca.id);

    return res.status(200).json({ status: 'pago' });
  } catch (e) {
    return res.status(200).json({ status: null });
  }
}
