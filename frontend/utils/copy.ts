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