# Edificios 3D

Gemelo 3D de edificios de oficinas a partir de las fotos de sus planos, para planificar el trabajo del equipo de limpieza: salas y aseos etiquetados, personas con su itinerario, rutinas que se repiten y el camino más corto para recorrerlo, con ascensores, escaleras y reglas de acceso.

Incluye un **Constructor de planta** que lleva, paso a paso y sin ayuda externa, de la foto de un plano a la planta lista para calcular rutas.

Hecho con **React + TypeScript + Vite**, **three.js** (a través de `@react-three/fiber` y `drei`), **Zustand** y **tesseract.js** (lectura de los nombres del plano).

## Arrancar

```bash
npm install
npm run dev
```

Abre http://localhost:5173. La primera vez la app arranca con los **5 edificios de ejemplo** de `ejemplos/` (4 plantas cada uno, con dos limpiadores por edificio).

`npm install` copia además el motor de lectura de texto a `public/ocr/` (`scripts/copy-ocr.mjs`), para que funcione sin conexión.

## Compilar

| Comando | Resultado | Cómo se usa |
| --- | --- | --- |
| `npm run build` | `dist/` (HTML + assets) | Se sube a un servidor web o hosting estático. Desde ahí se puede **instalar como aplicación** y funciona sin conexión. |
| `npm run build:file` | `dist-file/index.html` (un solo archivo) | Se abre con doble clic, sin servidor y sin conexión. |
| `npm run app` | Programa de escritorio (Electron) | Para probarlo. |
| `npm run dist:win` | `release/…Setup….exe` | Instalador para Windows. |

## Publicar en GitHub Pages

Cada vez que se sube algo a `main`, el flujo `.github/workflows/pages.yml` compila la versión web y la publica en `https://<usuario>.github.io/<repositorio>/`. La primera vez hay que activar Pages en el repositorio: *Settings → Pages → Build and deployment → Source: GitHub Actions*. La versión publicada arranca con los edificios de ejemplo; los datos de cada visitante se guardan solo en su navegador.

## Constructor de planta (pestaña «Constructor»)

Asistente de 11 pasos, de la foto del plano a la planta lista para las rutas. Los pasos que se pueden comprobar se marcan solos; el resto, con «Hecho». Lo hecho se guarda con cada planta.

1. **Foto del plano.** Mejor el PDF exportado o una captura; vale una foto con el móvil.
2. **⊡ Enderezar:** clic en las 4 esquinas del edificio; corrige la perspectiva de la foto.
3. **📏 Escala:** dos clics sobre una medida conocida y su longitud real.
4. **📐 Contorno:** se ajusta solo al borde del edificio (sin título ni leyenda).
5. **🎨 Salas por color:** busca los rellenos de color del plano; se elige qué es cada color (aseo, sala, cocina…) y se crean las salas con sus paredes.
6. **🧱 Paredes:** trazos oscuros y gruesos convertidos en muros (con sensibilidad).
7. **🛗 Ascensores y escaleras:** recuadros con X y filas de peldaños.
8. **🚪 Puertas:** cada sala cerrada sin puerta recibe una hacia el pasillo.
9. **🔤 Nombres:** lee el texto del plano (OCR) y lo propone para cada sala; «WC», «Lift», «Stairs», «Kitchen» proponen también el tipo, y los aseos azules / rosas / verdes se marcan de hombres / mujeres / adaptados.
10. **Good lifts:** qué ascensores son montacargas para el carro de limpieza y de qué lado (norte o sur).
11. **Revisión** en 3D.

Con dos plantas o más, **🔗 Conectar plantas** une los ascensores y escaleras que coinciden de una planta a otra (ajusta la escala y el origen de cada foto).

Todo lo detectado es un borrador: sale marcado, se corrige a mano y se puede quitar de golpe o volver a detectar. Las mismas herramientas están sueltas en *Datos → Foto del plano → Detección automática* y en el editor 2D.

## Varios edificios

Cada edificio guarda sus plantas, personas, reglas y rutinas.

- **Cambiar de edificio:** selector «Edificio» de la barra superior. El que deja de estar abierto se guarda en este equipo.
- **Nuevo edificio en blanco:** desde ese selector o desde *Datos → Edificios*. Se abre directamente en el Constructor.
- **Copia de todo:** en la cabecera, a la derecha, «⬇ Exportar todo» descarga un archivo con todos los edificios; «⬆ Importar» lo restaura (sustituye todos los edificios de este equipo, tras confirmar). Si el archivo es un edificio suelto, se añade como edificio nuevo sin borrar nada.
- **Pasar un edificio:** *Datos → Edificios → Exportar este edificio / Importar edificio*.
- **Ejemplo:** `ejemplos/copia-5-edificios-4-plantas.json` (5 edificios, 4 plantas, núcleo con good lifts norte y sur, ascensores de visitas, escaleras, aseos, salas, cocina y puestos, y 2 limpiadores por edificio).
- **Muebles:** la casilla «Muebles» de la barra superior muestra u oculta esa capa; «Amueblar las salas automáticamente» (por edificio) pone mesas, encimeras y sanitarios solos.

## Elementos y rutinas de limpieza

