export const sanitizeInput = (value: string) => value.replace(/[^a-zA-Z0-9\-_]/g, '')
