{

  nixConfig.allow-import-from-derivation = false;
  nixConfig.extra-substituters = [
    "https://cache.nixos.org"
    "https://cache.garnix.io"
  ];
  nixConfig.extra-trusted-public-keys = [
    "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
    "cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g="
  ];

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  inputs.treefmt-nix.url = "github:numtide/treefmt-nix";
  inputs.bun2nix.url = "github:baileyluTCD/bun2nix";
  inputs.netero-test.url = "github:aabccd021/netero-test";

  outputs = { self, ... }@inputs:
    let
      pkgs = import inputs.nixpkgs {
        system = "x86_64-linux";
        overlays = [
          inputs.netero-test.overlays.default
        ];
      };

      nodeModules = (pkgs.callPackage ./bun.nix { }).nodeModules;

      treefmtEval = inputs.treefmt-nix.lib.evalModule pkgs {
        projectRootFile = "flake.nix";
        programs.prettier.enable = true;
        programs.nixpkgs-fmt.enable = true;
        programs.biome.enable = true;
        programs.shfmt.enable = true;
        settings.formatter.prettier.priority = 1;
        settings.formatter.biome.priority = 2;
        settings.global.excludes = [ "LICENSE" "*.ico" ];
      };

      tsc = pkgs.runCommand "tsc" { } ''
        cp -L ${./index.ts} ./index.ts
        cp -L ${./tsconfig.json} ./tsconfig.json
        cp -Lr ${./test} ./test
        cp -Lr ${nodeModules}/node_modules ./node_modules
        ${pkgs.typescript}/bin/tsc
        touch $out
      '';

      biome = pkgs.runCommand "biome" { } ''
        cp -L ${./biome.jsonc} ./biome.jsonc
        cp -L ${./index.ts} ./index.ts
        cp -Lr ${./test} ./test
        cp -L ${./package.json} ./package.json
        cp -L ${./tsconfig.json} ./tsconfig.json
        cp -Lr ${nodeModules}/node_modules ./node_modules
        ${pkgs.biome}/bin/biome check --error-on-warnings
        touch $out
      '';

      tests = import ./test {
        pkgs = pkgs;
        nodeModules = nodeModules;
      };

      publish = pkgs.writeShellApplication {
        name = "publish";
        runtimeInputs = [ pkgs.jq ];
        text = ''
          published_version=$(npm view . version)
          current_version=$(jq -r .version package.json)
          if [ "$published_version" = "$current_version" ]; then
            echo "Version $current_version is already published"
            exit 0
          fi
          echo "Publishing version $current_version"

          nix flake check
          NPM_TOKEN=''${NPM_TOKEN:-}
          if [ -n "$NPM_TOKEN" ]; then
            npm config set //registry.npmjs.org/:_authToken "$NPM_TOKEN"
          fi
          npm publish
        '';
      };

      devShell = pkgs.mkShellNoCC {
        buildInputs = [
          pkgs.bun
          pkgs.biome
          pkgs.typescript
          pkgs.vscode-langservers-extracted
          pkgs.nixd
          pkgs.typescript-language-server
        ];
      };

      scripts = {
        publish = publish;
      };

      packages = tests // scripts // {
        tests = pkgs.linkFarm "tests" tests;
        devShell = devShell;
        formatting = treefmtEval.config.build.check self;
        tsc = tsc;
        biome = biome;
        nodeModules = nodeModules;
        bun2nix = inputs.bun2nix.packages.x86_64-linux.default;
      };

    in
    {

      checks.x86_64-linux = packages;

      packages.x86_64-linux = packages // {
        gcroot-all = pkgs.linkFarm "gcroot-all" packages;
      };

      formatter.x86_64-linux = treefmtEval.config.build.wrapper;

      apps.x86_64-linux = builtins.mapAttrs
        (name: script: {
          type = "app";
          program = pkgs.lib.getExe script;
          meta.description = "Script ${name}";
        })
        scripts;

      devShells.x86_64-linux.default = devShell;
    };
}
