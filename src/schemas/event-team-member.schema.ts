import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EventTeamMemberDocument = EventTeamMember & Document;

// Permission types
export enum Permission {
  // Booking permissions
  MANAGE_BOOKINGS = 'manage_bookings',
  VIEW_BOOKINGS = 'view_bookings',
  
  // Seat layout permissions
  EDIT_SEAT_LAYOUT = 'edit_seat_layout',
  VIEW_SEAT_LAYOUT = 'view_seat_layout',
  
  // Ticket validation
  VALIDATE_TICKETS = 'validate_tickets',
  
  // Reports and analytics
  VIEW_REPORTS = 'view_reports',
  VIEW_ANALYTICS = 'view_analytics',
  
  // Attendee management
  VIEW_ATTENDEES = 'view_attendees',
  SUPPORT_ATTENDEES = 'support_attendees',
  
  // Event management
  EDIT_EVENT = 'edit_event',
  VIEW_EVENT = 'view_event',
}

@Schema({ timestamps: true })
export class EventTeamMember {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ required: true, type: String, ref: 'User' })
  assignedBy: string; // Organizer who assigned this staff member

  @Prop({ type: [String], enum: Permission, default: [] })
  permissions: Permission[];

  @Prop({ default: true })
  isActive: boolean;
}

export const EventTeamMemberSchema = SchemaFactory.createForClass(EventTeamMember);

// Indexes
EventTeamMemberSchema.index({ eventId: 1, userId: 1 }, { unique: true });
EventTeamMemberSchema.index({ userId: 1 });
EventTeamMemberSchema.index({ eventId: 1 });


