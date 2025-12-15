import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private redisClient: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    // Get Redis configuration from environment
    const redisUrl = 
      this.configService.get<string>('REDIS_URL') || 
      process.env.REDIS_URL;
    
    const redisHost = 
      this.configService.get<string>('REDIS_HOST') || 
      process.env.REDIS_HOST || 
      'redis-12462.c301.ap-south-1-1.ec2.cloud.redislabs.com';
    
    const redisPort = 
      this.configService.get<number>('REDIS_PORT') || 
      parseInt(process.env.REDIS_PORT || '12462', 10);
    
    const redisUsername = 
      this.configService.get<string>('REDIS_USERNAME') || 
      process.env.REDIS_USERNAME;
    
    const redisPassword = 
      this.configService.get<string>('REDIS_PASSWORD') || 
      process.env.REDIS_PASSWORD;

    // Build Redis connection options
    const redisOptions: any = {
      host: redisHost,
      port: redisPort,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        this.logger.warn(`Redis connection retry attempt ${times}, delay: ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 3,
    };

    // Add username and password if provided (Redis 6+ ACL support)
    if (redisUsername) {
      redisOptions.username = redisUsername;
    }
    
    if (redisPassword) {
      redisOptions.password = redisPassword;
      if (redisUsername) {
        this.logger.log(`Connecting to Redis: ${redisHost}:${redisPort} (user: ${redisUsername}, with password)`);
      } else {
        this.logger.log(`Connecting to Redis: ${redisHost}:${redisPort} (with password)`);
      }
    } else {
      this.logger.warn(`⚠️ Connecting to Redis: ${redisHost}:${redisPort} (NO PASSWORD - may fail if auth required)`);
    }

    // If REDIS_URL is provided and includes password, use it instead
    if (redisUrl) {
      const maskedUrl = redisUrl.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
      this.logger.log(`Connecting to Redis via URL: ${maskedUrl}`);
      this.redisClient = new Redis(redisUrl, {
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          this.logger.warn(`Redis connection retry attempt ${times}, delay: ${delay}ms`);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });
    } else {
      this.redisClient = new Redis(redisOptions);
    }

    this.redisClient.on('connect', () => {
      this.logger.log('✅ Redis connected successfully');
    });

    this.redisClient.on('error', (error) => {
      this.logger.error(`❌ Redis connection error: ${error.message}`);
    });

    this.redisClient.on('ready', () => {
      this.logger.log('✅ Redis client ready');
    });
  }

  onModuleDestroy() {
    if (this.redisClient) {
      this.redisClient.disconnect();
      this.logger.log('Redis client disconnected');
    }
  }

  /**
   * Get value from Redis
   */
  async get(key: string): Promise<string | null> {
    try {
      return await this.redisClient.get(key);
    } catch (error: any) {
      this.logger.error(`Redis GET error for key ${key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Set value in Redis with expiration (in seconds)
   */
  async set(key: string, value: string, expirationSeconds?: number): Promise<void> {
    try {
      if (expirationSeconds) {
        await this.redisClient.setex(key, expirationSeconds, value);
      } else {
        await this.redisClient.set(key, value);
      }
    } catch (error: any) {
      this.logger.error(`Redis SET error for key ${key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete key from Redis
   */
  async del(key: string): Promise<void> {
    try {
      await this.redisClient.del(key);
    } catch (error: any) {
      this.logger.error(`Redis DEL error for key ${key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redisClient.exists(key);
      return result === 1;
    } catch (error: any) {
      this.logger.error(`Redis EXISTS error for key ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get TTL (Time To Live) in seconds for a key
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.redisClient.ttl(key);
    } catch (error: any) {
      this.logger.error(`Redis TTL error for key ${key}: ${error.message}`);
      return -1;
    }
  }
}

