// Chamado pelo Mercado Pago depois que o barbeiro loga e autoriza a conexão.
// Troca o "code" por um access_token (isso só pode ser feito aqui no servidor,
// porque exige o client_secret — nunca deve rodar no navegador) e salva no
// barbeiro correspondente (identificado pelo "state" enviado na hora de gerar o link).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MP_CLIENT_ID = process.env.MP_CLIENT_ID;
const MP_CLIENT_SECRET = process.env.MP_CLIENT_SECRET;
const MP_REDIRECT_URI = process.env.MP_REDIRECT_URI;
const URL_RETORNO = process.env.APP_URL || 'https://barberbook-smartlink.vercel.app';

function paginaErro(mensagem) {
  return `<!doctype html><html><body style="font-family:sans-serif;background:#060607;color:#fff;padding:40px;text-align:center;">
    <h2>Não foi possível conectar</h2><p>${mensagem}</p>
    <a href="${URL_RETORNO}/index.html" style="color:#fff;">Voltar ao painel</a>
  </body></html>`;
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    res.status(200).setHeader('Content-Type', 'text/html');
    return res.send(paginaErro('O barbeiro cancelou a autorização no Mercado Pago.'));
  }
  if (!code || !state) {
    res.status(400).setHeader('Content-Type', 'text/html');
    return res.send(paginaErro('Link de retorno inválido (faltando code ou state).'));
  }
  if (!MP_CLIENT_ID || !MP_CLIENT_SECRET) {
    res.status(200).setHeader('Content-Type', 'text/html');
    return res.send(paginaErro('A integração com o Mercado Pago ainda não foi configurada pelo administrador do sistema.'));
  }

  const barbeiroId = state;

  try {
    const tokenResp = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: MP_CLIENT_ID,
        client_secret: MP_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: MP_REDIRECT_URI
      })
    });
    const dados = await tokenResp.json();
    if (!tokenResp.ok || !dados.access_token) {
      console.error('[mp-callback] token exchange falhou', tokenResp.status, JSON.stringify(dados));
      res.status(200).setHeader('Content-Type', 'text/html');
      return res.send(paginaErro('O Mercado Pago recusou a autorização. Tente novamente.'));
    }

    const expiraEm = new Date(Date.now() + (dados.expires_in || 0) * 1000).toISOString();
    const atualizacao = await fetch(`${SUPABASE_URL}/rest/v1/barbeiros?id=eq.${barbeiroId}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        mp_conectado: true,
        mp_user_id: String(dados.user_id || ''),
        mp_access_token: dados.access_token,
        mp_refresh_token: dados.refresh_token || null,
        mp_token_expira_em: expiraEm
      })
    });
    if (!atualizacao.ok) {
      res.status(200).setHeader('Content-Type', 'text/html');
      return res.send(paginaErro('A conexão foi autorizada, mas não consegui salvar no sistema. Fale com o suporte.'));
    }

    res.writeHead(302, { Location: `${URL_RETORNO}/index.html?mp=conectado` });
    return res.end();
  } catch (e) {
    res.status(200).setHeader('Content-Type', 'text/html');
    return res.send(paginaErro('Erro inesperado ao conectar com o Mercado Pago.'));
  }
}
