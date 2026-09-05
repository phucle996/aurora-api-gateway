.PHONY: check rust-check go-check ui-install ui-build ui controller ffi-smoke build nginx-check run run-controller run-nginx stop status smoke module module-test compiler rules-init rules-test

NGINX ?= $(shell command -v nginx)

.PHONY: create-rule-test
create-rule-test: go-check
	node ui/tests/create-rule.mjs

check: rust-check go-check ffi-smoke ui-build

rust-check:
	cargo fmt --all -- --check
	cargo clippy --workspace --all-targets -- -D warnings
	cargo test --workspace

go-check: ui-build compiler
	cd control-plane && AURORA_TEST_COMPILER="$(CURDIR)/target/release/aurora-compile" go test ./...
	cd control-plane && go vet ./...
	cd control-plane && go build -buildvcs=false -o ../build/aurora-controller ./cmd

compiler:
	cargo build --locked -p aurora-engine --bin aurora-compile --release

rules-init:
	node scripts/init-rules-runtime.mjs

rules-test: module compiler
	cd control-plane && AURORA_TEST_COMPILER="$(CURDIR)/target/release/aurora-compile" AURORA_TEST_NGINX="$(NGINX)" AURORA_TEST_MODULE="$(CURDIR)/build/modules/ngx_http_aurora_waf_module.so" go test -race -count=1 -v ./internal/test/integration

ui-install:
	cd ui && npm ci

ui-build:
	cd ui && npm run build

ui:
	cd ui && npm run dev

controller: ui-build
	cd control-plane && go run -buildvcs=false ./cmd

ffi-smoke:
	cargo build -p aurora-ffi
	mkdir -p build
	$(CC) -std=c11 -Wall -Wextra -Werror adapters/nginx/tests/ffi_smoke.c -Iadapters/nginx/include -Ltarget/debug -laurora_ffi -Wl,-rpath,'$$ORIGIN/../target/debug' -o build/ffi-smoke
	./build/ffi-smoke

# Local foundation workflow: build artifacts, validate config, start user services.
build: go-check module
	cargo build --workspace --release

module:
	bash scripts/build-nginx-module.sh

module-test: module
	NGINX="$(NGINX)" node scripts/test-nginx-module.mjs

nginx-check:
	test -n "$(NGINX)"
	mkdir -p build/runtime
	"$(NGINX)" -e stderr -p "$(CURDIR)/" -c deploy/nginx/nginx.conf -t

run: nginx-check
	$(MAKE) run-controller
	$(MAKE) run-nginx
	$(MAKE) smoke

run-controller:
	test -x build/aurora-controller
	test -f control-plane/data/admin.token
	systemd-run --user --collect --unit=aurora-waf-controller --working-directory="$(CURDIR)/control-plane" --setenv=AURORA_HTTP_ADDR=127.0.0.1:8080 --setenv=AURORA_SQLITE_PATH="$(CURDIR)/control-plane/data/aurora.db" --setenv=AURORA_ADMIN_TOKEN_FILE="$(CURDIR)/control-plane/data/admin.token" --setenv=AURORA_COMPILER_PATH="$(CURDIR)/target/release/aurora-compile" --property=TimeoutStopSec=10 "$(CURDIR)/build/aurora-controller"
	curl --fail --silent --show-error --retry 10 --retry-delay 1 --retry-all-errors --max-time 3 http://127.0.0.1:8080/readyz

run-nginx: nginx-check
	systemd-run --user --collect --unit=aurora-waf-nginx --working-directory="$(CURDIR)" --property=KillSignal=SIGQUIT --property=TimeoutStopSec=10 "$(NGINX)" -e stderr -p "$(CURDIR)/" -c deploy/nginx/nginx.conf -g 'daemon off;'

stop:
	systemctl --user stop aurora-waf-nginx.service aurora-waf-controller.service

status:
	systemctl --user --no-pager status aurora-waf-nginx.service aurora-waf-controller.service

smoke:
	curl --fail --silent --show-error --retry 10 --retry-delay 1 --retry-all-errors --max-time 3 --output /dev/null http://127.0.0.1:8080/
	curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8080/readyz
	curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8080/api/v1/status
	curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8090/ok
	test "$$(curl --silent --show-error --max-time 3 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8090/__aurora_blocked)" = 403
