{

  nixConfig.allow-import-from-derivation = false;

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  inputs.treefmt-nix.url = "github:numtide/treefmt-nix";

  outputs =
    { self, ... }@inputs:
    let

      pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;

      treefmtEval = inputs.treefmt-nix.lib.evalModule pkgs {
        programs.nixfmt.enable = true;
        programs.biome.enable = true;
        programs.biome.formatUnsafe = true;
        programs.biome.settings.formatter.indentStyle = "space";
        programs.biome.settings.formatter.lineWidth = 100;
      };

      packages.format = treefmtEval.config.build.check self;

      packages.test = pkgs.runCommand "test" { } ''
        cd ${./.}
        ${pkgs.typescript}/bin/tsc
        ${pkgs.bun}/bin/bun ./index.test.js
        touch "$out"
      '';

    in
    {

      packages.x86_64-linux = packages;
      checks.x86_64-linux = packages;
      formatter.x86_64-linux = treefmtEval.config.build.wrapper;

      devShells.x86_64-linux.default = pkgs.mkShellNoCC {
        buildInputs = [
          pkgs.nixd
          pkgs.typescript
          pkgs.typescript-language-server
        ];
      };

    };
}
