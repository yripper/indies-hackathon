import pino from 'pino';
import { env } from './env';

export const logger = pino({
  name: 'indies-hackathon',
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
