import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { utilities as nestWinstonUtilities } from 'nest-winston';
import type { WinstonModuleOptions } from 'nest-winston';

// One combined daily file (everything info+) and one error-only daily file
// (errors alone, easy to grep first when something's actually wrong) — see
// docs/qa/phase-13-logging-understanding-check.md Q2/Q3. Both gzip
// yesterday's file and prune anything past their retention window
// automatically; nothing here needs manual cleanup.
const LOG_DIR = 'logs';

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const combinedFileTransport = new winston.transports.DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'application-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  format: fileFormat,
});

const errorFileTransport = new winston.transports.DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '30d',
  level: 'error',
  format: fileFormat,
});

// Reproduces Nest's familiar colorized console output — only the on-disk
// transports switch to structured JSON. See Q4.
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    nestWinstonUtilities.format.nestLike('P1Dashboard', {
      colors: true,
      prettyPrint: true,
    }),
  ),
});

const isProd = process.env.NODE_ENV === 'production';

export const winstonLoggerOptions: WinstonModuleOptions = {
  level: isProd ? 'info' : 'debug',
  transports: [consoleTransport, combinedFileTransport, errorFileTransport],
  // Crashes that would otherwise only ever appear as a stack trace in a
  // terminal that's since scrolled away — captured to disk too.
  exceptionHandlers: [
    new winston.transports.DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'exceptions-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxFiles: '30d',
      format: fileFormat,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'rejections-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxFiles: '30d',
      format: fileFormat,
    }),
  ],
};
