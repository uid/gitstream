#!/usr/bin/make -f
.DEFAULT_GOAL := build

include paths.mk

REBUILD_EXERCISES=1 # yes by default

build: clean

ifeq ($(REBUILD_EXERCISES),1)
	gitstream-exercises/createx.js
endif

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

	npm test

run: build
	sudo -u gitstream node dist/server/main

install: build
	npm prune --omit=dev
	sudo mkdir -p $(DEST) $(REPOS) $(MONGO) $(NGINXLOGS)
ifneq ($(DEST), $(SRC))
	sudo cp -R dist $(DEST)
	sudo cp -R node_modules $(DEST)
	sudo cp nginx-deployed.conf $(DEST)
	sudo cp -R gitstream-exercises git-angler git-http-backend $(DEST)
	sudo cp src/secrets/gitstream.pem $(DEST)
	sudo cp src/secrets/settings.js $(DEST)
endif
	sudo touch $(GSLOGS)

ifeq ($(PACKAGING),)
ifeq ($(GITSTREAM_USER), 1)
	sudo useradd -m gitstream
	sudo -u gitstream git config --global user.email "gitstream@gitstream.csail.mit.edu"
	sudo -u gitstream git config --global user.name "GitStream"
endif
	sudo chown -R gitstream:gitstream $(DEST)
	sudo chown gitstream:gitstream $(REPOS) $(MONGO) $(GSLOGS)
	sudo ln -sf /opt/gitstream/nginx-deployed.conf /etc/nginx/nginx.conf
endif

uninstall:
	sudo rm -rf $(DEST) $(REPOS) $(GSLOGS) $(DESTDIR)/var/opt/gitstream
	sudo -u gitstream kill -15 -1
	-sudo userdel -r gitstream > /dev/null 2>&1

clean:
	rm -rf dist
