#!/bin/sh
set -e

# 依赖随容器启动安装：node_modules 由命名卷持久化，
# 已安装时跳过，首次启动或缺少 express 时自动安装。
if [ ! -d node_modules ] || [ ! -d node_modules/express ]; then
  echo "首次启动，正在安装依赖…"
  npm install --omit=dev
fi

exec "$@"
