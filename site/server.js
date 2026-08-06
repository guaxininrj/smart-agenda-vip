import express from 'express';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const apiRoutes = [
  'mp-criar-cobranca',
  'plano-cliente',
  'infinitepay-checkout',
  'expirar-assinaturas',
  'infinitepay-webhook',
  'infinitepay-confirmar-retorno',
  'backup-diario'
];

for (const route of apiRoutes) {
  const mod = await import(`./api/${route}.js`);
  app.all(`/api/${route}`, mod.default);
}

app.get('/:slug([a-z0-9-]+-[a-f0-9]{6})', (req, res) => {
  res.sendFile(path.join(__dirname, 'agendar.html'));
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).end();
  next();
});

app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache, must-revalidate, max-age=0, no-store');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
  }
}));

async function executarCron(nomeRota) {
  try {
    const mod = await import(`./api/${nomeRota}.js`);
    const req = { method: 'GET', query: {}, body: {}, headers: {} };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(d) { console.log(`[cron] ${nomeRota}:`, JSON.stringify(d)); },
      send() {},
      end() {},
      setHeader() { return this; },
      writeHead() {}
    };
    await mod.default(req, res);
    console.log(`[cron] ${nomeRota} executado`);
  } catch (e) {
    console.error(`[cron] erro em ${nomeRota}:`, e.message);
  }
}

cron.schedule('0 6 * * *', () => executarCron('expirar-assinaturas'));
cron.schedule('0 7 * * *', () => executarCron('backup-diario'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Barber Book rodando na porta ${PORT}`);
});
