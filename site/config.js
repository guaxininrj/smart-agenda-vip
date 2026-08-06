const SUPABASE_URL = 'https://supabase.smartlinkdigital.com.br';
const SUPABASE_ANON_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5ZnRqZndndmV1bnl6bGhxYWdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU1MTc5MjAsImV4cCI6NDkwMTE5MTUyMH0.e_HxdxeX9Aaxnf4-2kpYMSeNfyk5uJro-1yE9bu4EGk';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const sbPublic = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

// URL absoluta do backend (funções de pagamento etc) — usar sempre isso em
// vez de caminho relativo tipo "/api/...". Quando a página está embutida em
// smartlinkdigital.com.br, um caminho relativo pode disparar o redirect
// apex->www do domínio, que o navegador trata como troca de origem e
// bloqueia o fetch por CORS no meio do caminho.
// Self-hosted: server.js já expõe as rotas /api/* nesse mesmo container
// (Express, ver server.js), então o backend é o próprio domínio do app.
const MP_API_URL = 'https://agenda.smartlinkdigital.com.br';

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
