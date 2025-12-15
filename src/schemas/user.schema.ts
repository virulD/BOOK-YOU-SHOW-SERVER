import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  ORGANIZER = 'organizer',
  EVENT_ADMIN = 'event_admin',
  EVENT_STAFF = 'event_staff',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  password: string; // Hashed password

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, enum: UserRole, default: UserRole.ORGANIZER })
  role: UserRole;

  @Prop({ type: String, ref: 'User' })
  createdBy?: string; // For Event Admins and Staff, this is the Organizer who created them

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  phoneNumber?: string;

  @Prop()
  passwordResetToken?: string;

  @Prop()
  passwordResetExpires?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ role: 1 });
UserSchema.index({ createdBy: 1 });


