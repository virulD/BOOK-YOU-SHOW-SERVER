import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TeamManagementService } from './team-management.service';
import { CreateStaffMemberDto, AssignStaffToEventDto, UpdateStaffPermissionsDto } from '../dto/team-management.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@ApiTags('team-management')
@Controller('api/team-management')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TeamManagementController {
  constructor(private readonly teamManagementService: TeamManagementService) {}

  @Post('staff')
  @Roles(UserRole.ORGANIZER)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create and assign a new staff member to an event' })
  @ApiResponse({ status: 201, description: 'Staff member created and assigned' })
  async createStaffMember(@Body() createDto: CreateStaffMemberDto, @Request() req) {
    return this.teamManagementService.createStaffMember(createDto, req.user.id);
  }

  @Post('assign')
  @Roles(UserRole.ORGANIZER)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Assign existing user to an event' })
  @ApiResponse({ status: 201, description: 'User assigned to event' })
  async assignStaffToEvent(@Body() assignDto: AssignStaffToEventDto, @Request() req) {
    return this.teamManagementService.assignStaffToEvent(assignDto, req.user.id);
  }

  @Put('permissions/:id')
  @Roles(UserRole.ORGANIZER)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Update staff member permissions' })
  @ApiResponse({ status: 200, description: 'Permissions updated' })
  async updateStaffPermissions(
    @Param('id') teamMemberId: string,
    @Body() updateDto: UpdateStaffPermissionsDto,
    @Request() req,
  ) {
    return this.teamManagementService.updateStaffPermissions(teamMemberId, updateDto, req.user.id);
  }

  @Get('events/:eventId/team')
  @Roles(UserRole.ORGANIZER)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Get all team members for an event' })
  @ApiResponse({ status: 200, description: 'List of team members' })
  async getEventTeamMembers(@Param('eventId') eventId: string, @Request() req) {
    return this.teamManagementService.getEventTeamMembers(eventId, req.user.id);
  }

  @Get('my-events')
  @ApiOperation({ summary: 'Get all events assigned to current user' })
  @ApiResponse({ status: 200, description: 'List of assigned events' })
  async getUserEvents(@Request() req) {
    return this.teamManagementService.getUserEvents(req.user.id);
  }

  @Delete('team/:id')
  @Roles(UserRole.ORGANIZER)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Remove staff member from event' })
  @ApiResponse({ status: 200, description: 'Staff member removed' })
  async removeStaffFromEvent(@Param('id') teamMemberId: string, @Request() req) {
    await this.teamManagementService.removeStaffFromEvent(teamMemberId, req.user.id);
    return { message: 'Staff member removed successfully' };
  }
}


