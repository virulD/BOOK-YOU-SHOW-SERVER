import { IsString, IsNumber, IsOptional, IsEnum, Min, Max, IsObject, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { SeatType, SeatState } from '../schemas/seat.schema';

export class CreateSeatDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  _id?: string;

  @ApiProperty()
  @IsString()
  label: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  section?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  row?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  number?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  x?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  y?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  width?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  height?: number;

  @ApiProperty({ enum: SeatType, required: false, default: SeatType.REGULAR })
  @IsOptional()
  @IsEnum(SeatType)
  seatType?: SeatType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  ticketType?: string; // Ticket type name (e.g., "VVIP", "VIP", "Balcony")

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  basePrice?: number;

  @ApiProperty({ enum: SeatState, required: false })
  @IsOptional()
  @IsEnum(SeatState)
  state?: SeatState;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class UpdateSeatsDto {
  @ApiProperty({ type: [CreateSeatDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSeatDto)
  seats: CreateSeatDto[];
}

