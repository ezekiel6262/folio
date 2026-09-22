#!/usr/bin/env bash
# Deploys (or upgrades) the folio_vault program to Solana mainnet. Run inside WSL/Linux:
#
#   bash solana/scripts/deploy.sh            preflight only: checks keys, balance, binary
#   bash solana/scripts/deploy.sh --send     actually deploy
#
# Uses solana/.keys/program.json as the program id and solana/.keys/deployer.json as payer
# and upgrade authority. Neither key leaves this machine. RPC: HELIUS_API_KEY from .env.solana.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
export PATH="$HOME/.local/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Strip Windows line endings: the file is usually edited on Windows.
[ -f "$ROOT/.env.solana" ] && set -a && . <(tr -d '\r' < "$ROOT/.env.solana") && set +a
RPC="${SOLANA_RPC_URL:-}"
[ -n "${HELIUS_API_KEY:-}" ] && RPC="https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}"
[ -z "$RPC" ] && { echo "Set HELIUS_API_KEY (or SOLANA_RPC_URL) in .env.solana — public mainnet RPC rate-limits deploys."; exit 1; }

PROGRAM_KEY="$HERE/.keys/program.json"
DEPLOYER_KEY="$HERE/.keys/deployer.json"
SO="${FOLIO_SO:-$HOME/.folio-target/deploy/folio_vault.so}"
EXPECTED_ID="GJY26YALBaMdimL4Kk4Abo26BNkrSVMrC2wA46TRoXnD"
EXPECTED_ADMIN="D3agrnhRwhHuni37ujsHCcmQHGznN8UxwtWwLzZQKq9G"

id=$(solana-keygen pubkey "$PROGRAM_KEY")
admin=$(solana-keygen pubkey "$DEPLOYER_KEY")
[ "$id" = "$EXPECTED_ID" ] || { echo "program.json is $id, expected $EXPECTED_ID"; exit 1; }
[ "$admin" = "$EXPECTED_ADMIN" ] || { echo "deployer.json is $admin, expected $EXPECTED_ADMIN"; exit 1; }
[ -f "$SO" ] || { echo "No binary at $SO — run cargo build-sbf first"; exit 1; }

size=$(stat -c %s "$SO")
need=$(solana rent "$size" --lamports | awk '/Rent-exempt/{print $3}')
need=$((need + 30000000)) # + ~0.03 SOL for write transactions, priority fees, config and assets
have=$(solana balance "$admin" --url "$RPC" --lamports | awk '{print $1}')
existing=$(solana program show "$id" --url "$RPC" 2>/dev/null | awk '/Authority/{print $2}' || true)

echo "program   $id  ${existing:+(already deployed, authority $existing — this will UPGRADE it)}"
echo "binary    $SO  ($size bytes)"
echo "deployer  $admin  balance $(awk "BEGIN{print $have/1e9}") SOL, needs ~$(awk "BEGIN{print $need/1e9}") SOL"

if [ "$have" -lt "$need" ]; then
  echo "Not enough SOL on the deployer yet."
  exit 1
fi
if [ "${1:-}" != "--send" ]; then
  echo "Preflight OK. Re-run with --send to deploy."
  exit 0
fi

solana program deploy "$SO" \
  --program-id "$PROGRAM_KEY" \
  --keypair "$DEPLOYER_KEY" \
  --upgrade-authority "$DEPLOYER_KEY" \
  --url "$RPC" \
  --with-compute-unit-price 20000 \
  --max-sign-attempts 50 \
  --use-rpc

solana program show "$id" --url "$RPC"
