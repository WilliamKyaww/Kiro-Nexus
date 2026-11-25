// Names and descriptions of the palettes (run 6). The colours are tokens in styles.css,
// keyed on [data-theme][data-palette]; a preview is an element with its own pair.
import type { Appearance } from "@nexus/schema";

export interface PaletteInfo<Id extends string> { id: Id; name: string; description: string }

export const LIGHT: Array<PaletteInfo<Appearance["light"]>> = [
  { id: "porcelain", name: "Porcelain", description: "Pale zinc shell, white work panel and an iris accent. The default." },
  { id: "linen", name: "Linen", description: "Warm paper greys with a deep teal accent." },
  { id: "mist", name: "Mist", description: "Cool blue-greys with a cobalt accent." },
];

export const DARK: Array<PaletteInfo<Appearance["dark"]>> = [
  { id: "graphite", name: "Graphite", description: "Neutral graphite layers with a soft iris accent. The default." },
  { id: "midnight", name: "Midnight", description: "Blue-black layers with a sky-blue accent." },
  { id: "plum", name: "Plum", description: "Violet-black layers with a lilac accent." },
];
