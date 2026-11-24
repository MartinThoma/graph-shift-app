PORT ?= 4173

.PHONY: run dev build test e2e

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

## run: build and serve the production app on all interfaces, printing the reachable URLs
## (uses the next free port if PORT is taken)
run: build
	@PORT=$(PORT) node scripts/serve.mjs

## dev: start the Vite dev server (hot reload, no service worker)
dev: node_modules
	npx vite --host 0.0.0.0

build: node_modules
	npm run build

test: node_modules
	npm test

e2e: build
	npm run test:e2e
