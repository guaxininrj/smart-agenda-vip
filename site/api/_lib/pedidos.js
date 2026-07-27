// Helper compartilhado entre mp-webhook.js, mp-verificar-pagamento.js e
// mp-verificar-pendentes.js — confirma o pedido e baixa o estoque dos
// produtos quando a cobrança de um pedido é paga via Pix/Cartão (o caminho
// "dinheiro" já confirma na hora, em mp-criar-cobranca.js).

export async function confirmarPedidoSeForPedido(SUPABASE_URL, HEADERS_SERVICO, cobrancaId) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/cobrancas?id=eq.${cobrancaId}&select=pedido_id`, {
    headers: HEADERS_SERVICO
  });
  const [cobranca] = await resp.json();
  if (!cobranca || !cobranca.pedido_id) return;

  await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${cobranca.pedido_id}`, {
    method: 'PATCH',
    headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'pago', pago_em: new Date().toISOString() })
  });

  await fetch(`${SUPABASE_URL}/rest/v1/rpc/baixar_estoque_pedido`, {
    method: 'POST',
    headers: HEADERS_SERVICO,
    body: JSON.stringify({ p_pedido_id: cobranca.pedido_id })
  });
}
