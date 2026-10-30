import Phaser from 'phaser';
import './style.css';
import { catalog } from './game/catalog.generated';
import { Dungeon, DIRECTION_NAMES, itemName } from './game/engine';
import { parseLevel } from './game/level';
import { Adventure } from './game/adventure';
import { readAdventure, writeAdventure } from './game/checkpoint';
import { DungeonScene } from './render/dungeon-scene';
import type { Action, AdventureSave, Item, Level } from './game/types';
import { FINAL_LEVEL, Kind, Weapon } from './game/rules';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dialog = $<HTMLDialogElement>('game-dialog');
let dungeon: Dungeon;
let level: Level;
let levels: Level[];
let adventure: Adventure;
let saved: AdventureSave | null = null;
let started = false;
let ready = false;
let dialogKind = '';
let storage: Storage | null = null;
let inventorySelection = 0;
let previousFocus: HTMLElement | null = null;
const scene = new DungeonScene(() => {
  if (dungeon) {
    scene.show(dungeon);
    ready = true;
    const button = $<HTMLButtonElement>('start');
    button.disabled = false;
    button.textContent = 'Empezar aventura →';
  }
});

function warn(message: string): void {
  $('error-banner').textContent = message;
  $('error-banner').hidden = false;
}

function persist(): void {
  const snapshot = adventure.snapshot();
  const success = storage && writeAdventure(storage, snapshot);
  $('save-status').textContent = success ? 'PROGRESO GUARDADO EN ESTE NAVEGADOR' : 'SIN GUARDADO · ALMACENAMIENTO NO DISPONIBLE';
  if (success) saved = snapshot;
}

function begin(restore: boolean): void {
  if (!ready) return;
  adventure = new Adventure(levels, restore && saved ? saved : undefined);
  dungeon = adventure.dungeon;
  level = dungeon.level;
  // Reading is a transient UI state; a restored game must always accept controls.
  dungeon.state.parchment = null;
  started = true;
  $('start-screen').hidden = true;
  $<HTMLButtonElement>('pause').disabled = false;
  scene.show(dungeon);
  persist();
  update();
  showEnd();
  if (!restore) showChapter();
}

function originalText(text: string): string {
  return text.split('n').join('\n');
}

function showChapter(): void {
  openDialog('chapter', catalog.LEVEL_NAME[level.index], originalText(catalog.LEVEL_DESCRIPTION[level.index]));
  dialogButton('Entrar en el capítulo', closeDialog, true);
}

function advance(): void {
  closeDialog();
  if (!adventure.advance()) return;
  dungeon = adventure.dungeon;
  level = dungeon.level;
  scene.show(dungeon);
  persist();
  update();
  showChapter();
}

function retry(): void {
  closeDialog();
  adventure.retry();
  dungeon = adventure.dungeon;
  level = dungeon.level;
  scene.show(dungeon);
  persist();
  update();
  showChapter();
}

