// Cria uma cobrança na conta Mercado Pago do barbeiro. Duas formas de chamar:
//
// 1) Dono do painel gera cobrança avulsa: { barbeiro_id, cliente_id, valor, descricao }
//    com header Authorization: Bearer <token supabase do dono>.
// 2) Cliente gera a cobrança do próprio agendamento: { agendamento_id }
//    sem autenticação — confia no agendamento_id existir (mesmo padrão já usado
//    no resto do sistema para o fluxo público de agendamento).
//
// Em ambos os casos aceita { metodo: 'pix' | 'cartao' | 'dinheiro' } (padrão 'cartao'):
// - 'pix' usa a API de Orders do Mercado Pago e devolve o QR code (imagem +
//   código copia-e-cola) pra mostrar direto na tela, sem redirecionar.
// - 'cartao' usa o Checkout Pro (preferences) e devolve um link de pagamento
//   hospedado pelo Mercado Pago, com crédito/débito/boleto.
// - 'dinheiro' não fala com o Mercado Pago (não tem como automatizar dinheiro
//   vivo) — só registra a intenção de pagamento pra aparecer no painel do
//   barbeiro. Por isso é o único método que funciona mesmo se o barbeiro
//   ainda não tiver conectado o Mercado Pago.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.APP_URL || 'https://barberbook-smartlink.vercel.app';

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
    let barbeiro, valor, descricao, clienteId, agendamentoId, ownerId, planoId, pedidoId, pedidoItensCriados;

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

      // a venda vai direto pro Mercado Pago do barbeiro dono dessa loja, não
      // de um barbeiro qualquer da barbearia — cada um vende os seus produtos.
      barbeiro = await buscarUm(`barbeiros?id=eq.${barbeiroDaLoja}&select=id,nome,mp_conectado,mp_access_token`);
      if (!barbeiro) return res.status(404).json({ erro: 'Barbeiro dessa loja não encontrado.' });
      if (corpo.metodo !== 'dinheiro' && !barbeiro.mp_conectado) {
        return res.status(400).json({ erro: `${barbeiro.nome} ainda não conectou a conta Mercado Pago.` });
      }

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
      pedidoItensCriados = itensParaCriar;
    } else if (corpo.plano_id && corpo.cliente_id) {
      const plano = await buscarUm(`planos?id=eq.${corpo.plano_id}&select=id,owner_id,nome,preco,ativo`);
      if (!plano || !plano.ativo) return res.status(404).json({ erro: 'Plano não encontrado.' });

      barbeiro = await buscarUm(
        `barbeiros?owner_id=eq.${plano.owner_id}&mp_conectado=eq.true&select=id,nome,mp_conectado,mp_access_token&limit=1`
      );
      if (!barbeiro) return res.status(400).json({ erro: 'Nenhum barbeiro dessa barbearia conectou o Mercado Pago ainda.' });

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

      barbeiro = await buscarUm(
        `barbeiros?id=eq.${agendamento.barbeiro_id}&select=id,nome,mp_conectado,mp_access_token`
      );
      valor = Number(agendamento.valor || 0);
      descricao = 'Serviço agendado';
      clienteId = agendamento.cliente_id;
      ownerId = agendamento.owner_id;
    } else {
      const donoId = await confirmarDono(req.headers.authorization);
      if (!donoId) return res.status(401).json({ erro: 'Não autenticado.' });

      barbeiro = await buscarUm(
        `barbeiros?id=eq.${corpo.barbeiro_id}&owner_id=eq.${donoId}&select=id,nome,mp_conectado,mp_access_token`
      );
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

    // pro cliente voltar pro link certo da barbearia depois de pagar (ou
    // desistir) no Mercado Pago — sem isso ele cai numa página sem saber
    // qual barbearia é, e dá "Barbearia não encontrada".
    const perfil = await buscarUm(`perfis?id=eq.${ownerId}&select=slug`);
    const linkVoltarBase = perfil && perfil.slug
      ? `https://smartlinkdigital.com.br/${perfil.slug}`
      : `${APP_URL}/agendar.html`;

    const metodo = ['pix', 'dinheiro'].includes(corpo.metodo) ? corpo.metodo : 'cartao';

    if (metodo !== 'dinheiro' && (!barbeiro.mp_conectado || !barbeiro.mp_access_token)) {
      return res.status(400).json({ erro: 'Esse barbeiro ainda não conectou a conta Mercado Pago.' });
    }

    // cria a cobrança no nosso banco primeiro pra ter um id de referência
    const criacao = await fetch(`${SUPABASE_URL}/rest/v1/cobrancas`, {
      method: 'POST',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=representation' },
      body: JSON.stringify({
        owner_id: ownerId,
        barbeiro_id: barbeiro.id,
        cliente_id: clienteId,
        agendamento_id: agendamentoId || null,
        plano_id: planoId || null,
        pedido_id: pedidoId || null,
        descricao,
        valor,
        metodo
      })
    });
    const [cobranca] = await criacao.json();
    if (!cobranca) return res.status(500).json({ erro: 'Não consegui criar o registro da cobrança.' });

    if (metodo === 'dinheiro') {
      // dinheiro fica pendente até o dono marcar como pago manualmente no
      // painel (mesmo padrão do "dinheiro" no fluxo de agendamento) — só aí
      // o estoque é baixado, pra não descontar produto que não foi de fato pago.
      return res.status(200).json({ metodo: 'dinheiro' });
    }

    if (metodo === 'pix') {
      const emailPagador = `cliente-${cobranca.id}@pagamentos-smartagenda.com`;
      const orderResp = await fetch('https://api.mercadopago.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${barbeiro.mp_access_token}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': cobranca.id
        },
        body: JSON.stringify({
          type: 'online',
          total_amount: valor.toFixed(2),
          external_reference: cobranca.id,
          processing_mode: 'automatic',
          transactions: {
            payments: [{ amount: valor.toFixed(2), payment_method: { id: 'pix', type: 'bank_transfer' } }]
          },
          payer: { email: emailPagador },
          description: descricao
        })
      });
      const order = await orderResp.json();
      const pagamento = order.transactions && order.transactions.payments && order.transactions.payments[0];
      const qrCode = pagamento && pagamento.payment_method ? pagamento.payment_method.qr_code : null;
      const qrCodeBase64 = pagamento && pagamento.payment_method ? pagamento.payment_method.qr_code_base64 : null;
      if (!orderResp.ok || !qrCode) {
        return res.status(502).json({ erro: 'O Mercado Pago recusou a criação do Pix.' });
      }

      await fetch(`${SUPABASE_URL}/rest/v1/cobrancas?id=eq.${cobranca.id}`, {
        method: 'PATCH',
        headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
        body: JSON.stringify({
          metodo: 'pix',
          mp_preference_id: order.id,
          mp_qr_code: qrCode,
          mp_qr_code_base64: qrCodeBase64
        })
      });

      return res.status(200).json({ metodo: 'pix', qr_code: qrCode, qr_code_base64: qrCodeBase64, cobranca_id: cobranca.id });
    }

    const prefResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${barbeiro.mp_access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: [{ title: descricao, quantity: 1, unit_price: valor, currency_id: 'BRL' }],
        external_reference: cobranca.id,
        notification_url: `${APP_URL}/api/mp-webhook`,
        back_urls: {
          success: `${linkVoltarBase}?pago=1`,
          pending: `${linkVoltarBase}?pago=pendente`,
          failure: `${linkVoltarBase}?pago=falhou`
        }
      })
    });
    const preferencia = await prefResp.json();
    if (!prefResp.ok || !preferencia.init_point) {
      return res.status(502).json({ erro: 'O Mercado Pago recusou a criação da cobrança.' });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/cobrancas?id=eq.${cobranca.id}`, {
      method: 'PATCH',
      headers: { ...HEADERS_SERVICO, Prefer: 'return=minimal' },
      body: JSON.stringify({ metodo: 'cartao', mp_preference_id: preferencia.id, link_pagamento: preferencia.init_point })
    });

    return res.status(200).json({ metodo: 'cartao', link_pagamento: preferencia.init_point });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro inesperado ao gerar a cobrança.' });
  }
}
