# Yerel CI: GitHub Actions'taki denetimlerin aynısı, Docker'da (Linux). `bun run ci` kurar ve çalıştırır.
FROM rust:1-bookworm

# Tauri'nin Linux bağımlılıkları (webview, tepsi simgesi), keyring için D-Bus.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
      libssl-dev libdbus-1-dev libxdo-dev pkg-config build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN rustup component add rustfmt clippy
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

COPY run.sh /usr/local/bin/cubby-ci
RUN sed -i 's/\r$//' /usr/local/bin/cubby-ci && chmod +x /usr/local/bin/cubby-ci
WORKDIR /work
ENTRYPOINT ["cubby-ci"]
