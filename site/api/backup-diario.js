// Backup diário do banco, enviado por e-mail (Resend) como anexo JSON.
//
// Por que existe: o plano Free do Supabase não tem backup automático. Perder
// a conta da Vercel ou do Supabase se resolve republicando em outro lugar;
// perder os DADOS dos clientes (agendamentos, histórico financeiro) não tem
// volta. Isso cobre o único risco irreversível enquanto o plano pago
// (que traz backup nativo) não fizer sentido financeiro.
//
// Roda 1x por dia via Vercel Cron (ver "crons" em vercel.json).
//
// Importante sobre privacidade: o anexo contém dados pessoais dos clientes
// das barbearias (nome e telefone). Vai só pro e-mail do dono da plataforma,
// nunca pra terceiros — mas é bom saber que esse e-mail passa a ser um
// repositório de dado pessoal, e a caixa precisa de senha forte.
//
// Restauração: o JSON tem uma chave por tabela, cada uma com as linhas como
// vieram da API. Pra restaurar, é um POST em /rest/v1/<tabela> com o array,
// respeitando a ordem de dependência (perfis e barbeiros antes de
// agendamentos, pedidos antes de pedido_itens, etc).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const PARA = process.env.EMAIL_BACKUP || 'suporte@smartlinkdigital.com.br';

// ordem pensada pra restauração: dependências primeiro
const TABELAS = [
  'planos_plataforma', 'perfis', 'barbeiros', 'servicos', 'produtos', 'planos',
  'lojas', 'clientes', 'assinaturas', 'agendamentos', 'agendamento_servicos',
  'pedidos', 'pedido_itens', 'cobrancas', 'despesas', 'pedidos_plataforma'
];

const HEADERS_SERVICO = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json'
};

const LIMITE_ANEXO_MB = 25; // Resend aceita até ~40MB; margem de segurança

// agendamento_servicos é a única tabela sem coluna "id" — usa a chave dela
// pra ordenar. Ordenar importa: sem ordem estável, paginar com Range pode
// repetir ou pular linhas quando a tabela cresce.
const ORDEM = { agendamento_servicos: 'agendamento_id' };

async function baixarTabela(tabela) {
  // pagina de 1000 em 1000 (limite padrão do PostgREST) pra não truncar
  const ordenarPor = ORDEM[tabela] || 'id';
  const linhas = [];
  let de = 0;
  for (;;) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?select=*&order=${ordenarPor}`, {
      headers: { ...HEADERS_SERVICO, Range: `${de}-${de + 999}` }
    });
    if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${await resp.text()}`);
    const parte = await resp.json();
    linhas.push(...parte);
    if (parte.length < 1000) break;
    de += 1000;
  }
  return linhas;
}

// e-mails de login (ficam em auth.users, fora do schema public). Guarda só id
// e e-mail — o hash da senha NÃO vai no backup de propósito: mandar hash de
// senha por e-mail seria risco desnecessário. Numa restauração, os donos
// refazem a senha pelo "esqueci minha senha".
async function baixarLogins() {
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: HEADERS_SERVICO });
    if (!resp.ok) return [];
    const dados = await resp.json();
    return (dados.users || []).map((u) => ({ id: u.id, email: u.email, criado_em: u.created_at }));
  } catch (e) {
    return [];
  }
}

export default async function handler(req, res) {
  const autorizado = req.headers.authorization === `Bearer ${CRON_SECRET}` || req.query.chave === CRON_SECRET;
  if (!CRON_SECRET || !autorizado) return res.status(401).json({ erro: 'não autorizado' });

  try {
    const backup = { gerado_em: new Date().toISOString(), tabelas: {} };
    const resumo = [];

    for (const tabela of TABELAS) {
      const linhas = await baixarTabela(tabela);
      backup.tabelas[tabela] = linhas;
      resumo.push(`${tabela}: ${linhas.length}`);
    }
    backup.logins = await baixarLogins();
    resumo.push(`logins: ${backup.logins.length}`);

    const json = JSON.stringify(backup);
    const tamanhoMB = Buffer.byteLength(json) / 1024 / 1024;
    const dia = new Date().toISOString().slice(0, 10);

    if (!RESEND_API_KEY) return res.status(500).json({ erro: 'RESEND_API_KEY não configurada' });

    const grandeDemais = tamanhoMB > LIMITE_ANEXO_MB;
    const corpo = grandeDemais
      ? `O backup de ${dia} ficou com ${tamanhoMB.toFixed(1)} MB e passou do limite de anexo (${LIMITE_ANEXO_MB} MB), então NÃO foi anexado.\n\nIsso significa que o banco cresceu — é hora de mudar pra um backup em armazenamento de verdade (ou assinar o plano Pro do Supabase, que faz backup automático).\n\nConteúdo do que seria o backup:\n${resumo.join('\n')}`
      : `Backup do Smart Agenda VIP de ${dia} em anexo (${tamanhoMB.toFixed(2)} MB).\n\nConteúdo:\n${resumo.join('\n')}\n\nGuarde este e-mail. Pra restaurar, o anexo tem uma chave por tabela.`;

    const respEmail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Smart Agenda VIP <suporte@smartlinkdigital.com.br>',
        to: [PARA],
        subject: `${grandeDemais ? '⚠️ ' : ''}Backup do banco — ${dia}`,
        text: corpo,
        attachments: grandeDemais ? [] : [{ filename: `backup-smart-agenda-${dia}.json`, content: Buffer.from(json).toString('base64') }]
      })
    });

    if (!respEmail.ok) throw new Error(`Resend: ${respEmail.status} ${await respEmail.text()}`);

    return res.status(200).json({ ok: true, tamanho_mb: Number(tamanhoMB.toFixed(2)), anexado: !grandeDemais, resumo });
  } catch (erro) {
    console.error('[backup] falhou:', erro.message);
    // avisa por e-mail que o backup falhou — silêncio aqui seria pior que o erro
    if (RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Smart Agenda VIP <suporte@smartlinkdigital.com.br>',
          to: [PARA],
          subject: '⚠️ FALHA no backup do banco',
          text: `O backup automático de hoje falhou:\n\n${erro.message}\n\nOs dados continuam no ar (isso não afeta o sistema), mas hoje não há cópia de segurança.`
        })
      }).catch(() => {});
    }
    return res.status(500).json({ erro: erro.message });
  }
}
