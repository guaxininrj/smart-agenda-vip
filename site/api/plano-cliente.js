// GET  ?cliente_id=X            -> status do plano ativo do cliente (se tiver)
// POST { cliente_id, agendamento_id } -> usa 1 crédito do plano nesse agendamento
//
// Cuida também da renovação mensal: se o ciclo salvo é de um mês anterior ao
// atual, zera os usos automaticamente antes de checar/consumir.

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

function mesmoMes(dataISO) {
  const hoje = new Date();
  const d = new Date(`${dataISO}T00:00:00`);
  return d.getUTCFullYear() === hoje.getUTCFullYear() && d.getUTCMonth() === hoje.getUTCMonth();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const clienteId = req.method === 'GET' ? req.query.cliente_id : (req.body || {}).cliente_id;
  if (!clienteId) return res.status(400).json({ erro: 'cliente_id é obrigatório.' });

  try {
    const assinatura = await buscarUm(
      `assinaturas?cliente_id=eq.${clienteId}&status=eq.ativo&select=id,plano_id,ciclo_inicio,usos_no_ciclo`
    );
    if (!assinatura) return res.status(200).json({ ativo: false });

    const plano = await buscarUm(`planos?id=eq.${assinatura.plano_id}&select=nome,limite_mensal,ativo`);
    if (!plano || !plano.ativo) return res.status(200).json({ ativo: false });

    let usos = assinatura.usos_no_ciclo;
    let cicloInicio = assinatura.ciclo_inicio;
    if (!mesmoMes(cicloInicio)) {
      usos = 0;
      cicloInicio = new Date().toISOString().slice(0, 10);
      await fetch(`${SUPABASE_URL}/rest/v1/assinaturas?id=eq.${assinatura.id}`, {
        method: 'PATCH',
        headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
        body: JSON.stringify({ usos_no_ciclo: 0, ciclo_inicio: cicloInicio, atualizado_em: new Date().toISOString() })
      });
    }

    const restantes = plano.limite_mensal ? Math.max(0, plano.limite_mensal - usos) : null;

    if (req.method === 'GET') {
      return res.status(200).json({
        ativo: true,
        plano_nome: plano.nome,
        limite_mensal: plano.limite_mensal,
        usos_no_ciclo: usos,
        restantes
      });
    }

    const { agendamento_id } = req.body || {};
    if (!agendamento_id) return res.status(400).json({ erro: 'agendamento_id é obrigatório.' });
    if (plano.limite_mensal && usos >= plano.limite_mensal) {
      return res.status(400).json({ erro: 'O limite mensal desse plano já foi usado.' });
    }

    const agendamento = await buscarUm(`agendamentos?id=eq.${agendamento_id}&select=id,owner_id,barbeiro_id,cliente_id`);
    if (!agendamento) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    if (agendamento.cliente_id !== clienteId) return res.status(403).json({ erro: 'Esse agendamento não é desse cliente.' });
    if (!agendamento.barbeiro_id) return res.status(400).json({ erro: 'Esse agendamento não tem um barbeiro definido.' });

    await fetch(`${SUPABASE_URL}/rest/v1/assinaturas?id=eq.${assinatura.id}`, {
      method: 'PATCH',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
      body: JSON.stringify({ usos_no_ciclo: usos + 1, ciclo_inicio: cicloInicio, atualizado_em: new Date().toISOString() })
    });

    await fetch(`${SUPABASE_URL}/rest/v1/agendamentos?id=eq.${agendamento_id}`, {
      method: 'PATCH',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
      body: JSON.stringify({ pago: true })
    });

    await fetch(`${SUPABASE_URL}/rest/v1/cobrancas`, {
      method: 'POST',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
      body: JSON.stringify({
        owner_id: agendamento.owner_id,
        barbeiro_id: agendamento.barbeiro_id,
        cliente_id: clienteId,
        agendamento_id,
        plano_id: assinatura.plano_id,
        descricao: `Uso do plano ${plano.nome}`,
        valor: 0,
        status: 'pago',
        metodo: 'plano',
        pago_em: new Date().toISOString()
      })
    });

    const restantesDepois = plano.limite_mensal ? Math.max(0, plano.limite_mensal - (usos + 1)) : null;
    return res.status(200).json({ ok: true, plano_nome: plano.nome, restantes: restantesDepois });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro ao verificar/usar o plano.' });
  }
}
