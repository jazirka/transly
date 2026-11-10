/**
 * The message window of an RPG Maker MV/MZ game as the line width sees it. The numbers are the defaults of the engine
 * (816 px wide, 18 px of padding, a face picture takes 144 px plus the gap, a 28 px font); a game that changes them is
 * set in the tool «Перенесення рядків». The measuring of text itself needs a font and is done by the caller (`measure`).
 */
export interface GameWindow { width: number; padding: number; face: number; font: number }

export const MV_WINDOW: GameWindow = { width: 816, padding: 18, face: 168, font: 28 };

/** The width of the text area in pixels: the window without its padding, and without the picture of a face when the message has one. */
export const pixelBudget = (hasFace: boolean, win: GameWindow = MV_WINDOW): number => win.width - 2 * win.padding - (hasFace ? win.face : 0);
