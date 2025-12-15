import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument, UserRole } from '../schemas/user.schema';
import { EventTeamMember, EventTeamMemberDocument, Permission } from '../schemas/event-team-member.schema';
import { Event, EventDocument } from '../schemas/event.schema';
import { CreateStaffMemberDto, AssignStaffToEventDto, UpdateStaffPermissionsDto } from '../dto/team-management.dto';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class TeamManagementService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(EventTeamMember.name) private teamMemberModel: Model<EventTeamMemberDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    private authService: AuthService,
  ) {}

  // Default permissions for Event Admin
  private readonly EVENT_ADMIN_PERMISSIONS: Permission[] = [
    Permission.MANAGE_BOOKINGS,
    Permission.VIEW_BOOKINGS,
    Permission.EDIT_SEAT_LAYOUT,
    Permission.VIEW_SEAT_LAYOUT,
    Permission.VIEW_REPORTS,
    Permission.VIEW_ANALYTICS,
    Permission.VIEW_ATTENDEES,
    Permission.EDIT_EVENT,
    Permission.VIEW_EVENT,
  ];

  // Default permissions for Event Staff
  private readonly EVENT_STAFF_PERMISSIONS: Permission[] = [
    Permission.VALIDATE_TICKETS,
    Permission.VIEW_ATTENDEES,
    Permission.SUPPORT_ATTENDEES,
    Permission.VIEW_BOOKINGS,
    Permission.VIEW_SEAT_LAYOUT,
    Permission.VIEW_EVENT,
  ];

  async createStaffMember(createDto: CreateStaffMemberDto, organizerId: string): Promise<any> {
    // Verify organizer owns the event
    const event = await this.eventModel.findById(createDto.eventId).exec();
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (event.organizerId !== organizerId) {
      throw new ForbiddenException('You do not have permission to add staff to this event');
    }

    // Check if user already exists
    let user = await this.userModel.findOne({ email: createDto.email }).exec();
    
    if (user) {
      // User exists, check if already assigned to this event
      const existingAssignment = await this.teamMemberModel
        .findOne({ eventId: createDto.eventId, userId: user._id })
        .exec();
      
      if (existingAssignment) {
        throw new BadRequestException('User is already assigned to this event');
      }

      // Assign existing user to event
      const defaultPermissions = createDto.role === UserRole.EVENT_ADMIN
        ? this.EVENT_ADMIN_PERMISSIONS
        : this.EVENT_STAFF_PERMISSIONS;

      const teamMember = new this.teamMemberModel({
        eventId: createDto.eventId,
        userId: user._id,
        assignedBy: organizerId,
        permissions: createDto.permissions || defaultPermissions,
        isActive: true,
      });

      await teamMember.save();
      return this.formatTeamMemberResponse(teamMember, user, event);
    } else {
      // Create new user and assign to event
      // Generate a temporary password (should be sent via email in production)
      const tempPassword = Math.random().toString(36).slice(-8) + 'A1!';
      
      const registerDto = {
        email: createDto.email,
        password: tempPassword,
        name: createDto.name,
        role: createDto.role,
        phoneNumber: createDto.phoneNumber,
      };

      const authResult = await this.authService.register(registerDto, organizerId);
      user = await this.userModel.findById(authResult.user.id).exec();
      
      if (!user) {
        throw new NotFoundException('Failed to create user');
      }

      const defaultPermissions = createDto.role === UserRole.EVENT_ADMIN
        ? this.EVENT_ADMIN_PERMISSIONS
        : this.EVENT_STAFF_PERMISSIONS;

      const teamMember = new this.teamMemberModel({
        eventId: createDto.eventId,
        userId: user._id,
        assignedBy: organizerId,
        permissions: createDto.permissions || defaultPermissions,
        isActive: true,
      });

      await teamMember.save();
      
      return {
        ...this.formatTeamMemberResponse(teamMember, user, event),
        tempPassword, // In production, send this via email
      };
    }
  }

  async assignStaffToEvent(assignDto: AssignStaffToEventDto, organizerId: string): Promise<any> {
    // Verify organizer owns the event
    const event = await this.eventModel.findById(assignDto.eventId).exec();
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (event.organizerId !== organizerId) {
      throw new ForbiddenException('You do not have permission to assign staff to this event');
    }

    // Check if user exists
    const user = await this.userModel.findById(assignDto.userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if already assigned
    const existing = await this.teamMemberModel
      .findOne({ eventId: assignDto.eventId, userId: assignDto.userId })
      .exec();

    if (existing) {
      // Update existing assignment
      existing.permissions = assignDto.permissions;
      existing.isActive = true;
      await existing.save();
      return this.formatTeamMemberResponse(existing, user, event);
    }

    // Create new assignment
    const teamMember = new this.teamMemberModel({
      eventId: assignDto.eventId,
      userId: assignDto.userId,
      assignedBy: organizerId,
      permissions: assignDto.permissions,
      isActive: true,
    });

    await teamMember.save();
    return this.formatTeamMemberResponse(teamMember, user, event);
  }

  async updateStaffPermissions(
    teamMemberId: string,
    updateDto: UpdateStaffPermissionsDto,
    organizerId: string,
  ): Promise<any> {
    const teamMember = await this.teamMemberModel.findById(teamMemberId).exec();
    if (!teamMember) {
      throw new NotFoundException('Team member not found');
    }

    // Verify organizer owns the event
    const event = await this.eventModel.findById(teamMember.eventId).exec();
    if (!event || event.organizerId !== organizerId) {
      throw new ForbiddenException('You do not have permission to update this team member');
    }

    teamMember.permissions = updateDto.permissions;
    if (updateDto.isActive !== undefined) {
      teamMember.isActive = updateDto.isActive;
    }

      await teamMember.save();
      const user = await this.userModel.findById(teamMember.userId).exec();
      if (!user) {
        throw new NotFoundException('User not found');
      }
      return this.formatTeamMemberResponse(teamMember, user, event);
  }

  async getEventTeamMembers(eventId: string, organizerId: string): Promise<any[]> {
    // Verify organizer owns the event
    const event = await this.eventModel.findById(eventId).exec();
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (event.organizerId !== organizerId) {
      throw new ForbiddenException('You do not have permission to view team members for this event');
    }

    const teamMembers = await this.teamMemberModel
      .find({ eventId, isActive: true })
      .populate('userId', 'email name role')
      .exec();

    return teamMembers.map(tm => this.formatTeamMemberResponse(tm, tm.userId as any, event));
  }

  async getUserEvents(userId: string): Promise<any[]> {
    const teamMembers = await this.teamMemberModel
      .find({ userId, isActive: true })
      .populate('eventId')
      .exec();

    return teamMembers.map(tm => ({
      event: tm.eventId,
      permissions: tm.permissions,
    }));
  }

  async removeStaffFromEvent(teamMemberId: string, organizerId: string): Promise<void> {
    const teamMember = await this.teamMemberModel.findById(teamMemberId).exec();
    if (!teamMember) {
      throw new NotFoundException('Team member not found');
    }

    // Verify organizer owns the event
    const event = await this.eventModel.findById(teamMember.eventId).exec();
    if (!event || event.organizerId !== organizerId) {
      throw new ForbiddenException('You do not have permission to remove this team member');
    }

    await this.teamMemberModel.findByIdAndDelete(teamMemberId).exec();
  }

  private formatTeamMemberResponse(teamMember: any, user: any, event: any) {
    return {
      id: teamMember._id.toString(),
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
      },
      event: {
        id: event._id.toString(),
        title: event.title,
      },
      permissions: teamMember.permissions,
      isActive: teamMember.isActive,
      assignedAt: teamMember.createdAt,
    };
  }
}

