# AppMonroy Horarios

App desktop para generar calendarios de examenes ordinarios desde PDF y exportarlos a Excel.

## Desarrollo

```bash
pnpm install
pnpm tauri dev
```

El comando `pnpm tauri ...` usa `scripts/run-tauri.mjs`, que funciona en Linux y Windows y agrega automaticamente la carpeta de Cargo al `PATH` cuando existe.

## Requisitos de desarrollo

- Node.js y pnpm
- Rust
- Python 3
- `pdftotext`

En Windows, `Python 3` puede estar disponible como `py`, `python` o `python3`; la app prueba esas opciones automaticamente.

## Windows

Para desarrollo, instala:

- Rust con MSVC
- Visual Studio Build Tools
- Python 3
- Poppler para Windows, o usa el `pdftotext.exe` incluido en `src-tauri/bin`

Para empaquetado final de Windows, la app incluye como recursos:

- `Plantilla.xlsx`
- `src-tauri/scripts/export_excel.py`
- `src-tauri/bin`

`src-tauri/bin` ya incluye `pdftotext.exe` y sus DLLs desde Poppler Windows v26.02.0-0. Tauri lo empaquetara con la app y el backend lo buscara antes de usar el `PATH` del sistema.

## Build

```bash
pnpm tauri build
```
