import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { SeatLockExpiryService } from './seat-lock-expiry.service';
import { SeatLock, SeatLockSchema } from '../schemas/seat-lock.schema';
import { Booking, BookingSchema } from '../schemas/booking.schema';
import { Seat, SeatSchema } from '../schemas/seat.schema';
import { SeatsModule } from '../seats/seats.module';
import { EventsModule } from '../events/events.module';
import { FirebaseMessageModule } from '../firebase-message/firebase-message.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SeatLock.name, schema: SeatLockSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Seat.name, schema: SeatSchema },
    ]),
    SeatsModule,
    EventsModule,
    FirebaseMessageModule,
    SmsModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService, SeatLockExpiryService],
  exports: [BookingsService],
})
export class BookingsModule {}

