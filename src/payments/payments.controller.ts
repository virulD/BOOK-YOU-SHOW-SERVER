import { Controller, Post, Get, Body, Param, Query, Headers, RawBodyRequest, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { PaymentsService } from './payments.service';
import { CreateDialogGeniePaymentDto } from '../dto/dialog-genie-payment.dto';

@ApiTags('payments')
@Controller('api/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('intent/:reservationId')
  @ApiOperation({ summary: 'Create payment intent for reservation via Dialog Genie' })
  @ApiResponse({ status: 200, description: 'Payment intent created and Dialog Genie payment URL returned' })
  async createPaymentIntent(
    @Param('reservationId') reservationId: string,
    @Body() body?: CreateDialogGeniePaymentDto,
  ) {
    return this.paymentsService.createPaymentIntent(reservationId, body?.customer);
  }

  @Post('process/:reservationId')
  @ApiOperation({ summary: 'Process dummy payment' })
  @ApiResponse({ status: 200, description: 'Payment processed' })
  async processPayment(
    @Param('reservationId') reservationId: string,
    @Body() paymentData: { cardNumber: string; expiryDate: string; cvv: string; phoneNumber: string },
  ) {
    //return this.paymentsService.processDummyPayment(reservationId, paymentData);
  }

  @Get('redirect')
  @ApiOperation({ summary: 'Dialog Genie payment redirect handler - redirects user to success page' })
  @ApiResponse({ status: 302, description: 'Redirects to frontend success page' })
  async handleDialogGenieRedirect(
    @Query() query: any,
    @Res() res: any,
  ) {
    return this.paymentsService.handleDialogGenieRedirect(query, res);
  }

  @Post('callback')
  @ApiOperation({ summary: 'Dialog Genie payment callback handler (webhook)' })
  @ApiResponse({ status: 200, description: 'Payment callback processed' })
  async handleDialogGenieCallback(@Body() callbackData: { paymentId: string; status: 'SUCCESS' | 'FAILED' }) {
   // return this.paymentsService.handleDialogGenieCallback(callbackData);
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Stripe webhook handler (placeholder)' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  async handleWebhook(
    @Body() body: any,
    @Headers('stripe-signature') signature: string,
  ) {
   // return this.paymentsService.handleWebhook(JSON.stringify(body), signature);
  }

  @Get('check-and-confirm/:reservationId')
  @ApiOperation({ summary: 'Check transaction status and manually confirm booking (GET - easy to call from browser)' })
  @ApiResponse({ status: 200, description: 'Transaction checked and booking confirmed' })
  async checkAndConfirmBookingGet(
    @Param('reservationId') reservationId: string,
    @Query('paymentId') paymentId?: string,
  ) {
    return this.paymentsService.checkAndConfirmBooking(reservationId, paymentId);
  }

  @Post('check-and-confirm/:reservationId')
  @ApiOperation({ summary: 'Check transaction status and manually confirm booking (POST - for programmatic calls)' })
  @ApiResponse({ status: 200, description: 'Transaction checked and booking confirmed' })
  async checkAndConfirmBooking(
    @Param('reservationId') reservationId: string,
    @Body() body?: { paymentId?: string },
  ) {
    return this.paymentsService.checkAndConfirmBooking(reservationId, body?.paymentId);
  }

  @Get('find-by-payment/:paymentId')
  @ApiOperation({ summary: 'Find reservation by payment ID' })
  @ApiResponse({ status: 200, description: 'Reservation found' })
  async findReservationByPaymentId(@Param('paymentId') paymentId: string) {
    return this.paymentsService.findReservationByPaymentId(paymentId);
  }

  @Post('trigger-sms/:reservationId')
  @ApiOperation({ summary: 'Manually trigger SMS for a reservation (for testing)' })
  @ApiResponse({ status: 200, description: 'SMS triggered' })
  async triggerSms(@Param('reservationId') reservationId: string) {
    return this.paymentsService.triggerSmsForReservation(reservationId);
  }
}

