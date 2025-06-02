# syntax=docker/dockerfile:1

ARG NODE_VERSION=22.10.0

FROM node:${NODE_VERSION}

WORKDIR /opt/gitstream

RUN apt-get update && apt-get install -y nginx rsync
COPY ./nginx-dev.conf /etc/nginx/nginx.conf
RUN useradd -m gitstream
RUN mkdir -p /srv/repos
RUN chown -R gitstream:gitstream /srv/repos /var/log/nginx

COPY . .
RUN chown -R gitstream:gitstream .

USER gitstream
RUN git config --global user.email "gitstream@csail.mit.edu"
RUN git config --global user.name "GitStream"

RUN make build

USER root
CMD nginx && su gitstream -c 'node dist/server/main'
