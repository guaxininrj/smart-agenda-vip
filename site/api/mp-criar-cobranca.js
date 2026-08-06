// Registra a intenção de pagamento de um agendamento, plano ou pedido de
// produtos. Duas formas de chamar:
//
// 1) Dono do painel gera cobrança avulsa: { barbeiro_id, cliente_id, valor, descricao }
//    com header Authorization: Bearer <token supabase do dono>.
// 2) Cliente gera a cobrança do próprio agendamento: { agendamento_id }
//    sem autenticação — confia no agendamento_id existir (mesmo padrão já usado
//    no resto do sistema para o fluxo público de agendamento).
//
// Aceita { metodo: 'pix' | 'dinheiro' } (padrão 'pix'). Nenhum dos dois fala
// com um gateway de pagamento — o barbeiro recebe direto (Pix na hora, sem
// taxa) e só marca como pago no painel depois de confirmar o recebimento.

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

async function buscarTodos(caminho) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { headers: HEADERS_SERVICO });
  const linhas = await resp.json();
  return Array.isArray(linhas) ? linhas : [];
}

async function confirmarDono(authHeader) {
  if (!authHeader) return null;
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: authHeader }
  });
  if (!resp.ok) return null;
  const usuario = await resp.json();
  return usuario && usuario.id ? usuario.id : null;
}