function update(): void {
  const state = dungeon.state;
  const player = state.player;
  const masterAlive = state.entities.some(entity => entity.type === Kind.Master && !entity.removed);
  $('chapter-title').textContent = `${catalog.LEVEL_NAME[level.index]}.`;
  $('chapter-eyebrow').textContent = `CAPÍTULO ${String(level.index + 1).padStart(2, '0')} / ${FINAL_LEVEL + 1}`;
  $('chapter-description').textContent = level.index === FINAL_LEVEL ? 'En el corazón de la ciudadela, el Maestro te espera.' :
    `Tu viaje por el mundo de Rok continúa. ${FINAL_LEVEL + 1 - level.index} capítulos hasta salvar la fortaleza.`;
  document.title = `Rok & Role — ${catalog.LEVEL_NAME[level.index]}`;
  const hp = $('hp-value');
  hp.replaceChildren(document.createTextNode(`${player.hp} `));
  const max = document.createElement('span');
  max.textContent = `/ ${player.maxHp}`;
  hp.append(max);
  $('hp-fill').style.width = `${player.hp / player.maxHp * 100}%`;
  $('hp-meter').classList.toggle('low', player.hp / player.maxHp < 0.35);
  $('hp-meter').setAttribute('aria-valuemax', String(player.maxHp));
  $('hp-meter').setAttribute('aria-valuenow', String(player.hp));
  $('hero-level').textContent = `NIVEL ${player.level}`;
  $('xp-value').textContent = `${player.xp} / ${player.nextXp} PX`;
  $('xp-fill').style.width = `${Math.min(100, player.xp / player.nextXp * 100)}%`;
  $('weapon-name').textContent = catalog.WEAPON_DESCRIPTION[player.weapon];
  $('weapon-stat').textContent = player.weapon === Weapon.Damned ? 'Muerte a cambio de vitalidad' :
    `${catalog.WEAPON_CA_MIN[player.weapon]}–${catalog.WEAPON_CA_MAX[player.weapon]} de daño`;
  $('armor-name').textContent = catalog.ARMOR_DESCRIPTION[player.armor];
  $('armor-stat').textContent = `${catalog.ARMOR_CD[player.armor]} de defensa`;
  $('room-label').textContent = `SALA ${String(state.roomId + 1).padStart(2, '0')} / ${level.rooms.length}`;
  $('facing-label').textContent = `Halloran · mirando al ${DIRECTION_NAMES[player.direction]}`;
  $('turn-label').textContent = state.remainingTurns !== -1 ? `ESCAPA EN ${state.remainingTurns} TURNOS` : `TURNO ${String(state.turn).padStart(3, '0')}`;
  $('turn-label').classList.toggle('urgent', state.remainingTurns !== -1 && state.remainingTurns <= 20);
  $('turn-status').textContent = state.status === 'playing' ? (state.freeRotation ? 'Tu turno · giro gratuito usado' : 'Tu turno · piensa tu próximo paso') :
    state.status === 'cleared' ? 'Capítulo completado · continúa la aventura' : state.status === 'victory' ? 'La fortaleza está a salvo' : 'Fin de la aventura';
  $('pause').textContent = state.status === 'cleared' ? 'Siguiente capítulo →' : state.status === 'dead' ? 'Reintentar capítulo' : state.status === 'victory' ? 'Ver desenlace' : 'Pausa · Esc';
  $('explored-count').textContent = `${state.visited.length} / ${level.rooms.length}`;
  $('explored-rooms').replaceChildren(...level.rooms.map(room => {
    const mark = document.createElement('span');
    mark.className = room.id === state.roomId ? 'current' : state.visited.includes(room.id) ? 'visited' : '';
    mark.title = `Sala ${room.id + 1}${state.visited.includes(room.id) ? ' · descubierta' : ''}`;
    return mark;
  }));
  $('quest-hint').textContent = state.status === 'victory' ? 'Has salvado a tu pueblo. La fortaleza vuelve a respirar.' :
    level.index === 0 && state.visited.length <= 2 ? 'Busca la llave en el cofre de la segunda sala.' :
    state.remainingTurns !== -1 ? 'Las salidas se están sellando. Cruza el hielo antes de que se agote el tiempo.' :
    level.index === FINAL_LEVEL ? masterAlive ? 'Encuentra la Espada Maldita. Debilita al Maestro antes de usarla.' :
      'El Maestro ha caído. Usa la última llave y encuentra la salida.' :
    'Las placas cambian puertas. Algunas paredes ocultan pasadizos. Lee los pergaminos.';
  const effect = state.effect;
  $('active-effect').hidden = !effect;
  $('active-effect').textContent = effect ? `${catalog.SCROLL_DESCRIPTION[effect.kind]} · ${effect.turns} turnos` : '';
  $('quest-title').textContent = state.status === 'victory' ? 'La fortaleza está a salvo' :
    level.index === FINAL_LEVEL ? masterAlive ? 'Derrota al Maestro' : 'Escapa de la ciudadela' : 'Encuentra la salida';
  $('quest-description').textContent = state.status === 'victory' ? 'Tu misión ha terminado. Tu pueblo te recibe como un héroe.' :
    level.index === FINAL_LEVEL ? 'Pon fin al asedio y regresa con vida a la fortaleza.' : 'Explora las mazmorras y abre camino hacia el siguiente capítulo.';
  $('journal').replaceChildren(...state.log.slice(-4).map(line => {
    const item = document.createElement('li');
    item.textContent = line;
    return item;
  }));
  const latest = state.log.at(-1) ?? '';
  if ($('announcement').textContent !== latest) $('announcement').textContent = latest;
  document.querySelectorAll<HTMLButtonElement>('[data-action], #inventory').forEach(button => {
    button.disabled = !started || state.status !== 'playing';
  });
}

