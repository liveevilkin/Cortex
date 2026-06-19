/**
 * Structured logging with configurable log level.
 */
type LogLevel = "debug" | "info" | "warn" | "error";
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19); // HH:MM:SS
}

export const logger = {
  debug(msg: string, ...args: unknown[]): void {
    if (shouldLog("debug")) {
      console.error(`[${timestamp()}] [DEBUG] ${msg}`, ...args);
    }
  },
  info(msg: string, ...args: unknown[]): void {
    if (shouldLog("info")) {
      console.error(`[${timestamp()}] [INFO] ${msg}`, ...args);
    }
  },
  warn(msg: string, ...args: unknown[]): void {
    if (shouldLog("warn")) {
      console.error(`[${timestamp()}] [WARN] ${msg}`, ...args);
    }
  },
  error(msg: string, ...args: unknown[]): void {
    if (shouldLog("error")) {
      console.error(`[${timestamp()}] [ERROR] ${msg}`, ...args);
    }
  },
};
