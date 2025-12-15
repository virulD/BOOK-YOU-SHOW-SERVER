import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SeatLock, SeatLockSchema } from '../schemas/seat-lock.schema';
import { SeatLockBackup, SeatLockBackupSchema } from '../schemas/seat-lock-backup.schema';
import { Booking, BookingSchema } from '../schemas/booking.schema';
import { Seat, SeatSchema } from '../schemas/seat.schema';
import { BookingsModule } from '../bookings/bookings.module';
import { SeatsModule } from '../seats/seats.module';
import { EventsModule } from '../events/events.module';
import { FirebaseMessageModule } from '../firebase-message/firebase-message.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SeatLock.name, schema: SeatLockSchema },
      { name: SeatLockBackup.name, schema: SeatLockBackupSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Seat.name, schema: SeatSchema },
    ]),
    BookingsModule,
    SeatsModule,
    EventsModule,
    FirebaseMessageModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}

