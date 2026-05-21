const isDev = import.meta.env.DEV;

type Level = "info" | "warn" | "error" | "debug";

type LogData = Record<string, unknown>;

function emit(level: Level, message: string, data?: LogData) {
  if (!isDev) return;
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  const style = {
    info:  "color:#3b82f6;font-weight:bold",
    warn:  "color:#f59e0b;font-weight:bold",
    error: "color:#ef4444;font-weight:bold",
    debug: "color:#8b5cf6;font-weight:bold",
  }[level];

  if (data && Object.keys(data).length > 0) {
    console.groupCollapsed(`%c${prefix}%c ${message}`, style, "color:inherit;font-weight:normal");
    console.table(data);
    console.groupEnd();
  } else {
    console.log(`%c${prefix}%c ${message}`, style, "color:inherit;font-weight:normal");
  }
}

export const log = {
  info:  (message: string, data?: LogData) => emit("info",  message, data),
  warn:  (message: string, data?: LogData) => emit("warn",  message, data),
  error: (message: string, data?: LogData) => emit("error", message, data),
  debug: (message: string, data?: LogData) => emit("debug", message, data),
};
