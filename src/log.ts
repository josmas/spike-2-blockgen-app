/** Timestamped console logging for generation requests. */
export const log = (message: string): void => {
  console.log(`[blockgen ${new Date().toLocaleTimeString()}] ${message}`);
};
