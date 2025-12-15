import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SeatLock, SeatLockDocument, ReservationStatus, ReservationNumericState } from '../schemas/seat-lock.schema';
import { SeatsService } from '../seats/seats.service';

@Injectable()
export class SeatLockExpiryService implements OnModuleInit {
  constructor(
    @InjectModel(SeatLock.name) private seatLockModel: Model<SeatLockDocument>,
    private seatsService: SeatsService,
  ) {}

  onModuleInit() {
    // Check for expired reservations every 30 seconds
    setInterval(() => this.checkExpiredReservations(), 30000);
  }

  async checkExpiredReservations() {
    const now = new Date();
    // Only check -1 state (CART_TO_PAYMENT) - exclude -2 (IN_PAYMENT_GATEWAY) from expiry
    const expiredLocks = await this.seatLockModel.find({
      status: ReservationStatus.PENDING_PAYMENT,
      numericState: ReservationNumericState.CART_TO_PAYMENT, // Only check -1 state
      expiresAt: { $lt: now },
    }).exec();

    for (const lock of expiredLocks) {
      try {
        // Release seats - _id is now a string (reservationId)
        const reservationId = String(lock._id);
        await this.seatsService.releaseSeatsByReservation(reservationId);

        // Update status and numericState to -3 (TIMEOUT)
        lock.status = ReservationStatus.CANCELLED;
        lock.numericState = ReservationNumericState.TIMEOUT; // -3: timeout
        await lock.save();
      } catch (error) {
        console.error(`Error processing expired reservation ${lock._id}:`, error);
      }
    }
  }
}

