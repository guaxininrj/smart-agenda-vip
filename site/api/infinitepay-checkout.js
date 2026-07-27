// Gera um checkout (Pix + cartão) da InfinitePay pra uma barbearia pagar a
// mensalidade do plano da plataforma. O dinheiro cai na conta InfinitePay da
// Smart Link (handle abaixo). Diferente do Mercado Pago dos barbeiros, aqui é
// uma conta só — a nossa — porque quem paga é a barbearia, pra você.
//
// A InfinitePay identifica a conta só pelo handle (InfiniteTag, sem o $), não
// tem chave secreta. O aviso de pagamento vem pelo webhook (infinitepay-webhook).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HANDLE = process.env.INFINITEPAY_HANDLE;
const WEBHOOK_SECRET = process.env.INFINITEPAY_WEBHOOK_SECRET;
const APP_URL = process.env.APP_URL || 'https://barberbook-smartlink.vercel.app';
const SITE_URL = 'https://www.smartlinkdigital.com.br';

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
    const { pedido_id, origem } = req.body || {};
    if (!pedido_id) return res.status(400).json({ erro: 'pedido_id é obrigatório.' });

    const pedido = await buscarUm(
      `pedidos_plataforma?id=eq.${pedido_id}&select=id,perfil_id,plano_plataforma_id,status`
    );
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    if (pedido.status === 'pago') return res.status(400).json({ erro: 'Esse pedido já foi pago.' });

    const plano = await buscarUm(`planos_plataforma?id=eq.${pedido.plano_plataforma_id}&select=nome,valor_mensal`);
    if (!plano) return res.status(404).json({ erro: 'Plano não encontrado.' });

    const precoCentavos = Math.round(Number(plano.valor_mensal) * 100);

    const resp = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: HANDLE,
        order_nsu: pedido.id,
        items: [{ quantity: 1, price: precoCentavos, description: `Smart Agenda VIP — Plano ${plano.nome} (mensalidade)` }],
        redirect_url: origem === 'painel' ? `${APP_URL}/index.html?plano=pago` : `${SITE_URL}/?plano=pago`,
        webhook_url: `${APP_URL}/api/infinitepay-webhook?chave=${WEBHOOK_SECRET}`
      })
    });
    const dados = await resp.json();
    if (!resp.ok || !dados.url) {
      return res.status(502).json({ erro: 'A InfinitePay recusou a criação da cobrança.' });
    }

    // guarda os identificadores que a InfinitePay devolve — precisa deles
    // depois pra consultar de verdade se foi pago (payment_check), em vez
    // de só supor que "demorou muito" é erro (ver infinitepay-verificar-pendentes.js)
    if (dados.invoice_slug || dados.transaction_nsu) {
      await fetch(`${SUPABASE_URL}/rest/v1/pedidos_plataforma?id=eq.${pedido.id}`, {
        method: 'PATCH',
        headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
        body: JSON.stringify({ invoice_slug: dados.invoice_slug || null, transaction_nsu: dados.transaction_nsu || null })
      }).catch(() => {});
    }

    return res.status(200).json({ url: dados.url });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro inesperado ao gerar a cobrança.' });
  }
}
