#!/bin/sh
# Launch the local game using an installed Node or the Codex-bundled runtime.
cd "$(dirname "$0")" || exit 1
node_binary=$(command -v node)
if [ -z "$node_binary" ]; then
  node_binary="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ ! -x "$node_binary" ]; then
  printf '%s\n' 'Instala Node.js 22.12 o posterior y ejecuta pnpm install en esta carpeta.'
  read -r answer
  exit 1
fi
if [ ! -f node_modules/vite/bin/vite.js ]; then
  printf '%s\n' 'Faltan las dependencias. Ejecuta pnpm install en esta carpeta.'
  read -r answer
  exit 1
fi
printf '%s\n' 'Rok & Role: deja esta ventana abierta mientras juegas. Ctrl+C para cerrar.'
exec "$node_binary" node_modules/vite/bin/vite.js --host 127.0.0.1 --open
