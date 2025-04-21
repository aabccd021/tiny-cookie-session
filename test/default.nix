{ pkgs, nodeModules }:
let

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

  advance_time = pkgs.writeShellApplication {
    name = "advance_time";
    runtimeInputs = [ pkgs.netero-test ];
    text = ''
      time_now=$(cat "./var/now.txt")
      time_advanced=$(date --utc --date "$time_now +$1" +"%Y-%m-%dT%H:%M:%SZ")
      printf "%s" "$time_advanced" >"./var/now.txt"
    '';
  };

  mkTest = name: prev: actions: pkgs.runCommand "${name}-test"
    {
      buildInputs = [
        pkgs.netero-test
        server
        advance_time
      ];
    } ''
    cp -Lr ${prev}/* ./var
    chmod -R u=rwX,g=,o= ./var

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

    counter=0
    for actionName in ${builtins.concatStringsSep " " actions}; do
      bash -euo pipefail ${./actions}/"$actionName.sh" 2>&1 | while IFS= read -r line; do
        printf '\033[35mclient > %02d-%s\033[0m> %s\n' "$counter" "$actionName" "$line"
      done
      counter=$((counter + 1))
    done

    echo >./run/netero/exit.fifo
    wait "$server_pid"

    mkdir "$out"
    mv ./var "$out/var"
  '';

in
rec {

  s0000 = pkgs.runCommand "s0000" { } ''
    mkdir -p "$out/var"
    printf "[]" > "$out/var/sessions.json"
    printf "%sZ" "$(date +"%Y-%m-%dT%H:%M:%SZ")" > "$out/var/now.txt"

  '';

  s0001 = mkTest "s0001" s0000 [
    "goto-home"
    "assert-logged-out"
  ];

  s0002 = mkTest "s0002" s0000 [
    "goto-has-session-cookie"
    "assert-has-session-cookie-false"
  ];

  s0003 = mkTest "s0003" s0001 [
    "goto-home"
    "assert-logged-out"
  ];

  s0004 = mkTest "s0004" s0001 [
    "goto-login"
    "submit-login-alice-iphone"
    "assert-logged-in-alice-iphone"
  ];

  s0005 = mkTest "s0005" s0004 [
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0006 = mkTest "s0006" s0004 [
    "goto-has-session-cookie"
    "assert-has-session-cookie-true"
  ];

  s0007 = mkTest "s0007" s0004 [
    "goto-logout"
    "assert-logged-out"
  ];

  s0008 = mkTest "s0008" s0007 [
    "goto-home"
    "assert-logged-out"
  ];

  s0009 = mkTest "s0009" s0007 [
    "goto-has-session-cookie"
    "assert-has-session-cookie-false"
  ];

  s0010 = mkTest "s0010" s0007 [
    "goto-login"
    "submit-login-bob-desktop"
    "assert-logged-in-bob-desktop"
  ];

  s0011 = mkTest "s0011" s0010 [
    "goto-logout"
    "assert-logged-out"
  ];

  s0012 = mkTest "s0012" s0011 [
    "goto-login"
    "submit-login-alice-iphone"
    "assert-logged-in-alice-iphone"
  ];

  s0013 = mkTest "s0013" s0012 [
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0014 = mkTest "s0014" s0004 [
    "goto-login"
    "assert-already-logged-in"
  ];

  s0015 = mkTest "s0015" s0010 [
    "goto-login"
    "assert-already-logged-in"
  ];


}