function act(action: Action): void {
  if (!started || !ready || dialog.open || scene.isBusy || dungeon.state.status !== 'playing') return;
  const outcome = dungeon.act(action);
  scene.play(action, outcome);
  persist();
  update();
  showEnd();
}

function openDialog(kind: string, title: string, text: string): void {
  dialogKind = kind;
  if (!dialog.open) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $('dialog-title').textContent = title;
  $('dialog-body').textContent = text;
  $('dialog-actions').replaceChildren();
  if (!dialog.open) dialog.showModal();
}

function closeDialog(): void {
  if (dungeon && dungeon.state.parchment !== null) {
    dungeon.state.parchment = null;
    persist();
  }
  dialog.close();
  dialogKind = '';
  previousFocus?.focus();
}

function dialogButton(label: string, action: () => void, primary = false): void {
  const button = document.createElement('button');
  button.textContent = label;
  if (primary) button.className = 'primary-button';
  button.addEventListener('click', action);
  $('dialog-actions').append(button);
}

function showPause(): void {
  if (!started || dialog.open || dungeon.state.status !== 'playing') return;
  openDialog('pause', 'Un respiro en las ruinas', 'La aventura es por turnos: mientras no actúes, nada se mueve. Tu progreso se guarda automáticamente en este navegador.');
  dialogButton('Seguir explorando', closeDialog, true);
  dialogButton('Reintentar capítulo', () => {
    openDialog('retry', '¿Regresar al inicio del capítulo?', 'Recuperarás el equipo y la vitalidad con los que entraste. Se reiniciarán las salas, los enemigos y las puertas de este capítulo.');
    dialogButton('Reintentar capítulo', retry, true);
    dialogButton('Seguir explorando', closeDialog);
  });
  dialogButton('Empezar de nuevo', confirmRestart);
}

function confirmRestart(): void {
  openDialog('restart', '¿Volver al principio?', 'Empezarás la aventura desde el primer capítulo con tu equipo inicial. Se sustituirá la partida guardada.');
  dialogButton('Nueva aventura', () => { closeDialog(); begin(false); }, true);
  dialogButton('Conservar partida', closeDialog);
}

function showEnd(): void {
  if (dungeon.state.status === 'playing') return;
  if (dungeon.state.status === 'cleared') {
    openDialog('cleared', 'Un paso más allá.', `Has completado ${catalog.LEVEL_NAME[level.index]} en ${dungeon.state.turn} turnos. Conservas tu experiencia, vitalidad, equipo y consumibles. Las llaves y pistas pertenecen a este capítulo.`);
    dialogButton(`Continuar: ${catalog.LEVEL_NAME[level.index + 1]}`, advance, true);
    dialogButton('Ver la sala', closeDialog);
    return;
  }
  const won = dungeon.state.status === 'victory';
  openDialog('end', won ? 'El mundo de Rok vuelve a respirar.' : 'La oscuridad te ha alcanzado.', won
    ? `${originalText(catalog.VICTORY_MSG)}\n\nLos nueve capítulos completados en ${dungeon.state.totalTurns} turnos.\n\nProgramación: Antonio Calero. Gráficos: Jesús López. Concepto y diseño: Antonio Calero y Jesús López.`
    : 'Halloran ha caído. Puedes volver al inicio de este capítulo con el equipo y la vitalidad que tenías al entrar. La fortaleza sigue esperando un héroe.');
  if (!won) dialogButton('Reintentar este capítulo', retry, true);
  dialogButton('Nueva aventura', confirmRestart, won);
  dialogButton('Ver la sala', closeDialog);
}

