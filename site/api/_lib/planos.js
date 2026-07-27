// Helper compartilhado entre mp-webhook.js, mp-verificar-pagamento.js e
// mp-verificar-pendentes.js — ativa (ou renova) a assinatura do cliente
// quando uma cobrança de plano é confirmada como paga. Fica em _lib pra não
// virar uma rota própria no Vercel (pastas com "_" na frente são ignoradas).

export async function ativarAssinaturaSeForPlano(SUPABASE_URL, HEADERS_SERVICO, cobrancaId) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/cobrancas?id=eq.${cobrancaId}&select=plano_id,cliente_id,owner_id`,
    { headers: HEADERS_SERVICO }
  );
  const [cobranca] = await resp.json();
  if (!cobranca || !cobranca.plano_id || !cobranca.cliente_id) return;

  await fetch(`${SUPABASE_URL}/rest/v1/assinaturas?on_conflict=cliente_id`, {
    method: 'POST',
    headers: { ...HEADERS_SERVICO, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      owner_id: cobranca.owner_id,
      cliente_id: cobranca.cliente_id,
      plano_id: cobranca.plano_id,
      status: 'ativo',
      ciclo_inicio: new Date().toISOString().slice(0, 10),
      usos_no_ciclo: 0,
      atualizado_em: new Date().toISOString()
    })
  });
}
