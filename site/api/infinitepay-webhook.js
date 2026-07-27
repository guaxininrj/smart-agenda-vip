// Recebe o aviso automático da InfinitePay quando uma mensalidade é paga.
// Confirma o pedido, marca a barbearia como liberada e define o vencimento
// da assinatura pra daqui a 30 dias. É isso que libera o acesso sozinho,
// sem você precisar confirmar nada manual.
//
// Como a InfinitePay identifica a conta só pelo handle (sem chave secreta),
// protegemos este webhook com um segredo na querystring (?chave=...) que só
// nós conhecemos — a URL do webhook com esse segredo é passada na criação de
// cada checkout. Além disso, conferimos o valor pago contra o preço do plano.

import { enviarEmailComprovante } from './_lib/email.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_SECRET = process.env.INFINITEPAY_WEBHOOK_SECRET;

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

async function buscarEmailUsuario(id) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers: HEADERS_SERVICO });
    if (!r.ok) return null;
    const dados = await r.json();
    return dados.email || null;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  try {
    if (!WEBHOOK_SECRET || req.query.chave !== WEBHOOK_SECRET) {
      return res.status(401).json({ erro: 'não autorizado' });
    }

    const corpo = req.body || {};
    const orderNsu = corpo.order_nsu;
    const pagoCentavos = Number(corpo.paid_amount || corpo.amount || 0);
    if (!orderNsu) return res.status(200).json({ ok: true }); // ignora avisos sem pedido

    const pedido = await buscarUm(
      `pedidos_plataforma?id=eq.${orderNsu}&select=id,perfil_id,plano_plataforma_id,status`
    );
    const perfilAtual = pedido ? await buscarUm(`perfis?id=eq.${pedido.perfil_id}&select=assinatura_vencimento,nome_barbearia`) : null;
    if (!pedido) return res.status(200).json({ ok: true });
    if (pedido.status === 'pago') return res.status(200).json({ ok: true }); // já processado

    const plano = await buscarUm(`planos_plataforma?id=eq.${pedido.plano_plataforma_id}&select=nome,valor_mensal`);
    const esperadoCentavos = plano ? Math.round(Number(plano.valor_mensal) * 100) : 0;
    // confere o valor pago (tolera diferença de 1 centavo por arredondamento)
    if (esperadoCentavos && pagoCentavos && pagoCentavos + 1 < esperadoCentavos) {
      return res.status(200).json({ ok: true }); // pagou menos que o plano — não libera
    }

    // marca o pedido como pago
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos_plataforma?id=eq.${pedido.id}`, {
      method: 'PATCH',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'pago' })
    });

    // libera o acesso da barbearia e soma 30 dias — a partir de hoje, ou do
    // vencimento atual se ele ainda não passou (renovação antecipada não perde dias)
    const vencimentoAtual = perfilAtual && perfilAtual.assinatura_vencimento ? new Date(perfilAtual.assinatura_vencimento + 'T00:00:00') : null;
    const base = vencimentoAtual && vencimentoAtual.getTime() > Date.now() ? vencimentoAtual.getTime() : Date.now();
    const vencimento = new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${pedido.perfil_id}`, {
      method: 'PATCH',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
      body: JSON.stringify({
        liberado: true,
        plano_plataforma_id: pedido.plano_plataforma_id,
        assinatura_vencimento: vencimento
      })
    });

    const emailCliente = await buscarEmailUsuario(pedido.perfil_id);
    await enviarEmailComprovante({
      paraEmail: emailCliente,
      nomeBarbearia: perfilAtual ? perfilAtual.nome_barbearia : '',
      planoNome: plano ? plano.nome : '',
      valor: plano ? plano.valor_mensal : 0,
      linkRecibo: corpo.receipt_url || null
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: true }); // 200 pra InfinitePay não ficar reenviando em loop
  }
}
