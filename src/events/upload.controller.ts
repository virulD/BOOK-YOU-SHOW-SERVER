import { Controller, Post, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';

interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer: Buffer;
}

@ApiTags('events')
@Controller('api/organizer/events')
export class UploadController {
  @Post('upload-poster')
  @ApiOperation({ summary: 'Upload event poster image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/posters',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          cb(null, `poster-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          return cb(new BadRequestException('Only image files are allowed!'), false);
        }
        cb(null, true);
      },
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
      },
    }),
  )
  async uploadPoster(@UploadedFile() file: UploadedFile) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Ensure uploads directory exists
    if (!fs.existsSync('./uploads/posters')) {
      fs.mkdirSync('./uploads/posters', { recursive: true });
    }

    // Return the file path (in production, you'd upload to S3 and return the URL)
    const fileUrl = `/uploads/posters/${file.filename}`;
    
    return {
      url: fileUrl,
      filename: file.filename,
      size: file.size,
    };
  }
}

