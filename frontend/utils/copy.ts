export const colors = [
  '#f4f4f5', //white
  '#71717a', //gray
  '#18181b', //black
  '#ef4444', //red
  '#f97316', //orange
  '#f59e0b', //amber
  '#eab308', //yellow
  '#84cc16', //lime
  '#22c55e', //green
  '#14b8a6', //teal
  '#06b6d4', //cyan
  '#0ea5e9', //sky
  '#3b82f6', //blue
  '#6366f1', //indigo
  '#8b5cf6', //violet
  '#a855f7', //purple
  '#d946ef', //fuchsia
  '#ec4899', //pink
]

/**
 * Converts a camelCase string into a space-separated string.
 * For example, "FooBar" becomes "Foo Bar", and "fooBar" becomes "foo Bar".
 *
 * @param {string} str - The camelCase string to convert.
 * @returns {string} The space-separated string.
 */
export const camelCaseToSpaces = (str: string): string => {
  return str.replace(/([a-z])([A-Z])/g, '$1 $2');
};

/**
 * Generates a hex color code from a given string.
 * The same string will always return the same color.
 *
 * @param {string} input - The input string to generate the color from.
 * @returns {string} - A valid hex color code (e.g., #a1b2c3).
 */
export const stringToHexColor = (input: string): string => {
  // Simple hash function to generate a consistent hash from the input string
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Convert the hash to a hex color code
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xFF;
    color += ('00' + value.toString(16)).slice(-2);
  }

  return color;
}

/**
 * Determines whether to use black or white text on top of a given hex color.
 *
 * @param {string} hexColor - The hex color code (e.g., #a1b2c3).
 * @returns {string} - "black" or "white", depending on the luminance of the background color.
 */
export const getContrastingTextColor = (hexColor: string): string => {
  // Convert hex to RGB
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black or white depending on luminance
  return luminance > 0.5 ? 'black' : 'white';
};

/**
* Generates a random hexadecimal color string.
*
* @returns {string} A string representing a random hex color in the format "#RRGGBB".
*/
export const generateRandomHexColor = (): string => {
 // Generate a random number between 0 and 0xFFFFFF, then convert to a hexadecimal string
 const randomColor = Math.floor(Math.random() * 0xffffff).toString(16)
 // Pad the string with leading zeros if necessary to ensure it has a length of 6 characters
 return '#' + randomColor.padStart(6, '0')
}

/**
 * Returns a random color from a curated list of colors.
 *
 * @returns {string} A random color in hex format.
 */
export const getRandomCuratedColor = (): string => {
  const randomIndex = Math.floor(Math.random() * colors.length);
  return colors[randomIndex];
};
