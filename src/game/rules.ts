/** Numeric identifiers are the unchanged wire format used by the J2ME maps. */
export const Kind = {
  LargeCube: 0, MediumCube: 1, SmallCube: 2, Goblin: 3, Orc: 4, Warrior: 5,
  Troll: 6, RedBeast: 7, Wizard: 8, Ogre: 9, Barrel: 10, Chest: 11, Altar: 12,
  Library: 13, Plate: 14, Switch: 15, SummonPlate: 16, Brazier: 17, Torch: 18, Master: 19,
} as const;
export const Weapon = { Dagger: 0, Sword: 1, Knives: 6, Flame: 7, Vampiric: 8, Shock: 9, Biting: 10, Damned: 11 } as const;
export const Spell = { Strength: 0, Resistance: 1, Invulnerable: 2, Invisible: 3, Speed: 4, Heal: 5 } as const;
export const FINAL_LEVEL = 8;
export function isEnemy(type: number): boolean {
  return type < Kind.Barrel || type === Kind.Master;
}
export function isPlate(type: number): boolean {
  return type >= Kind.Plate && type <= Kind.SummonPlate;
}
