FROM node:20-alpine

WORKDIR /app

# 先拷贝依赖清单（容器启动时据此安装依赖）
COPY package.json package-lock.json ./

# 容器启动时安装依赖（仅生产依赖），随后启动服务
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 拷贝应用代码
COPY . .

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
