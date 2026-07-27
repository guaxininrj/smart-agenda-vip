#!/bin/bash
# Deploy do Barber Book pra produção — SEMPRE use este script em vez de
# "vercel --prod" direto.
#
# Por quê: barberbook-smartlink.vercel.app é um alias MANUAL (criado com
# `vercel alias set`), não um domínio de verdade do projeto. Isso significa
# que ele NÃO atualiza sozinho a cada deploy — e esse é o endereço que o
# OAuth do Mercado Pago tem registrado como redirect_uri (index.html usa
# esse mesmo domínio pra bater com o MP_REDIRECT_URI configurado no painel
# do Mercado Pago). Não dá pra trocar de domínio sem reconfigurar isso lá,
# então a solução é garantir que o alias nunca fique desatualizado.
set -e

cd "$(dirname "$0")"

echo "Publicando..."
SAIDA=$(npx vercel --prod --yes 2>&1)
echo "$SAIDA"

DEPLOY_URL=$(echo "$SAIDA" | grep -oE 'https://barber-book-[a-zA-Z0-9]+-guaxininrjgamer-6416s-projects\.vercel\.app' | tail -1)

if [ -z "$DEPLOY_URL" ]; then
  echo "ERRO: não consegui identificar a URL do novo deploy na saída acima."
  echo "Rode manualmente: vercel alias set <url-do-deploy> barberbook-smartlink.vercel.app"
  exit 1
fi

echo "Apontando barberbook-smartlink.vercel.app pra $DEPLOY_URL ..."
npx vercel alias set "$DEPLOY_URL" barberbook-smartlink.vercel.app

echo "Pronto. Produção e alias sincronizados."
