{

  nixConfig.allow-import-from-derivation = false;

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  inputs.treefmt-nix.url = "github:numtide/treefmt-nix";
  inputs.bun2nix.url = "github:baileyluTCD/bun2nix";

  outputs = { self, nixpkgs, treefmt-nix, bun2nix }:
    let
      pkgs = nixpkgs.legacyPackages.x86_64-linux;

      bun2nixPkgs = bun2nix.defaultPackage.x86_64-linux;

      nodeModules = (pkgs.callPackage ./bun.nix { }).nodeModules;

      treefmtEval = treefmt-nix.lib.evalModule pkgs {
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

      tests = pkgs.runCommand "tests" { } ''
        cp -L ${./index.ts} ./index.ts
        cp -Lr ${./test} ./test
        cp -L ${./package.json} ./package.json
        cp -L ${./tsconfig.json} ./tsconfig.json
        cp -Lr ${nodeModules}/node_modules ./node_modules
        ${pkgs.bun}/bin/bun test
        touch $out
      '';

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

      postinstall = pkgs.writeShellApplication {
        name = "postinstall";
        runtimeInputs = [ bun2nixPkgs.bin ];
        text = ''
          repo_root=$(git rev-parse --show-toplevel)

          bun2nix \
            --output-file "$repo_root/bun.nix" \
            --lock-file "$repo_root/bun.lock"
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
        postinstall = postinstall;
      };

      packages = scripts // {
        formatting = treefmtEval.config.build.check self;
        tsc = tsc;
        biome = biome;
        nodeModules = nodeModules;
        tests = tests;
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
