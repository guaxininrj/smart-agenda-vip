// Varre TODAS as cobranças Pix pendentes recentes e confere direto na API
// do Mercado Pago se já foram pagas — corrige o caso em que o cliente ou o
// barbeiro fecham a tela antes do polling ao vivo (setInterval no navegador)
// detectar o pagamento. Feito pra ser chamado por um cron externo a cada
// poucos minutos, como reconciliação de segurança além do polling ao vivo.

import { ativarAssinaturaSeForPlano } from './_lib/planos.js';
import { confirmarPedidoSeForPedido } from './_lib/pedidos.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const HEADERS_SERVICO = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json'
};

async function buscarTodos(caminho) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { headers: HEADERS_SERVICO });
  if (!resp.ok) return [];
  return resp.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (CRON_SECRET && req.query.chave !== CRON_SECRET) {
    return res.status(401).json({ erro: 'não autorizado' });
  }

  try {
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const pendentes = await buscarTodos(
      `cobrancas?status=eq.pendente&metodo=eq.pix&criado_em=gte.${desde}&select=id,agendamento_id,barbeiro_id,mp_preference_id`
    );

    const confirmados = [];
    const falhas = [];

    for (const cobranca of pendentes) {
      if (!cobranca.mp_preference_id) continue;
      try {
        const barbeiroLista = await buscarTodos(`barbeiros?id=eq.${cobranca.barbeiro_id}&select=mp_access_token`);
        const barbeiro = barbeiroLista[0];
        if (!barbeiro || !barbeiro.mp_access_token) continue;

        const orderResp = await fetch(`https://api.mercadopago.com/v1/orders/${cobranca.mp_preference_id}`, {
          headers: { Authorization: `Bearer ${barbeiro.mp_access_token}` }
        });
        if (!orderResp.ok) continue;
        const order = await orderResp.json();
        if (order.status !== 'processed') continue;

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
        confirmados.push(cobranca.id);
      } catch (erroItem) {
        falhas.push({ id: cobranca.id, erro: erroItem.message });
      }
    }

    return res.status(200).json({ ok: true, verificadas: pendentes.length, confirmados: confirmados.length, falhas });
  } catch (erro) {
    return res.status(500).json({ erro: erro.message });
  }
}
