const NAMES = [
  'Mochi', 'Pixel', 'Biscuit', 'Nimbus', 'Waffles', 'Pebble', 'Tofu', 'Noodle', 'Maple', 'Pudding',
  'Clover', 'Sprout', 'Dumpling', 'Peanut', 'Olive', 'Pickle', 'Muffin', 'Cocoa', 'Honey', 'Ginger',
  'Pretzel', 'Truffle', 'Bagel', 'Churro', 'Taco', 'Nacho', 'Mango', 'Kiwi', 'Pumpkin', 'Boba',
  'Marshmallow', 'Cookie', 'Brownie', 'Toast', 'Crumpet', 'Scone', 'Butter', 'Sesame', 'Cinnamon', 'Nutmeg',
  'Pepper', 'Basil', 'Sage', 'Juniper', 'Willow', 'Hazel', 'Acorn', 'Fern', 'Moss', 'Birch',
  'Comet', 'Rocket', 'Zippy', 'Ziggy', 'Bubbles', 'Sprinkles', 'Doodle', 'Scribble', 'Widget', 'Gizmo',
  'Bolt', 'Rusty', 'Domino', 'Pistachio', 'Almond', 'Cashew', 'Walnut', 'Pecan', 'Latte', 'Espresso',
  'Miso', 'Wasabi', 'Ramen', 'Gyoza', 'Panko', 'Yuzu', 'Matcha', 'Sushi', 'Bento', 'Udon',
];

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function nameFor(id, taken = new Set()) {
  const base = NAMES[hashString(id) % NAMES.length];
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

export { NAMES };
