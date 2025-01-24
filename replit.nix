{
  description = "A basic repl.it environment";

  deps = {
    pkgs = import <nixpkgs> {
      config.allowUnfree = true;
    };
  };

  env = {
    LD_LIBRARY_PATH = "$LD_LIBRARY_PATH:${deps.pkgs.lib.makeLibraryPath [
      deps.pkgs.libGL
    ]}";
  };

  packages = with deps.pkgs; [
    nodejs-18_x
    nodePackages.typescript-language-server
    nodePackages.yarn
    replitPackages.jest
    ffmpeg
  ];
}
