import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Event, EventDocument } from '../schemas/event.schema';
import { EventTeamMember, EventTeamMemberDocument, Permission } from '../schemas/event-team-member.schema';
import { CreateEventDto } from '../dto/create-event.dto';

@Injectable()
export class EventsService {
  constructor(
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(EventTeamMember.name) private teamMemberModel: Model<EventTeamMemberDocument>,
  ) {}

  async create(createEventDto: CreateEventDto): Promise<EventDocument> {
    try {
      console.log('Creating event with data:', JSON.stringify(createEventDto, null, 2));
      const event = new this.eventModel(createEventDto);
      const savedEvent = await event.save();
      console.log('Event saved successfully with ID:', savedEvent._id);
      console.log('Event document:', JSON.stringify(savedEvent.toObject(), null, 2));
      return savedEvent;
    } catch (error: any) {
      console.error('Error creating event:', error);
      if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map((err: any) => err.message);
        throw new Error(`Validation failed: ${messages.join(', ')}`);
      }
      throw error;
    }
  }

  async findAll(userId?: string, userRole?: string): Promise<EventDocument[]> {
    let query: any = {};
    
    if (userRole === 'organizer') {
      // Organizers see all their events
      query = { organizerId: userId };
    } else if (userRole === 'event_admin' || userRole === 'event_staff') {
      // Event Admins and Staff see only events they're assigned to
      const teamMembers = await this.teamMemberModel
        .find({ userId: new Types.ObjectId(userId), isActive: true })
        .exec();
      const eventIds = teamMembers.map(tm => tm.eventId);
      query = { _id: { $in: eventIds } };
    } else {
      // Public access - return all events (for public viewing)
      query = {};
    }
    
    console.log('Finding events with query:', JSON.stringify(query));
    const events = await this.eventModel.find(query).sort({ startAt: -1 }).exec();
    console.log(`Found ${events.length} events`);
    return events;
  }

  async findOne(id: string): Promise<EventDocument> {
    const event = await this.eventModel.findById(id).exec();
    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }
    return event;
  }

  async update(id: string, updateData: Partial<CreateEventDto>, userId?: string, userRole?: string): Promise<EventDocument> {
    const event = await this.eventModel.findById(id).exec();
    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    // Check permissions
    if (userRole === 'organizer') {
      if (event.organizerId !== userId) {
        throw new ForbiddenException('You do not have permission to update this event');
      }
    } else if (userRole === 'event_admin' || userRole === 'event_staff') {
      const teamMember = await this.teamMemberModel
        .findOne({ eventId: id, userId: new Types.ObjectId(userId), isActive: true })
        .exec();
      if (!teamMember || !teamMember.permissions.includes(Permission.EDIT_EVENT)) {
        throw new ForbiddenException('You do not have permission to update this event');
      }
    }

    const updatedEvent = await this.eventModel.findByIdAndUpdate(id, updateData, { new: true }).exec();
    if (!updatedEvent) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }
    return updatedEvent;
  }

  async remove(id: string, userId?: string, userRole?: string): Promise<void> {
    const event = await this.eventModel.findById(id).exec();
    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    // Only organizers can delete events
    if (userRole !== 'organizer' || event.organizerId !== userId) {
      throw new ForbiddenException('You do not have permission to delete this event');
    }

    const result = await this.eventModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }
  }
}

