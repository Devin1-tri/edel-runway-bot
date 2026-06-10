import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const LOG_DIR = path.join(ROOT, 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logLevel = process.env.LOG_LEVEL || 'info';

// Custom format with timestamp and colors
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `[${timestamp}] ${level}: ${message}`;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: logLevel,
  transports: [
    // Console output with colors
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // Daily rotating file - all logs
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'bot.log'),
      format: fileFormat,
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 10,
    }),
    // Error-only file
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

/**
 * Log a vote result with structured data
 */
export function logVote(success, details = {}) {
  const emoji = success ? '✅' : '❌';
  const status = success ? 'SUCCESS' : 'FAILED';
  const msg = `${emoji} VOTE ${status} | Asset: ${details.asset || 'N/A'} | Strategy: ${details.strategy || 'N/A'} | Round: ${details.round || 'N/A'}`;
  
  if (success) {
    logger.info(msg);
  } else {
    logger.error(`${msg} | Error: ${details.error || 'Unknown'}`);
  }
}

/**
 * Log a separator line for readability
 */
export function logSeparator() {
  logger.info('─'.repeat(60));
}

export default logger;
