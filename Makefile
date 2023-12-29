#!/usr/bin/make -f
.DEFAULT_GOAL := build

include paths.mk

build: clean

ifeq ($(PACKAGING),)
	npm install
endif
	npm run sass
	npm run browserify

	# collectstatic
	rsync -a $(SRC_CLIENT_STATIC) $(DIST_CLIENT)

	# collectserver
	rsync -a $(SRC_SERVER) $(DIST_SERVER)

	# linkexercises
	ln -srf $(SRC_EXERCISES) $(DIST_EXERCISES)

run: build
	sudo -u gitstream node dist/server/main

install:
	npm prune --omit=dev
	mkdir -p $(GSDIRS) $(NGINXLOGS)
ifneq ($(DEST), $(SRC))
	cp -R dist $(DEST)
	cp -R node_modules $(DEST)
	cp nginx-deployed.conf $(DEST)
	cp -R gitstream-exercises git-angler git-http-backend $(DEST)
	cp gitstream.pem $(DEST)
	cp settings.js $(DEST)
endif
	touch $(GSLOGS)

ifeq ($(PACKAGING),)
ifeq ($(GITSTREAM_USER), 1)
	useradd -m gitstream
	su gitstream -lc 'git config --global user.email "gitstream@gitstream.csail.mit.edu"'
	su gitstream -lc 'git config --global user.name "GitStream"'
endif
	chown -R gitstream:gitstream $(GSDIRS) $(GSLOGS)
	ln -sf /opt/gitstream/nginx-deployed.conf /etc/nginx/nginx.conf
endif

uninstall:
	rm -rf $(GSDIRS) $(GSLOGS) $(DESTDIR)/var/opt/gitstream
	sudo su gitstream -lc 'kill -15 -1'
	-userdel -r gitstream > /dev/null 2>&1

clean:
	rm -rf dist
