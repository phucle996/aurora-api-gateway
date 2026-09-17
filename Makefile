.PHONY: all build ui controller agent gateway install uninstall clean

all: build

# Build all production artifacts for bare-metal / systemd deployment
build: ui controller agent gateway
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

# 4. Build static aurora-gateway (NGINX 1.30.4 + in-tree module + Rust FFI Engine)
gateway:
	bash scripts/build-nginx-gateway.sh

# 5. Install systemd services and binaries from A to Z
install: build
	@echo "==> Installing Aurora API Gateway systemd services (A-Z)..."
	@if [ "$$(id -u)" -ne 0 ]; then echo "Error: 'make install' must be run as root (e.g. sudo make install)" >&2; exit 1; fi
	id -u aurora >/dev/null 2>&1 || useradd --system --no-create-home --shell /bin/false aurora
	install -d -m 750 -o aurora -g aurora /var/lib/aurora/data
	install -d -m 750 -o aurora -g aurora /etc/aurora
	install -d -m 755 -o root -g root /var/lib/aurora-policy
	install -d -m 755 -o root -g root /var/lib/aurora-routing
	install -d -m 755 -o root -g root /run/aurora
	install -d -m 755 -o root -g root /etc/nginx
	install -d -m 755 -o root -g root /var/log/nginx
	install -m 755 build/bin/aurora-controller /usr/local/bin/aurora-controller
	install -m 755 build/bin/aurora-compile    /usr/local/bin/aurora-compile
	install -m 755 build/bin/aurora-agent      /usr/local/bin/aurora-agent
	install -m 755 build/bin/aurora-gateway    /usr/local/bin/aurora-gateway
	if [ ! -f /etc/aurora/admin.token ]; then \
		echo "==> Generating /etc/aurora/admin.token..."; \
		openssl rand -hex 32 > /etc/aurora/admin.token; \
		chmod 600 /etc/aurora/admin.token; \
		chown aurora:aurora /etc/aurora/admin.token; \
	fi
	if [ ! -f /etc/aurora/controller.env ]; then \
		echo "==> Generating /etc/aurora/controller.env..."; \
		JWT_SECRET=$$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -A n -v -t x1 | tr -d ' \n'); \
		printf "AURORA_HTTP_ADDR=0.0.0.0:8080\nAURORA_GRPC_ADDR=0.0.0.0:9099\nAURORA_SQLITE_PATH=/var/lib/aurora/data/aurora.db\nAURORA_ADMIN_TOKEN_FILE=/etc/aurora/admin.token\nAURORA_JWT_SECRET=$$JWT_SECRET\n" > /etc/aurora/controller.env; \
		chmod 600 /etc/aurora/controller.env; \
		chown aurora:aurora /etc/aurora/controller.env; \
	fi
	if [ ! -f /etc/aurora/agent.env ]; then \
		echo "==> Generating /etc/aurora/agent.env..."; \
		printf "CONTROLLER_URL=http://127.0.0.1:8080\nGRPC_URL=http://127.0.0.1:9099\nAUTH_TOKEN=\nGATEWAY_BIN=/usr/local/bin/aurora-gateway\nGATEWAY_CONF=/etc/nginx/nginx.conf\nPOLICY_DIR=/var/lib/aurora-policy\nROUTING_DIR=/var/lib/aurora-routing\n" > /etc/aurora/agent.env; \
		chmod 600 /etc/aurora/agent.env; \
	fi
	install -m 644 deploy/systemd/aurora-controller.service /etc/systemd/system/aurora-controller.service
	install -m 644 deploy/systemd/aurora-gateway.service    /etc/systemd/system/aurora-gateway.service
	install -m 644 deploy/systemd/aurora-agent.service      /etc/systemd/system/aurora-agent.service
	if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then \
		systemctl daemon-reload; \
		echo "==> Systemd units installed and reloaded."; \
		echo "    Enable and start Gateway (Traffic): sudo systemctl enable --now aurora-gateway"; \
		echo "    Enable and start Agent (Sync):      sudo systemctl enable --now aurora-agent"; \
		echo "    Enable and start Controller:        sudo systemctl enable --now aurora-controller"; \
	else \
		echo "==> Units installed to /etc/systemd/system/ (systemd is not active in this environment)."; \
	fi

# 6. Uninstall services and binaries
uninstall:
	@echo "==> Uninstalling Aurora API Gateway services..."
	@if [ "$$(id -u)" -ne 0 ]; then echo "Error: 'make uninstall' must be run as root (e.g. sudo make uninstall)" >&2; exit 1; fi
	-systemctl stop aurora-agent aurora-gateway aurora-controller 2>/dev/null || true
	-systemctl disable aurora-agent aurora-gateway aurora-controller 2>/dev/null || true
	rm -f /etc/systemd/system/aurora-controller.service /etc/systemd/system/aurora-gateway.service /etc/systemd/system/aurora-agent.service
	rm -f /usr/local/bin/aurora-controller /usr/local/bin/aurora-compile /usr/local/bin/aurora-agent /usr/local/bin/aurora-gateway
	-systemctl daemon-reload 2>/dev/null || true
	@echo "==> Aurora API Gateway services and binaries uninstalled."

clean:
	rm -rf build ui/dist
