FROM node:12.5-alpine

RUN apk update && apk upgrade && \
    apk add --no-cache bash git openssh tzdata

COPY package.json package.json
COPY package-lock.json package-lock.json
COPY runner.js runner.js
COPY app.js app.js

RUN npm i --production

CMD npm start
