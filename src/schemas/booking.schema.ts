import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BookingDocument = Booking & Document;

export enum TicketStatus {
  ISSUED = 'issued',
  REFUNDED = 'refunded',
}

export enum PaymentState {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class Booking {
  @Prop({ required: true })
  reservationId: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  @Prop({ type: String, ref: 'User' })
  buyerId?: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Seat' })
  seatId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  pricePaid: number;

  @Prop({ min: 0, default: 0 })
  commissionAmount: number;

  @Prop({ required: true, enum: TicketStatus, default: TicketStatus.ISSUED })
  status: TicketStatus;

  @Prop({ enum: PaymentState, default: PaymentState.PENDING })
  paymentState: PaymentState;

  @Prop()
  ticketUrl?: string;

  @Prop()
  qrData?: string;

  @Prop({ default: 1 })
  adultCount: number;

  @Prop({ default: 0 })
  kidCount: number;

  @Prop()
  phoneNumber?: string;

  @Prop()
  dialogPaymentId?: string; // Dialog Genie payment ID

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

export const BookingSchema = SchemaFactory.createForClass(Booking);

// Indexes
BookingSchema.index({ reservationId: 1 });
BookingSchema.index({ eventId: 1 });
BookingSchema.index({ buyerId: 1 });
BookingSchema.index({ seatId: 1 });
BookingSchema.index({ status: 1 });

