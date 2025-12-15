import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SeatsService } from './seats.service';
import { UpdateSeatsDto } from '../dto/create-seat.dto';

@ApiTags('seats')
@Controller('api')
export class SeatsController {
  constructor(private readonly seatsService: SeatsService) {}

  @Put('organizer/events/:id/seats')
  @ApiOperation({ summary: 'Update seats for an event' })
  @ApiResponse({ status: 200, description: 'Seats updated successfully' })
  async updateSeats(@Param('id') eventId: string, @Body() updateSeatsDto: UpdateSeatsDto) {
    try {
      console.log('Received updateSeats request for event:', eventId);
      console.log('Seats data:', JSON.stringify(updateSeatsDto, null, 2));
      const result = await this.seatsService.updateSeats(eventId, updateSeatsDto);
      console.log('Update result:', result);
      return result;
    } catch (error: any) {
      console.error('Error updating seats:', error);
      throw error;
    }
  }

  @Get('events/:id/seats')
  @ApiOperation({ summary: 'Get all seats for an event' })
  @ApiResponse({ status: 200, description: 'List of seats' })
  async getSeats(
    @Param('id') eventId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 0;
    const limitNum = limit ? parseInt(limit, 10) : 5000;
    return this.seatsService.findAllByEvent(eventId, pageNum, limitNum);
  }

  @Get('events/:id')
  @ApiOperation({ summary: 'Get event with minimal seat data' })
  @ApiResponse({ status: 200, description: 'Event with seats' })
  async getEventWithSeats(@Param('id') eventId: string) {
    const seats = await this.seatsService.findAllByEvent(eventId);
    // This should ideally join with events service, but for now return seats
    return { eventId, seats };
  }

  @Post('organizer/events/:id/seats/generate')
  @ApiOperation({ summary: 'Auto-generate grid seats for an event' })
  @ApiResponse({ status: 201, description: 'Seats generated successfully' })
  async generateSeats(
    @Param('id') eventId: string,
    @Body() body: { numberOfRows: number; seatsPerRow: number; defaultPrice?: number },
  ) {
    return this.seatsService.generateGridSeats(
      eventId,
      body.numberOfRows,
      body.seatsPerRow,
      body.defaultPrice,
    );
  }
}

