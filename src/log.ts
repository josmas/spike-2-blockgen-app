type Sink = (message: string) => void;

let sink: Sink = (message) => console.log(message);

/** Redirects log output, e.g. so the benchmark can collect it quietly. */
export const setLogSink = (next: Sink): void => {
  sink = next;
};

/** Timestamped logging for generation requests. */
export const log = (message: string): void => {
  sink(`[blockgen ${new Date().toLocaleTimeString()}] ${message}`);
};
