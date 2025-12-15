import { IsString, IsEmail, IsOptional, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class DialogGenieCustomerDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  billingEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingAddress1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingPostCode?: string;

  @ApiProperty()
  @IsString()
  phoneNumber: string;
}

export class CreateDialogGeniePaymentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => DialogGenieCustomerDto)
  customer?: DialogGenieCustomerDto;
}

