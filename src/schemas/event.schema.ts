import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EventDocument = Event & Document;

export enum EventType {
  GENERAL = 'general',
  RESERVED = 'reserved',
}

@Schema({ timestamps: true })
export class Commission {
  @Prop({ required: true, enum: ['percentage', 'flat'] })
  type: 'percentage' | 'flat';

  @Prop({ required: true, min: 0 })
  value: number;
}

@Schema({ timestamps: true })
export class TicketType {
  @Prop({ required: true })
  name: string; // e.g., "VVIP", "VIP", "ODC", "Kids", "Balcony"

  @Prop({ required: true, min: 0 })
  adultPrice: number; // Adult price in LKR

  @Prop({ required: true, min: 0 })
  childPrice: number; // Child price in LKR
}

@Schema({ timestamps: true })
export class Venue {
  @Prop({ required: true })
  name: string;

  @Prop()
  address?: string;

  @Prop()
  capacity?: number;
}

@Schema({ timestamps: true })
export class Event {
  @Prop({ required: true, type: String, ref: 'User' })
  organizerId: string;

  @Prop({ required: true })
  title: string;

  @Prop()
  highlightedTitle?: string; // Brief highlighted description for event cards

  @Prop()
  description?: string;

  @Prop({ required: true })
  startAt: Date;

  @Prop({ required: true })
  endAt: Date;

  @Prop({ default: 'UTC' })
  timezone: string;

  @Prop({ type: Venue, required: true })
  venue: Venue;

  @Prop({ required: true, enum: EventType, default: EventType.RESERVED })
  eventType: EventType;

  @Prop({ required: true, min: 0 })
  defaultPrice: number;

  @Prop({ min: 0 })
  startingPrice?: number; // Minimum price to display "Rs. X onwards" in event cards

  @Prop({ type: [TicketType], default: [] })
  ticketTypes?: TicketType[]; // Custom ticket types defined by organizer

  @Prop({ type: Commission })
  commission?: Commission;

  @Prop()
  posterImageUrl?: string;

  @Prop({ default: true })
  hasSeating: boolean;

  @Prop()
  numberOfRows?: number;

  @Prop()
  seatsPerRow?: number;

  @Prop({ type: [String], default: [] })
  seatingCategories?: string[]; // Custom seating categories defined by organizer (e.g., "SUPERIOR", "PRIME", "CLASSIC")

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop({ type: Object })
  screenPosition?: {
    x: number; // Normalized position 0-1
    y: number; // Normalized position 0-1
    width?: number; // Normalized width 0-1
    height?: number; // Normalized height 0-1
  };

  @Prop()
  ticketSaleStartDate?: Date; // When ticket sales start

  @Prop()
  ticketSaleEndDate?: Date; // When ticket sales end

  @Prop({ default: false })
  isTicketSaleEnabled: boolean; // Manual toggle to enable/disable ticket sales
}

export const EventSchema = SchemaFactory.createForClass(Event);

// Indexes
EventSchema.index({ organizerId: 1 });
EventSchema.index({ startAt: 1, endAt: 1 });
EventSchema.index({ eventType: 1 });

