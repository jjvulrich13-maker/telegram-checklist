FROM node:18-alpine

WORKDIR /app

# Копировать всё из корня проекта
COPY . .

# Установить зависимости
RUN npm install --production

# Слушать порт
EXPOSE 8080

# Запустить
CMD ["node", "server.js"]
