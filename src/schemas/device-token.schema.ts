import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DeviceTokenDocument = DeviceToken & Document;

@Schema({ timestamps: true })
export class DeviceToken {
  @Prop({ required: true, unique: true })
  phoneNumber: string;

  @Prop({ required: true })
  fcmToken: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  deviceInfo?: string; // Optional: device model, OS, etc.

  @Prop()
  lastUsedAt?: Date;
}

export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);

// Indexes
DeviceTokenSchema.index({ phoneNumber: 1 }, { unique: true });
DeviceTokenSchema.index({ fcmToken: 1 });
DeviceTokenSchema.index({ isActive: 1 });





























