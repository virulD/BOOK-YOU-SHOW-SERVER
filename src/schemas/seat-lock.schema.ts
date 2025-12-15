import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SeatLockDocument = SeatLock & Document;

export enum ReservationStatus {
  PENDING_PAYMENT = 'pending_payment',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

// Numeric reservation states for payment flow management
// -1: User selected seats, proceeding to payment (10 min countdown)
// -2: User redirected to Dialog payment gateway (protected from expiry)
// -3: Timeout - took more than 10 minutes to proceed
// 1: Payment successful
export enum ReservationNumericState {
  CART_TO_PAYMENT = -1,      // In cart, proceeding to payment
  IN_PAYMENT_GATEWAY = -2,   // At payment gateway, protected from expiry
  TIMEOUT = -3,              // Timed out
  PAYMENT_SUCCESS = 1,       // Payment successful
}

@Schema({ timestamps: true })
export class AmountSummary {
  @Prop({ required: true, min: 0 })
  subtotal: number;

  @Prop({ required: true, min: 0 })
  commission: number;

  @Prop({ min: 0, default: 0 })
  taxes?: number;

  @Prop({ required: true, min: 0 })
  total: number;
}

@Schema({ 
  timestamps: true,
  _id: false, // Disable auto _id, we'll add our own String _id
})
export class SeatLock {
  @Prop({ type: String, required: true })
  _id: string; // Define _id as String

  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  @Prop({ type: String, ref: 'User' })
  buyerId?: string;

  @Prop()
  sessionId?: string;

  @Prop({ required: true, type: [String] })
  seatIds: string[];

  @Prop({ required: true, enum: ReservationStatus, default: ReservationStatus.PENDING_PAYMENT })
  status: ReservationStatus;

  @Prop({ type: Number, default: -1 })
  numericState: number; // -1: cart to payment, -2: in payment gateway, -3: timeout, 1: success

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ type: AmountSummary })
  amountSummary?: AmountSummary;

  @Prop()
  paymentIntentId?: string;

  @Prop()
  phoneNumber?: string;

  // Customer information
  @Prop()
  customerName?: string;

  @Prop()
  customerEmail?: string;

  @Prop()
  billingEmail?: string;

  @Prop()
  billingAddress1?: string;

  @Prop()
  billingCity?: string;

  @Prop()
  billingCountry?: string;

  @Prop()
  billingPostCode?: string;
}

export const SeatLockSchema = SchemaFactory.createForClass(SeatLock);

// TTL index for automatic expiration
SeatLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Other indexes
SeatLockSchema.index({ eventId: 1, status: 1 });
SeatLockSchema.index({ buyerId: 1 });
SeatLockSchema.index({ sessionId: 1 });
SeatLockSchema.index({ paymentIntentId: 1 });

