{ pkgs, nodeModules }:
let

  lib = pkgs.lib;

  server = pkgs.runCommandLocal "server" { } ''
    mkdir ./test
    cp -Lr ${nodeModules}/node_modules ./node_modules
    cp -L ${./server.ts} ./test/server.ts
    cp -L ${../index.ts} ./index.ts
    ${pkgs.bun}/bin/bun build ./test/server.ts \
      --compile \
      --minify \
      --sourcemap \
      --outfile server
    mkdir -p "$out/bin"
    mv server "$out/bin/server"
  '';


  runTest = testFile: pkgs.runCommandLocal ""
    {
      buildInputs = [ pkgs.netero-test server ];
    } ''
    export NETERO_DIR="$PWD/var/lib/netero"
    mkdir -p "$NETERO_DIR"

    mkdir -p ./run/netero
    mkfifo ./run/netero/ready.fifo
    mkfifo ./run/netero/exit.fifo

    server 2>&1 | while IFS= read -r line; do
      printf '\033[34m[server]\033[0m %s\n' "$line"
    done &
    server_pid=$!

    cat ./run/netero/ready.fifo >/dev/null

    echo "http://localhost:8080/" > "$NETERO_DIR/url.txt"

    test_script=$(cat ${testFile})
    bash -euo pipefail -c "$test_script" 2>&1 | while IFS= read -r line; do
      printf '\033[33m[client]\033[0m %s\n' "$line"
    done

    echo >./run/netero/exit.fifo
    wait "$server_pid"
    mkdir $out
  '';


  testFiles = {
    initially-logged-out = runTest ./initially-logged-out.sh;
  };

in
lib.mapAttrs'
  (name: value: {
    name = "test-" + name;
    value = value.overrideAttrs (oldAttrs: {
      name = "test-" + name;
    });
  })
  testFiles
