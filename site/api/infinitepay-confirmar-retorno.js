// Confirma um pagamento da PLATAFORMA (mensalidade do Smart Agenda VIP) no
// momento em que o cliente volta do checkout da InfinitePay pro nosso site.
//
// A InfinitePay não tem uma API pra consultar livremente "esse pedido foi
// pago?" a qualquer momento — os identificadores necessários (slug,
// transaction_nsu) só aparecem nos parâmetros da URL de retorno, depois que
// o pagamento é concluído (ver redirect_url em infinitepay-checkout.js).
// Por isso a reconciliação de segurança (pra além do webhook) só pode
// acontecer AQUI, nesse momento — nunca em segundo plano.
//
// IMPORTANTE: nunca confiamos só no fato de o navegador ter voltado pra cá
// (isso poderia ser forjado por alguém digitando a URL na mão). Sempre
// confirmamos com a própria InfinitePay via payment_check antes de liberar
// qualquer coisa — o retorno do navegador só nos dá as pistas (slug,
// transaction_nsu) de qual pedido consultar.
//
// Se o cliente pagar e fechar a aba ANTES de voltar pro site, esse caminho
// não roda — nesse caso só resta o webhook mesmo, ou checar manualmente no
// painel da InfinitePay. É uma limitação real da API deles, não nossa.

import { enviarEmailComprovante } from './_lib/email.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HANDLE = process.env.INFINITEPAY_HANDLE;

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'método não permitido' });

  try {
    const { order_nsu, slug, transaction_nsu, receipt_url } = req.body || {};
    if (!order_nsu || !slug || !transaction_nsu) {
      return res.status(400).json({ erro: 'order_nsu, slug e transaction_nsu são obrigatórios.' });
    }

    const pedido = await buscarUm(`pedidos_plataforma?id=eq.${order_nsu}&select=id,perfil_id,plano_plataforma_id,status`);
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    if (pedido.status === 'pago') return res.status(200).json({ ok: true, ja_confirmado: true });

    // guarda os identificadores pra referência, mesmo que ainda não confirme
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos_plataforma?id=eq.${pedido.id}`, {
      method: 'PATCH',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
      body: JSON.stringify({ invoice_slug: slug, transaction_nsu })
    }).catch(() => {});

    const respCheck = await fetch('https://api.checkout.infinitepay.io/payment_check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: HANDLE, order_nsu: pedido.id, transaction_nsu, slug })
    });
    if (!respCheck.ok) return res.status(502).json({ erro: 'A InfinitePay não respondeu à confirmação.' });
    const dados = await respCheck.json();
    if (!dados.paid) return res.status(200).json({ ok: true, pago: false });

    // confere o valor pago contra o preço do plano — sem isso, alguém
    // poderia pagar o plano mais barato uma vez e reusar o mesmo
    // transaction_nsu/slug pra tentar confirmar um pedido de plano mais
    // caro criado depois (mesma proteção que já existe no webhook)
    const planoParaConferir = await buscarUm(`planos_plataforma?id=eq.${pedido.plano_plataforma_id}&select=valor_mensal`);
    const esperadoCentavos = planoParaConferir ? Math.round(Number(planoParaConferir.valor_mensal) * 100) : 0;
    const pagoCentavos = Number(dados.paid_amount || dados.amount || 0);
    if (esperadoCentavos && pagoCentavos && pagoCentavos + 1 < esperadoCentavos) {
      return res.status(200).json({ ok: true, pago: false, erro: 'valor_divergente' });
    }

    // confirmado de verdade — marca pago e libera, igual ao webhook
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos_plataforma?id=eq.${pedido.id}`, {
      method: 'PATCH',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'pago' })
    });

    const perfilAtual = await buscarUm(`perfis?id=eq.${pedido.perfil_id}&select=assinatura_vencimento,nome_barbearia`);
    const vencimentoAtual = perfilAtual && perfilAtual.assinatura_vencimento ? new Date(perfilAtual.assinatura_vencimento + 'T00:00:00') : null;
    const base = vencimentoAtual && vencimentoAtual.getTime() > Date.now() ? vencimentoAtual.getTime() : Date.now();
    const vencimento = new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${pedido.perfil_id}`, {
      method: 'PATCH',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
      body: JSON.stringify({ liberado: true, plano_plataforma_id: pedido.plano_plataforma_id, assinatura_vencimento: vencimento })
    });

    const plano = await buscarUm(`planos_plataforma?id=eq.${pedido.plano_plataforma_id}&select=nome,valor_mensal`);
    const emailCliente = await buscarEmailUsuario(pedido.perfil_id);
    await enviarEmailComprovante({
      paraEmail: emailCliente,
      nomeBarbearia: perfilAtual ? perfilAtual.nome_barbearia : '',
      planoNome: plano ? plano.nome : '',
      valor: plano ? plano.valor_mensal : 0,
      linkRecibo: receipt_url || null
    });

    return res.status(200).json({ ok: true, pago: true });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro inesperado ao confirmar retorno.' });
  }
}
