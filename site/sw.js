// Service worker minimo: só existe pra permitir "instalar" o Smart Agenda VIP
// como app no celular (barbeiro) e a página de agendamento (cliente). De
// propósito NÃO cacheia nada — agenda, comanda, fila e financeiro mudam a
// cada segundo, cache aqui só ia mostrar dado desatualizado.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
