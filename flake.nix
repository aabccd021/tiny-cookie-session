{

  nixConfig.allow-import-from-derivation = false;

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  inputs.treefmt-nix.url = "github:numtide/treefmt-nix";

  outputs =
    { self, ... }@inputs:
    let

      pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;

      treefmtEval = inputs.treefmt-nix.lib.evalModule pkgs {
        projectRootFile = "flake.nix";
        programs.nixfmt.enable = true;
        programs.biome.enable = true;
        programs.biome.formatUnsafe = true;
        programs.biome.settings.formatter.indentStyle = "space";
        programs.biome.settings.formatter.lineWidth = 100;
      };

      tsc = pkgs.runCommand "tsc" { } ''
        cp -L ${./tiny-session.js} ./tiny-session.js
        cp -L ${./tsconfig.json} ./tsconfig.json
        mkdir --parents "$out"  
        ${pkgs.typescript}/bin/tsc --outDir "$out"
      '';

      test = pkgs.runCommand "test" { } ''
        cp -L ${./tiny-session.js} ./tiny-session.js
        cp -L ${./tiny-session.test.js} ./tiny-session.test.js
        ${pkgs.bun}/bin/bun ./tiny-session.test.js
        touch "$out"
      '';

      publish = pkgs.writeShellApplication {
        name = "publish";
        runtimeInputs = [ pkgs.bun ];
        text = ''
          repo_root=$(git rev-parse --show-toplevel)
          export NPM_CONFIG_USERCONFIG="$repo_root/.npmrc"
          if [ ! -f "$NPM_CONFIG_USERCONFIG" ]; then
            bunx npm login
          fi
          nix flake check
          bun publish
        '';
      };

      packages = {
        publish = publish;
        formatting = treefmtEval.config.build.check self;
        tsc = tsc;
        test = test;
      };

    in
    {

      packages.x86_64-linux = packages;
      checks.x86_64-linux = packages;
      formatter.x86_64-linux = treefmtEval.config.build.wrapper;

      devShells.x86_64-linux.default = pkgs.mkShellNoCC {
        buildInputs = [
          pkgs.bun
          pkgs.biome
          pkgs.typescript
          pkgs.vscode-langservers-extracted
          pkgs.nixd
          pkgs.typescript-language-server
        ];
      };

    };
}
