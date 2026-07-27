// Envio de e-mail transacional (comprovante de pagamento da assinatura da
// plataforma) — usado por infinitepay-webhook.js e
// infinitepay-confirmar-retorno.js depois de confirmar um pagamento.
// Falha aqui nunca deve travar a liberação do acesso: sempre falha em
// silêncio (só loga), porque o e-mail é um extra, não algo crítico.
//
// Usa a API HTTP do Resend em vez de SMTP: em função serverless o SMTP tem
// handshake lento e sujeito a timeout, e a API é uma chamada HTTP simples
// com o fetch nativo (sem dependência extra).
//
// Por que Resend e não o SMTP do Zoho (que também temos configurado):
// o Zoho no plano grátis envia por IPs compartilhados que a Microsoft
// limita por reputação — e-mail pra Outlook/Hotmail/Live não chegava
// (erro 4.7.650 "temporarily rate limited due to IP reputation").
// O Zoho continua sendo a caixa de entrada de suporte@ (receber e
// responder); só o envio automático saiu de lá.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const REMETENTE = 'Smart Agenda VIP <suporte@smartlinkdigital.com.br>';

async function enviar({ para, assunto, texto, html }) {
  if (!RESEND_API_KEY || !para) return;
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: REMETENTE, to: [para], subject: assunto, text: texto, html })
  });
  if (!resp.ok) throw new Error(`Resend respondeu ${resp.status}: ${await resp.text()}`);
}

export async function enviarEmailComprovante({ paraEmail, nomeBarbearia, planoNome, valor, linkRecibo }) {
  try {
    const valorFmt = 'R$ ' + Number(valor).toFixed(2).replace('.', ',');
    await enviar({
      para: paraEmail,
      assunto: 'Pagamento confirmado — Smart Agenda VIP',
      texto:
        `Olá!\n\nO pagamento da sua assinatura do Smart Agenda VIP foi confirmado.\n\n` +
        `Barbearia: ${nomeBarbearia}\nPlano: ${planoNome}\nValor: ${valorFmt}\n\n` +
        (linkRecibo ? `Comprovante: ${linkRecibo}\n\n` : '') +
        `Seu acesso já está liberado por mais 30 dias.\n\nQualquer dúvida, é só responder este e-mail.`,
      html:
        `<p>Olá!</p><p>O pagamento da sua assinatura do <b>Smart Agenda VIP</b> foi confirmado.</p>` +
        `<p><b>Barbearia:</b> ${nomeBarbearia}<br><b>Plano:</b> ${planoNome}<br><b>Valor:</b> ${valorFmt}</p>` +
        (linkRecibo ? `<p><a href="${linkRecibo}">Ver comprovante de pagamento</a></p>` : '') +
        `<p>Seu acesso já está liberado por mais 30 dias.</p><p>Qualquer dúvida, é só responder este e-mail.</p>`
    });
  } catch (erro) {
    console.error('[email] falha ao enviar comprovante:', erro.message);
  }
}
