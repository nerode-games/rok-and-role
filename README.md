# Rok & Role — Reloaded

Versión web de la aventura de **Rok & Role 1.0.3 para J2ME**: los nueve capítulos originales, desde The Entry hasta The Damned Sword. Conserva los mapas, sprites, atributos, pergaminos, introducción y desenlace. Todos los recursos están incluidos en este proyecto.

## Jugar y ejecutar

Lanza **run.sh** y dejar su ventana abierta mientras juegas. Utiliza un Node instalado o el runtime disponible en Codex. Para instalar y desarrollar, necesitas Node.js 22.12 o posterior y pnpm:

```sh
pnpm install
pnpm dev
```

Abre la dirección que imprime Vite, normalmente <http://127.0.0.1:5173/>.

```sh
pnpm test       # Reglas, mapas, campaña, guardado y encuentro final
pnpm build      # TypeScript y construcción estática en dist/
pnpm preview    # Probar la versión de producción
```

## Aventura

| Capítulo | Nombre original | Salas definidas |
| --- | --- | ---: |
| 1 | The Entry | 10 |
| 2 | Forgotten Halls | 15 |
| 3 | The Cells | 25 |
| 4 | All the way down | 23 |
| 5 | The Ice Barrier | 33 |
| 6 | The Crystal Maze | 29 |
| 7 | The Escape | 27 |
| 8 | Into the citadel | 31 |
| 9 | The Damned Sword | 11 |

Son **204 salas definidas**. Los mapas se conservan sin editar; The Crystal Maze contiene una sala sin conexiones (ID 21), que permanece inaccesible como en el original. Las definiciones de monstruos que no pertenecen a ninguna sala no se instancian.

Al alcanzar una salida, el juego ofrece avanzar al siguiente capítulo. Conservas vitalidad, experiencia, equipo, durabilidad, consumibles y efectos mágicos. Las llaves y pergaminos de pista pertenecen al capítulo y se eliminan al avanzar. El séptimo capítulo tiene un límite de 100 turnos: cruzar puertas y actuar bajo velocidad no descuenta el contador, conforme a las reglas originales.

El guardado incluye la partida actual y un punto de reintento al entrar en el capítulo. Puedes reintentar desde la pausa o al morir, recuperando tu estado de entrada. El guardado de la primera versión web se importa automáticamente; si ya habías completado The Entry, puedes continuar hacia Forgotten Halls. La copia antigua se conserva en su ranura original.

## Controles

| Acción | Teclas |
| --- | --- |
| Avanzar / retroceder | ↑ / ↓, W / S o 2 / 8 |
| Girar izquierda / derecha | ← / →, A / D o 4 / 6 |
| Atacar o registrar el objeto de enfrente | Espacio, Enter o 5 |
| Inventario | I o 1 |
| Elegir y usar un objeto | ← / → y Enter o 5; también puedes pulsarlo |
| Esperar un turno | . |
| Pausar / cerrar una ventana | Esc |

Hay botones en pantalla para ratón y pantalla táctil. Cada pulsación es una decisión, sin repetición por mantener una tecla pulsada. El primer giro es gratuito; el segundo consume turno. Los enemigos actúan tras tus acciones, salvo al cambiar de sala. Los cofres se abren por el frente, las llaves se consumen automáticamente y leer pergaminos no consume turno.

## Mecánicas trasladadas

- Tres tamaños de cubos; los grandes y medianos se dividen al morir. Trolls que regeneran vitalidad. Orientación y aproximación de enemigos conforme a las reglas del Java original.
- Placas de un solo uso, interruptores repetibles y trampas de invocación. Tanto el jugador como los monstruos pueden activarlos. Los enemigos generados tienen identificadores propios y se conservan al guardar.
- Armas normales y mágicas: cuchillos mortales, espada de fuego de diez usos, hacha vampírica, martillo que empuja, hacha que ignora defensa y Espada Maldita.
- Armadura de hueso que desaparece tras diez golpes que causan daño. Pociones y conjuros de fuerza, resistencia, invulnerabilidad, invisibilidad, velocidad y curación.
- Maestro que absorbe vitalidad. Las armas normales pueden debilitarlo, pero hace falta la Espada Maldita para matarlo. La maldición resta al portador la vitalidad restante de la víctima. La victoria requiere sobrevivir y alcanzar la salida final.
- Pasadizos secretos: las puertas disfrazadas de pared o invisibles no reciben un marcador que revele su posición.

## Estructura

```text
src/game/
  types.ts               Modelo de datos y formato de guardado
  rules.ts               Identificadores originales compartidos
  level.ts               Lectura y validación del formato x/r
  engine.ts              Movimiento, turnos, combate, objetos y placas
  adventure.ts           Continuidad entre capítulos y reintentos
  checkpoint.ts          Persistencia, validación y migración de guardados
  catalog.generated.ts   Tablas y textos importados del Java original
src/render/
  dungeon-scene.ts        Phaser, sprites y proyección isométrica
src/main.ts              Interfaz, teclado, historia y coordinación
src/style.css            Diseño adaptable y pixel art
public/assets/           Gráficos y mapas 0.dat–8.dat originales
tests/                   Pruebas automatizadas de reglas y campaña
```

## Validación y diferencias con J2ME

Las pruebas cubren los nueve mapas y las llegadas de sus puertas, conectividad de las salas utilizables y las salidas, progresión por los nueve capítulos, reglas de combate, efectos, durabilidad, placas, invocaciones, división de cubos, temporizador, persistencia y migración. Incluyen un recorrido normal completo del primer nivel y un escenario del encuentro final que obtiene la última llave y alcanza la salida con movimientos normales.

La versión web utiliza un generador aleatorio reproducible para continuar coherentemente las partidas, una interfaz en español y guardado completo después de cada acción en lugar de RMS entre niveles. Los textos narrativos y nombres de equipo se mantienen en inglés. La lectura de pistas es gratuita y los menús pausan las entradas de juego. Se evitan solapamientos al generar enemigos y llegar a una sala; se conserva la intención del combate final sin reproducir la asignación incondicional de un punto de vida del Java. No se permite resucitar con la experiencia de una muerte causada por la Espada Maldita.

No se ha realizado una comparación fotograma a fotograma con el JAR en un emulador ni se ha añadido música o sonido. La validación automatizada de progresión no equivale a una partida manual completa de las nueve mazmorras para evaluar su equilibrio.

## Créditos originales

Programación: **Antonio Calero**. Gráficos: **Jesús López**. 
Concepto y diseño: **Antonio Calero y Jesús López**. 

Nerode Burning Games.

Los recursos son material del autor del proyecto; no se añade una licencia de redistribución.
