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

  mkTest = name: prev: actions: pkgs.runCommand "${name}-test"
    {
      buildInputs = [
        pkgs.netero-test
        server
      ];
    } ''
    cp -Lr ${prev}/* ./var
    chmod -R u=rwX,g=,o= ./var

    export NETERO_STATE="$PWD/var/netero"
    netero_init

    mkdir -p ./run/netero
    mkfifo ./ready.fifo
    mkfifo ./exit.fifo

    server 2>&1 | while IFS= read -r line; do
      printf '\033[34m[server]\033[0m %s\n' "$line"
    done &
    server_pid=$!

    cat ./ready.fifo >/dev/null

    counter=1
    for actionName in ${builtins.concatStringsSep " " actions}; do
      printf '\033[35mclient > %02d-%s\033[0m>\n' "$counter" "$actionName"
      bash -euo pipefail ${./actions}/"$actionName.sh" 2>&1 | while IFS= read -r line; do
        printf '\033[35mclient > %02d-%s\033[0m> %s\n' "$counter" "$actionName" "$line"
      done
      counter=$((counter + 1))
    done

    echo >./exit.fifo
    wait "$server_pid"

    mkdir "$out"
    mv ./var "$out/var"
  '';

in
rec {

  s0000 = pkgs.runCommand "s0000" { } ''
    mkdir -p "$out/var"
    printf "{}" > "$out/var/sessions.json"
  '';

  s0001 = mkTest "s0001" s0000 [
    "goto-home"
    "assert-logged-out"
  ];

  s0003 = mkTest "s0003" s0001 [
    "goto-home"
    "assert-logged-out"
  ];

  s0004 = mkTest "s0004" s0001 [
    "goto-login"
    "submit-login-alice"
    "assert-logged-in-alice"
  ];

  s0005 = mkTest "s0005" s0004 [
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0007 = mkTest "s0007" s0004 [
    "goto-logout"
    "assert-logged-out"
  ];

  s0008 = mkTest "s0008" s0007 [
    "goto-home"
    "assert-logged-out"
  ];

  s0010 = mkTest "s0010" s0007 [
    "goto-login"
    "submit-login-bob"
    "assert-logged-in-bob"
  ];

  s0011 = mkTest "s0011" s0010 [
    "goto-logout"
    "assert-logged-out"
  ];

  s0012 = mkTest "s0012" s0011 [
    "goto-login"
    "submit-login-alice"
    "assert-logged-in-alice"
  ];

  s0013 = mkTest "s0013" s0012 [
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0016 = mkTest "s0016" s0004 [
    "time-advance-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0017 = mkTest "s0017" s0004 [
    "time-advance-2h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0018 = mkTest "s0018" s0004 [
    "time-advance-3h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0019 = mkTest "s0019" s0004 [
    "time-advance-4h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0020 = mkTest "s0020" s0018 [
    "time-advance-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0021 = mkTest "s0021" s0019 [
    "goto-logout"
    "assert-logged-out"
  ];

  s0022 = mkTest "s0022" s0021 [
    "goto-login"
    "submit-login-alice"
    "assert-logged-in-alice"
  ];

  s0023 = mkTest "s0023" s0022 [
    "time-advance-4h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0024 = mkTest "s0024" s0022 [
    "time-advance-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0025 = mkTest "s0025" s0019 [
    "time-advance-3h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0026 = mkTest "s0026" s0018 [
    "time-advance-2h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0027 = mkTest "s0027" s0026 [
    "time-advance-3h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0028 = mkTest "s0028" s0027 [
    "time-advance-2h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0029 = mkTest "s0029" s0028 [
    "time-advance-3h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0030 = mkTest "s0030" s0029 [
    "goto-logout"
    "assert-logged-out"
  ];

  s0031 = mkTest "s0031" s0030 [
    "goto-login"
    "submit-login-alice"
    "assert-logged-in-alice"
  ];

  s0032 = mkTest "s0032" s0031 [
    "time-advance-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0033 = mkTest "s0033" s0029 [
    "time-advance-2h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0034 = mkTest "s0034" s0033 [
    "time-advance-2h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0035 = mkTest "s0035" s0034 [
    "time-advance-2h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0036 = mkTest "s0036" s0035 [
    "time-advance-2h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0037 = mkTest "s0037" s0036 [
    "time-advance-2h"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0038 = mkTest "s0038" s0037 [
    "time-advance-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0039 = mkTest "s0039" s0037 [
    "time-advance-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0040 = mkTest "s0040" s0039 [
    "time-advance-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0041 = mkTest "s0041" s0019 [
    "time-advance-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0042 = mkTest "s0042" s0023 [
    "time-advance-6h"
    "goto-home"
    "assert-logged-out"
  ];

  s0043 = mkTest "s0043" s0004 [
    "copy-browser1-browser2"
    "time-advance-11m"
  ];

  # assert everyone is logged out after the victim consumed the session twice 10 minutes apart (access token exp time)
  s0053 = mkTest "s0053" s0043 [
    "goto-home"
    "time-advance-10m"
    "goto-home"

    "main-browser2"
    "goto-home"
    "assert-logged-out"

    "main-browser1"
    "goto-home"
    "assert-logged-out"

  ];

  # assert everyone is logged out after the victim consumed the session twice, with attacker consuming the session in between
  s0055 = mkTest "s0055" s0043 [
    "goto-home"

    "time-advance-10m"
    "main-browser2"
    "goto-home"

    "time-advance-1m"
    "main-browser1"
    "goto-home"

    "main-browser2"
    "goto-home"
    "assert-logged-out"

    "main-browser1"
    "goto-home"
    "assert-logged-out"

  ];

  # assert everyone is logged out after the attacker consumed the session twice 10 minutes apart (access token exp time)
  s0054 = mkTest "s0054" s0043 [
    "main-browser2"
    "goto-home"
    "time-advance-10m"
    "goto-home"

    "main-browser1"
    "goto-home"
    "assert-logged-out"

    "main-browser2"
    "goto-home"
    "assert-logged-out"

  ];

  # assert everyone is logged out after the attacker consumed the session twice, with victim consuming the session in between
  s0056 = mkTest "s0056" s0043 [
    "main-browser2"
    "goto-home"

    "time-advance-10m"
    "main-browser1"
    "goto-home"

    "time-advance-1m"
    "main-browser2"
    "goto-home"

    "main-browser1"
    "goto-home"
    "assert-logged-out"

    "main-browser2"
    "goto-home"
    "assert-logged-out"

  ];

  s0050 = mkTest "s0050" s0034 [
    "time-advance-11m"
    "concurrent-goto-home-5-1-0"
  ];

  s0051 = mkTest "s0051" s0050 [
    "time-advance-1m"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0057 = mkTest "s0057" s0034 [
    "time-advance-11m"
    "concurrent-goto-home-5-0-0"
  ];

  s0058 = mkTest "s0058" s0057 [
    "time-advance-1m"
    "goto-home"
    "assert-logged-in-alice"
  ];

  s0060 = mkTest "s0060" s0034 [
    "time-advance-11m"
    "concurrent-goto-home-5-1-5"
  ];

  s0062 = mkTest "s0062" s0043 [
    "concurrent-goto-home-rand"

    "time-advance-10m"
    "goto-home"

    "main-browser2"
    "goto-home"
    "assert-logged-out"

    "main-browser1"
    "goto-home"
    "assert-logged-out"

  ];


}

