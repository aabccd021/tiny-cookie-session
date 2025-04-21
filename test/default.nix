{ pkgs }:
let

  lib = pkgs.lib;

  server = pkgs.runCommandLocal "server" { } ''
    ${pkgs.bun}/bin/bun build ${./server.ts} \
      --compile \
      --minify \
      --sourcemap \
      --outfile server
    mkdir -p $out/bin
    mv server $out/bin/server
  '';


  runTest = testFile: pkgs.runCommandLocal ""
    {
      buildInputs = [ pkgs.jq pkgs.netero-test server ];
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
    wait $server_pid
    mkdir $out
  '';


  testFiles = {
    url = runTest ./url.sh;
    search-param = runTest ./search-param.sh;
  };

in
lib.mapAttrs'
  (name: value: {
    name = "goto-test-" + name;
    value = value.overrideAttrs (oldAttrs: {
      name = "goto-test-" + name;
    });
  })
  testFiles
