import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Seat, SeatDocument, SeatState } from '../schemas/seat.schema';
import { SeatLock, SeatLockDocument, ReservationNumericState } from '../schemas/seat-lock.schema';
import { CreateSeatDto, UpdateSeatsDto } from '../dto/create-seat.dto';

@Injectable()
export class SeatsService {
  constructor(
    @InjectModel(Seat.name) private seatModel: Model<SeatDocument>,
    @InjectModel(SeatLock.name) private seatLockModel: Model<SeatLockDocument>,
  ) {}

  async createSeat(createSeatDto: CreateSeatDto, eventId: string): Promise<SeatDocument> {
    const seat = new this.seatModel({
      ...createSeatDto,
      eventId: new Types.ObjectId(eventId),
    });
    return seat.save();
  }

  async updateSeats(eventId: string, updateSeatsDto: UpdateSeatsDto): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    console.log(`Updating ${updateSeatsDto.seats.length} seats for event ${eventId}`);

    for (const seatDto of updateSeatsDto.seats) {
      try {
        // Remove _id from the update data to avoid conflicts
        const { _id, ...seatData } = seatDto;
        
        if (_id) {
          // Update existing seat
          const result = await this.seatModel.updateOne(
            { _id: new Types.ObjectId(_id), eventId: new Types.ObjectId(eventId) },
            { $set: seatData },
          ).exec();
          if (result.matchedCount > 0) {
            updated++;
          } else {
            console.warn(`Seat ${_id} not found for event ${eventId}`);
          }
        } else {
          // Create new seat
          await this.createSeat(seatDto, eventId);
          created++;
        }
      } catch (error: any) {
        console.error(`Error processing seat ${seatDto.label}:`, error);
        throw new BadRequestException(`Failed to update seat ${seatDto.label}: ${error.message}`);
      }
    }

