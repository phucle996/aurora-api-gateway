.PHONY: all build ui controller agent module clean

all: build

# Build all production artifacts for bare-metal / systemd deployment
build: ui controller agent module
	@echo "==> Production build completed for systemd deployment."

# 1. Build frontend console
ui:
	cd ui && npm run build

# 2. Build Go Control Plane server
controller: ui
	mkdir -p build/bin
	cd control-plane && go build -buildvcs=false -trimpath -o ../build/bin/aurora-controller ./cmd
	cp build/bin/aurora-controller build/aurora-controller

# 3. Build Dataplane Agent and binaries
agent:
	mkdir -p build/bin
	cargo build --workspace --release
	cp target/release/aurora-agent build/bin/
	cp target/release/aurora-compile build/bin/

# 4. Build NGINX C Adapter dynamic module
module:
	bash scripts/build-nginx-module.sh

clean:
	rm -rf build ui/dist

