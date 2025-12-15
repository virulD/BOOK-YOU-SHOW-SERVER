import { IsString, IsArray, IsOptional, IsNumber, Min, Max, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateBookingDto {
  @ApiProperty()
  @IsString()
  eventId: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  seatIds: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  buyerId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiProperty({ required: false, default: 600 })
  @IsOptional()
  @IsNumber()
  @Min(60)
  @Max(3600)
  holdSeconds?: number;
}

export class SeatTicketAssignment {
  @ApiProperty()
  @IsString()
  seatId: string;

  @ApiProperty({ enum: ['adult', 'child'] })
  @IsString()
  ticketType: 'adult' | 'child';
}

export class UpdateTicketsDto {
  @ApiProperty({ minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  adults?: number;

  @ApiProperty({ minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  kids?: number;

  @ApiProperty({ type: [SeatTicketAssignment], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeatTicketAssignment)
  seatAssignments?: SeatTicketAssignment[];
}

