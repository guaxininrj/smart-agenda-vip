// Pausa automaticamente o acesso de barbearias cuja assinatura da
// plataforma venceu — sem isso, "liberado" só mudava por ação manual
// (webhook de pagamento ou o botão Pausar no painel Smart Agenda). Rodado
// uma vez por dia via Vercel Cron (ver "crons" em vercel.json).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const HEADERS_SERVICO = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json'
};

export default async function handler(req, res) {
  // a Vercel Cron manda automaticamente "Authorization: Bearer <CRON_SECRET>"
  // quando a env var CRON_SECRET existe no projeto — aceita isso OU o
  // ?chave= (pra eu poder testar manualmente com curl).
  const autorizado = req.headers.authorization === `Bearer ${CRON_SECRET}` || req.query.chave === CRON_SECRET;
  if (!CRON_SECRET || !autorizado) {
    return res.status(401).json({ erro: 'não autorizado' });
  }

  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/perfis?liberado=eq.true&assinatura_vencimento=lt.${hoje}&select=id,nome_barbearia,assinatura_vencimento`,
      { headers: HEADERS_SERVICO }
    );
    if (!resp.ok) throw new Error(`Falha ao buscar perfis vencidos: ${resp.status}`);
    const vencidos = await resp.json();
    if (!vencidos.length) return res.status(200).json({ ok: true, pausados: 0 });

    await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=in.(${vencidos.map((p) => p.id).join(',')})`, {
      method: 'PATCH',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
      body: JSON.stringify({ liberado: false })
    });

    return res.status(200).json({ ok: true, pausados: vencidos.length, barbearias: vencidos.map((p) => p.nome_barbearia) });
  } catch (erro) {
    return res.status(500).json({ erro: erro.message });
  }
}
