import { IsString, IsDateString, IsEnum, IsNumber, IsOptional, IsObject, IsArray, ValidateNested, Min, IsNotEmpty, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { EventType } from '../schemas/event.schema';

export class CommissionDto {
  @ApiProperty({ enum: ['percentage', 'flat'] })
  @IsEnum(['percentage', 'flat'])
  type: 'percentage' | 'flat';

  @ApiProperty()
  @IsNumber()
  @Min(0)
  value: number;
}

export class TicketTypeDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  adultPrice: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  childPrice: number;
}

export class VenueDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  capacity?: number;
}

export class CreateEventDto {
  @ApiProperty()
  @IsString()
  organizerId: string;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  highlightedTitle?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsDateString()
  startAt: string;

  @ApiProperty()
  @IsDateString()
  endAt: string;

  @ApiProperty({ required: false, default: 'UTC' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({ type: VenueDto })
  @ValidateNested()
  @Type(() => VenueDto)
  venue: VenueDto;

  @ApiProperty({ enum: EventType, default: EventType.RESERVED })
  @IsEnum(EventType)
  eventType: EventType;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  defaultPrice: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  startingPrice?: number;

  @ApiProperty({ type: [TicketTypeDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TicketTypeDto)
  ticketTypes?: TicketTypeDto[];

  @ApiProperty({ type: CommissionDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => CommissionDto)
  commission?: CommissionDto;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  posterImageUrl?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  hasSeating?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(1)
  numberOfRows?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(1)
  seatsPerRow?: number;

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  seatingCategories?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  screenPosition?: {
    x: number;
    y: number;
    width?: number;
    height?: number;
  };

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  ticketSaleStartDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  ticketSaleEndDate?: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isTicketSaleEnabled?: boolean;
}

