{
  description = "Pide - open-source lightweight cross-platform terminal workspace";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }: let
    forAllSystems = nixpkgs.lib.genAttrs [ "x86_64-linux" "x86_64-darwin" "aarch64-darwin" ];
  in {
    packages = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      pide = pkgs.callPackage ./nix/package.nix { };
      default = self.packages.${system}.pide;
    });

    nixosModules.pide = { pkgs, ... }: {
      environment.systemPackages = [ self.packages.${pkgs.system}.pide ];
    };

    darwinModules.pide = { pkgs, ... }: {
      environment.systemPackages = [ self.packages.${pkgs.system}.pide ];
    };
  };
}
