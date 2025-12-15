import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventTeamMember, EventTeamMemberDocument, Permission } from '../schemas/event-team-member.schema';
import { Event, EventDocument } from '../schemas/event.schema';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectModel(EventTeamMember.name) private teamMemberModel: Model<EventTeamMemberDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.get<Permission[]>(
      'permissions',
      context.getHandler(),
    );
    
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true; // No permissions required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Organizers have all permissions for their events
    if (user.role === 'organizer') {
      // Check if user owns the event
      const eventId = request.params.eventId || request.body.eventId || request.query.eventId;
      if (eventId) {
        const event = await this.eventModel.findById(eventId).exec();
        if (event && event.organizerId === user.id) {
          return true;
        }
      } else {
        // If no eventId, organizer has access
        return true;
      }
    }

    // For Event Admins and Staff, check permissions
    const eventId = request.params.eventId || request.body.eventId || request.query.eventId;
    if (!eventId) {
      throw new ForbiddenException('Event ID is required for permission check');
    }

    const teamMember = await this.teamMemberModel
      .findOne({ eventId, userId: user.id, isActive: true })
      .exec();

    if (!teamMember) {
      throw new ForbiddenException('You are not assigned to this event');
    }

    // Check if user has all required permissions
    const hasAllPermissions = requiredPermissions.every(permission =>
      teamMember.permissions.includes(permission),
    );

    if (!hasAllPermissions) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}


