#!/bin/bash
# Roda toda a suíte de testes automatizados (Barber Book + Smart Link).
#
# Uso:
#   ./tests/run_todos.sh
#   PAINEL_SECRET=xxxxx ./tests/run_todos.sh   (também testa "senha certa -> 200")
#
# Não precisa de nenhuma dependência instalada (npx supabase já é usado no
# resto do projeto; os testes JS usam só o fetch nativo do Node).
set -uo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$(dirname "$AQUI")"
SMARTLINK_API_DIR="$SITE_DIR/../../SMART LINK/bot/codigo"

TOTAL=0
FALHAS=0

rodar() {
  local nome="$1"; shift
  TOTAL=$((TOTAL+1))
  echo "── $nome ──────────────────────────────────────"
  if "$@"; then
    echo "✅ $nome passou"
  else
    echo "❌ $nome FALHOU"
    FALHAS=$((FALHAS+1))
  fi
  echo ""
}

rodar "RLS — isolamento entre contas" npx supabase db query --linked --file "$AQUI/rls_isolamento.sql"
rodar "Grants de anon no mínimo necessário" npx supabase db query --linked --file "$AQUI/grants_anon.sql"
rodar "Financeiro — janela por concluido_em" npx supabase db query --linked --file "$AQUI/financeiro_logica.sql"
rodar "Segurança dos endpoints do painel" node "$SMARTLINK_API_DIR/tests/seguranca_endpoints.js"

echo "================================================"
if [ "$FALHAS" -gt 0 ]; then
  echo "❌ $FALHAS de $TOTAL suíte(s) falharam."
  exit 1
fi
echo "✅ Todas as $TOTAL suítes passaram."