function itemDescription(item: Item): string {
  const player = dungeon.state.player;
  if (item.type === 0) return 'Se usa automáticamente en su puerta.';
  if (item.type === 5) return 'Leer una pista · no consume turno';
  const uses = item.uses !== undefined ? ` · ${item.uses} usos` : '';
  if (item.type === 1) {
    const special: Record<number, string> = { 6: 'Mata al infligir daño', 7: 'Daño de fuego', 8: 'Roba vitalidad', 9: 'Empuja al enemigo', 10: 'Ignora la defensa', 11: 'Mata y consume la vida que le queda al enemigo' };
    return `${item.value === Weapon.Damned ? '' : `${catalog.WEAPON_CA_MIN[item.value]}–${catalog.WEAPON_CA_MAX[item.value]} daño · `}${special[item.value] ?? 'Arma de combate'}${player.weapon === item.value ? ' · equipada' : ''}${uses}`;
  }
  if (item.type === 2) return `${catalog.ARMOR_CD[item.value]} defensa${player.armor === item.value ? ' · equipada' : ' · equipar'}${uses}`;
  return item.value === 5 ? 'Recuperar vitalidad · 1 turno' : 'Efecto mágico temporal · 1 turno';
}

function showInventory(): void {
  if (!started || dungeon.state.status !== 'playing' || scene.isBusy) return;
  if (dialog.open) {
    if (dialogKind === 'inventory') closeDialog();
    return;
  }
  openDialog('inventory', 'Lo que llevas contigo', '');
  const grid = document.createElement('div');
  grid.className = 'inventory-grid';
  dungeon.state.player.inventory.forEach((item, index) => {
    const button = document.createElement('button');
    button.className = 'item-card';
    if ((item.type === 1 && dungeon.state.player.weapon === item.value) ||
        (item.type === 2 && dungeon.state.player.armor === item.value)) button.classList.add('equipped');
    const title = document.createElement('strong');
    title.textContent = itemName(item);
    const detail = document.createElement('span');
    detail.textContent = itemDescription(item);
    button.append(title, detail);
    button.addEventListener('click', () => useItem(index));
    grid.append(button);
  });
  $('dialog-body').append(grid);
  dialogButton('Volver a la aventura', closeDialog);
  inventorySelection = 0;
  grid.querySelector('button')?.focus();
}

function useItem(index: number): void {
  closeDialog();
  dungeon.useItem(index);
  if (dungeon.state.parchment !== null) {
    const text = catalog.PERGAMINO_BODY[dungeon.state.parchment];
    openDialog('parchment', 'Un mensaje entre las ruinas', '');
    const parchment = document.createElement('div');
    parchment.className = 'parchment';
    parchment.textContent = originalText(text);
    $('dialog-body').append(parchment);
    dialogButton('Guardar el pergamino', closeDialog, true);
  }
  persist();
  update();
  scene.show(dungeon);
  showEnd();
}

function help(): void {
  openDialog('help', 'Cada paso cuenta.', '↑ / W / 2: avanzar en la dirección que miras.\n↓ / S / 8: retroceder sin girarte.\n← / A / 4 y → / D / 6: girar. El primer giro es gratis; el segundo termina tu turno.\n\nEspacio / Enter / 5: atacar o registrar el objeto de enfrente. Los cofres se abren por el frente.\nI / 1: inventario. Elige objetos con ← → y úsalos con Enter.\nPunto: esperar un turno. Esc: pausa o cerrar ventana.\n\nLos enemigos actúan después de ti. Cruzar una puerta da un respiro. Los ataques laterales y por la espalda hacen el doble de daño. Las llaves se usan automáticamente.\n\nLas placas pueden cambiar varias puertas y también las activan los monstruos. Algunas funcionan una vez, otras se pueden repetir y otras son trampas. Hay pasadizos secretos.\n\nConservas personaje y equipo al avanzar; las llaves y pergaminos de pista se quedan atrás. El guardado es automático. Si caes, puedes reintentar el capítulo con el equipo de entrada. La huida por el hielo tiene un límite de turnos.\n\nCompleta los nueve capítulos y salva la fortaleza. Lee las pistas para descubrir cómo derrotar al Maestro.\n\nProgramación: Antonio Calero. Gráficos: Jesús López. Concepto y diseño: Antonio Calero y Jesús López.');
  dialogButton('Entendido', closeDialog, true);
}

