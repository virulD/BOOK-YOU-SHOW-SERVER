import { Module } from '@nestjs/common';
import { DialogEsmsService } from './dialog-esms.service';
import { DialogEsmsController } from './dialog-esms.controller';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [DialogEsmsService],
  controllers: [DialogEsmsController],
  exports: [DialogEsmsService],
})
export class DialogEsmsModule {}

