import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FCMMessageDocument = FCMMessage & Document;

export enum MessageStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  ACKNOWLEDGED = 'acknowledged', // App confirmed receipt
}

@Schema({ timestamps: true })
export class FCMMessage {
  @Prop({ required: true })
  phoneNumber: string;

  @Prop({ required: true })
  fcmToken: string;

  @Prop({ required: true })
  message: string;

  @Prop({ required: true, enum: MessageStatus, default: MessageStatus.PENDING })
  status: MessageStatus;

  @Prop()
  fcmMessageId?: string; // FCM response message ID

  @Prop()
  error?: string; // Error message if failed

  @Prop()
  sentAt?: Date; // When FCM confirmed sending

  @Prop()
  deliveredAt?: Date; // When FCM confirmed delivery (if available)

  @Prop()
  acknowledgedAt?: Date; // When app confirmed receipt

  @Prop({ type: Object })
  fcmResponse?: any; // Full FCM response for debugging

  @Prop()
  deviceInfo?: string;

  // Timestamps are automatically added by Mongoose when timestamps: true
  createdAt?: Date;
  updatedAt?: Date;
}

export const FCMMessageSchema = SchemaFactory.createForClass(FCMMessage);

// Indexes
FCMMessageSchema.index({ phoneNumber: 1 });
FCMMessageSchema.index({ fcmToken: 1 });
FCMMessageSchema.index({ status: 1 });
FCMMessageSchema.index({ createdAt: -1 });
FCMMessageSchema.index({ phoneNumber: 1, status: 1 });


