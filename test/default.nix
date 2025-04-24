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

    export NETERO_BROWSER_STATE_FILE="$PWD/var/browser-state.txt"
    printf "$PWD/var/browser1" > "$PWD/var/browser-state.txt"

    mkdir -p ./run/netero
    mkfifo ./run/netero/ready.fifo
    mkfifo ./run/netero/exit.fifo

    server 2>&1 | while IFS= read -r line; do
      printf '\033[34m[server]\033[0m %s\n' "$line"
    done &
    server_pid=$!

    cat ./run/netero/ready.fifo >/dev/null

    counter=1
    for actionName in ${builtins.concatStringsSep " " actions}; do
      printf '\033[35mclient > %02d-%s\033[0m>\n' "$counter" "$actionName"
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
    mkdir -p "$out/var/browser1"
    printf "{}" > "$out/var/sessions.json"
    printf "%s" "$(date +"%Y-%m-%dT%H:%M:%SZ")" > "$out/var/now.txt"
    echo "http://localhost:8080/" > "$out/var/browser1/url.txt"
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

  s0016 = mkTest "s0016" s0004 [
    "advance-time-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0017 = mkTest "s0017" s0004 [
    "advance-time-2h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0018 = mkTest "s0018" s0004 [
    "advance-time-3h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0019 = mkTest "s0019" s0004 [
    "advance-time-4h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0020 = mkTest "s0020" s0018 [
    "advance-time-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0021 = mkTest "s0021" s0019 [
    "goto-logout"
    "assert-logged-out"
  ];

  s0022 = mkTest "s0022" s0021 [
    "goto-login"
    "submit-login-alice-iphone"
    "assert-logged-in-alice-iphone"
  ];

  s0023 = mkTest "s0023" s0022 [
    "advance-time-4h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0024 = mkTest "s0024" s0022 [
    "advance-time-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0025 = mkTest "s0025" s0019 [
    "advance-time-3h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0026 = mkTest "s0026" s0018 [
    "advance-time-2h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0027 = mkTest "s0027" s0026 [
    "advance-time-3h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0028 = mkTest "s0028" s0027 [
    "advance-time-2h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0029 = mkTest "s0029" s0028 [
    "advance-time-3h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0030 = mkTest "s0030" s0029 [
    "goto-logout"
    "assert-logged-out"
  ];

  s0031 = mkTest "s0031" s0030 [
    "goto-login"
    "submit-login-alice-iphone"
    "assert-logged-in-alice-iphone"
  ];

  s0032 = mkTest "s0032" s0031 [
    "advance-time-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0033 = mkTest "s0033" s0029 [
    "advance-time-2h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0034 = mkTest "s0034" s0033 [
    "advance-time-2h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0035 = mkTest "s0035" s0034 [
    "advance-time-2h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0036 = mkTest "s0036" s0035 [
    "advance-time-2h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0037 = mkTest "s0037" s0036 [
    "advance-time-2h"
    "goto-home"
    "assert-logged-in-alice-iphone"
  ];

  s0038 = mkTest "s0038" s0037 [
    "advance-time-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0039 = mkTest "s0039" s0037 [
    "advance-time-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0040 = mkTest "s0040" s0039 [
    "advance-time-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0041 = mkTest "s0041" s0019 [
    "advance-time-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0042 = mkTest "s0042" s0023 [
    "advance-time-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0043 = mkTest "s0043" s0004 [
    "goto-home"
    "assert-logged-in-alice-iphone"
    "advance-time-4m"
    "advance-time-4m"
    "advance-time-4m" # 5
    "copy-browser1-browser2"
    "goto-home"
    "assert-logged-in-alice-iphone"
    "advance-time-4m"
    "goto-home" # 10
    "assert-logged-in-alice-iphone"
    "advance-time-4m"
    "main-browser2"
    "goto-home"
    "assert-logged-out" # 15
    "main-browser1"
    "goto-home"
    "assert-logged-out"
  ];

}

