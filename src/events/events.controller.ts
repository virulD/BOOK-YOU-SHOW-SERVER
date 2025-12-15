import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { CreateEventDto } from '../dto/create-event.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@ApiTags('events')
@Controller('api/organizer/events')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @Roles(UserRole.ORGANIZER)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create a new event' })
  @ApiResponse({ status: 201, description: 'Event created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(@Body() createEventDto: CreateEventDto, @Request() req) {
    // Set organizerId from authenticated user
    createEventDto.organizerId = req.user.id;
    try {
      const event = await this.eventsService.create(createEventDto);
      // Ensure _id is serialized as string
      const eventObj = event.toObject();
      return {
        ...eventObj,
        _id: eventObj._id.toString(),
      };
    } catch (error: any) {
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get all events for current user' })
  @ApiResponse({ status: 200, description: 'List of events' })
  async findAll(@Request() req) {
    return this.eventsService.findAll(req.user.id, req.user.role);
  }

  @Put(':id/toggle-ticket-sale')
  @Roles(UserRole.ORGANIZER)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Toggle ticket sale status' })
  @ApiResponse({ status: 200, description: 'Ticket sale status updated' })
  async toggleTicketSale(@Param('id') id: string, @Body() body: { enabled: boolean }, @Request() req) {
    return this.eventsService.update(id, { isTicketSaleEnabled: body.enabled }, req.user.id, req.user.role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event by ID' })
  @ApiResponse({ status: 200, description: 'Event details' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async findOne(@Param('id') id: string) {
    return this.eventsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update event' })
  @ApiResponse({ status: 200, description: 'Event updated' })
  async update(@Param('id') id: string, @Body() updateData: Partial<CreateEventDto>, @Request() req) {
    return this.eventsService.update(id, updateData, req.user.id, req.user.role);
  }

  @Delete(':id')
  @Roles(UserRole.ORGANIZER)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Delete event' })
  @ApiResponse({ status: 200, description: 'Event deleted' })
  async remove(@Param('id') id: string, @Request() req) {
    return this.eventsService.remove(id, req.user.id, req.user.role);
  }
}

// Public events controller (no authentication required)
@ApiTags('events')
@Controller('api/events')
export class PublicEventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all public events' })
  @ApiResponse({ status: 200, description: 'List of all public events' })
  async findAll() {
    console.log('PublicEventsController.findAll() called');
    // Public access - no userId or userRole, returns all events
    return this.eventsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get public event by ID' })
  @ApiResponse({ status: 200, description: 'Event details' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async findOne(@Param('id') id: string) {
    return this.eventsService.findOne(id);
  }
}