export default async function handler(req, res) {
  // CORS: essa função é chamada tanto de barberbook-smartlink.vercel.app
  // quanto de smartlinkdigital.com.br (site embutido) — como o app chama
  // direto essa URL absoluta (em vez de um caminho relativo), evita cair
  // no redirecionamento apex->www do domínio, que o navegador trata como
  // troca de origem e bloqueia por CORS no meio do fetch.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'método não permitido' });

  try {
    const corpo = req.body || {};
    let barbeiro, valor, descricao, clienteId, agendamentoId, ownerId, planoId, pedidoId;

    if (Array.isArray(corpo.itens) && corpo.itens.length && corpo.cliente_id) {
      const idsProdutos = corpo.itens.map((i) => i.produto_id).filter(Boolean);
      if (!idsProdutos.length) return res.status(400).json({ erro: 'Carrinho vazio.' });

      const produtos = await buscarTodos(`produtos?id=in.(${idsProdutos.join(',')})&select=id,owner_id,barbeiro_id,nome,preco,estoque,ativo`);
      if (!produtos.length) return res.status(404).json({ erro: 'Produtos não encontrados.' });

      const donoDosProdutos = produtos[0].owner_id;
      const barbeiroDaLoja = produtos[0].barbeiro_id;
      const mesmaLoja = produtos.every((p) => p.owner_id === donoDosProdutos && p.barbeiro_id === barbeiroDaLoja);
      if (!mesmaLoja) return res.status(400).json({ erro: 'Só dá pra comprar produtos de uma loja (barbeiro) por vez.' });
      if (!barbeiroDaLoja) return res.status(400).json({ erro: 'Esse produto ainda não tem uma loja/barbeiro vinculado.' });

      let valorTotal = 0;
      const itensParaCriar = [];
      for (const item of corpo.itens) {
        const produto = produtos.find((p) => p.id === item.produto_id);
        const quantidade = Number(item.quantidade || 0);
        if (!produto || !produto.ativo || quantidade <= 0) continue;
        if (produto.estoque < quantidade) {
          return res.status(400).json({ erro: `Estoque insuficiente de "${produto.nome}" (disponível: ${produto.estoque}).` });
        }
        valorTotal += Number(produto.preco) * quantidade;
        itensParaCriar.push({ produto_id: produto.id, quantidade, preco_unitario: produto.preco });
      }
      if (!itensParaCriar.length) return res.status(400).json({ erro: 'Carrinho vazio.' });

      // a venda vai pro barbeiro dono dessa loja, não de um barbeiro qualquer
      // da barbearia — cada um vende os seus produtos.
      barbeiro = await buscarUm(`barbeiros?id=eq.${barbeiroDaLoja}&select=id,nome`);
      if (!barbeiro) return res.status(404).json({ erro: 'Barbeiro dessa loja não encontrado.' });

      const criacaoPedido = await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
        method: 'POST',
        headers: { ...HEADERS_SERVICO, Prefer: 'return=representation' },
        body: JSON.stringify({ owner_id: donoDosProdutos, barbeiro_id: barbeiroDaLoja, cliente_id: corpo.cliente_id, valor_total: valorTotal })
      });
      const [pedido] = await criacaoPedido.json();
      if (!pedido) return res.status(500).json({ erro: 'Não consegui criar o pedido.' });

      await fetch(`${SUPABASE_URL}/rest/v1/pedido_itens`, {
        method: 'POST',
        headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
        body: JSON.stringify(itensParaCriar.map((i) => ({ ...i, pedido_id: pedido.id })))
      });

      valor = valorTotal;
      descricao = `Pedido de produtos (${itensParaCriar.length} item(ns))`;
      clienteId = corpo.cliente_id;
      ownerId = donoDosProdutos;
      pedidoId = pedido.id;
    } else if (corpo.plano_id && corpo.cliente_id) {
      const plano = await buscarUm(`planos?id=eq.${corpo.plano_id}&select=id,owner_id,nome,preco,ativo`);
      if (!plano || !plano.ativo) return res.status(404).json({ erro: 'Plano não encontrado.' });

      barbeiro = await buscarUm(`barbeiros?owner_id=eq.${plano.owner_id}&select=id,nome&limit=1`);
      if (!barbeiro) return res.status(400).json({ erro: 'Essa barbearia ainda não tem nenhum barbeiro cadastrado.' });

      valor = Number(plano.preco || 0);
      descricao = `Plano ${plano.nome}`;
      clienteId = corpo.cliente_id;
      ownerId = plano.owner_id;
      planoId = plano.id;
    } else if (corpo.agendamento_id) {
      agendamentoId = corpo.agendamento_id;
      const agendamento = await buscarUm(
        `agendamentos?id=eq.${agendamentoId}&select=id,owner_id,barbeiro_id,cliente_id,valor,status`
      );
      if (!agendamento) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
      if (agendamento.status === 'cancelado') return res.status(400).json({ erro: 'Esse agendamento foi cancelado.' });
      if (!agendamento.barbeiro_id) return res.status(400).json({ erro: 'Esse agendamento não tem um barbeiro definido.' });

      barbeiro = await buscarUm(`barbeiros?id=eq.${agendamento.barbeiro_id}&select=id,nome`);
      valor = Number(agendamento.valor || 0);
      descricao = 'Serviço agendado';
      clienteId = agendamento.cliente_id;
      ownerId = agendamento.owner_id;
    } else {
      const donoId = await confirmarDono(req.headers.authorization);
      if (!donoId) return res.status(401).json({ erro: 'Não autenticado.' });

      barbeiro = await buscarUm(`barbeiros?id=eq.${corpo.barbeiro_id}&owner_id=eq.${donoId}&select=id,nome`);
      if (!barbeiro) return res.status(404).json({ erro: 'Barbeiro não encontrado.' });
      valor = Number(corpo.valor || 0);
      descricao = corpo.descricao || 'Cobrança avulsa';
      clienteId = corpo.cliente_id || null;
      ownerId = donoId;
    }

    if (!barbeiro) {
      return res.status(404).json({ erro: 'Essa barbearia ainda não tem nenhum barbeiro cadastrado.' });
    }
    if (!valor || valor <= 0) {
      return res.status(400).json({ erro: 'Valor inválido para gerar cobrança.' });
    }

    const perfil = await buscarUm(`perfis?id=eq.${ownerId}&select=taxas_pagamento`);
    const metodo = corpo.metodo === 'dinheiro' ? 'dinheiro' : 'pix';

    const taxas = perfil && perfil.taxas_pagamento ? perfil.taxas_pagamento : {};
    const taxaPct = Number(taxas[metodo] || 0);
    const valorTaxa = taxaPct > 0 ? Math.round(valor * taxaPct) / 100 : 0;
    valor = Math.round((valor + valorTaxa) * 100) / 100;

    const descricaoFinal = taxaPct > 0
      ? `${descricao} (taxa ${metodo} ${taxaPct}%: +${valorTaxa.toFixed(2)})`
      : descricao;

    // fica pendente até o dono marcar como pago manualmente no painel — só
    // aí o estoque é baixado, pra não descontar produto que não foi de fato
    // pago. Tanto pix quanto dinheiro são recebidos direto pelo barbeiro,
    // sem passar por gateway nenhum.
    await fetch(`${SUPABASE_URL}/rest/v1/cobrancas`, {
      method: 'POST',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
      body: JSON.stringify({
        owner_id: ownerId,
        barbeiro_id: barbeiro.id,
        cliente_id: clienteId,
        agendamento_id: agendamentoId || null,
        plano_id: planoId || null,
        pedido_id: pedidoId || null,
        descricao: descricaoFinal,
        valor,
        metodo
      })
    });

    return res.status(200).json({ metodo });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro inesperado ao gerar a cobrança.' });
  }
}
