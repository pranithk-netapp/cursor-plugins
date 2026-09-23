SHELL := /bin/bash
EXT_NAME := open-api-viewer

.PHONY: help install compile test test-unit clean package vsix

help:
	@echo "Targets:"
	@echo "  install   - install npm dependencies"
	@echo "  compile   - compile extension TypeScript"
	@echo "  test      - run unit tests then extension (test-electron) tests"
	@echo "  test-unit - run unit tests only (no vscode dependency)"
	@echo "  clean     - remove dist/out/media build output and generated vsix files"
	@echo "  package   - build a new VSIX file (use VERSION=x.y.z)"
	@echo "  vsix      - alias for package"
	@echo ""
	@echo "Examples:"
	@echo "  make vsix VERSION=0.1.1"
	@echo "  make vsix    # auto-picks next minor from latest .vsix"
	@echo "  (also updates package.json/package-lock.json version)"

install:
	npm install

compile:
	npm run compile

test:
	npm test

test-unit:
	npm run test:unit

clean:
	rm -rf dist
	rm -rf out
	rm -rf media/dist
	rm -rf media/swagger-ui
	rm -f $(EXT_NAME)-*.vsix

package: compile
	@VERSION_TO_USE="$(VERSION)"; \
	if [ -z "$$VERSION_TO_USE" ]; then \
		LATEST_VSIX=$$(ls -1 "$(EXT_NAME)-"*.vsix 2>/dev/null | sed -E 's/^$(EXT_NAME)-([0-9]+\.[0-9]+\.[0-9]+)\.vsix$$/\1/' | sort -V | tail -n 1); \
		if [ -z "$$LATEST_VSIX" ]; then \
			LATEST_VSIX=$$(node -p "require('./package.json').version"); \
		fi; \
		VERSION_TO_USE=$$(node -e "const [a,b]=process.argv[1].split('.').map(Number); if (!Number.isFinite(a)||!Number.isFinite(b)) process.exit(1); console.log(a + '.' + (b + 1) + '.0');" "$$LATEST_VSIX"); \
		echo "Auto-selected VERSION=$$VERSION_TO_USE (from base $$LATEST_VSIX)"; \
	fi; \
	VSIX_FILE="$(EXT_NAME)-$$VERSION_TO_USE.vsix"; \
	CURRENT_VERSION=$$(node -p "require('./package.json').version"); \
	if [ "$$CURRENT_VERSION" != "$$VERSION_TO_USE" ]; then \
		echo "Updating extension version $$CURRENT_VERSION -> $$VERSION_TO_USE"; \
		npm version "$$VERSION_TO_USE" --no-git-tag-version; \
	else \
		echo "Extension version already $$VERSION_TO_USE"; \
	fi; \
	npm run package -- --allow-package-all-secrets --out "$$VSIX_FILE"; \
	echo "Generated $$VSIX_FILE"

vsix: package