- **Elementos** (pestaña *Plano*): papeleras, reciclaje, puntos de vaciado, cuartos de limpieza, dispensadores, *phone nooks* y *meeting pods*. Se colocan con **🗑️ Elemento** en el editor 2D; los de tipo mueble bloquean el paso.
- **Rutinas** (pestaña *Rutinas*): trabajos que se repiten, con criterios automáticos («aseos con la etiqueta *aseo*», «papeleras y reciclaje»), plantas, rondas a horas fijas y reparto entre operarios. Se recalculan solas al cambiar el plano.
- **Sanitarios:** cabinas, urinarios, lavabos, duchas y vestidores de cada aseo; cuentan para el tiempo de limpieza.

## Qué se puede hacer

- **Vista 3D** de la planta, con el plano original superpuesto y altura de muros regulable.
- **Personas:** etiquetas, velocidad, hora de salida e itinerario (desplegable o **📍 Elegir en el mapa**). **Optimizar el orden de visita**: exacto hasta 13 paradas (Held-Karp), aproximado a partir de ahí (vecino más próximo + 2-opt).
- **Simulación:** todas las personas a la vez, con línea de tiempo y velocidad de ×1 a ×500.
- **Reglas de acceso:** ⛔ no pueden entrar, ⚠️ evitan si hay alternativa, ✅ solo pueden usarlas. De partida: el carro de limpieza no usa escaleras, el good lift es solo para limpieza, los ascensores de visitas no, y cada equipo usa el good lift de su lado.
- **Editor 2D:** estancias, muros, puertas, contorno, muebles, mano para desplazarse, rejilla de 0,25 m y deshacer/rehacer.
- **Registro de limpieza:** importa un Excel o CSV (limpiador, planta, zona, horas) y crea los itinerarios con las horas reales.
- **Archivo de proyecto compartido:** un `.json` en una carpeta compartida con guardado automático (Chrome y Edge de escritorio, y el programa de escritorio).
- **Idioma:** español o inglés.

## Cómo se calcula el camino más corto

1. Cada planta se convierte en una rejilla de 0,25 m (`src/nav/grid.ts`): quedan bloqueados lo que está fuera del contorno, los muros, las estancias cerradas y el mobiliario, con el radio de una persona como margen.
2. A las estancias cerradas solo se entra por sus puertas; las zonas abiertas se cruzan salvo que una regla lo prohíba.
3. Dijkstra con 8 vecinos (`src/nav/pathfind.ts`), con el trazado suavizado por visibilidad directa.
4. Entre plantas, por el ascensor o la escalera conectados de menor coste (ascensor: 20 s de espera + 4 s por planta; escalera: 15 s por planta).
5. El orden de visita se optimiza en `src/nav/tsp.ts`.

## Datos propios de una instalación

Los planos calcados a mano, las fotos y el personal de un edificio real no van al repositorio. Si existe `src/data/local/index.ts` (ver la interfaz `LocalData` en `src/data/localData.ts`), la app arranca con esos datos; si no, con los edificios de ejemplo. Esa carpeta y `src/assets/` están en `.gitignore`.

## Estructura

```
src/
  data/seed.ts         Datos de partida (locales o de ejemplo)
  data/rules.ts        Reglas de acceso de partida
  data/rectify.ts      Corrección de perspectiva (homografía)
  wallDetect.ts        Contorno y paredes desde la foto
  colorZones.ts        Salas por color de relleno
  connectorDetect.ts   Ascensores, escaleras y conexión entre plantas
  autoDoors.ts         Puertas que faltan
  planText.ts          Lectura de los nombres del plano (OCR)
  photoRectify.ts      Enderezar la foto con 4 esquinas
  nav/                 Rejilla, Dijkstra, orden óptimo y planificador de rutas
  three/               Escena 3D
  editor/Editor2D.tsx  Editor del plano
  ui/                  Paneles (Constructor, Datos, Personas, Rutinas…)
  store.ts             Estado global (Zustand + persistencia + deshacer)
  i18n.ts              Textos ES/EN
electron/              Programa de escritorio
ejemplos/              Copia de ejemplo con 5 edificios
scripts/copy-ocr.mjs   Copia el motor de OCR a public/ocr
```

## Modelo de datos (JSON)

- **Copia de todo:** `{ kind: "modelo-planta-copia", version, activeBuildingId, buildings: [{ id, name, data }] }`.
- **Edificio (`data`):** `building.floors[]` (`id`, `name`, `level`, `outline`, `walls`, `spaces`, `background`), `persons[]`, `rules[]`, `routines[]`, `startTime`.
- **`spaces[]`:** `name`, `kind`, `x`, `z`, `w`, `d` (metros), `doors[]` (`side` n/s/e/o, `offset` 0–1, `width`), `tags[]`, `connectorId` en ascensores y escaleras, `fixtures[]` en aseos.
- **`persons[]`:** `name`, `color`, `tags`, `speed`, `startDelay`, `optimize`, `returnToStart`, `stops[]` (`floorId`, `spaceId`, `dwell`).
- **`rules[]`:** `personTag`, `spaceTag`, `mode` (`deny`, `avoid`, `only`).
