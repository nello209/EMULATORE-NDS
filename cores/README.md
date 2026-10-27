# Core di emulazione

Questi file sono i core libretro compilati in WebAssembly dal progetto
[EmulatorJS](https://github.com/EmulatorJS/EmulatorJS), versione **4.2.3**
(pacchetti npm `@emulatorjs/core-*@4.2.3`, build del 14 giugno 2025),
estratti dagli archivi `*-wasm.data` senza modifiche.

| Cartella | Core | Licenza | Sorgente |
|---|---|---|---|
| `melonds/` | melonDS (libretro) | GPL-3.0 | https://github.com/EmulatorJS/melonDS |
| `desmume2015/` | DeSmuME 2015 (libretro) | GPL-2.0-or-later | https://github.com/EmulatorJS/desmume2015 |
| `desmume/` | DeSmuME (libretro) | GPL-2.0-or-later | https://github.com/EmulatorJS/desmume |
| `mgba/` | mGBA (libretro) | MPL-2.0 | https://github.com/EmulatorJS/mgba |

Ogni core include anche il frontend RetroArch (GPL-3.0) compilato da EmulatorJS.
Le varianti "-thread" e "-legacy" non sono incluse.

Per aggiornarli: `npm pack @emulatorjs/core-<nome>@<versione>`, estrarre
`<nome>-wasm.data` (è un archivio 7z) in questa cartella e rieseguire i test
(`npm run test:e2e`): gli stati salvati con una build diversa potrebbero non
essere più caricabili, quindi va fatto con attenzione.
