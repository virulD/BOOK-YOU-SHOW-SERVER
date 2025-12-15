import { Controller, Get, Post, Param, Body, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TicketsService } from './tickets.service';

@ApiTags('tickets')
@Controller('api/tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get('booking/:bookingId')
  @ApiOperation({ summary: 'Generate ticket PDF for booking' })
  @ApiResponse({ status: 200, description: 'PDF ticket' })
  async getTicket(@Param('bookingId') bookingId: string, @Res() res: Response) {
    const ticket = await this.ticketsService.generateTicket(bookingId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=ticket-${bookingId}.pdf`);
    res.send(ticket.pdf);
  }

  @Get('reservation/:reservationId')
  @ApiOperation({ summary: 'Get all tickets for a reservation' })
  @ApiResponse({ status: 200, description: 'List of tickets' })
  async getReservationTickets(@Param('reservationId') reservationId: string) {
    return this.ticketsService.getBookingTickets(reservationId);
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify ticket QR code' })
  @ApiResponse({ status: 200, description: 'Verification result' })
  async verifyTicket(@Body('qrData') qrData: string) {
    return this.ticketsService.verifyTicket(qrData);
  }
}