    console.log(`Seats update complete: ${created} created, ${updated} updated`);
    return { created, updated };
  }

  async findAllByEvent(eventId: string, page = 0, limit = 5000): Promise<SeatDocument[]> {
    // Return all seats for the event - seats with payment_pending state will be visible
    // with a different color (yellow) to indicate they're pending payment
    const seats = await this.seatModel
      .find({ eventId: new Types.ObjectId(eventId) })
      .skip(page * limit)
      .limit(limit)
      .exec();

    return seats;
  }

  async findOne(id: string): Promise<SeatDocument> {
    const seat = await this.seatModel.findById(id).exec();
    if (!seat) {
      throw new NotFoundException(`Seat with ID ${id} not found`);
    }
    return seat;
  }

  async findByEventAndIds(eventId: string, seatIds: string[]): Promise<SeatDocument[]> {
    return this.seatModel.find({
      eventId: new Types.ObjectId(eventId),
      _id: { $in: seatIds.map(id => new Types.ObjectId(id)) },
    }).exec();
  }

  async updateSeatState(
    seatId: string,
    state: SeatState,
    pendingReservationId?: string,
  ): Promise<boolean> {
    const update: any = { state };
    if (pendingReservationId) {
      update.pendingReservationId = pendingReservationId;
    } else {
      update.$unset = { pendingReservationId: '' };
    }

    const result = await this.seatModel.updateOne({ _id: seatId }, { $set: update }).exec();
    return result.matchedCount > 0;
  }

  async atomicLockSeats(
    seatIds: string[],
    reservationId: string,
  ): Promise<{ success: boolean; failedSeatIds: string[] }> {
    const failedSeatIds: string[] = [];
    const lockedSeatIds: string[] = [];

    // Try to lock each seat atomically
    for (const seatId of seatIds) {
      try {
        // Convert seatId to ObjectId if it's a string
        const seatObjectId = typeof seatId === 'string' ? new Types.ObjectId(seatId) : seatId;
        
        const result = await this.seatModel.updateOne(
          { _id: seatObjectId, state: SeatState.AVAILABLE },
          { $set: { state: SeatState.PAYMENT_PENDING, pendingReservationId: reservationId } },
        ).exec();

        if (result.matchedCount === 0) {
          // Check if seat exists but is not available
          const seat = await this.seatModel.findById(seatObjectId).exec();
          if (!seat) {
            console.warn(`Seat ${seatId} not found`);
          } else {
            console.warn(`Seat ${seatId} is not available (current state: ${seat.state})`);
          }
          failedSeatIds.push(String(seatId));
        } else {
          lockedSeatIds.push(String(seatId));
        }
      } catch (error: any) {
        console.error(`Error locking seat ${seatId}:`, error);
        failedSeatIds.push(String(seatId));
      }
    }

    // If any failed, rollback all locked seats
    if (failedSeatIds.length > 0) {
      if (lockedSeatIds.length > 0) {
        await this.seatModel.updateMany(
          { _id: { $in: lockedSeatIds.map(id => new Types.ObjectId(id)) } },
          { $set: { state: SeatState.AVAILABLE }, $unset: { pendingReservationId: '' } },
        ).exec();
      }
      return { success: false, failedSeatIds };
    }

    return { success: true, failedSeatIds: [] };
  }

  async atomicConfirmSeats(
    seatIds: string[],
    reservationId: string,
  ): Promise<number> {
    const result = await this.seatModel.updateMany(
      {
        _id: { $in: seatIds.map(id => new Types.ObjectId(id)) },
        state: SeatState.PAYMENT_PENDING,
        pendingReservationId: reservationId,
      },
      { $set: { state: SeatState.BOOKED }, $unset: { pendingReservationId: '' } },
    ).exec();

    return result.modifiedCount;
  }

  async setSeatsToPaymentPending(seatIds: string[], reservationId: string): Promise<number> {
    const result = await this.seatModel.updateMany(
      {
        _id: { $in: seatIds.map(id => new Types.ObjectId(id)) },
        state: { $in: [SeatState.AVAILABLE, SeatState.PAYMENT_PENDING] },
      },
      {
        $set: {
          state: SeatState.PAYMENT_PENDING,
          pendingReservationId: reservationId,
        },
      },
    ).exec();

    return result.modifiedCount;
  }

  async releaseSeatsByReservation(reservationId: string): Promise<number> {
    const result = await this.seatModel.updateMany(
      { pendingReservationId: reservationId, state: SeatState.PAYMENT_PENDING },
      { $set: { state: SeatState.AVAILABLE }, $unset: { pendingReservationId: '' } },
    ).exec();

    return result.modifiedCount;
  }

  async setSeatBroken(seatId: string, broken: boolean): Promise<SeatDocument> {
    const seat = await this.seatModel.findByIdAndUpdate(
      seatId,
      { state: broken ? SeatState.BROKEN : SeatState.AVAILABLE },
      { new: true },
    ).exec();

    if (!seat) {
      throw new NotFoundException(`Seat with ID ${seatId} not found`);
    }

    return seat;
  }

  /**
   * Auto-generate grid-based seats for an event
   * @param eventId Event ID
   * @param numberOfRows Number of rows
   * @param seatsPerRow Number of seats per row
   * @param defaultPrice Default price for seats
   */
  async generateGridSeats(
    eventId: string,
    numberOfRows: number,
    seatsPerRow: number,
    defaultPrice?: number,
  ): Promise<{ created: number }> {
    // Generate row names: A, B, C, ..., Z, AA, AB, AC, ..., AZ, BA, BB, ... (Excel-style)
    // This can handle unlimited rows
    const getRowName = (index: number): string => {
      let result = '';
      let num = index;
      
      // Convert to base-26 with letters (1-based, not 0-based)
      // A=1, B=2, ..., Z=26, AA=27, AB=28, etc.
      while (num >= 0) {
        result = String.fromCharCode(65 + (num % 26)) + result;
        num = Math.floor(num / 26) - 1;
        if (num < 0) break;
      }
      
      return result;
    };

    const seats: any[] = [];

    for (let rowIndex = 0; rowIndex < numberOfRows; rowIndex++) {
      const rowName = getRowName(rowIndex);
      for (let seatNum = 1; seatNum <= seatsPerRow; seatNum++) {
        const seatId = `${rowName}${seatNum}`;
        seats.push({
          eventId: new Types.ObjectId(eventId),
          label: seatId,
          row: rowName,
          number: seatNum,
          seatType: 'regular',
          state: SeatState.AVAILABLE,
          basePrice: defaultPrice,
          // No x, y, width, height for grid-based seats
        });
      }
    }

    // Bulk insert seats
    if (seats.length > 0) {
      await this.seatModel.insertMany(seats);
    }

    return { created: seats.length };
  }
}

