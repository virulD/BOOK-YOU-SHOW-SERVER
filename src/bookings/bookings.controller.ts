import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CreateBookingDto, UpdateTicketsDto } from '../dto/create-booking.dto';

@ApiTags('bookings')
@Controller('api/bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post('create')
  @ApiOperation({ summary: 'Create a booking reservation' })
  @ApiResponse({ status: 201, description: 'Reservation created' })
  async create(@Body() createBookingDto: CreateBookingDto) {
    try {
      console.log('Received booking creation request:', JSON.stringify(createBookingDto, null, 2));
      const result = await this.bookingsService.createReservation(createBookingDto);
      console.log('Booking created successfully:', result);
      return result;
    } catch (error: any) {
      console.error('Error creating booking:', error);
      console.error('Error stack:', error.stack);
      throw error;
    }
  }

  @Put(':reservationId/tickets')
  @ApiOperation({ summary: 'Update ticket counts (adults/kids)' })
  @ApiResponse({ status: 200, description: 'Tickets updated' })
  async updateTickets(
    @Param('reservationId') reservationId: string,
    @Body() updateTicketsDto: UpdateTicketsDto,
  ) {
    return this.bookingsService.updateTickets(reservationId, updateTicketsDto);
  }

  @Post(':reservationId/confirm')
  @ApiOperation({ summary: 'Confirm booking after payment' })
  @ApiResponse({ status: 200, description: 'Booking confirmed' })
  async confirm(
    @Param('reservationId') reservationId: string,
    @Body('paymentIntentId') paymentIntentId?: string,
  ) {
    return this.bookingsService.confirmBooking(reservationId, paymentIntentId);
  }

  @Post(':reservationId/cancel')
  @ApiOperation({ summary: 'Cancel reservation' })
  @ApiResponse({ status: 200, description: 'Reservation cancelled' })
  async cancel(@Param('reservationId') reservationId: string) {
    return this.bookingsService.cancelReservation(reservationId);
  }

  // Static routes must come before parameterized routes
  @Get('events/:id/availability')
  @ApiOperation({ summary: 'Get seat availability snapshot' })
  @ApiResponse({ status: 200, description: 'Availability data' })
  async getAvailability(@Param('id') eventId: string) {
    return this.bookingsService.getAvailability(eventId);
  }

  // More specific routes must come before general parameterized routes
  @Get(':reservationId/details')
  @ApiOperation({ summary: 'Get complete booking details for receipt' })
  @ApiResponse({ status: 200, description: 'Booking details' })
  async getBookingDetails(@Param('reservationId') reservationId: string) {
    try {
      console.log('Fetching booking details for reservation:', reservationId);
      const details = await this.bookingsService.getBookingDetails(reservationId);
      console.log('Booking details fetched successfully');
      return details;
    } catch (error: any) {
      console.error('Error fetching booking details:', error);
      throw error;
    }
  }

  @Get(':reservationId')
  @ApiOperation({ summary: 'Get reservation details' })
  @ApiResponse({ status: 200, description: 'Reservation details' })
  async getReservation(@Param('reservationId') reservationId: string) {
    return this.bookingsService.getReservation(reservationId);
  }
}

