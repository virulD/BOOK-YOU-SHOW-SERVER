import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { Booking, BookingDocument } from '../schemas/booking.schema';
import { Event, EventDocument } from '../schemas/event.schema';
import { Seat, SeatDocument } from '../schemas/seat.schema';
import { EventsService } from '../events/events.service';
import { SeatsService } from '../seats/seats.service';
import * as crypto from 'crypto';

@Injectable()
export class TicketsService {
  private readonly hmacSecret = process.env.TICKET_HMAC_SECRET || 'default-secret-change-in-production';

  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    private eventsService: EventsService,
    private seatsService: SeatsService,
  ) {}

  async generateTicket(bookingId: string) {
    const booking = await this.bookingModel.findById(bookingId).exec();
    if (!booking) {
      throw new Error('Booking not found');
    }

    const event = await this.eventsService.findOne(booking.eventId.toString());
    const seat = await this.seatsService.findOne(booking.seatId.toString());

    // Generate QR data with HMAC signature
    const ticketData = {
      bookingId: booking._id.toString(),
      eventId: booking.eventId.toString(),
      seatId: booking.seatId.toString(),
      timestamp: Date.now(),
    };

    const qrPayload = JSON.stringify(ticketData);
    const signature = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(qrPayload)
      .digest('hex');

    const qrData = JSON.stringify({ ...ticketData, signature });

    // Generate QR code image
    const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      width: 300,
    });

    // Generate PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([400, 600]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Title
    page.drawText('EVENT TICKET', {
      x: 50,
      y: 550,
      size: 24,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    // Event details
    let yPos = 500;
    page.drawText(`Event: ${event.title}`, {
      x: 50,
      y: yPos,
      size: 12,
      font: font,
    });
    yPos -= 20;

    page.drawText(`Date: ${new Date(event.startAt).toLocaleString()}`, {
      x: 50,
      y: yPos,
      size: 12,
      font: font,
    });
    yPos -= 20;

    page.drawText(`Venue: ${event.venue.name}`, {
      x: 50,
      y: yPos,
      size: 12,
      font: font,
    });
    yPos -= 40;

    // Seat details
    page.drawText(`Seat: ${seat.label}`, {
      x: 50,
      y: yPos,
      size: 14,
      font: boldFont,
    });
    yPos -= 20;

    if (seat.section) {
      page.drawText(`Section: ${seat.section}`, {
        x: 50,
        y: yPos,
        size: 12,
        font: font,
      });
      yPos -= 20;
    }

    // QR Code
    const qrImageBytes = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');
    const qrImage = await pdfDoc.embedPng(qrImageBytes);
    page.drawImage(qrImage, {
      x: 50,
      y: yPos - 250,
      width: 200,
      height: 200,
    });

    // Booking ID
    page.drawText(`Booking ID: ${booking._id.toString().substring(0, 8)}`, {
      x: 50,
      y: 50,
      size: 10,
      font: font,
      color: rgb(0.5, 0.5, 0.5),
    });

    const pdfBytes = await pdfDoc.save();

    // Update booking with QR data
    booking.qrData = qrData;
    await booking.save();

    return {
      pdf: pdfBytes,
      qrData,
      bookingId: booking._id.toString(),
    };
  }

  async verifyTicket(qrData: string): Promise<{ valid: boolean; booking?: any }> {
    try {
      const data = JSON.parse(qrData);
      const { signature, ...ticketData } = data;

      const expectedSignature = crypto
        .createHmac('sha256', this.hmacSecret)
        .update(JSON.stringify(ticketData))
        .digest('hex');

      if (signature !== expectedSignature) {
        return { valid: false };
      }

      const booking = await this.bookingModel.findById(ticketData.bookingId).exec();
      if (!booking || booking.status !== 'issued') {
        return { valid: false };
      }

      return { valid: true, booking };
    } catch (error) {
      return { valid: false };
    }
  }

  async getBookingTickets(reservationId: string) {
    const bookings = await this.bookingModel.find({ reservationId }).exec();
    return Promise.all(
      bookings.map(async (booking) => {
        if (booking.qrData) {
          return {
            bookingId: booking._id,
            qrData: booking.qrData,
            ticketUrl: booking.ticketUrl,
          };
        }
        // Generate ticket if not exists
        const ticket = await this.generateTicket(booking._id.toString());
        return {
          bookingId: booking._id,
          qrData: ticket.qrData,
          ticketUrl: booking.ticketUrl,
        };
      }),
    );
  }
}

