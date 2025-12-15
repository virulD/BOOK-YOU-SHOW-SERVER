import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SeatsController } from './seats.controller';
import { SeatsService } from './seats.service';
import { Seat, SeatSchema } from '../schemas/seat.schema';
import { SeatLock, SeatLockSchema } from '../schemas/seat-lock.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Seat.name, schema: SeatSchema },
      { name: SeatLock.name, schema: SeatLockSchema },
    ]),
  ],
  controllers: [SeatsController],
  providers: [SeatsService],
  exports: [SeatsService],
})
export class SeatsModule {}

