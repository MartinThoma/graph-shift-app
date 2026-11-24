PORT ?= 4173

.PHONY: run dev build test e2e

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

## run: build and serve the production app on all interfaces, printing the reachable URLs
run: build
	@echo ""
	@echo "Graph Shift is reachable at:"
	@echo "  http://localhost:$(PORT)/"
	@for ip in $$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null) | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$$'); do \
		echo "  http://$$ip:$(PORT)/"; \
	done
	@echo "(Offline mode needs a service worker, which browsers allow only on localhost or HTTPS.)"
	@echo ""
	@npx vite preview --host 0.0.0.0 --port $(PORT) --strictPort --logLevel warn

## dev: start the Vite dev server (hot reload, no service worker)
dev: node_modules
	npx vite --host 0.0.0.0

build: node_modules
	npm run build

test: node_modules
	npm test

e2e: build
	npm run test:e2e
