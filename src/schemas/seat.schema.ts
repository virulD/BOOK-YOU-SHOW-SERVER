import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SeatDocument = Seat & Document;

export enum SeatState {
  AVAILABLE = 'available',
  PAYMENT_PENDING = 'payment_pending',
  BOOKED = 'booked',
  BROKEN = 'broken',
  AISLE = 'aisle',
  BLOCKED = 'blocked',
}

export enum SeatType {
  REGULAR = 'regular',
  VIP = 'vip',
  ACCESSIBLE = 'accessible',
}

@Schema({ timestamps: true })
export class Seat {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  @Prop({ required: true })
  label: string;

  @Prop()
  section?: string;

  @Prop()
  row?: string;

  @Prop()
  number?: number;

  // Normalized coordinates (0-1) relative to background image (optional for grid-based seats)
  @Prop({ required: false, min: 0, max: 1 })
  x?: number;

  @Prop({ required: false, min: 0, max: 1 })
  y?: number;

  @Prop({ required: false, min: 0, max: 1 })
  width?: number;

  @Prop({ required: false, min: 0, max: 1 })
  height?: number;

  @Prop({ enum: SeatType, default: SeatType.REGULAR })
  seatType: SeatType;

  @Prop()
  ticketType?: string; // References a ticket type name from event.ticketTypes (e.g., "VVIP", "VIP", "Balcony")

  @Prop({ min: 0 })
  basePrice?: number; // Override price for this specific seat (optional)

  @Prop({ required: true, enum: SeatState, default: SeatState.AVAILABLE })
  state: SeatState;

  @Prop()
  pendingReservationId?: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const SeatSchema = SchemaFactory.createForClass(Seat);

// Indexes for atomic operations and queries
SeatSchema.index({ eventId: 1, state: 1 });
SeatSchema.index({ eventId: 1, label: 1 }, { unique: true });
SeatSchema.index({ pendingReservationId: 1 });
SeatSchema.index({ eventId: 1, row: 1, number: 1 });

