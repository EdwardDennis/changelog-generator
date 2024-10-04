FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache wget tar

ENV OASDIFF_VERSION=1.10.25

RUN wget https://github.com/tufin/oasdiff/releases/download/v${OASDIFF_VERSION}/oasdiff_${OASDIFF_VERSION}_linux_amd64.tar.gz

RUN tar -xzf oasdiff_${OASDIFF_VERSION}_linux_amd64.tar.gz -C /usr/local/bin

RUN rm oasdiff_${OASDIFF_VERSION}_linux_amd64.tar.gz

RUN chmod +x /usr/local/bin/oasdiff

RUN oasdiff --version

COPY package.json package-lock.json ./

RUN npm install

COPY . .

RUN npm run build

CMD ["npm", "start"]
