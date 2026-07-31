const SUPABASE_URL = 'https://zyftjfwgveunyzlhqhgq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5ZnRqZndndmV1bnl6bGhxaGdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2Mzk5NzYsImV4cCI6MjEwMDIxNTk3Nn0.Y4mI6vLMAAGBuMmI9gMZaz9s1h2TIUaT3SNcnTDAZDU';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const sbPublic = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

// URL absoluta do backend (funções de pagamento etc) — usar sempre isso em
// vez de caminho relativo tipo "/api/...". Quando a página está embutida em
// smartlinkdigital.com.br, um caminho relativo pode disparar o redirect
// apex->www do domínio, que o navegador trata como troca de origem e
// bloqueia o fetch por CORS no meio do caminho.
// IMPORTANTE: barberbook-smartlink.vercel.app é um alias MANUAL (vercel
// alias set), não um domínio de verdade do projeto — por isso NÃO acompanha
// deploys novos sozinho. Depois de todo "vercel --prod" nesse projeto, rodar
// de novo: vercel alias set <url-do-deploy-novo> barberbook-smartlink.vercel.app
// (senão OAuth do Mercado Pago, webhook e essa URL ficam presos numa versão velha).
const MP_API_URL = 'https://barberbook-smartlink.vercel.app';

// Navega preservando o prefixo /smart-agenda quando o app está embutido
// no site da Smart Link (evita quebrar com o cleanUrls colapsando index.html
// pro diretório pai, o que deixa login.html e index.html em profundidades
// diferentes de path relativo).
function irPara(pagina) {
  // location.origin + caminho absoluto: o <base> (usado pra config.js/logo.png
  // carregarem certo quando embutido) também afeta caminhos relativos tipo
  // "/foo", então aqui precisa ser uma URL completa pra ignorar o <base>.
  var partes = location.pathname.split('/').filter(Boolean);
  var prefixo = partes[0] === 'smart-agenda' ? '/smart-agenda/' : '/';
  location.href = location.origin + prefixo + pagina;
}
