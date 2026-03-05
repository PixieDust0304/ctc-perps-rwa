const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function log(level: LogLevel, component: string, message: string, data?: unknown) {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}] [${component}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

export const logger = {
  debug: (component: string, msg: string, data?: unknown) => log("debug", component, msg, data),
  info: (component: string, msg: string, data?: unknown) => log("info", component, msg, data),
  warn: (component: string, msg: string, data?: unknown) => log("warn", component, msg, data),
  error: (component: string, msg: string, data?: unknown) => log("error", component, msg, data),
};
