import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { AmountSummary } from './seat-lock.schema';

export type SeatLockBackupDocument = SeatLockBackup & Document;

@Schema({ 
  timestamps: true,
  collection: 'seatlockbackups', // Separate collection for backup
})
export class SeatLockBackup {
  @Prop({ type: String, required: true })
  _id: string; // Original reservation ID

  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  @Prop({ type: String, ref: 'User' })
  buyerId?: string;

  @Prop()
  sessionId?: string;

  @Prop({ required: true, type: [String] })
  seatIds: string[];

  @Prop({ type: Number, required: true, default: -2 })
  numericState: number; // -2: in payment gateway

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

  @Prop({ required: true })
  backedUpAt: Date; // When this backup was created
}

export const SeatLockBackupSchema = SchemaFactory.createForClass(SeatLockBackup);

// Indexes for efficient querying
SeatLockBackupSchema.index({ eventId: 1, numericState: 1 });
SeatLockBackupSchema.index({ paymentIntentId: 1 });
SeatLockBackupSchema.index({ backedUpAt: 1 });