const keyActions: Record<string, Action> = {
  ArrowUp: 'forward', w: 'forward', '2': 'forward', ArrowDown: 'backward', s: 'backward', '8': 'backward',
  ArrowLeft: 'left', a: 'left', '4': 'left', ArrowRight: 'right', d: 'right', '6': 'right',
  ' ': 'attack', Enter: 'attack', '5': 'attack', '.': 'wait',
};
document.addEventListener('keydown', event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (dialog.open) {
    if (dialogKind === 'inventory' && ['ArrowLeft', 'ArrowRight', '4', '6'].includes(key)) {
      event.preventDefault();
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('.item-card')];
      inventorySelection = (inventorySelection + (key === 'ArrowLeft' || key === '4' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[inventorySelection]?.focus();
    } else if (dialogKind === 'inventory' && (key === 'i' || key === '1')) {
      event.preventDefault();
      closeDialog();
    } else if (dialogKind === 'inventory' && key === '5') {
      event.preventDefault();
      useItem(inventorySelection);
    }
    return;
  }
  if (key === 'Escape') showPause();
  else if (key === 'i' || key === '1') { event.preventDefault(); showInventory(); }
  else if (started && keyActions[key]) {
    if (event.target instanceof HTMLButtonElement && [' ', 'Enter'].includes(key)) return;
    event.preventDefault();
    act(keyActions[key]);
  }
});
dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
$('close-dialog').addEventListener('click', closeDialog);
$('start').addEventListener('click', () => saved ? confirmRestart() : begin(false));
$('continue').addEventListener('click', () => begin(true));
$('pause').addEventListener('click', () => dungeon.state.status === 'playing' ? showPause() : showEnd());
$('story').addEventListener('click', () => {
  openDialog('story', 'La última esperanza de la fortaleza', catalog.INTRODUCTION.map(originalText).join('\n\n'));
  dialogButton('Volver', closeDialog, true);
});
$('help').addEventListener('click', help);
$('inventory').addEventListener('click', showInventory);
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
  button.addEventListener('click', () => { act(button.dataset.action as Action); button.blur(); });
});
document.addEventListener('visibilitychange', () => { if (document.hidden) showPause(); });
document.addEventListener('game-error', event => warn((event as CustomEvent<string>).detail));

async function boot(): Promise<void> {
  try {
    levels = await Promise.all(Array.from({ length: FINAL_LEVEL + 1 }, async (_, index) => {
      const response = await fetch(`${import.meta.env.BASE_URL}assets/${index}.dat`);
      if (!response.ok) throw new Error(`Map ${index} request failed: ${response.status}`);
      return parseLevel(await response.text(), index);
    }));
    try { storage = window.localStorage; } catch { warn('El navegador no permite guardar. Puedes jugar igualmente.'); }
    if (storage) {
      const result = readAdventure(storage, levels);
      saved = result.save;
      if (result.warning) warn(result.warning);
    }
    adventure = new Adventure(levels);
    dungeon = adventure.dungeon;
    level = dungeon.level;
    $('continue').hidden = !saved;
    new Phaser.Game({
      type: Phaser.CANVAS, parent: 'game', width: 480, height: 300, pixelArt: true, roundPixels: true,
      backgroundColor: '#141b1a', scene, banner: false,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      input: { keyboard: false }, audio: { noAudio: true },
    });
    update();
  } catch (error) {
    console.error('Game initialization failed.', error);
    warn('No se pudo iniciar la aventura. Recarga la página o comprueba que el servidor local sigue abierto.');
    $('start').textContent = 'Error de carga';
  }
}

void boot();
