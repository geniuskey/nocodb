{
  lib,
  stdenv,
  nodePackages,
  pnpm,
  fetchurl,
  sqlite,
  pkg-config,
  makeWrapper,
  node-gyp,
  coreutils,
  nettools,
  vips,
  version,

  # macos
  xcbuild,
  cctools,
}:

let
  nodejs = nodePackages.nodejs;
  # pnpm honors packageManager and may install that exact version as a small
  # launcher. Pin it in Nix and keep Node on PATH inside fetchDeps.
  pnpmPinned = pnpm.overrideAttrs (oldAttrs: {
    version = "9.15.5";
    src = fetchurl {
      url = "https://registry.npmjs.org/pnpm/-/pnpm-9.15.5.tgz";
      hash = "sha256-hHIWjD4f0L/yh+aUsFP8y78gV5o/+VJrYzO+q432Wo0=";
    };
    nativeBuildInputs = (oldAttrs.nativeBuildInputs or [ ]) ++ [ makeWrapper ];
    postFixup = (oldAttrs.postFixup or "") + ''
      wrapProgram $out/bin/pnpm --prefix PATH : ${lib.makeBinPath [ nodejs ]}
    '';
  });
in
stdenv.mkDerivation (finalAttrs: {
  inherit version;

  pname = "nocodb";

  src = lib.cleanSourceWith {
    filter =
      name: type:
      lib.cleanSourceFilter name type
      && !(builtins.elem (baseNameOf name) [
        "nix"
        "flake.nix"
      ]);

    src = ../.;
  };

  buildPhase = ''
    export NODE_OPTIONS="--max_old_space_size=16384"
    export NUXT_TELEMETRY_DISABLED=1
    export npm_config_nodedir=${nodejs}

    pnpm run registerIntegrations
    pnpm run build:community
  '';

  installPhase = ''
    mkdir -p $out/share/nocodb/packages/nocodb
    cp -v ./packages/nocodb/docker/main.js $out/share/nocodb/packages/nocodb/index.js
    cp -r ./packages/nocodb/docker/nc-gui $out/share/nocodb/packages/nocodb/nc-gui
    cp -r ./packages/nocodb/src/public $out/share/nocodb/packages/nocodb/public

    # only ship nocodb workspace prod deps with node_modules (1.9GB -> 400MB)
    rm -rf ./node_modules ./packages/nocodb/node_modules
    pnpm install \
        --offline \
        --prod \
        --ignore-scripts \
        --filter=nocodb \
        --frozen-lockfile
    # nodejs 22.11.0 -> 22.12.0 broke pnpm rebuild somehow, so let's do it manaully
    # pnpm rebuild -r --verbose --reporter=append-only
    for package in $(find -L packages/nocodb/node_modules -name binding.gyp -type f); do
        cd "$(dirname "$package")"
        node-gyp rebuild
        cd -
    done

    cp -r ./node_modules $out/share/nocodb/node_modules
    cp -r ./packages/nocodb/node_modules $out/share/nocodb/packages/nocodb/node_modules

    makeWrapper "${lib.getExe nodejs}" "$out/bin/${finalAttrs.pname}" \
      --set NODE_ENV production \
      --set PATH ${
        (lib.makeBinPath [
          coreutils
          nettools
        ])
        # TODO: for ioreg
        + lib.optionalString stdenv.hostPlatform.isDarwin ":/usr/bin"
      } \
      --add-flags "$out/share/nocodb/packages/nocodb/index.js"
  '';

  nativeBuildInputs = [
    pnpmPinned
    pnpmPinned.configHook
    node-gyp

    makeWrapper
    pkg-config
    (nodejs.python.withPackages (p: [
      p.distutils
    ]))
  ];

  buildInputs =
    [
      nodejs
      sqlite
      vips
      coreutils # head
      nettools # hostname
    ]
    ++ lib.optionals stdenv.hostPlatform.isDarwin [
      xcbuild
      cctools
    ];

  pnpmDeps = pnpmPinned.fetchDeps {
    inherit (finalAttrs) pname version src;
    hash = "sha256-vA5XlWiXZXKfL4OzlTfCFUNYZXbtwNOHBPnV7pk4Qt4=";
  };

  meta = {
    description = "Open Source Airtable Alternative";
    homepage = "https://nocodb.com/";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
    license = lib.licenses.agpl3Plus;
    mainProgram = finalAttrs.pname;
    maintainers = with lib.maintainers; [ sinanmohd ];
  };
})
