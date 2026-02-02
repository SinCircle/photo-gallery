FROM node:20 AS build

WORKDIR /src

RUN npm update -g npm

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && ln -sf /usr/bin/python3 /usr/local/bin/python \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

RUN pip3 install --no-cache-dir Pillow piexif

RUN npm run build

FROM scratch AS output
COPY --from=build /src/dist /dist
